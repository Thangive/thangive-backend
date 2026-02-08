import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";
import paginationQuery from '../../helper/paginationQuery.js';

const transactionController = {
    async addUpdateOrder(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const orderSchema = Joi.object({
                order_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().required(),
                advisor_id: Joi.number().integer().required(),
                broker_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer().required(),
                quantity: Joi.number().positive().required(),
                current_share_price: Joi.number().required(),

                order_type: Joi.string()
                    .valid('MARKET', 'LIMIT')
                    .required(),

                price_per_share: Joi.when('order_type', {
                    is: 'LIMIT',
                    then: Joi.number().required(),
                    otherwise: Joi.optional()
                }),

                transaction_type: Joi.string()
                    .valid('BUY', 'SELL')
                    .required(),
            });

            const dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = orderSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ MARKET price handling ------------------ */
            if (dataObj.order_type === 'MARKET') {
                dataObj.price_per_share = dataObj.current_share_price;
            }

            /* ------------------ SELL Validation ------------------ */
            if (dataObj.transaction_type === 'SELL') {

                const qtyQuery = `
                    SELECT 
                        COALESCE(SUM(
                            CASE 
                                WHEN transaction_type = 'BUY'  THEN quantity
                                WHEN transaction_type = 'SELL' THEN -quantity
                                ELSE 0
                            END
                        ), 0) AS remaining_quantity
                    FROM order_transactions
                    WHERE user_id = ${dataObj.user_id}
                      AND stock_details_id = ${dataObj.stock_details_id}
                      AND broker_id = ${dataObj.broker_id}
                      AND rm_status = 'COMPLETED'
                      AND am_status = 'COMPLETED'
                      AND st_status = 'COMPLETED'
                `;

                const qtyResult = await getData(qtyQuery, next);
                const remainingQty = qtyResult?.[0]?.remaining_quantity || 0;

                if (remainingQty < dataObj.quantity) {
                    return next(
                        CustomErrorHandler.badRequest(
                            `Insufficient quantity. Available: ${remainingQty}`
                        )
                    );
                }
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.order_id) {
                query = `UPDATE order_transactions SET ? WHERE order_id = ${dataObj.order_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO order_transactions SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.order_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.order_id
                    ? 'Order updated successfully'
                    : 'Order placed successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async updateOrderStatus(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const orderSchema = Joi.object({
                order_id: Joi.number().integer().required(),
                user_id: Joi.number().integer().required(),
                employee_id: Joi.number().integer().required(),
                employee_type: Joi.string().valid('RM', 'AM', 'ST').required(),
                stock_details_id: Joi.number().integer().required(),
                status: Joi.string()
                    .valid('COMPLETED', 'PROCCESSING', 'HOLD', 'REJECTED', 'CANCEL', 'PENDING')
                    .required(),
            });

            const dataObj = { ...req.body };

            /* ------------------ Validate Request ------------------ */
            const { error } = orderSchema.validate(dataObj ?? {});
            if (error) return next(error);

            /* ------------------ USER ↔ EMPLOYEE ASSIGNMENT CHECK ------------------ */
            const assignCheckQuery = ` SELECT user_id  FROM users WHERE user_id = '${dataObj.user_id}' AND assign_to = '${dataObj.employee_id}' AND is_deleted = 0 LIMIT 1 `;
            if (dataObj.employee_type == "RM") {
                const assignCheck = await getData(
                    assignCheckQuery,
                    next
                );

                if (!assignCheck || assignCheck.length === 0) {
                    return next(
                        CustomErrorHandler.unauthorized(
                            "This user is not assigned to the given employee"
                        )
                    );
                }

            }
            /* ------------------ UPDATE ORDER ------------------ */
            let updatedObject = {};
            // store status against employee type
            if (dataObj.employee_type === 'RM') {
                updatedObject.rm_status = dataObj.status;
            } else if (dataObj.employee_type === 'AM') {
                updatedObject.am_status = dataObj.status;
            } else if (dataObj.employee_type === 'ST') {
                updatedObject.st_status = dataObj.status;
            }

            const query = `
                UPDATE order_transactions 
                SET ? 
                WHERE order_id = ${dataObj.order_id}
                  AND user_id = ${dataObj.user_id}
                  AND stock_details_id =  ${dataObj.stock_details_id}
            `;

            await insertData(query, updatedObject, next);

            return res.json({
                success: true,
                message: "Order status updated successfully"
            });

        } catch (error) {
            next(error);
        }
    },

    async getUserHoldigs(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = "SELECT * FROM `vw_portfolio_summary` WHERE `rm_status`='COMPLETED' AND `am_status`='COMPLETED' AND `st_status`='COMPLETED'";

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const holdingSchema = Joi.object({
                user_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer(),
                broker_id: Joi.number().integer(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = holdingSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            cond += ` AND user_id = ${req.query.user_id}`;

            if (req.query.stock_details_id) {
                cond += ` AND stock_details_id = ${req.query.stock_details_id}`;
            }

            if (req.query.broker_id) {
                cond += ` AND broker_id = ${req.query.broker_id}`;
            }


            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += page.pageQuery;

            /* ------------------ Fetch Data ------------------ */
            const data = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ? page.total_rec : data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },

    async getStockOrderList(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `
                SELECT
                    ot.order_id AS order_transaction_id,
                    ot.stock_details_id,
                    ot.user_id,
                    ad.advisor_name,
                    bro.broker_custom_id AS broker_id,
                    bro.broker_name,
                    st.company_name,
                    sp.prev_price,
                    sp.today_prices AS latest_price,
                    ot.price_per_share AS stock_price,
                    ot.quantity AS quantity,
                    (ot.price_per_share * ot.quantity) AS investment_amount,
                    (sp.today_prices * ot.quantity) AS market_value,
                    (sp.today_prices * ot.quantity) - (ot.price_per_share * ot.quantity) AS overall_PL,
                    ((sp.today_prices - sp.prev_price) * ot.quantity) AS daily_PL,
                    ot.order_type,
                    ot.rm_status,
                    ot.am_status,
                    ot.st_status,
                    ot.payments_count,
                    ot.created_at
                FROM order_transactions ot
                JOIN stock_details st
                    ON ot.stock_details_id = st.stock_details_id
                JOIN advisor ad
                    ON ad.advisor_id = ot.advisor_id
                JOIN broker bro
                    ON bro.broker_id = ot.broker_id
                JOIN users users
                    ON users.user_id = ot.user_id
                JOIN stock_price sp
                    ON sp.stock_details_id = st.stock_details_id
                JOIN (
                    SELECT stock_details_id, MAX(stock_price_id) AS latest_id
                    FROM stock_price
                    GROUP BY stock_details_id
                ) latest
                    ON latest.latest_id = sp.stock_price_id
                WHERE 1
            `;

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const holdingSchema = Joi.object({
                user_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer(),
                broker_id: Joi.number().integer(),
                employee_type: Joi.string()
                    .valid('RM', 'AM', 'ST')
                    .optional(),

                employee_id: Joi.when('employee_type', {
                    is: 'RM',
                    then: Joi.number().integer().required(),
                    otherwise: Joi.number().integer().optional()
                }),
                transaction_type: Joi.string()
                    .valid('BUY', 'SELL')
                    .optional(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error, value } = holdingSchema.validate(req.query ?? {});
            if (error) return next(error);

            /* ------------------ Filters ------------------ */

            if (value.user_id) {
                cond += ` AND ot.user_id = ${value.user_id}`;
            }

            if (value.stock_details_id) {
                cond += ` AND ot.stock_details_id = ${value.stock_details_id}`;
            }

            if (value.employee_id && value.employee_type == "RM") {
                cond += `  AND ot.rm_status <> 'CANCEL' AND ot.rm_status <> 'COMPLETED' AND users.assign_to = ${value.employee_id}`;
            }

            if (value.employee_type == "AM") {
                cond += ` AND ot.rm_status <> 'CANCEL' AND ot.rm_status = 'COMPLETED' AND ot.am_status != 'COMPLETED'`;
            }

            if (value.employee_type == "ST") {
                cond += ` AND ot.rm_status <> 'CANCEL' AND ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status != 'COMPLETED'`;
            }

            if (value.transaction_type) {
                cond += ` AND ot.transaction_type = '${value.transaction_type}'`;
            }

            if (value.broker_id) {
                cond += ` AND ot.broker_id = ${value.broker_id}`;
            }

            /* ------------------ Pagination ------------------ */
            if (value.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    value.current_page,
                    value.per_page_records
                );
            }

            query += cond + page.pageQuery;

            /* ------------------ Fetch Data ------------------ */
            const data = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data
            });

        } catch (err) {
            next(err);
        }
    },

    async getHoldingStockQuantity(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const holdingSchema = Joi.object({
                user_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer().required(),
                broker_id: Joi.number().integer().required(),
                advisor_id: Joi.number().integer().required(),
            });

            const { error, value } = holdingSchema.validate(req.query ?? {});
            if (error) return next(error);

            /* ------------------ Base Query ------------------ */
            let query = `
                 SELECT 
                    SUM(
                        CASE 
                            WHEN ot.transaction_type = 'BUY' THEN ot.quantity
                            WHEN ot.transaction_type = 'SELL' THEN -ot.quantity
                            ELSE 0
                        END
                    ) AS remaining_quantity
                FROM order_transactions ot
                WHERE ot.rm_status = 'COMPLETED' AND ot.am_status = 'COMPLETED' AND ot.st_status = 'COMPLETED'
            `;

            /* ------------------ Filters ------------------ */
            query += ` AND ot.user_id = ${value.user_id}`;
            query += ` AND ot.stock_details_id = ${value.stock_details_id}`;
            query += ` AND ot.broker_id = ${value.broker_id}`;
            query += ` AND ot.advisor_id = ${value.advisor_id}`;

            console.log("Holding Quantity Query =>", query);

            /* ------------------ Fetch Data ------------------ */
            const result = await getData(query, next);

            const remainingQty = result?.[0]?.remaining_quantity ?? 0;

            return res.json({
                success: true,
                data: {
                    remaining_quantity: remainingQty
                }
            });

        } catch (err) {
            next(err);
        }
    },

    async getOrderDetails(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const orderSchema = Joi.object({
                order_id: Joi.number().integer().required()
            });

            const { error } = orderSchema.validate(req.query ?? {});
            if (error) return next(error);

            /* ------------------ Order Details Query ------------------ */
            const orderQuery = `
            SELECT 
                ot.order_id,
                ot.user_id,
                ot.order_custom_id,
                b.broker_name AS broker_name, 
                sd.isin_no, 
                sd.company_name, 
                sd.script_name, 
                ot.transaction_type, 
                sp.today_prices,
                ot.price_per_share AS buy_price, 
                ot.quantity,
                (ot.price_per_share * ot.quantity) AS deal_value, 
                ot.rm_status,
                DATE_FORMAT(
                    CONVERT_TZ(ot.created_at, '+00:00', '+05:30'),
                    '%d-%m-%Y'
                ) AS order_date,
                 DATE_FORMAT(
                    CONVERT_TZ(ot.created_at, '+00:00', '+05:30'),
                    '%H:%i:%s'
                ) AS order_time
            FROM order_transactions ot
            JOIN stock_details sd 
                ON sd.stock_details_id = ot.stock_details_id
            JOIN broker b 
                ON b.broker_id = ot.broker_id
            JOIN users usr 
                ON usr.user_id = ot.user_id
            JOIN stock_price sp
                ON sp.stock_details_id = ot.stock_details_id
            JOIN (
                SELECT stock_details_id, MAX(stock_price_id) AS latest_id
                FROM stock_price
                GROUP BY stock_details_id
            ) latest
                ON latest.latest_id = sp.stock_price_id
            WHERE ot.order_id = ${req.query.order_id}
        `;

            const orderData = await getData(orderQuery, next);

            if (!orderData.length) {
                return next(
                    CustomErrorHandler.notFound('Order not found')
                );
            }

            const userId = orderData[0].user_id;

            /* ------------------ Client Details ------------------ */
            const clientQuery = `
                SELECT 
                    user_id,
                    username,
                    user_custum_id,
                    email,
                    phone_number
                FROM users
                WHERE user_id = ${userId}
            `;
            const clientData = await getData(clientQuery, next);

            /* ------------------ Broker Details ------------------ */
            const brokerQuery = `
                SELECT 
                    br.broker_custom_id,
                    br.broker_name,
                    cmr.client_id,
                    br.broker_email,
                    br.broker_contact
                FROM broker br
                JOIN user_cmr_details cmr 
                    ON cmr.broker_id = br.broker_id
                WHERE br.is_deleted = 0
                  AND cmr.user_id = ${userId}
            `;
            const brokerData = await getData(brokerQuery, next);

            /* ------------------ Bank Details ------------------ */
            const bankQuery = `
                SELECT 
                    bank_id,
                    bank_name,
                    account_type,
                    account_no,
                    ifsc_code
                FROM user_bank_details
                WHERE is_deleted = 0
                  AND user_id = ${userId}
            `;
            const bankData = await getData(bankQuery, next);

            return res.json({
                message: 'success',
                records: 1,
                data: {
                    clientDetails: clientData[0] ?? {},
                    brokerDetails: brokerData[0] ?? {},
                    bankDetails: bankData ?? {},
                    paymentDetails: [],
                    orderDetails: orderData[0]
                }
            });

        } catch (err) {
            next(err);
        }
    }


};

export default transactionController;