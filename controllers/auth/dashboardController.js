import Joi from 'joi';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';

/*
 * Dashboard APIs (one controller for all dashboards; only the RM dashboard exists so far).
 *
 * Scope of every RM query: orders whose owner RM is the logged-in RM.
 *   owner RM = the client's RM (users.assign_to); if the client has none, the RM of the partner
 *   who placed the order (addedPartnerID -> users.assign_to). One owner per order, so an order is
 *   never counted twice for an RM and never for two RMs.
 * Eligible orders (counted everywhere): not rejected / cancelled in any stage and not cancelled
 *   through the refund flow (cancellation_status <> 'COMPLETED').
 * Order value = price_per_share * quantity (the RM-final values stored on order_transactions).
 * Month windows are calendar months in IST. created_at is a UTC timestamp (converted with
 * CONVERT_TZ like the rest of the backend); st_datetime is entered as IST local time by the app.
 */

const MONTHLY_TARGET = 10000000; // Rs 1 Crore
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- shared SQL pieces ---------------- */
const FROM_ORDERS = `
    FROM order_transactions ot
    JOIN users u ON u.user_id = ot.user_id
    LEFT JOIN users p ON p.user_id = ot.addedPartnerID`;
const OWNER_RM = `COALESCE(NULLIF(u.assign_to, 0), NULLIF(p.assign_to, 0))`;
const ELIGIBLE = `ot.rm_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.am_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.st_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.cancellation_status <> 'COMPLETED'`;
const VALUE = `(ot.price_per_share * ot.quantity)`;
const CREATED_IST = `CONVERT_TZ(ot.created_at, '+00:00', '+05:30')`;

/* Running-order stage of one order (see getRunningOrders for the meaning) */
const BUCKET = `CASE
    WHEN NOT (${ELIGIBLE}) THEN 'CLOSED'
    WHEN ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED' THEN 'DONE'
    WHEN ot.rm_status <> 'COMPLETED' THEN 'PENDING'
    WHEN ot.transaction_type = 'BUY' AND ot.am_status <> 'COMPLETED' THEN
        IF(EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.order_id = ot.order_id), 'PAYMENT_PENDING', 'APPROVED')
    WHEN ot.transaction_type = 'BUY' THEN 'SHARE_TRANSFER'
    WHEN ot.st_status <> 'COMPLETED' THEN 'SHARE_TRANSFER'
    ELSE 'PAYMENT_PENDING'
END`;

/* ---------------- helpers ---------------- */
const num = (v) => Number(v || 0);
const pad = (n) => String(n).padStart(2, '0');

/** Current moment in IST, read with the getUTC* methods. */
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
const monthStartStr = (year, month0) => `${year}-${pad(month0 + 1)}-01 00:00:00`;

/** Calendar-month windows (IST) around "now". */
function monthWindows() {
    const now = istNow();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const nextY = m === 11 ? y + 1 : y;
    const nextM = (m + 1) % 12;
    const prevY = m === 0 ? y - 1 : y;
    const prevM = (m + 11) % 12;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return {
        now,
        year: y,
        month0: m,
        label: `${MONTH_NAMES[m]} ${y}`,
        start: monthStartStr(y, m),
        next: monthStartStr(nextY, nextM),
        prevStart: monthStartStr(prevY, prevM),
        prevLabel: `${MONTH_NAMES[prevM]} ${prevY}`,
        daysInMonth,
        daysRemaining: daysInMonth - now.getUTCDate(),
    };
}

/** Logged-in user must be an RM. The role is read from users.user_type, not from the token or request. */
async function requireRm(req, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || actor.user_type !== 'RM') {
        next(new CustomErrorHandler(403, 'Only an RM can open the RM dashboard'));
        return null;
    }
    return actor;
}

const splitTotals = (row, prefix) => ({
    count: num(row[`${prefix}count`]),
    value: num(row[`${prefix}value`]),
    buy_count: num(row[`${prefix}buy_count`]),
    buy_value: num(row[`${prefix}buy_value`]),
    sell_count: num(row[`${prefix}sell_count`]),
    sell_value: num(row[`${prefix}sell_value`]),
});

