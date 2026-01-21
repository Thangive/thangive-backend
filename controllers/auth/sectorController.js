import { randomInt } from 'crypto';
import Joi from 'joi';
import { getCount, getData, insertData } from '../../config/index.js';
import { imageUpload, paginationQuery, commonFuction } from '../../helper/index.js';
import CustomErrorHandler from '../../service/CustomErrorHandler.js';

const sectorController = {
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
            res.json({
                message: "error",
                error
            });
        }
    },

    async createSectors(req, res, next) {
        try {
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

    async updateSector(req, res, next) {
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
            res.json({
                message: "success",
                data: {
                    industriesData: data
                }
            });
        } catch (error) {
            res.json({
                message: "error",
                error
            });
        }
    },

    async createIndustry(req, res, next) {
        try {
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
    },

    async getSubindustryData(req, res) {
        try {
            const query = `
            SELECT 
                si.subindustry_id,
                si.sub_industryName,
                si.industry_id,
                si.sector_id,
                i.industry_name,
                s.sector_name
            FROM stock_subindustry si
            LEFT JOIN stock_industry i 
                ON si.industry_id = i.industry_id
            LEFT JOIN stock_sector s
                ON si.sector_id = s.sector_id
            ORDER BY si.subindustry_id DESC
        `;
            const data = await getData(query, "");

            return res.json({
                message: "success",
                data: {
                    subIndustriesData: data
                }
            });

        } catch (error) {
            return res.json({
                message: "error",
                error
            });
        }
    },
    async createSubindustry(req, res, next) {
        try {
            const subIndustrySchema = Joi.object({
                name: Joi.string().required(),
                industry_id: Joi.number().required(),
                sector_id: Joi.number().required()
            });
            const { error } = subIndustrySchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const dataObj = {
                sub_industryName: req.body.name.trim(),
                industry_id: req.body.industry_id,
                sector_id: req.body.sector_id
            };
            const checkQuery = `
                SELECT sub_industryName 
                FROM stock_subindustry 
                WHERE sub_industryName='${dataObj.sub_industryName}' 
                AND industry_id='${dataObj.industry_id}'
                AND sector_id='${dataObj.sector_id}'
            `;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Sub-industry already exists in this industry")
                );
            }
            const insertQuery = `INSERT INTO stock_subindustry SET ?`;

            const result = await insertData(insertQuery, dataObj, next);
            if (result.insertId) {
                dataObj.subindustry_id = result.insertId;
            }
            return res.json({
                message: "success",
                data: dataObj
            });
        } catch (error) {
            next(error);
        }
    },
    async updatesubinditries(req, res, next) {
        try {
            const subIndustrySchema = Joi.object({
                subindustry_id: Joi.number().required(),          // subindustry_id
                name: Joi.string().required(),
                industry_id: Joi.number().required(),
                sector_id: Joi.number().required()
            });
            const { error } = subIndustrySchema.validate(req.body);
            if (error) {
                return next(error);
            }
            const { subindustry_id, name, industry_id, sector_id } = req.body;
            const dataObj = {
                sub_industryName: name.trim(),
                industry_id,
                sector_id
            };
            const checkQuery = `
                SELECT subindustry_id 
                FROM stock_subindustry 
                WHERE sub_industryName='${name}'
                AND industry_id=${industry_id}
                AND sector_id=${sector_id}
                AND subindustry_id != ${subindustry_id}
            `;
            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Sub-industry already exists in this industry")
                );
            }
            const updateQuery = `
                UPDATE stock_subindustry
                SET ?
                WHERE subindustry_id=${subindustry_id}
            `;
            const result = await insertData(updateQuery, dataObj, next);
            if (result.affectedRows === 0) {
                return next(CustomErrorHandler.notFound("Sub-industry not found"));
            }
            const fetchQuery = `
                SELECT 
                    si.subindustry_id,
                    si.sub_industryName,
                    si.industry_id,
                    si.sector_id,
                    i.industry_name,
                    s.sector_name
                FROM stock_subindustry si
                LEFT JOIN stock_industry i ON si.industry_id = i.industry_id
                LEFT JOIN stock_sector s ON si.sector_id = s.sector_id
                WHERE si.subindustry_id = ${subindustry_id}
            `;
            const updatedData = await getData(fetchQuery, next);
            return res.json({
                message: "success",
                data: updatedData[0]
            });
        } catch (error) {
            next(error);
        }
    },
    async getStockDetailsonly(req, res, next) {
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
                ON sp.stock_details_id = s.stock_details_id
               AND sp.present_date = (
                    SELECT MAX(p2.present_date)
                    FROM stock_price p2
                    WHERE p2.stock_details_id = s.stock_details_id
                      AND p2.present_date <= CURDATE()
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
    async getStockDetailsById(req, res, next) {
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
                sd.*,
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
            LEFT JOIN stock_description sd
                ON sd.stock_details_id = s.stock_details_id
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
    async getDivident(req, res, next) {
        try {
            const { id } = req.params;
            if (!id) {
                return res.status(400).json({
                    message: "Stock ID is required"
                });
            }
            let query = `SELECT * FROM stock_devidet WHERE stock_details_id=${id}`;
            const data = await getData(query, next);
            if (!data.length) 
            {
                return res.json({
                    message: "Divident not found"
                });
            }
            res.json({
                message: "success",
                data: data
            });
        } catch (err) {
            next(err);
        }
    },

    async deleteDividend(req, res, next) {
        try {
            const { id } = req.params;
            if (!id) {
                return res.status(400).json({
                    message: "Dividend ID is required"
                });
            }
            const query = `
                DELETE FROM stock_devidet
                WHERE devidet_id = ${id}
            `;
            const result = await getData(query, next);
            return res.json({
                message: "Dividend deleted successfully"
            });
        } catch (err) {
            next(err);
        }
    },
    async getAnualReport(req, res, next) {
        const { id } = req.params;
        try {
            if (!id) {
                return res.status(400).json({
                    message: "Stock ID is required"
                });
            }
            let query = `SELECT * FROM anual_report WHERE stock_details_id = ${parseInt(id)} ORDER BY anual_report_id DESC`;
            const data = await getData(query, next);
            if (!data.length) {
                return res.json({
                    message: "Report not found"
                });
            }
            res.json({
                message: "success",
                data: data
            });
        } catch (err) {
            next(err);
        }
    },
}

export default sectorController