import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";
import paginationQuery from '../../helper/paginationQuery.js';
import refundHelper from '../../helper/refundHelper.js';

/*
 * Refund & Cancellation (BUY orders only).
 *  - RM raises a request            POST /refundRequest
 *  - AM accepts / rejects           POST /refundRequestReview
 *  - AM refunds in slots            POST /addRefundDetails
 *  - RM / AM / ADMIN list requests  GET  /refundRequests
 * Refund details for one order are returned by GET /stockOrderDetails (data.refundDetails).
 *
 * Rules:
 *  - roles are read from the users table for the token's user id (never from the request body);
 *  - rm_status / am_status / st_status are never written here, only refund_status and cancellation_status.
 */

const forbidden = (message) => new CustomErrorHandler(403, message);

const nowDate = () => new Date();

const refundController = {

    /* ---------------------------------------------------------------
       RM: raise a refund request
    --------------------------------------------------------------- */
    async raiseRefundRequest(req, res, next) {
        try {
            const schema = Joi.object({
                order_id: Joi.number().integer().required(),
                request_reason: Joi.string().trim().min(3).max(1000).required(),
            });
            const { error, value } = schema.validate(req.body ?? {});
            if (error) return next(error);

            const actor = await refundHelper.getActor(req.user?._id, next);
            if (!actor || actor.user_type !== 'RM') {
                return next(forbidden('Only RM can raise a refund request'));
            }

            // repair any state left by an interrupted earlier operation
            await refundHelper.reconcile(value.order_id, next);

            const ctx = await refundHelper.getContext(value.order_id, next);
            if (!ctx) return next(CustomErrorHandler.notFound('Order not found'));

            // RM can act only on clients assigned to this RM
            if (Number(ctx.order.assign_to) !== Number(actor.user_id)) {
                return next(forbidden('This order does not belong to a client assigned to you'));
            }

            const eligibility = refundHelper.checkEligibility(ctx);
            if (!eligibility.eligible) return next(CustomErrorHandler.badRequest(eligibility.reason));

            // friendly duplicate check (the database unique key is the real guard)
            const active = await getData(
                `SELECT refund_request_id FROM refund_requests
                 WHERE order_id = ${value.order_id} AND status IN ('Pending','Accepted') LIMIT 1`,
                next
            );
            if (active && active.length) {
                return next(CustomErrorHandler.alreadyExist('A refund request is already active for this order'));
            }

            const requestObj = {
                order_id: value.order_id,
                requested_by: actor.user_id,
                request_reason: value.request_reason,
                requested_datetime: nowDate(),
                status: 'Pending',
            };
            const result = await insertData(`INSERT INTO refund_requests SET ?`, requestObj, next);
            if (!result || !result.insertId) return; // error already forwarded by insertData

            // The order moves to REQUESTED inside the same INSERT (trigger after_insert_refund_requests, migration 003).
            // reconcile() is a no-op then; it repairs the order if the trigger is missing.
            const settled = await refundHelper.reconcile(value.order_id, next);
            if (!settled) return;

            // the id RF_MMYY_XX is made by the database trigger (migration 008); it is only read back here
            const requestId = await refundHelper.getRequestId(result.insertId, next);
            return res.json({
                success: true,
                message: 'Refund request raised successfully',
                data: { refund_request_id: result.insertId, request_id: requestId, order_id: value.order_id, refund_status: settled.refund_status },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
       AM: accept / reject a refund request
    --------------------------------------------------------------- */
    async reviewRefundRequest(req, res, next) {
        try {
            const schema = Joi.object({
                refund_request_id: Joi.number().integer().required(),
                decision: Joi.string().valid('Accept', 'Reject').required(),
                review_remark: Joi.when('decision', {
                    is: 'Reject',
                    then: Joi.string().trim().min(3).max(1000).required(),
                    otherwise: Joi.string().trim().allow('').max(1000).optional(),
                }),
            });
            const { error, value } = schema.validate(req.body ?? {});
            if (error) return next(error);

            const actor = await refundHelper.getActor(req.user?._id, next);
            if (!actor || actor.user_type !== 'AM') {
                return next(forbidden('Only AM can accept or reject a refund request'));
            }

            const reqRows = await getData(
                `SELECT refund_request_id, order_id, status FROM refund_requests
                 WHERE refund_request_id = ${value.refund_request_id} LIMIT 1`,
                next
            );
            if (!reqRows || !reqRows.length) return next(CustomErrorHandler.notFound('Refund request not found'));
            const request = reqRows[0];
            if (request.status !== 'Pending') {
                return next(CustomErrorHandler.badRequest(`Refund request is already ${request.status}`));
            }

            await refundHelper.reconcile(request.order_id, next);
            const ctx = await refundHelper.getContext(request.order_id, next);
            if (!ctx) return next(CustomErrorHandler.notFound('Order not found'));

            const reviewObj = {
                reviewed_by: actor.user_id,
                reviewed_datetime: nowDate(),
                review_remark: value.review_remark || null,
            };

            if (value.decision === 'Accept') {
                const o = ctx.order;
                if (o.transaction_type !== 'BUY') return next(CustomErrorHandler.badRequest('Refund is allowed only for BUY orders'));
                if (o.st_status === 'COMPLETED' || (o.rm_status === 'COMPLETED' && o.am_status === 'COMPLETED' && o.st_status === 'COMPLETED')) {
                    return next(CustomErrorHandler.badRequest('Completed orders cannot be refunded or cancelled'));
                }
                if (o.refund_status !== 'REQUESTED') return next(CustomErrorHandler.badRequest('Order is not in refund requested state'));
                if (ctx.receivedCents <= 0) return next(CustomErrorHandler.badRequest('No AM-confirmed payment received for this order'));

                const r1 = await insertData(
                    `UPDATE refund_requests SET ? WHERE refund_request_id = ${request.refund_request_id} AND status = 'Pending'`,
                    { ...reviewObj, status: 'Accepted', refundable_amount: refundHelper.fromCents(ctx.receivedCents) },
                    next
                );
                if (!r1) return;
                if (r1.affectedRows === 0) return next(CustomErrorHandler.badRequest('Refund request was already reviewed'));
                // order -> ACCEPTED / IN_PROGRESS is done by trigger after_update_refund_requests in the same statement
            } else {
                const r1 = await insertData(
                    `UPDATE refund_requests SET ? WHERE refund_request_id = ${request.refund_request_id} AND status = 'Pending'`,
                    { ...reviewObj, status: 'Rejected' },
                    next
                );
                if (!r1) return;
                if (r1.affectedRows === 0) return next(CustomErrorHandler.badRequest('Refund request was already reviewed'));
                // order goes back to NONE (trigger after_update_refund_requests); the RM may raise a new request later
            }
            // no-op when the triggers exist; repairs the order if they are missing
            if (!(await refundHelper.reconcile(request.order_id, next))) return;

            const requestId = await refundHelper.getRequestId(request.refund_request_id, next);
            return res.json({
                success: true,
                message: value.decision === 'Accept' ? 'Refund request accepted' : 'Refund request rejected',
                data: { refund_request_id: request.refund_request_id, request_id: requestId, order_id: request.order_id },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
       AM: add a refund slot (many per order)
    --------------------------------------------------------------- */
    async addRefundDetails(req, res, next) {
        try {
            const schema = Joi.object({
                order_id: Joi.number().integer().required(),
                refund_request_id: Joi.number().integer().required(),
                bank_id: Joi.number().integer().required(),
                amount: Joi.number().positive().precision(2).required(),
                refund_type: Joi.string().valid('FULL', 'PARTIAL').required(),
                refund_Datetime: Joi.string().required(),
                transaction_ref: Joi.string().trim().allow('').max(200).optional(),
                remark: Joi.string().trim().allow('', null).max(1000).optional(),
                refund_doc: Joi.string().allow('').optional(),
            });

            const dataObj = { ...req.body };
            if (req.files?.refund_doc?.length > 0) {
                dataObj.refund_doc = `uploads/upload/${req.files.refund_doc[0].filename}`;
            }
            const { error, value } = schema.validate(dataObj);
            if (error) return next(error);

            const actor = await refundHelper.getActor(req.user?._id, next);
            if (!actor || actor.user_type !== 'AM') {
                return next(forbidden('Only AM can process refunds'));
            }

            await refundHelper.reconcile(value.order_id, next);
            const ctx = await refundHelper.getContext(value.order_id, next);
            if (!ctx) return next(CustomErrorHandler.notFound('Order not found'));
            const o = ctx.order;

            if (o.transaction_type !== 'BUY') return next(CustomErrorHandler.badRequest('Refund is allowed only for BUY orders'));
            if (o.st_status === 'COMPLETED' || (o.rm_status === 'COMPLETED' && o.am_status === 'COMPLETED' && o.st_status === 'COMPLETED')) {
                return next(CustomErrorHandler.badRequest('Completed orders cannot be refunded'));
            }
            if (o.refund_status === 'REFUNDED' || o.cancellation_status === 'COMPLETED') {
                return next(CustomErrorHandler.badRequest('Order is already fully refunded'));
            }
            if (!['ACCEPTED', 'PARTIALLY_REFUNDED'].includes(o.refund_status)) {
                return next(CustomErrorHandler.badRequest('Refund request is not accepted yet'));
            }

            const reqRows = await getData(
                `SELECT refund_request_id, status FROM refund_requests
                 WHERE refund_request_id = ${value.refund_request_id} AND order_id = ${value.order_id} LIMIT 1`,
                next
            );
            if (!reqRows || !reqRows.length || reqRows[0].status !== 'Accepted') {
                return next(CustomErrorHandler.badRequest('No accepted refund request found for this order'));
            }

            // refund goes to one of the client's own bank accounts
            const bankRows = await getData(
                `SELECT bank_id FROM user_bank_details
                 WHERE bank_id = ${value.bank_id} AND user_id = ${o.user_id} AND is_deleted = 0 LIMIT 1`,
                next
            );
            if (!bankRows || !bankRows.length) return next(CustomErrorHandler.badRequest('Selected bank does not belong to this client'));

            const amountCents = refundHelper.toCents(value.amount);
            if (amountCents <= 0) return next(CustomErrorHandler.badRequest('Refund amount must be greater than zero'));
            if (amountCents > ctx.remainingCents) {
                return next(CustomErrorHandler.badRequest(
                    `Refund exceeds remaining refundable amount. Remaining: ${refundHelper.fromCents(ctx.remainingCents)}`
                ));
            }
            const isFinal = amountCents === ctx.remainingCents; // only decides the FULL / PARTIAL type of this slot
            if (value.refund_type === 'FULL' && !isFinal) {
                return next(CustomErrorHandler.badRequest(
                    `FULL refund must equal the remaining refundable amount (${refundHelper.fromCents(ctx.remainingCents)})`
                ));
            }

            const slot = {
                refund_request_id: value.refund_request_id,
                order_id: value.order_id,
                bank_id: value.bank_id,
                amount: refundHelper.fromCents(amountCents),
                refund_type: isFinal ? 'FULL' : 'PARTIAL',
                transaction_ref: value.transaction_ref || null,
                refund_doc: value.refund_doc || null,
                refund_Datetime: value.refund_Datetime,
                remark: value.remark || null,
                processed_by: actor.user_id,
                status: 'REFUNDED',
                created_at: nowDate(),
            };
            // the database trigger re-checks every rule above, then sets refund_custom_id, slot_no, remaining_refundable
            const result = await insertData(`INSERT INTO refund_transactions SET ?`, slot, next);
            if (!result || !result.insertId) return;

            // Slot insert + order statuses + request completion happen in ONE statement:
            // trigger after_insert_refund_transactions (migration 003) updates order_transactions and refund_requests.
            // reconcile() is a no-op then; it repairs the state if the trigger is missing or an earlier step was interrupted.
            const settled = await refundHelper.reconcile(value.order_id, next);
            if (!settled) return;
            const after = await refundHelper.getContext(value.order_id, next);
            const isDone = settled.refund_status === 'REFUNDED';

            return res.json({
                success: true,
                message: isDone ? 'Refund completed. Order cancellation completed.' : 'Refund slot added successfully',
                data: {
                    refund_id: result.insertId,
                    order_id: value.order_id,
                    refund_status: settled.refund_status,
                    cancellation_status: settled.cancellation_status,
                    remaining_refundable: refundHelper.fromCents(after ? after.remainingCents : ctx.remainingCents - amountCents),
                },
            });
        } catch (error) {
            next(error);
        }
    },

    /* ---------------------------------------------------------------
       RM (own clients) / AM / ADMIN: list refund requests
    --------------------------------------------------------------- */
    async getRefundRequests(req, res, next) {
        try {
            const schema = Joi.object({
                status: Joi.string().valid('Pending', 'Accepted', 'Rejected', 'Completed', 'Active').optional(),
                order_id: Joi.string().optional(),          // order_custom_id search
                searchUser: Joi.string().optional(),
                company_name: Joi.string().optional(),
                broker_id: Joi.number().integer().optional(),
                advisor_id: Joi.number().integer().optional(),
                partner_id: Joi.number().integer().optional(),
                from_date: Joi.string().optional(),
                to_date: Joi.string().optional(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });
            const { error, value } = schema.validate(req.query ?? {});
            if (error) return next(error);

            const actor = await refundHelper.getActor(req.user?._id, next);
            if (!actor || !['RM', 'AM', 'ADMIN'].includes(actor.user_type)) {
                return next(forbidden('Not allowed to view refund requests'));
            }

            const hasRequestId = await refundHelper.hasRequestId(next);
            let query = `
                SELECT
                    rr.refund_request_id, ${refundHelper.requestIdSql('rr', hasRequestId)} AS request_id,
                    rr.order_id, ot.order_custom_id, rr.status AS request_status,
                    rr.request_reason, rr.requested_datetime, rr.reviewed_datetime, rr.review_remark,
                    CONCAT_WS(' ', rq.first_name, rq.middle_name, rq.last_name) AS requested_by_name,
                    CONCAT_WS(' ', rv.first_name, rv.middle_name, rv.last_name) AS reviewed_by_name,
                    c.user_id AS client_id, c.user_custum_id,
                    CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name) AS client_name,
                    c.phone_number AS client_phone,
                    st.company_name, ot.quantity, ot.price_per_share AS stock_price,
                    (ot.price_per_share * ot.quantity) AS deal_value,
                    ot.rm_status, ot.am_status, ot.st_status, ot.refund_status, ot.cancellation_status,
                    (SELECT IFNULL(SUM(pt.amount), 0) FROM payment_transactions pt
                      WHERE pt.order_id = rr.order_id AND pt.am_status = 'RECEVIED') AS total_received,
                    (SELECT IFNULL(SUM(rt.amount), 0) FROM refund_transactions rt
                      WHERE rt.order_id = rr.order_id AND rt.status = 'REFUNDED') AS total_refunded
                FROM refund_requests rr
                JOIN order_transactions ot ON ot.order_id = rr.order_id
                JOIN users c ON c.user_id = ot.user_id
                JOIN stock_details st ON st.stock_details_id = ot.stock_details_id
                LEFT JOIN users rq ON rq.user_id = rr.requested_by
                LEFT JOIN users rv ON rv.user_id = rr.reviewed_by
                WHERE 1 = 1
            `;
            let cond = '';
            let page = { pageQuery: '' };

            if (actor.user_type === 'RM') cond += ` AND c.assign_to = ${Number(actor.user_id)}`;

            if (value.status === 'Active') cond += ` AND rr.status IN ('Pending','Accepted')`;
            else if (value.status) cond += ` AND rr.status = '${value.status}'`;

            if (value.order_id) cond += ` AND ot.order_custom_id LIKE '%${String(value.order_id).replace(/['\\]/g, '')}%'`;
            if (value.searchUser) {
                cond += ` AND CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name) LIKE '%${String(value.searchUser).replace(/['\\]/g, '')}%'`;
            }
            if (value.company_name) cond += ` AND st.company_name LIKE '%${String(value.company_name).replace(/['\\]/g, '')}%'`;
            if (value.broker_id) cond += ` AND ot.broker_id = ${value.broker_id}`;
            if (value.advisor_id) cond += ` AND ot.advisor_id = ${value.advisor_id}`;
            if (value.partner_id) cond += ` AND ot.addedPartnerID = ${value.partner_id}`;
            if (value.from_date) cond += ` AND DATE(rr.requested_datetime) >= '${String(value.from_date).replace(/[^0-9-]/g, '')}'`;
            if (value.to_date) cond += ` AND DATE(rr.requested_datetime) <= '${String(value.to_date).replace(/[^0-9-]/g, '')}'`;

            query += cond + ` ORDER BY rr.refund_request_id DESC`;

            if (value.pagination) {
                page = await paginationQuery(query, next, value.current_page, value.per_page_records);
            }
            query += page.pageQuery;

            const data = await getData(query, next);
            return res.json({
                message: 'success',
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data,
            });
        } catch (error) {
            next(error);
        }
    },
};

export default refundController;
