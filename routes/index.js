import express from 'express';
import multer from 'multer';
import { PriceController, sectorController, stocksCotrollers, userController } from '../controllers/index.js';
import imageUpload from '../helper/imageUpload.js';
import auth from '../middlewares/auth.js';

const forms = multer().array();
const forms1 = multer().any();


const router = express.Router();

// User API
router.post('/userRegister', forms, userController.addUpdateUserProfile);
router.post('/userProfile', auth, imageUpload, userController.addUpdateUserProfile);
router.post('/login', forms, userController.login);



// Stock Details API
router.post('/stockDetails', imageUpload, stocksCotrollers.addUpdateStockDetails);
router.post('/stockPrice', forms, PriceController.addUpdateStockPrice);
router.post('/stockDiscription', forms, stocksCotrollers.addUpdateStockDescription);
router.post('/clientPortfolioHeading', forms, stocksCotrollers.addUpdateClientPortfolioHeading);
router.post('/clientPortfolioData', forms, stocksCotrollers.addUpdateClientPortfolioData);
router.post('/AnnualReport', imageUpload, stocksCotrollers.addUpdateAnnualReport);
router.post('/devident', forms, stocksCotrollers.addUpdateDividend);
router.post('/companyPortfolio', imageUpload, stocksCotrollers.addUpdatePortfolio);
router.get('/stockDetails', auth, stocksCotrollers.getStockData);
router.get('/companyPortfolio', auth, stocksCotrollers.getCompanyPortfolioData);
router.get('/clientPortfolioHeading', auth, stocksCotrollers.getClientPortfolioHeading);
router.get('/clientPortfolioData', auth, stocksCotrollers.getClientPortfolioData);




router.post('/shareHolding', auth, forms, stocksCotrollers.addUpdateShareHolding);
router.get('/shareHolding', auth, stocksCotrollers.getShareHolding);

router.get('/sectors', auth, sectorController.getSectorData);
router.post('/sectorscreate', auth, sectorController.createSectors);
router.post('/sectorsupdate', auth, sectorController.updateSector);
router.get('/industrys', auth, sectorController.getIndustryData);
router.post('/industrycreate', auth, sectorController.createIndustry);
router.post('/industryupdate', auth, sectorController.updateIndistry);
router.get('/subIndustries', auth, sectorController.getSubindustryData);
router.post('/subIndustries', auth, sectorController.createSubindustry);
router.post('/updateSubindustriess', sectorController.updatesubinditries);
router.get('/getStockDetailson', sectorController.getStockDetailsonly)
router.get("/stockDetailsByID/:id", sectorController.getStockDetailsById);
router.get("/devident/:id", sectorController.getDivident);
router.delete('/devident/:id', sectorController.deleteDividend);
router.get("/AnnualReport/:id", sectorController.getAnualReport);
router.post("/dailyPriceExcelUpdate", forms1, PriceController.updatePriceExcel)
router.get("/stockPriceChart", PriceController.getStockPriceChartData);
router.get("/cashflowTemplates", PriceController.getCashFlowTemplates);
router.post("/CashflowValues", forms, PriceController.addUpdateCashFlowValues);
router.get("/CashflowValues", PriceController.getCashFlowValues);
router.post("/balanceSheetTemplate", forms, PriceController.addUpdateBalanceSheetTemplates);
router.get("/balanceSheetTemplate", PriceController.getBalanceSheetTemplates);
router.post("/balanceSheetValues", forms, PriceController.addUpdateBalanceSheetValues);
router.get("/balanceSheetValues", PriceController.getBalanceSheetValues);
router.post("/PLTemplate", forms, PriceController.addUpdatePLTemplates);
router.get("/PLTemplate", PriceController.getPLTemplates);
router.post("/PLSheetValues", forms, PriceController.addUpdatePLValues);
router.get("/PLSheetValues", PriceController.getPLSheetValues);


export default router;