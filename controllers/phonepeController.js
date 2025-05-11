const axios = require("axios");
const Order = require("../models/Order");
const { bookShipment } = require("./shippingController");
const { sendOrderConfirmationEmail } = require("../service/emailService");

const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION;
const PHONEPE_API_URL = "https://api.phonepe.com/apis/identity-manager";
const PHONEPE_PG_URL = "https://api.phonepe.com/apis/pg";

async function generateUnique6DigitOrderId() {
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const orderId = Math.floor(100000 + Math.random() * 900000).toString();
        const existingOrder = await Order.findOne({ orderId });
        if (!existingOrder) {
            console.log(`PhonePe - Generated unique orderId: ${orderId}`);
            return orderId;
        }
        console.log(`PhonePe - Collision detected for orderId: ${orderId}, retrying (${attempt}/${maxRetries})`);
    }
    const lastOrder = await Order.findOne().sort({ orderId: -1 });
    let newOrderId = lastOrder && lastOrder.orderId ? (parseInt(lastOrder.orderId) + 1).toString() : "100000";
    if (parseInt(newOrderId) > 999999) {
        throw new Error("Order ID range exhausted. Please implement a new ID strategy.");
    }
    console.log(`PhonePe - Fallback to incremental orderId: ${newOrderId}`);
    return newOrderId;
}

