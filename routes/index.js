import express from 'express';
import multer from 'multer';
import { brokerAndAdvisorControler, serviceController, PriceController, sectorController, stocksCotrollers, stocksGetController, transactionController, userController, wishlistController,faqController,blogController, partnerController, refundController, dashboardController, shareTransferDashboardController, partnerDashboardController, accountsDashboardController, reportsController, partnerReportsController } from '../controllers/index.js';
import imageUpload from '../helper/imageUpload.js';
import auth from '../middlewares/auth.js';


const forms = multer().array();
const forms1 = multer().any();


const router = express.Router();

// User API
router.post('/userRegister', forms, userController.addUpdateUserProfile);
router.post('/userProfile', auth, imageUpload, userController.addUpdateUserProfile);
router.post('/rmCreateUpdateUser', auth, imageUpload,userController.rmCreateUpdateUser);
router.get('/userList', auth, userController.getUserList);
router.get('/RMuserList', auth, userController.RMuserList);
router.get('/employeeList', auth, userController.getEmplyees);
router.post('/userDocument', auth, imageUpload, userController.addUpdateUserDocument);
router.post('/userBankDetails', auth, imageUpload, userController.addUpdateUserBankDetails);
router.post('/userCMRDetails', auth, imageUpload, userController.addUpdateUserCMRDetails);
router.get('/RMList', auth, userController.getRMList);
router.post('/assignToRM', auth, forms, userController.assignToRM);
router.post('/contact',forms, userController.addContact);
router.get('/fetchContactedQuery',auth, userController.fetchContactedQuery);


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
router.post('/removeStockFromWishlist', auth, forms, wishlistController.removeStockFromWishlist);
router.get('/wishlist', auth, wishlistController.getWishlist);
router.get('/getWishlistStocks', auth, wishlistController.getWishlistStocks);

// Broker API
router.post('/broker', auth, forms, brokerAndAdvisorControler.addUpdateBroker);
router.get('/broker', auth, brokerAndAdvisorControler.getBroker);
router.post('/advisor', auth, forms, brokerAndAdvisorControler.addUpdateAdvisor);
router.get('/advisor', auth, brokerAndAdvisorControler.getAdvisor);

router.post('/buyStock', auth, forms, transactionController.addUpdateOrder);
router.post('/sellStock', auth, forms, transactionController.addUpdateOrder);
router.post('/updateOrderStatus', auth, imageUpload, transactionController.updateOrderStatus);
router.get('/holdedStockQuantity', auth, transactionController.getHoldingStockQuantity);
router.post('/verifyOrder', auth,forms, transactionController.verifyOrder);

router.get('/getOverview', auth, transactionController.getOverview);
router.get('/getUnlistedOverview', auth, transactionController.getUnlistedAdvisorOverview);
router.get('/getUnlistedCount', auth, transactionController.getUnlistedCount);

// router.post('/stockTransactionUpdate', auth, forms, transactionController.addUpdateOrder);
router.post('/stockTransactionUpdate', auth, forms, transactionController.addUpdateOrder);
router.get('/stockOrderList', auth, forms, transactionController.getStockOrderList);
router.get('/stockOrderDetails', auth, transactionController.getOrderDetails);
router.get('/userHoldings', auth, transactionController.getUserHoldings);
router.get('/orderStatement', auth, transactionController.getOrderStatement);

// Payment APIS
router.post('/addPaymentDetails', auth, imageUpload, transactionController.addUpdatePayment);
router.get('/paymentDetails', auth, transactionController.getPayment);

// Refund & Cancellation APIS (BUY orders only; role is checked inside from the users table)
router.post('/refundRequest', auth, forms, refundController.raiseRefundRequest);
router.post('/refundRequestReview', auth, forms, refundController.reviewRefundRequest);
router.post('/addRefundDetails', auth, imageUpload, refundController.addRefundDetails);
router.get('/refundRequests', auth, refundController.getRefundRequests);

