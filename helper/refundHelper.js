import { getData, insertData } from '../config/index.js';

/*
 * Shared refund rules (used by refundController and transactionController).
 *
 * Definitions (agreed):
 *  - "received"  = sum of payment_transactions.amount where am_status = 'RECEVIED' (AM-confirmed slots only)
 *  - "refunded"  = sum of refund_transactions.amount where status = 'REFUNDED'
 *  - refundable  = received - refunded
 *  - rm_status / am_status / st_status are NEVER written by the refund flow.
 */

const toCents = (v) => Math.round(Number(v || 0) * 100);
const fromCents = (c) => Math.round(c) / 100;

const FULL_NAME = (alias) => `CONCAT_WS(' ', ${alias}.first_name, ${alias}.middle_name, ${alias}.last_name)`;

const refundHelper = {
    toCents,
    fromCents,

    /** Logged-in user read from the DB (the JWT role is not reliable: password-login tokens carry none). */
    async getActor(userId, next) {
        const id = Number(userId);
        if (!Number.isInteger(id) || id <= 0) return null;
        const rows = await getData(
            `SELECT user_id, user_type, ${FULL_NAME('users')} AS full_name
             FROM users WHERE user_id = ${id} AND is_deleted = 0 LIMIT 1`,
            next
        );
        return rows && rows.length ? rows[0] : null;
    },

    /** Order row + received / refunded totals. Returns null if the order does not exist. */
    async getContext(orderId, next) {
        const id = Number(orderId);
        if (!Number.isInteger(id) || id <= 0) return null;

        const orders = await getData(
            `SELECT ot.order_id, ot.user_id, ot.transaction_type, ot.rm_status, ot.am_status, ot.st_status,
                    ot.refund_status, ot.cancellation_status, ot.quantity, ot.price_per_share,
                    (ot.price_per_share * ot.quantity) AS deal_value, u.assign_to
             FROM order_transactions ot
             JOIN users u ON u.user_id = ot.user_id
             WHERE ot.order_id = ${id} LIMIT 1`,
            next
        );
        if (!orders || !orders.length) return null;

        const sums = await getData(
            `SELECT
                (SELECT IFNULL(SUM(amount), 0) FROM payment_transactions
                  WHERE order_id = ${id} AND am_status = 'RECEVIED') AS received,
                (SELECT IFNULL(SUM(amount), 0) FROM refund_transactions
                  WHERE order_id = ${id} AND status = 'REFUNDED') AS refunded`,
            next
        );
        const receivedCents = toCents(sums?.[0]?.received);
        const refundedCents = toCents(sums?.[0]?.refunded);

        return {
            order: orders[0],
            receivedCents,
            refundedCents,
            remainingCents: receivedCents - refundedCents,
        };
    },

    /** Can a NEW refund request be raised? (BUY only, never for completed orders) */
    checkEligibility(ctx) {
        const o = ctx.order;
        if (o.transaction_type !== 'BUY') return { eligible: false, reason: 'Refund is allowed only for BUY orders' };
        if (o.rm_status === 'COMPLETED' && o.am_status === 'COMPLETED' && o.st_status === 'COMPLETED') {
            return { eligible: false, reason: 'Completed orders cannot be refunded or cancelled' };
        }
        if (o.st_status === 'COMPLETED') return { eligible: false, reason: 'Share transfer is already completed' };
        if (o.rm_status !== 'COMPLETED') return { eligible: false, reason: 'Order is not approved by RM' };
        if (o.cancellation_status === 'COMPLETED' || o.refund_status === 'REFUNDED') {
            return { eligible: false, reason: 'Order is already refunded and cancelled' };
        }
        if (o.refund_status !== 'NONE') return { eligible: false, reason: 'A refund request is already active for this order' };
        if (ctx.receivedCents <= 0) return { eligible: false, reason: 'No AM-confirmed payment received for this order' };
        return { eligible: true, reason: null };
    },

    /** Existing "direct cancel / reject" by the RM stays as is when no payment was received. */
    isDirectCancelAllowed(ctx) {
        const o = ctx.order;
        if (o.transaction_type !== 'BUY') return true;
        if (o.refund_status !== 'NONE') return false;
        return ctx.receivedCents <= 0;
    },

    /**
     * Recompute refund_status / cancellation_status from the request and slot records and repair the
     * order (and request) if it is out of step. With migration 003 the database triggers already keep
     * these in sync inside the same statement, so this is a no-op read; it is the safety net if a
     * previous operation was interrupted or the triggers are missing.
     * Never touches rm_status / am_status / st_status. Returns { refund_status, cancellation_status } or null.
     */
    async reconcile(orderId, next) {
        const id = Number(orderId);
        if (!Number.isInteger(id) || id <= 0) return null;
        const ctx = await refundHelper.getContext(id, next);
        if (!ctx) return null;

        const reqs = await getData(
            `SELECT refund_request_id, status FROM refund_requests
             WHERE order_id = ${id} ORDER BY refund_request_id DESC`,
            next
        );
        const list = reqs || [];
        const accepted = list.find((r) => r.status === 'Accepted');
        const pending = list.find((r) => r.status === 'Pending');
        const completed = list.find((r) => r.status === 'Completed');

        let desired = { refund_status: 'NONE', cancellation_status: 'NONE' };
        let completeRequestId = null;
        if (completed) {
            desired = { refund_status: 'REFUNDED', cancellation_status: 'COMPLETED' };
        } else if (accepted) {
            if (ctx.receivedCents > 0 && ctx.refundedCents >= ctx.receivedCents) {
                desired = { refund_status: 'REFUNDED', cancellation_status: 'COMPLETED' };
                completeRequestId = accepted.refund_request_id;
            } else if (ctx.refundedCents > 0) {
                desired = { refund_status: 'PARTIALLY_REFUNDED', cancellation_status: 'IN_PROGRESS' };
            } else {
                desired = { refund_status: 'ACCEPTED', cancellation_status: 'IN_PROGRESS' };
            }
        } else if (pending) {
            desired = { refund_status: 'REQUESTED', cancellation_status: 'NONE' };
        }

        if (completeRequestId) {
            const r = await insertData(
                `UPDATE refund_requests SET ? WHERE refund_request_id = ${Number(completeRequestId)} AND status = 'Accepted'`,
                { status: 'Completed' },
                next
            );
            if (!r) return null;
        }
        if (
            ctx.order.refund_status !== desired.refund_status ||
            ctx.order.cancellation_status !== desired.cancellation_status
        ) {
            const r = await insertData(`UPDATE order_transactions SET ? WHERE order_id = ${id}`, desired, next);
            if (!r) return null;
        }
        return desired;
    },

    /** Everything the Order View needs (summary + requests + slots). */
    async getDetails(orderId, next) {
        const ctx = await refundHelper.getContext(orderId, next);
        if (!ctx) return null;
        const id = Number(orderId);
        const eligibility = refundHelper.checkEligibility(ctx);

        const requests = await getData(
            `SELECT rr.refund_request_id, rr.order_id, rr.request_reason, rr.status,
                    rr.requested_by, ${FULL_NAME('rq')} AS requested_by_name, rr.requested_datetime,
                    rr.reviewed_by, ${FULL_NAME('rv')} AS reviewed_by_name, rr.reviewed_datetime,
                    rr.review_remark, rr.refundable_amount
             FROM refund_requests rr
             LEFT JOIN users rq ON rq.user_id = rr.requested_by
             LEFT JOIN users rv ON rv.user_id = rr.reviewed_by
             WHERE rr.order_id = ${id}
             ORDER BY rr.refund_request_id DESC`,
            next
        );

        const transactions = await getData(
            `SELECT rt.refund_id, rt.refund_custom_id, rt.refund_request_id, rt.slot_no, rt.bank_id,
                    b.bank_name, b.account_type, b.ifsc_code,
                    CONCAT('XXXX', RIGHT(b.account_no, 4)) AS account_no_masked,
                    rt.amount, rt.remaining_refundable, rt.refund_type, rt.transaction_ref, rt.refund_doc,
                    rt.refund_Datetime, rt.remark, rt.processed_by, ${FULL_NAME('p')} AS processed_by_name,
                    rt.status, rt.created_at
             FROM refund_transactions rt
             LEFT JOIN user_bank_details b ON b.bank_id = rt.bank_id
             LEFT JOIN users p ON p.user_id = rt.processed_by
             WHERE rt.order_id = ${id}
             ORDER BY rt.refund_id ASC`,
            next
        );

        const active = (requests || []).find((r) => r.status === 'Pending' || r.status === 'Accepted');

        return {
            summary: {
                order_amount: Number(ctx.order.deal_value || 0),
                total_received: fromCents(ctx.receivedCents),
                total_refunded: fromCents(ctx.refundedCents),
                remaining_refundable: fromCents(ctx.remainingCents),
                refund_status: ctx.order.refund_status,
                cancellation_status: ctx.order.cancellation_status,
                refund_eligible: eligibility.eligible,
                refund_ineligible_reason: eligibility.reason,
                direct_cancel_allowed: refundHelper.isDirectCancelAllowed(ctx),
                active_request_id: active ? active.refund_request_id : null,
                active_request_status: active ? active.status : null,
            },
            requests: requests || [],
            transactions: transactions || [],
        };
    },
};

export default refundHelper;
