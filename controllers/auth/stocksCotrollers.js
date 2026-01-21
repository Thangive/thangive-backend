import { randomInt } from 'crypto';
import Joi from 'joi';
import { getCount, getData, insertData } from '../../config/index.js';
import { imageUpload, paginationQuery, commonFuction } from '../../helper/index.js';
import CustomErrorHandler from '../../service/CustomErrorHandler.js';


const stocksControllers = {
    async addUpdateStockDetails(req, res, next) {
        try {
            // ------------------ Validation Schema ------------------
            const stockSchema = Joi.object({
                stock_details_id: Joi.number().integer().optional(),
                sector_id: Joi.number().integer().required(),
                industry_id: Joi.number().integer().required(),
                subindustry_id: Joi.number().integer().required(),
                company_name: Joi.string().required(),
                script_name: Joi.string().required(),

                No_of_outstanding_shares: Joi.number().integer().required(),

                isin_no: Joi.string().required(),
                pan_no: Joi.string().allow(""),
                cin: Joi.string().allow(""),

                industry: Joi.string().required(),

                drhp_filed: Joi.boolean().required(),
                available_on: Joi.string().required(),

                face_value: Joi.number().required(),
                registration_date: Joi.string().required(),

                cmp_logo: Joi.string().allow("").optional(),
                stock_type: Joi.string().required()
            });

            // ------------------ Validate ------------------
            const { error } = stockSchema.validate(req.body);
            if (error) {
                return next(error);
            }

            const dataObj = { ...req.body };

            // ------------------ Handle file upload ------------------
            // if (req.files && req.files.cmp_logo && req.files.cmp_logo.length > 0) {
            //     const file = req.files.cmp_logo[0];
            //     dataObj.cmp_logo = `uploads/upload/${file.filename}`; // save relative path in DB
            // }

            if (req.files?.cmp_logo?.length > 0) {
                const file = req.files.cmp_logo[0];
                dataObj.cmp_logo = `uploads/upload/${file.filename}`;
            }

            // ------------------ Duplicate ISIN Check ------------------
            let condition = "";
            if (dataObj.stock_details_id) {
                condition = ` AND stock_details_id != '${dataObj.stock_details_id}'`;
            }

            const checkQuery =
                `SELECT isin_no FROM stock_details WHERE isin_no='${dataObj.isin_no}' ${condition}`;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(CustomErrorHandler.alreadyExist("ISIN number already exists"));
            }

            // ------------------ Insert / Update ------------------
            let query = "";
            if (dataObj.stock_details_id) {
                query = `UPDATE stock_details SET ? WHERE stock_details_id='${dataObj.stock_details_id}'`;
            } else {
                query = `INSERT INTO stock_details SET ?`;
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.stock_details_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.stock_details_id
                    ? "Stock details saved successfully"
                    : "Stock details updated successfully",
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async addUpdateStockDescription(req, res, next) {
        try {
            // ------------------ Validation Schema ------------------
            const descriptionSchema = Joi.object({
                stock_description_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                company_snapshot: Joi.string().optional(),
                company_outlook: Joi.string().optional()
            });

            const { error } = descriptionSchema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            // ------------------ Duplicate check ------------------
            let condition = '';
            if (dataObj.stock_description_id) {
                condition = ` AND stock_description_id != '${dataObj.stock_description_id}'`;
            }

            const checkQuery = `SELECT * FROM stock_description WHERE stock_details_id='${dataObj.stock_details_id}' ${condition}`;
            const exists = await getData(checkQuery, next);

            if (exists.length > 0 && !dataObj.stock_description_id) {
                return next(CustomErrorHandler.alreadyExist("Description for this stock already exists"));
            }

            // ------------------ Insert / Update ------------------
            let query = '';
            if (dataObj.stock_description_id) {
                query = `UPDATE stock_description SET ? WHERE stock_description_id='${dataObj.stock_description_id}'`;
            } else {
                query = `INSERT INTO stock_description SET ?`;
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.stock_description_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.stock_description_id
                    ? "Stock description updated successfully"
                    : "Stock description added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateClientPortfolioHeading(req, res, next) {
        try {
            // ------------------ Validation ------------------
            const schema = Joi.object({
                stock_details_id: Joi.number().integer().required(),
                cp_heading_id: Joi.number().integer().optional(),
                heading1: Joi.string().required(),
                heading2: Joi.string().required(),
                heading3: Joi.string().required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            // ------------------ Duplicate Check ------------------
            let condition = '';
            // if (dataObj.cp_heading_id) {
            //     condition = ` AND cp_heading_id != '${dataObj.cp_heading_id}'`;
            // }

            // const checkQuery = `
            //     SELECT * 
            //     FROM clientPortfolio_Heading 
            //     WHERE stock_details_id = '${dataObj.stock_details_id}' ${condition} `;

            // const exists = await getData(checkQuery, next);
            // if (exists.length > 0) {
            //     return next(
            //         CustomErrorHandler.alreadyExist("Client portfolio heading already exists")
            //     );
            // }

            // ------------------ Insert / Update ------------------
            const query = dataObj.cp_heading_id
                ? `UPDATE clientportfolio_heading SET ? WHERE cp_heading_id='${dataObj.cp_heading_id}'`
                : `INSERT INTO clientportfolio_heading SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.cp_heading_id = result.insertId;
            }

            res.json({
                success: true,
                message: dataObj.cp_heading_id
                    ? "Client portfolio heading updated successfully"
                    : "Client portfolio heading added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateClientPortfolioData(req, res, next) {
        try {
            // ------------------ Validation ------------------
            const schema = Joi.object({
                cp_data_id: Joi.number().integer().optional(),
                cp_heading_id: Joi.number().integer().required(),
                stock_details_id: Joi.number().integer().required(),
                data1: Joi.string().required(),
                data2: Joi.string().required(),
                data3: Joi.string().required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            // ------------------ Duplicate Check ------------------
            // let condition = dataObj.cp_data_id
            //     ? ` AND cp_data_id != '${dataObj.cp_data_id}'`
            //     : '';

            // const checkQuery = `
            //     SELECT cp_data_id
            //     FROM clientPortfolio_Data
            //     WHERE cp_heading_id='${dataObj.cp_heading_id}'
            //     AND stock_details_id='${dataObj.stock_details_id}'
            //     ${condition}
            // `;

            // const exists = await getData(checkQuery, next);
            // if (exists.length > 0) {
            //     return next(
            //         CustomErrorHandler.alreadyExist(
            //             "Client portfolio data already exists for this heading and stock"
            //         )
            //     );
            // }

            // ------------------ Insert / Update ------------------
            const query = dataObj.cp_data_id
                ? `UPDATE clientportfolio_data SET ? WHERE cp_data_id='${dataObj.cp_data_id}'`
                : `INSERT INTO clientportfolio_data SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.cp_data_id = result.insertId;
            }

            res.json({
                success: true,
                message: dataObj.cp_data_id
                    ? "Client portfolio data updated successfully"
                    : "Client portfolio data added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateDividend(req, res, next) {
        try {
            // ------------------ Validation ------------------
            const schema = Joi.object({
                devidet_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                finacial_year: Joi.string().required(),
                declaration_date: Joi.date().optional().allow(""),
                devident_per_share: Joi.number().precision(2).required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = {
                ...req.body,
                updated_date: new Date()
            };

            if (!dataObj.devidet_id) {
                dataObj.created_date = new Date();
            }
            // ------------------ Duplicate Check ------------------
            let condition = dataObj.devidet_id
                ? ` AND devidet_id != '${dataObj.devidet_id}'`
                : '';

            // const checkQuery = `
            //     SELECT devidet_id
            //     FROM stock_devidet
            //     WHERE stock_details_id='${dataObj.stock_details_id}'
            //     AND finacial_year='${dataObj.finacial_year}'
            //     ${condition}
            // `;

            // const exists = await getData(checkQuery, next);
            // if (exists.length > 0) {
            //     return next(
            //         CustomErrorHandler.alreadyExist(
            //             "Dividend already exists for this stock and financial year"
            //         )
            //     );
            // }

            // ------------------ Insert / Update ------------------
            const query = dataObj.devidet_id
                ? `UPDATE stock_devidet SET ? WHERE devidet_id='${dataObj.devidet_id}'`
                : `INSERT INTO stock_devidet SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.devidet_id = result.insertId;
            }

            res.json({
                success: true,
                message: dataObj.devidet_id
                    ? "Dividend updated successfully"
                    : "Dividend added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateAnnualReport(req, res, next) {
        try {
            // ------------------ Build Data Object ------------------
            const dataObj = {
                ...req.body,
                update_date	: new Date()
            };

            // ------------------ Document Path ------------------
            if (req.files?.document) {
                dataObj.document = `uploads/upload/${req.files.document[0].filename}`;
            }

            if (!dataObj.anual_report_id) {
                dataObj.created_date = new Date();
            }

            // ------------------ Validation ------------------
            const schema = Joi.object({
                anual_report_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                year: Joi.string().required(),
                report_date: Joi.date().optional(),
                heading: Joi.string().required(),
                document: Joi.string().allow("").required(),
                created_date: Joi.date().optional(),
                update_date: Joi.date().optional()
            });

            const { error } = schema.validate(dataObj);
            if (error) return next(error);

            // ------------------ Duplicate Check ------------------
            let condition = dataObj.anual_report_id
                ? ` AND anual_report_id != '${dataObj.anual_report_id}'`
                : '';

            const checkQuery = `
            SELECT anual_report_id 
            FROM anual_report
            WHERE stock_details_id='${dataObj.stock_details_id}'
            AND year='${dataObj.year}'
            ${condition}
        `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Annual report already exists for this year"
                    )
                );
            }

            // ------------------ Insert / Update ------------------
            const query = dataObj.anual_report_id
                ? `UPDATE anual_report SET ? WHERE anual_report_id='${dataObj.anual_report_id}'`
                : `INSERT INTO anual_report SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.anual_report_id = result.insertId;
            }

            res.json({
                success: true,
                message: dataObj.anual_report_id
                    ? "Annual report updated successfully"
                    : "Annual report added successfully",
                data: dataObj
            });
        } catch (error) {
            next(error);
        }
    },


    async addUpdatePortfolio(req, res, next) {
        try {
            req.body.stock_details_id = Number(req.body.stock_details_id);
            if (req.body.portfolio_id) {
                req.body.portfolio_id = Number(req.body.portfolio_id);
            }

            /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                portfolio_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                portfolio_link: Joi.string().uri().optional(),
                existing_gallery: Joi.string().optional()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = {
                stock_details_id: req.body.stock_details_id,
                portfolio_link: req.body.portfolio_link,
                update_date: new Date()
            };

            /* ---------------- FINAL SERVICE GALLERY ---------------- */
            let finalGallery = [];

            // OLD images (frontend se aayi)
            if (req.body.existing_gallery) {
                try {
                    finalGallery = JSON.parse(req.body.existing_gallery);
                } catch (e) {
                    finalGallery = [];
                }
            }

            // NEW uploaded images
            if (req.files && req.files.service_gallery?.length > 0) {
                const newImages = req.files.service_gallery.map(
                    file => `uploads/upload/${file.filename}`
                );
                finalGallery = [...finalGallery, ...newImages];
            }

            dataObj.service_gallery = JSON.stringify(finalGallery);

            if (!req.body.portfolio_id) {
                dataObj.created_date = new Date();
            }

            /* ---------------- INSERT / UPDATE ---------------- */
            const query = req.body.portfolio_id
                ? `UPDATE product_portfolio SET ? WHERE portfolio_id='${req.body.portfolio_id}'`
                : `INSERT INTO product_portfolio SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.portfolio_id = result.insertId;
            }

            res.json({
                success: true,
                message: req.body.portfolio_id
                    ? "Portfolio updated successfully"
                    : "Portfolio created successfully",
                data: {
                    ...dataObj,
                    service_gallery: JSON.parse(dataObj.service_gallery)
                }
            });

        } catch (error) {
            next(error);
        }
    },


    async getStockData(req, res, next) {
        try {
            // Base query: join details, description, and latest price
            let query = `SELECT s.*,sd.company_snapshot,sd.company_outlook FROM stock_details s LEFT JOIN stock_description sd ON s.stock_details_id = sd.stock_details_id LEFT JOIN stock_devidet d ON s.stock_details_id = d.stock_details_id LEFT JOIN anual_report ar ON s.stock_details_id = ar.stock_details_id LEFT JOIN product_portfolio pp ON s.stock_details_id = pp.stock_details_id WHERE 1`;

            let cond = '';
            let page = { pageQuery: '' };

            // Validation schema for query params
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

            // Filters
            if (req.query.company_name) cond += ` AND s.company_name LIKE '%${req.query.company_name}%'`;
            if (req.query.script_name) cond += ` AND s.script_name LIKE '%${req.query.script_name}%'`;
            if (req.query.isin_no) cond += ` AND s.isin_no LIKE '%${req.query.isin_no}%'`;
            if (req.query.stock_type) cond += ` AND s.stock_type = '${req.query.stock_type}'`;

            // Pagination
            if (req.query.pagination) {
                page = await paginationQuery(query + cond, next, req.query.current_page, req.query.per_page_records);
            }

            query += cond + page.pageQuery;

            // Fetch data
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

    async addUpdateShareHolding(req, res, next) {
        try {
            const shareholdingData = req.body;
            if (!Array.isArray(shareholdingData) || shareholdingData.length === 0) {
                return res.status(400).json({ message: "Invalid input data" });
            }

            for (const record of shareholdingData) {
                const { category, shareholder, stock_details_id, deleted = 0, ...years } = record;

                if (!category || !shareholder || !stock_details_id) continue;

                // ------------------ Category ------------------
                let categoryResult = await getData(
                    `SELECT category_id FROM categories WHERE category_name = '${category.replace(/'/g, "\\'")}'`,
                    next
                );

                let category_id;
                if (categoryResult.length > 0) {
                    category_id = categoryResult[0].category_id;
                } else {
                    const insertCat = await insertData(
                        "INSERT INTO categories SET ?",
                        { category_name: category },
                        next
                    );
                    category_id = insertCat.insertId;
                }

                // ------------------ Shareholder ------------------
                // let shareholderResult = await getData(
                //     `SELECT shareholder_id FROM shareholders WHERE shareholder_name = '${shareholder.replace(/'/g, "\\'")}'`,
                //     next
                // );
                let shareholderResult = await getData(
                    `SELECT shareholder_id 
                    FROM shareholders 
                    WHERE shareholder_name='${shareholder.replace(/'/g, "\\'")}'
                    AND stock_details_id='${stock_details_id}'`,
                    next
                );

                let shareholder_id;
                if (shareholderResult.length > 0) {
                    shareholder_id = shareholderResult[0].shareholder_id;
                } else {
                    const insertShare = await insertData(
                        "INSERT INTO shareholders SET ?",
                        { stock_details_id, shareholder_name: shareholder },
                        next
                    );
                    shareholder_id = insertShare.insertId;
                }

                // ------------------ Loop over dynamic years ------------------
                for (const year in years) {
                    const value = years[year];
                    if (value == null) continue;

                    // ------------------ Year ------------------
                    let yearResult = await getData(
                        `SELECT year_id FROM years WHERE year = '${year.replace(/'/g, "\\'")}'`,
                        next
                    );

                    let year_id;
                    if (yearResult.length > 0) {
                        year_id = yearResult[0].year_id;
                    } else {
                        const insertYear = await insertData(
                            "INSERT INTO years SET ?",
                            { year: year },
                            next
                        );
                        year_id = insertYear.insertId;
                    }

                    // ------------------ Insert / Update Shareholding ------------------
                    const exists = await getData(
                        `SELECT shareholding_id, value ,deleted
                         FROM shareholding 
                         WHERE category_id = '${category_id}' 
                           AND stock_details_id = '${stock_details_id}'
                           AND shareholder_id='${shareholder_id}'
                           AND year_id = '${year_id}'`,
                        next
                    );

                    if (exists.length > 0) {
                        if (
                            exists[0].value !== value ||
                            Number(exists[0].deleted) !== Number(deleted)
                        ) {
                            await insertData(
                                "UPDATE shareholding SET ? WHERE shareholding_id = ?",
                                [{ value, deleted }, exists[0].shareholding_id],
                                next
                            );
                        }
                    } else {
                        await insertData(
                            "INSERT INTO shareholding SET ?",
                            { category_id, stock_details_id, shareholder_id, year_id, value, deleted },
                            next
                        );
                    }
                }
            }

            return res.json({
                success: true,
                data: shareholdingData,
                message: "Shareholding data saved successfully"
            });

        } catch (error) {
            next(error);
        }
    },

    async getShareHolding(req, res, next) {
        try {
            /* ---------------- STEP 1: Build dynamic year columns for used years ---------------- */

            const schema = Joi.object({
                stock_details_id: Joi.number().required(),
                category: Joi.string(),
                shareholder: Joi.string()
            });

            const { error } = schema.validate(req.query);
            if (error) return next(error);

            const stockId = req.query.stock_details_id;
            const yearColsSQL = `
                SELECT GROUP_CONCAT(
                    DISTINCT CONCAT(
                        'IFNULL(MAX(CASE WHEN y.year = ', y.year,
                        ' THEN sh.value END), 0) AS \`', y.year, '\`'
                    )
                    ORDER BY y.year
                ) AS cols
                FROM shareholding sh
                JOIN years y ON sh.year_id = y.year_id
                WHERE sh.stock_details_id = '${stockId}' AND sh.deleted = 0
            `;

            const yearColsResult = await getData(yearColsSQL, next);
            const yearColumns = yearColsResult?.[0]?.cols;
            if (!yearColumns) {
                return res.json({
                    message: 'success',
                    records: 0,
                    data: { shareHoldingData: [] }
                });
            }
            /* ---------------- STEP 2: Build base query with joins ---------------- */

            let query = `
            SELECT
                c.category_name AS category,
                s.shareholder_name AS shareholder,
                sh.deleted,
                ${yearColumns}
            FROM shareholding sh
            INNER JOIN categories c ON sh.category_id = c.category_id
            INNER JOIN shareholders s ON sh.shareholder_id = s.shareholder_id
            INNER JOIN years y ON sh.year_id = y.year_id
            WHERE 1
              AND sh.stock_details_id = ${stockId} AND sh.deleted = 0
        `;

            const values = [];

            /* ---------------- STEP 4: Filters (UNCHANGED) ---------------- */

            if (req.query.category) {
                query += ` AND c.category_name LIKE ?`;
                values.push(`%${req.query.category}%`);
            }

            if (req.query.shareholder) {
                query += ` AND s.shareholder_name LIKE ?`;
                values.push(`%${req.query.shareholder}%`);
            }

            /* ---------------- STEP 5: Grouping ---------------- */

            query += `
            GROUP BY c.category_name, s.shareholder_name
            ORDER BY c.category_name, s.shareholder_name
        `;

            /* ---------------- STEP 6: Execute query ---------------- */

            const data = await getData(query, next, values);

            /* ---------------- STEP 7: Send response ---------------- */

            res.json({
                message: 'success',
                total_records: data.length,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },

    async getCompanyPortfolioData(req, res, next) {
        try {
            const stock_details_id = Number(req.query.stock_details_id);

            if (!stock_details_id) {
                return res.status(400).json({
                    success: false,
                    message: "stock_details_id is required"
                });
            }

            const query = `
            SELECT 
                portfolio_id,
                stock_details_id,
                portfolio_link,
                service_gallery,
                created_date,
                update_date
            FROM product_portfolio
            WHERE stock_details_id = ${stock_details_id}
            ORDER BY portfolio_id DESC
        `;

            const result = await getData(query, next);

            const rows = Array.isArray(result)
                ? result
                : result
                    ? [result]
                    : [];

            const data = rows.map(row => ({
                ...row,
                service_gallery: row.service_gallery
                    ? JSON.parse(row.service_gallery)
                    : []
            }));

            res.json({
                success: true,
                data
            });

        } catch (error) {
            res.status(500).json({
                message: "Internal server error",
                error: error.message
            });
        }
    },
    async getClientPortfolioHeading(req, res, next) {
        try {
            const stock_details_id = Number(req.query.stock_details_id);

            if (!stock_details_id) {
                return res.status(400).json({
                    success: false,
                    message: "stock_details_id is required"
                });
            }

            const query = `
            SELECT *
            FROM clientportfolio_heading
            WHERE stock_details_id = ${stock_details_id}
            LIMIT 1
        `;

            const result = await getData(query, next);

            const data = Array.isArray(result) && result.length > 0
                ? result[0]
                : null;

            res.json({
                success: true,
                data
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    },
    async getClientPortfolioData(req, res, next) {
        try {
            const stock_details_id = Number(req.query.stock_details_id);
            const cp_heading_id = Number(req.query.cp_heading_id);

            if (!stock_details_id || !cp_heading_id) {
                return res.status(400).json({
                    success: false,
                    message: "stock_details_id and cp_heading_id are required"
                });
            }

            const query = `
            SELECT 
                cp_data_id,
                cp_heading_id,
                stock_details_id,
                data1,
                data2,
                data3,
                created_date,
                update_date
            FROM clientportfolio_data
            WHERE stock_details_id = ${stock_details_id}
              AND cp_heading_id = ${cp_heading_id}
            ORDER BY cp_data_id ASC
        `;

            const result = await getData(query, next);

            res.json({
                success: true,
                data: Array.isArray(result) ? result : []
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    }

};

export default stocksControllers;
