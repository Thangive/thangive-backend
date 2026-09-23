import mysql from 'mysql';
import CustomErrorHandler from '../service/CustomErrorHandler.js';

const credentil = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    ssl: {
        rejectUnauthorized: false
    }
};

console.log("Database:", {
    host: credentil.host,
    user: credentil.user,
    database: credentil.database,
    port: credentil.port
});

let con;

function handleDisconnect() {
    con = mysql.createConnection({
        ...credentil,
        dateStrings: true
    });

    con.connect((err) => {
        if (err) {
            console.error('❌ DB connect error:', err.message);
            setTimeout(handleDisconnect, 3000);
        } else {
            console.log('✅ Database Connected successfully!');
        }
    });

    con.on('error', (err) => {
        console.error('❌ DB runtime error:', err.code);

        if (
            err.code === 'PROTOCOL_CONNECTION_LOST' ||
            err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
        ) {
            handleDisconnect();
        } else {
            throw err;
        }
    });
}

handleDisconnect();

export const getData = (query, next) => new Promise((resolve, reject) => {
    con.query(query, function (err, result, fields) {
        if (err) {
            reject(err);
        } else {
            resolve(result);
        }
    });
});

export const insertData = (query, data, next) =>
    new Promise((resolve, reject) => {

        const callback = (err, result, fields) => {
            if (err) {
                if (typeof next === "function") return next(err);
                return reject(err);
            }
            resolve(result);
        };

        if (Array.isArray(data) && data.length > 0) {
            con.query(query, data, callback);
        } else if (data && typeof data === "object") {
            con.query(query, data, callback);
        } else {
            con.query(data, callback);
        }
    });

export const getCount = async (query, next) => {
    let result = await getData(query, next).then(async (data) => {
        if (data.length <= 0) {
            return next(CustomErrorHandler.notFound());
        } else {
            let key = Object.keys(data[0])[0];
            data[0][key] = data[0][key]?.toString();
            return data[0];
        }
    });

    return result;
};

export default con;