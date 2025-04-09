const express = require('express');
const { addProduct, deleteProduct } = require('../controllers/adminController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

// Admin routes (protected by auth and admin middleware)
router.post('/products', authMiddleware, adminMiddleware, upload.array('images', 5), addProduct); // Add a product
router.delete('/products/:id', authMiddleware, adminMiddleware, deleteProduct); // Delete a product

module.exports = router;