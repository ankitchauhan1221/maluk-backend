const axios = require("axios");
const crypto = require("crypto");
const Order = require("../models/Order");
const ShippingDetails = require("../models/ShippingDetails");
const nodemailer = require("nodemailer");

const SHIPSY_API_KEY = process.env.SHIPSY_API_KEY;
const SHIPSY_BOOK_SHIPMENT_URL = process.env.SHIPSY_BOOK_SHIPMENT_URL;
const SHIPSY_CANCEL_SHIPMENT_URL = process.env.SHIPSY_CANCEL_SHIPMENT_URL;
const SHIPSY_CUSTOMER_CODE = process.env.SHIPSY_CUSTOMER_CODE;
const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION;
const PHONEPE_API_URL = process.env.NODE_ENV === "production" 
  ? "https://api.phonepe.com/apis/identity-manager" 
  : "https://api-preprod.phonepe.com/apis/identity-manager";
const PHONEPE_PG_URL = process.env.NODE_ENV === "production" 
  ? "https://api.phonepe.com/apis/pg" 
  : "https://api-preprod.phonepe.com/apis/pg-sandbox";

// Validate environment variables
if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET || !PHONEPE_CLIENT_VERSION) {
  console.error("PhonePe - Missing required environment variables", {
    clientId: PHONEPE_CLIENT_ID ? "Set" : "Missing",
    clientSecret: PHONEPE_CLIENT_SECRET ? "Set" : "Missing",
    clientVersion: PHONEPE_CLIENT_VERSION ? "Set" : "Missing",
  });
  throw new Error("PhonePe configuration missing");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// Fetch PhonePe Auth Token
async function fetchAuthToken(retry = false) {
  const url = `${PHONEPE_API_URL}/v1/oauth/token`;
  const params = new URLSearchParams({
    client_id: PHONEPE_CLIENT_ID,
    client_version: PHONEPE_CLIENT_VERSION,
    client_secret: PHONEPE_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  try {
    console.log("PhonePe - Fetching auth token", { url, clientId: PHONEPE_CLIENT_ID });
    const response = await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log("PhonePe - Auth Token Response:", {
      accessToken: response.data.access_token?.slice(0, 10) + "...",
      expiresAt: response.data.expires_at,
      scope: response.data.scope || "Not provided",
      tokenType: response.data.token_type || "Not provided",
    });
    return {
      accessToken: response.data.access_token,
      expiresAt: response.data.expires_at,
    };
  } catch (error) {
    console.error("PhonePe - Error fetching auth token:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data ? JSON.stringify(error.response.data, null, 2) : "No response data",
      retryAttempt: retry,
    });
    throw new Error("Failed to fetch auth token");
  }
}

// Book a shipment with DTDC
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
    const sharedReferenceNumber = orderId;
    const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

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
      declared_value: payableAmount.toString(),
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
        name: order.shippingAddress.name || "MalukForever",
        phone: order.shippingAddress.phone || "+9100000000",
        alternate_phone: order.shippingAddress.phone || "+910000000000",
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
      cod_amount: isCOD ? payableAmount.toString() : "0",
      commodity_id: "2",
      description: order.products.map((p) => p.name).join(", ") || "Anti-Dandruff Shampoo",
      reference_number: "",
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

    order.status = "Processing";
    order.reference_number = trackingNumber;
    await order.save();

    console.log(`✅ Shipping - Shipment booked for order ${orderId}`);
    console.log(`🚚 Order - Shipment booked with tracking number: ${trackingNumber}`);
    return { trackingNumber };
  } catch (error) {
    console.error("❌ Shipping - Book Shipment Error:", error.message, error.response?.data ? JSON.stringify(error.response.data, null, 2) : "No response data");
    throw error;
  }
};

