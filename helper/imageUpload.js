import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { SERVER_HOST } from '../config/index.js';

const serverpath = SERVER_HOST === 'true'
    ? 'our url'
    : 'uploads/upload/';

// Ensure upload directory exists
fs.ensureDirSync(serverpath);

// ---------------- STORAGE ----------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, serverpath);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();

        let prefix = "file";
        // if (file.fieldname === "profile") prefix = "profile";
        if (file.fieldname === "cmp_logo") prefix = "cmp_logo";
        if (file.fieldname === "document") prefix = "annual_report";
        if (file.fieldname === "user_document") prefix = req?.body?.broker_name ?? "";
        if (file.fieldname === "bank_document") prefix = "statement_";
        if (file.fieldname === "service_gallery") prefix = "gallery";
        if (file.fieldname === "cmr_document") prefix = `${req?.body?.broker_name}_`;

        cb(null, `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
    }
});

// ---------------- CONFIG ----------------
const maxSize = 20 * 1024 * 1024; // 10MB

const imageUpload = multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
        const allowedExt = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedExt.test(path.extname(file.originalname).toLowerCase());

        const allowedMime =
            file.mimetype.startsWith("image/") ||
            file.mimetype === "application/pdf" ||
            file.mimetype === "application/msword" ||
            file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        if (extname && allowedMime) return cb(null, true);

        cb(new Error("Only JPG, PNG, PDF, DOC, DOCX files are allowed"));
    }
}).fields([
    { name: 'cmp_logo', maxCount: 1 },          // company logo
    { name: 'document', maxCount: 1 },          // annual report
    { name: 'service_gallery', maxCount: 10 },   // portfolio gallery images
    { name: 'profile', maxCount: 1 },
    { name: 'user_document', maxCount: 1 },
    { name: 'bank_document', maxCount: 1 },
    { name: 'cmr_document', maxCount: 1 },
]);

export default imageUpload;
