const mongoose = require("mongoose");

const SubcategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  productCount: { type: Number, default: 0 } ,// ✅ Add this field
  status: { type: String, enum: ['active', 'inactive'], default: 'active' }, // Category status

},{ timestamps: true }); 

module.exports = mongoose.model("Subcategory", SubcategorySchema);
