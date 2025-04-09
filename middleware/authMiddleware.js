const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');

exports.authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please provide a token.' });
  }

  try {
    const blacklistedToken = await TokenBlacklist.findOne({ token });
    if (blacklistedToken) {
      return res.status(401).json({ error: 'Token blacklisted. Please log in again.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 300 });
    
    if (!decoded.id) {
      console.error('Auth - Decoded token missing id field');
      return res.status(401).json({ error: 'Invalid token payload. Please log in again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Auth - JWT Verification Error:', err.name, err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token has expired' });
    }
    return res.status(401).json({ error: 'Invalid token', details: err.message });
  }
};

// Optional authentication (allows guests)
exports.optionalAuthMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (token) {
    try {
      const blacklistedToken = await TokenBlacklist.findOne({ token });
      if (blacklistedToken) {
        return res.status(401).json({ error: 'Token blacklisted. Please log in again.' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 300 });
      if (decoded.id) {
        req.user = decoded;
      }
    } catch (err) {
      console.error('OptionalAuth - Token verification failed:', err.message);
    }
  }
  next();
};

// Admin-only middleware
exports.adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  next();
};