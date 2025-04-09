const axios = require("axios");
const Order = require("../models/Order");
const ShippingDetails = require("../models/ShippingDetails");
const nodemailer = require("nodemailer");

const SHIPSY_API_KEY = process.env.SHIPSY_API_KEY;
const SHIPSY_BOOK_SHIPMENT_URL = process.env.SHIPSY_BOOK_SHIPMENT_URL;
const SHIPSY_CANCEL_SHIPMENT_URL = process.env.SHIPSY_CANCEL_SHIPMENT_URL;
const SHIPSY_CUSTOMER_CODE = process.env.SHIPSY_CUSTOMER_CODE;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const bookShipment = async (orderId, order) => {
  try {
    if (!SHIPSY_BOOK_SHIPMENT_URL || !SHIPSY_API_KEY || !SHIPSY_CUSTOMER_CODE) {
      throw new Error("Shipsy configuration missing in environment variables");
    }

    const headers = {
      "api-key": SHIPSY_API_KEY,
      "Content-Type": "application/json",
    };

    const isCOD = order.paymentMethod === "COD";
    const consignments = [{
      length: 10,
      width: 10,
      height: 10,
      weight: 0.5,
      pieceCount: 1,
    }];
    const sharedReferenceNumber = `${orderId}-1`;

    const formattedConsignments = consignments.map((consignment) => ({
      customer_code: SHIPSY_CUSTOMER_CODE,
      service_type_id: isCOD ? "B2C SMART EXPRESS" : "B2C PRIORITY",
      load_type: "NON-DOCUMENT",
      consignment_type: "Forward",
      dimension_unit: "cm",
      length: consignment.length || "10.0",
      width: consignment.width || "10.0",
      height: consignment.height || "10.0",
      weight_unit: "kg",
      weight: consignment.weight || "0.5",
      declared_value: (order.totalAmount + order.shippingCost).toString(),
      eway_bill: "",
      invoice_number: orderId,
      invoice_date: new Date().toISOString().split("T")[0],
      num_pieces: consignment.pieceCount || 1,
      origin_details: {
        name: process.env.WAREHOUSE_NAME || "MalukForever Warehouse",
        phone: process.env.WAREHOUSE_PHONE || "+919876543210",
        alternate_phone: process.env.WAREHOUSE_PHONE || "+919876543210",
        address_line_1: process.env.WAREHOUSE_ADDRESS_LINE_1 || "Warehouse Address Line 1",
        address_line_2: "",
        pincode: process.env.WAREHOUSE_PINCODE || "201301",
        city: process.env.WAREHOUSE_CITY || "Noida",
        state: process.env.WAREHOUSE_STATE || "Uttar Pradesh",
      },
      destination_details: {
        name: order.shippingAddress.name || "Unknown Customer",
        phone: order.shippingAddress.phone || "+918368959586",
        alternate_phone: order.shippingAddress.phone || "+918368959586",
        address_line_1: order.shippingAddress.streetAddress || "Delhi India",
        address_line_2: order.shippingAddress.apartment || "",
        pincode: order.shippingAddress.zip || "110001",
        city: order.shippingAddress.city || "DELHI",
        state: order.shippingAddress.state || "DELHI",
      },
      return_details: {
        name: process.env.RETURN_NAME || "MalukForever WH HO",
        phone: process.env.RETURN_PHONE || "+919876543210",
        alternate_phone: process.env.RETURN_PHONE || "+919876543210",
        address_line_1: process.env.RETURN_ADDRESS_LINE_1 || "D-13, First Floor, Sector-3, Noida, 201301",
        address_line_2: "",
        pincode: process.env.RETURN_PINCODE || "201301",
        city: process.env.RETURN_CITY || "NOIDA",
        state: process.env.RETURN_STATE || "UTTAR PRADESH",
        country: "India",
        email: process.env.RETURN_EMAIL || "support@malukforever.com",
      },
      customer_reference_number: sharedReferenceNumber,
      cod_collection_mode: isCOD ? "CASH" : "",
      cod_amount: isCOD ? (order.totalAmount + order.shippingCost).toString() : "0",
      commodity_id: "2",
      description: order.products.map((p) => p.name).join(", ") || "Anti-Dandruff Shampoo",
      reference_number: "", // This will be set by Shipsy
    }));

    const payload = { consignments: formattedConsignments };
    console.log("Shipping - Booking shipment with payload:", JSON.stringify(payload, null, 2));

    const response = await axios.post(SHIPSY_BOOK_SHIPMENT_URL, payload, { headers });
    console.log("Shipping - Shipsy API Response:", JSON.stringify(response.data, null, 2));

    if (response.data.status !== "OK" || !Array.isArray(response.data.data) || response.data.data.length === 0) {
      throw new Error(`Shipsy booking failed: ${JSON.stringify(response.data.errors || response.data.message || "Invalid response")}`);
    }

    const shipmentResult = response.data.data[0];
    if (!shipmentResult.success) {
      throw new Error(`Shipsy booking failed: ${shipmentResult.message || "Unknown error"}`);
    }

    const trackingNumber = shipmentResult.reference_number || `Fallback-${orderId}-1`;
    const now = new Date();

    order.trackingUpdates.push({
      action: "BKD",
      actionDesc: "Booked",
      trackingNumber,
      actionDate: now.toISOString().split("T")[0].replace(/-/g, ""),
      actionTime: now.toISOString().split("T")[1].split(".")[0].replace(/:/g, ""),
      origin: process.env.WAREHOUSE_CITY || "Noida",
      remarks: "Shipment booked with Shipsy",
    });
    order.status = "Processing";
    order.reference_number = trackingNumber; // Save Shipsy reference number here

    await order.save();

    console.log(`✅ Shipping - Shipment booked for order ${orderId}`);
    console.log(`🚚 Order - Shipment booked with tracking number: ${trackingNumber}`);
    return { trackingNumber };
  } catch (error) {
    console.error("❌ Shipping - Book Shipment Error:", error.message, error.response?.data ? JSON.stringify(error.response.data, null, 2) : "No response data");
    throw error;
  }
};