async function fetchAuthToken() {
  const url = `${PHONEPE_API_URL}/v1/oauth/token`;
  const params = new URLSearchParams({
    client_id: PHONEPE_CLIENT_ID,
    client_version: PHONEPE_CLIENT_VERSION,
    client_secret: PHONEPE_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  try {
    const response = await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log("PhonePe - Auth Token Response:", {
      accessToken: response.data.access_token.slice(0, 10) + "...",
      expiresAt: response.data.expires_at,
    });
    return {
      accessToken: response.data.access_token,
      expiresAt: response.data.expires_at,
    };
  } catch (error) {
    console.error("PhonePe - Error fetching auth token:", {
      message: error.message,
      stack: error.stack,
    });
    if (error.response) {
      console.error("PhonePe - Error Response:", JSON.stringify(error.response.data, null, 2));
    }
    throw new Error("Failed to fetch auth token");
  }
}

const validateOrderData = (body) => {
  const requiredFields = [
    "products",
    "shippingAddress",
    "billingAddress",
    "paymentMethod",
    "desPincode",
    "consignments",
    "totalAmount",
    "shippingCost",
  ];
  for (const field of requiredFields) {
    if (!body[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (!Array.isArray(body.products) || body.products.length === 0) {
    throw new Error("Products array is empty or invalid");
  }
};

exports.initiatePhonePePayment = async (req, res) => {
  console.log("Backend - Entering initiatePhonePePayment");
  console.log("Backend - Request Body:", JSON.stringify(req.body, null, 2));
  console.log("Backend - req.user:", req.user);

  if (!req.user || !req.user.id) {
    console.error("Backend - Authentication failed: No user found");
    return res.status(401).json({ success: false, error: "User not authenticated" });
  }

  const {
    products,
    shippingAddress,
    billingAddress,
    totalAmount,
    shippingCost,
    discountAmount = 0,
    paymentMethod,
    desPincode,
    consignments,
    couponCode,
    saveAddress,
  } = req.body;
  const customerId = req.user.id;

  try {
    validateOrderData(req.body);
    const orderId = await generateUnique6DigitOrderId();
    console.log(`Backend - Generated orderId: ${orderId}`);

    const payableAmount = Math.max(0, totalAmount + shippingCost - discountAmount);

    const order = new Order({
      orderId,
      customer: customerId,
      products,
      totalAmount,
      shippingCost,
      discountAmount,
      shippingAddress,
      billingAddress,
      paymentMethod: "PhonePe",
      status: "Pending Payment",
      paymentStatus: "Initiated",
      payableAmount,
      couponCode,
      saveAddress,
    });

    await order.save();
    console.log("Backend - Order saved:", orderId);

    const { accessToken } = await fetchAuthToken();

    const payload = {
      merchantOrderId: orderId,
      amount: Math.round(payableAmount * 100),
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Payment for order ${orderId}`,
        merchantUrls: {
          redirectUrl: `${process.env.BACKEND_URL}/api/phonepe/verify-phonepe?orderId=${orderId}`,
        },
      },
    };

    console.log("Backend - PhonePe Payload:", JSON.stringify(payload, null, 2));

    const url = `${PHONEPE_PG_URL}/checkout/v2/pay`;
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${accessToken}`,
      },
    });

    console.log("Backend - PhonePe Response:", JSON.stringify({
      orderId: response.data.orderId,
      state: response.data.state,
      redirectUrl: response.data.redirectUrl,
      expireAt: response.data.expireAt,
    }, null, 2));

    const redirectUrl = response.data.redirectUrl;
    if (redirectUrl) {
      return res.status(200).json({ success: true, orderId, paymentUrl: redirectUrl });
    }
    throw new Error("No redirect URL received from PhonePe");
  } catch (error) {
    console.error("Backend - Payment error:", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyPhonePePayment = async (orderId, retries = 10, delay = 3000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`PhonePe - Verifying payment for orderId: ${orderId} (Attempt ${attempt}/${retries})`);
      const { accessToken } = await fetchAuthToken();
      const url = `${PHONEPE_PG_URL}/checkout/v2/order/${orderId}/status`;

      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `O-Bearer ${accessToken}`,
        },
      });

      console.log("PhonePe - Payment Status Response:", JSON.stringify({
        state: response.data.state,
        amount: response.data.amount,
        transactionId: response.data.paymentDetails?.[0]?.transactionId,
      }, null, 2));

      const transactionId = response.data.paymentDetails?.[0]?.transactionId || orderId;
      const result = {
        success: response.data.state === "COMPLETED",
        state: response.data.state,
        transactionId: transactionId,
        amount: response.data.amount / 100,
      };
      console.log("PhonePe - Payment verification result:", result);
      return result;
    } catch (error) {
      console.error(`PhonePe - Error verifying payment (Attempt ${attempt}/${retries}):`, {
        message: error.message,
        stack: error.stack,
      });
      if (error.response) {
        console.error("PhonePe - Error Response:", JSON.stringify(error.response.data, null, 2));
      }
      if (attempt === retries) {
        console.error("PhonePe - Max retries reached for payment verification");
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

exports.verifyPhonePePaymentCallback = async (req, res) => {
  const { orderId } = req.query;
  console.log("PhonePe - Callback invoked with query:", req.query);
  console.log("PhonePe - Callback headers:", req.headers);
  console.log("PhonePe - Request URL:", req.originalUrl);

  if (!orderId) {
    console.error("PhonePe - Callback failed: No orderId provided");
    return res.redirect(`${process.env.FRONTEND_URL}/order-failure?error=NoOrderId`);
  }

  try {
    console.log("PhonePe - FRONTEND_URL:", process.env.FRONTEND_URL);
    if (!process.env.FRONTEND_URL) {
      throw new Error("FRONTEND_URL is not defined in environment variables");
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      console.error("PhonePe - Callback failed: Order not found for orderId:", orderId);
      return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(orderId)}&error=OrderNotFound`);
    }

    const paymentVerified = await exports.verifyPhonePePayment(orderId);
    console.log("PhonePe - Payment verification result:", paymentVerified);

    const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      order.status = "Processing";
      order.paymentStatus = "Paid";
      order.transactionId = paymentVerified.transactionId;
      console.log("PhonePe - Saving order update:", { orderId, status: order.status, paymentStatus: order.paymentStatus });
      await order.save();

      try {
        const { trackingNumber } = await bookShipment(orderId, order);
        order.trackingNumber = trackingNumber;
        console.log("PhonePe - Saving tracking number:", { orderId, trackingNumber });
        await order.save();
      } catch (shipmentError) {
        console.error("PhonePe - Shipment booking failed:", {
          message: shipmentError.message,
          stack: shipmentError.stack,
        });
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
        console.error("PhonePe - Failed to send confirmation email:", {
          message: emailError.message,
          stack: emailError.stack,
        });
      });

      const redirectUrl = `${process.env.FRONTEND_URL}/order-confirmation?orderId=${encodeURIComponent(
        orderId
      )}&transactionId=${encodeURIComponent(paymentVerified.transactionId)}&status=success`;
      console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    } else if (paymentVerified.state === "FAILED") {
      order.status = "Failed";
      order.paymentStatus = "Failed";
      await order.save();
      console.log(`PhonePe - Order marked as failed: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
      return res.redirect(
        `${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(orderId)}&error=PaymentFailed&reason=${encodeURIComponent(
          paymentVerified.reason || "Payment failed"
        )}`
      );
    } else {
      order.status = "Pending";
      order.paymentStatus = "Pending";
      await order.save();
      console.log(`PhonePe - Order remains pending: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
      const redirectUrl = `${process.env.FRONTEND_URL}/checkout?orderId=${encodeURIComponent(orderId)}&status=pending`;
      console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    }
  } catch (error) {
    console.error("PhonePe - Error in callback:", {
      message: error.message,
      stack: error.stack,
      orderId,
    });
    const redirectUrl = `${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(
      orderId
    )}&error=${encodeURIComponent(error.message)}`;
    console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  }
};

exports.checkPaymentStatus = async (req, res) => {
  const { orderId } = req.query;
  console.log("PhonePe - Checking payment status for orderId:", orderId);

  if (!orderId) {
    console.error("PhonePe - No orderId provided for status check");
    return res.status(400).json({ success: false, error: "Order ID is required" });
  }

  try {
    const order = await Order.findOne({ orderId });
    if (!order) {
      console.error("PhonePe - Order not found for status check:", orderId);
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const paymentVerified = await exports.verifyPhonePePayment(orderId);
    console.log("PhonePe - Payment verification result:", paymentVerified);

    const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      if (order.paymentStatus !== "Paid") {
        order.status = "Processing";
        order.paymentStatus = "Paid";
        order.transactionId = paymentVerified.transactionId;

        if (!order.trackingNumber) {
          try {
            const { trackingNumber } = await bookShipment(orderId, order);
            order.trackingNumber = trackingNumber;
            console.log("PhonePe - Assigned tracking number:", { orderId, trackingNumber });
          } catch (shipmentError) {
            console.error("PhonePe - Shipment booking failed in checkPaymentStatus:", {
              message: shipmentError.message,
              stack: shipmentError.stack,
            });
          }
        }
        await order.save();
        console.log("PhonePe - Order updated in checkPaymentStatus:", {
          orderId,
          status: order.status,
          paymentStatus: order.paymentStatus,
        });

        await sendOrderConfirmationEmail(
          orderId,
          order.shippingAddress.email,
          order.totalAmount,
          order.shippingCost,
          order.trackingNumber,
          paymentVerified.transactionId,
          payableAmount
        ).catch((emailError) => {
          console.error("PhonePe - Failed to send confirmation email in checkPaymentStatus:", {
            message: emailError.message,
            stack: emailError.stack,
          });
        });
      }

      return res.json({
        success: true,
        status: "success",
        orderId,
        transactionId: paymentVerified.transactionId,
        trackingNumber: order.trackingNumber,
        redirectUrl: `${process.env.FRONTEND_URL}/order-confirmation?orderId=${encodeURIComponent(
          orderId
        )}&transactionId=${encodeURIComponent(paymentVerified.transactionId)}&status=success`,
      });
    } else if (paymentVerified.state === "FAILED") {
      order.status = "Failed";
      order.paymentStatus = "Failed";
      await order.save();
      console.log("PhonePe - Order marked as failed in checkPaymentStatus:", {
        orderId,
        paymentStatus: order.paymentStatus,
      });
      return res.json({
        success: false,
        status: "failed",
        orderId,
        reason: paymentVerified.reason || "Payment failed",
      });
    } else {
      console.log("PhonePe - Payment still pending in checkPaymentStatus:", { orderId });
      return res.json({
        success: false,
        status: "pending",
        orderId,
      });
    }
  } catch (error) {
    console.error("PhonePe - Error checking payment status:", {
      message: error.message,
      stack: error.stack,
      orderId,
    });
    return res.status(500).json({ success: false, error: error.message });
  }
};