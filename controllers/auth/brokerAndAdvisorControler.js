import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";

const brokerAndAdvisorControler = {
    async addUpdateAdvisor(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const advisorSchema = Joi.object({
                advisor_id: Joi.number().integer().optional(),
                advisor_name: Joi.string().required(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = advisorSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Duplicate Check ------------------ */
            let condition = '';
            if (dataObj.advisor_id) {
                condition = `AND advisor_id != ${dataObj.advisor_id}`;
            }

            const checkQuery = `
                SELECT advisor_id
                FROM advisor
                WHERE advisor_name = '${dataObj.advisor_name}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist('Advisor already exists')
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.advisor_id) {
                query = `UPDATE advisor SET ? WHERE advisor_id = ${dataObj.advisor_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO advisor SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.advisor_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.advisor_id
                    ? 'Advisor saved successfully'
                    : 'Advisor updated successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async getAdvisor(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `SELECT * FROM advisor WHERE 1`;
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const advisorSchema = Joi.object({
                advisor_id: Joi.number().integer(),
                advisor_name: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = advisorSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.advisor_id) {
                cond += ` AND advisor_id = ${req.query.advisor_id}`;
            }

            if (req.query.advisor_name) {
                cond += ` AND advisor_name LIKE '%${req.query.advisor_name}%'`;
            }

            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += cond + page.pageQuery;

            const data = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateBroker(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const brokerSchema = Joi.object({
                broker_id: Joi.number().integer().optional(),

                broker_custom_id: Joi.string().required(),
                broker_name: Joi.string().required(),
                broker_email: Joi.string().email().required(),
                broker_contact: Joi.string().required(),
                is_deleted: Joi.number().integer().optional(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = brokerSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Duplicate Check ------------------ */
            let condition = '';
            if (dataObj.broker_id) {
                condition = `AND broker_id != ${dataObj.broker_id}`;
            }

            const checkQuery = `
                SELECT broker_id
                FROM broker
                WHERE (
                    broker_custom_id = '${dataObj.broker_custom_id}'
                    OR broker_email = '${dataObj.broker_email}'
                    OR broker_contact = '${dataObj.broker_contact}'
                )
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        'Broker already exists with same email, contact, or custom ID'
                    )
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.broker_id) {
                query = `UPDATE broker SET ? WHERE broker_id = ${dataObj.broker_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO broker SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.broker_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.broker_id
                    ? 'Broker saved successfully'
                    : 'Broker updated successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async getBroker(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `SELECT * FROM broker WHERE is_deleted = 0`;
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const brokerSchema = Joi.object({
                broker_id: Joi.number().integer(),
                broker_custom_id: Joi.string(),
                broker_name: Joi.string(),
                broker_email: Joi.string().email(),
                broker_contact: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = brokerSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.broker_id) {
                cond += ` AND broker_id = ${req.query.broker_id}`;
            }

            if (req.query.broker_custom_id) {
                cond += ` AND broker_custom_id LIKE '%${req.query.broker_custom_id}%'`;
            }

            if (req.query.broker_name) {
                cond += ` AND broker_name LIKE '%${req.query.broker_name}%'`;
            }

            if (req.query.broker_email) {
                cond += ` AND broker_email LIKE '%${req.query.broker_email}%'`;
            }

            if (req.query.broker_contact) {
                cond += ` AND broker_contact LIKE '%${req.query.broker_contact}%'`;
            }

            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += cond + page.pageQuery;

            const data = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    }


}

export default brokerAndAdvisorControler;

