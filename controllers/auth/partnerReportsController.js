import Joi from 'joi';
import XLSX from 'xlsx';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';
import { commissionPerShare, commissionDeductions } from '../../helper/commissionHelper.js';
import { sqlStr, likeStr } from './reportsController.js';

/*
 * Partner Main Reports (Partner dashboard). Six reports, each with
 *   GET /partner-reports/<report>          one page of rows + summary totals for the active filters
 *   GET /partner-reports/<report>/export   every filtered row (cap EXPORT_ROW_CAP): format=xlsx (Excel file)
 *                                          or format=json (rows + summary, used by the frontend PDF)
 * Reports: orders, commissions, payouts, prospects, converted-clients, monthly-summary.
 *
 * Read-only: nothing is written and no existing business rule is changed. It is a separate controller so the
 * RM / AM / ST reports (reportsController) are untouched and still refuse a PARTNER.
 *
 * Access: PARTNER only (users.user_type of the token user, never the request; 403 otherwise). The partner is the
 * logged-in database user; NO partner or user id is accepted from the request (an unknown query key such as
 * partner_id / user_id is a validation error), and every query is limited to
 *   ot.addedPartnerID = <that id>   (orders)   or   partner_prospects.user_id = <that id>   (prospects).
 *
 * Reused rules (nothing invented): commission = helper/commissionHelper.js (port of the frontend formula), gross,
 * before TDS and GST, per share rounded to 2 decimals x quantity; eligible orders = all three stages COMPLETED, not
 * mark-as-sold, not cancelled through the refund flow, not a BUY with advisor_id 2; paid = the order has a
 * partner_commission row (lowest commission_id), pending = none; payable = gross less TDS and GST with the stored
 * percentages. An order is "closed" when a stage is REJECTED / CANCEL or the refund flow completed the cancellation.
 * Dates are IST.
 */

const EXPORT_ROW_CAP = 50000;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const IST = (col) => `CONVERT_TZ(${col}, '+00:00', '+05:30')`;
const FMT = (expr) => `DATE_FORMAT(${expr}, '%Y-%m-%d %H:%i:%s')`;
const NAME = (a) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.middle_name, ${a}.last_name)), ''), ${a}.username)`;

const CLOSED = `(ot.rm_status IN ('REJECTED', 'CANCEL') OR ot.am_status IN ('REJECTED', 'CANCEL')
    OR ot.st_status IN ('REJECTED', 'CANCEL') OR ot.cancellation_status = 'COMPLETED')`;
const ALL_DONE = `(ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED')`;
const ELIGIBLE = `${ALL_DONE} AND ot.cancellation_status <> 'COMPLETED'
    AND IFNULL(ot.markAsSold, 0) <> 1 AND NOT (ot.transaction_type = 'BUY' AND ot.advisor_id = 2)`;
const VALUE = `(ot.price_per_share * ot.quantity)`;
const CREATED_IST = IST('ot.created_at');
const DONE_DT = `IFNULL(ot.st_datetime, ${CREATED_IST})`;

const columnCache = new Map();
async function colExists(table, column, next) {
    const key = `${table}.${column}`;
    if (columnCache.has(key)) return columnCache.get(key);
    const rows = await getData(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ${sqlStr(table)} AND column_name = ${sqlStr(column)}`,
        next
    );
    const exists = num(rows?.[0]?.c) > 0;
    columnCache.set(key, exists);
    return exists;
}

/* ---------------- query validation ---------------- */
const dateStr = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).empty('');
const en = (...vals) => Joi.string().valid(...vals).empty('');

const baseKeys = {
    page: Joi.number().integer().min(1).default(1),
    per_page: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().max(100).empty(''),
    from_date: dateStr,
    to_date: dateStr,
    format: en('xlsx', 'json').default('xlsx'),
};

function normalizeFilters(value) {
    const f = { ...value };
    f.start = value.from_date ? `${value.from_date} 00:00:00` : null;
    if (value.to_date) {
        const d = new Date(`${value.to_date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        f.end = `${d.toISOString().slice(0, 10)} 00:00:00`; // exclusive: the whole "to" day is included
    } else {
        f.end = null;
    }
    return f;
}

/* ---------------- column helpers ---------------- */
const money = (key, label, extra = {}) => ({ key, label, type: 'money', ...extra });
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const count = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });
const status = (key, label, extra = {}) => ({ key, label, type: 'status', ...extra });
const when = (key, label, extra = {}) => ({ key, label, type: 'date', ...extra });

