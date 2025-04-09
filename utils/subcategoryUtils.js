const Subcategory = require('../models/Subcategory');
const Product = require('../models/Product');

exports.updateProductCountInSubcategory = async (subcategoryId) => {
  try {
    const productCount = await Product.countDocuments({ subcategory: subcategoryId });
    await Subcategory.findByIdAndUpdate(subcategoryId, { productCount });
  } catch (err) {
    console.error('Error updating product count in subcategory:', err);
  }
};