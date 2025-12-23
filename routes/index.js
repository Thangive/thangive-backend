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
router.post('/clientPortfolioHeading', forms, stocksCotrollers.addUpdateClientPortfolioHeading);
router.post('/clientPortfolioData', forms, stocksCotrollers.addUpdateClientPortfolioData);
router.post('/AnnualReport', imageUpload, stocksCotrollers.addUpdateAnnualReport);
router.post('/devident', forms, stocksCotrollers.addUpdateDividend);
router.post('/companyPortfolio', imageUpload, stocksCotrollers.addUpdatePortfolio);
router.get('/stockDetails', stocksCotrollers.getStockData);
router.get('/sectors',stocksCotrollers.getSectorData);
router.post('/sectorscreate',stocksCotrollers.createSectors);
router.post('/sectorsupdate',stocksCotrollers.updateSector);
router.get('/industrys',stocksCotrollers.getIndustryData);
router.post('/industrycreate',stocksCotrollers.createIndustry);
router.post('/industryupdate',stocksCotrollers.updateIndistry);





export default router;