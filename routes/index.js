import express from 'express';
import multer from 'multer';
import { brokerAndAdvisorControler, serviceController, PriceController, sectorController, stocksCotrollers, stocksGetController, transactionController, userController, wishlistController } from '../controllers/index.js';
import imageUpload from '../helper/imageUpload.js';
import auth from '../middlewares/auth.js';



const forms = multer().array();
const forms1 = multer().any();


const router = express.Router();

// User API
router.post('/userRegister', forms, userController.addUpdateUserProfile);
router.post('/userProfile', auth, imageUpload, userController.addUpdateUserProfile);
router.get('/userList', auth, userController.getUserList);
router.get('/employeeList', auth, userController.getEmplyees);
router.post('/userDocument', auth, imageUpload, userController.addUpdateUserDocument);
router.post('/userBankDetails', auth, imageUpload, userController.addUpdateUserBankDetails);
router.post('/userCMRDetails', auth, imageUpload, userController.addUpdateUserCMRDetails);
router.get('/RMList', auth, userController.getRMList);
router.post('/assignToRM', auth, forms, userController.assignToRM);


router.post('/login', forms, serviceController.login);
router.post('/forgotPassword', forms, serviceController.forgotPassword);
router.post('/resendOTP', forms, serviceController.forgotPassword);
router.post('/changePassword', forms, serviceController.changePassword);
router.get('/logHistory', auth, serviceController.getLogHistory);
router.post('/otpVerification', forms, serviceController.verifyOtp);
router.post('/logout', auth, serviceController.logout);

// Wishlist API 
router.post('/wishlist', auth, forms, wishlistController.addUpdateWishlist);
router.post('/addStockToWishlist', auth, forms, wishlistController.addStockToWishlist);
router.get('/wishlist', auth, wishlistController.getWishlist);

// Broker API
router.post('/broker', auth, forms, brokerAndAdvisorControler.addUpdateBroker);
router.get('/broker', auth, brokerAndAdvisorControler.getBroker);
router.post('/advisor', auth, forms, brokerAndAdvisorControler.addUpdateAdvisor);
router.get('/advisor', auth, brokerAndAdvisorControler.getAdvisor);

router.post('/buyStock', auth, forms, transactionController.addUpdateOrder);
router.post('/sellStock', auth, forms, transactionController.addUpdateOrder);
router.post('/updateOrderStatus', auth, forms, transactionController.updateOrderStatus);
router.get('/holdedStockQuantity', auth, transactionController.getHoldingStockQuantity);


// router.post('/stockTransactionUpdate', auth, forms, transactionController.addUpdateOrder);
router.post('/stockTransactionUpdate', auth, forms, transactionController.addUpdateOrder);
router.get('/stockOrderList', auth, forms, transactionController.getStockOrderList);

router.get('/userHoldings', auth, transactionController.getUserHoldigs);


// Stock Details API
router.get('/getCompanyLogos', stocksCotrollers.getCompanyLogos);
router.post('/stockDetails', imageUpload, stocksCotrollers.addUpdateStockDetails);
router.post('/stockPrice', forms, PriceController.addUpdateStockPrice);
router.post('/stockDiscription', forms, stocksCotrollers.addUpdateStockDescription);
router.post('/clientPortfolioHeading', forms, stocksCotrollers.addUpdateClientPortfolioHeading);
router.post('/clientPortfolioData', forms, stocksCotrollers.addUpdateClientPortfolioData);
router.post('/AnnualReport', imageUpload, stocksCotrollers.addUpdateAnnualReport);
router.post('/devident', forms, stocksCotrollers.addUpdateDividend);
router.post('/companyPortfolio', imageUpload, stocksCotrollers.addUpdatePortfolio);
// router.get('/stockDetails', stocksCotrollers.getStockData);
router.get('/companyPortfolio', stocksCotrollers.getCompanyPortfolioData);
router.get('/clientPortfolioHeading', stocksCotrollers.getClientPortfolioHeading);
router.get('/clientPortfolioData', stocksCotrollers.getClientPortfolioData);

router.post('/PreStock', auth, imageUpload, stocksCotrollers.addUpdatePreStock);
router.get('/PreStock', stocksCotrollers.getPreStocks);

router.post('/shareHolding', forms, stocksCotrollers.addUpdateShareHolding);
router.get('/shareHolding', stocksCotrollers.getShareHolding);
router.get('/orderDetails', transactionController.getOrderDetails);

router.get('/sectors', sectorController.getSectorData);
router.post('/sectorscreate', sectorController.createSectors);
router.post('/sectorsupdate', sectorController.updateSector);
router.get('/industrys', sectorController.getIndustryData);
router.post('/industrycreate', sectorController.createIndustry);
router.post('/industryupdate', sectorController.updateIndistry);
router.get('/subIndustries', sectorController.getSubindustryData);
router.post('/subIndustries', sectorController.createSubindustry);
router.post('/updateSubindustriess', sectorController.updatesubinditries);
// router.get('/getStockDetailson', sectorController.getStockDetailsonly)
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
router.get("/stockDetailsByIDPeer/:id", PriceController.stockDetailsByIDPeer);
router.get("/peerComparison", PriceController.getPeerComparison);
router.post("/peerComparison", forms, PriceController.AddPeerComparison);
router.get("/deletePeer", PriceController.getDeletePeer);


// Stock Fetch APIS
router.get('/getStockData', stocksGetController.getStockData)
router.get('/getStockCount', stocksGetController.getStockCounts)
router.get("/searchStocks", stocksGetController.getSearchStock);

// Chart Data APIS
router.post("/chartBulkUpload", forms1, PriceController.chartBulkUpload)
router.post("/chartSingleUpload", forms1, PriceController.chartSingleUpload)


export default router;