import Joi from 'joi';
import XLSX from 'xlsx';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';

/*
 * AM Accounts Dashboard APIs (all under /dashboard/accounts/*, token + AM role required).
 *
 * The AM role is read from users.user_type of the token user (never from the request).
 * Nothing here writes data and no existing payment / refund / commission workflow is touched.
 *
 * Definitions (agreed with the project owner):
 *  BUY transactions   payment_transactions rows of BUY orders.
 *                       Verified = am_status RECEVIED, Pending verification = am_status PENDING.
 *                       NOT_RECEIVED rows are excluded from every total, count, chart and list.
 *  SELL transactions  payment_transactions rows of SELL orders (the AM payout).
 *                       Paid out = am_status RECEVIED, Pending payout = am_status PENDING.
 *  Refunds            Processed = refund_transactions with status REFUNDED.
 *                       Pending = refund_requests with status Pending / Accepted, valued at
 *                       (AM-received payments - already refunded) of the order.
 *  Partner payouts    Commission of completed partner orders, using the SAME formula as the
 *                       frontend utils/stockCalculations.calculateCommissionPerShare (ported below,
 *                       gross, before TDS and GST). Paid = the order has a partner_commission row,
 *                       Pending = it has none. Eligible orders are the ones the partner commission
 *                       list shows: all three stages COMPLETED, not mark-as-sold, not cancelled through
 *                       the refund flow, and not a BUY with advisor_id 2 (those never get an invoice).
 *
 * Transaction date used for the period filter (all values are IST local time):
 *  BUY     payment_transactions.rm_Datetime  (fallback created_at converted to IST)
 *  SELL    payment_transactions.am_Datetime  (fallback created_at converted to IST)
 *  REFUND  processed: refund_Datetime (fallback created_at);  pending: refund_requests.requested_datetime
 *  PARTNER paid: partner_commission.payment_date (fallback created_at);  pending: order st_datetime
 *
 * Mode: no reliable payment-mode data exists (payment_mode is never written, so it always holds the
 * column default), therefore the mode is returned as null and shown as "-".
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_MONTHS = 6;
const EXPORT_ROW_CAP = 50000;

/* ---------------- small helpers ---------------- */
const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const monthStr = (y, m0) => `${y}-${pad(m0 + 1)}-01 00:00:00`;