const DEFS = {};

/* ===== 1. Orders (every order the partner placed) ===== */
DEFS.orders = {
    title: 'My Orders',
    columns: [
        text('order_custom_id', 'Order ID'), when('order_date', 'Order date'), text('client_name', 'Client'),
        text('company_name', 'Company'), status('transaction_type', 'Type'), count('quantity', 'Qty'),
        money('price', 'Price'), money('order_value', 'Order value'), money('partner_price', 'Partner price', { pdf: false }),
        status('order_status', 'Status'),
    ],
    joi: { transaction_type: en('BUY', 'SELL'), order_status: en('running', 'completed', 'closed') },
    from: () => `FROM order_transactions ot
    JOIN users u ON u.user_id = ot.user_id
    JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id`,
    select: `ot.order_custom_id AS order_custom_id, ${FMT(CREATED_IST)} AS order_date, ${NAME('u')} AS client_name,
        sd.company_name AS company_name, ot.transaction_type AS transaction_type, ot.quantity AS quantity,
        ot.price_per_share AS price, ${VALUE} AS order_value, ot.partner_price AS partner_price,
        CASE
            WHEN ot.rm_status = 'REJECTED' OR ot.am_status = 'REJECTED' OR ot.st_status = 'REJECTED' THEN 'Rejected'
            WHEN ot.rm_status = 'CANCEL' OR ot.am_status = 'CANCEL' OR ot.st_status = 'CANCEL' OR ot.cancellation_status = 'COMPLETED' THEN 'Cancelled'
            WHEN ${ALL_DONE} THEN 'Completed'
            WHEN ot.rm_status <> 'COMPLETED' THEN 'Pending approval'
            WHEN ot.transaction_type = 'BUY' THEN IF(ot.am_status <> 'COMPLETED', 'Payment pending', 'Share transfer')
            ELSE IF(ot.st_status <> 'COMPLETED', 'Share debit', 'Payment pending')
        END AS order_status`,
    dateExpr: CREATED_IST,
    scope: (P) => `ot.addedPartnerID = ${P}`,
    search: ['ot.order_custom_id', NAME('u'), 'u.username', 'sd.company_name'],
    filters: (f) => [
        f.transaction_type && `ot.transaction_type = ${sqlStr(f.transaction_type)}`,
        f.order_status === 'closed' && CLOSED,
        f.order_status === 'completed' && `(${ALL_DONE} AND NOT ${CLOSED})`,
        f.order_status === 'running' && `(NOT ${ALL_DONE} AND NOT ${CLOSED})`,
    ],
    orderBy: 'ot.order_id DESC',
    notes: [
        'Every order placed through you, in any stage. Order value = price x quantity.',
        'Rejected and cancelled orders are listed but are not business and earn no commission.',
    ],
    summary: [
        count('total', 'Orders', { expr: 'COUNT(*)' }),
        money('total_value', 'Total value', { expr: `IFNULL(SUM(${VALUE}), 0)` }),
        money('buy_value', 'Buy value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'BUY', ${VALUE}, 0)), 0)` }),
        money('sell_value', 'Sell value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'SELL', ${VALUE}, 0)), 0)` }),
        count('completed', 'Completed', { expr: `IFNULL(SUM(${ALL_DONE} AND NOT ${CLOSED}), 0)` }),
        count('closed', 'Closed', { expr: `IFNULL(SUM(${CLOSED}), 0)` }),
    ],
};

/* ===== 4. Prospects ===== */
const PR_STOCKS = `(SELECT COUNT(*) FROM partner_prospect_stocks s WHERE s.partner_prospect_id = pr.partner_prospect_id)`;
const PR_STOCK_NAMES = `(SELECT GROUP_CONCAT(DISTINCT s2.stock_name ORDER BY s2.stock_name SEPARATOR ', ') FROM partner_prospect_stocks s2 WHERE s2.partner_prospect_id = pr.partner_prospect_id)`;
const PR_ORDERS = `(SELECT COUNT(*) FROM partner_stock_orders pso WHERE pso.partner_prospect_id = pr.partner_prospect_id)`;
DEFS.prospects = {
    title: 'My Prospects',
    columns: [
        count('partner_prospect_id', 'ID'), when('lead_date', 'Lead date'), text('client_name', 'Client / firm'),
        status('client_type', 'Client type', { pdf: false }), text('phone', 'Phone', { pdf: false }), text('email', 'Email', { pdf: false }),
        status('lead_type', 'Lead type'), status('lead_status', 'Lead status'), when('followup_date', 'Follow-up'),
        count('stocks_count', 'Stocks'), text('stock_names', 'Stock names', { pdf: false }), count('orders_count', 'Orders'),
    ],
    joi: {
        lead_type: en('Prospects', 'Converted', 'New Lead'),
        lead_status: en('Prospects', 'Deal Closed', 'Not Interested', 'In discussion'),
    },
    from: () => `FROM partner_prospects pr`,
    select: `pr.partner_prospect_id AS partner_prospect_id,
        DATE_FORMAT(COALESCE(pr.lead_creation_date, DATE(pr.created_at)), '%Y-%m-%d') AS lead_date,
        pr.client_firm_name AS client_name, pr.client_type AS client_type, pr.phone AS phone, pr.email AS email,
        pr.lead_type AS lead_type, pr.lead_status AS lead_status, DATE_FORMAT(pr.followup_date, '%Y-%m-%d') AS followup_date,
        ${PR_STOCKS} AS stocks_count, ${PR_STOCK_NAMES} AS stock_names, ${PR_ORDERS} AS orders_count`,
    dateExpr: `TIMESTAMP(COALESCE(pr.lead_creation_date, DATE(pr.created_at)))`,
    scope: (P) => `pr.user_id = ${P} AND pr.is_deleted = 0`,
    search: ['pr.client_firm_name', 'pr.email', 'pr.phone', PR_STOCK_NAMES],
    filters: (f) => [
        f.lead_type && `pr.lead_type = ${sqlStr(f.lead_type)}`,
        f.lead_status && `pr.lead_status = ${sqlStr(f.lead_status)}`,
    ],
    orderBy: 'pr.partner_prospect_id DESC',
    notes: [
        'Your own prospects. Document paths and passwords are not part of this report.',
        'The date filter uses the lead creation date.',
    ],
    summary: [
        count('total', 'Prospects', { expr: 'COUNT(*)' }),
        count('open', 'Lead type: Prospects', { expr: `IFNULL(SUM(pr.lead_type = 'Prospects'), 0)` }),
        count('converted', 'Lead type: Converted', { expr: `IFNULL(SUM(pr.lead_type = 'Converted'), 0)` }),
        count('new_lead', 'Lead type: New Lead', { expr: `IFNULL(SUM(pr.lead_type = 'New Lead'), 0)` }),
        count('deal_closed', 'Deal closed', { expr: `IFNULL(SUM(pr.lead_status = 'Deal Closed'), 0)` }),
        count('orders', 'Orders', { expr: `IFNULL(SUM(${PR_ORDERS}), 0)` }),
    ],
};

/* ===== 5. Converted clients (customers with at least one completed order placed through the partner) ===== */
DEFS['converted-clients'] = {
    title: 'Converted Clients',
    columns: [
        text('client_custom_id', 'Customer ID'), text('client_name', 'Client'), text('contact_no', 'Contact No', { pdf: false }),
        when('first_completed', 'First completed'), when('last_completed', 'Last completed'),
        count('orders_count', 'Completed orders'), money('buy_value', 'Buy value'), money('sell_value', 'Sell value'),
        money('total_value', 'Total value'),
    ],
    joi: {},
    from: (P) => `FROM (
        SELECT ot.user_id AS user_id, MIN(${DONE_DT}) AS first_done, MAX(${DONE_DT}) AS last_done, COUNT(*) AS orders_count,
               IFNULL(SUM(IF(ot.transaction_type = 'BUY', ${VALUE}, 0)), 0) AS buy_value,
               IFNULL(SUM(IF(ot.transaction_type = 'SELL', ${VALUE}, 0)), 0) AS sell_value,
               IFNULL(SUM(${VALUE}), 0) AS total_value
        FROM order_transactions ot
        WHERE ot.addedPartnerID = ${P} AND ${ALL_DONE} AND ot.cancellation_status <> 'COMPLETED'
        GROUP BY ot.user_id) cc
    JOIN users u ON u.user_id = cc.user_id`,
    select: `u.user_custum_id AS client_custom_id, ${NAME('u')} AS client_name, u.phone_number AS contact_no,
        ${FMT('cc.first_done')} AS first_completed, ${FMT('cc.last_done')} AS last_completed,
        cc.orders_count AS orders_count, cc.buy_value AS buy_value, cc.sell_value AS sell_value, cc.total_value AS total_value`,
    dateExpr: 'cc.first_done',
    scope: () => null,
    search: [NAME('u'), 'u.username', 'u.user_custum_id', 'CAST(u.phone_number AS CHAR)'],
    filters: () => [],
    orderBy: 'cc.last_done DESC, u.user_id DESC',
    notes: [
        'A converted client is a customer who has at least one order placed through you with RM, AM and ST all COMPLETED (not cancelled through a refund).',
        'The date filter uses the date of the first completed order.',
    ],
    summary: [
        count('total', 'Converted clients', { expr: 'COUNT(*)' }),
        count('orders', 'Completed orders', { expr: 'IFNULL(SUM(cc.orders_count), 0)' }),
        money('buy_value', 'Buy value', { expr: 'IFNULL(SUM(cc.buy_value), 0)' }),
        money('sell_value', 'Sell value', { expr: 'IFNULL(SUM(cc.sell_value), 0)' }),
        money('total_value', 'Total value', { expr: 'IFNULL(SUM(cc.total_value), 0)' }),
    ],
};

/* ===== 2, 3, 6. Commission based reports (computed in JavaScript with the existing formula) ===== */
DEFS.commissions = {
    title: 'My Commission',
    columns: [
        text('order_custom_id', 'Order ID'), when('date', 'Date'), text('client_name', 'Client'), text('company_name', 'Company'),
        status('transaction_type', 'Type'), count('quantity', 'Qty'), money('price_per_share', 'Price', { pdf: false }),
        money('partner_price', 'Partner price', { pdf: false }), money('commission_per_share', 'Commission / share', { pdf: false }),
        money('gross_commission', 'Commission'), status('status', 'Payout'),
        money('tds_amount', 'TDS', { pdf: false }), money('gst_amount', 'GST', { pdf: false }), money('payable_amount', 'Payable'),
        text('invoice_no', 'Partner invoice no'), status('partner_verification', 'Verified by you', { pdf: false }),
    ],
    joi: { status: en('paid', 'pending'), transaction_type: en('BUY', 'SELL') },
    notes: [
        'Commission is gross (before TDS and GST). TDS, GST and Payable are shown only for orders already paid.',
        'Only completed orders earn commission. The date is the payment date when paid, otherwise the date the order completed.',
    ],
    summary: [
        count('total', 'Orders', {}), money('gross_total', 'Total commission', {}),
        count('paid_count', 'Paid orders', {}), money('paid_gross', 'Paid commission', {}),
        count('pending_count', 'Pending orders', {}), money('pending_gross', 'Pending commission', {}),
        money('tds_total', 'TDS (paid)', {}), money('gst_total', 'GST (paid)', {}), money('payable_total', 'Payable (paid)', {}),
    ],
};

DEFS.payouts = {
    title: 'Payout Report',
    columns: [
        when('date', 'Payment date'), text('order_custom_id', 'Order ID'), text('client_name', 'Client'), text('company_name', 'Company', { pdf: false }),
        status('transaction_type', 'Type', { pdf: false }), money('gross_commission', 'Commission'), money('tds_amount', 'TDS'),
        money('gst_amount', 'GST'), money('payable_amount', 'Paid to you'), text('invoice_no', 'Partner invoice no'),
        text('payment_ref', 'Transaction ID'),
    ],
    joi: { transaction_type: en('BUY', 'SELL') },
    notes: [
        'Commission payments already made to you. Paid to you = commission less TDS and GST (the percentages recorded with the payment).',
        'The date filter uses the payment date.',
    ],
    summary: [
        count('total', 'Payouts', {}), money('gross_total', 'Commission', {}), money('tds_total', 'TDS', {}),
        money('gst_total', 'GST', {}), money('payable_total', 'Paid to you', {}),
    ],
};

DEFS['monthly-summary'] = {
    title: 'Monthly Business & Commission',
    columns: [
        text('month_label', 'Month'), count('orders_count', 'Orders'), money('buy_value', 'Buy business'), money('sell_value', 'Sell business'),
        money('business_value', 'Total business'), money('commission_earned', 'Commission earned'), money('commission_paid', 'Paid'),
        money('commission_pending', 'Pending'), money('payable_paid', 'Paid after TDS & GST', { pdf: false }),
    ],
    joi: {},
    notes: [
        'Business = value of your orders that are not rejected or cancelled, by the month the order was placed.',
        'Commission is gross, by the month the order completed (share transfer done). Paid / Pending follow the commission list.',
        'Without a date filter the last 12 months are shown.',
    ],
    summary: [
        count('orders_count', 'Orders', {}), money('buy_value', 'Buy business', {}), money('sell_value', 'Sell business', {}),
        money('business_value', 'Total business', {}), money('commission_earned', 'Commission earned', {}),
        money('commission_paid', 'Paid', {}), money('commission_pending', 'Pending', {}),
    ],
};

/* ---------------- SQL engine (orders, prospects, converted clients) ---------------- */
function sqlWhere(def, f, P) {
    const conds = ['1 = 1'];
    const scope = def.scope(P);
    if (scope) conds.push(scope);
    if (f.start) conds.push(`${def.dateExpr} >= ${sqlStr(f.start)}`);
    if (f.end) conds.push(`${def.dateExpr} < ${sqlStr(f.end)}`);
    if (f.search) conds.push(`(${def.search.map((e) => `${e} LIKE ${likeStr(f.search)}`).join(' OR ')})`);
    def.filters(f).forEach((c) => c && conds.push(c));
    return conds.map((c) => `(${c})`).join(' AND ');
}

async function runSqlReport(def, f, P, all, next) {
    const where = sqlWhere(def, f, P);
    const from = def.from(P);
    const totalRows = await getData(`SELECT COUNT(*) AS c ${from} WHERE ${where}`, next);
    const total = num(totalRows?.[0]?.c);
    const sumRows = await getData(`SELECT ${def.summary.map((s) => `${s.expr} AS \`${s.key}\``).join(', ')} ${from} WHERE ${where}`, next);
    const limit = all ? EXPORT_ROW_CAP : f.per_page;
    const offset = all ? 0 : (f.page - 1) * f.per_page;
    const rows = await getData(
        `SELECT ${def.select} ${from} WHERE ${where} ORDER BY ${def.orderBy} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
        next
    );
    const sum = sumRows?.[0] || {};
    return {
        rows: rows || [],
        total,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: round2(num(sum[s.key])) })),
        truncated: all && total > EXPORT_ROW_CAP,
    };
}

