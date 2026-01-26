import { randomInt } from 'crypto';
import Joi from 'joi';
import { getCount, getData, insertData } from '../../config/index.js';
import { imageUpload, paginationQuery, commonFuction } from '../../helper/index.js';
import CustomErrorHandler from '../../service/CustomErrorHandler.js';

const stocksGetController = {
    async getStocks(req, res, next) {
        try {

            let baseQuery = `
            FROM stock_details s
            LEFT JOIN stock_sector sec ON s.sector_id = sec.sector_id
            LEFT JOIN stock_subindustry sub ON s.subindustry_id = sub.subindustry_id
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

            let cond = "";

            // ========= FILTERS =========
            if (req.query.company_name)
                cond += ` AND s.company_name LIKE '%${req.query.company_name}%'`;

            if (req.query.script_name)
                cond += ` AND s.script_name LIKE '%${req.query.script_name}%'`;

            if (req.query.isin_no)
                cond += ` AND s.isin_no LIKE '%${req.query.isin_no}%'`;

            if (req.query.stock_type)
                cond += ` AND s.stock_type = '${req.query.stock_type}'`;

            // ========= MODE SELECTOR =========
            const isPaginationMode = req.query.pagination == "true";
            const isOffsetMode = req.query.limit && req.query.offset !== undefined;

            let limitQuery = "";
            let page = {};

            // ========= MODE 1: PAGINATION PAGE / PER_PAGE =========
            if (isPaginationMode) {
                page = await paginationQuery(
                    `SELECT s.stock_details_id ${baseQuery} ${cond}`,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
                limitQuery = page.pageQuery;
            }

            // ========= MODE 2: OFFSET / LIMIT (for logos load more) =========
            else if (isOffsetMode) {
                limitQuery = ` LIMIT ${Number(req.query.offset)}, ${Number(req.query.limit)}`;
            }

            // ========= MODE 3: LIMIT ONLY (home page cards) =========
            else if (req.query.limit) {
                limitQuery = ` LIMIT ${Number(req.query.limit)}`;
            }

            // ========= FINAL QUERY =========
            const finalQuery = `
            SELECT 
                s.*,
                sec.sector_name,
                sub.sub_industryName,
                IFNULL(sp.today_prices, 0) AS today_prices,
                IFNULL(sp.prev_price, 0) AS prev_price,
                IFNULL(sp.partner_price, 0) AS partner_price,
                IFNULL(sp.conviction_level, '') AS conviction_level,
                IFNULL(sp.lot, 0) AS lot,
                IFNULL(sp.availability, '') AS availability,
                sp.present_date,
                sp.stock_price_id
            ${baseQuery}
            ${cond}
            ${limitQuery}
        `;

            const data = await getData(finalQuery, next);

            // ========= TOTAL RECORDS (only pagination mode) =========
            let totalRecords = data.length;
            if (isPaginationMode) {
                totalRecords = page.total_rec;
            }

            res.json({
                message: "success",
                total_records: totalRecords,
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

    async getStockList(req, res, next) {
        try {
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 10;
            const search = req.query.search || "";
            const sort_by = req.query.sort_by || "company_name";
            const sort_order = req.query.sort_order === "desc" ? "DESC" : "ASC";

            const offset = limit === 0 ? 0 : (page - 1) * limit;

            let baseQuery = `
            FROM stock_details s
            LEFT JOIN stock_sector sec 
                ON s.sector_id = sec.sector_id
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
            if (search) {
                baseQuery += `
                AND (
                    s.company_name LIKE '%${search}%'
                    OR s.script_name LIKE '%${search}%'
                    OR sec.sector_name LIKE '%${search}%'
                )
            `;
            }

            // ---------- COUNT ----------
            const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;
            const total = await getData(countQuery, next);
            const totalRecords = total[0].total;

            // ---------- DATA ----------
            let dataQuery = `
            SELECT 
                s.*,
                sec.sector_name,
                sub.sub_industryName,
                IFNULL(sp.today_prices, 0) AS today_prices,
                IFNULL(sp.prev_price, 0) AS prev_price,
                IFNULL(sp.partner_price, 0) AS partner_price,
                IFNULL(sp.conviction_level, '') AS conviction_level,
                IFNULL(sp.lot, 0) AS lot,
                IFNULL(sp.availability, '') AS availability,
                sp.present_date,
                sp.stock_price_id
            ${baseQuery}
            ORDER BY ${sort_by} ${sort_order}
        `;

            if (limit > 0) {
                dataQuery += ` LIMIT ${offset}, ${limit}`;
            }

            const rows = await getData(dataQuery, next);
            res.json({
                message: "success",
                total_records: totalRecords,
                page,
                limit,
                data: rows,
            });

        } catch (error) {
            next(error);
        }
    },
    async getStockData(req, res, next) {
        try {
            let query = `
                SELECT 
                    s.*,
                    sec.sector_name,
                    sub.sub_industryName,
    
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
                company_name: Joi.string(),
                script_name: Joi.string(),
                isin_no: Joi.string(),
                stock_type: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer()
            });

            const { error } = stockSchema.validate(req.query);
            if (error) return next(error);

            // 🔹 Filters
            if (req.query.company_name)
                cond += ` AND s.company_name LIKE '%${req.query.company_name}%'`;

            if (req.query.script_name)
                cond += ` AND s.script_name LIKE '%${req.query.script_name}%'`;

            if (req.query.isin_no)
                cond += ` AND s.isin_no LIKE '%${req.query.isin_no}%'`;

            if (req.query.stock_type)
                cond += ` AND s.stock_type = '${req.query.stock_type}'`;

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
}
export default stocksGetController;