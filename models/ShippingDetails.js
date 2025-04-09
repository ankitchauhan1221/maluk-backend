const mongoose = require("mongoose");

const shippingDetailsSchema = new mongoose.Schema({
  city: String,
  state: String,
  destinationPincode: { type: String, unique: true },
  destinationCategory: String,
  serviceable: String,
});

module.exports = mongoose.model("ShippingDetails", shippingDetailsSchema);