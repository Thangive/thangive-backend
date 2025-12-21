import express from 'express';
import multer from 'multer';
import { stocksCotrollers } from '../controllers/index.js';

const forms = multer().array();

const router = express.Router();

// User API
router.post('/stockDetails', stocksCotrollers.addUpdateStockDetails);



export default router;