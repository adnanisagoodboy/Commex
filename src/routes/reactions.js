const express = require('express');
const router = express.Router();
const { Organization } = require('../models/mainSchemas');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');
const { requireAuth } = require('../middleware/auth');

async function loadOrg(req, res, next) {
  try {
    const org = await Organization.findOne({ slug: req.params.orgSlug }).select('+dbConnectionString');
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!org.features.reactions) return res.status(403).json({ error: 'Reactions disabled for this organization' });

    const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
    req.org = org;
    req.orgModels = createOrgModels(conn);
    next();
  } catch (err) {
    res.status(500).json({ error: 'DB connection failed', detail: err.message });
  }
}

const VALID_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '🤔', '👀', 'upvote', 'downvote'];

//  React to a comment 
router.post('/:orgSlug/:commentId', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Reaction, Comment } = req.orgModels;
    const { type } = req.body;
    const userId = req.user._id.toString();
    const { commentId } = req.params;

    if (!VALID_REACTIONS.includes(type) && type !== 'custom') {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Check if user already reacted
    const existing = await Reaction.findOne({ commentId, userId });

    if (existing) {
      if (existing.type === type) {
        // Remove reaction (toggle off)
        await Reaction.deleteOne({ _id: existing._id });

        // Update comment reaction counts
        const oldType = existing.type;
        if (comment.reactionCounts.get(oldType) > 0) {
          comment.reactionCounts.set(oldType, comment.reactionCounts.get(oldType) - 1);
        }
        comment.totalReactions = Math.max(0, comment.totalReactions - 1);

        // Update vote scores
        if (oldType === 'upvote') comment.upvotes = Math.max(0, comment.upvotes - 1);
        if (oldType === 'downvote') comment.downvotes = Math.max(0, comment.downvotes - 1);
        comment.score = comment.upvotes - comment.downvotes;
        await comment.save();

        return res.json({ action: 'removed', type, counts: Object.fromEntries(comment.reactionCounts) });
      } else {
        // Change reaction type
        const oldType = existing.type;
        existing.type = type;
        await existing.save();

        // Update counts
        if (comment.reactionCounts.get(oldType) > 0) {
          comment.reactionCounts.set(oldType, comment.reactionCounts.get(oldType) - 1);
        }
        comment.reactionCounts.set(type, (comment.reactionCounts.get(type) || 0) + 1);

        if (oldType === 'upvote') comment.upvotes = Math.max(0, comment.upvotes - 1);
        if (oldType === 'downvote') comment.downvotes = Math.max(0, comment.downvotes - 1);
        if (type === 'upvote') comment.upvotes += 1;
        if (type === 'downvote') comment.downvotes += 1;
        comment.score = comment.upvotes - comment.downvotes;
        await comment.save();

        return res.json({ action: 'changed', type, counts: Object.fromEntries(comment.reactionCounts) });
      }
    }

    // Add new reaction
    await Reaction.create({ commentId, pageUrl: comment.pageUrl, userId, type });

    comment.reactionCounts.set(type, (comment.reactionCounts.get(type) || 0) + 1);
    comment.totalReactions += 1;
    if (type === 'upvote') comment.upvotes += 1;
    if (type === 'downvote') comment.downvotes += 1;
    comment.score = comment.upvotes - comment.downvotes;
    await comment.save();

    // Notify comment author
    if (req.org.features.notifications && comment.authorId !== userId) {
      const { Notification } = req.orgModels;
      await Notification.create({
        userId: comment.authorId,
        type: 'reaction',
        commentId: comment._id,
        fromUserId: userId,
        fromUserName: req.user.displayName || req.user.username,
        pageUrl: comment.pageUrl,
        preview: type,
      }).catch(() => {});
    }

    res.json({ action: 'added', type, counts: Object.fromEntries(comment.reactionCounts) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get reactions for a page 
router.get('/:orgSlug/page', requireAuth, loadOrg, async (req, res) => {
  try {
    const { PageReaction } = req.orgModels;
    const { pageUrl } = req.query;
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl required' });

    const reactions = await PageReaction.find({ pageUrl });
    const counts = {};
    for (const r of reactions) {
      counts[r.type] = (counts[r.type] || 0) + 1;
    }

    const userReaction = req.user 
      ? reactions.find(r => r.userId === req.user._id.toString())?.type || null
      : null;

    res.json({ counts, userReaction, total: reactions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
