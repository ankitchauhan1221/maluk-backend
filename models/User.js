const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastname: { type: String, required: true },
  companyName: { type: String }, // Optional
  country: { type: String, required: true },
  streetAddress: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zip: { type: String, required: true },
  phone: { type: String, required: true }, 
  email: { type: String, required: true },
  type: { type: String, enum: ['Shipping', 'Billing'], required: true }, // Differentiate address type
  isDefault: { type: Boolean, default: false }, // For default address selection
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String },
  lastname: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String }, // Optional, no required: true
  gender: { type: String, enum: ['male', 'female', 'other'] },
  dateOfBirth: { type: Date },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  addresses: [addressSchema], // Array of addresses
}, { timestamps: true });

// Combined pre-save hook to sync address phone with user phone
userSchema.pre('save', function (next) {
  if (!this._originalPhone) {
    this._originalPhone = this.phone; // Store original phone for first save
  }
  if (this.isModified('phone') && this.phone) { // Only sync if phone exists and is modified
    this.addresses.forEach((address) => {
      if (!address.phone || address.phone === this._originalPhone) {
        address.phone = this.phone;
      }
    });
    this._originalPhone = this.phone; // Update original phone after sync
  }
  next();
});

module.exports = mongoose.model('User', userSchema);