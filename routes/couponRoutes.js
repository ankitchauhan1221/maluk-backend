const express = require('express');
const { createCoupon, getAllCoupon, statusUpdate, applyCoupon, deleteCoupon, editCoupon } = require('../controllers/couponController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Create a coupon (Admin only)
router.post('/add', authMiddleware, adminMiddleware, createCoupon);
// Get All Coupons
router.get('/', authMiddleware, adminMiddleware, getAllCoupon);
// edit Update Coupon //
router.put('/:id', authMiddleware, adminMiddleware, editCoupon);
// Status "active", inactive //
router.patch('/:id/status', authMiddleware, adminMiddleware, statusUpdate)
// Apply a coupon
router.post('/apply', applyCoupon);
// Delete a coupon (Admin only)
router.delete('/:id', authMiddleware, adminMiddleware, deleteCoupon);

module.exports = router;