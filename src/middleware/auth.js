const jwt = require('jsonwebtoken');
const { User } = require('../models/mainSchemas');

/**
 * Require authenticated user
 */
const requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended', reason: user.banReason });
    }

    // Update last active
    user.lastActiveAt = new Date();
    await user.save({ validateBeforeSave: false });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(err);
  }
};

/**
 * Optional auth - attach user if token present but don't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user && !user.isBanned) {
      req.user = user;
    }
    next();
  } catch (err) {
    next(); // Silently continue without auth
  }
};

/**
 * Require superadmin role
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
};

/**
 * Extract JWT token from request
 */
function extractToken(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.headers['x-commex-token']) {
    return req.headers['x-commex-token'];
  }
  if (req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * Generate JWT token
 */
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

module.exports = { requireAuth, optionalAuth, requireSuperAdmin, generateToken };
