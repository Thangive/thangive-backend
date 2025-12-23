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

                cmp_logo: Joi.string().allow("").required(),
                stock_type: Joi.string().required()
            });

            // ------------------ Validate ------------------
            const { error } = stockSchema.validate(req.body);
            if (error) {
                return next(error);
            }

            const dataObj = { ...req.body };

            // ------------------ Handle file upload ------------------
            if (req.files && req.files.cmp_logo && req.files.cmp_logo.length > 0) {
                const file = req.files.cmp_logo[0];
                dataObj.cmp_logo = `uploads/upload/${file.filename}`; // save relative path in DB
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
            console.log(query);

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

    async addUpdateStockPrice(req, res, next) {
        try {
            // ------------------ Validation ------------------
            const schema = Joi.object({
                stock_price_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                prev_price: Joi.number().precision(2).required(),
                today_prices: Joi.number().precision(2).required(),
                partner_price: Joi.number().precision(2).required(),
                conviction_level: Joi.string().required(),
                availability: Joi.string().required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            // ------------------ Duplicate Check ------------------
            let condition = dataObj.stock_price_id ? ` AND stock_price_id != '${dataObj.stock_price_id}'` : '';
            const checkQuery = `
                SELECT stock_price_id 
                FROM stock_price 
                WHERE stock_details_id='${dataObj.stock_details_id}' 
                AND present_date='${dataObj.present_date}' ${condition}
            `;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) return next(CustomErrorHandler.alreadyExist("Stock price for this date already exists"));

            // ------------------ Insert / Update ------------------
            const query = dataObj.stock_price_id
                ? `UPDATE stock_price SET ? WHERE stock_price_id='${dataObj.stock_price_id}'`
                : `INSERT INTO stock_price SET ?`;

            const result = await insertData(query, dataObj, next);
            if (result.insertId) dataObj.stock_price_id = result.insertId;

            res.json({
                success: true,
                message: dataObj.stock_price_id ? "Stock price updated successfully" : "Stock price added successfully",
                data: dataObj
            });

        } catch (err) {
            next(err);
        }
    },

    async addUpdateStockDescription(req, res, next) {
        try {
            // ------------------ Validation Schema ------------------
            const descriptionSchema = Joi.object({
                stock_description_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                company_snapshot: Joi.string().required(),
                company_outlook: Joi.string().required()
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
                cp_heading_id: Joi.number().integer().optional(),
                heading1: Joi.string().required(),
                heading2: Joi.string().required(),
                heading3: Joi.string().required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = { ...req.body };

            // ------------------ Duplicate Check ------------------
            let condition = dataObj.cp_heading_id
                ? ` AND cp_heading_id != '${dataObj.cp_heading_id}'`
                : '';

            const checkQuery = `
                SELECT cp_heading_id 
                FROM clientPortfolio_Heading 
                WHERE heading1='${dataObj.heading1}'
                AND heading2='${dataObj.heading2}'
                AND heading3='${dataObj.heading3}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Client portfolio heading already exists")
                );
            }

            // ------------------ Insert / Update ------------------
            const query = dataObj.cp_heading_id
                ? `UPDATE clientPortfolio_Heading SET ? WHERE cp_heading_id='${dataObj.cp_heading_id}'`
                : `INSERT INTO clientPortfolio_Heading SET ?`;

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
            let condition = dataObj.cp_data_id
                ? ` AND cp_data_id != '${dataObj.cp_data_id}'`
                : '';

            const checkQuery = `
                SELECT cp_data_id
                FROM clientPortfolio_Data
                WHERE cp_heading_id='${dataObj.cp_heading_id}'
                AND stock_details_id='${dataObj.stock_details_id}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Client portfolio data already exists for this heading and stock"
                    )
                );
            }

            // ------------------ Insert / Update ------------------
            const query = dataObj.cp_data_id
                ? `UPDATE clientPortfolio_Data SET ? WHERE cp_data_id='${dataObj.cp_data_id}'`
                : `INSERT INTO clientPortfolio_Data SET ?`;

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
                devident_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().required(),
                finacial_year: Joi.string().required(),
                declaration_date: Joi.date().required(),
                devident_per_share: Joi.number().precision(2).required(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = {
                ...req.body,
                updated_date: new Date()
            };

            if (!dataObj.devident_id) {
                dataObj.created_date = new Date();
            }

            // ------------------ Duplicate Check ------------------
            let condition = dataObj.devident_id
                ? ` AND devident_id != '${dataObj.devident_id}'`
                : '';

            const checkQuery = `
                SELECT devident_id
                FROM devident
                WHERE stock_details_id='${dataObj.stock_details_id}'
                AND finacial_year='${dataObj.finacial_year}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        "Dividend already exists for this stock and financial year"
                    )
                );
            }

            // ------------------ Insert / Update ------------------
            const query = dataObj.devident_id
                ? `UPDATE devident SET ? WHERE devident_id='${dataObj.devident_id}'`
                : `INSERT INTO devident SET ?`;

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.devident_id = result.insertId;
            }

            res.json({
                success: true,
                message: dataObj.devident_id
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
            imageUpload(req, res, async (err) => {
                if (err) return next(err);

                // ------------------ Validation ------------------
                const schema = Joi.object({
                    anual_report_id: Joi.number().integer().optional(),
                    stock_details_id: Joi.number().integer().required(),
                    year: Joi.string().required(),
                    report_date: Joi.date().required(),
                    heading: Joi.string().required(),
                    document: Joi.string().allow("").required(),
                });

                // const dataObj = {
                //     ...req.body,
                //     updated_date: new Date()
                // };

                // ------------------ Document Path ------------------
                if (req.files?.document) {
                    dataObj.document = `uploads/upload/${req.files.document[0].filename}`;
                }

                // if (!dataObj.anual_report_id) {
                //     dataObj.created_date = new Date();
                // }

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
            });

        } catch (error) {
            next(error);
        }
    },

    async addUpdatePortfolio(req, res, next) {
        try {
            imageUpload(req, res, async (err) => {
                if (err) return next(err);

                // ------------------ Validation ------------------
                const schema = Joi.object({
                    portfolio_id: Joi.number().integer().optional(),
                    stock_details_id: Joi.number().integer().required(),
                    portfolio_link: Joi.string().uri().required()
                });

                const { error } = schema.validate(req.body);
                if (error) return next(error);

                const dataObj = {
                    stock_details_id: req.body.stock_details_id,
                    portfolio_link: req.body.portfolio_link,
                    updated_date: new Date()
                };

                // ------------------ Service Gallery Images ------------------
                if (req.files?.service_gallery) {
                    dataObj.service_gallery = JSON.stringify(
                        req.files.service_gallery.map(file =>
                            `uploads/upload/${file.filename}`
                        )
                    );
                }

                if (!req.body.portfolio_id) {
                    dataObj.created_date = new Date();
                }

                // ------------------ Insert / Update ------------------
                const query = req.body.portfolio_id
                    ? `UPDATE portfolio SET ? WHERE portfolio_id='${req.body.portfolio_id}'`
                    : `INSERT INTO portfolio SET ?`;

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
                        service_gallery: dataObj.service_gallery
                            ? JSON.parse(dataObj.service_gallery)
                            : []
                    }
                });
            });

        } catch (error) {
            next(error);
        }
    },

    async getStockData(req, res, next) {
        try {
            // Base query: join details, description, and latest price
            let query = `
                SELECT 
                    s.*, 
                    d.company_snapshot, 
                    d.company_outlook, 
                    p.stock_price_id, 
                    p.prev_price, 
                    p.today_prices, 
                    p.partner_price, 
                    p.conviction_level, 
                    p.availability
                FROM stock_details s
                JOIN stock_description d ON s.stock_details_id = d.stock_details_id
                JOIN stock_price p ON s.stock_details_id = p.stock_details_id
                INNER JOIN (
                    SELECT stock_details_id, MAX(present_date) as latest_date
                    FROM stock_price
                    GROUP BY stock_details_id
                ) lp ON p.stock_details_id = lp.stock_details_id AND p.present_date = lp.latest_date
                WHERE 1
            `;

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

};

export default stocksControllers;
