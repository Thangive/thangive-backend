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

                cmp_logo: Joi.string().allow(""),
                stock_type: Joi.string().required()
            });

            // ------------------ Validate ------------------
            const { error } = stockSchema.validate(req.body);
            if (error) {
                return next(error);
            }

            const dataObj = { ...req.body };


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

    async getStockData(req, res, next) {
        res.json({
            "data": "data"
        })
    }
};

export default stocksControllers;