// Dashboard APIs (RM dashboard; the RM role is checked inside from the users table)
router.get('/dashboard/rm/overview', auth, dashboardController.rmOverview);
router.get('/dashboard/rm/contest', auth, dashboardController.rmContest);
router.get('/dashboard/rm/running-orders', auth, dashboardController.rmRunningOrders);
router.get('/dashboard/rm/orders-summary', auth, dashboardController.rmOrdersSummary);
router.get('/dashboard/rm/month-on-month', auth, dashboardController.rmMonthOnMonth);

// Dashboard APIs (AM Accounts dashboard; the AM role is checked inside from the users table)
// Partner dashboard APIs: read-only, PARTNER role checked inside, always limited to the caller's own data
router.get('/dashboard/partner/summary', auth, partnerDashboardController.partnerSummary);
router.get('/dashboard/partner/monthly-commission', auth, partnerDashboardController.partnerMonthlyCommission);
router.get('/dashboard/partner/orders', auth, partnerDashboardController.partnerOrders);
router.get('/dashboard/partner/payouts', auth, partnerDashboardController.partnerPayouts);
router.get('/dashboard/partner/dealer-prices', auth, partnerDashboardController.partnerDealerPrices);

// ST (Share Transfer) dashboard APIs: read-only, ST role checked inside from the users table
router.get('/dashboard/st/summary', auth, shareTransferDashboardController.stSummary);
router.get('/dashboard/st/attention', auth, shareTransferDashboardController.stAttention);
router.get('/dashboard/st/stats', auth, shareTransferDashboardController.stStats);
router.get('/dashboard/st/queue', auth, shareTransferDashboardController.stQueue);
router.get('/dashboard/accounts/summary', auth, accountsDashboardController.accountsSummary);
router.get('/dashboard/accounts/monthly-chart', auth, accountsDashboardController.accountsMonthlyChart);
router.get('/dashboard/accounts/pending-refunds', auth, accountsDashboardController.accountsPendingRefunds);
router.get('/dashboard/accounts/partner-payouts', auth, accountsDashboardController.accountsPartnerPayouts);
router.get('/dashboard/accounts/recent-transactions', auth, accountsDashboardController.accountsRecentTransactions);
router.get('/dashboard/accounts/export', auth, accountsDashboardController.accountsExport);

// Main Reports (RM, AM, ST; role and data scope are checked inside from the users table)
router.get('/reports/options', auth, reportsController.reportOptions);
router.get('/reports/orders', auth, reportsController.ordersReport);
router.get('/reports/orders/export', auth, reportsController.ordersExport);
router.get('/reports/payments', auth, reportsController.paymentsReport);
router.get('/reports/payments/export', auth, reportsController.paymentsExport);
router.get('/reports/refunds', auth, reportsController.refundsReport);
router.get('/reports/refunds/export', auth, reportsController.refundsExport);
router.get('/reports/partners', auth, reportsController.partnersReport);
router.get('/reports/partners/export', auth, reportsController.partnersExport);
router.get('/reports/commissions', auth, reportsController.commissionsReport);
router.get('/reports/commissions/export', auth, reportsController.commissionsExport);
router.get('/reports/share-debit', auth, reportsController.shareDebitReport);
router.get('/reports/share-debit/export', auth, reportsController.shareDebitExport);
router.get('/reports/prospects', auth, reportsController.prospectsReport);
router.get('/reports/prospects/export', auth, reportsController.prospectsExport);
router.get('/reports/performance', auth, reportsController.performanceReport);
router.get('/reports/performance/export', auth, reportsController.performanceExport);
router.get('/reports/financial', auth, reportsController.financialReport);
router.get('/reports/financial/export', auth, reportsController.financialExport);
router.get('/partner-reports/orders', auth, partnerReportsController.ordersReport);
router.get('/partner-reports/orders/export', auth, partnerReportsController.ordersExport);
router.get('/partner-reports/commissions', auth, partnerReportsController.commissionsReport);
router.get('/partner-reports/commissions/export', auth, partnerReportsController.commissionsExport);
router.get('/partner-reports/payouts', auth, partnerReportsController.payoutsReport);
router.get('/partner-reports/payouts/export', auth, partnerReportsController.payoutsExport);
router.get('/partner-reports/prospects', auth, partnerReportsController.prospectsReport);
router.get('/partner-reports/prospects/export', auth, partnerReportsController.prospectsExport);
router.get('/partner-reports/converted-clients', auth, partnerReportsController.convertedClientsReport);
router.get('/partner-reports/converted-clients/export', auth, partnerReportsController.convertedClientsExport);
router.get('/partner-reports/monthly-summary', auth, partnerReportsController.monthlySummaryReport);
router.get('/partner-reports/monthly-summary/export', auth, partnerReportsController.monthlySummaryExport);


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
router.post("/dailyPriceExcelUpdate", forms1, PriceController.updatePriceExcel);

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
router.get('/getWatchlist', stocksGetController.getWatchlist)


