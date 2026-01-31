import fs from 'fs-extra'
import { getData, insertData, SERVER_HOST } from '../config/index.js';

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

    async setOtp(userId, next) {
        try {
            const otp = Math.floor(100000 + Math.random() * 900000);

            const query = `
                INSERT INTO otp (user_id, otp)
                VALUES (?, ?)
            `;
            console.log("hded", query);

            await insertData(query, [userId, otp], next);

            return otp;
        } catch (err) {
            if (typeof next === 'function') {
                return next(err);
            }
            throw err;
        }
    },

    async sendSMS(phoneNumber, message) {
        try {
            // 🔁 Replace with your SMS gateway details
            const SMS_API_URL = "https://api.smsprovider.com/send";
            const API_KEY = process.env.SMS_API_KEY;

            const payload = {
                to: phoneNumber,
                message: message
            };

            const headers = {
                Authorization: `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            };

            const response = await axios.post(SMS_API_URL, payload, { headers });

            return response.data;

        } catch (error) {
            console.error("SMS sending failed:", error.message);
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