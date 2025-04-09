const express = require('express');
const { 
  registerUser, 
  registerAdmin, 
  login, 
  logout, 
  updateUserStatus, 
  forgotPassword, 
  resetPassword, 
  getCurrentUser, 
  updateUser,

} = require('../controllers/authController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// User Registration (open to all)
router.post('/register/user', registerUser);

// Admin Registration (admin only)
router.post('/register/admin', authMiddleware, adminMiddleware, registerAdmin);

// Get Current User (authenticated users)
router.get('/user', authMiddleware, getCurrentUser);

// Update User Profile (authenticated users)
router.put('/user', authMiddleware, updateUser);

// Login (open to all)
router.post('/login', login);

// Update User Status (admin only)
router.put('/status/:id', authMiddleware, adminMiddleware, updateUserStatus);

// Forgot Password (open to all)
router.post('/forgot-password', forgotPassword);

// Reset Password (open to all, but requires valid reset token)
router.post('/reset-password', resetPassword);

// Logout (open to all, but expects tokens)
router.post('/logout', logout);

module.exports = router;