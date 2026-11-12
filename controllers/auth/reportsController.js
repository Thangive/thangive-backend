import Joi from 'joi';
import XLSX from 'xlsx';
import { getData } from '../../config/index.js';
import { CustomErrorHandler } from '../../service/index.js';
import refundHelper from '../../helper/refundHelper.js';
import { commissionPerShare, commissionDeductions } from '../../helper/commissionHelper.js';

/*
 * Main Reports (RM, AM and ST dashboards). Nine reports, each with
 *   GET /reports/<report>          one page of rows + summary totals for the active filters
 *   GET /reports/<report>/export   every filtered row (cap EXPORT_ROW_CAP): format=xlsx (Excel file)
 *                                  or format=json (rows + summary, used by the frontend PDF)
 *   GET /reports/options           dropdown data (advisors, brokers, partners, RMs)
 *
 * Read-only: nothing is written and no existing business rule is changed.
 *
 * Access (role read from users.user_type of the token user, never from the request; 403 otherwise):
 *   RM  : only their own data. Orders / payments / refunds / commissions / share debit are the orders
 *         whose owner RM is the logged-in RM (client's assign_to, else the placing partner's assign_to,
 *         the same single-owner rule as the RM dashboard). Partners and prospects: partners assigned to the RM.
 *   AM  : everything, every report.
 *   ST  : everything, but only the operational reports: orders, share-debit, partners, prospects.
 *         The money reports (payments, refunds, commissions, performance, financial) answer 403 for ST.
 *
 * Definitions come from existing code: an order is "closed" when any stage is REJECTED / CANCEL or the
 * refund flow completed the cancellation; payments follow GET /paymentDetails (cancelled / rejected orders
 * left out); partner commission uses the frontend formula (helper/commissionHelper.js), gross, paid = the
 * order has a partner_commission row, pending = it has none, the same eligibility as the partner
 * commission list. Dates are IST.
 */

const EXPORT_ROW_CAP = 50000;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const REPORT_ROLES = {
    orders: ['RM', 'AM', 'ST'],
    'share-debit': ['RM', 'AM', 'ST'],
    partners: ['RM', 'AM', 'ST'],
    prospects: ['RM', 'AM', 'ST'],
    payments: ['RM', 'AM'],
    refunds: ['RM', 'AM'],
    commissions: ['RM', 'AM'],
    performance: ['RM', 'AM'],
    financial: ['RM', 'AM'],
};

/* ---------------- helpers ---------------- */
const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

const ESC = { '\0': '\\0', '\n': '\\n', '\r': '\\r', '\\': '\\\\', "'": "\\'", '"': '\\"', '\x1a': '\\Z' };
export const sqlStr = (v) => `'${String(v).replace(/[\0\n\r\\'"\x1a]/g, (c) => ESC[c])}'`;
export const likeStr = (v) => sqlStr(`%${String(v).replace(/[\\%_]/g, '\\$&')}%`);

const IST = (col) => `CONVERT_TZ(${col}, '+00:00', '+05:30')`;
const FMT = (expr) => `DATE_FORMAT(${expr}, '%Y-%m-%d %H:%i:%s')`;
const NAME = (a) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.middle_name, ${a}.last_name)), ''), ${a}.username)`;
const rangeCond = (expr, start, end) =>
    (start ? ` AND ${expr} >= ${sqlStr(start)}` : '') + (end ? ` AND ${expr} < ${sqlStr(end)}` : '');

/* ---------------- shared SQL pieces ---------------- */
const OWNER_RM = `COALESCE(NULLIF(u.assign_to, 0), NULLIF(p.assign_to, 0))`;
const CLOSED = `(ot.rm_status IN ('REJECTED', 'CANCEL') OR ot.am_status IN ('REJECTED', 'CANCEL')
    OR ot.st_status IN ('REJECTED', 'CANCEL') OR ot.cancellation_status = 'COMPLETED')`;
const ALL_DONE = `(ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED')`;
const VALUE = `(ot.price_per_share * ot.quantity)`;
const CREATED_IST = IST('ot.created_at');
const ORDER_JOINS = `JOIN users u ON u.user_id = ot.user_id
    LEFT JOIN users p ON p.user_id = ot.addedPartnerID
    LEFT JOIN users rm ON rm.user_id = ${OWNER_RM}
    JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id`;
const PARTNER_ELIGIBLE = `ot.addedPartnerID IS NOT NULL AND ${ALL_DONE} AND ot.cancellation_status <> 'COMPLETED'
    AND IFNULL(ot.markAsSold, 0) <> 1 AND NOT (ot.transaction_type = 'BUY' AND ot.advisor_id = 2)`;

const PAY_DATE = `IF(ot.transaction_type = 'BUY', IFNULL(pt.rm_Datetime, ${IST('pt.created_at')}), IFNULL(pt.am_Datetime, ${IST('pt.created_at')}))`;
const REFUND_DATE = `IFNULL(rt.refund_Datetime, ${IST('rt.created_at')})`;

const scopeOwner = (actor) => (actor.user_type === 'RM' ? `${OWNER_RM} = ${Number(actor.user_id)}` : null);
const rmFilter = (f, actor) => (f.rm_id && actor.user_type !== 'RM' ? `${OWNER_RM} = ${Number(f.rm_id)}` : null);
const sourceFilter = (f) =>
    f.source === 'partner' ? 'ot.addedPartnerID IS NOT NULL' : f.source === 'direct' ? 'ot.addedPartnerID IS NULL' : null;

/* columns that exist only after the later migrations are detected once, so a report never breaks on them */
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
const idNum = () => Joi.number().integer().min(1).empty('');
const STAGE = ['PENDING', 'PROCCESSING', 'COMPLETED', 'HOLD', 'REJECTED', 'CANCEL'];

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

/* ---------------- report definitions (SQL based) ---------------- */
const money = (key, label, extra = {}) => ({ key, label, type: 'money', ...extra });
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const count = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });
const status = (key, label, extra = {}) => ({ key, label, type: 'status', ...extra });
const when = (key, label, extra = {}) => ({ key, label, type: 'date', ...extra });

const DEFS = {};

