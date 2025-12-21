import multer from 'multer';
import { CustomErrorHandler } from '../service/index.js';
import path from 'path';
import fs from 'fs-extra';
import { SERVER_HOST } from '../config/index.js';

const serverpath = SERVER_HOST === 'true'
    ? '../www/html/adis.co.in/cow_assets/'
    : 'uploads/upload/'; // fixed folder

// Ensure upload folder exists
fs.ensureDirSync(serverpath);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, serverpath);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `cmp_logo_${Date.now()}${ext}`;
        cb(null, filename);
    }
});

// Max file size 10MB
const maxSize = 10 * 1024 * 1024;

const imageUpload = multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|pdf|html|mp4|mkv/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) return cb(null, true);
        return cb(new Error(`File upload only supports - ${filetypes}`));
    }
}).fields([
    { name: 'cmp_logo', maxCount: 1 }
]);

export default imageUpload;
