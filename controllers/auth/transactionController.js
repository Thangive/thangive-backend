import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";

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

                quantity: Joi.number().required(),
                price_per_share: Joi.number().required(),

                order_type: Joi.string()
                    .valid('MARKET', 'LIMIT')
                    .required(),

                transaction_type: Joi.string()
                    .valid('BUY', 'SELL')
                    .required(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = orderSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.order_id) {
                query = `UPDATE orders SET ? WHERE order_id = ${dataObj.order_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO orders SET ?`;
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

    async getUserHoldigs(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = "SELECT * FROM `userholdings` WHERE 1";

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

            console.log("Holdings Query =>", query);

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

    async getOrderDetails(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = "SELECT ot.order_id,ot.user_id, b.broker_name, ot.transaction_type, sd.isin_no, sd.company_name, ot.price_per_share, ot.quatity FROM order_transactions ot JOIN stock_details sd ON sd.stock_details_id = ot.stock_details_id JOIN broker b ON b.broker_id = ot.broker_id WHERE 1";

            let cond = '';
            var clientData;
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const holdingSchema = Joi.object({
                order_id: Joi.number().integer().required()
            });

            const { error } = holdingSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            cond += ` AND ot.order_id = ${req.query.order_id}`;

            query += cond + page.pageQuery;

            console.log("Holdings Query =>", query);

            /* ------------------ Fetch Data ------------------ */
            const users = await getData(query, next);

            /* ------------------ Client Fetch Data ------------------ */
            if (users.length) {
                const clientQuery = `SELECT user_id,username,user_custum_id,email,phone_number FROM users WHERE user_id='${users[0].user_id}';`;
                clientData = await getData(clientQuery, next);
            }

            /* ------------------ Bank  Details ------------------ */
            if (users.length) {
                const clientQuery = `SELECT user_id,username,user_custum_id,email,phone_number FROM users WHERE user_id='${users[0].user_id}';`;
                clientData = await getData(clientQuery, next);
            }


            return res.json({
                message: 'success',
                records: data.length,
                data: {
                    clientDetails: clientData[0],
                    transactionData: data[0]
                }
            });

        } catch (err) {
            next(err);
        }
    }


};

export default transactionController;