/* ===== 1. Orders ===== */
DEFS.orders = {
    title: 'Order Reports',
    columns: [
        text('order_custom_id', 'Order ID'), when('order_date', 'Order date'), text('client_name', 'Client'),
        text('rm_name', 'RM', { pdf: false }), text('partner_name', 'Partner', { pdf: false }), text('company_name', 'Company'),
        status('transaction_type', 'Type'), count('quantity', 'Qty'), money('price', 'Price'), money('order_value', 'Order value'),
        status('rm_status', 'RM', { pdf: false }), status('am_status', 'AM', { pdf: false }), status('st_status', 'ST', { pdf: false }),
        status('refund_status', 'Refund', { pdf: false }), status('order_status', 'Status'),
    ],
    joi: {
        transaction_type: en('BUY', 'SELL'), order_status: en('running', 'completed', 'closed'),
        rm_status: en(...STAGE), am_status: en(...STAGE), st_status: en(...STAGE),
        refund_status: en('NONE', 'REQUESTED', 'ACCEPTED', 'PARTIALLY_REFUNDED', 'REFUNDED'),
        source: en('partner', 'direct'), selling_type: en('THANGIV', 'MARK_AS_SOLD'),
        advisor_id: idNum(), broker_id: idNum(), partner_id: idNum(), rm_id: idNum(),
    },
    from: `FROM order_transactions ot ${ORDER_JOINS}
    LEFT JOIN advisor ad ON ad.advisor_id = ot.advisor_id
    LEFT JOIN broker br ON br.broker_id = ot.broker_id`,
    select: `ot.order_custom_id AS order_custom_id, ${FMT(CREATED_IST)} AS order_date, ${NAME('u')} AS client_name,
        ${NAME('rm')} AS rm_name, ${NAME('p')} AS partner_name, sd.company_name AS company_name,
        ot.transaction_type AS transaction_type, ot.quantity AS quantity, ot.price_per_share AS price, ${VALUE} AS order_value,
        ot.rm_status AS rm_status, ot.am_status AS am_status, ot.st_status AS st_status, ot.refund_status AS refund_status,
        CASE WHEN ${CLOSED} THEN 'Closed' WHEN ${ALL_DONE} THEN 'Completed' ELSE 'Running' END AS order_status`,
    dateExpr: CREATED_IST,
    scope: scopeOwner,
    search: ['ot.order_custom_id', NAME('u'), 'u.username', 'sd.company_name', NAME('p')],
    filters: (f, actor) => [
        f.transaction_type && `ot.transaction_type = ${sqlStr(f.transaction_type)}`,
        f.order_status === 'closed' && CLOSED,
        f.order_status === 'completed' && `(${ALL_DONE} AND NOT ${CLOSED})`,
        f.order_status === 'running' && `(NOT ${ALL_DONE} AND NOT ${CLOSED})`,
        f.rm_status && `ot.rm_status = ${sqlStr(f.rm_status)}`,
        f.am_status && `ot.am_status = ${sqlStr(f.am_status)}`,
        f.st_status && `ot.st_status = ${sqlStr(f.st_status)}`,
        f.refund_status && `ot.refund_status = ${sqlStr(f.refund_status)}`,
        sourceFilter(f),
        f.selling_type === 'MARK_AS_SOLD' && `ot.markAsSold = 1`,
        f.selling_type === 'THANGIV' && `IFNULL(ot.markAsSold, 0) <> 1`,
        f.advisor_id && `ot.advisor_id = ${Number(f.advisor_id)}`,
        f.broker_id && `ot.broker_id = ${Number(f.broker_id)}`,
        f.partner_id && `ot.addedPartnerID = ${Number(f.partner_id)}`,
        rmFilter(f, actor),
    ],
    orderBy: 'ot.order_id DESC',
    summary: [
        count('total', 'Orders', { expr: 'COUNT(*)' }),
        money('total_value', 'Total value', { expr: `IFNULL(SUM(${VALUE}), 0)` }),
        count('buy_count', 'Buy orders', { expr: `IFNULL(SUM(ot.transaction_type = 'BUY'), 0)` }),
        money('buy_value', 'Buy value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'BUY', ${VALUE}, 0)), 0)` }),
        count('sell_count', 'Sell orders', { expr: `IFNULL(SUM(ot.transaction_type = 'SELL'), 0)` }),
        money('sell_value', 'Sell value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'SELL', ${VALUE}, 0)), 0)` }),
        count('completed', 'Completed', { expr: `IFNULL(SUM(${ALL_DONE} AND NOT ${CLOSED}), 0)` }),
        count('closed', 'Closed', { expr: `IFNULL(SUM(${CLOSED}), 0)` }),
    ],
};

/* ===== 2. Payments ===== */
DEFS.payments = {
    title: 'Payment Reports',
    columns: [
        text('payment_custom_id', 'Payment ID'), text('order_custom_id', 'Order ID'), when('payment_date', 'Date'),
        text('client_name', 'Client'), text('rm_name', 'RM', { pdf: false }), text('company_name', 'Company', { pdf: false }),
        status('transaction_type', 'Type'), text('bank_name', 'Bank', { pdf: false }), money('amount', 'Amount'),
        status('payment_type', 'Payment type', { pdf: false }), text('transaction_ref', 'Reference'),
        status('rm_status', 'RM status', { pdf: false }), status('am_status', 'AM status'), text('am_remark', 'AM remark', { pdf: false }),
    ],
    joi: {
        transaction_type: en('BUY', 'SELL'), am_status: en('RECEVIED', 'PENDING', 'NOT_RECEIVED'),
        rm_status: en('RECEVIED', 'PENDING'), payment_type: en('FULL', 'PARTIAL'), rm_id: idNum(),
    },
    from: `FROM payment_transactions pt
    JOIN order_transactions ot ON ot.order_id = pt.order_id ${ORDER_JOINS}
    LEFT JOIN user_bank_details b ON b.bank_id = pt.bank_id`,
    selectFn: (has) => `pt.payment_custom_id AS payment_custom_id, ot.order_custom_id AS order_custom_id, ${FMT(PAY_DATE)} AS payment_date,
        ${NAME('u')} AS client_name, ${NAME('rm')} AS rm_name, sd.company_name AS company_name,
        ot.transaction_type AS transaction_type, b.bank_name AS bank_name, pt.amount AS amount,
        pt.payment_type AS payment_type, pt.transaction_ref AS transaction_ref,
        pt.rm_status AS rm_status, pt.am_status AS am_status, ${has.am_remark ? 'pt.am_remark' : 'NULL'} AS am_remark`,
    needs: [['payment_transactions', 'am_remark', 'am_remark']],
    dateExpr: PAY_DATE,
    baseWhere: `ot.rm_status NOT IN ('CANCEL', 'REJECTED')`,
    scope: scopeOwner,
    search: ['pt.payment_custom_id', 'ot.order_custom_id', NAME('u'), 'sd.company_name', 'pt.transaction_ref'],
    filters: (f, actor) => [
        f.transaction_type && `ot.transaction_type = ${sqlStr(f.transaction_type)}`,
        f.am_status && `pt.am_status = ${sqlStr(f.am_status)}`,
        f.rm_status && `pt.rm_status = ${sqlStr(f.rm_status)}`,
        f.payment_type && `pt.payment_type = ${sqlStr(f.payment_type)}`,
        rmFilter(f, actor),
    ],
    orderBy: 'pt.payment_id DESC',
    summary: [
        count('total', 'Payments', { expr: 'COUNT(*)' }),
        money('total_amount', 'Total amount', { expr: 'IFNULL(SUM(pt.amount), 0)' }),
        count('received_count', 'AM received', { expr: `IFNULL(SUM(pt.am_status = 'RECEVIED'), 0)` }),
        money('received_amount', 'Received amount', { expr: `IFNULL(SUM(IF(pt.am_status = 'RECEVIED', pt.amount, 0)), 0)` }),
        count('pending_count', 'Pending', { expr: `IFNULL(SUM(pt.am_status = 'PENDING'), 0)` }),
        money('pending_amount', 'Pending amount', { expr: `IFNULL(SUM(IF(pt.am_status = 'PENDING', pt.amount, 0)), 0)` }),
        count('not_received_count', 'Not received', { expr: `IFNULL(SUM(pt.am_status = 'NOT_RECEIVED'), 0)` }),
        money('not_received_amount', 'Not received amount', { expr: `IFNULL(SUM(IF(pt.am_status = 'NOT_RECEIVED', pt.amount, 0)), 0)` }),
    ],
};

/* ===== 3. Refunds (one row per refund request) ===== */
const RR_RECEIVED = `(SELECT IFNULL(SUM(pt2.amount), 0) FROM payment_transactions pt2 WHERE pt2.order_id = rr.order_id AND pt2.am_status = 'RECEVIED')`;
const RR_REFUNDED = `(SELECT IFNULL(SUM(rt2.amount), 0) FROM refund_transactions rt2 WHERE rt2.refund_request_id = rr.refund_request_id AND rt2.status = 'REFUNDED')`;
const RR_ORDER_REFUNDED = `(SELECT IFNULL(SUM(rt3.amount), 0) FROM refund_transactions rt3 WHERE rt3.order_id = rr.order_id AND rt3.status = 'REFUNDED')`;
const RR_REMAINING = `IF(rr.status IN ('Pending', 'Accepted'), GREATEST(${RR_RECEIVED} - ${RR_ORDER_REFUNDED}, 0), 0)`;
DEFS.refunds = {
    title: 'Refund Reports',
    columns: [
        text('request_id', 'Request ID'), text('order_custom_id', 'Order ID'), when('requested_at', 'Requested'),
        text('client_name', 'Client'), text('rm_name', 'RM', { pdf: false }), text('company_name', 'Company', { pdf: false }),
        text('request_reason', 'Reason'), status('status', 'Status'), money('received_amount', 'Received'),
        money('refunded_amount', 'Refunded'), money('remaining_amount', 'Remaining'),
        text('reviewed_by_name', 'Reviewed by', { pdf: false }), when('reviewed_at', 'Reviewed', { pdf: false }),
        text('review_remark', 'Review remark', { pdf: false }),
    ],
    joi: { status: en('Pending', 'Accepted', 'Rejected', 'Completed'), rm_id: idNum() },
    from: `FROM refund_requests rr
    JOIN order_transactions ot ON ot.order_id = rr.order_id ${ORDER_JOINS}
    LEFT JOIN users rv ON rv.user_id = rr.reviewed_by`,
    // Request ID RF_MMYY_XX (migration 008, made by the database trigger). Without the column the numeric id is shown instead.
    needs: [['refund_requests', 'request_id', 'request_id']],
    selectFn: (has) => `${has.request_id ? 'COALESCE(rr.request_id, CAST(rr.refund_request_id AS CHAR))' : 'CAST(rr.refund_request_id AS CHAR)'} AS request_id,
        ot.order_custom_id AS order_custom_id, ${FMT('rr.requested_datetime')} AS requested_at,
        ${NAME('u')} AS client_name, ${NAME('rm')} AS rm_name, sd.company_name AS company_name,
        rr.request_reason AS request_reason, rr.status AS status, ${RR_RECEIVED} AS received_amount,
        ${RR_REFUNDED} AS refunded_amount, ${RR_REMAINING} AS remaining_amount,
        ${NAME('rv')} AS reviewed_by_name, ${FMT('rr.reviewed_datetime')} AS reviewed_at, rr.review_remark AS review_remark`,
    dateExpr: 'rr.requested_datetime',
    scope: scopeOwner,
    search: ['ot.order_custom_id', NAME('u'), 'sd.company_name', 'rr.request_reason'],
    searchFn: (has) => ['ot.order_custom_id', NAME('u'), 'sd.company_name', 'rr.request_reason', ...(has.request_id ? ['rr.request_id'] : [])],
    filters: (f, actor) => [f.status && `rr.status = ${sqlStr(f.status)}`, rmFilter(f, actor)],
    orderBy: 'rr.refund_request_id DESC',
    summary: [
        count('total', 'Requests', { expr: 'COUNT(*)' }),
        count('active', 'Pending / accepted', { expr: `IFNULL(SUM(rr.status IN ('Pending', 'Accepted')), 0)` }),
        count('rejected', 'Rejected', { expr: `IFNULL(SUM(rr.status = 'Rejected'), 0)` }),
        count('completed', 'Completed', { expr: `IFNULL(SUM(rr.status = 'Completed'), 0)` }),
        money('refunded_total', 'Refunded', { expr: `IFNULL(SUM(${RR_REFUNDED}), 0)` }),
        money('remaining_total', 'Remaining refundable', { expr: `IFNULL(SUM(${RR_REMAINING}), 0)` }),
    ],
};

/* ===== 4. Partners (one row per verified partner) ===== */
const PARTNER_DONE = `(pfd.aadhar_status = 'Verified' AND pfd.pan_status = 'Verified' AND pfd.cmr_status = 'Verified'
    AND pfd.stamp_signature_status = 'Verified' AND pfd.franchise_status = 'Verified'
    AND EXISTS (SELECT 1 FROM partner_bank_information pb WHERE pb.user_id = pu.user_id AND pb.verification_status = 'Verified'))`;
const PARTNER_BANK = `EXISTS (SELECT 1 FROM partner_bank_information pb2 WHERE pb2.user_id = pu.user_id AND pb2.verification_status = 'Verified')`;
const P_PROSPECTS = `(SELECT COUNT(*) FROM partner_prospects pr WHERE pr.user_id = pu.user_id AND pr.is_deleted = 0)`;
const P_ORDERS = `(SELECT COUNT(*) FROM partner_stock_orders pso WHERE pso.user_id = pu.user_id)`;
const P_DEALS = `(SELECT COUNT(*) FROM order_transactions ot WHERE ot.addedPartnerID = pu.user_id AND NOT ${CLOSED})`;
const P_BUSINESS = `(SELECT IFNULL(SUM(${VALUE}), 0) FROM order_transactions ot WHERE ot.addedPartnerID = pu.user_id AND NOT ${CLOSED})`;
DEFS.partners = {
    title: 'Partner Reports',
    columns: [
        text('user_custum_id', 'Partner ID'), text('partner_name', 'Partner'), text('phone_number', 'Phone', { pdf: false }),
        text('email', 'Email', { pdf: false }), text('rm_name', 'RM'), text('business_type', 'Business type', { pdf: false }),
        status('aadhar_status', 'Aadhar', { pdf: false }), status('pan_status', 'PAN', { pdf: false }), status('cmr_status', 'CMR', { pdf: false }),
        status('stamp_signature_status', 'Stamp', { pdf: false }), status('franchise_status', 'Franchise'),
        status('bank_status', 'Bank'), status('access', 'Access'), count('prospects', 'Prospects'),
        count('partner_orders', 'Partner orders'), count('deals', 'Orders'), money('business_value', 'Business'),
    ],
    joi: { franchise_status: en('Pending', 'Verified', 'Rejected'), access: en('unlocked', 'locked'), rm_id: idNum() },
    from: `FROM users pu
    LEFT JOIN users rm ON rm.user_id = pu.assign_to
    LEFT JOIN (SELECT user_id, MIN(partner_financial_id) AS mid FROM partner_financial_details WHERE is_deleted = 0 GROUP BY user_id) pm ON pm.user_id = pu.user_id
    LEFT JOIN partner_financial_details pfd ON pfd.partner_financial_id = pm.mid`,
    select: `pu.user_custum_id AS user_custum_id, ${NAME('pu')} AS partner_name, pu.phone_number AS phone_number, pu.email AS email,
        ${NAME('rm')} AS rm_name, pfd.business_type AS business_type, pfd.aadhar_status AS aadhar_status, pfd.pan_status AS pan_status,
        pfd.cmr_status AS cmr_status, pfd.stamp_signature_status AS stamp_signature_status, pfd.franchise_status AS franchise_status,
        IF(${PARTNER_BANK}, 'Verified', 'Not verified') AS bank_status, IF(${PARTNER_DONE}, 'Unlocked', 'Locked') AS access,
        ${P_PROSPECTS} AS prospects, ${P_ORDERS} AS partner_orders, ${P_DEALS} AS deals, ${P_BUSINESS} AS business_value`,
    dateExpr: IST('pu.created_at'),
    baseWhere: `pu.user_type = 'PARTNER' AND pu.is_deleted = 0 AND pu.is_verified = 1`,
    scope: (actor) => (actor.user_type === 'RM' ? `pu.assign_to = ${Number(actor.user_id)}` : null),
    search: [NAME('pu'), 'pu.user_custum_id', 'pu.phone_number', 'pu.email'],
    filters: (f, actor) => [
        f.franchise_status && `pfd.franchise_status = ${sqlStr(f.franchise_status)}`,
        f.access === 'unlocked' && PARTNER_DONE,
        f.access === 'locked' && `NOT IFNULL(${PARTNER_DONE}, 0)`,
        f.rm_id && actor.user_type !== 'RM' && `pu.assign_to = ${Number(f.rm_id)}`,
    ],
    orderBy: 'pu.user_id DESC',
    summary: [
        count('total', 'Partners', { expr: 'COUNT(*)' }),
        count('unlocked', 'Access unlocked', { expr: `IFNULL(SUM(IFNULL(${PARTNER_DONE}, 0)), 0)` }),
        count('franchise_verified', 'Franchise verified', { expr: `IFNULL(SUM(pfd.franchise_status = 'Verified'), 0)` }),
        count('prospects', 'Prospects', { expr: `IFNULL(SUM(${P_PROSPECTS}), 0)` }),
        count('deals', 'Orders', { expr: `IFNULL(SUM(${P_DEALS}), 0)` }),
        money('business', 'Business value', { expr: `IFNULL(SUM(${P_BUSINESS}), 0)` }),
    ],
};

/* ===== 6. Share Debit ===== */
DEFS['share-debit'] = {
    title: 'Share Debit Reports',
    columns: [
        text('share_debit_invoice', 'Share Debit ID'), text('order_custom_id', 'Order ID'), when('transfer_date', 'Transfer date'),
        text('client_name', 'Client'), text('rm_name', 'RM', { pdf: false }), text('partner_name', 'Partner', { pdf: false }),
        text('company_name', 'Company'), text('isin_no', 'ISIN', { pdf: false }), text('broker_name', 'Broker', { pdf: false }),
        status('transaction_type', 'Type'), count('quantity', 'Qty'), money('price', 'Price'), money('order_value', 'Value'),
        status('document', 'Document', { pdf: false }),
    ],
    joi: {
        transaction_type: en('BUY', 'SELL'), broker_id: idNum(), partner_id: idNum(), rm_id: idNum(),
        source: en('partner', 'direct'), has_document: en('yes', 'no'),
    },
    from: `FROM order_transactions ot ${ORDER_JOINS}
    LEFT JOIN broker br ON br.broker_id = ot.broker_id`,
    select: `ot.share_Debit_Invoice AS share_debit_invoice, ot.order_custom_id AS order_custom_id,
        ${FMT(`IFNULL(ot.st_datetime, ${CREATED_IST})`)} AS transfer_date, ${NAME('u')} AS client_name, ${NAME('rm')} AS rm_name,
        ${NAME('p')} AS partner_name, sd.company_name AS company_name, sd.isin_no AS isin_no, br.broker_name AS broker_name,
        ot.transaction_type AS transaction_type, ot.quantity AS quantity, ot.price_per_share AS price, ${VALUE} AS order_value,
        IF(ot.share_Debit_Path IS NULL OR ot.share_Debit_Path = '', 'No', 'Yes') AS document`,
    dateExpr: `IFNULL(ot.st_datetime, ${CREATED_IST})`,
    baseWhere: `ot.share_Debit_Invoice IS NOT NULL AND ot.share_Debit_Invoice <> ''`,
    scope: scopeOwner,
    search: ['ot.share_Debit_Invoice', 'ot.order_custom_id', NAME('u'), 'sd.company_name', 'sd.isin_no'],
    filters: (f, actor) => [
        f.transaction_type && `ot.transaction_type = ${sqlStr(f.transaction_type)}`,
        f.broker_id && `ot.broker_id = ${Number(f.broker_id)}`,
        f.partner_id && `ot.addedPartnerID = ${Number(f.partner_id)}`,
        sourceFilter(f),
        f.has_document === 'yes' && `(ot.share_Debit_Path IS NOT NULL AND ot.share_Debit_Path <> '')`,
        f.has_document === 'no' && `(ot.share_Debit_Path IS NULL OR ot.share_Debit_Path = '')`,
        rmFilter(f, actor),
    ],
    orderBy: 'ot.order_id DESC',
    summary: [
        count('total', 'Share Debit IDs', { expr: 'COUNT(*)' }),
        count('quantity', 'Total quantity', { expr: 'IFNULL(SUM(ot.quantity), 0)' }),
        money('total_value', 'Total value', { expr: `IFNULL(SUM(${VALUE}), 0)` }),
        money('buy_value', 'Buy value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'BUY', ${VALUE}, 0)), 0)` }),
        money('sell_value', 'Sell value', { expr: `IFNULL(SUM(IF(ot.transaction_type = 'SELL', ${VALUE}, 0)), 0)` }),
        count('with_document', 'With document', { expr: `IFNULL(SUM(ot.share_Debit_Path IS NOT NULL AND ot.share_Debit_Path <> ''), 0)` }),
    ],
};

/* ===== 7. Prospects ===== */
const PR_STOCKS = `(SELECT COUNT(*) FROM partner_prospect_stocks s WHERE s.partner_prospect_id = pr.partner_prospect_id)`;
const PR_STOCK_NAMES = `(SELECT GROUP_CONCAT(DISTINCT s2.stock_name ORDER BY s2.stock_name SEPARATOR ', ') FROM partner_prospect_stocks s2 WHERE s2.partner_prospect_id = pr.partner_prospect_id)`;
const PR_ORDERS = `(SELECT COUNT(*) FROM partner_stock_orders pso WHERE pso.partner_prospect_id = pr.partner_prospect_id)`;
DEFS.prospects = {
    title: 'Prospect Reports',
    columns: [
        count('partner_prospect_id', 'ID'), when('lead_date', 'Lead date'), text('partner_name', 'Partner'),
        text('client_name', 'Client / firm'), status('client_type', 'Client type', { pdf: false }), text('phone', 'Phone', { pdf: false }),
        text('email', 'Email', { pdf: false }), status('lead_type', 'Lead type'), status('lead_status', 'Lead status'),
        when('followup_date', 'Follow-up'), count('stocks_count', 'Stocks'), text('stock_names', 'Stock names', { pdf: false }),
        count('orders_count', 'Orders'), text('rm_name', 'RM', { pdf: false }),
    ],
    joi: {
        lead_type: en('Prospects', 'Converted', 'New Lead'), lead_status: en('Prospects', 'Deal Closed', 'Not Interested', 'In discussion'),
        partner_id: idNum(), rm_id: idNum(),
    },
    from: `FROM partner_prospects pr
    JOIN users pu ON pu.user_id = pr.user_id
    LEFT JOIN users rm ON rm.user_id = pu.assign_to`,
    select: `pr.partner_prospect_id AS partner_prospect_id,
        DATE_FORMAT(COALESCE(pr.lead_creation_date, DATE(pr.created_at)), '%Y-%m-%d') AS lead_date, ${NAME('pu')} AS partner_name,
        pr.client_firm_name AS client_name, pr.client_type AS client_type, pr.phone AS phone, pr.email AS email,
        pr.lead_type AS lead_type, pr.lead_status AS lead_status, DATE_FORMAT(pr.followup_date, '%Y-%m-%d') AS followup_date,
        ${PR_STOCKS} AS stocks_count, ${PR_STOCK_NAMES} AS stock_names, ${PR_ORDERS} AS orders_count, ${NAME('rm')} AS rm_name`,
    dateExpr: `TIMESTAMP(COALESCE(pr.lead_creation_date, DATE(pr.created_at)))`,
    baseWhere: `pr.is_deleted = 0`,
    scope: (actor) => (actor.user_type === 'RM' ? `pu.assign_to = ${Number(actor.user_id)}` : null),
    search: ['pr.client_firm_name', 'pr.phone', 'pr.email', NAME('pu')],
    filters: (f, actor) => [
        f.lead_type && `pr.lead_type = ${sqlStr(f.lead_type)}`,
        f.lead_status && `pr.lead_status = ${sqlStr(f.lead_status)}`,
        f.partner_id && `pr.user_id = ${Number(f.partner_id)}`,
        f.rm_id && actor.user_type !== 'RM' && `pu.assign_to = ${Number(f.rm_id)}`,
    ],
    orderBy: 'pr.partner_prospect_id DESC',
    summary: [
        count('total', 'Prospects', { expr: 'COUNT(*)' }),
        count('type_prospects', 'Lead type: Prospects', { expr: `IFNULL(SUM(pr.lead_type = 'Prospects'), 0)` }),
        count('type_new', 'Lead type: New Lead', { expr: `IFNULL(SUM(pr.lead_type = 'New Lead'), 0)` }),
        count('type_converted', 'Lead type: Converted', { expr: `IFNULL(SUM(pr.lead_type = 'Converted'), 0)` }),
        count('deal_closed', 'Deal Closed', { expr: `IFNULL(SUM(pr.lead_status = 'Deal Closed'), 0)` }),
        count('in_discussion', 'In discussion', { expr: `IFNULL(SUM(pr.lead_status = 'In discussion'), 0)` }),
        count('not_interested', 'Not Interested', { expr: `IFNULL(SUM(pr.lead_status = 'Not Interested'), 0)` }),
    ],
};

/* ---------------- report definitions (calculated in JavaScript) ---------------- */
DEFS.commissions = {
    title: 'Commission Reports',
    columns: [
        text('order_custom_id', 'Order ID'), when('date', 'Date'), text('partner_name', 'Partner'), text('client_name', 'Client', { pdf: false }),
        text('company_name', 'Company', { pdf: false }), status('transaction_type', 'Type'), count('quantity', 'Qty', { pdf: false }),
        money('price_per_share', 'Price', { pdf: false }), money('partner_price', 'Partner price', { pdf: false }),
        money('commission_per_share', 'Per share', { pdf: false }), money('gross_commission', 'Commission'), status('status', 'Status'),
        count('tds_pct', 'TDS %', { pdf: false }), count('gst_pct', 'GST %', { pdf: false }), money('tds_amount', 'TDS', { pdf: false }),
        money('gst_amount', 'GST', { pdf: false }), money('payable_amount', 'Payable', { pdf: false }),
        text('invoice_no', 'Invoice'), text('payment_ref', 'Payment ref', { pdf: false }), status('partner_verification', 'Partner verified', { pdf: false }),
    ],
    joi: { status: en('paid', 'pending'), partner_id: idNum(), transaction_type: en('BUY', 'SELL'), verified: en('yes', 'no'), rm_id: idNum() },
    summary: [
        count('total', 'Orders'), money('gross_total', 'Gross commission'),
        count('paid_count', 'Paid orders'), money('paid_gross', 'Paid (gross)'),
        count('pending_count', 'Pending orders'), money('pending_gross', 'Pending (gross)'),
        money('tds_total', 'TDS (paid)'), money('gst_total', 'GST (paid)'), money('payable_total', 'Payable (paid)'),
    ],
    notes: [
        'Commission is gross, before TDS and GST, and uses the same formula as the partner commission screens (per share rounded to 2 decimals, times quantity).',
        'Paid means the AM recorded a commission payment for the order; pending means no payment is recorded yet.',
        'TDS, GST and Payable are shown for paid orders only, from the TDS and GST percentages saved with the payment.',
        'An order with no partner price is calculated with a partner price of 0, as the screens do.',
    ],
};

DEFS.financial = {
    title: 'Financial Reports',
    columns: [
        text('month', 'Month'), money('buy_received', 'Buy received'), money('buy_pending', 'Buy pending'),
        money('sell_paid_out', 'Sell paid out'), money('sell_pending', 'Sell pending payout'), money('refunds_processed', 'Refunds processed'),
        money('commission_paid', 'Commission paid'), money('commission_pending', 'Commission pending'),
        money('tds_deducted', 'TDS (paid)', { pdf: false }), money('gst_deducted', 'GST (paid)', { pdf: false }), money('net_flow', 'Net flow'),
    ],
    joi: {},
    summary: [
        money('buy_received', 'Buy received'), money('buy_pending', 'Buy pending'), money('sell_paid_out', 'Sell paid out'),
        money('sell_pending', 'Sell pending payout'), money('refunds_processed', 'Refunds processed'),
        money('commission_paid', 'Commission paid'), money('commission_pending', 'Commission pending'), money('net_flow', 'Net flow'),
    ],
    notes: [
        'Buy received and sell paid out count payments the AM confirmed (RECEVIED); pending counts payments still PENDING. NOT_RECEIVED payments are in the Payment report only.',
        'Refunds processed are refund slots with status REFUNDED. Commission is gross and follows the Commission report.',
        'Net flow = buy received - sell paid out - refunds processed - commission paid. It is a cash summary of the recorded transactions, not an accounting statement.',
        'With no date range the last 12 months are shown. Months are IST calendar months.',
    ],
};

DEFS.performance = {
    title: 'Employee Performance Reports',
    columns: [
        text('employee_id', 'Employee ID'), text('employee_name', 'Employee'), status('role', 'Role'), count('assigned_clients', 'Assigned clients'),
        count('orders', 'Orders'), money('order_value', 'Order value'), count('completed_orders', 'Completed'), count('partner_orders', 'Partner orders'),
        count('refunds_raised', 'Refunds raised'), count('refunds_reviewed', 'Refunds reviewed'), count('refunds_processed', 'Refunds processed'),
        money('refund_amount_processed', 'Refund amount processed'), count('payments_actioned', 'Payments with recorded actor'),
    ],
    joi: { role: en('RM', 'AM', 'ST') },
    summary: [
        count('employees', 'Employees'), count('orders', 'Orders (RM owned)'), money('order_value', 'Order value (RM owned)'),
        count('completed_orders', 'Completed orders'), count('refunds_reviewed', 'Refunds reviewed'), count('refunds_processed', 'Refunds processed'),
    ],
    notes: [
        'Only data the database really records is reported. A dash means the database does not record that activity for that role.',
        'RM: orders are the orders whose owner RM is that RM (client assignment, else the partner assignment). Order date is the date range.',
        'AM: refund reviews and refund slots processed are recorded per user. Payments count only rows that carry a recorded acting user (last_action_by, migration 004).',
        'ST: the database does not record which ST user completed a share transfer, so no ST activity can be shown.',
        'The AM and ST stage completions on orders are not attributed to a person anywhere in the database, so they are not counted.',
    ],
};

/* ---------------- engines ---------------- */

function sqlWhere(def, f, actor, has = {}) {
    const conds = [def.baseWhere || '1 = 1'];
    const scope = def.scope && def.scope(actor, f);
    if (scope) conds.push(scope);
    if (def.dateExpr) {
        if (f.start) conds.push(`${def.dateExpr} >= ${sqlStr(f.start)}`);
        if (f.end) conds.push(`${def.dateExpr} < ${sqlStr(f.end)}`);
    }
    const searchCols = def.searchFn ? def.searchFn(has) : def.search;
    if (f.search && searchCols) conds.push(`(${searchCols.map((e) => `${e} LIKE ${likeStr(f.search)}`).join(' OR ')})`);
    (def.filters ? def.filters(f, actor) : []).forEach((c) => c && conds.push(c));
    return conds.map((c) => `(${c})`).join(' AND ');
}

/** Report whose rows and totals come straight from SQL. */
async function runSqlReport(def, f, actor, all, next) {
    const has = {};
    for (const [table, column, key] of def.needs || []) has[key] = await colExists(table, column, next);
    const where = sqlWhere(def, f, actor, has);
    const select = def.selectFn ? def.selectFn(has) : def.select;

    const totalRows = await getData(`SELECT COUNT(*) AS c ${def.from} WHERE ${where}`, next);
    const total = num(totalRows?.[0]?.c);
    const sumRows = await getData(
        `SELECT ${def.summary.map((s) => `${s.expr} AS ${s.key}`).join(', ')} ${def.from} WHERE ${where}`,
        next
    );
    const limit = all ? EXPORT_ROW_CAP : f.per_page;
    const offset = all ? 0 : (f.page - 1) * f.per_page;
    const rows = await getData(
        `SELECT ${select} ${def.from} WHERE ${where} ORDER BY ${def.orderBy} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
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

/* ----- commissions ----- */
async function loadCommissionRows(f, actor, next) {
    const hasInv = await colExists('order_transactions', 'commission_inv_number', next);
    const hasVerifiedAt = await colExists('order_transactions', 'partner_verified_at', next);
    const hasPayDate = await colExists('partner_commission', 'payment_date', next);

    const doneDate = `IFNULL(ot.st_datetime, ${CREATED_IST})`;
    const paidDate = hasPayDate ? `IFNULL(CAST(pc.payment_date AS DATETIME), ${IST('pc.created_at')})` : IST('pc.created_at');
    const dateExpr = `IF(pc.commission_id IS NULL, ${doneDate}, ${paidDate})`;

    const conds = [PARTNER_ELIGIBLE];
    const scope = scopeOwner(actor);
    if (scope) conds.push(scope);
    if (f.start) conds.push(`${dateExpr} >= ${sqlStr(f.start)}`);
    if (f.end) conds.push(`${dateExpr} < ${sqlStr(f.end)}`);
    if (f.search) {
        const cols = ['ot.order_custom_id', NAME('p'), NAME('u'), 'sd.company_name', 'pc.inv_number', hasInv ? 'ot.commission_inv_number' : null].filter(Boolean);
        conds.push(`(${cols.map((e) => `${e} LIKE ${likeStr(f.search)}`).join(' OR ')})`);
    }
    if (f.status === 'paid') conds.push('pc.commission_id IS NOT NULL');
    if (f.status === 'pending') conds.push('pc.commission_id IS NULL');
    if (f.partner_id) conds.push(`ot.addedPartnerID = ${Number(f.partner_id)}`);
    if (f.transaction_type) conds.push(`ot.transaction_type = ${sqlStr(f.transaction_type)}`);
    if (f.verified === 'yes') conds.push('ot.verify IN (1, 2)');
    if (f.verified === 'no') conds.push('ot.verify = 0');
    const rmc = rmFilter(f, actor);
    if (rmc) conds.push(rmc);

    const rows = await getData(
        `SELECT ot.order_custom_id, ot.transaction_type, ot.quantity, ot.price_per_share, ot.partner_price, ot.verify,
                ${NAME('p')} AS partner_name, ${NAME('u')} AS client_name, sd.company_name,
                ${FMT(dateExpr)} AS row_date,
                pc.commission_id, pc.tds, pc.gst, pc.payment_id AS payment_ref, pc.inv_number,
                ${hasInv ? 'ot.commission_inv_number' : 'NULL'} AS order_inv,
                ${hasVerifiedAt ? FMT('ot.partner_verified_at') : 'NULL'} AS partner_verified_at
         FROM order_transactions ot
         JOIN users u ON u.user_id = ot.user_id
         JOIN users p ON p.user_id = ot.addedPartnerID
         LEFT JOIN users rm ON rm.user_id = ${OWNER_RM}
         JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id
         LEFT JOIN (SELECT order_id, MIN(commission_id) AS cid FROM partner_commission GROUP BY order_id) pcm ON pcm.order_id = ot.order_id
         LEFT JOIN partner_commission pc ON pc.commission_id = pcm.cid
         WHERE ${conds.map((c) => `(${c})`).join(' AND ')}
         ORDER BY ot.order_id DESC`,
        next
    );

    return (rows || []).map((r) => {
        const perShare = commissionPerShare(r.partner_price, r.price_per_share, r.transaction_type);
        const gross = round2(perShare * Number(r.quantity || 0));
        const paid = !!r.commission_id;
        const ded = paid ? commissionDeductions(gross, r.tds, r.gst) : null;
        return {
            order_custom_id: r.order_custom_id,
            date: r.row_date,
            partner_name: r.partner_name,
            client_name: r.client_name,
            company_name: r.company_name,
            transaction_type: r.transaction_type,
            quantity: num(r.quantity),
            price_per_share: num(r.price_per_share),
            partner_price: num(r.partner_price),
            commission_per_share: perShare,
            gross_commission: gross,
            status: paid ? 'Paid' : 'Pending',
            tds_pct: paid ? num(r.tds) : null,
            gst_pct: paid ? num(r.gst) : null,
            tds_amount: ded ? ded.tds_amount : null,
            gst_amount: ded ? ded.gst_amount : null,
            payable_amount: ded ? ded.payable_amount : null,
            invoice_no: (paid && r.inv_number) || r.order_inv || null,
            payment_ref: paid ? r.payment_ref : null,
            partner_verification: Number(r.verify) >= 1 ? 'Verified' : 'Not verified',
            _partner_verified_at: r.partner_verified_at,
        };
    });
}

function commissionSummary(rows) {
    const paid = rows.filter((r) => r.status === 'Paid');
    const pending = rows.filter((r) => r.status !== 'Paid');
    const sum = (list, k) => round2(list.reduce((s, r) => s + num(r[k]), 0));
    return {
        total: rows.length, gross_total: sum(rows, 'gross_commission'),
        paid_count: paid.length, paid_gross: sum(paid, 'gross_commission'),
        pending_count: pending.length, pending_gross: sum(pending, 'gross_commission'),
        tds_total: sum(paid, 'tds_amount'), gst_total: sum(paid, 'gst_amount'), payable_total: sum(paid, 'payable_amount'),
    };
}

async function runCommissions(def, f, actor, all, next) {
    const rows = await loadCommissionRows(f, actor, next);
    const values = commissionSummary(rows);
    return {
        rows: slicePage(rows, f, all).map(({ _partner_verified_at, ...r }) => r),
        total: rows.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: num(values[s.key]) })),
        truncated: all && rows.length > EXPORT_ROW_CAP,
    };
}

/* ----- financial (by month) ----- */
function monthKeys(startStr, endStr) {
    const keys = [];
    const s = new Date(`${startStr.slice(0, 7)}-01T00:00:00Z`);
    const e = new Date(`${endStr.slice(0, 10)}T00:00:00Z`); // exclusive end
    for (let d = new Date(s); d < e; d.setUTCMonth(d.getUTCMonth() + 1)) keys.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
    return keys;
}
const monthLabel = (key) => `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

async function runFinancial(def, f, actor, all, next) {
    // default range: the last 12 IST months, current month included
    let start = f.start;
    let end = f.end;
    if (!start && !end) {
        const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
        const next1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        start = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01 00:00:00`;
        end = `${next1.getUTCFullYear()}-${pad(next1.getUTCMonth() + 1)}-01 00:00:00`;
    }
    if (!start) {
        // only a "to" date was given: show the 12 months that end with it
        const e = new Date(`${end.slice(0, 10)}T00:00:00Z`);
        e.setUTCDate(e.getUTCDate() - 1);
        const first = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 11, 1));
        start = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01 00:00:00`;
    }
    if (!end) {
        const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        end = `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)} 00:00:00`;
    }

    const scope = scopeOwner(actor);
    const scopeSql = scope ? ` AND ${scope}` : '';
    const byKey = {};
    const bucket = (key) =>
        (byKey[key] ||= {
            month: monthLabel(key), buy_received: 0, buy_pending: 0, sell_paid_out: 0, sell_pending: 0,
            refunds_processed: 0, commission_paid: 0, commission_pending: 0, tds_deducted: 0, gst_deducted: 0, net_flow: 0,
        });
    monthKeys(start, end).forEach(bucket);

    const pay = await getData(
        `SELECT DATE_FORMAT(${PAY_DATE}, '%Y-%m') AS ym, ot.transaction_type AS t, pt.am_status AS s, IFNULL(SUM(pt.amount), 0) AS a
         FROM payment_transactions pt
         JOIN order_transactions ot ON ot.order_id = pt.order_id
         JOIN users u ON u.user_id = ot.user_id
         LEFT JOIN users p ON p.user_id = ot.addedPartnerID
         WHERE ot.rm_status NOT IN ('CANCEL', 'REJECTED') AND pt.am_status IN ('RECEVIED', 'PENDING')${scopeSql}${rangeCond(PAY_DATE, start, end)}
         GROUP BY ym, t, s`,
        next
    );
    (pay || []).forEach((r) => {
        const b = byKey[r.ym];
        if (!b) return;
        const key = r.t === 'BUY' ? (r.s === 'RECEVIED' ? 'buy_received' : 'buy_pending') : (r.s === 'RECEVIED' ? 'sell_paid_out' : 'sell_pending');
        b[key] += num(r.a);
    });

    const ref = await getData(
        `SELECT DATE_FORMAT(${REFUND_DATE}, '%Y-%m') AS ym, IFNULL(SUM(rt.amount), 0) AS a
         FROM refund_transactions rt
         JOIN order_transactions ot ON ot.order_id = rt.order_id
         JOIN users u ON u.user_id = ot.user_id
         LEFT JOIN users p ON p.user_id = ot.addedPartnerID
         WHERE rt.status = 'REFUNDED'${scopeSql}${rangeCond(REFUND_DATE, start, end)}
         GROUP BY ym`,
        next
    );
    (ref || []).forEach((r) => { if (byKey[r.ym]) byKey[r.ym].refunds_processed += num(r.a); });

    const comm = await loadCommissionRows({ start, end }, actor, next);
    comm.forEach((r) => {
        const b = byKey[String(r.date).slice(0, 7)];
        if (!b) return;
        if (r.status === 'Paid') {
            b.commission_paid += r.gross_commission;
            b.tds_deducted += num(r.tds_amount);
            b.gst_deducted += num(r.gst_amount);
        } else {
            b.commission_pending += r.gross_commission;
        }
    });

    const months = Object.keys(byKey).sort().reverse().map((k) => {
        const b = byKey[k];
        Object.keys(b).forEach((c) => { if (typeof b[c] === 'number') b[c] = round2(b[c]); });
        b.net_flow = round2(b.buy_received - b.sell_paid_out - b.refunds_processed - b.commission_paid);
        return b;
    });
    const totals = {};
    def.summary.forEach((s) => { totals[s.key] = round2(months.reduce((sum, m) => sum + num(m[s.key]), 0)); });

    return {
        rows: slicePage(months, f, all),
        total: months.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: totals[s.key] })),
        truncated: false,
        range: { from: start.slice(0, 10), to_exclusive: end.slice(0, 10) },
    };
}

/* ----- employee performance ----- */
async function runPerformance(def, f, actor, all, next) {
    const hasActor = await colExists('payment_transactions', 'last_action_by', next);
    const rc = (expr) => rangeCond(expr, f.start, f.end);

    const conds = [`e.user_type IN ('RM', 'AM', 'ST')`, 'e.is_deleted = 0', 'e.is_verified = 1'];
    if (actor.user_type === 'RM') conds.push(`e.user_id = ${Number(actor.user_id)}`);
    if (f.role) conds.push(`e.user_type = ${sqlStr(f.role)}`);
    if (f.search) conds.push(`(${[NAME('e'), 'e.user_custum_id', 'e.username'].map((x) => `${x} LIKE ${likeStr(f.search)}`).join(' OR ')})`);

    const ownedOrders = (extraSelect, extraWhere = '') => `(SELECT ${extraSelect}
        FROM order_transactions ot
        JOIN users u ON u.user_id = ot.user_id
        LEFT JOIN users p ON p.user_id = ot.addedPartnerID
        WHERE ${OWNER_RM} = e.user_id AND NOT ${CLOSED}${extraWhere}${rc(CREATED_IST)})`;

    const rows = await getData(
        `SELECT e.user_custum_id AS employee_id, ${NAME('e')} AS employee_name, e.user_type AS role,
            IF(e.user_type = 'RM', (SELECT COUNT(*) FROM users cu WHERE cu.assign_to = e.user_id AND cu.user_type = 'user' AND cu.is_deleted = 0 AND cu.is_verified = 1), NULL) AS assigned_clients,
            IF(e.user_type = 'RM', ${ownedOrders('COUNT(*)')}, NULL) AS orders,
            IF(e.user_type = 'RM', ${ownedOrders(`IFNULL(SUM(${VALUE}), 0)`)}, NULL) AS order_value,
            IF(e.user_type = 'RM', ${ownedOrders('COUNT(*)', ` AND ${ALL_DONE}`)}, NULL) AS completed_orders,
            IF(e.user_type = 'RM', ${ownedOrders('COUNT(*)', ' AND ot.addedPartnerID IS NOT NULL')}, NULL) AS partner_orders,
            IF(e.user_type = 'RM', (SELECT COUNT(*) FROM refund_requests rr WHERE rr.requested_by = e.user_id${rc('rr.requested_datetime')}), NULL) AS refunds_raised,
            IF(e.user_type = 'AM', (SELECT COUNT(*) FROM refund_requests rr WHERE rr.reviewed_by = e.user_id${rc('rr.reviewed_datetime')}), NULL) AS refunds_reviewed,
            IF(e.user_type = 'AM', (SELECT COUNT(*) FROM refund_transactions rt WHERE rt.processed_by = e.user_id AND rt.status = 'REFUNDED'${rc(REFUND_DATE)}), NULL) AS refunds_processed,
            IF(e.user_type = 'AM', (SELECT IFNULL(SUM(rt.amount), 0) FROM refund_transactions rt WHERE rt.processed_by = e.user_id AND rt.status = 'REFUNDED'${rc(REFUND_DATE)}), NULL) AS refund_amount_processed,
            ${hasActor ? `IF(e.user_type = 'AM', (SELECT COUNT(*) FROM payment_transactions pt WHERE pt.last_action_by = e.user_id${rc(IST('pt.updated_on'))}), NULL)` : 'NULL'} AS payments_actioned
         FROM users e
         WHERE ${conds.map((c) => `(${c})`).join(' AND ')}
         ORDER BY FIELD(e.user_type, 'RM', 'AM', 'ST'), e.user_id`,
        next
    );

    const list = (rows || []).map((r) => {
        const o = { ...r };
        ['assigned_clients', 'orders', 'order_value', 'completed_orders', 'partner_orders', 'refunds_raised', 'refunds_reviewed',
            'refunds_processed', 'refund_amount_processed', 'payments_actioned'].forEach((k) => {
            o[k] = r[k] === null || r[k] === undefined ? null : round2(num(r[k]));
        });
        return o;
    });
    const sumOf = (k) => round2(list.reduce((s, r) => s + num(r[k]), 0));
    const totals = {
        employees: list.length, orders: sumOf('orders'), order_value: sumOf('order_value'), completed_orders: sumOf('completed_orders'),
        refunds_reviewed: sumOf('refunds_reviewed'), refunds_processed: sumOf('refunds_processed'),
    };
    return {
        rows: slicePage(list, f, all),
        total: list.length,
        summary: def.summary.map((s) => ({ key: s.key, label: s.label, type: s.type, value: totals[s.key] })),
        truncated: false,
    };
}

const RUNNERS = { commissions: runCommissions, financial: runFinancial, performance: runPerformance };

async function runReport(key, f, actor, all, next) {
    const def = DEFS[key];
    return RUNNERS[key] ? RUNNERS[key](def, f, actor, all, next) : runSqlReport(def, f, actor, all, next);
}

/* ---------------- request handling ---------------- */
async function requireActor(req, key, next) {
    const actor = await refundHelper.getActor(req.user?._id, next);
    if (!actor || !REPORT_ROLES[key].includes(actor.user_type)) {
        next(new CustomErrorHandler(403, 'Your role cannot open this report'));
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
            const actor = await requireActor(req, key, next);
            if (!actor) return;
            const f = parseQuery(key, req, next);
            if (!f) return;
            const def = DEFS[key];
            const result = await runReport(key, f, actor, false, next);
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
    XLSX.utils.book_append_sheet(wb, ws, def.title.slice(0, 31));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportHandler(key) {
    return async (req, res, next) => {
        try {
            const actor = await requireActor(req, key, next);
            if (!actor) return;
            const f = parseQuery(key, req, next);
            if (!f) return;
            const def = DEFS[key];
            const result = await runReport(key, f, actor, true, next);

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
            res.setHeader('Content-Disposition', `attachment; filename="${key}-report.xlsx"`);
            return res.send(buffer);
        } catch (error) {
            next(error);
        }
    };
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const reportsController = {
    /* GET /reports/options : dropdown data for the report filters */
    async reportOptions(req, res, next) {
        try {
            const actor = await refundHelper.getActor(req.user?._id, next);
            if (!actor || !['RM', 'AM', 'ST'].includes(actor.user_type)) {
                return next(new CustomErrorHandler(403, 'Your role cannot open the reports'));
            }
            const advisors = await getData(`SELECT advisor_id AS id, advisor_name AS name FROM advisor ORDER BY advisor_name`, next);
            const brokers = await getData(`SELECT broker_id AS id, broker_name AS name FROM broker WHERE is_deleted = 0 ORDER BY broker_name`, next);
            const partners = await getData(
                `SELECT pu.user_id AS id, ${NAME('pu')} AS name FROM users pu
                 WHERE pu.user_type = 'PARTNER' AND pu.is_deleted = 0 AND pu.is_verified = 1
                   ${actor.user_type === 'RM' ? `AND pu.assign_to = ${Number(actor.user_id)}` : ''}
                 ORDER BY name`,
                next
            );
            const rms = actor.user_type === 'RM'
                ? []
                : await getData(`SELECT user_id AS id, ${NAME('users')} AS name FROM users WHERE user_type = 'RM' AND is_deleted = 0 AND is_verified = 1 ORDER BY name`, next);
            return res.json({
                success: true,
                data: { role: actor.user_type, allowed_reports: Object.keys(REPORT_ROLES).filter((k) => REPORT_ROLES[k].includes(actor.user_type)), advisors: advisors || [], brokers: brokers || [], partners: partners || [], rms: rms || [] },
            });
        } catch (error) {
            next(error);
        }
    },
};

Object.keys(DEFS).forEach((key) => {
    reportsController[`${camel(key)}Report`] = listHandler(key);
    reportsController[`${camel(key)}Export`] = exportHandler(key);
});

export { DEFS as REPORT_DEFS, REPORT_ROLES };
export default reportsController;