// Receive DTDC tracking updates
const receiveTrackingUpdate = async (req, res) => {
  try {
    const { shipment, shipmentStatus } = req.body;

    if (!shipment?.strShipmentNo || !shipmentStatus || !Array.isArray(shipmentStatus)) {
      console.error("Invalid webhook payload:", JSON.stringify(req.body, null, 2));
      return res.status(400).json({ success: false, error: "Invalid DTDC tracking data" });
    }

    const trackingNumber = shipment.strShipmentNo;
    const order = await Order.findOne({ reference_number: trackingNumber });
    if (!order) {
      console.warn(`Order not found for tracking number: ${trackingNumber}`);
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const dtdcStatusMap = {
      BKD: "Processing",
      PCUP: "Shipped",
      OUTDLV: "Out for Delivery",
      DLV: "Delivered",
      NONDLV: "Failed",
      RTO: "Return to Origin",
      RETURND: "Returned",
      CAN: "Cancelled",
    };

    // Filter out BKD if already present to avoid duplicates
    const filteredShipmentStatus = shipmentStatus.filter(
      (status) => status.strAction !== "BKD" || order.trackingUpdates.every((update) => update.action !== "BKD")
    );

    if (filteredShipmentStatus.length === 0) {
      console.warn(`No valid statuses after filtering for tracking number: ${trackingNumber}`, {
        originalStatuses: shipmentStatus.map(s => s.strAction),
        existingUpdates: order.trackingUpdates.map(u => u.action),
      });
      return res.status(200).json({ success: true, message: "No new valid tracking updates to process" });
    }

    const newTrackingUpdates = filteredShipmentStatus.map((status) => ({
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

    // Update order status for non-BKD statuses
    const latestStatus = filteredShipmentStatus[filteredShipmentStatus.length - 1];
    const mappedStatus = dtdcStatusMap[latestStatus.strAction];
    if (mappedStatus && mappedStatus !== "Processing") {
      order.status = mappedStatus;
    } else if (!mappedStatus) {
      console.warn(`Unmapped DTDC status: ${latestStatus.strAction} for tracking number: ${trackingNumber}`);
    }

    order.weight = shipment.strWeight || order.weight;
    order.rtoNumber = shipment.strRtoNumber || order.rtoNumber;
    order.expectedDeliveryDate = shipment.strExpectedDeliveryDate
      ? new Date(shipment.strExpectedDeliveryDate.split(/(..)(..)(....)/).slice(1, 4).reverse().join('-'))
      : order.expectedDeliveryDate;
    order.revExpectedDeliveryDate = shipment.strRevExpectedDeliveryDate
      ? new Date(shipment.strRevExpectedDeliveryDate.split(/(..)(..)(....)/).slice(1, 4).reverse().join('-'))
      : order.revExpectedDeliveryDate;

    // Handle delivery email
    if (order.status === "Delivered") {
      order.paymentStatus = "Paid";
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: order.shippingAddress.email,
        subject: "Order Delivered - MalukForever",
        text: `Your order ${order.orderId} was delivered on ${latestStatus.strActionDate} at ${latestStatus.strActionTime}.\nPayment Method: ${order.paymentMethod}\nPayment Status: Paid`,
      };
      try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email - Sent delivery confirmation for order ${order.orderId}`);
      } catch (emailError) {
        console.error(`Failed to send delivery email for order ${order.orderId}:`, emailError.message);
      }
    }

    await order.save();
    console.log(`✅ Tracking updated for order ${order.orderId} with status ${order.status}, paymentStatus ${order.paymentStatus}`);

    return res.status(200).json({ success: true, message: "DTDC tracking update received" });
  } catch (error) {
    console.error("❌ Tracking update error:", error.message, error.stack);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Cancel an order with DTDC and initiate refund if applicable
const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const customerId = req.user?.id;

    console.log(`Cancel Order Request: orderId=${orderId}, reason=${reason}, user=${req.user?.email}`);

    // Find order
    const order = await Order.findOne({ orderId, customer: customerId });
    if (!order) {
      console.log(`Order not found: orderId=${orderId}, customerId=${customerId}`);
      return res.status(404).json({ success: false, error: "Order not found or unauthorized" });
    }

    // Log order details
    console.log("Order details:", {
      orderId: order.orderId,
      paymentMethod: order.paymentMethod,
      status: order.status,
      refundStatus: order.refundStatus,
      totalAmount: order.totalAmount,
      transactionId: order.transactionId,
    });

    // Validate order data
    if (!order.paymentMethod || !order.status) {
      console.error(`Invalid order data: orderId=${orderId}, paymentMethod=${order.paymentMethod}, status=${order.status}`);
      return res.status(400).json({ success: false, error: "Invalid order data" });
    }

    // Check cancellation eligibility
    if (order.paymentMethod === "COD" && ["Shipped", "Out for Delivery", "Delivered"].includes(order.status)) {
      console.log(`COD cancellation blocked: status=${order.status}`);
      return res.status(400).json({ success: false, error: "COD orders cannot be cancelled after Processing" });
    }

    if (["Out for Delivery", "Delivered"].includes(order.status)) {
      console.log(`Cancellation blocked: status=${order.status}`);
      return res.status(400).json({ success: false, error: "Cannot cancel orders that are out for delivery or delivered" });
    }

    if (order.status === "Cancelled" || order.refundStatus !== "none") {
      console.log(`Already cancelled or refunded: status=${order.status}, refundStatus=${order.refundStatus}`);
      return res.status(400).json({ success: false, error: "Order already cancelled or refund processed" });
    }

    // Initialize refund variables
    let refundAmount = 0;
    let refundId = null;
    const shippingCost = order.shippingCost || 50;

    // Handle refund logic
    if (order.paymentMethod === "PhonePe" && ["Pending", "Pending Payment", "Processing", "Shipped"].includes(order.status)) {
      refundAmount = order.totalAmount;
      console.log(`Initiating PhonePe refund: orderId=${orderId}, amount=${refundAmount}`);

      // Validate PhonePe configuration
      if (!PHONEPE_PG_URL || !PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET) {
        console.error(`PhonePe refund failed: Missing configuration`, {
          pgUrl: PHONEPE_PG_URL ? "Set" : "Missing",
          clientId: PHONEPE_CLIENT_ID ? "Set" : "Missing",
          clientSecret: PHONEPE_CLIENT_SECRET ? "Set" : "Missing",
        });
        return res.status(500).json({
          success: false,
          error: "PhonePe refund failed: Payment gateway configuration error",
        });
      }

      // Validate transactionId
      if (!order.transactionId) {
        console.error(`PhonePe refund failed: Missing transactionId for orderId=${orderId}`);
        return res.status(400).json({
          success: false,
          error: "PhonePe refund failed: Missing transaction ID",
        });
      }

      try {
        // Fetch PhonePe access token
        let { accessToken } = await fetchAuthToken();
        console.log("PhonePe - Using access token for refund:", accessToken ? "Valid" : "Missing");

        // Generate PhonePe refund payload
        const merchantRefundId = `REFUND-${orderId}-${Date.now()}`;
        const payload = {
          merchantRefundId,
          originalMerchantOrderId: order.orderId,
          amount: refundAmount * 100, // Convert to paise
        };
        const payloadString = Buffer.from(JSON.stringify(payload)).toString("base64");
        const stringToHash = `${payloadString}/payments/v2/refund${PHONEPE_CLIENT_SECRET}`;
        const xVerify = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###1";

        console.log("PhonePe - Refund payload:", JSON.stringify(payload, null, 2));
        console.log("PhonePe - Payload string (base64):", payloadString);
        console.log("PhonePe - X-VERIFY checksum:", xVerify);

        let refundResponse;
        try {
          refundResponse = await axios.post(
            `${PHONEPE_PG_URL}/payments/v2/refund`,
            payload,
            {
              headers: {
                "Content-Type": "application/json",
                "X-VERIFY": xVerify,
                "X-MERCHANT-ID": PHONEPE_CLIENT_ID,
                Authorization: `Bearer ${accessToken}`, // Reverted to Bearer
              },
            }
          );
        } catch (firstAttemptError) {
          if (firstAttemptError.response?.status === 401) {
            console.warn("PhonePe - 401 on first refund attempt, retrying with fresh token");
            // Retry with fresh token
            accessToken = (await fetchAuthToken(true)).accessToken;
            refundResponse = await axios.post(
              `${PHONEPE_PG_URL}/payments/v2/refund`,
              payload,
              {
                headers: {
                  "Content-Type": "application/json",
                  "X-VERIFY": xVerify,
                  "X-MERCHANT-ID": PHONEPE_CLIENT_ID,
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
          } else {
            throw firstAttemptError;
          }
        }

        console.log("PhonePe - Refund response:", JSON.stringify(refundResponse.data, null, 2));

        if (!refundResponse.data || typeof refundResponse.data !== "object") {
          throw new Error("Invalid refund response from PhonePe");
        }

        refundId = refundResponse.data.refundId || merchantRefundId;
        console.log(`PhonePe refund initiated: refundId=${refundId}, amount=${refundAmount}`);
      } catch (refundError) {
        console.error(`PhonePe refund failed: orderId=${orderId}`, {
          message: refundError.message,
          status: refundError.response?.status,
          data: refundError.response?.data ? JSON.stringify(refundError.response.data, null, 2) : 'No response data',
          stack: refundError.stack,
        });
        return res.status(500).json({
          success: false,
          error: `PhonePe refund failed: ${refundError.message}`,
          details: refundError.response?.data?.message || refundError.message,
        });
      }
    } else if (order.paymentMethod === "COD") {
      refundAmount = 0;
      refundId = null;
      console.log(`No refund for COD: orderId=${orderId}`);
    } else {
      console.warn(`Unsupported payment method: ${order.paymentMethod} for orderId=${orderId}`);
      refundAmount = 0;
      refundId = null;
    }

    // Update order
    order.status = "Cancelled";
    order.refundStatus = refundAmount > 0 ? "initiated" : "none";
    order.refundAmount = refundAmount;
    order.refundId = refundId;
    order.cancellationReason = reason;
    order.updatedAt = new Date();

    await order.save();
    console.log(`Order updated: orderId=${orderId}, status=Cancelled, refundAmount=${refundAmount}, refundId=${refundId}`);

    // Notify Shipsy (if applicable)
    if (order.trackingNumber) {
      try {
        await axios.post(
          SHIPSY_CANCEL_SHIPMENT_URL,
          { reference_number: order.trackingNumber },
          { headers: { Authorization: `Bearer ${SHIPSY_API_KEY}` } }
        );
        console.log(`Shipsy cancellation notified: trackingNumber=${order.trackingNumber}`);
      } catch (shipsyError) {
        console.error(`Shipsy cancellation failed: ${shipsyError.message}`);
      }
    }

    // Send cancellation email
    try {
      await sendCancellationEmail(order.email, order, reason, refundAmount, refundId);
      console.log(`Cancellation email sent to ${order.email}`);
    } catch (emailError) {
      console.error(`Email sending failed: ${emailError.message}`);
    }

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      orderId,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      refundStatus: order.refundStatus,
      refundAmount,
      refundId,
      shippingCost,
      totalAmount: order.totalAmount,
    });
  } catch (error) {
    console.error(`Cancel order error: orderId=${req.params.orderId}`, {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to cancel order",
      details: error.message || "Unknown error",
    });
  }
};


// Get distinct cities
const getCities = async (req, res) => {
  try {
    const cities = await ShippingDetails.distinct("city");
    res.status(200).json({ success: true, cities });
  } catch (error) {
    console.error("Shipping - Error fetching cities:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get distinct states
const getStates = async (req, res) => {
  try {
    const states = await ShippingDetails.distinct("state");
    res.status(200).json({ success: true, states });
  } catch (error) {
    console.error("Shipping - Error fetching states:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get pincode details (city, state)
const getPincodeDetails = async (req, res) => {
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

// Verify pincode for serviceability and shipping cost
const verifyPincode = async (req, res) => {
  try {
    const { desPincode } = req.body;
    console.log("Verifying pincode:", desPincode);
    if (!desPincode) {
      return res.status(400).json({ success: false, message: "Destination pincode is required" });
    }

    const shippingDetails = await ShippingDetails.findOne({ destinationPincode: desPincode });
    console.log("Found details:", shippingDetails);
    if (!shippingDetails) {
      return res.status(404).json({ success: false, message: "Pincode not found" });
    }

    const isServiceable =
      shippingDetails.prepaid?.toUpperCase() === "Y" ||
      shippingDetails.cod?.toUpperCase() === "Y" ||
      shippingDetails.b2cCodServiceable?.toUpperCase() === "Y";
    const isCodAvailable = shippingDetails.b2cCodServiceable?.toUpperCase() === "Y" && shippingDetails.cod?.toUpperCase() === "Y";
    const isPrepaidAvailable = shippingDetails.prepaid?.toUpperCase() === "Y";

    if (!isServiceable) {
      return res.status(200).json({
        success: false,
        message: "Service not available for this pincode",
      });
    }

    // Map destinationCategory to shipping cost
    const shippingCostMap = {
      INCITY: 27,
      "WITHIN REGION": 31,
      "WITHIN ZONE": 35,
      METRO: 40,
      "ROI-A": 43,
      "ROI-B": 48,
      "SPL DEST": 53,
    };

    const destinationCategory = shippingDetails.destinationCategory?.toUpperCase();
    const shippingCost = shippingCostMap[destinationCategory] || 53; // Default to SPL DEST

    res.status(200).json({
      success: true,
      message: "Service available",
      isServiceable,
      isCodAvailable,
      isPrepaidAvailable,
      city: shippingDetails.city,
      state: shippingDetails.state,
      shippingCost,
      destinationCategory,
    });
  } catch (error) {
    console.error("Shipping - Error verifying pincode:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  bookShipment,
  cancelOrder,
  getCities,
  getStates,
  getPincodeDetails,
  verifyPincode,
  receiveTrackingUpdate,
};