const axios = require("axios");
const Order = require("../models/Order");
const { bookShipment } = require("./shippingController");
const { sendOrderConfirmationEmail } = require("../service/emailService");

// Environment variables (PROD only)
const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION; // Required for PROD, from credentials email
const PHONEPE_API_URL = "https://api.phonepe.com/apis/identity-manager"; // PROD Auth URL
const PHONEPE_PG_URL = "https://api.phonepe.com/apis/pg"; // PROD PG URL

// Utility to generate numeric order ID
async function generateNumericOrderId() {
  const year = new Date().getFullYear().toString().slice(-2); // e.g., "25" for 2025
  const lastOrder = await Order.findOne({ orderId: { $regex: `^${year}` } }).sort({ orderId: -1 });
  let nextNumber = lastOrder ? parseInt(lastOrder.orderId.slice(2)) + 1 : 1;
  const sequence = nextNumber.toString().padStart(5, "0"); // 5-digit sequence
  return `${year}${sequence}`; // e.g., "2500001"
}

// Fetch Auth Token (PROD)
async function fetchAuthToken() {
  const url = `${PHONEPE_API_URL}/v1/oauth/token`;
  const params = new URLSearchParams({
    client_id: PHONEPE_CLIENT_ID,
    client_version: PHONEPE_CLIENT_VERSION, // Use the value from your credentials email
    client_secret: PHONEPE_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  try {
    const response = await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return {
      accessToken: response.data.access_token,
      expiresAt: response.data.expires_at,
    };
  } catch (error) {
    console.error("PhonePe - Error fetching auth token:", error.message);
    throw new Error("Failed to fetch auth token");
  }
}

exports.initiatePhonePePayment = async (req, res) => {
  console.log("Backend - Entering initiatePhonePePayment");
  console.log("Backend - Request Body:", JSON.stringify(req.body, null, 2));
  console.log("Backend - req.user:", req.user);

  if (!req.user || !req.user.id) {
    console.log("Backend - Authentication failed: No user found");
    return res.status(401).json({ success: false, error: "User not authenticated" });
  }

  const { products, shippingAddress, totalAmount, shippingCost, discountAmount = 0 } = req.body;
  const customerId = req.user.id;

  if (!products || !Array.isArray(products)) {
    console.log("Backend - Validation failed: Products array missing or invalid");
    return res.status(400).json({ success: false, error: "Products array is required" });
  }

  try {
    const orderId = await generateNumericOrderId();
    const payableAmount = Math.max(0, totalAmount + shippingCost - discountAmount);

    const order = new Order({
      orderId,
      customer: customerId,
      products,
      totalAmount,
      shippingCost,
      discountAmount,
      shippingAddress,
      billingAddress: shippingAddress,
      paymentMethod: "PhonePe",
      status: "Pending Payment",
      paymentStatus: "Initiated",
      payableAmount,
    });
    await order.save();
    console.log("Backend - Order saved:", orderId);

    // Fetch auth token
    const { accessToken } = await fetchAuthToken();

    const payload = {
      merchantOrderId: orderId,
      amount: Math.round(payableAmount * 100), // In paise
      expireAfter: 1200, // 20 minutes default
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Payment for order " + orderId,
        merchantUrls: {
          redirectUrl: `${process.env.BACKEND_URL}/api/phonepe/verify-phonepe?orderId=${orderId}`,
        },
      },
    };

    const url = `${PHONEPE_PG_URL}/checkout/v2/pay`;
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${accessToken}`,
      },
    });

    console.log("Backend - PhonePe Response:", JSON.stringify(response.data, null, 2));

    const redirectUrl = response.data.redirectUrl;
    if (redirectUrl) {
      return res.status(200).json({ success: true, orderId, paymentUrl: redirectUrl });
    }
    throw new Error("No redirect URL received from PhonePe");
  } catch (error) {
    console.error("Backend - Payment error:", error.message);
    if (error.response) {
      console.error("Backend - PhonePe Error Data:", JSON.stringify(error.response.data, null, 2));
      return res.status(400).json({ success: false, error: error.response.data.message || "Bad request to PhonePe API" });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyPhonePePayment = async (orderId) => {
  try {
    const { accessToken } = await fetchAuthToken();
    const url = `${PHONEPE_PG_URL}/checkout/v2/order/${orderId}/status`;

    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${accessToken}`,
      },
    });

    console.log("PhonePe - Payment Status Response:", JSON.stringify(response.data, null, 2));

    const transactionId = response.data.paymentDetails[0]?.transactionId || orderId;
    return {
      success: response.data.state === "COMPLETED",
      state: response.data.state,
      transactionId: transactionId,
      amount: response.data.amount / 100, // Convert back to rupees
    };
  } catch (error) {
    console.error("PhonePe - Error verifying payment:", error.message);
    throw error;
  }
};

