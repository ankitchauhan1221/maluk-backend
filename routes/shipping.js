const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  getCities,
  getStates,
  getPincodeDetails,
  verifyPincode,
  bookShipment,
  cancelOrder,
  receiveTrackingUpdate,
} = require("../controllers/shippingController");

// Shipping Routes
router.get("/cities", authMiddleware, getCities);
router.post("/:orderId/cancel", authMiddleware, cancelOrder);
router.get("/states", authMiddleware, getStates);
router.post("/pincode-details", authMiddleware, getPincodeDetails);
router.post("/verify-pincode", authMiddleware, verifyPincode);
router.post("/book-shipment", authMiddleware, bookShipment);
router.post("/tracking/update", authMiddleware, receiveTrackingUpdate);


module.exports = router;