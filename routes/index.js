import express from 'express';
import multer from 'multer';
import { advisorControler, PriceController, sectorController, stocksCotrollers, stocksGetController, userController, wishlistController } from '../controllers/index.js';
import imageUpload from '../helper/imageUpload.js';
import auth from '../middlewares/auth.js';



const forms = multer().array();
const forms1 = multer().any();


const router = express.Router();

// User API
router.post('/userRegister', forms, userController.addUpdateUserProfile);
router.post('/userProfile', auth, imageUpload, userController.addUpdateUserProfile);
router.get('/userProfile', auth, userController.getUserProfile);
router.post('/userDocument', auth, imageUpload, userController.addUpdateUserDocument);
router.post('/userBankDetails', auth, imageUpload, userController.addUpdateUserBankDetails);
router.post('/userCMRDetails', auth, imageUpload, userController.addUpdateUserCMRDetails);

router.post('/login', forms, userController.login);

// Wishlist API 
router.post('/wishlist', auth, forms, wishlistController.addUpdateWishlist);
router.post('/addStockToWishlist', auth, forms, wishlistController.addStockToWishlist);
router.get('/wishlist', auth, wishlistController.getWishlist);

router.post('/advisor', auth, forms, advisorControler.addUpdateAdvisor);
router.get('/advisor', auth, advisorControler.getAdvisor);


// Stock Details API
router.post('/stockDetails', imageUpload, stocksCotrollers.addUpdateStockDetails);
router.post('/stockPrice', forms, PriceController.addUpdateStockPrice);
router.post('/stockDiscription', forms, stocksCotrollers.addUpdateStockDescription);
router.post('/clientPortfolioHeading', forms, stocksCotrollers.addUpdateClientPortfolioHeading);
router.post('/clientPortfolioData', forms, stocksCotrollers.addUpdateClientPortfolioData);
router.post('/AnnualReport', imageUpload, stocksCotrollers.addUpdateAnnualReport);
router.post('/devident', forms, stocksCotrollers.addUpdateDividend);
router.post('/companyPortfolio', imageUpload, stocksCotrollers.addUpdatePortfolio);
router.get('/stockDetails', stocksCotrollers.getStockData);
router.get('/companyPortfolio', stocksCotrollers.getCompanyPortfolioData);
router.get('/clientPortfolioHeading', stocksCotrollers.getClientPortfolioHeading);
router.get('/clientPortfolioData', stocksCotrollers.getClientPortfolioData);




router.post('/shareHolding', forms, stocksCotrollers.addUpdateShareHolding);
router.get('/shareHolding', stocksCotrollers.getShareHolding);

router.get('/sectors', sectorController.getSectorData);
router.post('/sectorscreate', sectorController.createSectors);
router.post('/sectorsupdate', sectorController.updateSector);
router.get('/industrys', sectorController.getIndustryData);
router.post('/industrycreate', sectorController.createIndustry);
router.post('/industryupdate', sectorController.updateIndistry);
router.get('/subIndustries', sectorController.getSubindustryData);
router.post('/subIndustries', sectorController.createSubindustry);
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
router.post("/FRTemplate", forms, PriceController.addupdateFRTemplate);
router.get("/FRTemplate", PriceController.getFRTemplates);
router.post("/FRSheetValues", forms, PriceController.addUpdateFRValues);
router.get("/FRSheetValues", PriceController.getFRSheetValues);
router.get("/searchStocks", PriceController.getSearchStock);
router.get("/stockDetailsByIDPeer/:id", PriceController.stockDetailsByIDPeer);
router.get("/peerComparison", PriceController.getPeerComparison);
router.post("/peerComparison", forms, PriceController.AddPeerComparison);
router.get("/deletePeer", PriceController.getDeletePeer);


// Stock Fetch APIS
router.get('/getStocks', stocksGetController.getStocks)
router.get('/getStocksList', stocksGetController.getStockList)
router.get('/getStockData', stocksGetController.getStockData)

router.post("/chartBulkUpload", forms1, PriceController.chartBulkUpload)
router.post("/chartSingleUpload", forms1, PriceController.chartSingleUpload)


export default router;