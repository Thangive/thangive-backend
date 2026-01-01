import { randomInt } from 'crypto';
import Joi from 'joi';
import { getCount, getData, insertData } from '../../config/index.js';
import { imageUpload, paginationQuery, commonFuction } from '../../helper/index.js';
import CustomErrorHandler from '../../service/CustomErrorHandler.js';
import XLSX from "xlsx";

const PriceController = {

    async addUpdateStockPrice(req, res, next) {
        try {
            /* ------------------ Validation ------------------ */
            const schema = Joi.object({
                stock_price_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                prev_price: Joi.number().precision(2).required(),
                today_prices: Joi.number().precision(2).required(),
                partner_price: Joi.number().precision(2).required(),
                conviction_level: Joi.string().required(),
                availability: Joi.string().required(),
                lot: Joi.number().integer().required(),
                present_date: Joi.date().required()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = {
                ...req.body,
                update_date: new Date()
            };

            /* ------------------ STEP 1: Validate price_id belongs to TODAY ------------------ */
            if (dataObj.stock_price_id) {
                const verifyQuery = `
                    SELECT stock_price_id
                    FROM stock_price
                    WHERE stock_price_id='${dataObj.stock_price_id}'
                      AND DATE(present_date) = DATE('${dataObj.present_date}')
                `;

                const valid = await getData(verifyQuery, next);

                if (valid.length === 0) {
                    delete dataObj.stock_price_id;
                }
            }

            /* ------------------ STEP 2: Duplicate Check (TODAY only) ------------------ */
            let condition = dataObj.stock_price_id
                ? ` AND stock_price_id != '${dataObj.stock_price_id}'`
                : '';

            const checkQuery = `
                SELECT stock_price_id
                FROM stock_price
                WHERE stock_details_id='${dataObj.stock_details_id}'
                  AND DATE(present_date) = DATE('${dataObj.present_date}')
                  ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Stock price for today already exists"
                    )
                );
            }

            /* ------------------ STEP 3: Insert / Update ------------------ */
            const query = dataObj.stock_price_id
                ? `UPDATE stock_price SET ? WHERE stock_price_id='${dataObj.stock_price_id}'`
                : `INSERT INTO stock_price SET ?`;

            const result = await insertData(query, dataObj, next);

            if (!dataObj.stock_price_id && result.insertId) {
                dataObj.stock_price_id = result.insertId;
            }

            /* ------------------ Response ------------------ */
            res.json({
                success: true,
                message: dataObj.stock_price_id
                    ? "Stock price updated successfully"
                    : "Stock price added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async updatePriceExcel(req, res, next) {
        try {
            const TODAY = new Date().toISOString().slice(0, 10);

            /* ---------- FILE CHECK ---------- */
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Excel file required"
                });
            }

            const file = req.files[0];

            /* ---------- READ EXCEL ---------- */
            const workbook = XLSX.read(file.buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            let inserted = 0;
            let updated = 0;
            let skipped = [];

            /* ---------- LOOP ROWS ---------- */
            for (const row of rows) {

                /* ---------- COMPANY NAME ---------- */
                const companyName = String(row["COMPANY NAME"] || "").trim();
                if (!companyName) {
                    skipped.push({ reason: "Company name missing" });
                    continue;
                }
                const stock = await getData(
                    `SELECT stock_details_id 
                     FROM stock_details 
                     WHERE company_name='${companyName.replace(/'/g, "\\'")}'`,
                    next
                );
                if (stock.length === 0) {
                    skipped.push({
                        company: companyName,
                        reason: "Company not found"
                    });
                    continue;
                }

                const stock_details_id = stock[0].stock_details_id;
                /* ---------- READ SHEET VALUES ---------- */
                const todayCell = row["PRICE"];
                const prevCell = row["__EMPTY"];

                let today_prices = null;
                let prev_price = null;
                let availability = null;

                /* ---------- TODAY PRICE / AVAILABILITY ---------- */
                if (todayCell !== "" && todayCell !== null) {
                    if (!isNaN(todayCell)) {
                        today_prices = Number(todayCell);
                    } else {
                        availability = String(todayCell).trim().toUpperCase();
                    }
                }

                /* ---------- PREVIOUS PRICE (SHEET FIRST) ---------- */
                if (prevCell !== "" && prevCell !== null && !isNaN(prevCell)) {
                    prev_price = Number(prevCell);
                }

                /* ---------- FALLBACK TO DB ---------- */
                if (prev_price === null) {
                    const prev = await getData(
                        `SELECT today_prices
                         FROM stock_price
                         WHERE stock_details_id='${stock_details_id}'
                           AND present_date < '${TODAY}'
                         ORDER BY present_date DESC
                         LIMIT 1`,
                        next
                    );

                    if (prev.length === 0) {
                        skipped.push({
                            company: companyName,
                            reason: "Previous price not found (sheet + DB)"
                        });
                        continue;
                    }

                    prev_price = prev[0].today_prices;
                }

                /* ---------- FINAL TODAY PRICE ---------- */
                if (today_prices === null) {
                    today_prices = prev_price;
                }

                /* ---------- CHECK TODAY ENTRY ---------- */
                const existing = await getData(
                    `SELECT stock_price_id
                     FROM stock_price
                     WHERE stock_details_id='${stock_details_id}'
                       AND DATE(present_date)=DATE('${TODAY}')`,
                    next
                );

                /* ---------- PAYLOAD ---------- */
                const payload = {
                    stock_details_id,
                    prev_price: prev_price,
                    today_prices: today_prices,
                    partner_price: 0,
                    conviction_level: row["CONVICTION LEVEL"] || "Medium",
                    availability: availability && availability.trim() !== "" ? availability : "LIMITED",
                    lot: row["LOT SIZE"] || 0,
                    present_date: TODAY,
                    update_date: new Date()
                };
                /* ---------- INSERT / UPDATE ---------- */
                if (existing.length > 0) {
                    await insertData(
                        `UPDATE stock_price SET ? 
                         WHERE stock_price_id='${existing[0].stock_price_id}'`,
                        payload,
                        next
                    );
                    updated++;
                } else {
                    await insertData(
                        `INSERT INTO stock_price SET ?`,
                        payload,
                        next
                    );
                    inserted++;
                }
            }

            /* ---------- RESPONSE ---------- */
            return res.json({
                success: true,
                message: "Excel price upload completed",
                inserted,
                updated,
                skipped_count: skipped.length,
                skipped
            });

        } catch (err) {
            next(err);
        }
    }
}
export default PriceController