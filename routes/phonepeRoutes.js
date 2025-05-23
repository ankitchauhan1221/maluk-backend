const express = require("express");
const router = express.Router();
const {
  initiatePhonePePayment,
  verifyPhonePePaymentCallback,
  checkPaymentStatus,
  checkRefundStatus,
} = require("../controllers/phonepeController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/initiate-payment", authMiddleware, initiatePhonePePayment);
router.get("/verify-phonepe", verifyPhonePePaymentCallback);
router.get("/check-payment-status", checkPaymentStatus);
router.get("/check-refund-status", authMiddleware, checkRefundStatus);

module.exports = router;