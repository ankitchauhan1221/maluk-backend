const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  discountValue: { type: Number, default: 0 },
  minOrderAmount: { type: Number, default: 0 },
  maxDiscountAmount: { type: Number, default: 0 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active' },
  usageLimit: { type: Number, default: null },
  usedCount: { type: Number, default: 0 },
  firstTimeUsersOnly: { type: Boolean, default: false },
  couponType: {
    type: String,
    enum: ['standard', 'buy_x_get_y', 'combo', 'same_product_discount'],
    default: 'standard',
  },
  buyQuantity: { type: Number, default: 0 }, // For Buy X Get Y: number of items to buy
  getQuantity: { type: Number, default: 0 }, // For Buy X Get Y: number of free items
  requiredQuantity: { type: Number, default: 0 }, // For Same Product Discount: minimum quantity of same product
  applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  userUsage: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      used: { type: Boolean, default: false },
    },
  ],
}, { timestamps: true });

// Pre-save hook to update status if expired
couponSchema.pre('save', function (next) {
  const currentDate = new Date();
  const endDate = new Date(this.endDate);
  if (currentDate > endDate && this.status !== 'expired') {
    this.status = 'expired';
  }
  next();
});

module.exports = mongoose.model('Coupon', couponSchema);