const slicePage = (rows, f, all) => (all ? rows.slice(0, EXPORT_ROW_CAP) : rows.slice((f.page - 1) * f.per_page, f.page * f.per_page));

/* ---------------- commission rows (existing rules) ---------------- */
async function loadCommissionRows(P, f, opts, next) {
    const hasPayDate = await colExists('partner_commission', 'payment_date', next);
    const hasInv = await colExists('order_transactions', 'commission_inv_number', next);
    const hasVerifiedAt = await colExists('order_transactions', 'partner_verified_at', next);

    const paidDate = hasPayDate ? `IFNULL(CAST(pc.payment_date AS DATETIME), ${IST('pc.created_at')})` : IST('pc.created_at');
    const dateExpr = opts.onlyPaid ? paidDate : `IF(pc.commission_id IS NULL, ${DONE_DT}, ${paidDate})`;

    const conds = [`ot.addedPartnerID = ${P}`, ELIGIBLE];
    if (opts.onlyPaid) conds.push('pc.commission_id IS NOT NULL');
    if (opts.useDates) {
        if (f.start) conds.push(`${dateExpr} >= ${sqlStr(f.start)}`);
        if (f.end) conds.push(`${dateExpr} < ${sqlStr(f.end)}`);
    }
    if (f.search) {
        const cols = ['ot.order_custom_id', NAME('u'), 'sd.company_name', 'pc.inv_number', hasInv ? 'ot.commission_inv_number' : null].filter(Boolean);
        conds.push(`(${cols.map((e) => `${e} LIKE ${likeStr(f.search)}`).join(' OR ')})`);
    }
    if (f.status === 'paid') conds.push('pc.commission_id IS NOT NULL');
    if (f.status === 'pending') conds.push('pc.commission_id IS NULL');
    if (f.transaction_type) conds.push(`ot.transaction_type = ${sqlStr(f.transaction_type)}`);

    const rows = await getData(
        `SELECT ot.order_custom_id, ot.transaction_type, ot.quantity, ot.price_per_share, ot.partner_price, ot.verify,
                ${NAME('u')} AS client_name, sd.company_name,
                ${FMT(dateExpr)} AS row_date, ${FMT(DONE_DT)} AS done_date,
                pc.commission_id, pc.tds, pc.gst, pc.payment_id AS payment_ref, pc.inv_number,
                ${hasInv ? 'ot.commission_inv_number' : 'NULL'} AS order_inv,
                ${hasVerifiedAt ? FMT('ot.partner_verified_at') : 'NULL'} AS partner_verified_at
         FROM order_transactions ot
         JOIN users u ON u.user_id = ot.user_id
         JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id
         LEFT JOIN (SELECT order_id, MIN(commission_id) AS cid FROM partner_commission GROUP BY order_id) pcm ON pcm.order_id = ot.order_id
         LEFT JOIN partner_commission pc ON pc.commission_id = pcm.cid
         WHERE ${conds.map((c) => `(${c})`).join(' AND ')}
         ORDER BY ot.order_id DESC`,
        next
    );

    return (rows || []).map((r) => {
        const perShare = commissionPerShare(r.partner_price, r.price_per_share, r.transaction_type);
        const gross = round2(perShare * num(r.quantity));
        const paid = !!r.commission_id;
        const ded = paid ? commissionDeductions(gross, r.tds, r.gst) : null;
        return {
            order_custom_id: r.order_custom_id,
            date: r.row_date,
            done_date: r.done_date,
            client_name: r.client_name,
            company_name: r.company_name,
            transaction_type: r.transaction_type,
            quantity: num(r.quantity),
            price_per_share: num(r.price_per_share),
            partner_price: num(r.partner_price),
            commission_per_share: perShare,
            gross_commission: gross,
            status: paid ? 'Paid' : 'Pending',
            tds_amount: ded ? ded.tds_amount : null,
            gst_amount: ded ? ded.gst_amount : null,
            payable_amount: ded ? ded.payable_amount : null,
            invoice_no: (paid && r.inv_number) || r.order_inv || null,
            payment_ref: paid ? r.payment_ref : null,
            partner_verification: num(r.verify) >= 1 ? 'Verified' : 'Not verified',
        };
    });
}

