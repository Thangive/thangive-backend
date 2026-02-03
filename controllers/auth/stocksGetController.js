import { randomInt } from 'crypto';
import Joi from 'joi';
import { getCount, getData, insertData } from '../../config/index.js';
import { imageUpload, paginationQuery, commonFunction } from '../../helper/index.js';
import CustomErrorHandler from '../../service/CustomErrorHandler.js';

const stocksGetController = {
    // async getStocks(req, res, next) {
    //     try {

    //         let baseQuery = `
    //         FROM stock_details s
    //         LEFT JOIN stock_sector sec ON s.sector_id = sec.sector_id
    //         LEFT JOIN stock_subindustry sub ON s.subindustry_id = sub.subindustry_id
    //         LEFT JOIN stock_price sp
    //             ON sp.stock_price_id = (
    //                 SELECT p1.stock_price_id
    //                 FROM stock_price p1
    //                 WHERE p1.stock_details_id = s.stock_details_id
    //                 AND p1.present_date = (
    //                     SELECT MAX(p2.present_date)
    //                     FROM stock_price p2
    //                     WHERE p2.stock_details_id = s.stock_details_id
    //                     AND p2.present_date <= CURDATE()
    //                 )
    //                 ORDER BY p1.time DESC
    //                 LIMIT 1
    //             )
    //         WHERE 1
    //     `;

    //         let cond = "";

    //         // ========= FILTERS =========
    //         if (req.query.company_name)
    //             cond += ` AND s.company_name LIKE '%${req.query.company_name}%'`;

    //         if (req.query.script_name)
    //             cond += ` AND s.script_name LIKE '%${req.query.script_name}%'`;

    //         if (req.query.isin_no)
    //             cond += ` AND s.isin_no LIKE '%${req.query.isin_no}%'`;

    //         if (req.query.stock_type)
    //             cond += ` AND s.stock_type = '${req.query.stock_type}'`;

    //         // ========= MODE SELECTOR =========
    //         const isPaginationMode = req.query.pagination == "true";
    //         const isOffsetMode = req.query.limit && req.query.offset !== undefined;

    //         let limitQuery = "";
    //         let page = {};

    //         // ========= MODE 1: PAGINATION PAGE / PER_PAGE =========
    //         if (isPaginationMode) {
    //             page = await paginationQuery(
    //                 `SELECT s.stock_details_id ${baseQuery} ${cond}`,
    //                 next,
    //                 req.query.current_page,
    //                 req.query.per_page_records
    //             );
    //             limitQuery = page.pageQuery;
    //         }

    //         // ========= MODE 2: OFFSET / LIMIT (for logos load more) =========
    //         else if (isOffsetMode) {
    //             limitQuery = ` LIMIT ${Number(req.query.offset)}, ${Number(req.query.limit)}`;
    //         }

    //         // ========= MODE 3: LIMIT ONLY (home page cards) =========
    //         else if (req.query.limit) {
    //             limitQuery = ` LIMIT ${Number(req.query.limit)}`;
    //         }

    //         // ========= FINAL QUERY =========
    //         const finalQuery = `
    //         SELECT 
    //             s.*,
    //             sec.sector_name,
    //             sub.sub_industryName,
    //             IFNULL(sp.today_prices, 0) AS today_prices,
    //             IFNULL(sp.prev_price, 0) AS prev_price,
    //             IFNULL(sp.partner_price, 0) AS partner_price,
    //             IFNULL(sp.conviction_level, '') AS conviction_level,
    //             IFNULL(sp.lot, 0) AS lot,
    //             IFNULL(sp.availability, '') AS availability,
    //             sp.present_date,
    //             sp.stock_price_id
    //         ${baseQuery}
    //         ${cond}
    //         ${limitQuery}
    //     `;

    //         const data = await getData(finalQuery, next);

    //         // ========= TOTAL RECORDS (only pagination mode) =========
    //         let totalRecords = data.length;
    //         if (isPaginationMode) {
    //             totalRecords = page.total_rec;
    //         }

    //         res.json({
    //             message: "success",
    //             total_records: totalRecords,
    //             number_of_pages: page.number_of_pages || 1,
    //             currentPage: page.currentPage || 1,
    //             records: data.length,
    //             data: {
    //                 pricipleData: data
    //             }
    //         });

    //     } catch (err) {
    //         next(err);
    //     }
    // },

    // get stock Counts
    async getStockCounts(req, res, next) {
        try {
            const query = `
            SELECT 
                COUNT(*) AS total,
                SUM(stock_type = 'Unlisted') AS unlisted,
                SUM(stock_type = 'Pre IPO') AS pre_ipo,
                SUM(stock_type = 'Delisted') AS delisted,
                SUM(stock_type = 'Listed') AS listed
            FROM stock_details
        `;

            const result = await getData(query, next);
            res.json({ message: "success", data: result[0] });

        } catch (err) {
            next(err);
        }
    },

    //without Auth Stock Fetch API
    async getStockData(req, res, next) {
        try {
            let query = `
            SELECT 
                s.*,
                sec.sector_name,
                sub.sub_industryName,

                IF(ws.wishlist_stock_id IS NULL, 0, 1) AS is_in_wishlist,
                ws.user_id AS wishlist_user_id,

                IFNULL(sp.today_prices, 0)      AS today_prices,
                IFNULL(sp.prev_price, 0)        AS prev_price,
                IFNULL(sp.partner_price, 0)     AS partner_price,
                IFNULL(sp.conviction_level, '') AS conviction_level,
                IFNULL(sp.lot, 0)               AS lot,
                IFNULL(sp.availability, '')     AS availability,
                sp.present_date,
                sp.stock_price_id
            FROM stock_details s

            LEFT JOIN stock_sector sec 
                ON s.sector_id = sec.sector_id

            LEFT JOIN wishlist_stock ws 
                ON ws.wishlist_stock_id=s.stock_details_id

            LEFT JOIN stock_subindustry sub 
                ON s.subindustry_id = sub.subindustry_id

            LEFT JOIN stock_price sp
                ON sp.stock_price_id = (
                    SELECT p1.stock_price_id
                    FROM stock_price p1
                    WHERE p1.stock_details_id = s.stock_details_id
                    AND p1.present_date = (
                        SELECT MAX(p2.present_date)
                        FROM stock_price p2
                        WHERE p2.stock_details_id = s.stock_details_id
                            AND p2.present_date <= CURDATE()
                    )
                    ORDER BY p1.time DESC
                    LIMIT 1
                )

            WHERE 1
        `;

            let cond = '';
            let page = { pageQuery: '' };

            const stockSchema = Joi.object({
                stock_details_id:Joi.number().integer(),
                company_name: Joi.string(),
                script_name: Joi.string(),
                isin_no: Joi.string(),
                stock_type: Joi.string(),
                wishlist_id: Joi.string().optional(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer()
            });

            const { error } = stockSchema.validate(req.query);
            if (error) return next(error);

            // 🔹 Filters
            if (req.query.stock_details_id)
                cond += ` AND s.stock_details_id ='${req.query.stock_details_id}'`;

            if (req.query.company_name)
                cond += ` AND s.company_name LIKE '%${req.query.company_name}%'`;

            if (req.query.script_name)
                cond += ` AND s.script_name LIKE '%${req.query.script_name}%'`;

            if (req.query.isin_no)
                cond += ` AND s.isin_no LIKE '%${req.query.isin_no}%'`;

            if (req.query.stock_type)
                cond += ` AND s.stock_type = '${req.query.stock_type}'`;

            if (req.query.wishlist_id)
                cond += ` AND ws.wishlist_id = '${req.query.wishlist_id}'`;

            // 🔹 Pagination
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
            res.json({
                message: 'success',
                total_records: page.total_rec ? page.total_rec : data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: {
                    pricipleData: data
                }
            });

        } catch (err) {
            next(err);
        }
    },
    async getSearchStock(req, res, next) {
        try {
            const { query } = req.query;

            if (!query || query.trim() === "") {
                return res.json({
                    success: true,
                    data: []
                });
            }
            const sql = `
                SELECT 
                    stock_details_id,
                    company_name,
                    script_name,
                    isin_no,
                    cmp_logo
                FROM stock_details
                WHERE company_name LIKE '%${query}%'
                ORDER BY company_name ASC
                LIMIT 20
            `;
            const data = await getData(sql, next);
            return res.json({
                success: true,
                data
            });

        } catch (err) {
            next(err);
        }
    },
}
export default stocksGetController;