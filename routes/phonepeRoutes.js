const express = require("express");
const router = express.Router();
const { initiatePhonePePayment, verifyPhonePePaymentCallback, checkPaymentStatus } = require("../controllers/phonepeController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/initiate-phonepe", authMiddleware, initiatePhonePePayment);
router.get("/verify-phonepe", verifyPhonePePaymentCallback);
router.get("/check-payment-status", checkPaymentStatus);

module.exports = router;