import mysql from 'mysql';
import CustomErrorHandler from '../service/CustomErrorHandler.js';

const credentil = false ? {
    host: "localhost",
    user: "root",
    password: "!gpg3o1mcd3P3BzR",
    database: "adis_db"
} :
    {
        host: "localhost",
        user: "root",
        password: "",
        database: "thangive"
    }

const con = mysql.createConnection(credentil);


con.connect(function (err) {
    if (err) {
        console.log("Fail to connect to database", err.message);
    } else {
        console.log("database Connected successfully!");
    }
});

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
