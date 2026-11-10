import Joi from 'joi';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';

/*
 * ST (Share Transfer) Dashboard APIs (all under /dashboard/st/*, token + ST role required).
 *
 * The ST role is read from users.user_type of the token user (never from the request).
 * Read-only: nothing is written and no order, payment, refund or share-debit workflow is touched.
 * ST sees every order (the existing ST pages are not limited to one person, so neither is this).
 *
 * Every order is placed in exactly ONE direction, so nothing is counted twice:
 *   REFUND  the order has refund activity (refund_status <> NONE) or was cancelled through the refund
 *           flow (cancellation_status = COMPLETED). Refunds exist only for BUY orders.
 *   BUY     "shares transferred to buyers": BUY order that RM approved and AM completed (it reached
 *           the share transfer stage). BUY orders with advisor_id 2 are left out: they are inserted
 *           already completed and never pass through share transfer.
 *   SELL    "shares received from sellers": SELL order that RM approved, not a mark-as-sold order
 *           (those are auto handled), i.e. the share debit stage.
 *   Anything else is not in the ST scope.
 * State (from st_status; for REFUND from refund_status):
 *   DONE     st_status COMPLETED  (BUY = credited to buyer, SELL = received in our DP; REFUND = REFUNDED)
 *   FAILED   st_status REJECTED / CANCEL
 *   PENDING  everything else (PENDING, HOLD, PROCCESSING; REFUND = requested / accepted / partly refunded)
 *
 * Entry date of an order (all values are IST local time, the period filter and "waiting" use it):
 *   BUY  am_datetime (when the AM sent it to share transfer), fallback created_at converted to IST
 *   SELL rm_datetime (when the RM approved it), fallback created_at converted to IST
 *   REFUND latest refund request date
 *
 * Depository (NSDL / CDSL): NOT AVAILABLE. The database does not store it. user_cmr_details.client_id holds
 * short broker client codes (checked on the test data: 8 characters, not the 16 character demat ids), so the
 * depository cannot be derived reliably. The API returns it as unavailable and the screen shows "-".
 * CMR verification and transfer stages are not implemented in the database yet, so no numbers are
 * returned for them.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- helpers ---------------- */
