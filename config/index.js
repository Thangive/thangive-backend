
import dotenv from 'dotenv';

dotenv.config();

export const {
    APP_PORT,
    WEB_PORT,
    DEBUG_MODE,
    SERVER_HOST,
    JWT_SECRET
} = process.env;


export { getData, insertData, getCount } from './database.js';