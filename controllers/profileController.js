const User = require('../models/User');

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user); // Embedded addresses are included automatically
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  const { name, lastname, phone, gender, dateOfBirth, address } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (name) user.name = name;
    if (lastname) user.lastname = lastname;
    if (phone) user.phone = phone;
    if (gender) user.gender = gender;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;

    // Update or add address (optional, since you have a separate addressController)
    if (address) {
      const { type, isDefault, ...addressData } = address;
      const existingAddressIndex = user.addresses.findIndex(
        (addr) => addr.type === type && addr.isDefault === isDefault
      );

      if (existingAddressIndex !== -1) {
        // Update existing address
        user.addresses[existingAddressIndex] = { ...user.addresses[existingAddressIndex], ...addressData };
      } else {
        // Add new address
        user.addresses.push({ ...addressData, type, isDefault: isDefault || false });
      }
    }

    await user.save();
    res.json(user); // Returns updated user with embedded addresses
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get all user profiles (Admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users); // Embedded addresses are included automatically
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};