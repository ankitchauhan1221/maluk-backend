const express = require('express');
const { getProfile, updateProfile, getAllUsers} = require('../controllers/profileController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Get user profile
router.get('/', getProfile);

// Update user profile
router.put('/', authMiddleware, updateProfile);

// Get all user profiles (Admin only)
router.get('/all', authMiddleware, adminMiddleware, getAllUsers);

module.exports = router;