const sumOf = (list, k) => round2(list.reduce((s, r) => s + num(r[k]), 0));

async function runCommissions(def, f, P, all, next) {
    const rows = await loadCommissionRows(P, f, { useDates: true }, next);
    const paid = rows.filter((r) => r.status === 'Paid');
    const pending = rows.filter((r) => r.status !== 'Paid');
    const values = {
        total: rows.length, gross_total: sumOf(rows, 'gross_commission'),
        paid_count: paid.length, paid_gross: sumOf(paid, 'gross_commission'),
        pending_count: pending.length, pending_gross: sumOf(pending, 'gross_commission'),
        tds_total: sumOf(paid, 'tds_amount'), gst_total: sumOf(paid, 'gst_amount'), payable_total: sumOf(paid, 'payable_amount'),
    };
    return {
        rows: slicePage(rows, f, all).map(({ done_date, ...r }) => r),
        total: rows.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: num(values[s.key]) })),
        truncated: all && rows.length > EXPORT_ROW_CAP,
    };
}

async function runPayouts(def, f, P, all, next) {
    const rows = await loadCommissionRows(P, f, { useDates: true, onlyPaid: true }, next);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const values = {
        total: rows.length, gross_total: sumOf(rows, 'gross_commission'), tds_total: sumOf(rows, 'tds_amount'),
        gst_total: sumOf(rows, 'gst_amount'), payable_total: sumOf(rows, 'payable_amount'),
    };
    return {
        rows: slicePage(rows, f, all).map(({ done_date, ...r }) => r),
        total: rows.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: num(values[s.key]) })),
        truncated: all && rows.length > EXPORT_ROW_CAP,
    };
}

