import multer from 'multer';
import { CustomErrorHandler } from '../service/index.js';
import path from 'path';
import { randomInt } from 'crypto';
import commonFuction from './commonFuction.js';
import fs from 'fs-extra'
import { SERVER_HOST } from '../config/index.js';
// const path = require("path");
const serverpath = SERVER_HOST === 'true' ? '../www/html/adis.co.in/cow_assets/' : "uploads/";


var storage = multer.diskStorage({
    destination: function (req, file, cb) {

        // Uploads is the Upload_folder_name
        //  console.log("------>",req.body);
        // console.log(file.fieldname);

        path = serverpath;

        fs.ensureDir(path, err => {
            if (!err) {
                cb(null, path);
            }
        })
    },
    filename: function (req, file, cb) {
        var extname = path.extname(
            file.originalname).toLowerCase();
        cb(null, file.originalname);
    }
})

// Define the maximum size for uploading
// picture i.e. 10 MB. it is optional
const maxSize = 10 * 1000 * 1000;

var imageUpload = multer({
    storage: storage,
    limits: { fileSize: maxSize },
    fileFilter: function (req, file, cb) {

        // Set the filetypes, it is optional
        var filetypes = /jpeg|jpg|png|pdf|html|mp4|MPEG-4|mkv/;
        var mimetype = filetypes.test(file.mimetype);

        var extname = filetypes.test(path.extname(
            file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        // return cb(CustomErrorHandler.alreadyExist)
        return cb("Error: File upload only supports the "
            + "following filetypes - " + filetypes);
    },
    // mypic is the name of file attribute
}).fields(
    [
        {
            name: 'cmp_logo', maxCount: 1
        },
    ]
);

export default imageUpload;