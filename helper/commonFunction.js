import fs from 'fs-extra'
import { getData, insertData, SERVER_HOST } from '../config/index.js';
import axios from 'axios';

const commonFunction = {
    moveFiles(src, dest) {
        let path = (SERVER_HOST === "true") ? '../www/html/adis.co.in/cow_assets/' : 'uploads/';
        dest = path + dest;
        src = path + src;
        fs.pathExists(dest, (err, exists) => {
            if (!err) {
                if (exists) {
                    fs.remove(dest, err => {
                        if (err) return console.error(err)
                        console.log('removed success!');
                        commonFunction.moveFiles(src, dest);
                    })
                } else {
                    fs.move(src, dest, err => {
                        if (err) return console.error(err)
                        console.log('move success!')
                    })
                }
            }
            else {
                return false;
            }
        })
    },

    getFiles(src) {
        fs.pathExists(src, (err, exists) => {
            if (!err) {
                if (exists) {
                    fs.readdir(src, (err, files) => {
                        if (err) {
                            return false
                        } else {
                            return excelFiles = files.filter(file => path.extname(file).toLowerCase() === '.xlsx');
                        }
                    });
                }
            }
        });
    },

    async setOtp(data = {}, next) {
        try {
            const { userId, phoneNumber } = data;

            if (!userId && !phoneNumber) {
                throw new Error("Either userId or phoneNumber is required");
            }

            // 🔐 Generate 6-digit OTP
            const otp = Math.floor(100000 + Math.random() * 900000);

            const insertPayload = {
                otp: otp
            };

            if (userId) {
                insertPayload.user_id = userId;
            }

            if (phoneNumber) {
                insertPayload.phone_number = phoneNumber;
            }

            const query = `INSERT INTO otp SET ?`;

            await insertData(query, insertPayload, next);

            return otp;

        } catch (err) {
            if (typeof next === "function") {
                return next(err);
            }
            throw err;
        }
    },

    async sendSMS(phoneNumber, message) {
        try {
            const SMS_API_URL = "https://www.alots.in/sms-panel/api/http/index.php";

            const params = {
                username: "THANGIV",
                apikey: "6F5F5-7AE2B",
                apirequest: "Text",
                sender: "THANGV",
                mobile: phoneNumber,
                message: message,
                route: "TRANS",
                TemplateID: "1707176958944181442",
                format: "JSON"
            };

            const response = await axios.get(SMS_API_URL, { params });

            return response.data;

        } catch (error) {
            console.error("SMS sending failed:", error.response?.data || error.message);
            throw error;
        }
    },

    async saveLoginHistory(userId, activity, next) {
        try {
            const query = `
                INSERT INTO login_history (user_id, activity)
                VALUES (?, ?)
            `;

            await insertData(query, [userId, activity], next);
            return true;

        } catch (err) {
            if (typeof next === "function") return next(err);
            throw err;
        }
    }

}




export default commonFunction;