const IST = (col) => `CONVERT_TZ(${col}, '+00:00', '+05:30')`;
const FMT = (expr) => `DATE_FORMAT(${expr}, '%Y-%m-%d %H:%i:%s')`;
const NAME = (a) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.middle_name, ${a}.last_name)), ''), ${a}.username)`;
const rangeCond = (expr, start, end) =>
    (start ? ` AND ${expr} >= '${start}'` : '') + (end ? ` AND ${expr} < '${end}'` : '');

/* ---------------- shared SQL ---------------- */
const PAY_FROM = `FROM payment_transactions pt
    JOIN order_transactions ot ON ot.order_id = pt.order_id
    JOIN users u ON u.user_id = ot.user_id`;
// Same exclusion as GET /paymentDetails (cancelled / rejected orders) and NOT_RECEIVED is left out.
const PAY_COND = `ot.rm_status NOT IN ('CANCEL', 'REJECTED') AND pt.am_status IN ('RECEVIED', 'PENDING')`;
const BUY_DATE = `IFNULL(pt.rm_Datetime, ${IST('pt.created_at')})`;
const SELL_DATE = `IFNULL(pt.am_Datetime, ${IST('pt.created_at')})`;
const REFUND_DATE = `IFNULL(rt.refund_Datetime, ${IST('rt.created_at')})`;

const RECEIVED_SUB = `(SELECT IFNULL(SUM(pt2.amount), 0) FROM payment_transactions pt2
        WHERE pt2.order_id = rr.order_id AND pt2.am_status = 'RECEVIED')`;
const REFUNDED_SUB = `(SELECT IFNULL(SUM(rt2.amount), 0) FROM refund_transactions rt2
        WHERE rt2.order_id = rr.order_id AND rt2.status = 'REFUNDED')`;

/** Pending refund requests (one row per request, no joins that can multiply rows). */
const pendingRefundBase = (start, end) => `
    SELECT rr.refund_request_id, rr.order_id, ot.order_custom_id, ${NAME('u')} AS client_name,
           rr.request_reason, rr.status, rr.requested_datetime AS req_dt,
           GREATEST(${RECEIVED_SUB} - ${REFUNDED_SUB}, 0) AS amount
    FROM refund_requests rr
    JOIN order_transactions ot ON ot.order_id = rr.order_id
    JOIN users u ON u.user_id = ot.user_id
    WHERE rr.status IN ('Pending', 'Accepted')${rangeCond('rr.requested_datetime', start, end)}`;

/* ---------------- period windows (IST) ---------------- */
function periodWindow(period) {
    const now = new Date(Date.now() + IST_OFFSET_MS);
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();

    if (period === 'all') {
        return { period, label: 'All Time', start: null, end: null, prevStart: null, prevEnd: null, hasPrev: false, prevLabel: null, year: y, month0: m };
    }
    if (period === 'year') {
        return {
            period, label: String(y), prevLabel: String(y - 1), hasPrev: true, year: y, month0: m,
            start: `${y}-01-01 00:00:00`, end: `${y + 1}-01-01 00:00:00`,
            prevStart: `${y - 1}-01-01 00:00:00`, prevEnd: `${y}-01-01 00:00:00`,
        };
    }
    const nextY = m === 11 ? y + 1 : y;
    const nextM = (m + 1) % 12;
    const prevY = m === 0 ? y - 1 : y;
    const prevM = (m + 11) % 12;
    return {
        period: 'month', label: `${MONTH_NAMES[m]} ${y}`, prevLabel: `${MONTH_NAMES[prevM]} ${prevY}`, hasPrev: true, year: y, month0: m,
        start: monthStr(y, m), end: monthStr(nextY, nextM),
        prevStart: monthStr(prevY, prevM), prevEnd: monthStr(y, m),
    };
}

const inRange = (dateStr, start, end) => {
    if (!dateStr) return false;
    if (start && dateStr < start) return false;
    if (end && dateStr >= end) return false;
    return true;
};

/** Percentage change; null when the previous value is zero (cannot be computed safely). */
const pctChange = (cur, prev) => {
    if (prev === null || prev === undefined || !Number(prev)) return null;
    return Math.round(((Number(cur) - Number(prev)) / Math.abs(Number(prev))) * 1000) / 10;
};

/** 2611…4471 style mask for a bank reference / UTR. */
function maskRef(ref) {
    const s = String(ref ?? '').trim();
    if (!s) return null;
    if (s.length > 8) return `${s.slice(0, 4)}…${s.slice(-4)}`;
    if (s.length > 4) return `…${s.slice(-4)}`;
    return '••••';
}

/** AM only. The role is read from users.user_type, not from the token or the request. */
async function requireAm(req, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || actor.user_type !== 'AM') {
        next(new CustomErrorHandler(403, 'Only an AM can open the Accounts dashboard'));
        return null;
    }
    return actor;
}

const periodSchema = Joi.object({ period: Joi.string().valid('month', 'year', 'all').default('month') });

/* ---------------- commission (port of frontend utils/stockCalculations.calculateCommissionPerShare) ---------------- */
function commissionPerShare(partnerPrice, stockPrice, transactionType) {
    partnerPrice = Number(partnerPrice);
    stockPrice = Number(stockPrice);

    // Gross Profit 1
    const baseCommission = (partnerPrice * 4) / 100;
    let result;

    if (transactionType === 'BUY') {
        // Buyer P - DP
        const difference = stockPrice - partnerPrice;
        if (difference >= baseCommission) {
            const GP = difference - baseCommission;
            const ExtraProfit = (GP * 70) / 100;
            result = ExtraProfit + baseCommission;
        } else {
            result = difference;
        }
    } else if (transactionType === 'SELL') {
        // Buyer DP - SP
        const difference = partnerPrice - stockPrice;
        if (difference >= baseCommission) {
            const GP = difference - baseCommission;
            const ExtraProfit = (GP * 70) / 100;
            result = ExtraProfit + baseCommission;
        } else {
            result = difference;
        }
    }
    const rounded = Number(Number(result).toFixed(2)); // the frontend rounds to 2 decimals the same way
    return Number.isFinite(rounded) ? rounded : 0;
}

/* partner_commission.payment_date exists only after migration 007; detect it once instead of requiring it. */
let paymentDateColumn = null;
async function hasPaymentDateColumn(next) {
    if (paymentDateColumn !== null) return paymentDateColumn;
    const rows = await getData(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'partner_commission' AND column_name = 'payment_date'`,
        next
    );
    paymentDateColumn = num(rows?.[0]?.c) > 0;
    return paymentDateColumn;
}