const num = (v) => Number(v || 0);
const pad = (n) => String(n).padStart(2, '0');
const monthStr = (y, m0) => `${y}-${pad(m0 + 1)}-01 00:00:00`;
const IST = (col) => `CONVERT_TZ(${col}, '+00:00', '+05:30')`;
const NAME = (a) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.middle_name, ${a}.last_name)), ''), ${a}.username)`;
const rangeCond = (expr, start, end) =>
    (start ? ` AND ${expr} >= '${start}'` : '') + (end ? ` AND ${expr} < '${end}'` : '');
const REFUND_DATE = `IFNULL(rt.refund_Datetime, ${IST('rt.created_at')})`;

/** Current IST time as 'YYYY-MM-DD HH:mm:ss' and the IST calendar day. */
function istNow() {
    const d = new Date(Date.now() + IST_OFFSET_MS);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { day, time: `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`, d };
}

function periodWindow(period) {
    const { d } = istNow();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (period === 'all') {
        return { period, label: 'All Time', start: null, end: null, prevStart: null, prevEnd: null, hasPrev: false, prevLabel: null };
    }
    if (period === 'year') {
        return {
            period, label: String(y), prevLabel: String(y - 1), hasPrev: true,
            start: `${y}-01-01 00:00:00`, end: `${y + 1}-01-01 00:00:00`,
            prevStart: `${y - 1}-01-01 00:00:00`, prevEnd: `${y}-01-01 00:00:00`,
        };
    }
    const nextY = m === 11 ? y + 1 : y;
    const nextM = (m + 1) % 12;
    const prevY = m === 0 ? y - 1 : y;
    const prevM = (m + 11) % 12;
    return {
        period: 'month', label: `${MONTH_NAMES[m]} ${y}`, prevLabel: MONTH_SHORT[prevM], hasPrev: true,
        start: monthStr(y, m), end: monthStr(nextY, nextM),
        prevStart: monthStr(prevY, prevM), prevEnd: monthStr(y, m),
    };
}

/** Percentage change; null when the previous value is zero (cannot be computed safely). */
const pctChange = (cur, prev) => {
    if (prev === null || prev === undefined || !Number(prev)) return null;
    return Math.round(((Number(cur) - Number(prev)) / Math.abs(Number(prev))) * 1000) / 10;
};

/** ST only. The role is read from users.user_type, not from the token or the request. */
async function requireSt(req, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || actor.user_type !== 'ST') {
        next(new CustomErrorHandler(403, 'Only an ST user can open the Share Transfer dashboard'));
        return null;
    }
    return actor;
}

const periodSchema = Joi.object({ period: Joi.string().valid('month', 'year', 'all').default('month') });

/* ---------------- shared SQL: one row per order with its direction, state and entry date ---------------- */
const RAW = `
    SELECT ot.order_id, ot.order_custom_id, ot.transaction_type AS t, ot.quantity AS qty, ot.advisor_id,
           ot.rm_status, ot.am_status, ot.st_status, ot.refund_status, ot.cancellation_status,
           IFNULL(ot.markAsSold, 0) AS mas,
           IFNULL(ot.am_datetime, ${IST('ot.created_at')}) AS buy_dt,
           IFNULL(ot.rm_datetime, ${IST('ot.created_at')}) AS sell_dt,
           ot.am_datetime, ot.rm_datetime, ot.st_datetime,
           (SELECT MAX(rr.requested_datetime) FROM refund_requests rr WHERE rr.order_id = ot.order_id) AS refund_dt,
           ${NAME('u')} AS client_name,
           sd.company_name
    FROM order_transactions ot
    JOIN users u ON u.user_id = ot.user_id
    JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id`;

const LEVEL = `
    SELECT d.*,
           CASE
               WHEN d.dir = 'REFUND' THEN IF(d.refund_status = 'REFUNDED', 'DONE', 'PENDING')
               WHEN d.st_status = 'COMPLETED' THEN 'DONE'
               WHEN d.st_status IN ('REJECTED', 'CANCEL') THEN 'FAILED'
               ELSE 'PENDING'
           END AS state,
           CASE d.dir WHEN 'BUY' THEN d.buy_dt WHEN 'SELL' THEN d.sell_dt ELSE IFNULL(d.refund_dt, d.buy_dt) END AS ref_dt
    FROM (
        SELECT r.*,
               CASE
                   WHEN r.refund_status <> 'NONE' OR r.cancellation_status = 'COMPLETED' THEN 'REFUND'
                   WHEN r.t = 'BUY' AND r.advisor_id <> 2 AND r.rm_status = 'COMPLETED' AND r.am_status = 'COMPLETED' THEN 'BUY'
                   WHEN r.t = 'SELL' AND r.rm_status = 'COMPLETED' AND r.mas <> 1 THEN 'SELL'
                   ELSE NULL
               END AS dir
        FROM (${RAW}) r
    ) d
    WHERE d.dir IS NOT NULL`;

/** BUY / SELL totals (DONE + PENDING only) and the refund figures for one window. */
async function summaryFor(start, end, next) {
    const rows = await getData(
        `SELECT x.dir, x.state, COUNT(*) AS c, IFNULL(SUM(x.qty), 0) AS q
         FROM (${LEVEL}) x
         WHERE x.dir IN ('BUY', 'SELL') AND x.state IN ('DONE', 'PENDING')${rangeCond('x.ref_dt', start, end)}
         GROUP BY x.dir, x.state`,
        next
    );
    const side = () => ({ done: { count: 0, shares: 0 }, pending: { count: 0, shares: 0 } });
    const out = { BUY: side(), SELL: side() };
    (rows || []).forEach((r) => {
        const slot = r.state === 'DONE' ? out[r.dir].done : out[r.dir].pending;
        slot.count = num(r.c);
        slot.shares = num(r.q);
    });
    const shape = (s) => ({
        total: s.done.count + s.pending.count,
        shares: s.done.shares + s.pending.shares,
        done: s.done,
        pending: s.pending,
    });

    const ref = await getData(
        `SELECT SUM(rr.status IN ('Pending', 'Accepted', 'Completed')) AS total,
                SUM(rr.status = 'Completed') AS refunded,
                SUM(rr.status IN ('Pending', 'Accepted')) AS pending
         FROM refund_requests rr
         WHERE 1 = 1${rangeCond('rr.requested_datetime', start, end)}`,
        next
    );
    const val = await getData(
        `SELECT IFNULL(SUM(rt.amount), 0) AS v
         FROM refund_transactions rt
         WHERE rt.status = 'REFUNDED'${rangeCond(REFUND_DATE, start, end)}`,
        next
    );
    return {
        buyers: shape(out.BUY),
        sellers: shape(out.SELL),
        refunds: {
            total: num(ref?.[0]?.total),
            refunded: num(ref?.[0]?.refunded),
            pending: num(ref?.[0]?.pending),
            refunded_value: num(val?.[0]?.v),
        },
    };
}

const dashboardController = {
    /* ---------------------------------------------------------------
     * GET /dashboard/st/summary?period=month|year|all
     * The three movement cards, with the change against the previous period.
     * --------------------------------------------------------------- */
    async stSummary(req, res, next) {
        try {
            const st = await requireSt(req, next);
            if (!st) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const cur = await summaryFor(w.start, w.end, next);
            let prev = null;
            if (w.hasPrev) prev = await summaryFor(w.prevStart, w.prevEnd, next);

            return res.json({
                success: true,
                data: {
                    period: w.period,
                    period_label: w.label,
                    previous_label: w.prevLabel,
                    ...cur,
                    change: {
                        buyers_pct: prev ? pctChange(cur.buyers.total, prev.buyers.total) : null,
                        sellers_pct: prev ? pctChange(cur.sellers.total, prev.sellers.total) : null,
                        refunds_pct: prev ? pctChange(cur.refunds.total, prev.refunds.total) : null,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/st/attention
     * Live counts (not limited by the period): what needs action now.
     * CMR verification has no data yet, so it is reported as not available.
     * --------------------------------------------------------------- */
    async stAttention(req, res, next) {
        try {
            const st = await requireSt(req, next);
            if (!st) return;
            const now = istNow();

            const rows = await getData(
                `SELECT
                    IFNULL(SUM(x.dir = 'BUY' AND x.state = 'PENDING' AND x.ref_dt <= DATE_SUB('${now.time}', INTERVAL 3 DAY)), 0) AS over3,
                    IFNULL(SUM(x.dir = 'SELL' AND x.state = 'PENDING'), 0) AS awaiting_seller,
                    IFNULL(SUM(x.dir IN ('BUY', 'SELL') AND x.state = 'FAILED'), 0) AS failed
                 FROM (${LEVEL}) x`,
                next
            );
            const r = rows?.[0] || {};
            return res.json({
                success: true,
                data: {
                    pending_over_3_days: num(r.over3),
                    cmr_pending: { available: false },
                    awaiting_seller: num(r.awaiting_seller),
                    rejected_failed: num(r.failed),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/st/stats?period=
     * Average time to transfer (BUY: AM sent it -> ST completed) and to receive
     * (SELL: RM approved -> ST completed). Returned in hours (1 decimal) and in days (1 decimal),
     * so a transfer done within hours does not show as "0 days".
     * Averages only use orders where both times were recorded and the end is not before the start.
     * The NSDL / CDSL split is not available (see the header comment).
     * --------------------------------------------------------------- */
    async stStats(req, res, next) {
        try {
            const st = await requireSt(req, next);
            if (!st) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const rows = await getData(
                `SELECT
                    AVG(CASE WHEN x.dir = 'BUY' AND x.state = 'DONE' AND x.am_datetime IS NOT NULL AND x.st_datetime IS NOT NULL
                                  AND x.st_datetime >= x.am_datetime
                             THEN TIMESTAMPDIFF(SECOND, x.am_datetime, x.st_datetime) END) AS buy_secs,
                    SUM(x.dir = 'BUY' AND x.state = 'DONE' AND x.am_datetime IS NOT NULL AND x.st_datetime IS NOT NULL
                        AND x.st_datetime >= x.am_datetime) AS buy_n,
                    AVG(CASE WHEN x.dir = 'SELL' AND x.state = 'DONE' AND x.rm_datetime IS NOT NULL AND x.st_datetime IS NOT NULL
                                  AND x.st_datetime >= x.rm_datetime
                             THEN TIMESTAMPDIFF(SECOND, x.rm_datetime, x.st_datetime) END) AS sell_secs,
                    SUM(x.dir = 'SELL' AND x.state = 'DONE' AND x.rm_datetime IS NOT NULL AND x.st_datetime IS NOT NULL
                        AND x.st_datetime >= x.rm_datetime) AS sell_n
                 FROM (${LEVEL}) x
                 WHERE x.dir IN ('BUY', 'SELL') AND x.state IN ('DONE', 'PENDING')${rangeCond('x.ref_dt', w.start, w.end)}`,
                next
            );
            const r = rows?.[0] || {};
            const days = (secs) => (secs === null || secs === undefined ? null : Math.round((Number(secs) / 86400) * 10) / 10);
            const hours = (secs) => (secs === null || secs === undefined ? null : Math.round((Number(secs) / 3600) * 10) / 10);

            return res.json({
                success: true,
                data: {
                    period: w.period,
                    avg_transfer_days: num(r.buy_n) > 0 ? days(r.buy_secs) : null,
                    avg_transfer_hours: num(r.buy_n) > 0 ? hours(r.buy_secs) : null,
                    avg_transfer_samples: num(r.buy_n),
                    avg_receive_days: num(r.sell_n) > 0 ? days(r.sell_secs) : null,
                    avg_receive_hours: num(r.sell_n) > 0 ? hours(r.sell_secs) : null,
                    avg_receive_samples: num(r.sell_n),
                    // not stored in the database and not derivable (see the header comment)
                    depository: { available: false },
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/st/queue?period=&tab=all|buyers|sellers|refunds&search=&page=&per_page=
     * Every open item (any date) plus the completed / failed items of the selected period.
     * Open items first (the longest waiting first), then the newest finished ones.
     * --------------------------------------------------------------- */
    async stQueue(req, res, next) {
        try {
            const st = await requireSt(req, next);
            if (!st) return;
            const { error, value } = Joi.object({
                period: Joi.string().valid('month', 'year', 'all').default('month'),
                tab: Joi.string().valid('all', 'buyers', 'sellers', 'refunds').default('all'),
                search: Joi.string().allow('').max(100).default(''),
                page: Joi.number().integer().min(1).default(1),
                per_page: Joi.number().integer().min(1).max(50).default(8),
            }).validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);
            const now = istNow();

            const dirCond =
                value.tab === 'buyers' ? `x.dir = 'BUY'`
                    : value.tab === 'sellers' ? `x.dir = 'SELL'`
                        : value.tab === 'refunds' ? `x.dir = 'REFUND'`
                            : `x.dir IN ('BUY', 'SELL', 'REFUND')`;

            let searchCond = '';
            // quotes and backslashes are dropped; "%" and "_" are escaped so they match themselves
            // (order ids look like TCPL_123, so "_" must keep working)
            const term = String(value.search || '')
                .replace(/[\\'"]/g, '')
                .replace(/[%_]/g, (m) => `\\${m}`)
                .trim();
            if (term) {
                searchCond = ` AND (x.order_custom_id LIKE '%${term}%' OR x.client_name LIKE '%${term}%' OR x.company_name LIKE '%${term}%')`;
            }
            const where = `${dirCond} AND (x.state = 'PENDING' OR (x.ref_dt IS NOT NULL${rangeCond('x.ref_dt', w.start, w.end)}))${searchCond}`;

            const countRows = await getData(`SELECT COUNT(*) AS c FROM (${LEVEL}) x WHERE ${where}`, next);
            const total = num(countRows?.[0]?.c);
            const perPage = Number(value.per_page);
            const totalPages = Math.max(Math.ceil(total / perPage), 1);
            const page = Math.min(Number(value.page), totalPages);

            const rows = await getData(
                `SELECT x.order_id, x.order_custom_id, x.t, x.dir, x.state, x.qty, x.st_status, x.refund_status,
                        x.client_name, x.company_name,
                        DATE_FORMAT(x.ref_dt, '%Y-%m-%d %H:%i:%s') AS ref_dt_text,
                        DATEDIFF('${now.day}', DATE(x.ref_dt)) AS waiting_days
                 FROM (${LEVEL}) x
                 WHERE ${where}
                 ORDER BY (x.state = 'PENDING') DESC,
                          CASE WHEN x.state = 'PENDING' THEN x.ref_dt END ASC,
                          CASE WHEN x.state <> 'PENDING' THEN x.ref_dt END DESC,
                          x.order_id DESC
                 LIMIT ${(page - 1) * perPage}, ${perPage}`,
                next
            );

            const statusOf = (r) => {
                if (r.dir === 'REFUND') {
                    if (r.refund_status === 'REFUNDED') return { label: 'Refunded', tone: 'refund-done' };
                    if (r.refund_status === 'PARTIALLY_REFUNDED') return { label: 'Partly refunded', tone: 'refund' };
                    if (r.refund_status === 'ACCEPTED') return { label: 'Refund accepted', tone: 'refund' };
                    return { label: 'Refund requested', tone: 'refund' };
                }
                if (r.state === 'DONE') return { label: r.dir === 'BUY' ? 'Credited' : 'Received', tone: 'done' };
                if (r.state === 'FAILED') return { label: 'Rejected / failed', tone: 'failed' };
                if (r.st_status === 'HOLD') return { label: 'On hold', tone: 'hold' };
                return { label: r.dir === 'BUY' ? 'Transfer pending' : 'Awaiting seller', tone: 'pending' };
            };

            return res.json({
                success: true,
                data: {
                    tab: value.tab,
                    period: w.period,
                    page,
                    per_page: perPage,
                    total,
                    total_pages: totalPages,
                    rows: (rows || []).map((r) => {
                        const status = statusOf(r);
                        return {
                            order_id: r.order_id,
                            order_custom_id: r.order_custom_id,
                            order_type: r.t,
                            direction: r.dir === 'BUY' ? 'To buyer' : r.dir === 'SELL' ? 'From seller' : 'Refund',
                            client_name: r.client_name || '-',
                            company_name: r.company_name || '-',
                            quantity: num(r.qty),
                            depository: null, // not stored in the database (shown as "-")
                            // days since the order entered the queue; only meaningful while it is open
                            waiting_days: r.state === 'PENDING' ? Math.max(num(r.waiting_days), 0) : null,
                            status: status.label,
                            status_tone: status.tone,
                            entry_date: r.ref_dt_text || null,
                        };
                    }),
                },
            });
        } catch (error) {
            next(error);
        }
    },
};

export default dashboardController;