exports.verifyPhonePePaymentCallback = async (req, res) => {
  const { orderId } = req.query;
  console.log("PhonePe - Callback received with query:", req.query);

  if (!orderId) {
    console.log("PhonePe - Callback failed: No orderId provided");
    return res.redirect(`${process.env.FRONTEND_URL}/order-failure?error=NoOrderId`);
  }

  try {
    const order = await Order.findOne({ orderId });
    if (!order) {
      console.log("PhonePe - Callback failed: Order not found for orderId:", orderId);
      return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${orderId}&error=OrderNotFound`);
    }

    const paymentVerified = await exports.verifyPhonePePayment(orderId);
    const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      order.status = "Processing";
      order.paymentStatus = "Paid";
      order.transactionId = paymentVerified.transactionId;
      await order.save();
      console.log(`PhonePe - Order updated: ${orderId}, Status: ${order.status}, PaymentStatus: ${order.paymentStatus}`);

      try {
        const { trackingNumber } = await bookShipment(orderId, order);
        order.trackingNumber = trackingNumber;
        await order.save();
        console.log(`PhonePe - Shipment booked for order: ${orderId}, Tracking: ${trackingNumber}`);
      } catch (shipmentError) {
        console.error("PhonePe - Shipment booking failed:", shipmentError.message);
      }

      await sendOrderConfirmationEmail(
        orderId,
        order.shippingAddress.email,
        order.totalAmount,
        order.shippingCost,
        order.trackingNumber,
        paymentVerified.transactionId,
        payableAmount
      ).catch((emailError) => {
        console.error("PhonePe - Failed to send confirmation email:", emailError.message);
      });

      const redirectUrl = `${process.env.FRONTEND_URL}/order-confirmation?orderId=${orderId}&transactionId=${paymentVerified.transactionId}&status=${order.status.toLowerCase()}`;
      console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    } else if (paymentVerified.state === "FAILED") {
      order.status = "Failed";
      order.paymentStatus = "Failed";
      await order.save();
      console.log(`PhonePe - Order marked as failed: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
      return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${orderId}&error=PaymentFailed®ion=${encodeURIComponent(order.shippingAddress.state)}`);
    } else {
      order.status = "Pending";
      order.paymentStatus = "Pending";
      await order.save();
      console.log(`PhonePe - Order remains pending: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
      return res.redirect(`${process.env.FRONTEND_URL}/checkout?orderId=${orderId}&status=pending`);
    }
  } catch (error) {
    console.error("PhonePe - Error in callback:", error.message);
    return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${orderId}&error=${encodeURIComponent(error.message)}`);
  }
};

exports.checkPaymentStatus = async (req, res) => {
  const { orderId } = req.query;
  console.log("PhonePe - Checking payment status for orderId:", orderId);

  if (!orderId) {
    return res.status(400).json({ success: false, error: "Order ID is required" });
  }

  try {
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const paymentVerified = await exports.verifyPhonePePayment(orderId);
    const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      order.status = "Processing";
      order.paymentStatus = "Paid";
      order.transactionId = paymentVerified.transactionId;

      if (!order.trackingNumber) {
        const { trackingNumber } = await bookShipment(orderId, order);
        order.trackingNumber = trackingNumber;
      }
      await order.save();

      await sendOrderConfirmationEmail(
        orderId,
        order.shippingAddress.email,
        order.totalAmount,
        order.shippingCost,
        order.trackingNumber,
        paymentVerified.transactionId,
        payableAmount
      ).catch((emailError) => {
        console.error("PhonePe - Failed to send confirmation email in checkPaymentStatus:", emailError.message);
      });

      return res.json({
        success: true,
        status: "success",
        orderId,
        transactionId: paymentVerified.transactionId,
        trackingNumber: order.trackingNumber,
      });
    } else if (paymentVerified.state === "FAILED") {
      order.status = "Failed";
      order.paymentStatus = "Failed";
      await order.save();
      return res.json({ success: false, status: "failed", region: order.shippingAddress.state });
    } else {
      order.paymentStatus = "Pending";
      await order.save();
      return res.json({ success: false, status: "pending" });
    }
  } catch (error) {
    console.error("PhonePe - Error checking payment status:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  initiatePhonePePayment: exports.initiatePhonePePayment,
  verifyPhonePePayment: exports.verifyPhonePePayment,
  verifyPhonePePaymentCallback: exports.verifyPhonePePaymentCallback,
  checkPaymentStatus: exports.checkPaymentStatus,
};