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
                stock_details_id: Joi.number().integer().required(),
                today_prices: Joi.number().precision(2).required(),
                partner_price: Joi.number().precision(2).required(),
                conviction_level: Joi.string().required(),
                availability: Joi.string().required(),
                lot: Joi.number().integer().required(),
                present_date: Joi.date().required()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const {
                stock_details_id,
                today_prices,
                partner_price,
                conviction_level,
                availability,
                lot,
                present_date
            } = req.body;

            const TODAY = new Date(present_date).toISOString().slice(0, 10);

            /* ------------------ Rule 1: Get Previous Price from DB ------------------ */
            const prevQuery = `
                SELECT today_prices 
                FROM stock_price
                WHERE stock_details_id='${stock_details_id}'
                AND present_date < '${TODAY}'
                ORDER BY present_date DESC
                LIMIT 1
            `;
            const prevData = await getData(prevQuery, next);
            const prev_price = prevData.length > 0 ? prevData[0].today_prices : today_prices;

            /* ------------------ Rule 2: ALWAYS Insert New Row ------------------ */
            const payload = {
                stock_details_id,
                prev_price,                // ← fixed, read-only
                today_prices,              // ← new price user submitted
                partner_price,
                conviction_level,
                availability,
                lot,
                present_date: TODAY,
                created_at: new Date(),
                time: new Date(),
                update_date: new Date()
            };

            const result = await insertData(`INSERT INTO stock_price SET ?`, payload, next);
            payload.stock_price_id = result.insertId;

            /* ------------------ Response ------------------ */
            return res.json({
                success: true,
                message: "Stock price added successfully",
                data: payload
            });
        } catch (err) {
            next(err);
        }
    },

    async updatePriceExcel(req, res, next) {
        try {

            const { present_date } = req.body;

            if (!present_date) {
                return res.status(400).json({
                    success: false,
                    message: "present_date is required"
                });
            }

            const TODAY = new Date(present_date).toISOString().slice(0, 10);

            if (TODAY > new Date().toISOString().slice(0, 10)) {
                return res.status(400).json({
                    success: false,
                    message: "Future date not allowed"
                });
            }

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
            let inserted = [];
            let updated = [];
            let skipped = [];

            /* ---------- LOOP ROWS ---------- */
            for (const row of rows) {

                /* ---------- COMPANY NAME ---------- */
                const companyName = String(row["COMPANY NAME"] || "").trim();
                if (!companyName) {
                    skipped.push({
                        company: null,
                        reason: "Company name missing"
                    });
                    continue;
                }
                const stock = await getData(
                    `SELECT stock_details_id 
                     FROM stock_details 
                     WHERE script_name='${companyName.replace(/'/g, "\\'")}'`,
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
                const actionCell = row["ACTION"];

                let today_prices = null;
                let prev_price = null;
                // let availability = null;

                /* ---------- TODAY PRICE / AVAILABILITY ---------- */
                if (todayCell !== "" && todayCell !== null && !isNaN(todayCell)) {
                    today_prices = Number(todayCell);
                }
                // if (todayCell !== "" && todayCell !== null) {
                //     if (!isNaN(todayCell)) {
                //         today_prices = Number(todayCell);
                //     } else {
                //         availability = String(todayCell).trim().toUpperCase();
                //     }
                // }

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

                /* AVAILABILITY FROM ACTION */
                let availability = "AVAILABLE";
                if (actionCell && String(actionCell).trim() !== "") {
                    availability = String(actionCell).trim().toUpperCase();
                }

                const payload = {
                    stock_details_id,
                    prev_price,
                    today_prices,
                    partner_price: 0,
                    conviction_level: row["CONVICTION LEVEL"] || "MEDIUM",
                    availability: availability,
                    lot: row["LOT SIZE"] || 0,
                    present_date: TODAY,
                    created_at: new Date(),
                    time: new Date(),
                    update_date: new Date()
                };

                await insertData(
                    `INSERT INTO stock_price SET ?`,
                    payload,
                    next
                );

                inserted.push({
                    company: companyName,
                    stock_details_id
                });
            }
            /* ---------- RESPONSE ---------- */
            return res.json({
                success: true,
                message: "Excel price upload completed",
                present_date,
                inserted_count: inserted.length,
                skipped_count: skipped.length,
                inserted,
                skipped
            });
        } catch (err) {
            next(err);
        }
    },
    async getStockPriceChartData(req, res, next) {
        try {
            const { stock_details_id } = req.query;

            /* ---------- VALIDATION ---------- */
            if (!stock_details_id) {
                return res.status(400).json({
                    success: false,
                    message: "stock_details_id is required"
                });
            }

            /* ---------- FETCH PRICE DATA ---------- */
            const data = await getData(
                `SELECT 
                        DATE(p.present_date) AS date,
                        p.today_prices AS price
                    FROM stock_price p
                    INNER JOIN (
                        SELECT 
                            DATE(present_date) AS dt,
                            MAX(stock_price_id) AS max_id
                        FROM stock_price
                        WHERE stock_details_id = '${stock_details_id}'
                        GROUP BY DATE(present_date)
                    ) x 
                    ON p.stock_price_id = x.max_id
                    WHERE p.stock_details_id = '${stock_details_id}'
                    ORDER BY DATE(p.present_date) ASC;
                `,
                next
            );

            /* ---------- NO DATA ---------- */
            if (!data || data.length === 0) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            /* ---------- RESPONSE ---------- */
            return res.json({
                success: true,
                data
            });

        } catch (error) {
            next(error);
        }
    },
    async getCashFlowTemplates(req, res, next) {
        try {

            const query = `
            SELECT
                cf.cashFlowID,
                cf.cashFlow_name,
                cfp.cashFlowParticulars_id,
                cfp.particular_name,
                cfp.sequence_no
            FROM cashflow cf
            JOIN cashflowparticulars cfp
                ON cfp.cashFlowID = cf.cashFlowID
            ORDER BY cf.cashFlowID, cfp.sequence_no
        `;

            const rows = await getData(query, next);

            if (!rows.length) {
                return res.status(404).json({
                    message: "Cash flow templates not found"
                });
            }

            // Grouping for frontend
            const result = {
                operating: [],
                investing: [],
                financing: []
            };

            rows.forEach(r => {
                const item = {
                    id: r.cashFlowParticulars_id,
                    name: r.particular_name
                };

                if (r.cashFlowID === 1) result.operating.push(item);
                else if (r.cashFlowID === 2) result.investing.push(item);
                else if (r.cashFlowID === 3) result.financing.push(item);
            });

            res.json({
                message: "success",
                data: result
            });

        } catch (err) {
            next(err);
        }
    },
    async addUpdateCashFlowValues(req, res, next) {
        try {
            const { data = [], deletedYears = [] } = req.body;

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(400).json({ message: "Invalid input data" });
            }

            /* ================= SAVE / UPDATE ================= */
            for (const record of data) {
                const {
                    stock_details_id,
                    cashFlowParticulars_id,
                    ...years
                } = record;

                if (!stock_details_id || !cashFlowParticulars_id) continue;

                for (const year in years) {

                    if (
                        year === "stock_details_id" ||
                        year === "particular_name" ||
                        year === "cashFlowParticulars_id"
                    ) continue;

                    const value = years[year];
                    if (value === null || value === undefined) continue;

                    /* -------- YEAR -------- */
                    let yearResult = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    let year_id;
                    if (yearResult.length > 0) {
                        year_id = yearResult[0].year_id;
                    } else {
                        const insertYear = await insertData(
                            "INSERT INTO years SET ?",
                            { year },
                            next
                        );
                        year_id = insertYear.insertId;
                    }

                    /* -------- CHECK EXISTING -------- */
                    const exists = await getData(
                        `SELECT cashFlowID, value 
                     FROM cashflowvalues
                     WHERE stock_details_id='${stock_details_id}'
                       AND cashFlowParticulars_id='${cashFlowParticulars_id}'
                       AND year_id='${year_id}'`,
                        next
                    );

                    if (exists.length > 0) {
                        if (Number(exists[0].value) !== Number(value)) {
                            await insertData(
                                `UPDATE cashflowvalues 
                             SET value=?, isdeleted=0, updated_at=NOW()
                             WHERE cashFlowID=?`,
                                [value, exists[0].cashFlowID],
                                next
                            );
                        }
                    } else {
                        await insertData(
                            "INSERT INTO cashflowvalues SET ?",
                            {
                                stock_details_id,
                                cashFlowParticulars_id,
                                year_id,
                                value,
                                isdeleted: 0,
                                created_at: new Date(),
                                updated_at: new Date()
                            },
                            next
                        );
                    }
                }
            }

            /* ================= SOFT DELETE YEARS ================= */
            if (deletedYears.length > 0) {
                const stockId = data[0].stock_details_id;

                for (const year of deletedYears) {
                    const yearRes = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    if (!yearRes.length) continue;

                    await insertData(
                        `UPDATE cashflowvalues
                     SET isdeleted=1, updated_at=NOW()
                     WHERE stock_details_id='${stockId}'
                       AND year_id='${yearRes[0].year_id}'`,
                        [],
                        next
                    );
                }
            }

            return res.json({
                success: true,
                message: "Cash flow values saved successfully"
            });

        } catch (error) {
            next(error);
        }
    },

    async getCashFlowValues(req, res, next) {
        try {
            const { stock_details_id } = req.query;
            if (!stock_details_id) {
                return res.status(400).json({ message: "stock_details_id required" });
            }

            const query = `
                SELECT
                    cfv.cashFlowParticulars_id,
                    y.year,
                    cfv.value
                FROM cashflowvalues cfv
                JOIN years y ON cfv.year_id = y.year_id
                WHERE cfv.stock_details_id = '${stock_details_id}'
                AND cfv.isdeleted = 0
                ORDER BY y.year
            `;

            const rows = await getData(query, next);

            if (!rows.length) {
                return res.json({
                    message: "success",
                    data: {
                        years: [],
                        values: {}
                    }
                });
            }

            const yearsSet = new Set();
            const values = {};

            rows.forEach(r => {
                yearsSet.add(r.year);

                if (!values[r.year]) values[r.year] = {};
                values[r.year][r.cashFlowParticulars_id] = Number(r.value);
            });

            res.json({
                message: "success",
                data: {
                    years: Array.from(yearsSet),
                    values
                }
            });

        } catch (err) {
            next(err);
        }
    },
    async addUpdateBalanceSheetTemplates(req, res, next) {
        try {
            /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                bs_id: Joi.number().optional(),
                sector_id: Joi.number().required(),
                bs_type: Joi.string().valid("ASSET", "LIABILITY").required(),
                particular_name: Joi.string().required(),
                sequence_no: Joi.number().optional()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const {
                bs_id,
                sector_id,
                bs_type,
                particular_name,
                sequence_no
            } = req.body;

            /* ---------------- DUPLICATE CHECK ---------------- */
            const checkQuery = `
            SELECT bs_id
            FROM balancesheettemplates
            WHERE sector_id = ${sector_id}
              AND bs_type = '${bs_type}'
              AND particular_name = '${particular_name.trim()}'
              ${bs_id ? `AND bs_id != ${bs_id}` : ""}
        `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Balance sheet particular already exists"
                    )
                );
            }

            /* ---------------- UPDATE ---------------- */
            if (bs_id) {
                const updateObj = {
                    particular_name: particular_name.trim(),
                    updated_at: new Date()
                };

                // sequence update sirf tab jab frontend bheje
                if (sequence_no !== undefined) {
                    updateObj.sequence_no = sequence_no;
                }

                const updateQuery = `
                UPDATE balancesheettemplates
                SET ?
                WHERE bs_id = ${bs_id}
            `;

                const result = await insertData(updateQuery, updateObj, next);

                if (result.affectedRows === 0) {
                    return next(
                        CustomErrorHandler.notFound(
                            "Balance sheet template not found"
                        )
                    );
                }

                return res.json({
                    message: "Balance sheet template updated successfully"
                });
            }

            /* ---------------- AUTO SEQUENCE (INSERT) ---------------- */
            const seqQuery = `
            SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq
            FROM balancesheettemplates
            WHERE sector_id = ${sector_id}
              AND bs_type = '${bs_type}'
        `;

            const seqResult = await getData(seqQuery, next);
            const nextSequence = (seqResult[0]?.maxSeq || 0) + 1;

            /* ---------------- INSERT ---------------- */
            const insertObj = {
                sector_id,
                bs_type,
                particular_name: particular_name.trim(),
                sequence_no: nextSequence,
                created_at: new Date(),
                updated_at: new Date()
            };

            const insertQuery = `
            INSERT INTO balancesheettemplates SET ?
        `;

            await insertData(insertQuery, insertObj, next);

            return res.json({
                message: "Balance sheet template added successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async getBalanceSheetTemplates(req, res, next) {
        try {
            const { sector_id } = req.query;
            if (!sector_id) {
                return res.status(400).json({
                    message: "sector_id is required"
                });
            }

            const query = `
            SELECT
                bs_id,
                sector_id,
                bs_type,
                particular_name,
                sequence_no
            FROM balancesheettemplates
            WHERE sector_id = ${sector_id}
            ORDER BY bs_type, sequence_no
        `;

            const rows = await getData(query, next);

            return res.json({
                message: "success",
                data: rows || []
            });

        } catch (error) {
            next(error);
        }
    },
    async addUpdateBalanceSheetValues(req, res, next) {
        try {
            const { data = [], deletedYears = [] } = req.body;

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(400).json({ message: "Invalid input data" });
            }

            /* ================= SAVE / UPDATE ================= */
            for (const record of data) {

                const {
                    stock_details_id,
                    bs_id,
                    particular_name,
                    ...years
                } = record;

                if (!stock_details_id || !bs_id) continue;

                for (const year in years) {

                    if (
                        year === "stock_details_id" ||
                        year === "particular_name" ||
                        year === "bs_id"
                    ) continue;

                    const value = years[year];
                    if (value === null || value === undefined) continue;

                    /* -------- YEAR TABLE -------- */
                    let yearResult = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    let year_id;
                    if (yearResult.length > 0) {
                        year_id = yearResult[0].year_id;
                    } else {
                        const insertYear = await insertData(
                            "INSERT INTO years SET ?",
                            { year },
                            next
                        );
                        year_id = insertYear.insertId;
                    }

                    /* -------- CHECK EXISTING -------- */
                    const exists = await getData(
                        `SELECT bs_value_id, value
                     FROM balancesheetvalues
                     WHERE stock_details_id='${stock_details_id}'
                       AND bs_id='${bs_id}'
                       AND year_id='${year_id}'`,
                        next
                    );

                    if (exists.length > 0) {
                        if (Number(exists[0].value) !== Number(value)) {
                            await insertData(
                                `UPDATE balancesheetvalues
                             SET value=?, isdeleted=0, updated_at=NOW()
                             WHERE bs_value_id=?`,
                                [value, exists[0].bs_value_id],
                                next
                            );
                        }
                    } else {
                        await insertData(
                            "INSERT INTO balancesheetvalues SET ?",
                            {
                                stock_details_id,
                                bs_id,
                                year_id,
                                value,
                                isdeleted: 0,
                                created_at: new Date(),
                                updated_at: new Date()
                            },
                            next
                        );
                    }
                }
            }

            /* ================= SOFT DELETE YEARS ================= */
            if (deletedYears.length > 0) {
                const stockId = data[0].stock_details_id;

                for (const year of deletedYears) {
                    const yearRes = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    if (!yearRes.length) continue;

                    await insertData(
                        `UPDATE balancesheetvalues
                     SET isdeleted=1, updated_at=NOW()
                     WHERE stock_details_id='${stockId}'
                       AND year_id='${yearRes[0].year_id}'`,
                        [],
                        next
                    );
                }
            }

            return res.json({
                success: true,
                message: "Balance sheet values saved successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async getBalanceSheetValues(req, res, next) {
        try {
            const { stock_details_id } = req.query;

            if (!stock_details_id) {
                return res.status(400).json({
                    message: "stock_details_id required"
                });
            }

            const query = `
            SELECT
                bsv.bs_id,
                y.year,
                bsv.value
            FROM balancesheetvalues bsv
            JOIN years y ON bsv.year_id = y.year_id
            WHERE bsv.stock_details_id = '${stock_details_id}'
            AND bsv.isdeleted = 0
            ORDER BY y.year
        `;

            const rows = await getData(query, next);

            if (!rows.length) {
                return res.json({
                    message: "success",
                    data: {
                        years: [],
                        values: {}
                    }
                });
            }

            const yearsSet = new Set();
            const values = {};

            rows.forEach(r => {
                yearsSet.add(r.year);

                if (!values[r.year]) values[r.year] = {};
                values[r.year][r.bs_id] = Number(r.value);
            });

            return res.json({
                message: "success",
                data: {
                    years: Array.from(yearsSet),
                    values
                }
            });

        } catch (err) {
            next(err);
        }
    },
    async addUpdatePLTemplates(req, res, next) {
        try {
            /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                pl_id: Joi.number().optional(),
                sector_id: Joi.number().required(),
                particular_name: Joi.string().required(),
                sequence_no: Joi.number().optional()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const {
                pl_id,
                sector_id,
                particular_name,
                sequence_no
            } = req.body;

            /* ---------------- DUPLICATE CHECK ---------------- */
            const checkQuery = `
            SELECT pl_id
            FROM pl_templates
            WHERE sector_id = ${sector_id}
              AND particular_name = '${particular_name.trim()}'
              ${pl_id ? `AND pl_id != ${pl_id}` : ""}
        `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "PL Template particular already exists"
                    )
                );
            }

            /* ---------------- UPDATE ---------------- */
            if (pl_id) {
                const updateObj = {
                    particular_name: particular_name.trim(),
                    updated_at: new Date()
                };

                // sequence update sirf tab jab frontend bheje
                if (sequence_no !== undefined) {
                    updateObj.sequence_no = sequence_no;
                }

                const updateQuery = `
                UPDATE pl_templates
                SET ?
                WHERE pl_id = ${pl_id}
            `;

                const result = await insertData(updateQuery, updateObj, next);

                if (result.affectedRows === 0) {
                    return next(
                        CustomErrorHandler.notFound(
                            "PL template not found"
                        )
                    );
                }

                return res.json({
                    message: "PL template updated successfully"
                });
            }

            /* ---------------- AUTO SEQUENCE (INSERT) ---------------- */
            const seqQuery = `
            SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq
            FROM pl_templates
            WHERE sector_id = ${sector_id}
        `;

            const seqResult = await getData(seqQuery, next);
            const nextSequence = (seqResult[0]?.maxSeq || 0) + 1;

            /* ---------------- INSERT ---------------- */
            const insertObj = {
                sector_id,
                particular_name: particular_name.trim(),
                sequence_no: nextSequence,
                created_at: new Date(),
                updated_at: new Date()
            };

            const insertQuery = `
            INSERT INTO pl_templates SET ?
        `;

            await insertData(insertQuery, insertObj, next);

            return res.json({
                message: "PL template added successfully"
            });
        } catch (error) {
            next(error);
        }
    },
    async getPLTemplates(req, res, next) {
        try {
            const { sector_id } = req.query;
            if (!sector_id) {
                return res.status(400).json({
                    message: "sector_id is required"
                });
            }

            const query = `
            SELECT
                pl_id,
                sector_id,
                particular_name,
                sequence_no
            FROM pl_templates
            WHERE sector_id = ${sector_id}
            ORDER BY sequence_no
        `;

            const rows = await getData(query, next);

            return res.json({
                message: "success",
                data: rows || []
            });

        } catch (error) {
            next(error);
        }
    },
    async getPLSheetValues(req, res, next) {
        try {
            const { stock_details_id } = req.query;
            if (!stock_details_id) {
                return res.status(400).json({
                    message: "stock_details_id required"
                });
            }

            const query = `
            SELECT
                plv.pl_id,
                y.year,
                plv.value
            FROM pl_values plv
            JOIN years y ON plv.year_id = y.year_id
            WHERE plv.stock_details_id = '${stock_details_id}'
            AND plv.isdeleted = 0
            ORDER BY y.year
        `;

            const rows = await getData(query, next);
            if (!rows.length) {
                return res.json({
                    message: "success",
                    data: {
                        years: [],
                        values: {}
                    }
                });
            }

            const yearsSet = new Set();
            const values = {};

            rows.forEach(r => {
                yearsSet.add(r.year);

                if (!values[r.year]) values[r.year] = {};
                values[r.year][r.pl_id] = Number(r.value);
            });

            return res.json({
                message: "success",
                data: {
                    years: Array.from(yearsSet),
                    values
                }
            });

        } catch (err) {
            next(err);
        }
    },
    async addUpdatePLValues(req, res, next) {
        try {
            const { data = [], deletedYears = [] } = req.body;

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(400).json({ message: "Invalid input data" });
            }
            /* ================= SAVE / UPDATE ================= */
            for (const record of data) {

                const {
                    stock_details_id,
                    pl_id,
                    particular_name,
                    ...years
                } = record;

                if (!stock_details_id || !pl_id) continue;
                for (const year in years) {

                    if (
                        year === "stock_details_id" ||
                        year === "particular_name" ||
                        year === "pl_id"
                    ) continue;

                    const value = years[year];
                    if (value === null || value === undefined) continue;

                    /* -------- YEAR TABLE -------- */
                    let yearResult = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    let year_id;
                    if (yearResult.length > 0) {
                        year_id = yearResult[0].year_id;
                    } else {
                        const insertYear = await insertData(
                            "INSERT INTO years SET ?",
                            { year },
                            next
                        );
                        year_id = insertYear.insertId;
                    }
                    /* -------- CHECK EXISTING -------- */
                    const exists = await getData(
                        `SELECT pl_valueId, value
                     FROM pl_values
                     WHERE stock_details_id='${stock_details_id}'
                       AND pl_id='${pl_id}'
                       AND year_id='${year_id}'`,
                        next
                    );
                    if (exists.length > 0) {
                        if (Number(exists[0].value) !== Number(value)) {
                            await insertData(
                                `UPDATE pl_values
                             SET value=?, isdeleted=0, updated_at=NOW()
                             WHERE pl_valueId=?`,
                                [value, exists[0].pl_valueId],
                                next
                            );
                        }
                    } else {
                        await insertData(
                            "INSERT INTO pl_values SET ?",
                            {
                                stock_details_id,
                                pl_id,
                                year_id,
                                value,
                                isdeleted: 0,
                                created_at: new Date(),
                                updated_at: new Date()
                            },
                            next
                        );
                    }
                }
            }

            /* ================= SOFT DELETE YEARS ================= */
            if (deletedYears.length > 0) {
                const stockId = data[0].stock_details_id;

                for (const year of deletedYears) {
                    const yearRes = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    if (!yearRes.length) continue;

                    await insertData(
                        `UPDATE pl_values
                     SET isdeleted=1, updated_at=NOW()
                     WHERE stock_details_id='${stockId}'
                       AND year_id='${yearRes[0].year_id}'`,
                        [],
                        next
                    );
                }
            }

            return res.json({
                success: true,
                message: "P & L values saved successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async addupdateFRTemplate(req, res, next) {
        try {
            const schema = Joi.object({
                ratio_id: Joi.number().optional(),
                sector_id: Joi.number().required(),
                particular_name: Joi.string().required(),
                sequence_no: Joi.number().optional()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const { ratio_id, sector_id, particular_name, sequence_no } = req.body;

            // Duplicate check
            const dupQuery = `
            SELECT ratio_id 
            FROM financial_ratio_templates
            WHERE sector_id = ${sector_id}
              AND particular_name = '${particular_name.trim()}'
              ${ratio_id ? `AND ratio_id != ${ratio_id}` : ""}
        `;

            const exists = await getData(dupQuery, next);
            if (exists.length > 0) {
                return next(CustomErrorHandler.alreadyExist("Ratio already exists"));
            }

            // UPDATE
            if (ratio_id) {
                const updateObj = {
                    particular_name: particular_name.trim(),
                    updated_at: new Date()
                };

                if (sequence_no !== undefined) updateObj.sequence_no = sequence_no;

                const updateQuery = `
                UPDATE financial_ratio_templates SET ? WHERE ratio_id = ${ratio_id}
            `;

                await insertData(updateQuery, updateObj, next);

                return res.json({ message: "Ratio updated successfully" });
            }

            // AUTO SEQUENCE
            const seqQ = `
            SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq
            FROM financial_ratio_templates
            WHERE sector_id = ${sector_id}
        `;
            const seqR = await getData(seqQ, next);
            const nextSeq = (seqR[0]?.maxSeq || 0) + 1;

            const insertObj = {
                sector_id,
                particular_name: particular_name.trim(),
                sequence_no: nextSeq,
                created_at: new Date(),
                updated_at: new Date()
            };

            const insertQuery = `INSERT INTO financial_ratio_templates SET ?`;
            await insertData(insertQuery, insertObj, next);

            return res.json({ message: "Ratio added successfully" });
        } catch (error) {
            next(error);
        }
    },
    async getFRTemplates(req, res, next) {
        try {
            const { sector_id } = req.query;
            if (!sector_id) return res.status(400).json({ message: "sector_id is required" });

            const query = `
            SELECT ratio_id, sector_id, particular_name, sequence_no
            FROM financial_ratio_templates
            WHERE sector_id = ${sector_id}
            ORDER BY sequence_no
        `;

            const rows = await getData(query, next);

            return res.json({ message: "success", data: rows || [] });
        } catch (err) {
            next(err);
        }
    },
    async getFRSheetValues(req, res, next) {
        try {
            const { stock_details_id } = req.query;
            if (!stock_details_id) {
                return res.status(400).json({
                    message: "stock_details_id required"
                });
            }

            const query = `
            SELECT
                frv.ratio_id,
                y.year,
                frv.value
            FROM financial_ratio_values frv
            JOIN years y ON frv.year_id = y.year_id
            WHERE frv.stock_details_id = '${stock_details_id}'
            AND frv.isdeleted = 0
            ORDER BY y.year
        `;

            const rows = await getData(query, next);
            if (!rows.length) {
                return res.json({
                    message: "success",
                    data: {
                        years: [],
                        values: {}
                    }
                });
            }

            const yearsSet = new Set();
            const values = {};

            rows.forEach(r => {
                yearsSet.add(r.year);

                if (!values[r.year]) values[r.year] = {};
                values[r.year][r.ratio_id] = Number(r.value);
            });

            return res.json({
                message: "success",
                data: {
                    years: Array.from(yearsSet),
                    values
                }
            });

        } catch (err) {
            next(err);
        }
    },
    async addUpdateFRValues(req, res, next) {
        try {
            const { data = [], deletedYears = [] } = req.body;

            if (!Array.isArray(data) || data.length === 0) {
                return res.status(400).json({ message: "Invalid input data" });
            }
            /* ================= SAVE / UPDATE ================= */
            for (const record of data) {

                const {
                    stock_details_id,
                    ratio_id,
                    particular_name,
                    ...years
                } = record;

                if (!stock_details_id || !ratio_id) continue;
                for (const year in years) {

                    if (
                        year === "stock_details_id" ||
                        year === "particular_name" ||
                        year === "ratio_id"
                    ) continue;

                    const value = years[year];
                    if (value === null || value === undefined) continue;

                    /* -------- YEAR TABLE -------- */
                    let yearResult = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    let year_id;
                    if (yearResult.length > 0) {
                        year_id = yearResult[0].year_id;
                    } else {
                        const insertYear = await insertData(
                            "INSERT INTO years SET ?",
                            { year },
                            next
                        );
                        year_id = insertYear.insertId;
                    }
                    /* -------- CHECK EXISTING -------- */
                    const exists = await getData(
                        `SELECT fr_valueId, value
                     FROM financial_ratio_values
                     WHERE stock_details_id='${stock_details_id}'
                       AND ratio_id='${ratio_id}'
                       AND year_id='${year_id}'`,
                        next
                    );
                    if (exists.length > 0) {
                        if (Number(exists[0].value) !== Number(value)) {
                            await insertData(
                                `UPDATE financial_ratio_values
                             SET value=?, isdeleted=0, updated_at=NOW()
                             WHERE fr_valueId=?`,
                                [value, exists[0].fr_valueId],
                                next
                            );
                        }
                    } else {
                        await insertData(
                            "INSERT INTO financial_ratio_values SET ?",
                            {
                                stock_details_id,
                                ratio_id,
                                year_id,
                                value,
                                isdeleted: 0,
                                created_at: new Date(),
                                updated_at: new Date()
                            },
                            next
                        );
                    }
                }
            }

            /* ================= SOFT DELETE YEARS ================= */
            if (deletedYears.length > 0) {
                const stockId = data[0].stock_details_id;

                for (const year of deletedYears) {
                    const yearRes = await getData(
                        `SELECT year_id FROM years WHERE year='${year}'`,
                        next
                    );

                    if (!yearRes.length) continue;

                    await insertData(
                        `UPDATE financial_ratio_values
                     SET isdeleted=1, updated_at=NOW()
                     WHERE stock_details_id='${stockId}'
                       AND year_id='${yearRes[0].year_id}'`,
                        [],
                        next
                    );
                }
            }

            return res.json({
                success: true,
                message: "Financial values saved successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async stockDetailsByIDPeer(req, res, next) {
        try {
            const { id } = req.params;
            if (!id) {
                return res.status(400).json({
                    message: "Stock ID is required"
                });
            }
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
                ON sp.stock_details_id = s.stock_details_id
               AND sp.present_date = (
                    SELECT MAX(p2.present_date)
                    FROM stock_price p2
                    WHERE p2.stock_details_id = s.stock_details_id
                      AND p2.present_date <= CURDATE()
               )
            WHERE s.stock_details_id = ${id}
            LIMIT 1
        `;
            const data = await getData(query, next);
            if (!data.length) {
                return res.status(404).json({
                    message: "Stock not found"
                });
            }
            res.json({
                message: "success",
                data: data[0]
            });

        } catch (err) {
            next(err);
        }
    },
    async getPeerComparison(req, res, next) {
        try {
            const { stock_details_id, peer_id } = req.query;

            if (!stock_details_id) {
                return next(
                    CustomErrorHandler.requiredField("stock_details_id is required")
                );
            }

            let query = `
            SELECT *
            FROM peer_comparison
            WHERE stock_details_id = '${stock_details_id}'
        `;

            if (peer_id) {
                query += ` AND peer_id = '${peer_id}'`;
            }

            query += " ORDER BY peer_id asc";

            const data = await getData(query, next);

            res.json({
                success: true,
                message: "Peer comparison fetched successfully",
                data
            });

        } catch (err) {
            next(err);
        }
    },
    async AddPeerComparison(req, res, next) {
        try {
            const schema = Joi.object({
                peer_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),

                peer_stock_id: Joi.number().integer().allow(null),

                company_name: Joi.string().allow(null),
                face_value: Joi.number().allow(null),
                marketCap: Joi.number().allow(null),
                pe: Joi.number().allow(null),
                revenue: Joi.number().allow(null),
                pat: Joi.number().allow(null),
                eps: Joi.number().allow(null)
            });
            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            /* ------------------ DUPLICATE CHECK ------------------ */
            let duplicateQuery = `
                SELECT peer_id 
                FROM peer_comparison
                WHERE stock_details_id = '${dataObj.stock_details_id}'
            `;

            // CASE 1: If peer_stock_id exists → check by peer_stock_id
            if (dataObj.peer_stock_id !== null) {
                duplicateQuery += ` AND peer_stock_id = '${dataObj.peer_stock_id}'`;
            }
            // CASE 2: If peer_stock_id is null → check by company_name
            else {
                duplicateQuery += ` AND company_name = '${dataObj.company_name}'`;
            }
            if (dataObj.peer_id) {
                duplicateQuery += ` AND peer_id != '${dataObj.peer_id}'`;
            }

            const duplicate = await getData(duplicateQuery, next);
            if (duplicate.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Peer comparison already exists for this stock"
                    )
                );
            }
            const query = dataObj.peer_id
                ? `UPDATE peer_comparison SET ?, update_date = NOW() WHERE peer_id='${dataObj.peer_id}'`
                : `INSERT INTO peer_comparison SET ?, created_date = NOW()`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.peer_id = result.insertId;
            }
            res.json({
                success: true,
                message: dataObj.peer_id && req.body.peer_id
                    ? "Peer comparison updated successfully"
                    : "Peer comparison added successfully",
                data: dataObj
            });
        } catch (error) {

        }
    },
    async getDeletePeer(req, res, next) {
        try {
            const { peer_id } = req.query;
            console.log(peer_id);
            if (!peer_id) {
                return next(
                    CustomErrorHandler.requiredField("peer_id is required")
                );
            }

            const checkQuery = `
            SELECT peer_id 
            FROM peer_comparison 
            WHERE peer_id = '${peer_id}'
        `;

            const exists = await getData(checkQuery, next);

            if (exists.length === 0) {
                return next(
                    CustomErrorHandler.notFound("Peer comparison not found")
                );
            }

            // DELETE RECORD
            const deleteQuery = `
            DELETE FROM peer_comparison 
            WHERE peer_id = '${peer_id}'
        `;

            await getData(deleteQuery, next);

            res.json({
                success: true,
                message: "Peer comparison deleted successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async chartBulkUpload(req, res, next) {
        try {
            const stock_id = req.body.stock_id;

            if (!stock_id) {
                return res.status(400).json({
                    success: false,
                    message: "stock_id required"
                });
            }

            let file = null;
            if (req.file) file = req.file;
            else if (req.files && req.files[0]) file = req.files[0];
            else if (req.files && req.files.excel_file) file = req.files.excel_file[0];

            if (!file) {
                return res.status(400).json({ success: false, message: "Excel file required" });
            }

            const workbook = XLSX.read(file.buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
            let inserted = [];
            let skipped = [];
            const dates = [];
            const seenDates = new Set();
            for (let i = 0; i < rows.length; i++) {
                const dateCell = rows[i][0];
                const priceCell = rows[i][1];
                if (typeof dateCell === "string" && isNaN(Date.parse(dateCell))) {
                    continue;
                }
                if (!dateCell || !priceCell) {
                    continue;
                }
                let present_date = "";
                if (typeof dateCell === "string" && dateCell.includes("/")) {
                    // dd/mm/yyyy → yyyy-mm-dd 00:00:00
                    const [d, m, y] = dateCell.split("/");
                    present_date = `${y}-${m}-${d} 00:00:00`;
                } else {
                    // Excel numeric date
                    const dt = new Date((dateCell - 25569) * 86400 * 1000);
                    present_date = dt.toISOString().slice(0, 10) + " 00:00:00";
                }
                const today_prices = Number(priceCell);
                if (isNaN(today_prices)) continue;
                const onlyDate = present_date.slice(0, 10);
                console.log(onlyDate)
                if (seenDates.has(onlyDate)) {
                    skipped.push({
                        date: present_date,
                        reason: "Duplicate date inside Excel — skipped"
                    });
                    continue;
                }
                seenDates.add(onlyDate);
                const exists = await getData(
                    `SELECT stock_price_id 
                 FROM stock_price 
                 WHERE stock_details_id='${stock_id}'
                 AND DATE(present_date) = DATE('${present_date}')
                 LIMIT 1`,
                    next
                );
                if (exists.length > 0) {
                    skipped.push({
                        date: present_date,
                        reason: "Date already exists in DB — skipped"
                    });
                    continue;
                }
                const prev = await getData(
                    `SELECT today_prices 
                 FROM stock_price
                 WHERE stock_details_id='${stock_id}'
                 AND present_date < '${present_date}'
                 ORDER BY present_date DESC
                 LIMIT 1`,
                    next
                );
                const prev_price = prev.length > 0 ? prev[0].today_prices : today_prices;
                const payload = {
                    stock_details_id: stock_id,
                    prev_price,
                    today_prices,
                    partner_price: 0,
                    conviction_level: "HIGH",
                    availability: "AVAILABLE",
                    lot: 100,
                    present_date,
                    created_at: new Date(),
                    update_date: new Date(),
                    time: new Date()
                };
                await insertData(`INSERT INTO stock_price SET ?`, payload, next);
                inserted.push({
                    date: present_date,
                    price: today_prices
                });
            }
            return res.json({
                success: true,
                message: "Chart data uploaded successfully",
                inserted_count: inserted.length,
                skipped_count: skipped.length,
                inserted,
                skipped
            });
        } catch (err) {
            next(err);
        }
    },
    async chartSingleUpload(req, res, next) {
        try {
            const { stock_id, price, date } = req.body;

            if (!stock_id) return res.status(400).json({ success: false, message: "stock_id required" });
            if (!price) return res.status(400).json({ success: false, message: "price required" });
            if (!date) return res.status(400).json({ success: false, message: "date required" });

            const present_date = date + " 00:00:00";

            // Check duplicate
            const exists = await getData(
                `SELECT stock_price_id FROM stock_price 
             WHERE stock_details_id='${stock_id}'
             AND DATE(present_date)=DATE('${present_date}') LIMIT 1`,
                next
            );

            if (exists.length > 0) {
                return res.json({
                    success: false,
                    skipped_count: 1,
                    inserted_count: 0,
                    skipped: [{ date: present_date, reason: "Date already exists in DB" }],
                    inserted: []
                });
            }

            // Previous price
            const prev = await getData(
                `SELECT today_prices FROM stock_price
             WHERE stock_details_id='${stock_id}'
             AND present_date < '${present_date}'
             ORDER BY present_date DESC LIMIT 1`,
                next
            );

            const prev_price = prev.length ? prev[0].today_prices : price;

            const payload = {
                stock_details_id: stock_id,
                prev_price,
                today_prices: price,
                partner_price: 0,
                conviction_level: "HIGH",
                availability: "AVAILABLE",
                lot: 100,
                present_date,
                created_at: new Date(),
                update_date: new Date(),
                time: new Date()
            };

            await insertData(`INSERT INTO stock_price SET ?`, payload, next);

            return res.json({
                success: true,
                inserted_count: 1,
                skipped_count: 0,
                inserted: [{ date: present_date, price }],
                skipped: []
            });

        } catch (err) {
            next(err);
        }
    }
}
export default PriceController