// Chart Data APIS
router.post("/chartBulkUpload", forms1, PriceController.chartBulkUpload)
router.post("/chartSingleUpload", forms1, PriceController.chartSingleUpload)
router.get("/stockPriceChart", PriceController.getStockPriceChartData);
router.get("/getStockLatestPrice", PriceController.getStockLatestPrice);

// FAQ APIS
router.post('/faq', auth, forms, faqController.addUpdateFaq);
router.get('/faq', faqController.getFaq);

// Blog APIS
router.post('/blog', auth, imageUpload, blogController.addUpdateBlog);
router.post('/draftUndraftBlog', auth,blogController.draftUndraftBlog);
router.get('/blog', blogController.getBlog);
router.post('/Keyword', auth,forms, blogController.addUpdateKeyword);
router.get('/Keyword', blogController.getKeywords);
router.get('/relatedBloags', blogController.RelatedBlog);
router.post('/blogBanner', auth, imageUpload, blogController.addBlogBanner);
router.get('/blogBanner', blogController.getLatestBlogBanner);
router.post("/addBlogView", blogController.addBlogView);

//Partner APIS
router.get('/Partners', auth, partnerController.getPartners);
router.get('/getPartnerBanks', auth, partnerController.getPartnerBanks);
router.post('/partnerProfileUpdate', auth, imageUpload, partnerController.updatePartnerProfile);
router.post('/PartnerProfileCreateUpdate', auth, imageUpload, partnerController.PartnerProfileCreateUpdate);
router.get('/PartnersFinancialInfo', auth, partnerController.getPartnersFinancialInfo);
router.post('/partnerFinancialInformation', auth,imageUpload, partnerController.updatePartnerFinancialInformation);
router.post('/updatePartnerBankInformation', auth,imageUpload, partnerController.updatePartnerBankInformation);
router.post('/updatePartnerProspectInformation', auth,imageUpload, partnerController.updatePartnerProspectInformation);
router.get('/getPartnerProspects',auth, partnerController.getPartnerProspects);
router.get('/getPartnerProspectsIndividual',auth, partnerController.getPartnerProspectsIndividual);
router.post('/createPartnerOrder', auth, forms, partnerController.createPartnerOrder);
router.get('/getPartnerOrders', auth, partnerController.getPartnerOrders);
router.post('/OrderCommissionAdd', auth, imageUpload, partnerController.addPartnerCommission);
router.get('/getOrderCommissionPartner', auth, partnerController.getOrderCommissionPartner);
router.get('/CountPartnerLeadAndProspects', auth, partnerController.CountPartnerLeadAndProspects);
router.post('/updatePartnerKycStatus', auth, forms, partnerController.updatePartnerKycStatus);
router.post('/updateFranchiseAgreement', auth,imageUpload, partnerController.updateFranchiseAgreement);
router.post('/createPartnerAdmin', auth, imageUpload, partnerController.createPartnerAdmin);
router.post('/verifyPartnerBank', auth, forms, partnerController.verifyPartnerBank);
router.post('/PartnerKycUpdate', auth, imageUpload, partnerController.PartnerKycUpdate);

export default router;