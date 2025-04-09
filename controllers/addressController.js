const User = require('../models/User');

// Get all user addresses
exports.getAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('addresses');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.addresses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add or update user address
exports.updateAddress = async (req, res) => {
  const { name, lastname, companyName, country, streetAddress, city, state, zip, phone, email, type, isDefault } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const addressData = { name, lastname, companyName, country, streetAddress, city, state, zip, phone, email, type, isDefault: isDefault || false };
    const existingAddressIndex = user.addresses.findIndex((addr) => addr.type === type && addr.isDefault === isDefault);

    if (existingAddressIndex !== -1) {
      user.addresses[existingAddressIndex] = { ...user.addresses[existingAddressIndex], ...addressData };
    } else {
      user.addresses.push(addressData);
    }

    await user.save();
    res.json(user.addresses);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete an address
exports.deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const addressId = req.params.addressId;
    const addressIndex = user.addresses.findIndex((addr) => addr._id.toString() === addressId);

    if (addressIndex === -1) return res.status(404).json({ error: 'Address not found' });

    user.addresses.splice(addressIndex, 1);
    await user.save();
    res.json({ message: 'Address deleted', addresses: user.addresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};