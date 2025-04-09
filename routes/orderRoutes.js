const express = require("express");
const router = express.Router();
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");
const {
  createOrder,
  // confirmOrder,
  getOrderHistory,
  requestOrderCancellation,
  getAllOrders,
  getOrderById,
} = require("../controllers/orderController");

// Order Routes
router.post("/create-order", authMiddleware, createOrder);
// router.post("/confirm-order", authMiddleware, confirmOrder);
router.get("/history", authMiddleware, getOrderHistory);
router.post("/request-cancellation", authMiddleware, requestOrderCancellation);
router.get("/all-orders", [authMiddleware, adminMiddleware], getAllOrders);
router.get("/:orderId", getOrderById);

module.exports = router;