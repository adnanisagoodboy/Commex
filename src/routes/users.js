const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { User, Organization } = require('../models/mainSchemas');
const { requireAuth } = require('../middleware/auth');
const { getRank, getNextRank, getRankProgress, RANKS } = require('../utils/ranks');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');

//  Get public user profile 
router.get('/:username', async (req, res) => {
  try {
    if (req.params.username === 'me') return res.status(400).json({ error: 'Use /me/profile' });
    const user = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('-password -refreshToken -passwordResetToken')
      .populate('ownedOrgs', 'name slug logo accentColor');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const rank = getRank(user.commentCount);
    const nextRank = getNextRank(user.commentCount);
    const progress = getRankProgress(user.commentCount);
    res.json({ user, rank, nextRank, progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get all ranks 
router.get('/me/ranks', requireAuth, (req, res) => {
  const rank = getRank(req.user.commentCount);
  const nextRank = getNextRank(req.user.commentCount);
  const progress = getRankProgress(req.user.commentCount);
  res.json({ ranks: RANKS, currentRank: rank, nextRank, progress, commentCount: req.user.commentCount || 0 });
});

//  Activity: ALL orgs ─
router.get('/me/activity', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user._id.toString();
    const orgs = await Organization.find({ isActive: true }).select('+dbConnectionString name slug accentColor logo');
    console.log(`[activity] Searching ${orgs.length} orgs for user ${userId}`);
    const allComments = [];
    await Promise.allSettled(orgs.map(async (org) => {
      try {
        const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
        const { Comment } = createOrgModels(conn);
        const comments = await Comment.find({ authorId: userId, isDeleted: false })
          .sort({ createdAt: -1 }).limit(30).lean();
        if (comments.length > 0) console.log(`[activity] Found ${comments.length} in org ${org.slug}`);
        comments.forEach(c => allComments.push({ ...c, orgName: org.name, orgSlug: org.slug, orgAccent: org.accentColor, orgLogo: org.logo }));
      } catch (e) { console.warn(`[activity] Failed org ${org.slug}:`, e.message); }
    }));
    allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const lim = parseInt(limit), pg = parseInt(page);
    const paginated = allComments.slice((pg - 1) * lim, pg * lim);
    console.log(`[activity] Total: ${allComments.length}, page ${pg}`);
    res.json({ comments: paginated, total: allComments.length, page: pg, pages: Math.ceil(allComments.length / lim) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Notifications: search ALL orgs for this user's notifications ─
// A user can receive notifications in ANY org they've commented in,
// not just orgs they own. So we must search all orgs.
router.get('/me/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { unreadOnly = 'false' } = req.query;

    const orgs = await Organization.find({ isActive: true })
      .select('+dbConnectionString name slug accentColor');

    console.log(`[notifications] Searching ${orgs.length} orgs for user ${userId}`);

    const allNotifs = [];
    await Promise.allSettled(orgs.map(async (org) => {
      try {
        const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
        const { Notification } = createOrgModels(conn);

        // Search by string userId (how they're stored)
        const filter = { userId };
        if (unreadOnly === 'true') filter.isRead = false;

        const notifs = await Notification.find(filter)
          .sort({ createdAt: -1 }).limit(30).lean();

        if (notifs.length > 0) console.log(`[notifications] Found ${notifs.length} in org ${org.slug}`);
        notifs.forEach(n => allNotifs.push({ ...n, orgName: org.name, orgSlug: org.slug }));
      } catch (e) {
        console.warn(`[notifications] Failed org ${org.slug}:`, e.message);
      }
    }));

    allNotifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const unreadCount = allNotifs.filter(n => !n.isRead).length;

    console.log(`[notifications] Total: ${allNotifs.length}, unread: ${unreadCount}`);
    res.json({ notifications: allNotifs.slice(0, 50), unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Update own profile ─
router.patch('/me/profile', requireAuth, [
  body('displayName').optional().trim().isLength({ max: 60 }),
  body('bio').optional().trim().isLength({ max: 300 }),
  body('website').optional().trim(),
  body('avatar').optional().trim(),
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

//  Change password ─
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
