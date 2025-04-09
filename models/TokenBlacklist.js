const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 1 } }
});

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);