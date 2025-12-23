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
            console.log("Error:", error);

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
    }
}

export default sectorController