/**
 * Every eligible partner order once (the commission row is picked with MIN(commission_id), so old
 * duplicate commission rows can never double count), with its commission worked out in JS.
 */
async function loadPartnerRows(next) {
    const withPaymentDate = await hasPaymentDateColumn(next);
    const paidDate = withPaymentDate
        ? `IFNULL(DATE_FORMAT(pc.payment_date, '%Y-%m-%d 00:00:00'), ${FMT(IST('pc.created_at'))})`
        : FMT(IST('pc.created_at'));

    const rows = await getData(
        `SELECT ot.order_id, ot.order_custom_id, ot.transaction_type, ot.quantity, ot.price_per_share, ot.partner_price,
                ot.addedPartnerID AS partner_id,
                ${NAME('p')} AS partner_name,
                (ot.price_per_share * ot.quantity) AS business,
                ${FMT(`IFNULL(ot.st_datetime, ${IST('ot.created_at')})`)} AS done_date,
                pc.commission_id, pc.payment_id AS commission_ref, pc.inv_number,
                CASE WHEN pc.commission_id IS NULL THEN NULL ELSE ${paidDate} END AS paid_date
         FROM order_transactions ot
         JOIN users p ON p.user_id = ot.addedPartnerID
         LEFT JOIN (SELECT order_id, MIN(commission_id) AS cid FROM partner_commission GROUP BY order_id) pcm
                ON pcm.order_id = ot.order_id
         LEFT JOIN partner_commission pc ON pc.commission_id = pcm.cid
         WHERE ot.addedPartnerID IS NOT NULL
           AND ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED'
           AND ot.cancellation_status <> 'COMPLETED'
           AND IFNULL(ot.markAsSold, 0) <> 1
           AND NOT (ot.transaction_type = 'BUY' AND ot.advisor_id = 2)`,
        next
    );

    return (rows || []).map((r) => {
        const perShare = commissionPerShare(r.partner_price, r.price_per_share, r.transaction_type);
        const paid = !!r.commission_id;
        return {
            order_id: r.order_id,
            order_custom_id: r.order_custom_id,
            transaction_type: r.transaction_type,
            partner_id: r.partner_id,
            partner_name: r.partner_name,
            business: num(r.business),
            commission: round2(perShare * Number(r.quantity || 0)),
            paid,
            // paid orders are dated by the commission payment, pending ones by the order completion
            date: paid ? r.paid_date : r.done_date,
            ref: paid ? r.commission_ref : null,
            inv_number: paid ? r.inv_number : null,
        };
    });
}

const partnerInRange = (rows, start, end) => rows.filter((r) => inRange(r.date, start, end));

/* ---------------- aggregates ---------------- */
async function paymentTotals(type, start, end, next) {
    const dateExpr = type === 'BUY' ? BUY_DATE : SELL_DATE;
    const rows = await getData(
        `SELECT pt.am_status AS s, COUNT(*) AS c, IFNULL(SUM(pt.amount), 0) AS a
         ${PAY_FROM}
         WHERE ${PAY_COND} AND ot.transaction_type = '${type}'${rangeCond(dateExpr, start, end)}
         GROUP BY pt.am_status`,
        next
    );
    const out = { done: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 } };
    (rows || []).forEach((r) => {
        const bucket = r.s === 'RECEVIED' ? out.done : out.pending;
        bucket.count += num(r.c);
        bucket.amount += num(r.a);
    });
    return out;
}

