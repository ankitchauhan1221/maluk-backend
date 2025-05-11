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

// Public Shipping Routes (no authentication required)
router.get("/cities", getCities);
router.get("/states", getStates);
router.post("/pincode-details", getPincodeDetails);
router.post("/verify-pincode", verifyPincode);

// Protected Shipping Routes (require authentication)
router.post("/:orderId/cancel", authMiddleware, cancelOrder);
router.post("/book-shipment", authMiddleware, bookShipment);
router.post("/tracking/update", receiveTrackingUpdate);

module.exports = router;