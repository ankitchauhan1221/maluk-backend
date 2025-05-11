const mongoose = require("mongoose");

const shippingDetailsSchema = new mongoose.Schema({
  destinationPincode: { type: String, unique: true },
  city: String,
  state: String,
  prepaid: String, // 'Y' or 'N'
  cod: String, // 'Y' or 'N'
  pudoServiceable: String, // 'Y' or 'N'
  b2cCodServiceable: String, // 'Y' or 'N'
  destinationCategory: String, // Add destinationCategory
});

module.exports = mongoose.model("ShippingDetails", shippingDetailsSchema);