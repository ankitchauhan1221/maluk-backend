const express = require('express');
const router = express.Router();
const { addProduct, updateProduct, deleteProduct, getAllProducts, getProductById, getProductsByCategory,  addReview} = require('../controllers/productController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/multer'); 
// Get all products
router.get('/', getAllProducts);

router.get('/:id', getProductById);

router.get('/by-category/:categoryId', getProductsByCategory);

// Add a new product (Admin only)
router.post('/add', authMiddleware, adminMiddleware, upload, addProduct); // Use upload directly

// Update a product (Admin only) - Also handles image updates
router.put('/:id', authMiddleware, adminMiddleware, upload, updateProduct); // Use same upload for consistency

// Delete a product (Admin only)
router.delete('/:id', authMiddleware, adminMiddleware, deleteProduct);

// review route
router.post('/:id/reviews', authMiddleware, addReview);

module.exports = router;