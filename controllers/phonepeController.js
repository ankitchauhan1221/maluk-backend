const axios = require("axios");
const Order = require("../models/Order");
const { bookShipment } = require("./shippingController");
const { sendOrderConfirmationEmail } = require("../service/emailService");

const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION;
const PHONEPE_API_URL = "https://api.phonepe.com/apis/identity-manager";
const PHONEPE_PG_URL = "https://api.phonepe.com/apis/pg";

// Token caching
let cachedToken = null;
let tokenExpiresAt = null;

exports.generateUnique6DigitOrderId = function () {
  return new Promise((resolve, reject) => {
    const maxRetries = 10;
    let attempt = 1;

    function tryGenerate() {
      if (attempt > maxRetries) {
        Order.findOne()
          .sort({ orderId: -1 })
          .then((lastOrder) => {
            let newOrderId = lastOrder && lastOrder.orderId ? (parseInt(lastOrder.orderId) + 1).toString() : "100000";
            if (parseInt(newOrderId) > 999999) {
              return reject(new Error("Order ID range exhausted. Please implement a new ID strategy."));
            }
            console.log(`PhonePe - Fallback to incremental orderId: ${newOrderId}`);
            resolve(newOrderId);
          })
          .catch(reject);
        return;
      }

      const orderId = Math.floor(100000 + Math.random() * 900000).toString();
      Order.findOne({ orderId })
        .then((existingOrder) => {
          if (!existingOrder) {
            console.log(`PhonePe - Generated unique orderId: ${orderId}`);
            resolve(orderId);
          } else {
            console.log(`PhonePe - Collision detected for orderId: ${orderId}, retrying (${attempt}/${maxRetries})`);
            attempt++;
            tryGenerate();
          }
        })
        .catch(reject);
    }

    tryGenerate();
  });
};

