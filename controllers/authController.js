const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');
const transporter = require("../config/nodemailer"); 
require('dotenv').config();

// Email template functions (unchanged)
const generateWelcomeEmail = (userEmail) => {
  return {
    from: `"Maluk Team" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: 'Welcome to Maluk - Thank You for Registering!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Welcome to Maluk!</h2>
        <p>Dear Customer,</p>
        <p>Thank you for joining Maluk! We're excited to have you on board. Start exploring our wide range of products and enjoy exclusive offers.</p>
        <p><a href="http://localhost:3000/login" style="color: #1a73e8; text-decoration: none;">Log in now</a> to get started.</p>
        <p>If you have any questions, feel free to contact us at <a href="mailto:${process.env.EMAIL_USER}" style="color: #1a73e8; text-decoration: none;">${process.env.EMAIL_USER}</a>.</p>
        <p>Best regards,<br/>The Maluk Team</p>
      </div>
    `,
  };
};

const generateResetPasswordEmail = (userEmail, resetToken) => {
  const resetLink = `http://localhost:3000/reset-password?token=${resetToken}`;
  return {
    from: `"Maluk Team" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: 'Reset Your Maluk Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Reset Your Password</h2>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <p><a href="${resetLink}" style="color: #1a73e8; text-decoration: none;">Reset Password</a></p>
        <p>This link will expire in 1 hour. If you didn’t request this, please ignore this email.</p>
        <p>Best regards,<br/>The Maluk Team</p>
      </div>
    `,
  };
};

const generatePasswordResetSuccessEmail = (userEmail) => {
  return {
    from: `"Maluk Team" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: 'Your Maluk Password Has Been Reset',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Password Reset Successful</h2>
        <p>Dear Customer,</p>
        <p>Your password has been successfully reset. You can now log in with your new password.</p>
        <p><a href="http://localhost:3000/login" style="color: #1a73e8; text-decoration: none;">Log in here</a></p>
        <p>If you didn’t make this change, please contact us immediately at <a href="mailto:${process.env.EMAIL_USER}" style="color: #1a73e8; text-decoration: none;">${process.env.EMAIL_USER}</a>.</p>
        <p>Best regards,<br/>The Maluk Team</p>
      </div>
    `,
  };
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Admins cannot use this feature. Contact support.' });
    const resetToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const mailOptions = generateResetPasswordEmail(email, resetToken);
    await transporter.sendMail(mailOptions);
    res.json({ message: 'Password reset link sent to your email' });
  } catch (err) {
    console.error('Error in forgot password:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get Current User
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  const { token, password, confirmPassword } = req.body;
  if (!password || !confirmPassword) return res.status(400).json({ error: 'Password and confirmPassword are required' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Admins cannot use this feature. Contact support.' });
    const blacklisted = await TokenBlacklist.findOne({ token });
    if (blacklisted) return res.status(401).json({ error: 'Invalid or used reset token' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user.password = hashedPassword;
    await user.save();
    await TokenBlacklist.create({ token, expiresAt: new Date(decoded.exp * 1000) });

    const successMailOptions = generatePasswordResetSuccessEmail(user.email);
    await transporter.sendMail(successMailOptions);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Error in reset password:', err);
    if (err.name === 'TokenExpiredError') return res.status(400).json({ error: 'Reset token has expired' });
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Register User
exports.registerUser = async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;
    if (!email || !password || !confirmPassword) return res.status(400).json({ error: 'Email and password are required' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) return res.status(400).json({ error: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      role: req.body.role || 'user',
      status: 'active',
    });
    await user.save();

    const mailOptions = generateWelcomeEmail(email);
    await transporter.sendMail(mailOptions);

    const payload = { id: user._id, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({ token });
  } catch (err) {
    console.error('Error in registerUser:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ error: 'You are not registered. Please sign up first.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const payload = { id: user._id, role: user.role, status: user.status };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ accessToken, role: user.role });
  } catch (err) {
    console.error('Error in login:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update User Status
exports.updateUserStatus = async (req, res) => {
  const { userId, status } = req.body;
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status value. Use "active" or "inactive".' });
  try {
    const adminUser = await User.findById(req.user.id);
    if (adminUser.role !== 'admin') return res.status(403).json({ error: 'Access denied. Only admins can change status.' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.status = status;
    await user.save();
    res.json({ message: `User status updated to ${status}` });
  } catch (err) {
    console.error('Error updating user status:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Register Admin
exports.registerAdmin = async (req, res) => {
  req.body.role = 'admin';
  return exports.registerUser(req, res);
};

// Logout
exports.logout = async (req, res) => {
  const accessToken = req.header('Authorization')?.replace('Bearer ', '');

  try {
    if (!accessToken) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const decodedAccess = jwt.decode(accessToken);
    if (decodedAccess && decodedAccess.exp) {
      await TokenBlacklist.create({ token: accessToken, expiresAt: new Date(decodedAccess.exp * 1000) });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout - Error:', err.message);
    res.status(500).json({ error: 'Server error during logout', details: err.message });
  }
};

// Update User
exports.updateUser = async (req, res) => {
  try {
    const { name, lastname, phone, gender, dateOfBirth, addresses } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (name) user.name = name;
    if (lastname) user.lastname = lastname;
    if (phone) user.phone = phone;
    if (gender) user.gender = gender;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (addresses) user.addresses = addresses;
    await user.save();
    res.status(200).json(user);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
};