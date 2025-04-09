const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // Category name
  status: { type: String, enum: ['active', 'inactive'], default: 'active' }, // Category status
  productCount: { type: Number, default: 0 }, // Number of products in the category
  subcategoryCount: { type: Number, default: 0 }, // Number of subcategories in the category
},{ timestamps: true });

module.exports = mongoose.model('Category', categorySchema);