async function refundTotals(start, end, next) {
    const processedRows = await getData(
        `SELECT COUNT(*) AS c, IFNULL(SUM(rt.amount), 0) AS a
         FROM refund_transactions rt
         WHERE rt.status = 'REFUNDED'${rangeCond(REFUND_DATE, start, end)}`,
        next
    );
    const pendingRows = await getData(
        `SELECT COUNT(*) AS c, IFNULL(SUM(x.amount), 0) AS a FROM (${pendingRefundBase(start, end)}) x`,
        next
    );
    return {
        processed: { count: num(processedRows?.[0]?.c), amount: num(processedRows?.[0]?.a) },
        pending: { count: num(pendingRows?.[0]?.c), amount: num(pendingRows?.[0]?.a) },
    };
}

function partnerTotals(partnerRows, start, end) {
    const out = { paid: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 } };
    partnerInRange(partnerRows, start, end).forEach((r) => {
        const bucket = r.paid ? out.paid : out.pending;
        bucket.count += 1;
        bucket.amount += r.commission;
    });
    out.paid.amount = round2(out.paid.amount);
    out.pending.amount = round2(out.pending.amount);
    return out;
}

async function buildTotals(start, end, partnerRows, next) {
    const buy = await paymentTotals('BUY', start, end, next);
    const sell = await paymentTotals('SELL', start, end, next);
    const refund = await refundTotals(start, end, next);
    const partner = partnerTotals(partnerRows, start, end);

    const card = (done, pending) => ({
        total_amount: round2(done.amount + pending.amount),
        total_count: done.count + pending.count,
    });
    return {
        buy: { ...card(buy.done, buy.pending), verified: buy.done, pending: buy.pending },
        sell: { ...card(sell.done, sell.pending), paid_out: sell.done, pending: sell.pending },
        refund: { ...card(refund.processed, refund.pending), processed: refund.processed, pending: refund.pending },
        partner: { ...card(partner.paid, partner.pending), paid: partner.paid, pending: partner.pending },
    };
}

/* ---------------- transaction rows (list + export) ---------------- */
async function fetchPaymentRows(kind, w, limit, next) {
    const isBuy = kind === 'buy';
    const dateExpr = isBuy ? BUY_DATE : SELL_DATE;
    const rows = await getData(
        `SELECT pt.payment_custom_id AS txn_id, ot.order_custom_id, ${NAME('u')} AS client,
                pt.amount, pt.transaction_ref AS ref, ${FMT(dateExpr)} AS txn_date, pt.am_status
         ${PAY_FROM}
         WHERE ${PAY_COND} AND ot.transaction_type = '${isBuy ? 'BUY' : 'SELL'}'${rangeCond(dateExpr, w.start, w.end)}
         ORDER BY ${dateExpr} DESC, pt.payment_id DESC${limit ? ` LIMIT ${Number(limit)}` : ''}`,
        next
    );
    return (rows || []).map((r) => {
        const done = r.am_status === 'RECEVIED';
        return {
            txn_id: r.txn_id || null,
            order_id: r.order_custom_id,
            client: r.client || '-',
            type: isBuy ? 'BUY' : 'SELL',
            amount: num(r.amount),
            mode: null,
            ref: r.ref || null,
            date: r.txn_date,
            status: isBuy ? (done ? 'Verified' : 'Pending verification') : (done ? 'Paid' : 'Pending payout'),
            status_key: done ? 'done' : 'pending',
        };
    });
}

async function fetchRefundRows(w, limit, next) {
    const lim = limit ? ` LIMIT ${Number(limit)}` : '';
    const processed = await getData(
        `SELECT rt.refund_custom_id AS txn_id, ot.order_custom_id, ${NAME('u')} AS client, rt.amount,
                rt.transaction_ref AS ref, ${FMT(REFUND_DATE)} AS txn_date
         FROM refund_transactions rt
         JOIN order_transactions ot ON ot.order_id = rt.order_id
         JOIN users u ON u.user_id = ot.user_id
         WHERE rt.status = 'REFUNDED'${rangeCond(REFUND_DATE, w.start, w.end)}
         ORDER BY ${REFUND_DATE} DESC, rt.refund_id DESC${lim}`,
        next
    );
    const pending = await getData(
        `SELECT x.order_custom_id, x.client_name AS client, x.amount, ${FMT('x.req_dt')} AS txn_date
         FROM (${pendingRefundBase(w.start, w.end)}) x
         ORDER BY x.req_dt DESC, x.refund_request_id DESC${lim}`,
        next
    );
    const rows = [
        ...(processed || []).map((r) => ({
            txn_id: r.txn_id || null, order_id: r.order_custom_id, client: r.client || '-', type: 'REFUND',
            amount: num(r.amount), mode: null, ref: r.ref || null, date: r.txn_date,
            status: 'Processed', status_key: 'done',
        })),
        ...(pending || []).map((r) => ({
            txn_id: null, order_id: r.order_custom_id, client: r.client || '-', type: 'REFUND',
            amount: num(r.amount), mode: null, ref: null, date: r.txn_date,
            status: 'Pending refund', status_key: 'pending',
        })),
    ];
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return limit ? rows.slice(0, Number(limit)) : rows;
}

