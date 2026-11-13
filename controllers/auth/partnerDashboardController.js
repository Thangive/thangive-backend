import Joi from 'joi';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';
import { commissionPerShare, commissionDeductions } from '../../helper/commissionHelper.js';

/*
 * Partner Dashboard APIs (all under /dashboard/partner/*, token + PARTNER role required).
 *
 * The caller must be a PARTNER (users.user_type of the token user, never the request) and every query is
 * limited to that partner's own id (taken from the database user, no id is accepted from the request), so one
 * partner can never read another partner's data. Read-only: nothing is written.
 *
 * Reused business rules (nothing new is invented):
 *  - Total Prospects   same as POST /CountPartnerLeadAndProspects: partner_prospects of the partner with
 *                      lead_type = 'Prospects' and is_deleted = 0.
 *  - Converted Leads   same as that API: orders of the partner whose RM, AM and ST stages are all COMPLETED.
 *  - Commission        the commission formula of the partner commission list (helper/commissionHelper.js, a port
 *                      of the frontend calculateCommissionPerShare), gross (before TDS and GST), per share rounded
 *                      to 2 decimals, times the order quantity. Eligible orders are the ones the commission list
 *                      shows: all three stages COMPLETED, not mark-as-sold, not cancelled through the refund flow,
 *                      and not a BUY with advisor_id 2 (those never get an invoice).
 *  - Paid / pending    an order is paid when it has a partner_commission row (the lowest commission_id is used, so
 *                      old duplicate rows are never double counted), pending when it has none.
 *  - Payout amount     the amount actually payable: gross commission less TDS and GST using the percentages stored
 *                      on the partner_commission row (the arithmetic of the commission payment modal).
 *
 * Dates (all IST): an order is "earned" on its ST completion time (st_datetime, fallback created_at converted to
 * IST); business and the orders table use the order creation time; prospects use lead_creation_date (fallback
 * created_at). The monthly chart ignores the period (it is the last six months). Payout history ignores the
 * period (it is the latest payouts).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_MONTHS = 6;

/* ---------------- helpers ---------------- */
const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const monthStr = (y, m0) => `${y}-${pad(m0 + 1)}-01 00:00:00`;
const IST = (col) => `CONVERT_TZ(${col}, '+00:00', '+05:30')`;
const NAME = (a) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.middle_name, ${a}.last_name)), ''), ${a}.username)`;
const rangeCond = (expr, start, end) =>
    (start ? ` AND ${expr} >= '${start}'` : '') + (end ? ` AND ${expr} < '${end}'` : '');

function periodWindow(period) {
    const d = new Date(Date.now() + IST_OFFSET_MS);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (period === 'all') return { period, label: 'All Time', start: null, end: null };
    if (period === 'year') return { period, label: String(y), start: `${y}-01-01 00:00:00`, end: `${y + 1}-01-01 00:00:00` };
    const nextY = m === 11 ? y + 1 : y;
    return { period: 'month', label: `${MONTH_NAMES[m]} ${y}`, start: monthStr(y, m), end: monthStr(nextY, (m + 1) % 12) };
}

const periodSchema = Joi.object({ period: Joi.string().valid('month', 'year', 'all').default('month') });

/** PARTNER only. The role and the partner id come from users, not from the token payload or the request. */
async function requirePartner(req, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || actor.user_type !== 'PARTNER') {
        next(new CustomErrorHandler(403, 'Only a partner can open the Partner dashboard'));
        return null;
    }
    return actor;
}

/** 2611…3305 style mask for a bank reference / UTR. */
function maskRef(ref) {
    const s = String(ref ?? '').trim();
    if (!s) return null;
    if (s.length > 8) return `${s.slice(0, 4)}…${s.slice(-4)}`;
    if (s.length > 4) return `…${s.slice(-4)}`;
    return '••••';
}

/* ---------------- shared SQL ---------------- */
const COMPLETED_ALL = `ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED'`;
const COMM_ELIGIBLE = `${COMPLETED_ALL}
    AND IFNULL(ot.markAsSold, 0) <> 1
    AND ot.cancellation_status <> 'COMPLETED'
    AND NOT (ot.transaction_type = 'BUY' AND ot.advisor_id = 2)`;
