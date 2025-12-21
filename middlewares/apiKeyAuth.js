import { CustomErrorHandler } from "../service/index.js";

// Middleware for API key verification
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers.authorization;

    if (!apiKey) {
        return next(CustomErrorHandler.wrongApi());
    }

    // Compare the apiKey with the stored API keys in your database or storage solution
    // Corrently api key is 305955a537246bc59f30a8aad90c53458d47690300287ff130a0cd968e5c0a58

    if (apiKey === '305955a537246bc59f30a8aad90c53458d47690300287ff130a0cd968e5c0a58') {
        // API key is valid, continue to the next middleware or route handler
        console.log("Api Key Verified");
        next();
    } else {
        // API key is invalid, return an error response
        return next(CustomErrorHandler.wrongApi());
    }

};

export default verifyApiKey;