/** One query with every order aggregate the overview and the summary cards need. */
async function fetchOrderAggregates(rmId, w, next) {
    const rows = await getData(
        `SELECT
            COUNT(*)                                      AS total_count,
            IFNULL(SUM(x.val), 0)                         AS total_value,
            IFNULL(SUM(x.is_buy), 0)                      AS total_buy_count,
            IFNULL(SUM(x.is_buy * x.val), 0)              AS total_buy_value,
            IFNULL(SUM(1 - x.is_buy), 0)                  AS total_sell_count,
            IFNULL(SUM((1 - x.is_buy) * x.val), 0)        AS total_sell_value,

            IFNULL(SUM(x.in_month), 0)                    AS month_count,
            IFNULL(SUM(x.in_month * x.val), 0)            AS month_value,
            IFNULL(SUM(x.in_month * x.is_buy), 0)         AS month_buy_count,
            IFNULL(SUM(x.in_month * x.is_buy * x.val), 0) AS month_buy_value,
            IFNULL(SUM(x.in_month * (1 - x.is_buy)), 0)   AS month_sell_count,
            IFNULL(SUM(x.in_month * (1 - x.is_buy) * x.val), 0) AS month_sell_value,

            IFNULL(SUM(x.is_partner), 0)                  AS partner_count,
            IFNULL(SUM(x.is_partner * x.is_buy), 0)       AS partner_buy_count,
            IFNULL(SUM(x.is_partner * (1 - x.is_buy)), 0) AS partner_sell_count,
            IFNULL(SUM(1 - x.is_partner), 0)              AS user_count,
            IFNULL(SUM((1 - x.is_partner) * x.is_buy), 0) AS user_buy_count,
            IFNULL(SUM((1 - x.is_partner) * (1 - x.is_buy)), 0) AS user_sell_count,

            IFNULL(SUM(x.completed_month), 0)             AS completed_month
         FROM (
            SELECT
                ${VALUE} AS val,
                (ot.transaction_type = 'BUY') AS is_buy,
                (ot.addedPartnerID IS NOT NULL) AS is_partner,
                (${CREATED_IST} >= '${w.start}' AND ${CREATED_IST} < '${w.next}') AS in_month,
                (ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED'
                    AND IFNULL(ot.st_datetime, ${CREATED_IST}) >= '${w.start}'
                    AND IFNULL(ot.st_datetime, ${CREATED_IST}) < '${w.next}') AS completed_month
            ${FROM_ORDERS}
            WHERE ${OWNER_RM} = ${Number(rmId)} AND ${ELIGIBLE}
         ) x`,
        next
    );
    return rows && rows[0] ? rows[0] : {};
}

