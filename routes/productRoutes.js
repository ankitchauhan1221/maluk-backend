const express = require('express');
const router = express.Router();
const { addProduct, updateProduct, deleteProduct, getAllProducts, getProductById, getProductsByCategory, addReview } = require('../controllers/productController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/multer');

// Get all products
router.get('/', getAllProducts);

// Get product by slug
router.get('/slug/:slug', getProductById);

// Get product by ID
router.get('/:id', getProductById);

// Get products by category (use slug only)
router.get('/by-category/:categorySlug', getProductsByCategory);

// Add a new product (Admin only)
router.post('/add', authMiddleware, adminMiddleware, upload, addProduct);

// Update a product (Admin only)
router.put('/:id', authMiddleware, adminMiddleware, upload, updateProduct);

// Delete a product (Admin only)
router.delete('/:id', authMiddleware, adminMiddleware, deleteProduct);

// Add a review
router.post('/:id/reviews', authMiddleware, addReview);

module.exports = router;