const express = require("express");
const router = express.Router();
const {
  bookShipment,
  cancelOrder,
  getCities,
  getStates,
  getPincodeDetails,
  verifyPincode,
  receiveTrackingUpdate,
} = require("../controllers/shippingController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/book-shipment", authMiddleware, bookShipment); 
router.post("/cancel-order/:orderId", authMiddleware, cancelOrder);
router.get("/cities", getCities);
router.get("/states", getStates);
router.post("/pincode-details", getPincodeDetails);
router.post("/verify-pincode", verifyPincode);
router.post("/tracking/update", receiveTrackingUpdate);

module.exports = router;