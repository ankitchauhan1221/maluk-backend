const express = require('express');
const {
  createCategory, 
  getAllCategories, 
  updateCategoryStatus, 
  editCategory, 
  deleteCategory,
  getCategoryById
} = require('../controllers/categoryController');
const {
  createSubcategory, 
  deleteSubcategory, 
  updateSubCategoryStatus, 
  editSubcategory, 
  getAllSubcategories
} = require('../controllers/subcategoryController'); 

const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();


// Create a category (Admin only)
router.post('/createcategory', authMiddleware, adminMiddleware, createCategory);

// Edit a category (Admin only)
router.put('/editCategory/:id', authMiddleware, adminMiddleware, editCategory);

router.get('/:id', getCategoryById)

// Get all categories (No authentication required)
router.get('/', getAllCategories);

// Update category status (Admin only)
router.put('/:id/status', authMiddleware, adminMiddleware, updateCategoryStatus);

// Delete a category (Admin only)
router.delete('/:id', authMiddleware, adminMiddleware, deleteCategory);


// Subcategory Routes //

// Create a subcategory (Admin only)
router.post('/createSubcategory', authMiddleware, adminMiddleware, createSubcategory);

// Edit a subcategory (Admin only)
router.put('/editSubcategory/:id', authMiddleware, adminMiddleware, editSubcategory);

// Get all subcategories (No authentication required)
router.get('/getAllSubCategories/', getAllSubcategories);

// Delete a subcategory (Admin only)
router.delete('/deleteSubcategory/:id', authMiddleware, adminMiddleware, deleteSubcategory);

// Update subcategory status (Admin only)
router.put('/:id/subStatus', authMiddleware, adminMiddleware, updateSubCategoryStatus);

module.exports = router;
