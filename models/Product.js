const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  saleprice: { type: Number, required: true }, // Fixed 'require' to 'required'
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory' },
  thumbnails: [{ type: String }],
  gallery: [{ type: String }],
  sku: { type: String, required: true },
  stock: { type: Number, default: 0 },
  specifications: { type: String, default: '' }, 
  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
}, { timestamps: true });

// Create index for slug field for faster queries
productSchema.index({ slug: 1 });

module.exports = mongoose.model('Product', productSchema);
