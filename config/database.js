import mysql from 'mysql';
import CustomErrorHandler from '../service/CustomErrorHandler.js';
import { isArray } from 'util';

/**
 * ENV
 * SERVER_HOST=true  → server
 * SERVER_HOST=false → local
 */
const isServer = (process.env.SERVER_HOST === true);

const credentil = isServer
    ? {
        host: "127.0.0.1",
        user: "dbt",
        password: "thangive@2026",
        database: "thangive"
    }
    : {
        host: "localhost",
        user: "root",
        password: "",
        database: "thangive"
    };

let con;

/**
 * ✅ SAFE CONNECTION HANDLER
 */
function handleDisconnect() {
    con = mysql.createConnection(credentil);

    con.connect((err) => {
        if (err) {
            console.error('❌ DB connect error:', err.message);
            setTimeout(handleDisconnect, 3000); // retry
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
            handleDisconnect(); // 🔥 auto reconnect
        } else {
            throw err;
        }
    });
}

handleDisconnect();

// export const dbConnect= () => new Promise((resolve, reject) => {
//     con.connect(function (err) {
//         if (err) {
//             reject("Fail to connect to database",err.message);
//         } else {
//             resolve("database Connected successfully!");
//         }
//     });
// });


export const getData = (query, next) => new Promise((resolve, reject) => {
    con.query(query, function (err, result, fields) {
        if (err) {
            reject(err);
        } else {
            // result && result.length <= 0 && (result.push({}));
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

        // ✔ If params is Array (bulk insert / positional values)
        if (Array.isArray(data) && data.length > 0) {
            con.query(query, data, callback);

            // ✔ If params is Object (INSERT SET ? / named values)
        } else if (data && typeof data === "object") {
            con.query(query, data, callback);

            // ✔ If no params required
        } else {
            con.query(data, callback);
        }
    });



export const getCount = async (query, next) => {
    let result = await getData(query, next).then(async (data) => {
        if (data.length <= 0) {
            return next(CustomErrorHandler.notFound());
        } else {

            let key = Object && Object.keys(data[0]) && Object.keys(data[0])[0];
            data[0][key] = data && data[0][key] && data[0][key].toString();
            return data[0];
        }
    });
    return result;
}


export default con;