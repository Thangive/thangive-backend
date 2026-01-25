import 'dotenv/config';

export const APP_PORT = process.env.APP_PORT;
export const WEB_PORT = process.env.WEB_PORT;
export const DEBUG_MODE = process.env.DEBUG_MODE;
export const SERVER_HOST = process.env.SERVER_HOST;
export const JWT_SECRET = process.env.JWT_SECRET;


export { getData, insertData, getCount } from './database.js';