/* ----- monthly summary ----- */
const monthLabel = (key) => `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function monthKeys(startKey, endKeyExclusive) {
    const keys = [];
    let y = Number(startKey.slice(0, 4));
    let m = Number(startKey.slice(5, 7));
    while (`${y}-${pad(m)}` < endKeyExclusive && keys.length < MAX_MONTHS) {
        keys.push(`${y}-${pad(m)}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return keys;
}

async function runMonthly(def, f, P, all, next) {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const curY = now.getUTCFullYear();
    const curM = now.getUTCMonth() + 1;
    const nextKey = curM === 12 ? `${curY + 1}-01` : `${curY}-${pad(curM + 1)}`;
    const back = new Date(Date.UTC(curY, curM - 1 - (DEFAULT_MONTHS - 1), 1));
    const defaultStart = `${back.getUTCFullYear()}-${pad(back.getUTCMonth() + 1)}`;

    const startKey = f.start ? f.start.slice(0, 7) : defaultStart;
    const endKey = f.end ? (f.end.slice(8, 10) === '01' ? f.end.slice(0, 7) : nextMonthKey(f.end.slice(0, 7))) : nextKey;
    const keys = monthKeys(startKey, endKey);
    const startStr = `${startKey}-01 00:00:00`;
    const endStr = `${endKey}-01 00:00:00`;

    const business = await getData(
        `SELECT DATE_FORMAT(${CREATED_IST}, '%Y-%m') AS mk, COUNT(*) AS c,
                IFNULL(SUM(IF(ot.transaction_type = 'BUY', ${VALUE}, 0)), 0) AS buy_value,
                IFNULL(SUM(IF(ot.transaction_type = 'SELL', ${VALUE}, 0)), 0) AS sell_value
         FROM order_transactions ot
         WHERE ot.addedPartnerID = ${P} AND NOT ${CLOSED}
           AND ${CREATED_IST} >= ${sqlStr(startStr)} AND ${CREATED_IST} < ${sqlStr(endStr)}
         GROUP BY mk`,
        next
    );
    const byMonth = new Map((business || []).map((b) => [b.mk, b]));

    const comm = await loadCommissionRows(P, {}, { useDates: false }, next);
    const earned = new Map();
    comm.forEach((r) => {
        const mk = String(r.done_date || '').slice(0, 7);
        if (mk < startKey || mk >= endKey) return;
        const e = earned.get(mk) || { earned: 0, paid: 0, pending: 0, payable: 0 };
        e.earned += r.gross_commission;
        if (r.status === 'Paid') { e.paid += r.gross_commission; e.payable += num(r.payable_amount); } else { e.pending += r.gross_commission; }
        earned.set(mk, e);
    });

    const rows = keys.map((mk) => {
        const b = byMonth.get(mk) || {};
        const e = earned.get(mk) || {};
        const buy = round2(num(b.buy_value));
        const sell = round2(num(b.sell_value));
        return {
            month_key: mk, month_label: monthLabel(mk), orders_count: num(b.c), buy_value: buy, sell_value: sell,
            business_value: round2(buy + sell), commission_earned: round2(num(e.earned)), commission_paid: round2(num(e.paid)),
            commission_pending: round2(num(e.pending)), payable_paid: round2(num(e.payable)),
        };
    }).reverse();

    const values = {
        orders_count: rows.reduce((s, r) => s + r.orders_count, 0), buy_value: sumOf(rows, 'buy_value'), sell_value: sumOf(rows, 'sell_value'),
        business_value: sumOf(rows, 'business_value'), commission_earned: sumOf(rows, 'commission_earned'),
        commission_paid: sumOf(rows, 'commission_paid'), commission_pending: sumOf(rows, 'commission_pending'),
    };
    return {
        rows: slicePage(rows, f, all).map(({ month_key, ...r }) => r),
        total: rows.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: num(values[s.key]) })),
        range: { from: startStr.slice(0, 10), to_exclusive: endStr.slice(0, 10) },
        truncated: false,
    };
}

