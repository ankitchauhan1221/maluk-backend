const nodemailer = require('nodemailer');
const transporter = require("../config/nodemailer");
require('dotenv').config();

const sendOrderConfirmationEmail = async (
  orderId,
  recipientEmail,
  totalAmount,
  shippingCost,
  trackingNumber,
  transactionId = null,
  payableAmount
) => {
  // Validate inputs
  if (!recipientEmail || !orderId) {
    throw new Error('Recipient email and order ID are required');
  }

  // Debug transporter
  console.log('emailService - Transporter object:', transporter);
  if (!transporter || typeof transporter.sendMail !== 'function') {
    throw new Error('Transporter is not properly initialized');
  }

  const discount = totalAmount + shippingCost - payableAmount;
  const mailOptions = {
    from: `"MalukForever" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    replyTo: process.env.EMAIL_USER,
    subject: `Order #${orderId} Confirmed - Thank You for Shopping with MalukForever!`,
    html: `
      <h2>Thank You for Your Order!</h2>
      <p>Dear Customer,</p>
      <p>Your order #${orderId} has been successfully placed.</p>
      <h3>Order Summary</h3>
      <ul>
        <li><strong>Total Amount:</strong> ₹${totalAmount.toFixed(2)}</li>
        <li><strong>Shipping Cost:</strong> ₹${shippingCost.toFixed(2)}</li>
        <li><strong>Discount:</strong> ₹${discount.toFixed(2)}</li>
        <li><strong>Payable Amount:</strong> ₹${payableAmount.toFixed(2)}</li>
        <li><strong>Tracking Number:</strong> ${trackingNumber || 'N/A'}</li>
        ${transactionId ? `<li><strong>Transaction ID:</strong> ${transactionId}</li>` : ''}
      </ul>
      <p>We will notify you once your order is shipped.</p>
      <p>Thank you for shopping with us!</p>
      <p>Best regards,<br>MalukForever Team</p>
      <p>© ${new Date().getFullYear()} MalukForever</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order confirmation email sent to ${recipientEmail} for order #${orderId}`);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    throw error;
  }
};

const sendCancellationRequestEmail = async (recipientEmail, orderId, reason) => {
  // Validate inputs
  if (!recipientEmail || !orderId) {
    throw new Error('Recipient email and order ID are required');
  }

  // Debug transporter
  console.log('emailService - Transporter object:', transporter);
  if (!transporter || typeof transporter.sendMail !== 'function') {
    throw new Error('Transporter is not properly initialized');
  }

  const mailOptions = {
    from: `"MalukForever" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: `Order Cancellation Request Received - Order #${orderId}`,
    html: `
      <h2>Order Cancellation Request</h2>
      <p>Dear Customer,</p>
      <p>Your request to cancel order #${orderId} has been received.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>We will process your request soon and notify you of the outcome.</p>
      <p>Thank you for choosing MalukForever.</p>
      <p>Best regards,<br>MalukForever Team</p>
      <p>© ${new Date().getFullYear()} MalukForever</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Cancellation request email sent to ${recipientEmail} for order #${orderId}`);
  } catch (error) {
    console.error('Error sending cancellation request email:', error);
    throw error;
  }
};

module.exports = { sendOrderConfirmationEmail, sendCancellationRequestEmail };