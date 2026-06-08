const express = require('express');
const router = express.Router();
const { Organization, User } = require('../models/mainSchemas');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');
const { requireAuth } = require('../middleware/auth');
const { getOrgRole, PERMISSIONS } = require('../utils/permissions');

async function loadOrgAdmin(req, res, next) {
  try {
    const org = await Organization.findOne({ slug: req.params.orgSlug }).select('+dbConnectionString');
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const isOwner = org.owner.toString() === req.user._id.toString();
    const isAdmin = org.members.find(
      m => m.user.toString() === req.user._id.toString() && ['admin', 'moderator'].includes(m.role)
    );
    if (!isOwner && !isAdmin && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Moderator access required' });
    }
    const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
    req.org = org;
    req.orgModels = createOrgModels(conn);
    next();
  } catch (err) {
    res.status(500).json({ error: 'DB connection failed', detail: err.message });
  }
}

//  Pending approval queue 
router.get('/:orgSlug/pending', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comments = await Comment.find({ status: 'pending', isDeleted: false })
      .sort({ createdAt: 1 }) // oldest first so oldest waits don't pile up
      .limit(100)
      .lean();
    console.log(`[moderation] Found ${comments.length} pending comments in ${req.params.orgSlug}`);
    res.json({ comments, total: comments.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Flagged comments — show ANY with flagCount > 0, not just isFlagged ─
router.get('/:orgSlug/flagged', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    // Show all comments with at least 1 flag, sorted by most flags first
    const comments = await Comment.find({ flagCount: { $gt: 0 }, isDeleted: false })
      .sort({ flagCount: -1, createdAt: -1 })
      .limit(100)
      .lean();
    console.log(`[moderation] Found ${comments.length} flagged comments in org ${req.params.orgSlug}`);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Recent comments across all pages ─
router.get('/:orgSlug/recent', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const { page = 1, limit = 15 } = req.query;
    const lim = parseInt(limit), pg = parseInt(page);
    const total = await Comment.countDocuments({ isDeleted: false });
    const comments = await Comment.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .lean();
    res.json({ comments, total, page: pg, pages: Math.ceil(total / lim) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Approve (clear flags) ─
router.patch('/:orgSlug/:commentId/approve', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    await Comment.findByIdAndUpdate(req.params.commentId, {
      $set: { isFlagged: false, isSpam: false, flagCount: 0, flaggedBy: [] }
    });
    res.json({ message: 'Comment approved, flags cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Mark spam ─
router.patch('/:orgSlug/:commentId/spam', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    await Comment.findByIdAndUpdate(req.params.commentId, {
      $set: { isSpam: true, isDeleted: true, content: '[removed: spam]' }
    });
    res.json({ message: 'Marked as spam and removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Org stats ─
router.get('/:orgSlug/stats', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment, Reaction } = req.orgModels;
    const [totalComments, totalDeleted, totalFlagged, totalReactions] = await Promise.all([
      Comment.countDocuments({ isDeleted: false }),
      Comment.countDocuments({ isDeleted: true }),
      Comment.countDocuments({ flagCount: { $gt: 0 }, isDeleted: false }),
      Reaction.countDocuments(),
    ]);
    const topPages = await Comment.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$pageUrl', count: { $sum: 1 }, title: { $first: '$pageTitle' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    res.json({ totalComments, totalDeleted, totalFlagged, totalReactions, topPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get role permission matrix 
router.get('/:orgSlug/permissions', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const userRole = getOrgRole(req.org, userId) || 'visitor';
    res.json({
      yourRole: userRole,
      permissions: PERMISSIONS,
      orgMembers: req.org.members.map(m => ({
        userId: m.user.toString(),
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Members: add/update 
router.post('/:orgSlug/members', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { userId, role = 'moderator' } = req.body;
    const isOwner = req.org.owner.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only owner can manage members' });
    }
    const existing = req.org.members.find(m => m.user.toString() === userId);
    if (existing) existing.role = role;
    else req.org.members.push({ user: userId, role });
    await req.org.save();
    res.json({ message: 'Member updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Members: remove 
router.delete('/:orgSlug/members/:userId', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const isOwner = req.org.owner.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only owner can remove members' });
    }
    req.org.members = req.org.members.filter(m => m.user.toString() !== req.params.userId);
    await req.org.save();
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get banned users 
router.get('/:orgSlug/banned', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    res.json({ bannedUsers: req.org.bannedUsers || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Ban a user from this org ─
router.post('/:orgSlug/ban', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { username, reason = '' } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });

    const targetUser = await User.findOne({ username: username.toLowerCase() });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Prevent banning the org owner
    if (targetUser._id.toString() === req.org.owner.toString()) {
      return res.status(400).json({ error: 'Cannot ban the organization owner' });
    }

    const alreadyBanned = (req.org.bannedUsers || []).find(b => b.userId === targetUser._id.toString());
    if (alreadyBanned) return res.status(400).json({ error: 'User is already banned' });

    if (!req.org.bannedUsers) req.org.bannedUsers = [];
    req.org.bannedUsers.push({
      userId: targetUser._id.toString(),
      username: targetUser.username,
      reason,
      bannedAt: new Date(),
      bannedBy: req.user._id.toString(),
    });

    await req.org.save();
    console.log(`[moderation] User ${username} banned from org ${req.params.orgSlug} by ${req.user.username}`);
    res.json({ message: `@${username} banned from this organization` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Unban a user ─
router.delete('/:orgSlug/ban/:username', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const before = (req.org.bannedUsers || []).length;
    req.org.bannedUsers = (req.org.bannedUsers || []).filter(b => b.username !== username);
    const after = req.org.bannedUsers.length;
    if (before === after) return res.status(404).json({ error: 'User not found in ban list' });
    await req.org.save();
    res.json({ message: `@${username} has been unbanned` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
