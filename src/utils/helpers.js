const { validationResult } = require('express-validator');

/**
 * Middleware that checks express-validator results and returns 400 if invalid
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg,
      errors: errors.array(),
    });
  }
  next();
}

/**
 * Sanitize a MongoDB connection string for safe logging (mask password)
 */
function maskConnectionString(uri) {
  try {
    return uri.replace(/:([^@]+)@/, ':***@');
  } catch (e) {
    return '[connection string]';
  }
}

/**
 * Async route wrapper — catches errors and passes to next()
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { validate, maskConnectionString, asyncHandler };
