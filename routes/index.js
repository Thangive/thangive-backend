import express from 'express';
import multer from 'multer';
import { sectorController, stocksCotrollers } from '../controllers/index.js';
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

router.post('/shareHolding', forms, stocksCotrollers.addUpdateShareHolding);
router.get('/shareHolding', stocksCotrollers.getShareHolding);

router.get('/sectors', sectorController.getSectorData);
router.post('/sectorscreate', sectorController.createSectors);
router.post('/sectorsupdate', sectorController.updateSector);
router.get('/industrys', sectorController.getIndustryData);
router.post('/industrycreate', sectorController.createIndustry);
router.post('/industryupdate', sectorController.updateIndistry);
<<<<<<< Updated upstream
router.get('/subIndustries', sectorController.getSubindustryData);
router.post('/subIndustries', sectorController.createSubindustry);
router.post('/updateSubindustriess', sectorController.updatesubinditries);
router.get('/getStockDetailson', sectorController.getStockDetailsonly)
router.get("/stockDetailsByID/:id", sectorController.getStockDetailsById);
router.get('/subIndustries', sectorController.getSubindustryData);
router.post('/subIndustries', sectorController.createSubindustry);
router.post('/updateSubindustriess', sectorController.updatesubinditries);

=======
router.get('/subIndustries',sectorController.getSubindustryData);
router.post('/subIndustries',sectorController.createSubindustry);
router.post('/updateSubindustriess',sectorController.updatesubinditries);
router.get('/getStockDetailson',sectorController.getStockDetailsonly)
router.get("/stockDetailsByID/:id",sectorController.getStockDetailsById);
router.get("/devident/:id",sectorController.getDivident);
router.delete('/devident/:id', sectorController.deleteDividend);
router.get("/AnnualReport/:id",sectorController.getAnualReport);
>>>>>>> Stashed changes
export default router;