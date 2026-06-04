const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { User } = require('../models/mainSchemas');
const { generateToken, requireAuth } = require('../middleware/auth');

//  Register 
router.post('/register', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username must be 3-30 chars, letters/numbers/underscore/dash only'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('displayName').optional().trim().isLength({ max: 60 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { username, email, password, displayName } = req.body;

    // Check existing
    const existing = await User.findOne({ $or: [{ email }, { username: username.toLowerCase() }] });
    if (existing) {
      const field = existing.email === email ? 'email' : 'username';
      return res.status(409).json({ error: `This ${field} is already taken` });
    }

    const user = await User.create({
      username: username.toLowerCase(),
      email,
      password,
      displayName: displayName || username,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName || user.username,
        avatar: user.avatar,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
});

// ─── Login ───
router.post('/login', [
  body('login').trim().notEmpty().withMessage('Email or username required'),
  body('password').notEmpty().withMessage('Password required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { login, password } = req.body;

    const isEmail = login.includes('@');
    const query = isEmail ? { email: login.toLowerCase() } : { username: login.toLowerCase() };

    const user = await User.findOne(query).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account suspended', reason: user.banReason });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id);
    user.lastActiveAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName || user.username,
        avatar: user.avatar,
        role: user.role,
        ownedOrgs: user.ownedOrgs,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

// ─── Get current user ──
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('ownedOrgs', 'name slug logo accentColor')
      .populate('memberOrgs', 'name slug logo accentColor');

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Logout (client-side mainly, but good to have) ──
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
