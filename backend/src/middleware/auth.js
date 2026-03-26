const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Attach the authenticated user to req.user.
 * Reads the JWT from the HttpOnly cookie `access_token`.
 */
const authenticate = async (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  req.user = user;
  next();
};

/**
 * Require one of the specified roles.
 * Must be used AFTER `authenticate`.
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
};

module.exports = { authenticate, requireRole };
