import mysql from 'mysql';
import CustomErrorHandler from '../service/CustomErrorHandler.js';

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
            resolve(err);
        } else {
            // result && result.length <= 0 && (result.push({}));
            resolve(result);
        }
    });
});

export const insertData = (query, array, next) => new Promise((resolve, reject) => {
    con.query(query, array, function (err, result, fields) {
        if (err) {
            next(err);
        } else {
            resolve(result);
        }
    });
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