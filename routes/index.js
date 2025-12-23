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
router.get('/sectors',stocksCotrollers.getSectorData);
router.post('/sectorscreate',stocksCotrollers.createSectors);
router.post('/sectorsupdate',stocksCotrollers.updateSector);
router.get('/industrys',stocksCotrollers.getIndustryData);
router.post('/industrycreate',stocksCotrollers.createIndustry);
router.post('/industryupdate',stocksCotrollers.updateIndistry);





export default router;