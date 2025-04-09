const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastname: { type: String, required: true },
  companyName: { type: String },
  country: { type: String, required: true },
  streetAddress: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zip: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
});

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  products: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
      thumbnail: { type: String },
    },
  ],
  totalAmount: { type: Number, required: true }, // Subtotal before shipping and discount
  shippingCost: { type: Number, default: 0 },
  couponCode: { type: String, default: null },
  discountAmount: { type: Number, default: 0 },
  payableAmount: { type: Number, required: true, default: 0 }, // Final amount after discount (totalAmount + shippingCost - discountAmount)
  status: {
    type: String,
    enum: [
      'Pending',          // Order created, payment not initiated
      'Pending Payment',  // Payment initiated but not completed
      'Processing',       // Payment successful, order being prepared
      'Shipped',          // Order dispatched
      'Delivered',        // Order delivered
      'Cancelled',        // Order cancelled
      'Failed',           // Payment failed
    ],
    default: 'Pending',
  },
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed', 'Initiated'],
    default: 'Pending',
  },
  paymentMethod: { type: String, required: true },
  transactionId: { type: String }, // Optional: Store PhonePe transaction ID
  cancellationRequested: { type: Boolean, default: false },
  cancellationReason: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  reference_number: { type: String, default: '' }, // Added for Shipsy reference number
  trackingUpdates: [ 
    {
      action: { type: String }, // e.g., "BKD", "DLV", "NONDLV"
      actionDesc: { type: String }, // e.g., "Booked", "Delivered"
      origin: { type: String }, // Location name
      actionDate: { type: String }, // DDMMYYYY
      actionTime: { type: String }, // HHMM
      remarks: { type: String }, // Non-delivery reason
      latitude: { type: String },
      longitude: { type: String },
      manifestNo: { type: String },
      scdOtp: { type: String }, // Y/N
      ndcOtp: { type: String }, // Y/N
      trackingNumber: { type: String }, // Store DTDC/Shipsy shipment number
      updatedAt: { type: Date, default: Date.now },
    },
  ],
});

// Middleware to update `updatedAt` on save
orderSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);