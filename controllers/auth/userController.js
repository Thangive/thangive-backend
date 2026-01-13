import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler, JwtService } from "../../service/index.js";
import md5 from 'md5';

const userController = {
    async addUpdateUserProfile(req, res, next) {
        try {
            // ------------------ Validation Schema ------------------
            const userSchema = Joi.object({
                user_id: Joi.number().integer().optional(),

                profile: Joi.string().allow(""),
                username: Joi.string(),
                first_name: Joi.string(),
                middle_name: Joi.string().allow(""),
                last_name: Joi.string(),

                email: Joi.string().email(),
                phone_number: Joi.string(),
                whatsapp_number: Joi.string().allow(""),
            }).when(Joi.object({ user_id: Joi.exist() }).unknown(), {
                then: Joi.object({
                    profile: Joi.string().required(),
                    username: Joi.string().optional(),
                    first_name: Joi.string().required(),
                    middle_name: Joi.string().required(),
                    last_name: Joi.string().required(),
                    email: Joi.string().email().optional(),
                    phone_number: Joi.string().optional(),
                    whatsapp_number: Joi.string().required(),
                    password: Joi.string().required()
                }),
                otherwise: Joi.object({
                    username: Joi.string().required(),
                    email: Joi.string().email().required(),
                    phone_number: Joi.string().required(),
                }),
            });


            var dataObj = { ...req.body };

            if (req.files?.profile?.length > 0) {
                const file = req.files.profile[0];
                dataObj.profile = `uploads/upload/${file.filename}`;
            }
            // ------------------ Validate ------------------
            const { error } = userSchema.validate(dataObj ?? {});
            if (error) {
                return next(error);
            }
            // ------------------ Duplicate Email / Phone Check ------------------
            let condition = "";
            if (dataObj.user_id) {
                if (dataObj?.password) {
                    dataObj.password = md5(dataObj?.password);
                }
                condition = ` AND user_id != '${dataObj.user_id}'`;
            } else {
                dataObj.password = md5(dataObj?.phone_number);




                const checkQuery = `
                SELECT user_id 
                FROM users 
                WHERE (email='${dataObj.email}' 
                    OR phone_number='${dataObj.phone_number}') 
                ${condition}
            `;

                const exists = await getData(checkQuery, next);
                if (exists.length > 0) {
                    return next(
                        CustomErrorHandler.alreadyExist(
                            "Email or phone number already exists"
                        )
                    );
                }
            }

            // ------------------ Insert / Update ------------------
            let query = "";
            if (dataObj.user_id) {
                query = `UPDATE users SET ? WHERE user_id='${dataObj.user_id}'`;
            } else {
                query = `INSERT INTO users SET ?`;
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.user_id = result.insertId;
            }
            delete dataObj.password;

            return res.json({
                success: true,
                message: dataObj.user_id
                    ? "User profile saved successfully"
                    : "User profile updated successfully",
                data: dataObj
            });

        } catch (error) {
            next(error);
        }
    },

    async login(req, res, next) {
        try {
            // validation
            const loginSchema = Joi.object({
                // phone_number: Joi.string().length(10).pattern(/^[0-9]+$/).required(),
                // password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{3,30}$'))
                username: Joi.string().required(),
                password: Joi.string().required(),
            });

            const { error } = loginSchema.validate(req.body ?? {});
            if (error) {
                return next(error);
            }

            let query = "SELECT user_id,username,email,phone_number,password FROM users WHERE is_deleted=0 AND username='" + req.body.username + "';";
            console.log("---------------", query);
            await getData(query, next).then(async (data) => {
                if (data.length <= 0) {
                    return next(CustomErrorHandler.wrongCredentials());
                } else {
                    // const match = await bcrypt.compare(req.body.password, data[0].password);
                    const match = md5(req.body.password) === data[0].password ? true : false;
                    delete data[0].password;
                    if (!match) {
                        return next(CustomErrorHandler.wrongCredentials());
                    } else {
                        const accessToken = JwtService.sign({ _id: data[0].id, role: data[0].userType }, '1d');
                        res.json(
                            {
                                message: "User loged in successfully",
                                accessToken,
                                data: data[0]
                            }
                        )
                    }
                }
            });
        } catch (error) {
            next(error)
        }
    },

    async addUpdateUserDocument(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const documentSchema = Joi.object({
                doc_id: Joi.number().integer().optional(),

                user_id: Joi.number().integer().required(),
                document_name: Joi.string().required(),
                document_number: Joi.string().required(),
                document_path: Joi.string().allow("").optional(),
                document_pass: Joi.string().allow("").optional(),
            }).when(Joi.object({ doc_id: Joi.exist() }).unknown(), {
                then: Joi.object({
                    document_path: Joi.string().required(),
                    document_pass: Joi.string().optional(),
                }),
            });

            /* ------------------ Validate ------------------ */
            const { error } = documentSchema.validate(req.body);
            if (error) {
                return next(error);
            }

            const dataObj = { ...req.body };

            /* ------------------ Handle file upload ------------------ */
            if (req.files?.document_path?.length > 0) {
                const file = req.files.document_path[0];
                dataObj.document_path = `uploads/documents/${file.filename}`;
            }

            /* ------------------ Duplicate Document Check ------------------ */
            let condition = "";
            if (dataObj.doc_id) {
                condition = `AND doc_id != ${dataObj.doc_id}`;
            }

            const checkQuery = `
                SELECT doc_id
                FROM user_documents
                WHERE user_id = ${dataObj.user_id}
                AND document_name = '${dataObj.document_name}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist("Document already exists for this user")
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = "";
            if (dataObj.doc_id) {
                query = `UPDATE user_documents SET ? WHERE doc_id = ${dataObj.doc_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO user_documents SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.doc_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.doc_id
                    ? "User document saved successfully"
                    : "User document updated successfully",
                data: dataObj,
            });

        } catch (error) {
            next(error);
        }
    }


}


export default userController;