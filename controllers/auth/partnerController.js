import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler, JwtService } from "../../service/index.js";
import md5 from 'md5';
import paginationQuery from '../../helper/paginationQuery.js';
import commonFunction from '../../helper/commonFunction.js';

const partnerController = {
    async getPartners(req, res, next) {
        try {

            /* ------------------ Base Query ------------------ */
            let query = `
                SELECT 
                    u.*,
                    p.partner_financial_id,
                    p.business_type,
                    p.gst_compliant,
                    p.gst_number,
                    p.aadhar_number,
                    p.pan_number,
                    p.aadharcard_copy,
                    p.pancard_copy,
                    p.cmr_copy,
                    p.stamp_signature,
                    p.aadhar_status,
                    p.pan_status,
                    p.cmr_status,
                    p.stamp_signature_status,
                    p.is_deleted AS financial_is_deleted,
                    p.franchise_upload_date,
                    p.franchise_status,
                    p.franchise_agreement,
                    p.created_at AS financial_created_at,
                    p.updated_on AS financial_updated_on
                FROM users u
                LEFT JOIN partner_financial_details p
                    ON p.user_id = u.user_id
                    AND p.is_deleted = 0
                WHERE u.is_deleted = 0
                AND u.is_verified = 1
                AND u.user_type = 'PARTNER'
            `;

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const userSchema = Joi.object({
                user_id: Joi.number().integer(),
                assign_to: Joi.number().integer(),
                username: Joi.string(),
                search: Joi.string(),
                searchUsernamePhone_numberEmail: Joi.string(),
                email: Joi.string().email(),
                phone_number: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
                status: Joi.string()
            });

            const { error } = userSchema.validate(req.query);

            if (error) {
                return next(error);
            }

            /* ------------------ Filters ------------------ */

            if (req.query.user_id) {
                cond += ` AND u.user_id = ${req.query.user_id}`;
            }

            if (req.query.assign_to) {
                cond += ` AND u.assign_to = ${req.query.assign_to}`;
            }

            if (req.query.username) {
                cond += ` AND u.username LIKE '%${req.query.username}%'`;
            }

            if (req.query.email) {
                cond += ` AND u.email LIKE '%${req.query.email}%'`;
            }

            if (req.query.phone_number) {
                cond += ` AND u.phone_number LIKE '%${req.query.phone_number}%'`;
            }

            if (req.query.search) {
                const search = req.query.search;

                cond += ` AND (
                    u.username LIKE '%${search}%'
                    OR u.phone_number LIKE '%${search}%'
                    OR CONCAT(
                        COALESCE(u.first_name, ''), ' ',
                        COALESCE(u.middle_name, ''), ' ',
                        COALESCE(u.last_name, '')
                    ) LIKE '%${search}%'
                )`;
            }

            if (req.query.searchUsernamePhone_numberEmail) {
                const search = req.query.searchUsernamePhone_numberEmail;

                cond += ` AND (
                    u.username LIKE '%${search}%'
                    OR u.phone_number LIKE '%${search}%'
                    OR u.email LIKE '%${search}%'
                )`;
            }

            // --- NEW STATUS FILTER LOGIC ---
            if (req.query.status) {
                const status = req.query.status.toLowerCase();

                if (status === 'pending') {
                    // Fetch if ANY of the statuses is NOT 'Verified' (or if it is null)
                    cond += ` AND (
                        COALESCE(p.aadhar_status, '') != 'Verified'
                        OR COALESCE(p.pan_status, '') != 'Verified'
                        OR COALESCE(p.cmr_status, '') != 'Verified'
                        OR COALESCE(p.stamp_signature_status, '') != 'Verified'
                        OR COALESCE(p.franchise_status, '') != 'Verified'
                    )`;
                } else if (status === 'verified') {
                    // Fetch ONLY if ALL of the statuses are 'Verified'
                    cond += ` AND (
                        p.aadhar_status = 'Verified'
                        AND p.pan_status = 'Verified'
                        AND p.cmr_status = 'Verified'
                        AND p.stamp_signature_status = 'Verified'
                        AND p.franchise_status = 'Verified'
                    )`;
                }
            }
            // -------------------------------

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

            /* ------------------ Fetch Partners ------------------ */

            const partners = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? partners.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: partners.length,
                data: partners
            });

        } catch (err) {

            next(err);

        }
    },
    async updatePartnerProfile(req, res, next) {
    },
    // async PartnerProfileCreateUpdate(req, res, next) {
    //     // console.log(req.body);
    //     try {
    //         /* ------------------ Prepare Data ------------------ */
    //         let dataObj = { ...req.body };
    //         /* ------------------ Validation ------------------ */
    //         const partnerSchema = Joi.object({
    //             user_id: Joi.number().integer().required(),

    //             first_name: Joi.string().required(),
    //             middle_name: Joi.string().allow(""),
    //             last_name: Joi.string().required(),

    //             email: Joi.string().email().required(),
    //             phone_number: Joi.string().required(),
    //             whatsapp_number: Joi.string().required(),

    //             state: Joi.string().required(),
    //             contry: Joi.string().required(),
    //             city: Joi.string().required(),
    //             address: Joi.string().required(),
    //             zipcode: Joi.string().required(),

    //             profile: Joi.string().allow(""),

    //             business_type: Joi.string().required(),
    //             gst_compliant: Joi.string().allow(""),
    //             gst_number: Joi.string().allow(""),
    //         });

    //         // console.log("BODY KEYS:", Object.keys(dataObj));
    //         // console.log("JOI KEYS:", Object.keys(partnerSchema.describe().keys));

    //         const { error } = partnerSchema.validate(dataObj, {
    //             abortEarly: false,
    //             allowUnknown: false,
    //         });

    //         if (error) {
    //             console.log("JOI ERROR:", error.details);
    //             return next(error);
    //         }
    //         /* ------------------ Check Partner Exists ------------------ */
    //         const checkPartnerQuery = `
    //             SELECT *
    //             FROM users
    //             WHERE user_id = '${dataObj.user_id}'
    //             AND user_type = 'PARTNER'
    //             AND is_deleted = 0
    //         `;
    //         const checkPartner = await getData(
    //             checkPartnerQuery,
    //             next
    //         );
    //         if (!checkPartner.length) {
    //             return next(
    //                 CustomErrorHandler.notFound("Partner not found")
    //             );
    //         }
    //         /* ------------------ Duplicate Email / Phone Check ------------------ */
    //         const duplicateQuery = `
    //             SELECT user_id
    //             FROM users
    //             WHERE (
    //                 email = '${dataObj.email}'
    //                 OR phone_number = '${dataObj.phone_number}'
    //             )
    //             AND user_type = 'PARTNER'
    //             AND user_id != '${dataObj.user_id}'
    //             AND is_deleted = 0
    //         `;
    //         const duplicateUser = await getData(
    //             duplicateQuery,
    //             next
    //         );
    //         if (duplicateUser.length > 0) {
    //             return next(
    //                 CustomErrorHandler.alreadyExist(
    //                     "Email or phone number already exists"
    //                 )
    //             );
    //         }
    //         /* ------------------ Update Users Table ------------------ */
    //         const userData = {
    //             first_name: dataObj.first_name,
    //             middle_name: dataObj.middle_name,
    //             last_name: dataObj.last_name,
    //             email: dataObj.email,
    //             phone_number: dataObj.phone_number,
    //             whatsapp_number: dataObj.whatsapp_number,
    //             state: dataObj.state,
    //             contry: dataObj.contry,
    //             city: dataObj.city,
    //             address: dataObj.address,
    //             zipcode: dataObj.zipcode,
    //         };
    //         // Update profile only when a new image is uploaded
    //         if (req.files?.profile?.length > 0) {
    //             const file = req.files.profile[0];
    //             userData.profile = `uploads/upload/${file.filename}`;
    //         }

    //         const updateUserQuery = `
    //             UPDATE users
    //             SET ?
    //             WHERE user_id = '${dataObj.user_id}'
    //             AND user_type = 'PARTNER'
    //             AND is_deleted = 0
    //         `;

    //         await insertData(
    //             updateUserQuery,
    //             userData,
    //             next
    //         );
    //         /* ------------------ Check Financial Details ------------------ */
    //         const checkFinancialQuery = `
    //             SELECT partner_financial_id
    //             FROM partner_financial_details
    //             WHERE user_id = '${dataObj.user_id}'
    //             AND is_deleted = 0
    //         `;
    //         const checkFinancial = await getData(
    //             checkFinancialQuery,
    //             next
    //         );
    //         /* ------------------ Financial Data ------------------ */
    //         const financialData = {
    //             business_type: dataObj.business_type,
    //             gst_compliant: dataObj.gst_compliant,
    //             gst_number: dataObj.gst_number
    //         };
    //         /* ------------------ Update / Create Financial Details ------------------ */
    //         if (checkFinancial.length > 0) {
    //             /* -------- Update Existing Financial Details -------- */
    //             const updateFinancialQuery = `
    //                 UPDATE partner_financial_details
    //                 SET ?
    //                 WHERE user_id = '${dataObj.user_id}'
    //                 AND is_deleted = 0
    //             `;
    //             await insertData(
    //                 updateFinancialQuery,
    //                 financialData,
    //                 next
    //             );
    //         } else {
    //             /* -------- Create New Financial Details -------- */
    //             financialData.user_id = dataObj.user_id;
    //             const insertFinancialQuery = `
    //                     INSERT INTO partner_financial_details
    //                     SET ?
    //                 `;
    //             await insertData(
    //                 insertFinancialQuery,
    //                 financialData,
    //                 next
    //             );
    //         }
    //         /* ------------------ Get Updated Partner ------------------ */
    //         const updatedPartnerQuery = `
    //                 SELECT
    //                     u.*,
    //                     p.partner_financial_id,
    //                     p.business_type,
    //                     p.pan_number,
    //                     p.gst_number,
    //                     p.cin_number,
    //                     p.gst_compliant,
    //                     p.aadharcard_copy,
    //                     p.pancard_copy,
    //                     p.cmr_copy,
    //                     p.cancelled_cheque,
    //                     p.franchise_agreement,
    //                     p.stamp_signature,
    //                     p.is_deleted AS financial_is_deleted,
    //                     p.franchise_upload_date,
    //                     p.created_at AS financial_created_at,
    //                     p.updated_on AS financial_updated_on
    //                 FROM users u
    //                 LEFT JOIN partner_financial_details p
    //                     ON p.user_id = u.user_id
    //                     AND p.is_deleted = 0
    //                 WHERE u.user_id = '${dataObj.user_id}'
    //                 AND u.user_type = 'PARTNER'
    //                 AND u.is_deleted = 0
    //             `;
    //         const updatedPartner = await getData(
    //             updatedPartnerQuery,
    //             next
    //         );
    //         /* ------------------ Response ------------------ */
    //         return res.json({
    //             success: true,
    //             message: "Partner profile updated successfully",
    //             data: updatedPartner
    //         });
    //     } catch (error) {
    //         next(error);
    //     }
    // },
    async PartnerProfileCreateUpdate(req, res, next) {
        try {

            /* =========================================================
               PREPARE DATA
            ========================================================= */

            let dataObj = { ...req.body };


            /* =========================================================
               BASIC VALIDATION
            ========================================================= */

            const basicSchema = Joi.object({
                user_id: Joi.number().integer().required()
            });

            const { error: basicError } = basicSchema.validate({
                user_id: dataObj.user_id
            });

            if (basicError) {
                return next(basicError);
            }


            /* =========================================================
               CHECK PARTNER EXISTS
            ========================================================= */

            const checkPartnerQuery = `
            SELECT *
            FROM users
            WHERE user_id = '${dataObj.user_id}'
            AND user_type = 'PARTNER'
            AND is_deleted = 0
        `;

            const checkPartner = await getData(
                checkPartnerQuery,
                next
            );

            if (!checkPartner.length) {
                return next(
                    CustomErrorHandler.notFound("Partner not found")
                );
            }


            /* =========================================================
               CHECK REQUEST TYPE
            ========================================================= */

            const hasProfileData =
                dataObj.first_name !== undefined ||
                dataObj.last_name !== undefined ||
                dataObj.email !== undefined ||
                dataObj.phone_number !== undefined ||
                dataObj.business_type !== undefined;

            const hasKycFiles =
                req.files?.aadharCard?.length > 0 ||
                req.files?.panCard?.length > 0 ||
                req.files?.cmr?.length > 0 ||
                req.files?.sealSignature?.length > 0;


            /* =========================================================
               PROFILE + BUSINESS DETAILS
            ========================================================= */

            if (hasProfileData) {

                /* ------------------ Validation ------------------ */

                const partnerSchema = Joi.object({

                    user_id: Joi.number().integer().required(),

                    first_name: Joi.string().required(),
                    middle_name: Joi.string().allow(""),
                    last_name: Joi.string().required(),

                    email: Joi.string().email().required(),
                    phone_number: Joi.string().required(),
                    whatsapp_number: Joi.string().required(),

                    state: Joi.string().required(),
                    contry: Joi.string().required(),
                    city: Joi.string().required(),
                    address: Joi.string().required(),
                    zipcode: Joi.string().required(),

                    profile: Joi.string().allow("").optional(),

                    business_type: Joi.string().required(),
                    gst_compliant: Joi.string().allow(""),
                    gst_number: Joi.string().allow("")

                });


                const { error } = partnerSchema.validate(
                    dataObj,
                    {
                        abortEarly: false,
                        allowUnknown: false
                    }
                );

                if (error) {
                    console.log("JOI ERROR:", error.details);
                    return next(error);
                }


                /* =====================================================
                   DUPLICATE EMAIL / PHONE CHECK
                ===================================================== */

                const duplicateQuery = `
                SELECT user_id
                FROM users
                WHERE (
                    email = '${dataObj.email}'
                    OR phone_number = '${dataObj.phone_number}'
                )
                AND user_type = 'PARTNER'
                AND user_id != '${dataObj.user_id}'
                AND is_deleted = 0
            `;

                const duplicateUser = await getData(
                    duplicateQuery,
                    next
                );

                if (duplicateUser.length > 0) {
                    return next(
                        CustomErrorHandler.alreadyExist(
                            "Email or phone number already exists"
                        )
                    );
                }


                /* =====================================================
                   UPDATE USERS TABLE
                ===================================================== */

                const userData = {

                    first_name: dataObj.first_name,
                    middle_name: dataObj.middle_name,
                    last_name: dataObj.last_name,

                    email: dataObj.email,
                    phone_number: dataObj.phone_number,
                    whatsapp_number: dataObj.whatsapp_number,

                    state: dataObj.state,
                    contry: dataObj.contry,
                    city: dataObj.city,
                    address: dataObj.address,
                    zipcode: dataObj.zipcode

                };


                /* ------------------ Profile Image ------------------ */

                if (req.files?.profile?.length > 0) {

                    const file = req.files.profile[0];

                    userData.profile = file.path;
                }


                const updateUserQuery = `
                UPDATE users
                SET ?
                WHERE user_id = '${dataObj.user_id}'
                AND user_type = 'PARTNER'
                AND is_deleted = 0
            `;

                await insertData(
                    updateUserQuery,
                    userData,
                    next
                );


                /* =====================================================
                   CHECK FINANCIAL DETAILS
                ===================================================== */

                const checkFinancialQuery = `
                SELECT partner_financial_id
                FROM partner_financial_details
                WHERE user_id = '${dataObj.user_id}'
                AND is_deleted = 0
            `;

                const checkFinancial = await getData(
                    checkFinancialQuery,
                    next
                );


                /* =====================================================
                   FINANCIAL DATA
                ===================================================== */

                const financialData = {

                    business_type: dataObj.business_type,
                    gst_compliant: dataObj.gst_compliant,
                    gst_number: dataObj.gst_number

                };


                /* =====================================================
                   KYC FILES IF SENT WITH PROFILE
                ===================================================== */

                /* ------------------ Aadhar ------------------ */

                if (req.files?.aadharCard?.length > 0) {

                    const file = req.files.aadharCard[0];

                    financialData.aadharcard_copy = file.path;

                    financialData.aadhar_status = "Pending";
                }


                /* ------------------ Aadhar Number ------------------ */

                if (dataObj.aadharNumber !== undefined) {

                    financialData.aadhar_number =
                        dataObj.aadharNumber;
                }


                /* ------------------ PAN ------------------ */

                if (req.files?.panCard?.length > 0) {

                    const file = req.files.panCard[0];

                    financialData.pancard_copy = file.path;

                    financialData.pan_status = "Pending";
                }


                /* ------------------ PAN Number ------------------ */

                if (dataObj.panNumber !== undefined) {

                    financialData.pan_number =
                        dataObj.panNumber;
                }


                /* ------------------ CMR ------------------ */

                if (req.files?.cmr?.length > 0) {

                    const file = req.files.cmr[0];

                    financialData.cmr_copy = file.path;

                    financialData.cmr_status = "Pending";
                }


                /* ------------------ Seal / Signature ------------------ */

                if (req.files?.sealSignature?.length > 0) {

                    const file = req.files.sealSignature[0];

                    financialData.stamp_signature = file.path;

                    financialData.stamp_signature_status =
                        "Pending";
                }


                /* =====================================================
                   UPDATE / INSERT FINANCIAL DETAILS
                ===================================================== */

                if (checkFinancial.length > 0) {

                    const updateFinancialQuery = `
                    UPDATE partner_financial_details
                    SET ?
                    WHERE user_id = '${dataObj.user_id}'
                    AND is_deleted = 0
                `;

                    await insertData(
                        updateFinancialQuery,
                        financialData,
                        next
                    );

                } else {

                    financialData.user_id =
                        dataObj.user_id;

                    const insertFinancialQuery = `
                    INSERT INTO partner_financial_details
                    SET ?
                `;

                    await insertData(
                        insertFinancialQuery,
                        financialData,
                        next
                    );
                }

            }


            /* =========================================================
               KYC ONLY
            ========================================================= */

            else if (hasKycFiles) {

                /* =====================================================
                   CHECK FINANCIAL DETAILS
                ===================================================== */

                const checkFinancialQuery = `
                SELECT partner_financial_id
                FROM partner_financial_details
                WHERE user_id = '${dataObj.user_id}'
                AND is_deleted = 0
            `;

                const checkFinancial = await getData(
                    checkFinancialQuery,
                    next
                );


                /* =====================================================
                   KYC DATA
                ===================================================== */

                const kycData = {};


                /* ------------------ Aadhar Card ------------------ */

                if (req.files?.aadharCard?.length > 0) {

                    const file = req.files.aadharCard[0];

                    kycData.aadharcard_copy = file.path;

                    kycData.aadhar_status = "Pending";
                }


                /* ------------------ Aadhar Number ------------------ */

                if (dataObj.aadharNumber !== undefined) {

                    kycData.aadhar_number =
                        dataObj.aadharNumber;
                }


                /* ------------------ PAN Card ------------------ */

                if (req.files?.panCard?.length > 0) {

                    const file = req.files.panCard[0];

                    kycData.pancard_copy = file.path;

                    kycData.pan_status = "Pending";
                }


                /* ------------------ PAN Number ------------------ */

                if (dataObj.panNumber !== undefined) {

                    kycData.pan_number =
                        dataObj.panNumber;
                }


                /* ------------------ CMR ------------------ */

                if (req.files?.cmr?.length > 0) {

                    const file = req.files.cmr[0];

                    kycData.cmr_copy = file.path;

                    kycData.cmr_status = "Pending";
                }


                /* ------------------ Seal / Signature ------------------ */

                if (req.files?.sealSignature?.length > 0) {

                    const file = req.files.sealSignature[0];

                    kycData.stamp_signature = file.path;

                    kycData.stamp_signature_status =
                        "Pending";
                }


                /* =====================================================
                   UPDATE / INSERT KYC
                ===================================================== */

                if (checkFinancial.length > 0) {

                    const updateFinancialQuery = `
                    UPDATE partner_financial_details
                    SET ?
                    WHERE user_id = '${dataObj.user_id}'
                    AND is_deleted = 0
                `;

                    await insertData(
                        updateFinancialQuery,
                        kycData,
                        next
                    );

                } else {

                    kycData.user_id =
                        dataObj.user_id;

                    const insertFinancialQuery = `
                    INSERT INTO partner_financial_details
                    SET ?
                `;

                    await insertData(
                        insertFinancialQuery,
                        kycData,
                        next
                    );
                }

            }


            /* =========================================================
               GET UPDATED PARTNER
            ========================================================= */

            const updatedPartnerQuery = `
            SELECT

                u.*,

                p.partner_financial_id,
                p.business_type,

                p.aadhar_number,
                p.pan_number,
                p.gst_number,
                p.cin_number,

                p.gst_compliant,

                p.aadharcard_copy,
                p.pancard_copy,
                p.cmr_copy,
                p.stamp_signature,

                p.aadhar_status,
                p.pan_status,
                p.cmr_status,
                p.stamp_signature_status,

                p.franchise_agreement,

                p.is_deleted AS financial_is_deleted,

                p.franchise_upload_date,

                p.created_at AS financial_created_at,
                p.updated_on AS financial_updated_on

            FROM users u

            LEFT JOIN partner_financial_details p
                ON p.user_id = u.user_id
                AND p.is_deleted = 0

            WHERE u.user_id = '${dataObj.user_id}'
            AND u.user_type = 'PARTNER'
            AND u.is_deleted = 0
        `;

            const updatedPartner = await getData(
                updatedPartnerQuery,
                next
            );


            /* =========================================================
               RESPONSE
            ========================================================= */

            return res.json({

                success: true,

                message: "Partner profile updated successfully",

                data: updatedPartner

            });

        } catch (error) {

            next(error);

        }
    },
    async createPartnerAdmin(req, res, next) {
        try {
            // ------------------ Validation ------------------
            const schema = Joi.object({
                user_id: Joi.number().integer().optional(),

                username: Joi.string().when('user_id', {
                    is: Joi.exist(),
                    then: Joi.optional(),
                    otherwise: Joi.required()
                }),

                first_name: Joi.string().required(),
                middle_name: Joi.string().allow("").optional(),
                last_name: Joi.string().required(),

                email: Joi.string().email().required(),
                phone_number: Joi.string().required(),
                whatsapp_number: Joi.string().allow("").optional(),

                address: Joi.string().required(),
                zipcode: Joi.string().required(),
                city: Joi.string().required(),
                state: Joi.string().required(),
                contry: Joi.string().required(),

                business_type: Joi.string().required(),
                gst_compliant: Joi.string().allow("").optional(),
                gst_number: Joi.string().allow("").optional(),

                profile: Joi.string().allow("").optional(),
            });

            const dataObj = { ...req.body };

            const { error } = schema.validate(dataObj, { abortEarly: false, allowUnknown: false });
            if (error) return next(error);

            const isUpdate = !!dataObj.user_id;
            const condition = isUpdate ? ` AND user_id != '${dataObj.user_id}'` : "";

            // ------------------ Update: partner must exist ------------------
            if (isUpdate) {
                const exist = await getData(
                    `SELECT user_id FROM users
                 WHERE user_id='${dataObj.user_id}' AND user_type='PARTNER' AND is_deleted=0`,
                    next
                );
                if (!exist.length) {
                    return next(CustomErrorHandler.notFound("Partner not found"));
                }
            }

            // ------------------ Duplicate Email / Phone / WhatsApp ------------------
            const hasWhatsapp = !!dataObj.whatsapp_number?.trim();

            const duplicateData = await getData(`
            SELECT user_id, email, phone_number, whatsapp_number, is_deleted, is_verified
            FROM users
            WHERE user_type='PARTNER'
            ${condition}
            AND (
                email='${dataObj.email}'
                OR phone_number='${dataObj.phone_number}'
                OR whatsapp_number='${dataObj.phone_number}'
                ${hasWhatsapp ? `
                    OR phone_number='${dataObj.whatsapp_number}'
                    OR whatsapp_number='${dataObj.whatsapp_number}'` : ""}
            )
        `, next);

            const verifiedDuplicate = duplicateData.find(
                (row) => row.is_deleted == '0' && row.is_verified == 1
            );

            if (verifiedDuplicate) {
                const emailExists = verifiedDuplicate.email == dataObj.email;
                const phoneExists =
                    verifiedDuplicate.phone_number == dataObj.phone_number ||
                    verifiedDuplicate.whatsapp_number == dataObj.phone_number;
                const whatsappExists = hasWhatsapp
                    ? (verifiedDuplicate.phone_number == dataObj.whatsapp_number ||
                        verifiedDuplicate.whatsapp_number == dataObj.whatsapp_number)
                    : false;

                const found = [];
                if (emailExists) found.push("Email");
                if (phoneExists) found.push("Phone number");
                if (whatsappExists) found.push("WhatsApp number");

                if (found.length) {
                    return next(
                        CustomErrorHandler.alreadyExist(
                            `${found.join(" and ")} already ${found.length > 1 ? "exist" : "exists"}`
                        )
                    );
                }
            }

            // ------------------ Duplicate Username (create only if sent) ------------------
            if (dataObj.username) {
                const usernameCheck = await getData(
                    `SELECT user_id, is_deleted, is_verified FROM users
                 WHERE username='${dataObj.username}' ${condition}`,
                    next
                );
                const verifiedUsernameDuplicate = usernameCheck.find(
                    (row) => row.is_deleted == '0' && row.is_verified == 1
                );
                if (verifiedUsernameDuplicate) {
                    return next(
                        CustomErrorHandler.alreadyExist(`${dataObj.username} Username already exists`)
                    );
                }
            }

            // ------------------ Split data: users table / financial table ------------------
            const userData = {
                first_name: dataObj.first_name,
                middle_name: dataObj.middle_name ?? "",
                last_name: dataObj.last_name,
                email: dataObj.email,
                phone_number: dataObj.phone_number,
                whatsapp_number: dataObj.whatsapp_number ?? "",
                address: dataObj.address,
                zipcode: dataObj.zipcode,
                city: dataObj.city,
                state: dataObj.state,
                contry: dataObj.contry,
            };

            if (req.files?.profile?.length > 0) {
                userData.profile = req.files.profile[0].path;
            }

            const isIndividual = dataObj.business_type === "Individual";
            const gstCompliant = ["Yes", "No"].includes(dataObj.gst_compliant) ? dataObj.gst_compliant : null;

            const financialData = {
                business_type: dataObj.business_type,
                // never send '' to an ENUM column
                gst_compliant: isIndividual ? null : gstCompliant,
                gst_number: (!isIndividual && gstCompliant === "Yes") ? (dataObj.gst_number ?? "") : ""
            };

            // ------------------ Insert / Update users ------------------
            let partnerId;

            if (isUpdate) {
                await insertData(
                    `UPDATE users SET ? WHERE user_id='${dataObj.user_id}' AND user_type='PARTNER' AND is_deleted=0`,
                    userData,
                    next
                );
                partnerId = dataObj.user_id;
            } else {
                userData.username = dataObj.username;
                userData.user_type = 'PARTNER';
                userData.password = md5(String(dataObj.phone_number).trim()); // password = mobile number
                userData.is_deleted = 0;
                userData.is_verified = 1; // admin-created -> no OTP

                // Re-use a soft-deleted OR unverified (abandoned self-signup) partner row
                const reusable = duplicateData.find(
                    (row) => row.is_deleted != '0' || row.is_verified == 0
                );

                if (reusable) {
                    await insertData(
                        `UPDATE users SET ? WHERE user_id='${reusable.user_id}'`,
                        userData,
                        next
                    );
                    partnerId = reusable.user_id;
                } else {
                    const result = await insertData(`INSERT INTO users SET ?`, userData, next);
                    partnerId = result.insertId;
                }
            }

            // ------------------ Upsert partner_financial_details ------------------
            const checkFinancial = await getData(
                `SELECT partner_financial_id FROM partner_financial_details
             WHERE user_id='${partnerId}' AND is_deleted=0`,
                next
            );

            if (checkFinancial.length > 0) {
                await insertData(
                    `UPDATE partner_financial_details SET ? WHERE user_id='${partnerId}' AND is_deleted=0`,
                    financialData,
                    next
                );
            } else {
                financialData.user_id = partnerId;
                await insertData(`INSERT INTO partner_financial_details SET ?`, financialData, next);
            }

            // ------------------ Response ------------------
            const partner = await getData(`
                SELECT u.user_id, u.username, u.first_name, u.middle_name, u.last_name,
                    u.email, u.phone_number, u.whatsapp_number, u.address, u.zipcode,
                    u.city, u.state, u.contry, u.profile,
                    p.partner_financial_id, p.business_type, p.gst_compliant, p.gst_number
                FROM users u
                LEFT JOIN partner_financial_details p
                    ON p.user_id = u.user_id AND p.is_deleted = 0
                WHERE u.user_id='${partnerId}' AND u.user_type='PARTNER'
            `, next);

            return res.json({
                success: true,
                message: isUpdate ? "Partner updated successfully" : "Partner created successfully",
                data: partner[0] || { user_id: partnerId }
            });

        } catch (error) {
            next(error);
        }
    },
    async updatePartnerKycStatus(req, res, next) {
        try {
            const { user_id, document_type, status } = req.body;
            const basicSchema = Joi.object({
                user_id: Joi.number().integer().required(),

                document_type: Joi.string()
                    .valid(
                        "aadhar",
                        "pan",
                        "cmr",
                        "stamp_signature"
                    )
                    .required(),

                status: Joi.string()
                    .valid(
                        "Pending",
                        "Verified",
                        "Rejected"
                    )
                    .required(),
            });


            const { error } = basicSchema.validate(req.body, {
                abortEarly: false,
                allowUnknown: false,
            });

            if (error) {
                return next(error);
            }
            const checkPartnerQuery = `
            SELECT user_id
            FROM users
            WHERE user_id = '${user_id}'
            AND user_type = 'PARTNER'
            AND is_deleted = 0
        `;

            const partner = await getData(
                checkPartnerQuery,
                next
            );

            if (!partner.length) {
                return next(
                    CustomErrorHandler.notFound(
                        "Partner not found"
                    )
                );
            }

            const statusFieldMap = {
                aadhar: "aadhar_status",
                pan: "pan_status",
                cmr: "cmr_status",
                stamp_signature: "stamp_signature_status",
            };

            const statusField =
                statusFieldMap[document_type];

            const checkFinancialQuery = `
            SELECT partner_financial_id
            FROM partner_financial_details
            WHERE user_id = '${user_id}'
            AND is_deleted = 0
        `;

            const financialDetails = await getData(
                checkFinancialQuery,
                next
            );

            if (!financialDetails.length) {
                return next(
                    CustomErrorHandler.notFound(
                        "Partner KYC details not found"
                    )
                );
            }

            const updateKycQuery = `
            UPDATE partner_financial_details
            SET ${statusField} = ?
            WHERE user_id = '${user_id}'
            AND is_deleted = 0
        `;

            await insertData(
                updateKycQuery,
                [status],
                next
            );

            return res.json({
                success: true,

                message:
                    `${document_type} document status updated successfully`,

                data: {
                    user_id,
                    document_type,
                    status,
                },
            });


        } catch (error) {

            next(error);

        }
    },
    async getPartnersFinancialInfo(req, res, next) {
        try {
            /* ------------------ Validation ------------------ */
            const financialSchema = Joi.object({
                partner_financial_id: Joi.number().integer(),
                user_id: Joi.number().integer(),
                business_type: Joi.string(),
                business_name: Joi.string(),
                contact_phone: Joi.string(),
                pan_number: Joi.string(),
                gst_number: Joi.string(),
                cin_number: Joi.string(),
                company_website: Joi.string(),
                gst_compliant: Joi.string(),
                city: Joi.string(),
                state: Joi.string(),
                country: Joi.string(),
                postcode: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });
            const { error } = financialSchema.validate(req.query);
            if (error) {
                return next(error);
            }
            /* ------------------ Base Query ------------------ */
            let query = `
                    SELECT 
                        pfd.*,

                        pbi.partner_bank_id,
                        pbi.bank_account_name,
                        pbi.bank_account_number,
                        pbi.account_type,
                        pbi.bank_name,
                        pbi.neft_code,
                        pbi.swift_code,
                        pbi.micr_code,
                        pbi.bank_branch_address

                    FROM partner_financial_details pfd

                    LEFT JOIN partner_bank_information pbi
                        ON pbi.user_id = pfd.user_id

                    WHERE pfd.is_deleted = 0
                `;
            let cond = '';
            let page = { pageQuery: '' };
            /* ------------------ Filters ------------------ */
            if (req.query.partner_financial_id) {
                cond += ` AND partner_financial_id = '${req.query.partner_financial_id}'`;
            }
            if (req.query.user_id) {
                cond += ` AND pfd.user_id = '${req.query.user_id}'`;
            }
            if (req.query.business_type) {
                cond += ` AND business_type LIKE '%${req.query.business_type}%'`;
            }
            if (req.query.business_name) {
                cond += ` AND business_name LIKE '%${req.query.business_name}%'`;
            }
            if (req.query.contact_phone) {
                cond += ` AND contact_phone LIKE '%${req.query.contact_phone}%'`;
            }
            if (req.query.pan_number) {
                cond += ` AND pan_number LIKE '%${req.query.pan_number}%'`;
            }
            if (req.query.gst_number) {
                cond += ` AND gst_number LIKE '%${req.query.gst_number}%'`;
            }
            if (req.query.cin_number) {
                cond += ` AND cin_number LIKE '%${req.query.cin_number}%'`;
            }
            if (req.query.company_website) {
                cond += ` AND company_website LIKE '%${req.query.company_website}%'`;
            }
            if (req.query.gst_compliant) {
                cond += ` AND gst_compliant = '${req.query.gst_compliant}'`;
            }
            if (req.query.city) {
                cond += ` AND city LIKE '%${req.query.city}%'`;
            }
            if (req.query.state) {
                cond += ` AND state LIKE '%${req.query.state}%'`;
            }
            if (req.query.country) {
                cond += ` AND country LIKE '%${req.query.country}%'`;
            }
            if (req.query.postcode) {
                cond += ` AND postcode LIKE '%${req.query.postcode}%'`;
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
            /* ------------------ Get Data ------------------ */
            const financialInfo = await getData(query, next);
            financialInfo.forEach((item) => {
                item.bankinfo = {
                    partner_bank_id: item.partner_bank_id || "",
                    bank_account_name: item.bank_account_name || "",
                    bank_account_number: item.bank_account_number || "",
                    account_type: item.account_type || "",
                    bank_name: item.bank_name || "",
                    neft_code: item.neft_code || "",
                    swift_code: item.swift_code || "",
                    micr_code: item.micr_code || "",
                    bank_branch_address: item.bank_branch_address || ""
                };
            });
            /* ------------------ Response ------------------ */
            return res.json({
                success: true,
                message: "Partner financial info fetched successfully",
                total_records: page.total_rec ?? financialInfo.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: financialInfo.length,
                data: financialInfo
            });

        } catch (error) {

            next(error);

        }

    },
    async updatePartnerFinancialInformation(req, res, next) {
        try {
            /* ------------------ Validation Schema ------------------ */
            const financialSchema = Joi.object({
                partner_financial_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().required(),
                type: Joi.string()
                    .valid("financial", "address")
                    .required(),
                business_type: Joi.when("type", {
                    is: "financial",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),
                business_name: Joi.when("type", {
                    is: "financial",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),

                contact_phone: Joi.when("type", {
                    is: "financial",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),
                pan_number: Joi.when("type", {
                    is: "financial",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),
                gst_number: Joi.string().allow('').optional(),
                cin_number: Joi.string().allow('').optional(),
                company_website: Joi.string().allow('').optional(),
                franchise_upload_date: Joi.string().allow('').optional(),
                gst_compliant: Joi.string()
                    .valid('Yes', 'No')
                    .allow('')
                    .optional(),

                company_logo: Joi.string().allow('').optional(),
                aadharcard_copy: Joi.string().allow('').optional(),
                pancard_copy: Joi.string().allow('').optional(),
                cmr_copy: Joi.string().allow('').optional(),
                cancelled_cheque: Joi.string().allow('').optional(),
                franchise_agreement: Joi.string().allow('').optional(),
                stamp_signature: Joi.string().allow('').optional(),

                /* ------------------ Address ------------------ */
                address_line_1: Joi.when("type", {
                    is: "address",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),

                address_line_2: Joi.string().allow('').optional(),
                city: Joi.when("type", {
                    is: "address",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),

                state: Joi.when("type", {
                    is: "address",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),
                country: Joi.when("type", {
                    is: "address",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                }),

                postcode: Joi.when("type", {
                    is: "address",
                    then: Joi.string().required(),
                    otherwise: Joi.string().allow("").optional()
                })
            });

            /* ------------------ Prepare Data ------------------ */
            let dataObj = { ...req.body };


            if (!["financial", "address"].includes(dataObj.type)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid type. Allowed values: financial, address"
                });
            }

            /* ------------------ Handle File Upload ------------------ */

            if (req.files?.company_logo?.length > 0) {
                const file = req.files.company_logo[0];
                dataObj.company_logo = file.path;
            }

            if (req.files?.aadharcard_copy?.length > 0) {
                const file = req.files.aadharcard_copy[0];
                dataObj.aadharcard_copy = file.path;
            }

            if (req.files?.pancard_copy?.length > 0) {
                const file = req.files.pancard_copy[0];
                dataObj.pancard_copy = file.path;
            }

            if (req.files?.cmr_copy?.length > 0) {
                const file = req.files.cmr_copy[0];
                dataObj.cmr_copy = file.path;
            }

            if (req.files?.cancelled_cheque?.length > 0) {
                const file = req.files.cancelled_cheque[0];
                dataObj.cancelled_cheque = file.path;
            }

            if (req.files?.franchise_agreement?.length > 0) {
                const file = req.files.franchise_agreement[0];
                dataObj.franchise_agreement = file.path;
            }

            if (req.files?.stamp_signature?.length > 0) {
                const file = req.files.stamp_signature[0];
                dataObj.stamp_signature = file.path;
            }

            console.log(JSON.stringify(dataObj, null, 4));

            /* ------------------ Validate ------------------ */
            const { error } = financialSchema.validate(dataObj);

            if (error) {
                return next(error);
            }
            delete dataObj.type;
            /* ------------------ Check Existing ------------------ */
            const checkQuery = `
                SELECT partner_financial_id
                FROM partner_financial_details
                WHERE user_id = ${dataObj.user_id}
                AND is_deleted = 0
            `;

            const exists = await getData(checkQuery, next);

            /* ------------------ Insert / Update ------------------ */

            let query = '';

            if (exists.length > 0) {

                dataObj.updated_on = new Date();

                query = `
                    UPDATE partner_financial_details 
                    SET ? 
                    WHERE user_id = ${dataObj.user_id}
                `;

                dataObj.partner_financial_id = exists[0].partner_financial_id;

            } else {

                dataObj.created_at = new Date();

                query = `INSERT INTO partner_financial_details SET ?`;

            }

            const result = await insertData(query, dataObj, next);

            if (result.insertId) {
                dataObj.partner_financial_id = result.insertId;
            }

            /* ------------------ Get Latest Data ------------------ */

            const getQuery = `
                SELECT 
                    pfd.*,

                    pbi.partner_bank_id,
                    pbi.bank_account_name,
                    pbi.bank_account_number,
                    pbi.account_type,
                    pbi.bank_name,
                    pbi.neft_code,
                    pbi.swift_code,
                    pbi.micr_code,
                    pbi.bank_branch_address

                FROM partner_financial_details pfd

                LEFT JOIN partner_bank_information pbi
                    ON pbi.user_id = pfd.user_id

                WHERE pfd.partner_financial_id = ${dataObj.partner_financial_id}
            `;

            const latestData = await getData(getQuery, next);
            latestData.forEach((item) => {
                item.bankinfo = {

                    partner_bank_id: item.partner_bank_id || "",
                    bank_account_name: item.bank_account_name || "",
                    bank_account_number: item.bank_account_number || "",
                    account_type: item.account_type || "",
                    bank_name: item.bank_name || "",
                    neft_code: item.neft_code || "",
                    swift_code: item.swift_code || "",
                    micr_code: item.micr_code || "",
                    bank_branch_address: item.bank_branch_address || ""
                };
            });
            return res.json({
                success: true,
                message: exists.length > 0
                    ? 'Partner financial information updated successfully'
                    : 'Partner financial information added successfully',
                data: latestData,
            });

        } catch (error) {

            next(error);

        }
    },
    async updateFranchiseAgreement(req, res, next) {
        try {
            const schema = Joi.object({
                user_id: Joi.number().integer().required(),
                franchise_upload_date: Joi.string().allow("").optional(),
                franchise_agreement: Joi.string()
                    .allow("")
                    .optional(),
                franchise_status: Joi.string().valid("Pending", "Verified", "Rejected").required()
            });

            const dataObj = { ...req.body };

            if (req.files?.franchise_agreement?.length > 0) {
                const file = req.files.franchise_agreement[0];
                dataObj.franchise_agreement = file.path;
            }

            const { error } = schema.validate(dataObj);
            if (error) {
                return next(error);
            }

            const checkQuery = `SELECT partner_financial_id, franchise_agreement FROM partner_financial_details WHERE user_id = ${dataObj.user_id} AND is_deleted = 0`;

            const existingData = await getData(checkQuery, next);

            if (!existingData.length) {
                return res.status(404).json({
                    success: false,
                    message: "Partner financial information not found"
                });
            }

            const updateData = {
                franchise_upload_date: dataObj.franchise_upload_date || null,
                franchise_status: dataObj.franchise_status,
                updated_on: new Date()
            };

            if (dataObj.franchise_agreement) {
                updateData.franchise_agreement = dataObj.franchise_agreement;
            }

            const updateQuery = `UPDATE partner_financial_details SET ? WHERE user_id = ${dataObj.user_id} AND is_deleted = 0`;

            await insertData(updateQuery, updateData, next);

            const getQuery = `SELECT partner_financial_id, user_id, franchise_agreement, franchise_upload_date, franchise_status, updated_on FROM partner_financial_details WHERE user_id = ${dataObj.user_id} AND is_deleted = 0`;

            const latestData = await getData(getQuery, next);

            return res.json({
                success: true,
                message: "Franchise Agreement updated successfully",
                data: latestData
            });
        } catch (error) {
            next(error);
        }
    },
    async updatePartnerBankInformation(req, res, next) {
        try {

            /* ------------------ Validation ------------------ */

            const bankSchema = Joi.object({

                partner_bank_id:
                    Joi.number()
                        .integer()
                        .optional(),

                user_id:
                    Joi.number()
                        .integer()
                        .required(),

                bank_account_name:
                    Joi.string()
                        .allow("")
                        .optional(),

                bank_account_number:
                    Joi.string()
                        .allow("")
                        .optional(),

                account_type:
                    Joi.string()
                        .allow("")
                        .optional(),

                bank_name:
                    Joi.string()
                        .allow("")
                        .optional(),

                neft_code:
                    Joi.string()
                        .allow("")
                        .optional(),

                bank_branch_address:
                    Joi.string()
                        .allow("")
                        .optional(),

                status:
                    Joi.string()
                        .valid("Active", "Inactive")
                        .optional(),

                set_as_default:
                    Joi.string()
                        .valid("Yes", "No")
                        .optional(),

            });


            /* ------------------ Request Data ------------------ */

            let dataObj = {
                ...req.body
            };


            /* ------------------ Validate ------------------ */

            const { error } =
                bankSchema.validate(dataObj);

            if (error) {
                return next(error);
            }


            /* =====================================================
               BANK DOCUMENT
            ===================================================== */

            if (
                req.files?.bank_document &&
                req.files.bank_document.length > 0
            ) {

                const file =
                    req.files.bank_document[0];

                dataObj.bank_document =
                    file.path;

            }


            /* =====================================================
               UPDATE EXISTING BANK
               
               partner_bank_id present
            ===================================================== */

            if (dataObj.partner_bank_id) {

                /* ------------------ Check Bank ------------------ */

                const checkQuery = `
                SELECT partner_bank_id
                FROM partner_bank_information
                WHERE partner_bank_id =
                    ${dataObj.partner_bank_id}
                AND user_id =
                    ${dataObj.user_id}
                LIMIT 1
            `;


                const exists =
                    await getData(
                        checkQuery,
                        next
                    );


                if (exists.length === 0) {

                    return res.status(404).json({

                        success: false,

                        message:
                            "Partner bank information not found."

                    });

                }


                /* ------------------ Update Data ------------------ */

                dataObj.updated_at =
                    new Date();


                /*
                 * These are only used
                 * in WHERE condition.
                 */

                const partnerBankId =
                    dataObj.partner_bank_id;

                const userId =
                    dataObj.user_id;


                delete dataObj.partner_bank_id;

                delete dataObj.user_id;


                /* ------------------ Update ------------------ */

                const updateQuery = `
                UPDATE partner_bank_information

                SET ?

                WHERE partner_bank_id =
                    ${partnerBankId}

                AND user_id =
                    ${userId}
            `;


                await insertData(
                    updateQuery,
                    dataObj,
                    next
                );


                /* =================================================
                   IF THIS BANK IS DEFAULT
                   MAKE OTHER BANKS NON DEFAULT
                ================================================= */

                if (
                    dataObj.set_as_default === "Yes"
                ) {

                    const removeDefaultQuery = `
                    UPDATE partner_bank_information

                    SET set_as_default = 'No'

                    WHERE user_id =
                        ${userId}

                    AND partner_bank_id !=
                        ${partnerBankId}
                `;


                    await insertData(
                        removeDefaultQuery,
                        {},
                        next
                    );

                }


                /* ------------------ Latest Data ------------------ */

                const getQuery = `
                SELECT
                    partner_bank_id,
                    user_id,
                    bank_account_name,
                    bank_account_number,
                    account_type,
                    bank_name,
                    neft_code,
                    bank_branch_address,
                    status,
                    set_as_default,
                    bank_document,
                    created_at,
                    updated_at

                FROM partner_bank_information

                WHERE partner_bank_id =
                    ${partnerBankId}

                AND user_id =
                    ${userId}

                LIMIT 1
            `;


                const latestData =
                    await getData(
                        getQuery,
                        next
                    );


                return res.json({

                    success: true,

                    message:
                        "Partner bank information updated successfully",

                    data:
                        latestData.length > 0
                            ? latestData[0]
                            : {}

                });

            }


            /* =====================================================
               ADD NEW BANK
               
               partner_bank_id NOT present
               => ALWAYS INSERT NEW ROW
            ===================================================== */

            dataObj.created_at =
                new Date();

            dataObj.updated_at =
                new Date();


            const insertQuery = `
            INSERT INTO partner_bank_information
            SET ?
        `;


            const result =
                await insertData(
                    insertQuery,
                    dataObj,
                    next
                );


            const partnerBankId =
                result.insertId;


            /* =====================================================
               IF NEW BANK IS DEFAULT
               MAKE OTHER BANKS NON DEFAULT
            ===================================================== */

            if (
                dataObj.set_as_default === "Yes"
            ) {

                const removeDefaultQuery = `
                UPDATE partner_bank_information

                SET set_as_default = 'No'

                WHERE user_id =
                    ${req.body.user_id}

                AND partner_bank_id !=
                    ${partnerBankId}
            `;


                await insertData(
                    removeDefaultQuery,
                    {},
                    next
                );

            }


            /* ------------------ Latest Data ------------------ */

            const getQuery = `
            SELECT
                partner_bank_id,
                user_id,
                bank_account_name,
                bank_account_number,
                account_type,
                bank_name,
                neft_code,
                bank_branch_address,
                status,
                set_as_default,
                bank_document,
                created_at,
                updated_at

            FROM partner_bank_information

            WHERE partner_bank_id =
                ${partnerBankId}

            AND user_id =
                ${req.body.user_id}

            LIMIT 1
        `;


            const latestData =
                await getData(
                    getQuery,
                    next
                );


            /* ------------------ Response ------------------ */

            return res.json({

                success: true,

                message:
                    "Partner bank information added successfully",

                data:
                    latestData.length > 0
                        ? latestData[0]
                        : {}

            });


        } catch (error) {

            next(error);

        }
    },
    async getPartnerBanks(req, res, next) {
        try {

            /* ------------------ Base Query ------------------ */

            let query = `
            SELECT
                partner_bank_id,
                user_id,
                bank_account_name,
                bank_account_number,
                account_type,
                bank_name,
                neft_code,
                bank_branch_address,
                status,
                set_as_default,
                bank_document,
                created_at,
                updated_at
            FROM partner_bank_information
            WHERE 1 = 1
        `;

            let cond = '';
            let page = { pageQuery: '' };


            /* ------------------ Validation Schema ------------------ */

            const bankSchema = Joi.object({
                partner_bank_id: Joi.number().integer(),
                user_id: Joi.number().integer(),
                bank_account_name: Joi.string(),
                bank_account_number: Joi.string(),
                bank_name: Joi.string(),
                status: Joi.string().valid("Active", "Inactive"),
                set_as_default: Joi.string().valid("Yes", "No"),
                search: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });


            const { error } = bankSchema.validate(req.query);

            if (error) {
                return next(error);
            }


            /* ------------------ Filters ------------------ */

            if (req.query.partner_bank_id) {
                cond += `
                AND partner_bank_id = ${req.query.partner_bank_id}
            `;
            }

            if (req.query.user_id) {
                cond += `
                AND user_id = ${req.query.user_id}
            `;
            }

            if (req.query.bank_account_name) {
                cond += `
                AND bank_account_name LIKE '%${req.query.bank_account_name}%'
            `;
            }

            if (req.query.bank_account_number) {
                cond += `
                AND bank_account_number LIKE '%${req.query.bank_account_number}%'
            `;
            }

            if (req.query.bank_name) {
                cond += `
                AND bank_name LIKE '%${req.query.bank_name}%'
            `;
            }

            if (req.query.status) {
                cond += `
                AND status = '${req.query.status}'
            `;
            }

            if (req.query.set_as_default) {
                cond += `
                AND set_as_default = '${req.query.set_as_default}'
            `;
            }


            /* ------------------ Search ------------------ */

            if (req.query.search) {

                const search = req.query.search;

                cond += `
                AND (
                    bank_account_name LIKE '%${search}%'
                    OR bank_account_number LIKE '%${search}%'
                    OR bank_name LIKE '%${search}%'
                    OR neft_code LIKE '%${search}%'
                    OR bank_branch_address LIKE '%${search}%'
                )
            `;
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


            /* ------------------ Fetch Partner Banks ------------------ */

            const partnerBanks = await getData(
                query,
                next
            );


            /* ------------------ Response ------------------ */

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? partnerBanks.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: partnerBanks.length,
                data: partnerBanks
            });


        } catch (error) {

            next(error);

        }
    },
    // async updatePartnerBankInformation(req, res, next) {
    //     // console.log(req.body);
    //     try {
    //         /* ------------------ Validation ------------------ */
    //         const bankSchema = Joi.object({
    //             partner_bank_id: Joi.number().integer().optional(),
    //             type: Joi.string().optional(),
    //             user_id: Joi.number().integer().required(),
    //             bank_account_name: Joi.string().allow('').optional(),
    //             bank_account_number: Joi.string().allow('').optional(),
    //             account_type: Joi.string().allow('').optional(),
    //             bank_name: Joi.string().allow('').optional(),
    //             neft_code: Joi.string().allow('').optional(),
    //             swift_code: Joi.string().allow('').optional(),
    //             micr_code: Joi.string().allow('').optional(),
    //             bank_branch_address: Joi.string().allow('').optional(),
    //         });
    //         let dataObj = { ...req.body };
    //         /* ------------------ Validate ------------------ */
    //         const { error } = bankSchema.validate(dataObj);
    //         if (error) {
    //             return next(error);
    //         }
    //         delete dataObj.type;
    //         /* ------------------ Check Existing ------------------ */
    //         const checkQuery = `
    //             SELECT partner_bank_id
    //             FROM partner_bank_information
    //             WHERE user_id = ${dataObj.user_id}
    //         `;
    //         const exists = await getData(checkQuery, next);
    //         let query = '';
    //         /* ------------------ Update ------------------ */
    //         if (exists.length > 0) {
    //             dataObj.updated_at = new Date();
    //             query = `
    //             UPDATE partner_bank_information
    //             SET ?
    //             WHERE user_id = ${dataObj.user_id}
    //         `;
    //             dataObj.partner_bank_id = exists[0].partner_bank_id;
    //         } else {
    //             /* ------------------ Insert ------------------ */
    //             dataObj.created_at = new Date();
    //             query = `
    //             INSERT INTO partner_bank_information
    //             SET ?
    //         `;
    //         }
    //         const result = await insertData(query, dataObj, next);
    //         if (result.insertId) {
    //             dataObj.partner_bank_id = result.insertId;
    //         }
    //         /* ------------------ Latest Data ------------------ */
    //         const getQuery = `
    //             SELECT 
    //                 pfd.*,

    //                 pbi.partner_bank_id,
    //                 pbi.bank_account_name,
    //                 pbi.bank_account_number,
    //                 pbi.account_type,
    //                 pbi.bank_name,
    //                 pbi.neft_code,
    //                 pbi.swift_code,
    //                 pbi.micr_code,
    //                 pbi.bank_branch_address

    //             FROM partner_financial_details pfd

    //             LEFT JOIN partner_bank_information pbi
    //                 ON pbi.user_id = pfd.user_id

    //             WHERE pfd.user_id = ${dataObj.user_id}
    //         `;
    //         const latestData = await getData(getQuery, next);
    //         latestData.forEach((item) => {
    //             item.bankinfo = {
    //                 partner_bank_id: item.partner_bank_id || "",
    //                 bank_account_name: item.bank_account_name || "",
    //                 bank_account_number: item.bank_account_number || "",
    //                 account_type: item.account_type || "",
    //                 bank_name: item.bank_name || "",
    //                 neft_code: item.neft_code || "",
    //                 swift_code: item.swift_code || "",
    //                 micr_code: item.micr_code || "",
    //                 bank_branch_address: item.bank_branch_address || ""
    //             };
    //         });
    //         return res.json({
    //             success: true,
    //             message: exists.length > 0
    //                 ? 'Partner bank information updated successfully'
    //                 : 'Partner bank information added successfully',
    //             data: latestData
    //         });
    //     } catch (error) {
    //         next(error);
    //     }
    // },
    async updatePartnerProspectInformation(req, res, next) {
        try {
            /* ------------------ Validation ------------------ */
            const prospectSchema = Joi.object({
                partner_prospect_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().required(),
                client_type: Joi.string()
                    .valid('individual', 'firm')
                    .optional(),
                client_firm_name: Joi.string().allow('').optional(),
                gst_number: Joi.string().allow('').optional(),
                email: Joi.string().allow('').optional(),
                phone: Joi.string().allow('').optional(),
                rm_name: Joi.string().allow('').optional(),
                note: Joi.string().allow('').optional(),
                lead_creation_date: Joi.string().allow('').optional(),
                followup_date: Joi.string().allow('').optional(),
                lead_type: Joi.string()
                    .valid('Prospects', 'Converted', 'New Lead')
                    .allow('')
                    .optional(),
                scanned_cmr_copy: Joi.string().allow('').optional(),
                scanned_pancard_copy: Joi.string().allow('').optional(),
                scanned_aadharcard_copy: Joi.string().allow('').optional(),
                cancel_cheque_copy: Joi.string().allow('').optional(),
                fund_transfer_document: Joi.string().allow('').optional(),
                stocks: Joi.any().optional(),
                lead_status: Joi.string()
                    .valid('Prospects', 'Deal Closed', 'Not Interested', 'In discussion')
                    .allow('')
                    .optional(),
            });
            /* ------------------ PREPARE DATA ------------------ */
            let dataObj = { ...req.body };
            /* ------------------ FILES ------------------ */
            if (req.files?.scanned_cmr_copy?.length > 0) {
                dataObj.scanned_cmr_copy =
                    req.files.scanned_cmr_copy[0].path;
            }
            if (req.files?.scanned_aadharcard_copy?.length > 0) {
                dataObj.scanned_aadharcard_copy =
                    req.files.scanned_aadharcard_copy[0].path;
            }
            if (req.files?.scanned_pancard_copy?.length > 0) {
                dataObj.scanned_pancard_copy =
                    req.files.scanned_pancard_copy[0].path;
            }
            if (req.files?.cancel_cheque_copy?.length > 0) {
                dataObj.cancel_cheque_copy =
                    req.files.cancel_cheque_copy[0].path;
            }
            if (req.files?.fund_transfer_document?.length > 0) {
                dataObj.fund_transfer_document =
                    req.files.fund_transfer_document[0].path;
            }
            /* ------------------ STOCKS ------------------ */
            let stocks = [];
            if (dataObj.stocks) {
                try {
                    stocks = JSON.parse(dataObj.stocks);
                } catch (err) {
                    stocks = [];
                }
            }
            /* ------------------ VALIDATE ------------------ */
            const { error } = prospectSchema.validate(dataObj);
            if (error) {
                return next(error);
            }
            /* ------------------ CHECK EXISTING ------------------ */
            const checkQuery = `
                SELECT partner_prospect_id
                FROM partner_prospects
                WHERE partner_prospect_id = '${dataObj.partner_prospect_id || 0}'
                AND is_deleted = 0
            `;
            const exists = await getData(checkQuery, next);
            let query = '';
            /* ------------------ UPDATE ------------------ */
            if (exists.length > 0) {
                dataObj.updated_at = new Date();
                query = `
                    UPDATE partner_prospects
                    SET ?
                    WHERE partner_prospect_id = ${dataObj.partner_prospect_id}
                `;
            } else {
                /* ------------------ INSERT ------------------ */
                dataObj.created_at = new Date();
                query = `INSERT INTO partner_prospects SET ? `;
            }
            /* ------------------ REMOVE STOCKS FIELD ------------------ */
            delete dataObj.stocks;
            /* ------------------ INSERT / UPDATE ------------------ */
            const result = await insertData(query, dataObj, next);
            /* ------------------ GET INSERT ID ------------------ */

            if (result.insertId) {

                dataObj.partner_prospect_id = result.insertId;

            }

            /* ------------------ DELETE OLD STOCKS ------------------ */

            const deleteQuery = `
                DELETE FROM partner_prospect_stocks
                WHERE partner_prospect_id = ${dataObj.partner_prospect_id}
            `;
            await getData(deleteQuery, next);

            /* ------------------ INSERT STOCKS ------------------ */

            if (stocks.length > 0) {
                for (const stock of stocks) {
                    const stockObj = {
                        partner_prospect_id:
                            dataObj.partner_prospect_id,
                        user_id:
                            dataObj.user_id,
                        broker_name:
                            stock.broker_name || "",
                        broker_id:
                            stock.broker_id || null,
                        stock_name:
                            stock.stock || "",
                        stock_id:
                            stock.stock_id || null,
                        quantity:
                            stock.quantity || 0,
                        price:
                            stock.price || 0,
                        buy_sell:
                            stock.buy_sell || "buy",
                        created_at:
                            new Date(),
                    };
                    await insertData(
                        `INSERT INTO partner_prospect_stocks SET ?`,
                        stockObj,
                        next
                    );
                }
            }

            /* ------------------ RESPONSE ------------------ */
            return res.json({

                success: true,
                partner_prospect_id: dataObj.partner_prospect_id,
                message: exists.length > 0
                    ? 'Prospect updated successfully'
                    : 'Prospect added successfully',
            });

        } catch (error) {

            next(error);
        }
    },
    async getPartnerProspects(req, res, next) {
        try {
            /* ---------------- VALIDATION ---------------- */
            const prospectSchema = Joi.object({
                partner_prospect_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().optional(),
                client_type: Joi.string().optional(),
                search: Joi.string().optional(),
                client_firm_name: Joi.string().optional(),
                gst_number: Joi.string().optional(),
                email: Joi.string().optional(),
                phone: Joi.string().optional(),
                rm_name: Joi.string().optional(),
                lead_type: Joi.string().optional(),
                pagination: Joi.boolean().optional(),
                current_page: Joi.number().integer().optional(),
                per_page_records: Joi.number().integer().optional(),
                lead_status: Joi.string().optional(),
            });
            const { error } = prospectSchema.validate(req.query);
            if (error) {
                return next(error);
            }
            /* ---------------- BASE QUERY ---------------- */
            let query = `
                SELECT *
                FROM partner_prospects
                WHERE is_deleted = 0
            `;
            let cond = '';
            let page = { pageQuery: '' };
            /* ---------------- FILTERS ---------------- */
            if (req.query.partner_prospect_id) {
                cond += `
                    AND partner_prospect_id =
                    '${req.query.partner_prospect_id}'
                `;
            }
            if (req.query.user_id) {
                cond += `AND user_id = '${req.query.user_id}'`;
            }
            if (req.query.client_type) {
                cond += `
                AND client_type =
                '${req.query.client_type}'
            `;
            }
            if (req.query.client_firm_name) {
                cond += `
                AND client_firm_name LIKE
                '%${req.query.client_firm_name}%'
            `;
            }
            if (req.query.search) {
                cond += `
                AND client_firm_name LIKE
                '%${req.query.search}%'
            `;
            }
            if (req.query.gst_number) {
                cond += `
                AND gst_number LIKE
                '%${req.query.gst_number}%'
            `;
            }
            if (req.query.email) {
                cond += `
                AND email LIKE
                '%${req.query.email}%'
            `;
            }
            if (req.query.phone) {
                cond += `
                AND phone LIKE
                '%${req.query.phone}%'
            `;
            }
            if (req.query.rm_name) {
                cond += `
                AND rm_name LIKE
                '%${req.query.rm_name}%'
            `;
            }
            if (req.query.lead_type) {
                cond += `AND lead_type ='${req.query.lead_type}'`;
            }
            if (req.query.lead_status) {
                cond += `AND lead_status ='${req.query.lead_status}'`;
            }

            cond += `ORDER BY created_at DESC`;
            /* ---------------- PAGINATION ---------------- */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }
            query += cond + page.pageQuery;
            /* ---------------- GET DATA ---------------- */
            const prospectData = await getData(query, next);
            /* ---------------- RESPONSE ---------------- */
            return res.json({
                success: true,
                message:
                    "Partner prospects fetched successfully",
                total_records:
                    page.total_rec ?? prospectData.length,
                number_of_pages:
                    page.number_of_pages || 1,
                currentPage:
                    page.currentPage || 1,
                records:
                    prospectData.length,
                data:
                    prospectData
            });
        } catch (error) {
            next(error);
        }
    },
    async getPartnerProspectsIndividual(req, res, next) {
        try {
            /* ------------------ Validation ------------------ */
            const schema = Joi.object({
                partner_prospect_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().optional(),
                client_type: Joi.string().optional(),
                pagination: Joi.boolean().optional(),
                current_page: Joi.number().integer().optional(),
                per_page_records: Joi.number().integer().optional(),
            });
            const { error } = schema.validate(req.query);
            if (error) {
                return next(error);
            }
            /* ------------------ Base Query ------------------ */

            let query = `
                SELECT *
                FROM partner_prospects
                WHERE is_deleted = 0
            `;

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Filters ------------------ */

            if (req.query.partner_prospect_id) {
                cond += `
                AND partner_prospect_id =
                ${req.query.partner_prospect_id}
            `;
            }

            if (req.query.user_id) {
                cond += `
                AND user_id =
                ${req.query.user_id}
            `;
            }

            if (req.query.client_type) {
                cond += `
                AND client_type =
                '${req.query.client_type}'
            `;
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

            query += `
                ${cond}
                ORDER BY partner_prospect_id DESC
                ${page.pageQuery}
            `;

            /* ------------------ Get Prospects ------------------ */

            const prospects = await getData(query, next);

            /* ------------------ Get Stocks ------------------ */

            for (const prospect of prospects) {

                const stockQuery = `
                SELECT *
                FROM partner_prospect_stocks
                WHERE partner_prospect_id =
                ${prospect.partner_prospect_id}
            `;

                prospect.stocks = await getData(
                    stockQuery,
                    next
                );

            }

            /* ------------------ Response ------------------ */

            return res.json({
                success: true,
                message: 'success',
                total_records:
                    page.total_rec ?? prospects.length,
                number_of_pages:
                    page.number_of_pages || 1,
                currentPage:
                    page.currentPage || 1,
                records:
                    prospects.length,
                data: prospects
            });

        } catch (err) {

            next(err);
        }
    },
    async createPartnerOrder(req, res, next) {
        try {

            const orderSchema = Joi.object({
                partener_order_id: Joi.number().integer().optional(),
                user_id: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.optional(),
                    otherwise: Joi.required()
                }),

                partner_prospect_id: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.optional(),
                    otherwise: Joi.required()
                }),

                stock_details_id: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.optional(),
                    otherwise: Joi.required()
                }),

                order_id: Joi.number().integer().optional(),
                addedUserId: Joi.number().integer().optional(),

                order_type: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.string().valid('Buy', 'Sell').optional(),
                    otherwise: Joi.string().valid('Buy', 'Sell').required()
                }),

                quantity: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.number().optional(),
                    otherwise: Joi.number().required()
                }),

                price: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.number().optional(),
                    otherwise: Joi.number().required()
                }),

                broker_price: Joi.when('partener_order_id', {
                    is: Joi.exist(),
                    then: Joi.number().optional(),
                    otherwise: Joi.number().required()
                }),

                status: Joi.string()
                    .valid('Pending', 'Approved', 'Rejected', 'Completed')
                    .optional()
            });

            const dataObj = { ...req.body };

            const { error } = orderSchema.validate(dataObj);

            if (error) {
                return next(error);
            }
            let query = "";
            if (dataObj.partener_order_id) {
                query = `UPDATE partner_stock_orders SET ? WHERE partener_order_id = ${dataObj.partener_order_id}`;
                dataObj.updated_at = new Date();
            } else {
                query = `INSERT INTO partner_stock_orders SET ?`;
                dataObj.created_at = new Date();
                dataObj.partnerQty = dataObj.quantity,
                    dataObj.partnerPrice = dataObj.price,
                    dataObj.partnerBrokerPrice = dataObj.broker_price
            }
            const result = await insertData(query, dataObj, next);
            if (result.insertId) {
                dataObj.partener_order_id = result.insertId;
            }

            return res.json({
                success: true,
                message: dataObj.partener_order_id
                    ? "Order updated successfully"
                    : "Order created successfully",
                order_id: dataObj.partener_order_id || result.insertId,
            });

        } catch (error) {
            next(error);
        }
    },
    async getPartnerOrders(req, res, next) {
        try {
            /* ------------------ Validation ------------------ */
            const schema = Joi.object({
                partener_order_id: Joi.number().integer().optional(),
                user_id: Joi.number().integer().optional(),
                partner_prospect_id: Joi.number().integer().optional(),
                rm_id: Joi.number().integer().optional(),
                stock_details_id: Joi.number().integer().optional(),
                status: Joi.string()
                    .valid('Pending', 'Approved', 'Rejected', 'Completed')
                    .optional(),
                client_name: Joi.string().optional(),
                partner_name: Joi.string().optional(),
                order_type: Joi.string().valid('Buy', 'Sell').optional(),
                pagination: Joi.boolean().optional(),
                current_page: Joi.number().integer().optional(),
                per_page_records: Joi.number().integer().optional(),
            });

            const { error } = schema.validate(req.query);

            if (error) {
                return next(error);
            }

            /* ------------------ Base Query ------------------ */

            let query = `
            SELECT
                pso.*,
                DATE_FORMAT(
                        CONVERT_TZ(pso.created_at, '+00:00', '+05:30'),
                        '%d-%m-%Y %h:%i %p'
                    ) AS date,
                pso.created_at,
                pp.client_firm_name,
                pp.phone,
                pp.email,
                sd.company_name,

                CONCAT(
                    COALESCE(u.first_name, ''),
                    CASE 
                        WHEN u.middle_name IS NOT NULL AND u.middle_name != '' 
                        THEN CONCAT(' ', u.middle_name) 
                        ELSE '' 
                    END,
                    CASE 
                        WHEN u.last_name IS NOT NULL AND u.last_name != '' 
                        THEN CONCAT(' ', u.last_name) 
                        ELSE '' 
                    END
                ) AS partnerName,
                u.user_custum_id AS partner_userID,
            cu.user_id AS client_userID,
            cu.first_name AS client_first_name,
            cu.middle_name AS client_middle_name,
            cu.last_name AS client_last_name


            FROM partner_stock_orders pso

            LEFT JOIN partner_prospects pp
                ON pp.partner_prospect_id = pso.partner_prospect_id

            LEFT JOIN stock_details sd
                ON sd.stock_details_id = pso.stock_details_id
            
            LEFT JOIN users u
                ON u.user_id = pso.user_id
            
            LEFT JOIN users cu
                ON cu.phone_number = pp.phone
                AND cu.user_type = 'user'

            WHERE 1 = 1
        `;

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Filters ------------------ */

            if (req.query.partener_order_id) {
                cond += `
                AND pso.partener_order_id =
                ${req.query.partener_order_id}
            `;
            }

            if (req.query.status) {
                cond += `
                    AND pso.status = '${req.query.status}'
                `;
            }

            if (req.query.client_name) {
                cond += `
                    AND pp.client_firm_name LIKE '%${req.query.client_name}%'
                `;
            }

            if (req.query.partner_name) {
                cond += `
                    AND CONCAT(
                        COALESCE(u.first_name, ''),
                        CASE
                            WHEN u.middle_name IS NOT NULL
                            AND u.middle_name != ''
                            THEN CONCAT(' ', u.middle_name)
                            ELSE ''
                        END,
                        CASE
                            WHEN u.last_name IS NOT NULL
                            AND u.last_name != ''
                            THEN CONCAT(' ', u.last_name)
                            ELSE ''
                        END
                    ) LIKE '%${req.query.partner_name}%'
                `;
            }

            if (req.query.user_id) {
                cond += `
                AND pso.user_id =
                ${req.query.user_id}
            `;
            }

            if (req.query.partner_prospect_id) {
                cond += `
                AND pso.partner_prospect_id =
                ${req.query.partner_prospect_id}
            `;
            }

            if (req.query.stock_details_id) {
                cond += `
                AND pso.stock_details_id =
                ${req.query.stock_details_id}
            `;
            }

            if (req.query.order_type) {
                cond += `
                AND pso.order_type =
                '${req.query.order_type}'
            `;
            }

            if (req.query.rm_id) {
                cond += `
                    AND u.assign_to = ${req.query.rm_id}
                `;
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

            query += `
                ${cond}
                ORDER BY pso.updated_at DESC
                ${page.pageQuery}
            `;

            /* ------------------ Get Orders ------------------ */

            const orders = await getData(query, next);

            /* ------------------ Response ------------------ */

            return res.json({
                success: true,
                message: "success",
                total_records: page.total_rec ?? orders.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: orders.length,
                data: orders
            });

        } catch (err) {
            next(err);
        }
    },
    async addPartnerCommission(req, res, next) {
        try {

            const commissionSchema = Joi.object({
                order_id: Joi.number().integer().required(),
                tds: Joi.number().required(),
                gst: Joi.number().required(),
                payment_id: Joi.string().required(),
                payment_doc: Joi.string().allow('').optional(),
                inv_number: Joi.string().optional(),
            });

            let dataObj = { ...req.body };

            /* ------------------ FILE ------------------ */
            if (req.files?.payment_doc?.length > 0) {
                dataObj.payment_doc =
                    req.files.payment_doc[0].path;
            }

            /* ------------------ VALIDATE ------------------ */
            const { error } = commissionSchema.validate(dataObj);

            if (error) {
                return next(error);
            }

            /* ------------------ INSERT COMMISSION ------------------ */
            const commissionData = {
                order_id: dataObj.order_id,
                tds: dataObj.tds,
                gst: dataObj.gst,
                payment_id: dataObj.payment_id,
                payment_doc: dataObj.payment_doc || "",
                inv_number: dataObj.inv_number,
            };

            const insertQuery = `
            INSERT INTO partner_commission SET ?
        `;

            const result = await insertData(
                insertQuery,
                commissionData,
                next
            );

            /* ------------------ UPDATE VERIFY STATUS ------------------ */
            const updateQuery = `
            UPDATE order_transactions
            SET verify = 2
            WHERE order_id = ${dataObj.order_id}
        `;

            await getData(updateQuery, next);

            /* ------------------ RESPONSE ------------------ */
            return res.json({
                success: true,
                message: "Commission added successfully",
                commission_id: result.insertId,
            });

        } catch (error) {
            next(error);
        }
    },
    async getOrderCommissionPartner(req, res, next) {
        try {

            /* ------------------ Validation ------------------ */
            const schema = Joi.object({
                order_id: Joi.number().integer().required(),
                user_id: Joi.number().integer().required(),
            });

            const { error } = schema.validate(req.query);

            if (error) {
                return next(error);
            }

            /* ------------------ Query ------------------ */
            const query = `
            SELECT
                pc.*,

                pfd.business_name,
                pfd.pan_number,
                pfd.address_line_1,
                pfd.address_line_2,
                pfd.city,
                pfd.state,
                pfd.country,
                pfd.postcode,

                pbi.bank_account_name,
                pbi.bank_account_number,
                pbi.account_type,
                pbi.bank_name,
                pbi.neft_code,
                pbi.swift_code,
                pbi.micr_code,
                pbi.bank_branch_address

            FROM partner_financial_details pfd

            LEFT JOIN partner_bank_information pbi
                ON pbi.user_id = pfd.user_id

            LEFT JOIN partner_commission pc
                ON pc.order_id = ${req.query.order_id}

            WHERE pfd.user_id = ${req.query.user_id}
            AND pfd.is_deleted = 0

            LIMIT 1;
        `;

            const data = await getData(query, next);

            // if (!data.length) {
            //     return res.json({
            //         success: false,
            //         message: "Commission not found",
            //         data: {}
            //     });
            // }

            const item = data[0];
            const response = {
                commission: {
                    commission_id: item.commission_id || "",
                    order_id: item.order_id || "",
                    tds: item.tds || "",
                    gst: item.gst || "",
                    payment_id: item.payment_id || "",
                    payment_doc: item.payment_doc || "",
                    inv_number: item.inv_number || "",
                    created_at: item.created_at || "",
                    updated_at: item.updated_at || ""
                },

                bankinfo: {
                    bank_account_name: item.bank_account_name || "",
                    bank_account_number: item.bank_account_number || "",
                    account_type: item.account_type || "",
                    bank_name: item.bank_name || "",
                    neft_code: item.neft_code || "",
                    swift_code: item.swift_code || "",
                    micr_code: item.micr_code || "",
                    bank_branch_address: item.bank_branch_address || ""
                },

                addressinfo: {
                    business_name: item.business_name || "",
                    pan_number: item.pan_number || "",
                    address_line_1: item.address_line_1 || "",
                    address_line_2: item.address_line_2 || "",
                    city: item.city || "",
                    state: item.state || "",
                    country: item.country || "",
                    postcode: item.postcode || ""
                }
            };

            return res.json({
                success: true,
                message: "Commission details fetched successfully",
                data: response
            });

        } catch (error) {
            next(error);
        }
    },
    async CountPartnerLeadAndProspects(req, res, next) {
        console.log(req.query)
        try {

            const schema = Joi.object({
                user_id: Joi.number().required()
            });

            const { error } = schema.validate(req.query);

            if (error) {
                return next(error);
            }

            const { user_id } = req.query;

            // Total Prospects
            const prospectsQuery = `
            SELECT COUNT(*) AS totalProspects
            FROM partner_prospects
            WHERE user_id = ${user_id}
            AND lead_type = 'Prospects'
            AND is_deleted = 0
        `;

            // Converted Leads
            const convertedLeadsQuery = `
            SELECT COUNT(*) AS convertedLeads
            FROM order_transactions
            WHERE addedPartnerID = ${user_id}
            AND rm_status = 'COMPLETED'
            AND am_status = 'COMPLETED'
            AND st_status = 'COMPLETED'
        `;

            const prospectsResult = await getData(prospectsQuery, next);
            const convertedResult = await getData(convertedLeadsQuery, next);

            return res.json({
                message: "success",
                data: {
                    totalProspects:
                        Number(prospectsResult?.[0]?.totalProspects || 0),

                    convertedLeads:
                        Number(convertedResult?.[0]?.convertedLeads || 0)
                }
            });

        } catch (err) {
            next(err);
        }
    }
}

export default partnerController;