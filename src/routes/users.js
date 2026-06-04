const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { User } = require('../models/mainSchemas');
const { requireAuth } = require('../middleware/auth');

//  Get user profile 
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('-password -refreshToken -passwordResetToken')
      .populate('ownedOrgs', 'name slug logo');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Update own profile 
router.patch('/me/profile', requireAuth, [
  body('displayName').optional().trim().isLength({ max: 60 }),
  body('bio').optional().trim().isLength({ max: 300 }),
  body('website').optional().isURL().withMessage('Invalid URL'),
  body('avatar').optional().isURL().withMessage('Invalid avatar URL'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const allowed = ['displayName', 'bio', 'website', 'avatar'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ user, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Change password 
router.patch('/me/password', requireAuth, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(req.body.currentPassword);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

    user.password = req.body.newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
