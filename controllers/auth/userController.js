import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler, JwtService } from "../../service/index.js";
import md5 from 'md5';
import paginationQuery from '../../helper/paginationQuery.js';
import commonFunction from '../../helper/commonFunction.js';

const userController = {
    async addUpdateUserProfile(req, res, next) {
        try {
            // ------------------ Validation Schema ------------------
            const baseSchema = {
                user_type: Joi.valid('user', 'RM', 'ADMIN', 'AM', 'SM', 'ST').required(),
                user_id: Joi.number().integer().optional(),
                employee_id: Joi.string().allow(""),
                profile: Joi.string().allow(""),
                username: Joi.string(),
                first_name: Joi.string(),
                middle_name: Joi.string().allow(""),
                last_name: Joi.string(),
                email: Joi.string().email(),
                phone_number: Joi.string(),
                whatsapp_number: Joi.string().allow(""),
                password: Joi.string().allow(""),
                residency_status: Joi.string().allow("")
            };

            const userSchema = Joi.object(baseSchema)
                .when(Joi.object({ user_type: Joi.valid('user') }).unknown(), {
                    // 👉 USER TYPE = user (your existing logic)
                    then: Joi.object()
                        .when(Joi.object({ user_id: Joi.exist() }).unknown(), {
                            then: Joi.object({
                                first_name: Joi.string().required(),
                                middle_name: Joi.string().optional(),
                                last_name: Joi.string().required(),
                                email: Joi.string().email().optional(),
                                phone_number: Joi.string().optional(),
                                whatsapp_number: Joi.string().optional(),
                                profile: Joi.string().optional(),
                                password: Joi.string().optional(),
                            }),
                            otherwise: Joi.object({
                                username: Joi.string().required(),
                                email: Joi.string().email().required(),
                                phone_number: Joi.string().required(),
                                user_type: Joi.string().required(),
                                residency_status: Joi.string().required(),
                            }),
                        }),
                })
                .when(Joi.object({ user_type: Joi.invalid('user') }).unknown(), {
                    // 👉 USER TYPE ≠ user (Admin / Staff / Employee etc.)
                    then: Joi.object({
                        first_name: Joi.string().required(),
                        middle_name: Joi.string().optional(),
                        last_name: Joi.string().required(),
                        email: Joi.string().email().required(),
                        whatsapp_number: Joi.string().optional(),
                        phone_number: Joi.string().required(),
                        profile: Joi.string().optional(),
                        user_type: Joi.string().required(),
                        username: Joi.string().required(),
                        password: Joi.string().optional(),
                        employee_id: Joi.string().required(),
                    })
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

            if (dataObj.user_type != 'user') {
                dataObj.user_custum_id = dataObj.employee_id;
                delete dataObj.employee_id;
            }

            // ------------------ Duplicate Email / Phone Check ------------------
            let condition = "";
            if ((dataObj.user_id && dataObj.user_type == 'user') || (dataObj.user_type != 'user')) {
                if (dataObj?.password) {
                    dataObj.password = md5(dataObj?.password);
                }
                condition = ` AND user_id != '${dataObj.user_id}'`;
            } else {
                const phone = String(dataObj?.phone_number || "").trim();
                dataObj.password = md5(phone);
                const checkQuery = `
                SELECT user_id 
                FROM users 
                WHERE (email='${dataObj.email}' 
                    OR phone_number='${dataObj.phone_number}') AND user_type = '${dataObj.user_type}'
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


            const exists = await getData(`SELECT user_id 
                FROM users 
<<<<<<< HEAD
                WHERE username = '${dataObj.username}' ${condition}`, next);
=======
                WHERE username = '${dataObj.username}'${condition}`, next);
>>>>>>> akash-branch
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        `${dataObj.username} Username already exists`
                    )
                );
            }
            // Send OTP only when creating new USER (no user_id)
            if (dataObj.user_type == 'user' && !dataObj.user_id) {
                const otp = await commonFunction.setOtp({ phoneNumber: dataObj.phone_number }, next);
                const message = `Dear User, ${otp} is your login OTP for account access. Do not share it with anyone. - THANGIV CONSULTANCY PRIVATE LIMITED`;
                await commonFunction.sendSMS(dataObj.phone_number, message);
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
                    ? `${dataObj.user_type} registered successfully`
                    : `${dataObj.user_type} updated successfully`,
                data: dataObj
            });

        } catch (error) {
            next(error);
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
                document_path: Joi.string()
                    .allow('')
                    .required()
                    .messages({
                        'any.required': 'Document (user_document) is required',
                    }),
                document_pass: Joi.string().allow("").optional(),
            }).when(Joi.object({ doc_id: Joi.exist() }).unknown(), {
                then: Joi.object({
                    document_path: Joi.string().required(),
                    document_pass: Joi.string().optional(),
                }),
            });

            // console.log(req.files);

            /* ------------------ Validate ------------------ */
            var dataObj = { ...req.body };

            /* ------------------ Handle file upload ------------------ */
            if (req.files?.user_document?.length > 0) {
                const file = req.files.user_document[0];
                dataObj.document_path = file.path;
            }
            console.log(JSON.stringify(dataObj, null, 12));
            const { error } = documentSchema.validate(dataObj);
            if (error) {
                return next(error);
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
    },

    async addUpdateUserBankDetails(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const bankSchema = Joi.object({
                bank_id: Joi.number().integer().optional(),

                user_id: Joi.number().integer().required(),
                bank_name: Joi.string().required(),
                account_type: Joi.string().required(),
                account_no: Joi.string().required(),
                ifsc_code: Joi.string().required(),
                account_status: Joi.string().required(),
                phone_number: Joi.string().required(),

                statement: Joi.string()
                    .allow('')
                    .required()
                    .messages({
                        'any.required': 'Bank statement(bank_document) is required',
                    }),

                doc_pass: Joi.string().allow('').optional(),
            }).when(Joi.object({ bank_id: Joi.exist() }).unknown(), {
                then: Joi.object({
                    statement: Joi.string().required(),
                    doc_pass: Joi.string().optional(),
                }),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Handle File Upload ------------------ */
            if (req.files?.bank_document?.length > 0) {
                const file = req.files.bank_document[0];
                dataObj.statement = file.path;
            }

            console.log(JSON.stringify(dataObj, null, 4));

            /* ------------------ Validate ------------------ */
            const { error } = bankSchema.validate(dataObj);
            if (error) {
                return next(error);
            }

            /* ------------------ Duplicate Account Check ------------------ */
            let condition = '';
            if (dataObj.bank_id) {
                condition = `AND bank_id != ${dataObj.bank_id}`;
            }

            const checkQuery = `
                SELECT bank_id
                FROM user_bank_details
                WHERE user_id = ${dataObj.user_id}
                AND account_no = '${dataObj.account_no}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        'Bank account already exists for this user'
                    )
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.bank_id) {
                query = `UPDATE user_bank_details SET ? WHERE bank_id = ${dataObj.bank_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO user_bank_details SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.bank_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.bank_id
                    ? 'User bank details saved successfully'
                    : 'User bank details updated successfully',
                data: dataObj,
            });

        } catch (error) {
            next(error);
        }
    },

    async addUpdateUserCMRDetails(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const cmrSchema = Joi.object({
                cmr_id: Joi.number().integer().optional(),

                user_id: Joi.number().integer().required(),
                broker_id: Joi.string().required(),
                client_id: Joi.string().required(),
                cmr_document: Joi.string()
                    .allow('')
                    .optional()
                    .messages({
                        'any.required': 'CMR document (cmr_document) is required',
                    }),

            }).when(Joi.object({ cmr_id: Joi.exist() }).unknown(), {
                then: Joi.object({
                    cmr_document: Joi.string().optional(),
                }),
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };

            /* ------------------ Handle File Upload ------------------ */
            if (req.files?.cmr_document?.length > 0) {
                const file = req.files.cmr_document[0];
                dataObj.cmr_document = file.path;
            }

            console.log(JSON.stringify(dataObj, null, 4));

            /* ------------------ Validate ------------------ */
            const { error } = cmrSchema.validate(dataObj);
            if (error) {
                return next(error);
            }

            /* ------------------ Duplicate CMR Check ------------------ */
            let condition = '';
            if (dataObj.cmr_id) {
                condition = `AND cmr_id != ${dataObj.cmr_id}`;
            }

            const checkQuery = `
                SELECT cmr_id
                FROM user_cmr_details
                WHERE user_id = ${dataObj.user_id}
                AND broker_id = '${dataObj.broker_id}'
                AND client_id = '${dataObj.client_id}'
                ${condition}
            `;

            const exists = await getData(checkQuery, next);
            if (exists.length > 0) {
                return next(
                    CustomErrorHandler.alreadyExist(
                        'CMR details already exist for this user'
                    )
                );
            }

            /* ------------------ Insert / Update ------------------ */
            let query = '';
            if (dataObj.cmr_id) {
                query = `UPDATE user_cmr_details SET ? WHERE cmr_id = ${dataObj.cmr_id}`;
                dataObj.updated_on = new Date();
            } else {
                query = `INSERT INTO user_cmr_details SET ?`;
                dataObj.created_at = new Date();
            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.cmr_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.cmr_id
                    ? 'User CMR details saved successfully'
                    : 'User CMR details updated successfully',
                data: dataObj,
            });

        } catch (error) {
            next(error);
        }
    },

    async getUserProfile(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = "SELECT * FROM users WHERE 1 AND is_deleted = 0 AND user_type != 'ADMIN'";
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const userSchema = Joi.object({
                user_id: Joi.number().integer(),
                username: Joi.string(),
                email: Joi.string().email(),
                phone_number: Joi.string(),
                user_type: Joi.valid('user', 'RM', 'ADMIN', 'AM', 'SM', 'ST').optional(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = userSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.user_id) {
                cond += ` AND user_id = ${req.query.user_id}`;
            }

            if (req.query.user_type) {
                cond += ` AND user_type = '${req.query.user_type}'`;
            }

            if (req.query.username) {
                cond += ` AND username LIKE '%${req.query.username}%'`;
            }

            if (req.query.email) {
                cond += ` AND email LIKE '%${req.query.email}%'`;
            }

            if (req.query.phone_number) {
                cond += ` AND phone_number LIKE '%${req.query.phone_number}%'`;
            }

            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += cond + page.pageQuery;

            /* ------------------ Fetch Users ------------------ */
            const users = await getData(query, next);

            /* ------------------ Attach Documents ------------------ */
            if (users.length) {
                for (const user of users) {
                    const docQuery = `
                        SELECT * FROM user_documents
                        WHERE is_deleted = 0 AND user_id = ${user.user_id}
                    `;
                    const documents = await getData(docQuery, next);
                    user.documents = documents ?? [];
                }
            }

            /* ------------------ Bank  Details ------------------ */
            if (users.length) {
                for (const user of users) {
                    const docQuery = `
                        SELECT * FROM user_bank_details
                        WHERE is_deleted = 0 AND user_id = ${user.user_id}
                    `;
                    const bankDetails = await getData(docQuery, next);
                    user.bankDetails = bankDetails ?? [];
                }
            }

            /* ------------------ Bank  Details ------------------ */
            if (users.length) {
                for (const user of users) {
                    const docQuery = `
                    SELECT 
                        cmr.*,
                        broker.broker_custom_id,
                        broker.broker_name,
                        broker.broker_email,
                        broker.broker_contact
                    FROM user_cmr_details AS cmr
                    INNER JOIN broker 
                        ON broker.broker_id = cmr.broker_id
                    WHERE cmr.is_deleted = 0
                      AND cmr.user_id = "${user.user_id}"
                `;
                    const cmrDetails = await getData(docQuery, next);
                    user.cmrDetails = cmrDetails ?? [];
                }
            }

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? users.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: users.length,
                data: users
            });

        } catch (err) {
            next(err);
        }
    },

    async getRMList(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = "SELECT `user_id` AS `id`,`username` FROM `users` WHERE `user_type`='RM' AND is_deleted = 0";
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const userSchema = Joi.object({
                user_id: Joi.number().integer(),
                username: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = userSchema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.user_id) {
                cond += ` AND user_id = ${req.query.user_id}`;
            }

            if (req.query.username) {
                cond += ` AND username LIKE '%${req.query.username}%'`;
            }

            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += cond + page.pageQuery;

            /* ------------------ Fetch Users ------------------ */
            const users = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? users.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: users.length,
                data: users
            });

        } catch (err) {
            next(err);
        }
    },

    async assignToRM(req, res, next) {
        const userSchema = Joi.object({
            user_id: Joi.number().integer().required(),
            assign_to: Joi.number().integer().required(),
        });

        const dataObj = req.body ?? {};
        const { error } = userSchema.validate(dataObj);
        if (error) {
            return next(error);
        }

        try {
            // ---------- Check user exists ----------
            const checkUserQuery = `
                SELECT user_id 
                FROM users 
                WHERE user_id = ${dataObj.user_id}
            `;

            const userExists = await getData(checkUserQuery, next);
            if (!userExists || userExists.length === 0) {
                return next(
                    CustomErrorHandler.doesNotExist("User not found")
                );
            }

            // ---------- Check RM exists ----------
            const checkRMQuery = `
                SELECT user_id 
                FROM users 
                WHERE user_id = ${dataObj.assign_to}
            `;

            const rmExists = await getData(checkRMQuery, next);
            if (!rmExists || rmExists.length === 0) {
                return next(
                    CustomErrorHandler.doesNotExist("RM not found")
                );
            }

            // ---------- Update assignment ----------
            const updateQuery = `
                UPDATE users 
                SET assign_to = ${dataObj.assign_to}
                WHERE user_id = ${dataObj.user_id}
            `;

            await insertData(updateQuery, next);

            return res.json({
                success: true,
                message: "RM assigned to user successfully",
                data: {
                    user_id: dataObj.user_id,
                    assign_to: dataObj.assign_to
                }
            });

        } catch (err) {
            return next(err);
        }
    }

}


export default userController;