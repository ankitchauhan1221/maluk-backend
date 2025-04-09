const nodemailer = require('nodemailer');
const transporter = require("../config/nodemailer"); // Your nodemailer config
require('dotenv').config();

const sendOrderConfirmationEmail = async (orderId, recipientEmail, totalAmount, shippingCost, trackingNumber, transactionId = null, payableAmount) => {
  const discount = totalAmount + shippingCost - payableAmount; // Calculate discount if any
  const mailOptions = {
    from: `"MalukForever" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    replyTo: process.env.EMAIL_USER,
    subject: `Order #${orderId} Confirmed - Thank You for Shopping with MalukForever!`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1); margin: 20px auto;">
          <!-- Header -->
          <tr>
            <td bgcolor="#1a73e8" style="padding: 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Order Confirmed!</h1>
              <p style="color: #e0e7ff; margin: 5px 0 0; font-size: 14px;">Thank you for shopping with MalukForever</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 30px;">
              <h2 style="font-size: 20px; margin: 0 0 15px; color: #1a73e8;">Hello Valued Customer,</h2>
              <p style="font-size: 16px; line-height: 1.5; margin: 0 0 20px;">
                Your order has been successfully confirmed${transactionId ? ' and paid via PhonePe' : ' with Cash on Delivery'}. We’re preparing your items for shipment, and you’ll receive them soon!
              </p>
              
              <!-- Order Details -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>Order Number:</strong> #${orderId}
                  </td>
                </tr>
                ${transactionId ? `
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>Transaction ID:</strong> ${transactionId}
                  </td>
                </tr>` : ''}
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>Subtotal:</strong> ₹${totalAmount.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>Shipping Cost:</strong> ${shippingCost > 0 ? `₹${shippingCost.toFixed(2)}` : 'Free'}
                  </td>
                </tr>
                ${discount > 0 ? `
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>Discount:</strong> -₹${discount.toFixed(2)}
                  </td>
                </tr>` : ''}
                <tr>
                  <td style="font-size: 16px; padding-bottom: 10px;">
                    <strong>${transactionId ? 'Amount Paid' : 'Amount Payable on Delivery'}:</strong> ₹${payableAmount.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 16px;">
                    <strong>Tracking Number:</strong> ${trackingNumber || 'Will be updated soon'}
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <p style="font-size: 16px; line-height: 1.5; margin: 0 0 20px;">
                Track your order status or explore more products on our website.
              </p>
              <table border="0" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td bgcolor="#1a73e8" style="border-radius: 5px;">
                    <a href="https://malukforever.com/my-account" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold;">View My Account</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td bgcolor="#f9fafb" style="padding: 20px; text-align: center; font-size: 12px; color: #666;">
              <p style="margin: 0 0 10px;">Need help? Contact us at <a href="mailto:${process.env.EMAIL_USER}" style="color: #1a73e8; text-decoration: none;">${process.env.EMAIL_USER}</a></p>
              <p style="margin: 0;">© ${new Date().getFullYear()} MalukForever. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order confirmation email sent to ${recipientEmail} for order #${orderId}${transactionId ? ` with transaction ID ${transactionId}` : ''}, payable amount: ₹${payableAmount}`);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    throw error;
  }
};

module.exports = { sendOrderConfirmationEmail };