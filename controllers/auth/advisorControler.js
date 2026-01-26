import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";

const advisorControler = {
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
    }
}

export default advisorControler;