// DTDC Tracking Update Endpoint
exports.receiveTrackingUpdate = async (req, res) => {
  try {
    const { shipment, shipmentStatus } = req.body;

    if (!shipment?.strShipmentNo || !shipmentStatus || !Array.isArray(shipmentStatus)) {
      return res.status(400).json({ success: false, error: "Invalid DTDC tracking data" });
    }

    const trackingNumber = shipment.strShipmentNo;
    const order = await Order.findOne({ "trackingUpdates.trackingNumber": trackingNumber });
    if (!order) {
      console.warn(`Order not found for tracking number: ${trackingNumber}`);
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const newTrackingUpdates = shipmentStatus.map((status) => ({
      action: status.strAction,
      actionDesc: status.strActionDesc,
      origin: status.strOrigin,
      actionDate: status.strActionDate,
      actionTime: status.strActionTime,
      remarks: status.strRemarks || "",
      latitude: status.strLatitude || "",
      longitude: status.strLongitude || "",
      manifestNo: status.strManifestNo || "",
      trackingNumber,
      scdOtp: status.strSCDOTP || "N",
      ndcOtp: status.strNDCOTP || "N",
    }));

    order.trackingUpdates = order.trackingUpdates.concat(newTrackingUpdates);

    const latestStatus = shipmentStatus[shipmentStatus.length - 1];
    const dtdcStatusMap = {
      "BKD": "Processing",          // Booked
      "MNF": "Processing",          // Manifested
      "PU": "Shipped",             // Picked Up
      "OFD": "Out for Delivery",   // Out for Delivery
      "DLV": "Delivered",          // Delivered
      "NONDLV": "Failed",          // Not Delivered
      "RTO": "Return to Origin",   // Return to Origin
      "RTD": "Returned",           // Return Delivered
      "CAN": "Cancelled",          // Cancelled
      // "IT" deliberately omitted to ignore "In Transit"
    };

    const mappedStatus = dtdcStatusMap[latestStatus.strAction];
    if (mappedStatus) {
      order.status = mappedStatus;
    } // Else, keep the previous status (ignores "IT")

    // Update DTDC-specific fields
    order.weight = shipment.strWeight || order.weight;
    order.rtoNumber = shipment.strRtoNumber || order.rtoNumber;
    order.expectedDeliveryDate = shipment.strExpectedDeliveryDate || order.expectedDeliveryDate;
    order.revExpectedDeliveryDate = shipment.strRevExpectedDeliveryDate || order.revExpectedDeliveryDate;

    if (order.status === "Delivered") {
      if (order.paymentMethod === "COD") {
        order.paymentStatus = "Paid";
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: order.shippingAddress.email,
          subject: "Order Delivered - MalukForever",
          text: `Your order ${order.orderId} was delivered on ${latestStatus.strActionDate} at ${latestStatus.strActionTime}.\nPayment Method: COD\nPayment Status: Paid`,
        };
        await transporter.sendMail(mailOptions);
      } else if (order.paymentMethod === "PhonePe") {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: order.shippingAddress.email,
          subject: "Order Delivered - MalukForever",
          text: `Your order ${order.orderId} was delivered on ${latestStatus.strActionDate} at ${latestStatus.strActionTime}.\nPayment Method: PhonePe\nPayment Status: Paid`,
        };
        await transporter.sendMail(mailOptions);
      }
    }

    await order.save();
    console.log(`Tracking updated for order ${order.orderId} with status ${order.status}, paymentStatus ${order.paymentStatus}`);

    return res.status(200).json({ success: true, message: "DTDC tracking update received" });
  } catch (error) {
    console.error("Tracking update error:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Cancel Order with Shipsy (unchanged)
exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const customerId = req.user?.id;

    const order = await Order.findOne({ orderId, customer: customerId });
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found or unauthorized" });
    }

    if (["Delivered"].includes(order.status)) {
      return res.status(400).json({ success: false, error: "Cannot cancel a delivered order" });
    }
    if (order.status === "Cancelled") {
      return res.status(400).json({ success: false, error: "Order already cancelled" });
    }

    const latestTracking = order.trackingUpdates[order.trackingUpdates.length - 1];
    if (latestTracking?.trackingNumber && order.status !== "Processing") {
      const headers = { "api-key": SHIPSY_API_KEY, "Content-Type": "application/json" };
      const payload = {
        customer_code: SHIPSY_CUSTOMER_CODE,
        awb_number: latestTracking.trackingNumber,
        reason: reason || "Customer requested cancellation",
      };
      const response = await axios.post(SHIPSY_CANCEL_SHIPMENT_URL, payload, { headers });
      if (!response.data.success) {
        throw new Error(`Shipsy cancellation failed: ${response.data.message || "Unknown error"}`);
      }
    }

    order.status = "Cancelled";
    order.cancellationReason = reason || "Customer requested cancellation";
    order.trackingUpdates.push({
      action: "CAN",
      actionDesc: "Cancelled by customer",
      trackingNumber: latestTracking?.trackingNumber || "",
      remarks: reason || "No reason provided",
      actionDate: new Date().toISOString().split("T")[0].replace(/-/g, ""),
      actionTime: new Date().toISOString().split("T")[1].split(".")[0].replace(/:/g, ""),
    });

    let refundNote = "";
    if (order.paymentMethod === "PhonePe" && order.paymentStatus === "Paid") {
      refundNote = "\nA refund will be processed to your PhonePe account shortly.";
    }

    await order.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: order.shippingAddress.email,
      subject: "Order Cancellation Confirmation - MalukForever",
      text: `Your order ${orderId} has been cancelled.\nReason: ${order.cancellationReason}\nPayment Method: ${order.paymentMethod}\nPayment Status: ${order.paymentStatus}${refundNote}`,
    };
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      orderId,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      status: order.status,
    });
  } catch (error) {
    console.error("Cancel order error:", error.message, error.response?.data);
    return res.status(500).json({ success: false, error: "Failed to cancel order", details: error.message });
  }
};

