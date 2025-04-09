const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // Coupon code
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true }, // Discount type
  discountValue: { type: Number, required: true }, // Discount value (e.g., 10 for 10% or ₹10)
  minOrderAmount: { type: Number, default: 0 }, // Minimum order amount to apply the coupon
  maxDiscountAmount: { type: Number }, // Maximum discount amount (for percentage discounts)
  startDate: { type: Date, required: true }, // Coupon start date
  endDate: { type: Date, required: true }, // Coupon expiry date
  status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active' },
  usageLimit: { type: Number, default: null }, // Total usage limit (null for unlimited)
  usedCount: { type: Number, default: 0 }, // Number of times the coupon has been used
}, { timestamps: true });

// Pre-save hook to update status if expired
couponSchema.pre('save', function (next) {
  if (new Date() > this.endDate && this.status !== 'expired') {
    this.status = 'expired';
  }
  next();
});

module.exports = mongoose.model('Coupon', couponSchema);