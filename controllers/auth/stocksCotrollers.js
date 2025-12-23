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

                // cmp_logo: Joi.string().allow("").required(),
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

    async getSectorData(req, res) {
        try {
            const query = `SELECT * FROM stock_sector`;
            const data = await getData(query, "");
            res.json({
                message: "success",
                data: {
                    sectordata: data
                }
            });
        } catch (error) {
            console.log("Error:", error);

            res.json({
                message: "error",
                error
            });
        }
    },

    async createSectors(req,res,next)
    {
        try{
            const sectorSchema = Joi.object({
                name: Joi.string().required()
            });
            const { error } = sectorSchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const dataObj = { sector_name: req.body.name };
            
            const checkQuery = `SELECT sector_name FROM stock_sector WHERE sector_name='${dataObj.sector_name}'`;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Sector already exists")
                );
            }
            const insertQuery = `INSERT INTO stock_sector SET ?`;
            const result = await insertData(insertQuery, dataObj, next);
            if (result.insertId) {
                dataObj.sector_id = result.insertId;
            }
            return res.json({
                message: "success",
                data: dataObj
            });
            } catch (error) {
            next(error);
        }
    },

    async updateSector(req,res,next)
    {
        try {
            const sectorSchema = Joi.object({
                id: Joi.number().required(),
                name: Joi.string().required()
            });
            const { error } = sectorSchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const { id, name } = req.body;
            const dataObj = { sector_name: name };
            const checkQuery = `
                SELECT sector_id, sector_name 
                FROM stock_sector 
                WHERE sector_name='${name}' AND sector_id != ${id}
            `;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Sector already exists")
                );
            }
            const updateQuery = `
                UPDATE stock_sector 
                SET ? 
                WHERE sector_id=${id}
            `;
            const result = await insertData(updateQuery, dataObj, next);
            if (result.affectedRows === 0) {
                return next(
                    CustomErrorHandler.notFound("Sector not found")
                );
            }
            const updated = {
                sector_id: id,
                sector_name: name
            };
            return res.json({
                message: "success",
                data: updated
            });
        } catch (error) {
            next(error);
        }
    },

    async getIndustryData(req, res) {
        try {
            const query = `SELECT 
                    i.industry_id,
                    i.industry_name,
                    i.sector_id,
                    s.sector_name
                FROM stock_industry i
                LEFT JOIN stock_sector s
                ON i.sector_id = s.sector_id
                ORDER BY i.industry_id DESC
            `;
            const data = await getData(query, "");
            // console.log(data);
            res.json({
                message: "success",
                data: {
                    industriesData: data
                }
            });
        } catch (error) {
            console.log("Error:", error);

            res.json({
                message: "error",
                error
            });
        }
    },

    async createIndustry(req,res,next)
    {
        try{
            const industrySchema = Joi.object({
                name: Joi.string().required(),
                sector_id: Joi.number().required()
            });
            const { error } = industrySchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const dataObj = { 
                industry_name: req.body.name.trim(),
                sector_id: req.body.sector_id
            };
            
            const checkQuery = `SELECT industry_name FROM stock_industry WHERE industry_name='${dataObj.industry_name}' AND sector_id='${dataObj.sector_id}'`;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Industry already exists in this sector")
                );
            }
            const insertQuery = `INSERT INTO stock_industry SET ?`;
            const result = await insertData(insertQuery, dataObj, next);
            if (result.insertId) {
                dataObj.industry_id = result.insertId;
            }
            return res.json({
                message: "success",
                data: dataObj
            });
            } catch (error) {
            next(error);
        }
    },
    async updateIndistry(req, res, next) {
        try {
            const industrySchema = Joi.object({
                id: Joi.number().required(),
                name: Joi.string().required(),
                sector_id: Joi.number().required()
            });
            const { error } = industrySchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const { id, name, sector_id } = req.body;
            const dataObj = { 
                industry_name: name,
                sector_id: sector_id
            };
            const checkQuery = `
                SELECT industry_id 
                FROM stock_industry 
                WHERE industry_name='${name}' AND industry_id != ${id}
            `;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Industry already exists")
                );
            }
            const updateQuery = `
                UPDATE stock_industry
                SET ?
                WHERE industry_id=${id}
            `;
            const result = await insertData(updateQuery, dataObj, next);
            if (result.affectedRows === 0) {
                return next(
                    CustomErrorHandler.notFound("Industry not found")
                );
            }
            const fetchUpdated = `
                SELECT 
                    i.industry_id,
                    i.industry_name,
                    i.sector_id,
                    s.sector_name
                FROM stock_industry i
                LEFT JOIN stock_sector s
                    ON i.sector_id = s.sector_id
                WHERE i.industry_id = ${id}
            `;
            const updatedData = await getData(fetchUpdated, next);
            return res.json({
                message: "success",
                data: updatedData[0]
            });
        } catch (error) {
            next(error);
        }
    }
};

export default stocksControllers;
