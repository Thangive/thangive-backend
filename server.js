import './config/index.js';   // 👈 must be first
import express from "express";
import { APP_PORT, SERVER_HOST, WEB_PORT } from "./config/index.js";
import errorHandler from "./middlewares/errorHandler.js";
import rateLimit from "express-rate-limit";
import https from "https";
import http from "http";
import fs from "fs";
import routes from "./routes/index.js";

// define some constant
// To add SSL/ TSL certificate to the API
const options = SERVER_HOST === "true" ? {
    key: fs.readFileSync('/etc/letsencrypt/live/www.cowsoncloud.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/www.cowsoncloud.com/fullchain.pem')
} : {};

// To make limited req in perticular time
// const limiter = rateLimit({
//     windowMs: 15 * 60 * 1000,
//     max: 10000,
//     message: 'Too many requests from this IP, please try again later',
//     keyGenerator: function (req) {
//         return req.ip;
//     },
// });

const app = express();

app.use(express.json());
// app.use(limiter);

/* ✅ FIXED CORS MIDDLEWARE (NO '*') */
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-Requested-With, Content-Type, Authorization, Accept'
    );
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS, PUT, PATCH, DELETE'
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

app.use('/api/', routes);

let image_path = SERVER_HOST === "true" ? 'Paste here url' : 'uploads';
// app.use('/uploads', express.static('uploads'));
app.use('/api/images', express.static(image_path));
// app.use('/api/media', express.static(image_path));

app.use(errorHandler);

// WEB server
http.createServer(options, app).listen(WEB_PORT, () => {
    console.log(`WEB Server started on port ${WEB_PORT}`);
});

// APP server
http.createServer(app).listen(APP_PORT, () => {
    console.log(`APP Server started on port ${APP_PORT}`);
});
