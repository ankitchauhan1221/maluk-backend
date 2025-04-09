const Order = require("../models/Order");
const User = require("../models/User");
const Sequence = require("../models/Sequence");
const transporter = require("../config/nodemailer"); 
const { sendOrderConfirmationEmail } = require("../service/emailService")

const redis = require("redis");
const { incrementCouponUsage } = require("./couponController");
const { bookShipment } = require("./shippingController");
const { initiatePhonePePayment, verifyPhonePePayment } = require("./phonepeController");

const client = redis.createClient({ url: process.env.REDIS_URL });
client.connect().catch((err) => console.error("Redis connection error:", err));

const getNextOrderId = async () => {
  const sequence = await Sequence.findOneAndUpdate(
    { name: "orderId" },
    { $inc: { value: 1 } },
    { upsert: true, new: true }
  );
  return `ORD${sequence.value.toString().padStart(2, "0")}`;
};


exports.createOrder = async (req, res) => {
  const {
    products,
    shippingAddress,
    billingAddress,
    paymentMethod,
    totalAmount,
    shippingCost,
    couponCode,
    discountAmount,
    saveAddress,
  } = req.body;
  const customerId = req.user?.id;

  try {
    if (!products || !shippingAddress || !paymentMethod || !totalAmount || !shippingCost || !customerId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (!["COD", "PhonePe"].includes(paymentMethod)) {
      return res.status(400).json({ success: false, error: "Invalid payment method" });
    }

    const orderId = await getNextOrderId();

    if (paymentMethod === "PhonePe") {
      const tempOrderId = `TEMP${Date.now()}`;
      const orderData = {
        orderId,
        customerId,
        products,
        totalAmount,
        shippingCost,
        couponCode: couponCode || null,
        discountAmount: discountAmount || 0,
        shippingAddress,
        billingAddress: billingAddress || shippingAddress,
        paymentMethod,
        saveAddress,
      };
      await client.set(tempOrderId, JSON.stringify(orderData), { EX: 3600 });
      const paymentUrl = await initiatePhonePePayment({
        tempOrderId,
        amount: totalAmount + shippingCost,
        customerId,
      });
      return res.status(200).json({ success: true, tempOrderId, paymentUrl });
    }

    if (paymentMethod === "COD") {
      const order = new Order({
        orderId,
        customer: customerId,
        products,
        totalAmount,
        shippingCost,
        couponCode: couponCode || null,
        discountAmount: discountAmount || 0,
        shippingAddress,
        billingAddress: billingAddress || shippingAddress,
        paymentMethod,
        status: "Pending",
        paymentStatus: "Pending",
        trackingUpdates: [],
      });

      await order.save();
      const { trackingNumber } = await bookShipment(orderId, order);

      // Send email for COD order (no transactionId)
      await sendOrderConfirmationEmail(orderId, shippingAddress.email, totalAmount, shippingCost, trackingNumber);

      return res.status(201).json({
        success: true,
        orderId,
        trackingNumber,
        message: "Order placed and shipment booked successfully",
      });
    }
  } catch (error) {
    console.error("Order - Error creating order:", error.message);
    return res.status(500).json({ success: false, error: "Failed to create order", details: error.message });
  }
};

// exports.confirmOrder = async (req, res) => {
//   try {
//     const { tempOrderId, transactionId } = req.body;
//     const customerId = req.user?.id;

//     console.log('ConfirmOrder - tempOrderId:', tempOrderId);
//     console.log('ConfirmOrder - transactionId:', transactionId);
//     console.log('ConfirmOrder - customerId:', customerId);

//     if (!tempOrderId || !transactionId) {
//       return res.status(400).json({ error: 'Invalid request data' });
//     }

//     const tempOrderData = await client.get(tempOrderId);
//     if (!tempOrderData) {
//       return res.status(404).json({ error: 'Temporary order not found or expired' });
//     }

//     const orderData = JSON.parse(tempOrderData);
//     console.log('ConfirmOrder - Order data from Redis:', orderData);

//     if (orderData.customerId !== customerId) {
//       return res.status(403).json({ error: 'Unauthorized' });
//     }

//     const paymentStatus = await verifyPhonePePayment(tempOrderId, transactionId);
//     console.log('ConfirmOrder - Payment Status:', paymentStatus);
//     if (paymentStatus.code !== 'PAYMENT_SUCCESS') {
//       return res.status(400).json({ error: 'Payment verification failed' });
//     }

//     let order = await Order.findOne({ orderId: orderData.orderId });
//     if (order) {
//       console.log('ConfirmOrder - Order already exists:', order);
//       if (order.paymentStatus === 'Paid' && order.transactionId === transactionId) {
//         const { trackingNumber } = await bookShipment(order.orderId, order);
//         await client.del(tempOrderId);
//         return res.status(200).json({
//           success: true,
//           orderId: order.orderId,
//           trackingNumber,
//           message: 'Order already confirmed and shipment booked',
//         });
//       }
//       return res.status(409).json({ error: 'Order exists but payment status mismatch' });
//     }

//     order = new Order({
//       orderId: orderData.orderId,
//       customer: customerId,
//       products: orderData.products,
//       totalAmount: orderData.totalAmount,
//       shippingCost: orderData.shippingCost,
//       couponCode: orderData.couponCode || null,
//       discountAmount: orderData.discountAmount,
//       shippingAddress: orderData.shippingAddress,
//       billingAddress: orderData.billingAddress || orderData.shippingAddress,
//       paymentMethod: orderData.paymentMethod,
//       status: 'Pending',
//       paymentStatus: 'Paid',
//       transactionId,
//       trackingUpdates: [],
//     });

//     await order.save();
//     console.log('ConfirmOrder - Order saved:', order);

//     if (orderData.couponCode && orderData.discountAmount > 0) {
//       await incrementCouponUsage(orderData.couponCode);
//     }

//     if (orderData.saveAddress) {
//       const user = await User.findById(customerId);
//       if (user) {
//         user.addresses = user.addresses || [];
//         if (!user.addresses.some((addr) => addr.streetAddress === orderData.shippingAddress.streetAddress)) {
//           user.addresses.push({ ...orderData.shippingAddress, type: 'Shipping' });
//         }
//         if (
//           orderData.billingAddress &&
//           !user.addresses.some((addr) => addr.streetAddress === orderData.billingAddress.streetAddress)
//         ) {
//           user.addresses.push({ ...orderData.billingAddress, type: 'Billing' });
//         }
//         await user.save();
//       }
//     }

//     const { trackingNumber } = await bookShipment(order.orderId, order);

//     // Send email with transactionId for PhonePe order
//     await sendOrderConfirmationEmail(
//       order.orderId,
//       orderData.shippingAddress.email,
//       orderData.totalAmount,
//       orderData.shippingCost,
//       trackingNumber,
//       transactionId
//     );

//     await client.del(tempOrderId);
//     return res.status(201).json({
//       success: true,
//       orderId: order.orderId,
//       trackingNumber,
//       message: 'Order confirmed and shipment booked',
//     });
//   } catch (err) {
//     console.error('Order Confirmation - Error:', err.message);
//     if (err.code === 11000) {
//       return res.status(409).json({ error: 'Order already exists with this orderId' });
//     }
//     return res.status(500).json({ error: 'Failed to confirm order', details: err.message });
//   }
// };

// Other functions remain unchanged
exports.getOrderHistory = async (req, res) => {
  try {
    const customerId = req.user.id;
    const orders = await Order.find({ customer: customerId }).sort({ createdAt: -1 }).lean();
    if (!orders.length) return res.status(404).json({ message: "No orders found" });
    res.status(200).json(orders);
  } catch (err) {
    console.error("Order History - Error:", err);
    res.status(500).json({ error: "Failed to fetch order history" });
  }
};

exports.requestOrderCancellation = async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    const customerId = req.user?.id;
    const order = await Order.findOne({ orderId, customer: customerId });
    if (!order) return res.status(404).json({ error: "Order not found or not authorized" });
    if (["Shipped", "Delivered"].includes(order.status)) {
      return res.status(400).json({ error: "Cannot cancel shipped or delivered orders" });
    }
    order.cancellationRequested = true;
    order.cancellationReason = reason;
    await order.save();
    const user = await User.findById(customerId);
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Order Cancellation Request Received",
      text: `Your request to cancel order ${order.orderId} has been received. Reason: ${reason}.`,
    };
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Cancellation request submitted." });
  } catch (err) {
    console.error("Cancellation - Error:", err);
    res.status(500).json({ error: "Failed to request cancellation" });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate("customer", "email").sort({ createdAt: -1 }).lean();
    if (!orders.length) return res.status(404).json({ message: "No orders found" });
    const formattedOrders = orders.map((order) => ({
      id: order.orderId || "Unknown ID",
      customer: order.customer?.email || "Unknown Customer",
      date: order.createdAt ? new Date(order.createdAt).toISOString().split("T")[0] : "Unknown Date",
      total: order.totalAmount || 0,
      status: (order.status || "pending").toLowerCase(),
      items: order.products ? order.products.length : 0,
      paymentMethod: order.paymentMethod ? order.paymentMethod.toLowerCase() : "cod", // Add paymentMethod
      reference_number: order.reference_number || "", // Optional: include if available
    }));
    res.status(200).json(formattedOrders);
  } catch (err) {
    console.error("GetAllOrders - Error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
};

exports.getOrderById = async (req, res) => {
  const { orderId } = req.params;
  const { transactionId } = req.query;
  console.log("GetOrderById - User from auth:", req.user);
  console.log("GetOrderById - OrderId:", orderId);
  console.log("GetOrderById - TransactionId:", transactionId);

  try {
    const order = await Order.findOne({ orderId });

    if (!order) {
      console.log(`GetOrderById - Order not found: ${orderId}`);
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Allow access for PhonePe with transactionId
    if (transactionId && order.transactionId === transactionId) {
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (order.createdAt > twentyFourHoursAgo) {
        console.log(`GetOrderById - Order retrieved via transactionId: ${orderId}`);
        return res.json(order);
      } else {
        console.log(`GetOrderById - TransactionId expired for order: ${orderId}`);
        return res.status(403).json({ success: false, error: "Transaction ID access expired" });
      }
    }

    // Allow COD orders immediately after creation (e.g., within 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (!transactionId && order.paymentMethod === "COD" && order.createdAt > fiveMinutesAgo) {
      console.log(`GetOrderById - COD order retrieved without auth: ${orderId}`);
      return res.json(order);
    }

    // Require authenticated user
    if (!req.user) {
      console.log("GetOrderById - No user authenticated");
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    if (order.customer.toString() !== req.user.id) {
      console.log(`GetOrderById - Unauthorized access to order: ${orderId}`);
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    console.log(`GetOrderById - Order retrieved for user: ${req.user.id}`);
    return res.json(order);
  } catch (error) {
    console.error("GetOrderById - Error:", error.message);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  createOrder: exports.createOrder,
  // confirmOrder: exports.confirmOrder,
  getOrderHistory: exports.getOrderHistory,
  requestOrderCancellation: exports.requestOrderCancellation,
  getAllOrders: exports.getAllOrders,
  getOrderById: exports.getOrderById,
};