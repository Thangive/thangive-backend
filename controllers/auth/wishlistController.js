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
                dataObj.updated_on = new Date();
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

    // async addStockToWishlist(req, res, next) {

    // },

    async addStockToWishlist(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const wishlistStockSchema = Joi.object({
                wishlist_stock_id: Joi.number().integer().optional(),

                wishlist_id: Joi.number().integer().required(),
                user_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer().required(),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Validate ------------------ */
            const { error } = wishlistStockSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Duplicate Check ------------------ */
            let condition = '';
            if (dataObj.wishlist_stock_id) {
                condition = `AND wishlist_stock_id != ${dataObj.wishlist_stock_id}`;
            }

            const checkQuery = `
                SELECT wishlist_stock_id
                FROM wishlist_stock
                WHERE wishlist_id = ${dataObj.wishlist_id}
                AND user_id = ${dataObj.user_id}
                AND stock_details_id = ${dataObj.stock_details_id}
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        'Stock already exists in this wishlist'
                    )
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.wishlist_stock_id) {
                query = `
                    UPDATE wishlist_stock
                    SET ?
                    WHERE wishlist_stock_id = ${dataObj.wishlist_stock_id}
                `;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO wishlist_stock SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.wishlist_stock_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.wishlist_stock_id
                    ? 'Stock added to wishlist successfully'
                    : 'Wishlist stock updated successfully',
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },
    async removeStockFromWishlist(req, res, next) {
        try {

            /* ------------------ Validation Schema ------------------ */
            const deleteSchema = Joi.object({
                user_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer().required(),
            });

            let dataObj = { ...req.body };
            console.log(req.body);
            /* ------------------ Validate ------------------ */
            const { error } = deleteSchema.validate(dataObj);
            if (error) return next(error);

            /* ------------------ Check Exists ------------------ */
            const checkQuery = `
            SELECT wishlist_stock_id
            FROM wishlist_stock
            WHERE user_id = ${dataObj.user_id}
            AND stock_details_id = ${dataObj.stock_details_id}
        `;

            const exists = await getData(checkQuery, next);

            if (exists.length === 0) {
                return next(
                    CustomErrorHandler.notFound(
                        'Stock not found in wishlist'
                    )
                );
            }

            /* ------------------ Delete ------------------ */
            const deleteQuery = `
            DELETE FROM wishlist_stock
            WHERE user_id = ${dataObj.user_id}
            AND stock_details_id = ${dataObj.stock_details_id}
        `;

            await getData(deleteQuery, next);

            return res.json({
                success: true,
                message: 'Stock removed from wishlist successfully',
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
    },
    async getWishlistStocks(req, res, next) {
        try {

            let query = `SELECT * FROM wishlist_stock WHERE 1`;
            let cond = '';

            const schema = Joi.object({
                user_id: Joi.number().integer(),
                wishlist_id: Joi.number().integer(),
            });

            const { error } = schema.validate(req.query);
            if (error) return next(error);

            if (req.query.user_id) {
                cond += ` AND user_id = ${req.query.user_id}`;
            }

            if (req.query.wishlist_id) {
                cond += ` AND wishlist_id = ${req.query.wishlist_id}`;
            }

            query += cond;

            const data = await getData(query, next);

            return res.json({
                message: "success",
                data: data
            });

        } catch (err) {
            next(err);
        }
    }


}

export default wishlistController;