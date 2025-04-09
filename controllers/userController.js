// controllers/userController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs'); // For password hashing
const jwt = require('jsonwebtoken'); // For JWT tokens


// Get saved addresses
exports.getAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json(user.addresses);
  } catch (err) {
    console.error('Error fetching addresses:', err);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
};

// Add a new address
exports.addAddress = async (req, res) => {
  try {
    const { name, lastname, companyName, country, streetAddress, city, state, zip, phone, email, type, isDefault } = req.body;
    const user = await User.findById(req.user._id);

    if (isDefault) {
      user.addresses.forEach(addr => (addr.isDefault = false));
    }

    user.addresses.push({ name, lastname, companyName, country, streetAddress, city, state, zip, phone, email, type, isDefault: !!isDefault });
    await user.save();
    res.status(201).json({ message: 'Address added successfully', addresses: user.addresses });
  } catch (err) {
    console.error('Error adding address:', err);
    res.status(500).json({ error: 'Failed to add address' });
  }
};

module.exports = {getAddresses, addAddress };