const Order = require("../models/Order");
const User = require("../models/User");
const transporter = require("../config/nodemailer");
const { sendOrderConfirmationEmail } = require("../service/emailService");
const { incrementCouponUsage } = require("./couponController");
const { bookShipment } = require("./shippingController");

async function generateUnique6DigitOrderId() {
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const orderId = Math.floor(100000 + Math.random() * 900000).toString();
        const existingOrder = await Order.findOne({ orderId });
        if (!existingOrder) {
            console.log(`Order - Generated unique orderId: ${orderId}`);
            return orderId;
        }
        console.log(`Order - Collision detected for orderId: ${orderId}, retrying (${attempt}/${maxRetries})`);
    }
    const lastOrder = await Order.findOne().sort({ orderId: -1 });
    let newOrderId = lastOrder && lastOrder.orderId ? (parseInt(lastOrder.orderId) + 1).toString() : "100000";
    if (parseInt(newOrderId) > 999999) {
        throw new Error("Order ID range exhausted. Please implement a new ID strategy.");
    }
    console.log(`Order - Fallback to incremental orderId: ${newOrderId}`);
    return newOrderId;
}

exports.createOrder = async (req, res) => {
    const {
        products,
        shippingAddress,
        billingAddress,
        paymentMethod,
        totalAmount,
        shippingCost,
        couponCode,
        discountAmount = 0,
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

        if (typeof totalAmount !== "number" || typeof shippingCost !== "number" || typeof discountAmount !== "number") {
            return res.status(400).json({ success: false, error: "Total amount, shipping cost, and discount must be numbers" });
        }

        const orderId = await generateUnique6DigitOrderId();
        console.log(`Order - Generated orderId: ${orderId}`);

        const payableAmount = Math.max(0, totalAmount + shippingCost - discountAmount);

        if (payableAmount < 1) {
            return res.status(400).json({ success: false, error: "Payable amount must be at least ₹1" });
        }

        if (paymentMethod === "PhonePe") {
            const phonePeRequestBody = {
                products,
                shippingAddress,
                billingAddress,
                totalAmount,
                shippingCost,
                couponCode,
                discountAmount,
                orgPincode: req.body.orgPincode,
                desPincode: req.body.desPincode,
                consignments: req.body.consignments,
                paymentMethod,
                saveAddress,
                payableAmount,
                orderId,
            };
            const response = await fetch(`${process.env.BACKEND_URL}/api/phonepe/initiate-payment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${req.user.token}`,
                },
                body: JSON.stringify(phonePeRequestBody),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Failed to initiate PhonePe payment");
            return res.status(200).json({ success: true, orderId, paymentUrl: result.paymentUrl });
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
            paymentMethod,
            status: "Pending",
            paymentStatus: "Pending",
            trackingUpdates: [],
            payableAmount,
        });

        await order.save();
        console.log("Order - Order saved:", orderId);

        if (paymentMethod === "COD") {
            const { trackingNumber } = await bookShipment(orderId, order);
            await sendOrderConfirmationEmail(orderId, shippingAddress.email, totalAmount, shippingCost, trackingNumber, null, order.payableAmount);
            return res.status(201).json({
                success: true,
                orderId,
                trackingNumber,
                payableAmount: order.payableAmount,
                message: "Order placed and shipment booked successfully",
            });
        }
    } catch (error) {
        console.error("Order - Error creating order:", error.message);
        return res.status(500).json({ success: false, error: "Failed to create order", details: error.message });
    }
};

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
            paymentMethod: order.paymentMethod ? order.paymentMethod.toLowerCase() : "cod",
            reference_number: order.reference_number || "",
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

        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (!transactionId && order.paymentMethod === "COD" && order.createdAt > fiveMinutesAgo) {
            console.log(`GetOrderById - COD order retrieved without auth: ${orderId}`);
            return res.json(order);
        }

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
    getOrderHistory: exports.getOrderHistory,
    requestOrderCancellation: exports.requestOrderCancellation,
    getAllOrders: exports.getAllOrders,
    getOrderById: exports.getOrderById,
};