const NOT_CLOSED = `ot.rm_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.am_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.st_status NOT IN ('REJECTED', 'CANCEL')
    AND ot.cancellation_status <> 'COMPLETED'`;
const VALUE = `(ot.price_per_share * ot.quantity)`;
const DONE_DT = `IFNULL(ot.st_datetime, ${IST('ot.created_at')})`;
const CREATED_IST = IST('ot.created_at');
const COMM_ROW = `
    LEFT JOIN (SELECT order_id, MIN(commission_id) AS cid FROM partner_commission GROUP BY order_id) pcm ON pcm.order_id = ot.order_id
    LEFT JOIN partner_commission pc ON pc.commission_id = pcm.cid`;

/** Gross commission of one order (the existing formula x quantity). */
const grossCommission = (r) =>
    round2(commissionPerShare(r.pp, r.pps, r.t) * num(r.qty));

/* partner_commission.payment_date exists only after migration 007; detect it once. */
let hasPaymentDate = null;
async function paymentDateExists(next) {
    if (hasPaymentDate !== null) return hasPaymentDate;
    const rows = await getData(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'partner_commission' AND column_name = 'payment_date'`,
        next
    );
    hasPaymentDate = num(rows?.[0]?.c) > 0;
    return hasPaymentDate;
}

/** Stage of an order as the partner sees it. */
function stageOf(r) {
    if (r.rm_status === 'REJECTED' || r.am_status === 'REJECTED' || r.st_status === 'REJECTED') return { label: 'Rejected', tone: 'closed' };
    if (r.rm_status === 'CANCEL' || r.am_status === 'CANCEL' || r.st_status === 'CANCEL' || r.cancellation_status === 'COMPLETED') return { label: 'Cancelled', tone: 'closed' };
    if (r.rm_status === 'COMPLETED' && r.am_status === 'COMPLETED' && r.st_status === 'COMPLETED') return { label: 'Completed', tone: 'done' };
    if (r.rm_status !== 'COMPLETED') return { label: 'Pending approval', tone: 'pending' };
    if (r.t === 'BUY') {
        return r.am_status !== 'COMPLETED' ? { label: 'Payment pending', tone: 'payment' } : { label: 'Share transfer', tone: 'share' };
    }
    return r.st_status !== 'COMPLETED' ? { label: 'Share debit', tone: 'share' } : { label: 'Payment pending', tone: 'payment' };
}

const dashboardController = {
    /* ---------------------------------------------------------------
     * GET /dashboard/partner/summary?period=month|year|all
     * Prospects, converted leads, business brought, commission earned and the payout split.
     * --------------------------------------------------------------- */
    async partnerSummary(req, res, next) {
        try {
            const partner = await requirePartner(req, next);
            if (!partner) return;
            const { error, value } = periodSchema.validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);
            const P = Number(partner.user_id);

            const prospects = await getData(
                `SELECT COUNT(*) AS c FROM partner_prospects
                 WHERE user_id = ${P} AND lead_type = 'Prospects' AND is_deleted = 0`,
                next
            );
            const converted = await getData(
                `SELECT COUNT(*) AS c FROM order_transactions ot
                 WHERE ot.addedPartnerID = ${P} AND ${COMPLETED_ALL}${rangeCond(DONE_DT, w.start, w.end)}`,
                next
            );
            const business = await getData(
                `SELECT ot.transaction_type AS t, COUNT(*) AS c, IFNULL(SUM(${VALUE}), 0) AS v
                 FROM order_transactions ot
                 WHERE ot.addedPartnerID = ${P} AND ${NOT_CLOSED}${rangeCond(CREATED_IST, w.start, w.end)}
                 GROUP BY ot.transaction_type`,
                next
            );
            const orders = await getData(
                `SELECT ot.order_id, ot.transaction_type AS t, ot.quantity AS qty, ot.price_per_share AS pps, ot.partner_price AS pp,
                        ${VALUE} AS val, pc.commission_id AS cid
                 FROM order_transactions ot ${COMM_ROW}
                 WHERE ot.addedPartnerID = ${P} AND ${COMM_ELIGIBLE}${rangeCond(DONE_DT, w.start, w.end)}`,
                next
            );

            let earned = 0, paid = 0, valueSum = 0;
            (orders || []).forEach((r) => {
                const c = grossCommission(r);
                earned += c;
                valueSum += num(r.val);
                if (r.cid) paid += c;
            });
            const biz = { BUY: { c: 0, v: 0 }, SELL: { c: 0, v: 0 } };
            (business || []).forEach((r) => { if (biz[r.t]) biz[r.t] = { c: num(r.c), v: round2(r.v) }; });

            return res.json({
                success: true,
                data: {
                    period: w.period,
                    period_label: w.label,
                    prospects: num(prospects?.[0]?.c),
                    converted_leads: num(converted?.[0]?.c),
                    business: {
                        buy: biz.BUY.v,
                        sell: biz.SELL.v,
                        total: round2(biz.BUY.v + biz.SELL.v),
                        buy_orders: biz.BUY.c,
                        sell_orders: biz.SELL.c,
                    },
                    commission: {
                        earned: round2(earned),
                        orders: (orders || []).length,
                        paid: round2(paid),
                        pending: round2(earned - paid),
                        paid_orders: (orders || []).filter((r) => r.cid).length,
                        // average commission as a percentage of the value of the orders it was earned on
                        rate_pct: valueSum > 0 ? round2((earned / valueSum) * 100) : null,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/partner/monthly-commission
     * Last 6 IST calendar months of gross commission, buy and sell separately (by completion month).
     * --------------------------------------------------------------- */
    async partnerMonthlyCommission(req, res, next) {
        try {
            const partner = await requirePartner(req, next);
            if (!partner) return;
            const P = Number(partner.user_id);

            const now = new Date(Date.now() + IST_OFFSET_MS);
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth();
            const months = [];
            for (let i = CHART_MONTHS - 1; i >= 0; i--) {
                const d = new Date(Date.UTC(y, m - i, 1));
                months.push({ key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`, label: MONTH_SHORT[d.getUTCMonth()], buy: 0, sell: 0, orders: 0 });
            }
            const nextY = m === 11 ? y + 1 : y;
            const rows = await getData(
                `SELECT DATE_FORMAT(${DONE_DT}, '%Y-%m') AS ym, ot.transaction_type AS t, ot.quantity AS qty,
                        ot.price_per_share AS pps, ot.partner_price AS pp
                 FROM order_transactions ot
                 WHERE ot.addedPartnerID = ${P} AND ${COMM_ELIGIBLE}${rangeCond(DONE_DT, `${months[0].key}-01 00:00:00`, monthStr(nextY, (m + 1) % 12))}`,
                next
            );
            const byKey = Object.fromEntries(months.map((x) => [x.key, x]));
            (rows || []).forEach((r) => {
                const slot = byKey[r.ym];
                if (!slot) return;
                const c = grossCommission(r);
                if (r.t === 'BUY') slot.buy += c; else slot.sell += c;
                slot.orders += 1;
            });
            months.forEach((x) => { x.buy = round2(x.buy); x.sell = round2(x.sell); x.total = round2(x.buy + x.sell); });
            return res.json({ success: true, data: { current_key: months[months.length - 1].key, months } });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/partner/orders?period=&tab=all|buy|sell&search=&page=&per_page=
     * The partner's own orders (any stage) created in the period, newest first, with the commission of each.
     *   Payout status: Paid (commission row exists), Pending payout (completed, no row yet),
     *   Not yet earned (order not completed), "-" (rejected / cancelled, or no commission applies).
     * --------------------------------------------------------------- */
    async partnerOrders(req, res, next) {
        try {
            const partner = await requirePartner(req, next);
            if (!partner) return;
            const { error, value } = Joi.object({
                period: Joi.string().valid('month', 'year', 'all').default('month'),
                tab: Joi.string().valid('all', 'buy', 'sell').default('all'),
                search: Joi.string().allow('').max(100).default(''),
                page: Joi.number().integer().min(1).default(1),
                per_page: Joi.number().integer().min(1).max(50).default(6),
            }).validate(req.query);
            if (error) return next(error);
            const w = periodWindow(value.period);
            const P = Number(partner.user_id);

            const tabCond = value.tab === 'buy' ? ` AND ot.transaction_type = 'BUY'` : value.tab === 'sell' ? ` AND ot.transaction_type = 'SELL'` : '';
            // quotes and backslashes are dropped; "%" and "_" are escaped so they match themselves (ids look like TCPL_12)
            const term = String(value.search || '').replace(/[\\'"]/g, '').replace(/[%_]/g, (c) => `\\${c}`).trim();
            const searchCond = term
                ? ` AND (ot.order_custom_id LIKE '%${term}%' OR ${NAME('u')} LIKE '%${term}%' OR sd.company_name LIKE '%${term}%')`
                : '';
            const where = `ot.addedPartnerID = ${P}${tabCond}${rangeCond(CREATED_IST, w.start, w.end)}${searchCond}`;
            const from = `FROM order_transactions ot
                JOIN users u ON u.user_id = ot.user_id
                JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id
                ${COMM_ROW}`;

            const count = await getData(`SELECT COUNT(*) AS c ${from} WHERE ${where}`, next);
            const total = num(count?.[0]?.c);
            const perPage = Number(value.per_page);
            const totalPages = Math.max(Math.ceil(total / perPage), 1);
            const page = Math.min(Number(value.page), totalPages);

            const rows = await getData(
                `SELECT ot.order_id, ot.order_custom_id, ot.transaction_type AS t, ot.quantity AS qty,
                        ot.price_per_share AS pps, ot.partner_price AS pp, ${VALUE} AS val,
                        ot.rm_status, ot.am_status, ot.st_status, ot.cancellation_status,
                        IFNULL(ot.markAsSold, 0) AS mas, ot.advisor_id,
                        ${NAME('u')} AS client_name, sd.company_name, pc.commission_id AS cid
                 ${from}
                 WHERE ${where}
                 ORDER BY ot.order_id DESC
                 LIMIT ${(page - 1) * perPage}, ${perPage}`,
                next
            );

            const mapped = (rows || []).map((r) => {
                const stage = stageOf(r);
                const closed = stage.tone === 'closed';
                const completed = stage.tone === 'done';
                const eligible = completed && num(r.mas) !== 1 && !(r.t === 'BUY' && num(r.advisor_id) === 2);
                let payout = { label: '-', tone: 'none' };
                if (!closed) {
                    if (!completed) payout = { label: 'Not yet earned', tone: 'notyet' };
                    else if (!eligible) payout = { label: '-', tone: 'none' };
                    else payout = r.cid ? { label: 'Paid', tone: 'paid' } : { label: 'Pending payout', tone: 'pending' };
                }
                return {
                    order_id: r.order_id,
                    order_custom_id: r.order_custom_id,
                    order_type: r.t,
                    client_name: r.client_name || '-',
                    company_name: r.company_name || '-',
                    order_value: round2(r.val),
                    status: stage.label,
                    status_tone: stage.tone,
                    // shown for every open or completed order (an estimate until the order is completed)
                    commission: closed ? null : grossCommission(r),
                    payout_status: payout.label,
                    payout_tone: payout.tone,
                };
            });

            return res.json({
                success: true,
                data: { tab: value.tab, period: w.period, page, per_page: perPage, total, total_pages: totalPages, rows: mapped },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/partner/payouts?limit=5
     * The latest commission payments made to this partner (one per order), newest first.
     * Amount = what was actually payable (gross less TDS and GST). The reference is masked.
     * --------------------------------------------------------------- */
    async partnerPayouts(req, res, next) {
        try {
            const partner = await requirePartner(req, next);
            if (!partner) return;
            const { error, value } = Joi.object({ limit: Joi.number().integer().min(1).max(20).default(5) }).validate(req.query);
            if (error) return next(error);
            const P = Number(partner.user_id);
            const withDate = await paymentDateExists(next);
            const paidDt = withDate ? `IFNULL(pc.payment_date, DATE(${IST('pc.created_at')}))` : `DATE(${IST('pc.created_at')})`;

            const base = `FROM partner_commission pc
                JOIN (SELECT order_id, MIN(commission_id) AS cid FROM partner_commission GROUP BY order_id) f ON f.cid = pc.commission_id
                JOIN order_transactions ot ON ot.order_id = pc.order_id
                WHERE ot.addedPartnerID = ${P}`;
            const count = await getData(`SELECT COUNT(*) AS c ${base}`, next);
            const rows = await getData(
                `SELECT pc.commission_id, pc.inv_number, pc.payment_id AS ref, pc.tds, pc.gst,
                        DATE_FORMAT(${paidDt}, '%Y-%m-%d') AS paid_on,
                        DATE_FORMAT(${DONE_DT}, '%Y-%m') AS for_ym,
                        ot.transaction_type AS t, ot.quantity AS qty, ot.price_per_share AS pps, ot.partner_price AS pp
                 ${base}
                 ORDER BY ${paidDt} DESC, pc.commission_id DESC
                 LIMIT ${Number(value.limit)}`,
                next
            );

            return res.json({
                success: true,
                data: {
                    total: num(count?.[0]?.c),
                    rows: (rows || []).map((r) => {
                        const [yy, mm] = String(r.for_ym || '').split('-');
                        return {
                            commission_id: r.commission_id,
                            paid_on: r.paid_on,
                            for_period: mm ? `${MONTH_NAMES[Number(mm) - 1]} ${yy}` : '-',
                            invoice: r.inv_number || null,
                            amount: commissionDeductions(grossCommission(r), r.tds, r.gst).payable_amount,
                            reference: maskRef(r.ref),
                        };
                    }),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
     * GET /dashboard/partner/dealer-prices?limit=6
     * The most recently priced stocks with their dealer price (stock_price.partner_price of the latest price
     * row) and the change against the previous price row of the same stock. The change is null when there is
     * no earlier dealer price.
     * --------------------------------------------------------------- */
    async partnerDealerPrices(req, res, next) {
        try {
            const partner = await requirePartner(req, next);
            if (!partner) return;
            const { error, value } = Joi.object({ limit: Joi.number().integer().min(1).max(20).default(6) }).validate(req.query);
            if (error) return next(error);

            const rows = await getData(
                `SELECT s.stock_details_id, s.company_name, sp.partner_price AS dp,
                        (SELECT sp2.partner_price FROM stock_price sp2
                          WHERE sp2.stock_details_id = s.stock_details_id AND sp2.stock_price_id < sp.stock_price_id
                          ORDER BY sp2.stock_price_id DESC LIMIT 1) AS prev_dp
                 FROM stock_details s
                 JOIN stock_price sp ON sp.stock_price_id = (
                        SELECT MAX(sp3.stock_price_id) FROM stock_price sp3 WHERE sp3.stock_details_id = s.stock_details_id)
                 WHERE s.stock_type <> 'LISTED' AND s.is_deleted = 0 AND sp.partner_price > 0
                 ORDER BY sp.stock_price_id DESC
                 LIMIT ${Number(value.limit)}`,
                next
            );

            return res.json({
                success: true,
                data: {
                    rows: (rows || []).map((r) => {
                        const prev = num(r.prev_dp);
                        const pct = prev > 0 ? round2(((num(r.dp) - prev) / prev) * 100) : null;
                        return {
                            stock_details_id: r.stock_details_id,
                            company_name: r.company_name,
                            dealer_price: round2(r.dp),
                            change_pct: pct,
                            tone: pct === null || pct === 0 ? 'flat' : pct > 0 ? 'up' : 'down',
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