exports.fetchAuthToken = function () {
  return new Promise((resolve, reject) => {
    // Use cached token if valid
    if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
      console.log("PhonePe - Using cached auth token");
      return resolve({ accessToken: cachedToken, expiresAt: tokenExpiresAt });
    }

    const url = `${PHONEPE_API_URL}/v1/oauth/token`;
    const params = new URLSearchParams({
      client_id: PHONEPE_CLIENT_ID,
      client_version: PHONEPE_CLIENT_VERSION,
      client_secret: PHONEPE_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    axios
      .post(url, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
      .then((response) => {
        cachedToken = response.data.access_token;
        tokenExpiresAt = response.data.expires_at * 1000; // Convert to milliseconds
        console.log("PhonePe - Auth Token Response:", {
          accessToken: cachedToken?.slice(0, 10) + "...",
          expiresAt: tokenExpiresAt,
        });
        resolve({ accessToken: cachedToken, expiresAt: tokenExpiresAt });
      })
      .catch((error) => {
        console.error("PhonePe - Error fetching auth token:", {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
        });
        reject(new Error(`Failed to fetch auth token: ${error.message}`));
      });
  });
};

exports.validateOrderData = function (body) {
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

exports.initiatePhonePePayment = function (req, res) {
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
    exports.validateOrderData(req.body);
    exports
      .generateUnique6DigitOrderId()
      .then((orderId) => {
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

        order
          .save()
          .then(() => {
            console.log("Backend - Order saved:", orderId);

            exports
              .fetchAuthToken()
              .then(({ accessToken }) => {
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
                axios
                  .post(url, payload, {
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${accessToken}`, // Fixed from O-Bearer
                    },
                  })
                  .then((response) => {
                    console.log("Backend - PhonePe Response:", JSON.stringify({
                      orderId: response.data.orderId,
                      state: response.data.state,
                      redirectUrl: response.data.redirectUrl,
                      expireAt: response.data.expireAt,
                    }, null, 2));

                    const redirectUrl = response.data.redirectUrl;
                    if (redirectUrl) {
                      res.status(200).json({ success: true, orderId, paymentUrl: redirectUrl });
                    } else {
                      throw new Error("No redirect URL received from PhonePe");
                    }
                  })
                  .catch((error) => {
                    console.error("Backend - Axios error:", {
                      message: error.message,
                      response: error.response?.data,
                      status: error.response?.status,
                    });
                    res.status(500).json({ success: false, error: error.message });
                  });
              })
              .catch((error) => {
                console.error("Backend - Fetch auth token error:", {
                  message: error.message,
                  response: error.response?.data,
                  status: error.response?.status,
                });
                res.status(500).json({ success: false, error: error.message });
              });
          })
          .catch((error) => {
            console.error("Backend - Order save error:", {
              message: error.message,
              stack: error.stack,
            });
            res.status(500).json({ success: false, error: error.message });
          });
      })
      .catch((error) => {
        console.error("Backend - Generate orderId error:", {
          message: error.message,
          stack: error.stack,
        });
        res.status(500).json({ success: false, error: error.message });
      });
  } catch (error) {
    console.error("Backend - Payment error:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.verifyPhonePePayment = function (orderId, retries = 10, delay = 3000) {
  return new Promise((resolve, reject) => {
    let attempt = 1;

    function tryVerify() {
      console.log(`PhonePe - Verifying payment for orderId: ${orderId} (Attempt ${attempt}/${retries})`);
      exports
        .fetchAuthToken()
        .then(({ accessToken }) => {
          const url = `${PHONEPE_PG_URL}/checkout/v2/order/${orderId}/status`;

          axios
            .get(url, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`, // Fixed from O-Bearer
              },
            })
            .then((response) => {
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
              resolve(result);
            })
            .catch((error) => {
              console.error(`PhonePe - Error verifying payment (Attempt ${attempt}/${retries}):`, {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
              });
              if (attempt === retries) {
                console.error("PhonePe - Max retries reached for payment verification");
                reject(error);
              } else {
                attempt++;
                setTimeout(tryVerify, delay);
              }
            });
        })
        .catch((error) => {
          console.error(`PhonePe - Fetch auth token error (Attempt ${attempt}/${retries}):`, {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          });
          if (attempt === retries) {
            reject(error);
          } else {
            attempt++;
            setTimeout(tryVerify, delay);
          }
        });
    }

    tryVerify();
  });
};

exports.verifyPhonePePaymentCallback = function (req, res) {
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

    Order.findOne({ orderId })
      .then((order) => {
        if (!order) {
          console.error("PhonePe - Callback failed: Order not found for orderId:", orderId);
          return res.redirect(`${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(orderId)}&error=OrderNotFound`);
        }

        exports
          .verifyPhonePePayment(orderId)
          .then((paymentVerified) => {
            console.log("PhonePe - Payment verification result:", paymentVerified);

            const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

            if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
              order.status = "Processing";
              order.paymentStatus = "Paid";
              order.transactionId = paymentVerified.transactionId;
              console.log("PhonePe - Saving order update:", { orderId, status: order.status, paymentStatus: order.paymentStatus });

              order
                .save()
                .then(() => {
                  bookShipment(orderId, order)
                    .then(({ trackingNumber }) => {
                      order.trackingNumber = trackingNumber;
                      console.log("PhonePe - Saving tracking number:", { orderId, trackingNumber });
                      return order.save();
                    })
                    .catch((shipmentError) => {
                      console.error("PhonePe - Shipment booking failed:", {
                        message: shipmentError.message,
                        stack: shipmentError.stack,
                      });
                    })
                    .then(() => {
                      sendOrderConfirmationEmail(
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
                      res.redirect(redirectUrl);
                    });
                })
                .catch((error) => {
                  console.error("PhonePe - Order save error:", {
                    message: error.message,
                    stack: error.stack,
                  });
                  throw error;
                });
            } else if (paymentVerified.state === "FAILED") {
              order.status = "Failed";
              order.paymentStatus = "Failed";
              order
                .save()
                .then(() => {
                  console.log(`PhonePe - Order marked as failed: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
                  res.redirect(
                    `${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(orderId)}&error=PaymentFailed&reason=${encodeURIComponent(
                      paymentVerified.reason || "Payment failed"
                    )}`
                  );
                })
                .catch((error) => {
                  console.error("PhonePe - Order save error:", {
                    message: error.message,
                    stack: error.stack,
                  });
                  throw error;
                });
            } else {
              order.status = "Pending";
              order.paymentStatus = "Pending";
              order
                .save()
                .then(() => {
                  console.log(`PhonePe - Order remains pending: ${orderId}, PaymentStatus: ${order.paymentStatus}`);
                  const redirectUrl = `${process.env.FRONTEND_URL}/checkout?orderId=${encodeURIComponent(orderId)}&status=pending`;
                  console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
                  res.redirect(redirectUrl);
                })
                .catch((error) => {
                  console.error("PhonePe - Order save error:", {
                    message: error.message,
                    stack: error.stack,
                  });
                  throw error;
                });
            }
          })
          .catch((error) => {
            console.error("PhonePe - Payment verification error:", {
              message: error.message,
              stack: error.stack,
              orderId,
            });
            throw error;
          });
      })
      .catch((error) => {
        console.error("PhonePe - Error in callback:", {
          message: error.message,
          stack: error.stack,
          orderId,
        });
        const redirectUrl = `${process.env.FRONTEND_URL}/order-failure?orderId=${encodeURIComponent(
          orderId
        )}&error=${encodeURIComponent(error.message)}`;
        console.log(`PhonePe - Redirecting to: ${redirectUrl}`);
        res.redirect(redirectUrl);
      });
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
    res.redirect(redirectUrl);
  }
};

exports.checkPaymentStatus = function (req, res) {
  const { orderId } = req.query;
  console.log("PhonePe - Checking payment status for orderId:", orderId);

  if (!orderId) {
    console.error("PhonePe - No orderId provided for status check");
    return res.status(400).json({ success: false, error: "Order ID is required" });
  }

  Order.findOne({ orderId })
    .then((order) => {
      if (!order) {
        console.error("PhonePe - Order not found for status check:", orderId);
        return res.status(404).json({ success: false, error: "Order not found" });
      }

      exports
        .verifyPhonePePayment(orderId)
        .then((paymentVerified) => {
          console.log("PhonePe - Payment verification result:", paymentVerified);

          const payableAmount = Math.max(0, order.totalAmount + order.shippingCost - (order.discountAmount || 0));

          if (paymentVerified.success && paymentVerified.state === "COMPLETED") {
            if (order.paymentStatus !== "Paid") {
              order.status = "Processing";
              order.paymentStatus = "Paid";
              order.transactionId = paymentVerified.transactionId;

              if (!order.trackingNumber) {
                bookShipment(orderId, order)
                  .then(({ trackingNumber }) => {
                    order.trackingNumber = trackingNumber;
                    console.log("PhonePe - Assigned tracking number:", { orderId, trackingNumber });
                    return order.save();
                  })
                  .catch((shipmentError) => {
                    console.error("PhonePe - Shipment booking failed in checkPaymentStatus:", {
                      message: shipmentError.message,
                      stack: shipmentError.stack,
                    });
                  })
                  .then(() => {
                    sendOrderConfirmationEmail(
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
                  });
              }

              order
                .save()
                .then(() => {
                  console.log("PhonePe - Order updated in checkPaymentStatus:", {
                    orderId,
                    status: order.status,
                    paymentStatus: order.paymentStatus,
                  });

                  res.json({
                    success: true,
                    status: "success",
                    orderId,
                    transactionId: paymentVerified.transactionId,
                    trackingNumber: order.trackingNumber,
                    redirectUrl: `${process.env.FRONTEND_URL}/order-confirmation?orderId=${encodeURIComponent(
                      orderId
                    )}&transactionId=${encodeURIComponent(paymentVerified.transactionId)}&status=success`,
                  });
                })
                .catch((error) => {
                  console.error("PhonePe - Order save error:", {
                    message: error.message,
                    stack: error.stack,
                  });
                  throw error;
                });
            } else {
              res.json({
                success: true,
                status: "success",
                orderId,
                transactionId: paymentVerified.transactionId,
                trackingNumber: order.trackingNumber,
                redirectUrl: `${process.env.FRONTEND_URL}/order-confirmation?orderId=${encodeURIComponent(
                  orderId
                )}&transactionId=${encodeURIComponent(paymentVerified.transactionId)}&status=success`,
              });
            }
          } else if (paymentVerified.state === "FAILED") {
            order.status = "Failed";
            order.paymentStatus = "Failed";
            order
              .save()
              .then(() => {
                console.log("PhonePe - Order marked as failed in checkPaymentStatus:", {
                  orderId,
                  paymentStatus: order.paymentStatus,
                });
                res.json({
                  success: false,
                  status: "failed",
                  orderId,
                  reason: paymentVerified.reason || "Payment failed",
                });
              })
              .catch((error) => {
                console.error("PhonePe - Order save error:", {
                  message: error.message,
                  stack: error.stack,
                });
                throw error;
              });
          } else {
            console.log("PhonePe - Payment still pending in checkPaymentStatus:", { orderId });
            res.json({
              success: false,
              status: "pending",
              orderId,
            });
          }
        })
        .catch((error) => {
          console.error("PhonePe - Payment verification error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            orderId,
          });
          res.status(500).json({ success: false, error: error.message });
        });
    })
    .catch((error) => {
      console.error("PhonePe - Error checking payment status:", {
        message: error.message,
        stack: error.stack,
        orderId,
      });
      res.status(500).json({ success: false, error: error.message });
    });
};

exports.checkRefundStatus = function (req, res) {
  const { orderId } = req.query;
  const customerId = req.user?.id;

  if (!orderId) {
    console.error("PhonePe - No orderId provided for refund status check");
    return res.status(400).json({ success: false, error: "Order ID is required" });
  }

  Order.findOne({ orderId, customer: customerId })
    .then((order) => {
      if (!order) {
        console.error("PhonePe - Order not found for refund status check:", orderId);
        return res.status(404).json({ success: false, error: "Order not found or unauthorized" });
      }

      if (order.refundStatus === "none" || !order.refundId) {
        console.log(`PhonePe - No refund initiated for orderId: ${orderId}`);
        return res.status(400).json({ success: false, error: "No refund initiated for this order" });
      }

      exports
        .fetchAuthToken()
        .then(({ accessToken }) => {
          const statusApiUrl = `${PHONEPE_PG_URL}/payments/v2/refund/${order.refundId}/status`;

          axios
            .get(statusApiUrl, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`, // Reverted to Bearer
                "X-MERCHANT-ID": PHONEPE_CLIENT_ID,
              },
            })
            .then((response) => {
              console.log("PhonePe - Refund Status Response:", JSON.stringify({
                state: response.data.state,
                amount: response.data.amount,
                refundId: response.data.refundId,
                errorCode: response.data.errorCode,
              }, null, 2));

              const { state, amount, refundId, errorCode } = response.data;

              order.refundStatus = state === "COMPLETED" ? "completed" : state === "FAILED" ? "failed" : "initiated";
              if (state === "COMPLETED") {
                order.status = "Cancelled";
              }

              order
                .save()
                .then(() => {
                  res.status(200).json({
                    success: true,
                    orderId,
                    refundId,
                    refundAmount: amount / 100,
                    refundStatus: state,
                    errorCode: errorCode || null,
                  });
                })
                .catch((error) => {
                  console.error("PhonePe - Order save error:", {
                    message: error.message,
                    stack: error.stack,
                  });
                  res.status(500).json({ success: false, error: "Failed to save refund status", details: error.message });
                });
            })
            .catch((error) => {
              console.error("PhonePe - Error checking refund status:", {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
              });
              res.status(500).json({ success: false, error: "Failed to check refund status", details: error.message });
            });
        })
        .catch((error) => {
          console.error("PhonePe - Fetch auth token error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          });
          res.status(500).json({ success: false, error: "Failed to fetch auth token", details: error.message });
        });
    })
    .catch((error) => {
      console.error("PhonePe - Error finding order:", {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({ success: false, error: "Failed to check refund status", details: error.message });
    });
};

module.exports = {
  generateUnique6DigitOrderId: exports.generateUnique6DigitOrderId,
  fetchAuthToken: exports.fetchAuthToken,
  validateOrderData: exports.validateOrderData,
  initiatePhonePePayment: exports.initiatePhonePePayment,
  verifyPhonePePayment: exports.verifyPhonePePayment,
  verifyPhonePePaymentCallback: exports.verifyPhonePePaymentCallback,
  checkPaymentStatus: exports.checkPaymentStatus,
  checkRefundStatus: exports.checkRefundStatus,
};