function nextMonthKey(key) {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

const RUNNERS = { commissions: runCommissions, payouts: runPayouts, 'monthly-summary': runMonthly };

async function runReport(key, f, P, all, next) {
    const def = DEFS[key];
    return RUNNERS[key] ? RUNNERS[key](def, f, P, all, next) : runSqlReport(def, f, P, all, next);
}

/* ---------------- request handling ---------------- */
/** PARTNER only. The role and the partner id come from users, not from the token payload or the request. */
async function requirePartner(req, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || actor.user_type !== 'PARTNER') {
        next(new CustomErrorHandler(403, 'Only a partner can open the partner reports'));
        return null;
    }
    return actor;
}

function parseQuery(key, req, next) {
    const def = DEFS[key];
    const { error, value } = Joi.object({ ...baseKeys, ...def.joi }).validate(req.query);
    if (error) {
        next(error);
        return null;
    }
    if (value.from_date && value.to_date && value.from_date > value.to_date) {
        next(CustomErrorHandler.badRequest('The From date is after the To date'));
        return null;
    }
    return normalizeFilters(value);
}

const appliedFilters = (f, def) => {
    const out = {};
    ['search', 'from_date', 'to_date', ...Object.keys(def.joi)].forEach((k) => { if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = f[k]; });
    return out;
};