const dashboardController = {
    /* ---------------------------------------------------------------
     * GET /dashboard/rm/overview
     * Cards: assigned users, leads converted, total orders (month / total),
     * incentives, and the user / partner order pills.
     * Leads converted and incentives have no data source in the database yet.
     * --------------------------------------------------------------- */
    async rmOverview(req, res, next) {
        try {
            const rm = await requireRm(req, next);
            if (!rm) return;
            const w = monthWindows();

            const usersRows = await getData(
                `SELECT COUNT(*) AS assigned_users
                 FROM users
                 WHERE assign_to = ${Number(rm.user_id)} AND user_type = 'user'
                   AND is_deleted = 0 AND is_verified = 1`,
                next
            );
            const a = await fetchOrderAggregates(rm.user_id, w, next);

            return res.json({
                success: true,
                data: {
                    assigned_users: num(usersRows?.[0]?.assigned_users),
                    leads_converted: { available: false },
                    incentives: { available: false },
                    month_label: w.label,
                    orders: {
                        month: splitTotals(a, 'month_'),
                        total: splitTotals(a, 'total_'),
                    },
                    user_orders: { buy: num(a.user_buy_count), sell: num(a.user_sell_count) },
                    partner_orders: { buy: num(a.partner_buy_count), sell: num(a.partner_sell_count) },
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/rm/contest
     * Monthly contest of the current calendar month + leaderboards (live month and last month, all RMs).
     * --------------------------------------------------------------- */
    async rmContest(req, res, next) {
        try {
            const rm = await requireRm(req, next);
            if (!rm) return;
            const w = monthWindows();

            // Only count COMPLETED orders (all three statuses are COMPLETED).
            // Use completion date (st_datetime, fallback to created_at) for the monthly window.
            const completedCondition = `ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED'`;
            const completionDateIST = `IFNULL(ot.st_datetime, ${CREATED_IST})`;

            const achievedRows = await getData(
                `SELECT IFNULL(SUM(${VALUE}), 0) AS achieved, COUNT(*) AS orders
                 ${FROM_ORDERS}
                 WHERE ${OWNER_RM} = ${Number(rm.user_id)} AND ${ELIGIBLE} AND ${completedCondition}
                   AND ${completionDateIST} >= '${w.start}' AND ${completionDateIST} < '${w.next}'`,
                next
            );
            const achieved = num(achievedRows?.[0]?.achieved);

            // Leaderboards for the live month and last month: every active RM, same attribution rule,
            // ranked by achieved order value (RMs with no orders are listed with 0).
            // Only count COMPLETED orders.
            const perRm = await getData(
                `SELECT ${OWNER_RM} AS rm_id,
                        IFNULL(SUM(CASE WHEN ${completionDateIST} >= '${w.start}' THEN ${VALUE} ELSE 0 END), 0) AS live_value,
                        IFNULL(SUM(CASE WHEN ${completionDateIST} < '${w.start}' THEN ${VALUE} ELSE 0 END), 0) AS prev_value
                 ${FROM_ORDERS}
                 WHERE ${ELIGIBLE} AND ${completedCondition} AND ${OWNER_RM} IS NOT NULL
                   AND ${completionDateIST} >= '${w.prevStart}' AND ${completionDateIST} < '${w.next}'
                 GROUP BY rm_id`,
                next
            );
            const rms = await getData(
                `SELECT user_id, username,
                        TRIM(CONCAT_WS(' ', first_name, middle_name, last_name)) AS full_name
                 FROM users
                 WHERE user_type = 'RM' AND is_deleted = 0 AND is_verified = 1`,
                next
            );
            const valuesByRm = {};
            (perRm || []).forEach((r) => {
                valuesByRm[r.rm_id] = { live: num(r.live_value), prev: num(r.prev_value) };
            });
            const buildBoard = (field) =>
                (rms || [])
                    .map((r) => {
                        const achievedValue = valuesByRm[r.user_id]?.[field] || 0;
                        return {
                            rm_id: Number(r.user_id),
                            name: r.full_name || r.username || `RM ${r.user_id}`,
                            achieved: achievedValue,
                            percentage: Math.round((achievedValue / MONTHLY_TARGET) * 1000) / 10,
                            is_you: Number(r.user_id) === Number(rm.user_id),
                        };
                    })
                    .sort((a, b) => b.achieved - a.achieved || a.name.localeCompare(b.name))
                    .map((r, i) => ({ ...r, rank: i + 1 }));
            const achieversLive = buildBoard('live');
            const achieversPrevious = buildBoard('prev');

            return res.json({
                success: true,
                data: {
                    target: MONTHLY_TARGET,
                    achieved,
                    orders: num(achievedRows?.[0]?.orders),
                    remaining: Math.max(MONTHLY_TARGET - achieved, 0),
                    percentage: Math.round((achieved / MONTHLY_TARGET) * 1000) / 10,
                    qualified: achieved >= MONTHLY_TARGET,
                    month: w.month0 + 1,
                    year: w.year,
                    month_label: w.label,
                    days_remaining: w.daysRemaining,
                    previous_month_label: w.prevLabel,
                    achievers_live: achieversLive,
                    achievers_previous: achieversPrevious,
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/rm/running-orders?type=all|user|partner&limit=6
     * Running = not finished, not rejected / cancelled, not a mark-as-sold order:
     *   PENDING          RM stage not approved yet
     *   APPROVED         RM approved, BUY, no payment entered yet
     *   PAYMENT_PENDING  BUY: payment entered but AM not completed.
     *                    SELL: share debited (ST done), AM payment pending
     *   SHARE_TRANSFER   BUY: AM completed, ST pending.  SELL: RM approved, ST (share debit) pending
     * --------------------------------------------------------------- */
    async rmRunningOrders(req, res, next) {
        try {
            const rm = await requireRm(req, next);
            if (!rm) return;

            const { error, value } = Joi.object({
                type: Joi.string().valid('all', 'user', 'partner').default('all'),
                limit: Joi.number().integer().min(1).max(200).default(6),
            }).validate(req.query);
            if (error) return next(error);

            const typeCond =
                value.type === 'partner'
                    ? ' AND ot.addedPartnerID IS NOT NULL'
                    : value.type === 'user'
                        ? ' AND ot.addedPartnerID IS NULL'
                        : '';

            const inner = `
                SELECT
                    ot.order_id, ot.order_custom_id, ot.transaction_type, ot.quantity,
                    ${VALUE} AS order_value,
                    ot.created_at,
                    (ot.addedPartnerID IS NOT NULL) AS is_partner,
                    TRIM(CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name)) AS client_name,
                    u.username AS client_username,
                    TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS partner_name,
                    sd.company_name,
                    ${BUCKET} AS bucket
                ${FROM_ORDERS}
                JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id
                WHERE ${OWNER_RM} = ${Number(rm.user_id)}
                  AND IFNULL(ot.markAsSold, 0) <> 1${typeCond}`;
            const RUNNING = `('PENDING', 'APPROVED', 'PAYMENT_PENDING', 'SHARE_TRANSFER')`;

            const counts = await getData(
                `SELECT x.bucket, COUNT(*) AS c FROM (${inner}) x
                 WHERE x.bucket IN ${RUNNING} GROUP BY x.bucket`,
                next
            );
            const rows = await getData(
                `SELECT x.* FROM (${inner}) x
                 WHERE x.bucket IN ${RUNNING}
                 ORDER BY x.order_id DESC
                 LIMIT ${Number(value.limit)}`,
                next
            );

            const buckets = { pending: 0, approved: 0, payment_pending: 0, share_transfer: 0 };
            (counts || []).forEach((c) => {
                buckets[String(c.bucket).toLowerCase()] = num(c.c);
            });
            const total = Object.values(buckets).reduce((s, n) => s + n, 0);

            const statusLabel = (r) => {
                if (r.bucket === 'PENDING') return 'Pending';
                if (r.bucket === 'APPROVED') return 'Approved';
                if (r.bucket === 'PAYMENT_PENDING') return 'Payment Pending';
                return r.transaction_type === 'SELL' ? 'Share Debit' : 'Share Transfer';
            };

            return res.json({
                success: true,
                data: {
                    type: value.type,
                    total,
                    buckets,
                    rows: (rows || []).map((r) => ({
                        order_id: r.order_id,
                        order_custom_id: r.order_custom_id,
                        client_name: r.client_name || r.client_username || '-',
                        is_partner: !!num(r.is_partner),
                        partner_name: r.partner_name || null,
                        company_name: r.company_name,
                        transaction_type: r.transaction_type,
                        quantity: num(r.quantity),
                        order_value: num(r.order_value),
                        status: statusLabel(r),
                        bucket: r.bucket,
                        created_at: r.created_at,
                    })),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/rm/orders-summary
     * --------------------------------------------------------------- */
    async rmOrdersSummary(req, res, next) {
        try {
            const rm = await requireRm(req, next);
            if (!rm) return;
            const w = monthWindows();
            const a = await fetchOrderAggregates(rm.user_id, w, next);

            return res.json({
                success: true,
                data: {
                    total_orders: num(a.total_count),
                    user_orders: {
                        total: num(a.user_count),
                        buy: num(a.user_buy_count),
                        sell: num(a.user_sell_count),
                    },
                    partner_orders: {
                        total: num(a.partner_count),
                        buy: num(a.partner_buy_count),
                        sell: num(a.partner_sell_count),
                    },
                    completed_this_month: num(a.completed_month),
                    month_order_value: num(a.month_value),
                    month_label: w.label,
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/rm/month-on-month
     * Last 12 calendar months (current month included), BUY and SELL separately.
     * Quarterly / Buy / Sell views and the summary tiles are derived from this series.
     * --------------------------------------------------------------- */
    async rmMonthOnMonth(req, res, next) {
        try {
            const rm = await requireRm(req, next);
            if (!rm) return;
            const w = monthWindows();

            // the 12 months, oldest first
            const months = [];
            for (let i = 11; i >= 0; i--) {
                const d = new Date(Date.UTC(w.year, w.month0 - i, 1));
                const y = d.getUTCFullYear();
                const m = d.getUTCMonth();
                months.push({
                    key: `${y}-${pad(m + 1)}`,
                    year: y,
                    month: m + 1,
                    label: MONTH_SHORT[m],
                    buy_value: 0,
                    sell_value: 0,
                    buy_count: 0,
                    sell_count: 0,
                });
            }
            const rangeStart = `${months[0].key}-01 00:00:00`;

            const data = await getData(
                `SELECT DATE_FORMAT(${CREATED_IST}, '%Y-%m') AS ym,
                        ot.transaction_type AS t,
                        COUNT(*) AS c,
                        IFNULL(SUM(${VALUE}), 0) AS v
                 ${FROM_ORDERS}
                 WHERE ${OWNER_RM} = ${Number(rm.user_id)} AND ${ELIGIBLE}
                   AND ${CREATED_IST} >= '${rangeStart}' AND ${CREATED_IST} < '${w.next}'
                 GROUP BY ym, t`,
                next
            );

            const byKey = Object.fromEntries(months.map((m) => [m.key, m]));
            (data || []).forEach((r) => {
                const m = byKey[r.ym];
                if (!m) return;
                if (r.t === 'BUY') {
                    m.buy_value = num(r.v);
                    m.buy_count = num(r.c);
                } else {
                    m.sell_value = num(r.v);
                    m.sell_count = num(r.c);
                }
            });
            months.forEach((m) => {
                m.total_value = m.buy_value + m.sell_value;
                m.total_count = m.buy_count + m.sell_count;
            });

            return res.json({ success: true, data: { current_key: months[11].key, months } });
        } catch (error) {
            next(error);
        }
    },
};

export default dashboardController;
