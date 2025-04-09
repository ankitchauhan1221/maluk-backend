const axios = require("axios");
const Order = require("../models/Order");
const { bookShipment } = require("./shippingController");
const { sendOrderConfirmationEmail } = require("../service/emailService");

const PHONEPE_MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "TESTVVUAT";
const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "TESTVVUAT_2502041721357207510164";
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "ZTcxNDQyZjUtZjQ3Mi00MjJmLTgzOWYtMWZmZWQ2ZjdkMzVi";
const PHONEPE_API_URL = process.env.PHONEPE_API_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";

let authToken = null;
let tokenExpiresAt = null;

async function getAuthToken() {
  try {
    const url = `${PHONEPE_API_URL}/v1/oauth/token`;
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const payload = new URLSearchParams({
      client_id: PHONEPE_CLIENT_ID,
      client_version: "1",
      client_secret: PHONEPE_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const response = await axios.post(url, payload, { headers });
    authToken = response.data.access_token;
    tokenExpiresAt = response.data.expires_at;
    console.log("PhonePe - Auth Token Obtained:", authToken);
    return authToken;
  } catch (error) {
    console.error("PhonePe - Error getting auth token:", error.message);
    throw error;
  }
}

async function ensureValidToken() {
  const currentTime = Math.floor(Date.now() / 1000);
  if (!authToken || currentTime >= tokenExpiresAt - 60) {
    return await getAuthToken();
  }
  return authToken;
}

async function generateNumericOrderId() {
  const year = new Date().getFullYear().toString().slice(-2); // e.g., "25" for 2025
  const lastOrder = await Order.findOne({ orderId: { $regex: `^${year}` } }).sort({ orderId: -1 });
  let nextNumber = lastOrder ? parseInt(lastOrder.orderId.slice(2)) + 1 : 1;
  const sequence = nextNumber.toString().padStart(5, "0"); // 5-digit sequence
  return `${year}${sequence}`; // e.g., "2500001"
}

exports.initiatePhonePePayment = async (req, res) => {
  console.log("Route - Entering initiate-payment");
  console.log("PhonePe - Request Body:", JSON.stringify(req.body, null, 2));
  console.log("PhonePe - req.user:", req.user);

  if (!req.user || !req.user.id) {
    console.log("PhonePe - Authentication failed: No user found in request");
    return res.status(401).json({ success: false, error: "User not authenticated" });
  }

  const {
    products,
    shippingAddress,
    billingAddress,
    totalAmount,
    shippingCost,
    couponCode,
    discountAmount = 0, // Default to 0 if not provided
    orgPincode,
    desPincode,
    consignments,
    paymentMethod,
    saveAddress,
  } = req.body;
  const customerId = req.user.id;

  if (!products || !Array.isArray(products)) {
    console.log("PhonePe - Validation failed: Products array is missing or invalid");
    return res.status(400).json({ success: false, error: "Products array is required" });
  }

  if (typeof totalAmount !== "number" || typeof shippingCost !== "number" || typeof discountAmount !== "number") {
    console.log("PhonePe - Validation failed: Invalid numeric values");
    return res.status(400).json({ success: false, error: "Total amount, shipping cost, and discount must be numbers" });
  }

  try {
    const orderId = await generateNumericOrderId(); // 7-digit numeric ID (e.g., "2500001")
    const payableAmount = Math.max(0, totalAmount + shippingCost - discountAmount); // Calculate discounted amount

    if (payableAmount < 1) {
      console.log("PhonePe - Validation failed: Payable amount too low");
      return res.status(400).json({ success: false, error: "Payable amount must be at least ₹1" });
    }

    const order = new Order({
      orderId,
      customer: customerId,
      products,
      totalAmount,
      shippingCost,
      couponCode: couponCode || null,
      discountAmount,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      paymentMethod: paymentMethod || "PhonePe",
      status: "Pending Payment",
      paymentStatus: "Initiated",
      consignments: consignments || [],
      payableAmount, // Store payableAmount in the order
    });

    await order.save();
    console.log(`Order - Order stored with orderId: ${orderId}, Payable Amount: ${payableAmount}`);

    const payload = {
      merchantOrderId: orderId,
      amount: Math.round(payableAmount * 100), // Use discounted amount in paise
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Payment for order",
        merchantUrls: {
          redirectUrl: `${process.env.BACKEND_URL}/api/phonepe/verify-phonepe?orderId=${orderId}`,
        },
      },
    };

    await ensureValidToken();
    const url = `${PHONEPE_API_URL}/checkout/v2/pay`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${authToken}`,
    };

    console.log("PhonePe - Sending payload to PhonePe:", JSON.stringify(payload, null, 2));
    const response = await axios.post(url, payload, { headers });
    console.log("PhonePe - API Response:", JSON.stringify(response.data, null, 2));

    if (response.status === 200 && response.data.redirectUrl) {
      console.log("PhonePe - Payment URL generated:", response.data.redirectUrl);
      return res.json({ success: true, orderId, paymentUrl: response.data.redirectUrl });
    }
    throw new Error("Payment initiation failed: No redirect URL in response");
  } catch (error) {
    console.error("PhonePe - Error initiating payment:", error.message);
    if (error.response?.status === 400) {
      console.error("PhonePe - Bad Request Details:", error.response.data);
      return res.status(400).json({ success: false, error: error.response.data.message || "Bad request to PhonePe API" });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyPhonePePayment = async (orderId) => {
  try {
    await ensureValidToken();
    const url = `${PHONEPE_API_URL}/checkout/v2/order/${orderId}/status?details=true`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${authToken}`,
    };

    const response = await axios.get(url, { headers });
    console.log("PhonePe - Payment Status Response:", JSON.stringify(response.data, null, 2));

    const transactionId = response.data.paymentDetails?.[0]?.transactionId || response.data.orderId || orderId;
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