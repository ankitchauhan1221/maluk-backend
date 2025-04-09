const nodemailer = require('nodemailer');
const transporter = require("../config/nodemailer");

exports.sendContactEmail = async (req, res) => {
    const { name, email, message } = req.body;

    // Validate input
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        // Email to admin
        const adminMailOptions = {
            from: process.env.EMAIL_USER,
            to: 'operations@malukforever.com',
            subject: 'New Contact Form Submission',
            html: `
                <h2>New Contact Form Submission</h2>
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Message:</strong> ${message}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            `
        };

        // Thank you email to customer
        const customerMailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Thank You for Contacting Us',
            html: `
                <h2>Thank You, ${name}!</h2>
                <p>We have received your message and will get back to you soon.</p>
                <p><strong>Your Message:</strong> ${message}</p>
                <p>Our team is available:</p>
                <ul>
                    <li>Mon - Fri: 7:30am - 8:00pm PST</li>
                    <li>Saturday: 8:00am - 6:00pm PST</li>
                    <li>Sunday: 9:00am - 5:00pm PST</li>
                </ul>
                <p>Best regards,<br>The Maluk Forever Team</p>
            `
        };

        // Send both emails
        await Promise.all([
            transporter.sendMail(adminMailOptions),
            transporter.sendMail(customerMailOptions)
        ]);

        res.status(200).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
};