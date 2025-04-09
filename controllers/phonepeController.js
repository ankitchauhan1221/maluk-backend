const axios = require("axios");
const Order = require("../models/Order");
const { bookShipment } = require("./shippingController");
const transporter = require("../config/nodemailer");

const PHONEPE_MERCHANT_ID = "TESTVVUAT";
const PHONEPE_CLIENT_ID = "TESTVVUAT_2502041721357207510164";
const PHONEPE_CLIENT_SECRET = "ZTcxNDQyZjUtZjQ3Mi00MjJmLTgzOWYtMWZmZWQ2ZjdkMzVi";
const PHONEPE_API_URL = "https://api-preprod.phonepe.com/apis/pg-sandbox";

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
    discountAmount,
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

  try {
    const lastOrder = await Order.findOne().sort({ createdAt: -1 });
    const nextNumber = lastOrder ? parseInt(lastOrder.orderId.replace(/^(TEMP|ORD)/, "")) + 1 : 1;
    const tempOrderId = `TEMP${nextNumber.toString().padStart(6, "0")}`;

    const order = new Order({
      orderId: tempOrderId,
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
    });

    await order.save();
    console.log(`Order - Temporary order stored with orderId: ${tempOrderId}`);

    const payload = {
      merchantOrderId: tempOrderId,
      amount: Math.round((totalAmount + shippingCost) * 100),
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Payment for order",
        merchantUrls: {
          redirectUrl: `${process.env.BACKEND_URL}/api/phonepe/verify-phonepe?orderId=${tempOrderId}`,
        },
      },
    };

    await ensureValidToken();
    const url = `${PHONEPE_API_URL}/checkout/v2/pay`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${authToken}`,
    };

    const response = await axios.post(url, payload, { headers });
    console.log("PhonePe - API Response:", JSON.stringify(response.data, null, 2));

    if (response.status === 200 && response.data.redirectUrl) {
      console.log("PhonePe - Payment URL generated:", response.data.redirectUrl);
      return res.json({ success: true, orderId: tempOrderId, paymentUrl: response.data.redirectUrl });
    }
    throw new Error("Payment initiation failed: No redirect URL in response");
  } catch (error) {
    console.error("PhonePe - Error initiating payment:", error.message);
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
      amount: response.data.amount / 100,
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
    const tempOrder = await Order.findOne({ orderId });
    if (!tempOrder) {
      console.log("PhonePe - Callback failed: Order not found for orderId:", orderId);
      return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${orderId}&error=OrderNotFound`);
    }

    const paymentVerified = await exports.verifyPhonePePayment(orderId);

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      let finalOrderId = tempOrder.orderId.replace("TEMP", "ORD");
      EXISTING_ORDER_CHECK: {
        const existingOrder = await Order.findOne({ orderId: finalOrderId });
        if (existingOrder) {
          const orderCount = await Order.countDocuments();
          finalOrderId = `ORD${(orderCount + 1).toString().padStart(6, "0")}`;
        }
      }

      tempOrder.orderId = finalOrderId;
      tempOrder.status = "Processing"; // Initial status after payment
      tempOrder.paymentStatus = "Paid";
      tempOrder.transactionId = paymentVerified.transactionId;
      await tempOrder.save();
      console.log(`PhonePe - Order updated: ${finalOrderId}, Status: ${tempOrder.status}, PaymentStatus: ${tempOrder.paymentStatus}`);

      // Attempt shipment booking but don't change status to "Shipped" here
      try {
        const { trackingNumber } = await bookShipment(finalOrderId, tempOrder);
        tempOrder.trackingNumber = trackingNumber;
        await tempOrder.save();
        console.log(`PhonePe - Shipment booked for order: ${finalOrderId}, Tracking: ${trackingNumber}`);
      } catch (shipmentError) {
        console.error("PhonePe - Shipment booking failed:", shipmentError.message);
      }

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: tempOrder.shippingAddress.email,
        subject: "Order Confirmation - MalukForever",
        text: `Order ${finalOrderId} placed successfully. Transaction ID: ${paymentVerified.transactionId}`,
        html: `<p>Order ${finalOrderId} placed successfully for ₹${tempOrder.totalAmount}. Shipping cost: ₹${tempOrder.shippingCost}. Status: ${tempOrder.status}. Transaction ID: ${paymentVerified.transactionId}. ${tempOrder.trackingNumber ? `Tracking: ${tempOrder.trackingNumber}` : 'Shipment pending.'}</p>`,
      };
      await transporter.sendMail(mailOptions).catch((emailError) => {
        console.error("PhonePe - Failed to send confirmation email:", emailError.message);
      });

      const redirectUrl = `${process.env.FRONTEND_URL}/order-confirmation?orderId=${finalOrderId}&transactionId=${paymentVerified.transactionId}&status=${tempOrder.status.toLowerCase()}`;
      console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    } else if (paymentVerified.state === "FAILED") {
      tempOrder.status = "Failed";
      tempOrder.paymentStatus = "Failed";
      await tempOrder.save();
      console.log(`PhonePe - Order marked as failed: ${orderId}, PaymentStatus: ${tempOrder.paymentStatus}`);
      return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${orderId}&error=PaymentFailed®ion=${encodeURIComponent(tempOrder.shippingAddress.state)}`);
    } else {
      tempOrder.status = "Pending";
      tempOrder.paymentStatus = "Pending";
      await tempOrder.save();
      console.log(`PhonePe - Order remains pending: ${orderId}, PaymentStatus: ${tempOrder.paymentStatus}`);
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

    if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
      const finalOrderId = order.orderId.replace("TEMP", "ORD");
      order.orderId = finalOrderId;
      order.status = "Processing"; // Keep as Processing, not Shipped
      order.paymentStatus = "Paid";
      order.transactionId = paymentVerified.transactionId;

      if (!order.trackingNumber) { // Only book if not already booked
        const { trackingNumber } = await bookShipment(finalOrderId, order);
        order.trackingNumber = trackingNumber;
      }
      await order.save();

      return res.json({
        success: true,
        status: "success",
        orderId: finalOrderId,
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