// Other shipping functions (unchanged)
exports.getCities = async (req, res) => {
  try {
    const cities = await ShippingDetails.distinct("city");
    res.status(200).json({ success: true, cities });
  } catch (error) {
    console.error("Shipping - Error fetching cities:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getStates = async (req, res) => {
  try {
    const states = await ShippingDetails.distinct("state");
    res.status(200).json({ success: true, states });
  } catch (error) {
    console.error("Shipping - Error fetching states:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getPincodeDetails = async (req, res) => {
  try {
    const { pincode } = req.body;
    if (!pincode || pincode.length !== 6) {
      return res.status(400).json({ success: false, message: "Invalid pincode" });
    }
    const details = await ShippingDetails.findOne({ destinationPincode: pincode });
    if (!details) return res.status(404).json({ success: false, message: "Pincode not found" });
    res.status(200).json({ success: true, details: { city: details.city, state: details.state } });
  } catch (error) {
    console.error("Shipping - Error fetching pincode details:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyPincode = async (req, res) => {
  try {
    const { orgPincode, desPincode } = req.body;
    if (!orgPincode || !desPincode) {
      return res.status(400).json({ success: false, message: "Origin and destination pincodes are required" });
    }

    const shippingDetails = await ShippingDetails.findOne({ destinationPincode: desPincode });
    if (!shippingDetails) {
      return res.status(404).json({ success: false, message: "Destination pincode not found in database" });
    }

    const isServiceable = !shippingDetails.serviceable || shippingDetails.serviceable.trim().toUpperCase() !== "NO";
    if (!isServiceable) {
      return res.status(200).json({ success: false, message: "Service not available for this pincode" });
    }

    res.status(200).json({
      success: true,
      message: "*Service Available.",
      shippingDetails: shippingDetails.toObject(),
    });
  } catch (error) {
    console.error("Shipping - Error verifying pincode:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  bookShipment,
  cancelOrder: exports.cancelOrder,
  getCities: exports.getCities,
  getStates: exports.getStates,
  getPincodeDetails: exports.getPincodeDetails,
  verifyPincode: exports.verifyPincode,
  receiveTrackingUpdate: exports.receiveTrackingUpdate,
};