function partnerTxnRows(partnerRows, w) {
    return partnerInRange(partnerRows, w.start, w.end).map((r) => ({
        txn_id: r.inv_number || null,
        order_id: r.order_custom_id,
        client: `${r.partner_name || '-'} (Partner)`,
        type: 'PARTNER',
        amount: r.commission,
        mode: null,
        ref: r.ref || null,
        date: r.date,
        status: r.paid ? 'Paid' : 'Pending payout',
        status_key: r.paid ? 'done' : 'pending',
    }));
}

const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

const accountsDashboardController = {
    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/summary?period=month|year|all
     * The four cards, with the comparison against the previous period.
     * --------------------------------------------------------------- */
    async accountsSummary(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const partnerRows = await loadPartnerRows(next);
            const cur = await buildTotals(w.start, w.end, partnerRows, next);
            const prev = w.hasPrev ? await buildTotals(w.prevStart, w.prevEnd, partnerRows, next) : null;

            const withChange = (key) => ({
                ...cur[key],
                previous_amount: prev ? prev[key].total_amount : null,
                change_pct: prev ? pctChange(cur[key].total_amount, prev[key].total_amount) : null,
            });

            return res.json({
                success: true,
                data: {
                    period: w.period,
                    period_label: w.label,
                    previous_label: w.prevLabel,
                    has_comparison: w.hasPrev,
                    buy: withChange('buy'),
                    sell: withChange('sell'),
                    refund: withChange('refund'),
                    partner: withChange('partner'),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/monthly-chart
     * Last 6 calendar months (IST, current month included), amounts in rupees.
     * Not affected by the period filter (the chart is defined as "last six months").
     * --------------------------------------------------------------- */
    async accountsMonthlyChart(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const w = periodWindow('month');

            const months = [];
            for (let i = CHART_MONTHS - 1; i >= 0; i--) {
                const d = new Date(Date.UTC(w.year, w.month0 - i, 1));
                const y = d.getUTCFullYear();
                const m = d.getUTCMonth();
                months.push({ key: `${y}-${pad(m + 1)}`, label: MONTH_SHORT[m], year: y, buy: 0, sell: 0, refund: 0, partner: 0 });
            }
            const byKey = Object.fromEntries(months.map((m) => [m.key, m]));
            const rangeStart = `${months[0].key}-01 00:00:00`;

            const payRows = async (type) => {
                const dateExpr = type === 'BUY' ? BUY_DATE : SELL_DATE;
                return getData(
                    `SELECT DATE_FORMAT(${dateExpr}, '%Y-%m') AS ym, IFNULL(SUM(pt.amount), 0) AS a
                     ${PAY_FROM}
                     WHERE ${PAY_COND} AND ot.transaction_type = '${type}'${rangeCond(dateExpr, rangeStart, w.end)}
                     GROUP BY ym`,
                    next
                );
            };
            (await payRows('BUY') || []).forEach((r) => { if (byKey[r.ym]) byKey[r.ym].buy += num(r.a); });
            (await payRows('SELL') || []).forEach((r) => { if (byKey[r.ym]) byKey[r.ym].sell += num(r.a); });

            const processed = await getData(
                `SELECT DATE_FORMAT(${REFUND_DATE}, '%Y-%m') AS ym, IFNULL(SUM(rt.amount), 0) AS a
                 FROM refund_transactions rt
                 WHERE rt.status = 'REFUNDED'${rangeCond(REFUND_DATE, rangeStart, w.end)}
                 GROUP BY ym`,
                next
            );
            (processed || []).forEach((r) => { if (byKey[r.ym]) byKey[r.ym].refund += num(r.a); });
            const pendingRefunds = await getData(
                `SELECT DATE_FORMAT(x.req_dt, '%Y-%m') AS ym, IFNULL(SUM(x.amount), 0) AS a
                 FROM (${pendingRefundBase(rangeStart, w.end)}) x GROUP BY ym`,
                next
            );
            (pendingRefunds || []).forEach((r) => { if (byKey[r.ym]) byKey[r.ym].refund += num(r.a); });

            const partnerRows = await loadPartnerRows(next);
            partnerInRange(partnerRows, rangeStart, w.end).forEach((r) => {
                const m = byKey[String(r.date).slice(0, 7)];
                if (m) m.partner += r.commission;
            });

            months.forEach((m) => {
                m.buy = round2(m.buy);
                m.sell = round2(m.sell);
                m.refund = round2(m.refund);
                m.partner = round2(m.partner);
            });

            return res.json({ success: true, data: { current_key: months[months.length - 1].key, months } });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/pending-refunds?period=&limit=
     * Pending / accepted refund requests, oldest first.
     * --------------------------------------------------------------- */
    async accountsPendingRefunds(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const { error, value } = periodSchema
                .keys({ limit: Joi.number().integer().min(1).max(50).default(5) })
                .validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const totals = await refundTotals(w.start, w.end, next);
            const rows = await getData(
                `SELECT x.refund_request_id, x.order_custom_id, x.client_name, x.request_reason, x.status, x.amount,
                        ${FMT('x.req_dt')} AS requested_at,
                        GREATEST(DATEDIFF(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), DATE(x.req_dt)), 0) AS days_pending
                 FROM (${pendingRefundBase(w.start, w.end)}) x
                 ORDER BY x.req_dt ASC, x.refund_request_id ASC
                 LIMIT ${Number(value.limit)}`,
                next
            );

            return res.json({
                success: true,
                data: {
                    period_label: w.label,
                    count: totals.pending.count,
                    amount: totals.pending.amount,
                    rows: (rows || []).map((r) => ({
                        refund_request_id: r.refund_request_id,
                        order_id: r.order_custom_id,
                        client_name: r.client_name || '-',
                        reason: r.request_reason || '',
                        amount: num(r.amount),
                        status: r.status,
                        days_pending: num(r.days_pending),
                        requested_at: r.requested_at,
                    })),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/partner-payouts?period=
     * Partner-wise business and commission (commission formula = frontend calculateCommissionPerShare).
     * --------------------------------------------------------------- */
    async accountsPartnerPayouts(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const rows = partnerInRange(await loadPartnerRows(next), w.start, w.end);
            const map = new Map();
            rows.forEach((r) => {
                const p = map.get(r.partner_id) || {
                    partner_id: r.partner_id, partner: r.partner_name || `Partner ${r.partner_id}`,
                    buy_business: 0, sell_business: 0, commission: 0, paid: 0, pending: 0, paid_orders: 0, pending_orders: 0,
                };
                if (r.transaction_type === 'BUY') p.buy_business += r.business;
                else p.sell_business += r.business;
                p.commission += r.commission;
                if (r.paid) { p.paid += r.commission; p.paid_orders += 1; }
                else { p.pending += r.commission; p.pending_orders += 1; }
                map.set(r.partner_id, p);
            });

            const partners = [...map.values()]
                .map((p) => {
                    const business = p.buy_business + p.sell_business;
                    return {
                        partner_id: p.partner_id,
                        partner: p.partner,
                        buy_business: round2(p.buy_business),
                        sell_business: round2(p.sell_business),
                        // effective rate = commission / (buy + sell business); 0 when there is no business
                        rate: business > 0 ? Math.round((p.commission / business) * 10000) / 100 : 0,
                        commission: round2(p.commission),
                        paid: round2(p.paid),
                        pending: round2(p.pending),
                        status: p.pending_orders === 0 ? 'Paid' : p.paid_orders > 0 ? 'Part paid' : 'Pending payout',
                    };
                })
                .sort((a, b) => b.commission - a.commission || a.partner.localeCompare(b.partner));

            const sum = (k) => round2(partners.reduce((s, p) => s + p[k], 0));
            const buyTotal = sum('buy_business');
            const sellTotal = sum('sell_business');
            const commissionTotal = sum('commission');
            const business = buyTotal + sellTotal;

            return res.json({
                success: true,
                data: {
                    period_label: w.label,
                    partners,
                    totals: {
                        buy_business: buyTotal,
                        sell_business: sellTotal,
                        rate: business > 0 ? Math.round((commissionTotal / business) * 10000) / 100 : 0,
                        commission: commissionTotal,
                        paid: sum('paid'),
                        pending: sum('pending'),
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/recent-transactions?period=&type=all|buy|sell|refund|partner&page=&per_page=
     * --------------------------------------------------------------- */
    async accountsRecentTransactions(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const { error, value } = periodSchema
                .keys({
                    type: Joi.string().valid('all', 'buy', 'sell', 'refund', 'partner').default('all'),
                    page: Joi.number().integer().min(1).default(1),
                    per_page: Joi.number().integer().min(1).max(100).default(8),
                })
                .validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const need = value.page * value.per_page; // every type is fetched up to this many rows, then merged
            const partnerRows = await loadPartnerRows(next);
            const wants = (k) => value.type === 'all' || value.type === k;

            let rows = [];
            let total = 0;
            if (wants('buy')) {
                rows = rows.concat(await fetchPaymentRows('buy', w, need, next));
                const t = await paymentTotals('BUY', w.start, w.end, next);
                total += t.done.count + t.pending.count;
            }
            if (wants('sell')) {
                rows = rows.concat(await fetchPaymentRows('sell', w, need, next));
                const t = await paymentTotals('SELL', w.start, w.end, next);
                total += t.done.count + t.pending.count;
            }
            if (wants('refund')) {
                rows = rows.concat(await fetchRefundRows(w, need, next));
                const t = await refundTotals(w.start, w.end, next);
                total += t.processed.count + t.pending.count;
            }
            if (wants('partner')) {
                const p = partnerTxnRows(partnerRows, w);
                rows = rows.concat(p);
                total += p.length;
            }

            rows.sort(byDateDesc);
            const offset = (value.page - 1) * value.per_page;
            const pageRows = rows.slice(offset, offset + value.per_page).map(({ ref, ...r }) => ({
                ...r,
                reference: maskRef(ref),
            }));

            return res.json({
                success: true,
                data: {
                    period_label: w.label,
                    type: value.type,
                    page: value.page,
                    per_page: value.per_page,
                    total,
                    total_pages: Math.max(Math.ceil(total / value.per_page), 1),
                    rows: pageRows,
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/accounts/export?period=
     * Excel (.xlsx) of every transaction in the selected period. The reference is exported in full
     * (the screen only shows it masked); the endpoint is AM-only.
     * --------------------------------------------------------------- */
    async accountsExport(req, res, next) {
        try {
            const am = await requireAm(req, next);
            if (!am) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);

            const partnerRows = await loadPartnerRows(next);
            let rows = [
                ...(await fetchPaymentRows('buy', w, EXPORT_ROW_CAP, next)),
                ...(await fetchPaymentRows('sell', w, EXPORT_ROW_CAP, next)),
                ...(await fetchRefundRows(w, EXPORT_ROW_CAP, next)),
                ...partnerTxnRows(partnerRows, w),
            ];
            rows.sort(byDateDesc);
            rows = rows.slice(0, EXPORT_ROW_CAP);

            const sheetRows = rows.map((r) => ({
                'Transaction ID': r.txn_id || '-',
                'Order ID': r.order_id || '-',
                'Client': r.client,
                'Transaction Type': r.type,
                'Amount': r.amount,
                'Payment Mode': r.mode || '-',
                'UTR / Reference': r.ref || '-',
                'Transaction Date': r.date || '-',
                'Status': r.status,
            }));

            const headers = ['Transaction ID', 'Order ID', 'Client', 'Transaction Type', 'Amount', 'Payment Mode', 'UTR / Reference', 'Transaction Date', 'Status'];
            const ws = XLSX.utils.json_to_sheet(sheetRows, { header: headers });
            ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 20 }, { wch: 20 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="accounts-transactions-${value.period}.xlsx"`);
            return res.send(buffer);
        } catch (error) {
            next(error);
        }
    },
};

export default accountsDashboardController;
