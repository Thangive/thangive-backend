import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";
import paginationQuery from '../../helper/paginationQuery.js';

const faqController = {
    async addUpdateFaq(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const faqSchema = Joi.object({
                faq_id: Joi.number().integer().optional(),
                quation: Joi.string().required(),
                description: Joi.string().optional(),
                url: Joi.string()
                    .uri({ scheme: ['http', 'https'] })
                    .required(),
                role_id: Joi.number().integer().required(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = faqSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Duplicate Check ------------------ */
            let condition = '';
            if (dataObj.faq_id) {
                condition = `AND faq_id != ${dataObj.faq_id}`;
            }

            const checkQuery = `
            SELECT faq_id
            FROM faq
            WHERE quation = '${dataObj.quation}'
            AND role_id = ${dataObj.role_id}
            ${condition}
        `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist('FAQ already exists')
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.faq_id) {
                query = `UPDATE faq SET ? WHERE faq_id = ${dataObj.faq_id}`;
                dataObj.updated_at = new Date();
            } else {
                query = `INSERT INTO faq SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.faq_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.faq_id
                    ? 'FAQ updated successfully'
                    : 'FAQ created successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async getFaq(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `SELECT faq_id, quation, description, url, is_deleted, created_at, updated_at, role_id FROM faq WHERE is_deleted = 0`;
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const faqSchema = Joi.object({
                faq_id: Joi.number().integer(),
                quation: Joi.string(),
                role_id: Joi.number().integer(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = faqSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.faq_id) {
                cond += ` AND faq_id = ${req.query.faq_id}`;
            }

            if (req.query.quation) {
                cond += ` AND quation LIKE '%${req.query.quation}%'`;
            }

            if (req.query.role_id) {
                cond += ` AND role_id = ${req.query.role_id}`;
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
export default faqController;