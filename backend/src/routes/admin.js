const express = require('express');
const { query } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const User = require('../models/User');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireRole('admin'));

/**
 * GET /api/admin/users
 * Paginated list of all users.
 * Query params: page (default 1), limit (default 20), search (email substring)
 */
router.get(
  '/users',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().trim().escape(),
  ],
  validate,
  async (req, res) => {
    try {
      const page   = req.query.page  || 1;
      const limit  = req.query.limit || 20;
      const search = req.query.search;

      const filter = search
        ? { email: { $regex: search, $options: 'i' } }
        : {};

      const [users, total] = await Promise.all([
        User.find(filter)
          .select('-passwordHash -passwordResetToken -passwordResetExpires')
          .skip((page - 1) * limit)
          .limit(limit)
          .sort({ createdAt: -1 }),
        User.countDocuments(filter),
      ]);

      res.json({
        users: users.map((u) => u.toPublicJSON()),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PATCH /api/admin/users/:id/role
 * Change a user's role.
 */
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'moderator'].includes(role)) {
      return res.status(422).json({ error: 'Invalid role.' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: user.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user account.
 */
router.delete('/users/:id', async (req, res) => {
  try {
    // Prevent admins from deleting themselves
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/analytics
 * Basic usage stats.
 */
router.get('/analytics', async (_req, res) => {
  try {
    const [totalUsers, adminCount, verifiedCount, recentLogins] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ emailVerified: true }),
      User.countDocuments({ lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);

    res.json({ totalUsers, adminCount, verifiedCount, recentLogins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
