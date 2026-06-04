const express = require('express');
const router = express.Router();
const { Organization } = require('../models/mainSchemas');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');
const { requireAuth } = require('../middleware/auth');

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

//  Get flagged comments 
router.get('/:orgSlug/flagged', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comments = await Comment.find({ isFlagged: true, isDeleted: false })
      .sort({ flagCount: -1, createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Approve a flagged comment (clear flags) ─
router.patch('/:orgSlug/:commentId/approve', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    await Comment.findByIdAndUpdate(req.params.commentId, {
      $set: { isFlagged: false, isSpam: false, flagCount: 0, flaggedBy: [] }
    });
    res.json({ message: 'Comment approved and flags cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Mark as spam ─
router.patch('/:orgSlug/:commentId/spam', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    await Comment.findByIdAndUpdate(req.params.commentId, {
      $set: { isSpam: true, isDeleted: true, content: '[removed: spam]' }
    });
    res.json({ message: 'Comment marked as spam and removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get all comments for a page (admin view, including deleted) 
router.get('/:orgSlug/page', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const { pageUrl, page = 1, limit = 50 } = req.query;
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl required' });

    const comments = await Comment.find({ pageUrl })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const total = await Comment.countDocuments({ pageUrl });
    res.json({ comments, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get org stats 
router.get('/:orgSlug/stats', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { Comment, Reaction } = req.orgModels;
    const [totalComments, totalDeleted, totalFlagged, totalReactions] = await Promise.all([
      Comment.countDocuments({ isDeleted: false }),
      Comment.countDocuments({ isDeleted: true }),
      Comment.countDocuments({ isFlagged: true }),
      Reaction.countDocuments(),
    ]);

    // Top pages by comment count
    const topPages = await Comment.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$pageUrl', count: { $sum: 1 }, title: { $first: '$pageTitle' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentComments = await Comment.countDocuments({ createdAt: { $gte: thirtyDaysAgo }, isDeleted: false });

    res.json({ totalComments, totalDeleted, totalFlagged, totalReactions, topPages, recentComments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Add/remove org member ─
router.post('/:orgSlug/members', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const { userId, role = 'moderator' } = req.body;
    const isOwner = req.org.owner.toString() === req.user._id.toString();
    if (!isOwner) return res.status(403).json({ error: 'Only owner can manage members' });

    const existing = req.org.members.find(m => m.user.toString() === userId);
    if (existing) {
      existing.role = role;
    } else {
      req.org.members.push({ user: userId, role });
    }
    await req.org.save();
    res.json({ message: 'Member added/updated', members: req.org.members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:orgSlug/members/:userId', requireAuth, loadOrgAdmin, async (req, res) => {
  try {
    const isOwner = req.org.owner.toString() === req.user._id.toString();
    if (!isOwner) return res.status(403).json({ error: 'Only owner can remove members' });

    req.org.members = req.org.members.filter(m => m.user.toString() !== req.params.userId);
    await req.org.save();
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
