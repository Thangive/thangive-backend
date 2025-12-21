import express from 'express';
import multer from 'multer';
import { stocksCotrollers } from '../controllers/index.js';
import imageUpload from '../helper/imageUpload.js';

const forms = multer().array();

const router = express.Router();

// User API
router.post('/stockDetails', imageUpload, stocksCotrollers.addUpdateStockDetails);
router.post('/stockPrice', forms, stocksCotrollers.addUpdateStockPrice);
router.post('/stockDiscription', forms, stocksCotrollers.addUpdateStockDescription);
router.get('/stockDetails', stocksCotrollers.getStockData);




export default router;