import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";

const wishlistController = {

    async addUpdateWishlist(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const wishlistSchema = Joi.object({
                wishlist_id: Joi.number().integer().optional(),

                user_id: Joi.number().integer().required(),
                wishlist_name: Joi.string().required(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = wishlistSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Duplicate Check ------------------ */
            let condition = '';
            if (dataObj.wishlist_id) {
                condition = `AND wishlist_id != ${dataObj.wishlist_id}`;
            }

            const checkQuery = `
                SELECT wishlist_id
                FROM wishlist
                WHERE user_id = ${dataObj.user_id}
                AND wishlist_name = '${dataObj.wishlist_name}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist('Wishlist already exists for this user')
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.wishlist_id) {
                query = `UPDATE wishlist SET ? WHERE wishlist_id = ${dataObj.wishlist_id}`;
                dataObj.updated_at = new Date();
            } else {
                query = `INSERT INTO wishlist SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.wishlist_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.wishlist_id
                    ? 'Wishlist saved successfully'
                    : 'Wishlist updated successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async getWishlist(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `SELECT * FROM wishlist WHERE 1`;
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const wishlistSchema = Joi.object({
                user_id: Joi.number().integer(),
                wishlist_name: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = wishlistSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.user_id) {
                cond += ` AND user_id = ${req.query.user_id}`;
            }

            if (req.query.wishlist_name) {
                cond += ` AND wishlist_name = '${req.query.wishlist_name}'`;
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

export default wishlistController;