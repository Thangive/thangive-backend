import crypto from "crypto";


class CryptoService {
   static generateApiKey = () => {
        const apiKey = crypto.createHash('sha256').update("adisTechnology").digest('hex');
        return apiKey;
    }
}


// curently going on key is :- 305955a537246bc59f30a8aad90c53458d47690300287ff130a0cd968e5c0a58

export default CryptoService;