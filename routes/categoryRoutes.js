const express = require('express');
const router = express.Router();
const {
  createCategory,
  getAllCategories,
  editCategory,
  getCategoryBySlug,
  updateCategoryStatus,
  deleteCategory,
} = require('../controllers/categoryController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

router.post('/createcategory', authMiddleware, adminMiddleware, createCategory);
router.get('/', getAllCategories);
router.get('/slug/:slug', getCategoryBySlug);
router.put('/:id', authMiddleware, adminMiddleware, editCategory);
router.patch('/:id/status', authMiddleware, adminMiddleware, updateCategoryStatus);
router.delete('/:id', authMiddleware, adminMiddleware, deleteCategory);

module.exports = router;