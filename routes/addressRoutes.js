const express = require('express');
const { updateAddress, getAddresses, deleteAddress} = require('../controllers/addressController'); // Changed getAddress to getAddresses
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Get all user addresses
router.get('/', authMiddleware, getAddresses);

// Add or update user address
router.post('/', authMiddleware, updateAddress); // Changed to POST for adding new address

// DELETE /api/address/:addressId - Delete an address
router.delete('/:addressId', authMiddleware, deleteAddress);

module.exports = router;