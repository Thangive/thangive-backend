import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler, JwtService } from "../../service/index.js";
import md5 from 'md5';
import paginationQuery from '../../helper/paginationQuery.js';
import commonFunction from '../../helper/commonFunction.js';

const serviceController = {
    async login(req, res, next) {
        try {
            // ---------- Validation ----------
            const loginSchema = Joi.object({
                username: Joi.string().required(),
                password: Joi.string().required(),
            });

            const { error, value } = loginSchema.validate(req.body ?? {});
            if (error) return next(error);

            // ---------- Get user ----------
            const query = `SELECT user_id,username,email,phone_number,user_type as Role,password FROM users WHERE is_deleted=0 AND username='${value.username}'`;
            const users = await getData(query, next);

            if (!users || users.length === 0) {
                return next(CustomErrorHandler.wrongCredentials());
            }

            const user = users[0];

            // ---------- Verify password ----------
            const match = md5(req.body.password) === user.password ? true : false;
            if (!match) return next(CustomErrorHandler.wrongCredentials());

            delete user.password; // remove password from response

            // // ---------- Generate JWT ----------
            const accessToken = JwtService.sign(
                { _id: user.user_id, role: user.role },
                '1d'
            );

            // // ---------- Record login history ----------
            await commonFunction.saveLoginHistory(user.user_id, 'LOGIN', next);

            // ---------- Send response ----------
            return res.json({
                status: true,
                message: "User logged in successfully",
                accessToken,
                data: user
            });

        } catch (err) {
            next(err);
        }
    },

    async forgotPassword(req, res, next) {
        try {
            const schema = Joi.object({
                username: Joi.string().optional(),
                phone_number: Joi.number().optional(),
                user_type: Joi.valid('user', 'employee').required(),
            })
                .or('username', 'phone_number')
                .messages({
                    'object.missing': 'Either username or phone number is required'
                });


            const { error, value } = schema.validate(req.body ?? {});
            if (error) return next(error);
            let cond = (value.user_type == 'user') ? `AND user_type = 'user'` : `AND user_type != 'user'`;
            const userQuery = `SELECT user_id, phone_number FROM users WHERE  is_deleted = 0 ${cond} AND  username = '${value.username}' OR phone_number = '${value.phone_number}'`;


            const users = await getData(userQuery, next);

            if (!users || users.length === 0) {
                return next(CustomErrorHandler.doesNotExist("User not found"));
            }

            const user = users[0];
            // Send OTP only when creating new password
            const otp = await commonFunction.setOtp({ userId: user?.user_id, phoneNumber: user?.phone_number }, next);
            const message = `Dear User, ${otp} is your login OTP for account access. Do not share it with anyone. - THANGIV CONSULTANCY PRIVATE LIMITED`;
            await commonFunction.sendSMS(user?.phone_number, message);

            // sendOtpSMS(user[0].phone_number, otp);

            return res.json({
                success: true,
                otp: otp,
                message: "OTP sent successfully"
            });

        } catch (err) {
            return next(err);
        }
    },

    async changePassword(req, res, next) {
        try {
            // ---------- Validation ----------
            const schema = Joi.object({
                username: Joi.string().required(),
                newPassword: Joi.string().required(),
                confirmPassword: Joi.string().required()
            });

            const { error, value } = schema.validate(req.body ?? {});
            if (error) {
                return next(error);
            }

            // ---------- Password match check ----------
            if (value.newPassword !== value.confirmPassword) {
                return next(
                    CustomErrorHandler.badRequest("Password and confirm password do not match")
                );
            }

            // ---------- Check user ----------
            const query = `
                    SELECT 
                        user_id,
                        username,
                        email,
                        phone_number,
                        user_type AS role,
                        password
                    FROM users
                    WHERE is_deleted = 0
                      AND username = '${value.username}'
                `;

            const data = await getData(query, next);

            if (!data || data.length === 0) {
                return next(CustomErrorHandler.wrongCredentials());
            }

            // ---------- Update password ----------
            const newPassword1 = md5(value.newPassword);

            const updateQuery = `
                    UPDATE users 
                    SET password = '${newPassword1}'
                    WHERE user_id = ${data[0].user_id}
                `;

            await insertData(updateQuery, {}, next);

            delete data[0].password;

            return res.json({
                success: true,
                message: "Password reset successfully",
                data: data[0]
            });

        } catch (error) {
            return next(error);
        }
    },

    async verifyOtp(req, res, next) {
        try {

            const schema = Joi.object({
                username: Joi.string().optional(),
                phone_number: Joi.string().optional(),
                user_type: Joi.valid('user', 'employee').required(),
                otp: Joi.number().required()
            }).or('username', 'phone_number').or('username', 'phone_number')
                .messages({
                    'object.missing': 'Either username or phone number is required'
                });

            const { error, value } = schema.validate(req.body ?? {});
            if (error) return next(error);

            let cond = (value.user_type == 'user') ? `AND user_type = 'user'` : `AND is_deleted = 0 AND user_type != 'user'`;
            const userQuery = `SELECT user_id, phone_number FROM users WHERE username = '${value.username}' OR phone_number = '${value.phone_number}' ${cond}`;

            console.log(userQuery);

            const { otp } = value;

            // ---------- Build condition dynamically ----------
            let whereClause = ``;

            const users = await getData(userQuery, next);

            if (!users || users.length === 0) {
                return next(CustomErrorHandler.doesNotExist("Username or phone number is wrong"));
            }

            const user = users[0];

            if (user?.phone_number) {
                whereClause = `phone_number = "${user?.phone_number}"`;
            } else {
                whereClause = `user_id = "${user?.user_id}"`;
            }

            const otpQuery = `
                SELECT otp_id, created_at
                FROM otp
                WHERE ${whereClause}
                  AND otp = ${otp}
                ORDER BY otp_id DESC
                LIMIT 1
            `;

            const otpData = await getData(otpQuery, next);

            if (!otpData || otpData.length === 0) {
                return next(
                    CustomErrorHandler.wrongCredentials("Invalid OTP")
                );
            }

            // ---------- Check expiry (10 minutes) ----------
            const createdAt = new Date(otpData[0].created_at);
            const now = new Date();
            const diffMinutes = (now - createdAt) / (1000 * 60);

            if (diffMinutes > 1) {
                return next(
                    CustomErrorHandler.badRequest("OTP expired")
                );
            }

            if (user?.phone_number && diffMinutes < 1) {
                const useQuery = `SELECT * FROM users WHERE is_deleted='1' AND phone_number='${user?.phone_number}'`;
                const response = await getData(useQuery, next);
                if (response || response.length !== 0) {
                    const query = `UPDATE users SET ? WHERE is_deleted='1' AND phone_number='${user?.phone_number}'`
                    const result = await insertData(query, { is_deleted: 0 }, next);
                }
            }

            // ---------- OTP verified ----------
            return res.json({
                success: true,
                message: "OTP verified successfully"
            });

        } catch (err) {
            return next(err);
        }
    },

    async getLogHistory(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `
                SELECT 
                    u.user_id,
                    u.username AS name,
                    u.user_type AS role,
                    lh.activity,
                    DATE_FORMAT(lh.created_at, '%d-%m-%y %H:%i:%s') AS date_time
                FROM login_history lh
                JOIN users u ON lh.user_id = u.user_id
                WHERE 1
            `;
            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation Schema ------------------ */
            const schema = Joi.object({
                user_id: Joi.number().integer(),
                username: Joi.string(),
                role: Joi.string(),
                activity: Joi.string().valid('LOGIN', 'LOGOUT'),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error, value } = schema.validate(req.query ?? {});
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (value.user_id) cond += ` AND u.user_id = ${value.user_id}`;
            if (value.username) cond += ` AND u.username LIKE '%${value.username}%'`;
            if (value.role) cond += ` AND u.user_type = '${value.role}'`;
            if (value.activity) cond += ` AND lh.activity = '${value.activity}'`;

            /* ------------------ Pagination ------------------ */
            if (value.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    value.current_page,
                    value.per_page_records
                );
            }

            query += cond + page.pageQuery;

            /* ------------------ Fetch Data ------------------ */
            const data = await getData(query, next);

            return res.json({
                status: true,
                message: "Login history fetched successfully",
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },

    async logout(req, res, next) {
        try {
            if (!req.user || !req.user._id) {
                return next(CustomErrorHandler.unAuthorise("Invalid token or user not found"));
            }

            const userId = req.user._id;

            await commonFunction.saveLoginHistory(userId, 'LOGOUT', next);

            return res.json({
                status: true,
                message: "User logged out successfully"
            });
        } catch (err) {
            next(err);
        }
    }

}

export default serviceController;