const columnMeta = (def) => def.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, pdf: c.pdf !== false }));

function listHandler(key) {
    return async (req, res, next) => {
        try {
            const actor = await requirePartner(req, next);
            if (!actor) return;
            const f = parseQuery(key, req, next);
            if (!f) return;
            const def = DEFS[key];
            const result = await runReport(key, f, Number(actor.user_id), false, next);
            return res.json({
                success: true,
                data: {
                    report: { key, title: def.title },
                    columns: columnMeta(def),
                    summary: result.summary,
                    rows: result.rows,
                    notes: def.notes || [],
                    range: result.range || null,
                    page: f.page,
                    per_page: f.per_page,
                    total: result.total,
                    total_pages: Math.max(Math.ceil(result.total / f.per_page), 1),
                    filters_applied: appliedFilters(f, def),
                },
            });
        } catch (error) {
            next(error);
        }
    };
}

function exportRowValue(col, v) {
    if (v === null || v === undefined || v === '') return '-';
    return col.type === 'money' || col.type === 'number' ? Number(v) : v;
}

function buildWorkbook(def, actor, f, result) {
    const cols = def.columns;
    const generated = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const filters = appliedFilters(f, def);
    const filterText = Object.keys(filters).length ? Object.entries(filters).map(([k, v]) => `${k} = ${v}`).join(', ') : 'none';
    const aoa = [
        [def.title],
        [`Generated (IST): ${generated}`, `Role: ${actor.user_type}`],
        [`Filters: ${filterText}`],
        [result.truncated ? `Only the first ${EXPORT_ROW_CAP} of ${result.total} rows are exported.` : `Rows: ${result.rows.length}`],
        [],
        ['Summary'],
        ...result.summary.map((s) => [s.label, s.value]),
        [],
        cols.map((c) => c.label),
        ...result.rows.map((r) => cols.map((c) => exportRowValue(c, r[c.key]))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map((c) => ({ wch: Math.max(c.label.length + 2, c.type === 'money' ? 14 : c.type === 'text' ? 22 : 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, def.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportHandler(key) {
    return async (req, res, next) => {
        try {
            const actor = await requirePartner(req, next);
            if (!actor) return;
            const f = parseQuery(key, req, next);
            if (!f) return;
            const def = DEFS[key];
            const result = await runReport(key, f, Number(actor.user_id), true, next);

            if (f.format === 'json') {
                return res.json({
                    success: true,
                    data: {
                        report: { key, title: def.title },
                        generated_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
                        role: actor.user_type,
                        columns: columnMeta(def),
                        summary: result.summary,
                        rows: result.rows,
                        notes: def.notes || [],
                        range: result.range || null,
                        total: result.total,
                        truncated: !!result.truncated,
                        filters_applied: appliedFilters(f, def),
                    },
                });
            }
            const buffer = buildWorkbook(def, actor, f, result);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="partner-${key}-report.xlsx"`);
            return res.send(buffer);
        } catch (error) {
            next(error);
        }
    };
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const partnerReportsController = {};
Object.keys(DEFS).forEach((key) => {
    partnerReportsController[`${camel(key)}Report`] = listHandler(key);
    partnerReportsController[`${camel(key)}Export`] = exportHandler(key);
});

export { DEFS as PARTNER_REPORT_DEFS };
export default partnerReportsController;
