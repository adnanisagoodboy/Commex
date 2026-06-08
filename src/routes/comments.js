const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');
const { Organization, User } = require('../models/mainSchemas');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { getOrgRole, hasPermission } = require('../utils/permissions');
const { getRank } = require('../utils/ranks');

//  Load org + connect 
async function loadOrg(req, res, next) {
  const tag = `[loadOrg:${req.params.orgSlug}]`;
  try {
    const org = await Organization.findOne({ slug: req.params.orgSlug }).select('+dbConnectionString');
    if (!org || !org.isActive) return res.status(404).json({ error: 'Organization not found' });
    if (!org.dbConnectionString) return res.status(500).json({ error: 'Organization database not configured' });
    const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
    req.org = org;
    req.orgModels = createOrgModels(conn);
    next();
  } catch (err) {
    console.error(`${tag} loadOrg failed:`, err.message);
    res.status(500).json({ error: 'Failed to connect to organization database', detail: err.message });
  }
}

//  GET comments 
router.get('/:orgSlug', optionalAuth, loadOrg, [
  query('pageUrl').trim().notEmpty().withMessage('pageUrl is required'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sort').optional().isIn(['newest', 'oldest', 'popular']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { Comment } = req.orgModels;
    const { pageUrl, page = 1, limit = 10, sort = 'newest' } = req.query;
    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, popular: { score: -1, createdAt: -1 } };

    // Only show approved comments publicly; pending shown to admins/mods
    const userId = req.user?._id?.toString();
    const role = req.user ? getOrgRole(req.org, userId) : null;
    const canSeePending = role && ['owner','admin','moderator'].includes(role);

    const statusFilter = canSeePending
      ? { $in: ['approved', 'pending'] }
      : 'approved';

    const filter = { pageUrl, isDeleted: false, parentId: null, status: statusFilter };
    const total = await Comment.countDocuments({ ...filter, status: 'approved' });

    const topComments = await Comment.find(filter)
      .sort(sortMap[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const commentIds = topComments.map(c => c._id);
    const replies = await Comment.find({
      rootId: { $in: commentIds },
      isDeleted: false,
      status: canSeePending ? { $in: ['approved','pending'] } : 'approved',
    }).sort({ createdAt: 1 }).lean();

    const replyMap = {};
    for (const r of replies) {
      const key = r.parentId.toString();
      if (!replyMap[key]) replyMap[key] = [];
      replyMap[key].push(r);
    }

    const nested = topComments.map(c => ({ ...c, replies: replyMap[c._id.toString()] || [] }));

    let userReactions = {};
    if (req.user) {
      const { Reaction } = req.orgModels;
      const reactions = await Reaction.find({ pageUrl, userId: req.user._id.toString() }).lean();
      for (const r of reactions) userReactions[r.commentId.toString()] = r.type;
    }

    // ── Inject live rank for each unique author ──
    // Collect all unique authorIds (skip anon_ prefixed)
    const allComments = [...nested, ...nested.flatMap(c => c.replies || [])];
    const authorIds = [...new Set(
      allComments.map(c => c.authorId).filter(id => id && !id.startsWith('anon_'))
    )];

    let rankMap = {};
    if (authorIds.length > 0) {
      try {
        const users = await User.find({ _id: { $in: authorIds } })
          .select('_id commentCount').lean();
        for (const u of users) {
          const rank = getRank(u.commentCount || 0);
          rankMap[u._id.toString()] = { id: rank.id, label: rank.label, emoji: rank.emoji, color: rank.color };
        }
      } catch(e) {
        console.warn('[GET comments] rank lookup failed (non-fatal):', e.message);
      }
    }

    // Attach live rank to every comment
    function attachRank(c) {
      c.authorRank = rankMap[c.authorId] || null;
      return c;
    }
    const nestedWithRank = nested.map(c => ({
      ...attachRank(c),
      replies: (c.replies || []).map(attachRank),
    }));

    res.json({
      comments: nestedWithRank,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
      userReactions,
    });
  } catch (err) {
    console.error('[GET comments]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

//  POST comment 
router.post('/:orgSlug', requireAuth, loadOrg, [
  body('pageUrl').trim().notEmpty().withMessage('pageUrl is required'),
  body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Comment must be 1-10000 characters'),
  body('parentId').optional().isMongoId(),
], async (req, res) => {
  const tag = `[POST:${req.params.orgSlug}]`;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { Comment, Notification } = req.orgModels;
    const { pageUrl, pageTitle, content, parentId, gifUrl, imageUrl } = req.body;
    const userId = req.user._id.toString();

    // ── Permission & ban check 
    const orgBan = (req.org.bannedUsers || []).find(b => b.userId === userId);
    if (orgBan) {
      return res.status(403).json({ error: 'You are banned from this organization', reason: orgBan.reason });
    }
    if (!hasPermission(req.org, userId, 'comment', req.user.role === 'superadmin')) {
      return res.status(403).json({ error: 'You do not have permission to comment here' });
    }

    // ── Banned words 
    if (req.org.bannedWords?.length > 0) {
      const lower = content.toLowerCase();
      const hit = req.org.bannedWords.find(w => lower.includes(w.toLowerCase()));
      if (hit) {
        console.warn(`${tag} Banned word hit`);
        return res.status(400).json({ error: 'Your comment contains a prohibited word' });
      }
    }

    // ── Threading 
    let depth = 0, rootId = null, parentComment = null;
    if (parentId) {
      parentComment = await Comment.findById(parentId);
      if (!parentComment) return res.status(404).json({ error: 'Parent comment not found' });
      depth = parentComment.depth + 1;
      rootId = parentComment.rootId || parentComment._id;
    }

    // ── Content type 
    let contentType = 'text';
    if (gifUrl && content?.trim()) contentType = 'mixed';
    else if (gifUrl) contentType = 'gif';
    else if (imageUrl) contentType = 'image';

    const mentions = (content.match(/@([a-zA-Z0-9_-]+)/g) || []).map(m => m.slice(1));

    // ── Author info + badge + rank ──
    let authorId2, authorName, authorAvatar, authorBadge;
    let orgRole = null;

    if (req.user) {
      orgRole = getOrgRole(req.org, userId);
      const badgeMap = { owner: 'owner', admin: 'admin', moderator: 'moderator' };
      authorBadge = badgeMap[orgRole] || '';
      authorId2 = userId;
      authorName = req.user.displayName || req.user.username;
      authorAvatar = req.user.avatar || '';
    } else {
      // Anonymous commenter
      authorBadge = '';
      authorId2 = `anon_${Date.now()}`;
      authorName = req.body.anonName || 'Anonymous';
      authorAvatar = '';
    }

    // ── Approval status 
    const bypassApproval = ['owner','admin','moderator'].includes(orgRole) || req.user?.role === 'superadmin';
    const status = (req.org.features?.requireApproval && !bypassApproval) ? 'pending' : 'approved';

    if (status === 'pending') {
      console.log(`${tag} Comment held for approval (requireApproval=true, role=${orgRole})`);
    }

    const comment = await Comment.create({
      pageUrl, pageTitle: pageTitle || '',
      authorId: authorId2,
      authorName,
      authorAvatar,
      authorBadge,
      content, contentType,
      gifUrl: gifUrl || null,
      imageUrl: imageUrl || null,
      mentions,
      parentId: parentId || null,
      rootId, depth,
      status,
    });

    console.log(`${tag} Comment created id=${comment._id} status=${status}`);

    // ── Update parent reply count 
    if (parentComment && status === 'approved') {
      await Comment.findByIdAndUpdate(parentId, { $inc: { replyCount: 1 } });
      if (req.user && req.org.features?.notifications && parentComment.authorId !== userId) {
        await Notification.create({
          userId: parentComment.authorId,
          type: 'reply', commentId: comment._id,
          fromUserId: userId, fromUserName: req.user.displayName || req.user.username,
          pageUrl, pageTitle: pageTitle || '',
          preview: content.substring(0, 100),
        }).catch(e => console.warn(`${tag} Reply notif failed:`, e.message));
      }
    }

    // ── @mention notifications 
    if (req.user && mentions.length > 0 && req.org.features?.notifications && status === 'approved') {
      for (const mention of mentions.slice(0, 5)) {
        if (mention.toLowerCase() === req.user.username.toLowerCase()) continue;
        try {
          const mentioned = await User.findOne({ username: mention.toLowerCase() }).select('_id');
          if (!mentioned) continue;
          await Notification.create({
            userId: mentioned._id.toString(),
            type: 'mention', commentId: comment._id,
            fromUserId: userId, fromUserName: req.user.displayName || req.user.username,
            pageUrl, pageTitle: pageTitle || '',
            preview: content.substring(0, 100),
          });
          console.log(`${tag} Mention notif sent to ${mentioned._id} (@${mention})`);
        } catch (e) {
          console.warn(`${tag} Mention notif failed for @${mention}:`, e.message);
        }
      }
    }

    // ── Org stats + user rank counter (non-blocking) 
    if (status === 'approved') {
      Organization.findByIdAndUpdate(req.org._id, { $inc: { totalComments: 1 } }).catch(() => {});
      // Increment user's global comment count (used for ranking)
      User.findByIdAndUpdate(req.user._id, { $inc: { commentCount: 1 } }).catch(() => {});
    }

    const message = status === 'pending'
      ? 'Comment submitted and awaiting approval'
      : 'Comment posted';

    res.status(201).json({ comment, message, status });
  } catch (err) {
    console.error(`[POST comment] ${err.name}: ${err.message}\n${err.stack}`);
    res.status(500).json({ error: err.message, type: err.name });
  }
});

//  PATCH edit 
router.patch('/:orgSlug/:commentId', requireAuth, loadOrg, [
  body('content').trim().isLength({ min: 1, max: 10000 }),
], async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const isAuthor = comment.authorId === req.user._id.toString();
    const canEdit = isAuthor || hasPermission(req.org, req.user._id, 'edit_any_comment', req.user.role === 'superadmin');
    if (!canEdit) return res.status(403).json({ error: 'Cannot edit this comment' });
    comment.content = req.body.content;
    comment.isEdited = true;
    comment.editedAt = new Date();
    await comment.save();
    res.json({ comment, message: 'Comment updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  DELETE 
router.delete('/:orgSlug/:commentId', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const isAuthor = comment.authorId === req.user._id.toString();
    const canDelete = isAuthor || hasPermission(req.org, req.user._id, 'delete_any_comment', req.user.role === 'superadmin');
    if (!canDelete) return res.status(403).json({ error: 'Cannot delete this comment' });
    comment.isDeleted = true;
    comment.content = '[deleted]';
    comment.gifUrl = null;
    comment.imageUrl = null;
    await comment.save();
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  PIN 
router.patch('/:orgSlug/:commentId/pin', requireAuth, loadOrg, async (req, res) => {
  try {
    if (!hasPermission(req.org, req.user._id, 'pin_comment', req.user.role === 'superadmin')) {
      return res.status(403).json({ error: 'Moderator access required to pin comments' });
    }
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    comment.isPinned = !comment.isPinned;
    await comment.save();
    res.json({ isPinned: comment.isPinned, message: comment.isPinned ? 'Pinned' : 'Unpinned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  FLAG 
router.post('/:orgSlug/:commentId/flag', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const userId = req.user._id.toString();
    if (comment.flaggedBy.includes(userId)) return res.status(400).json({ error: 'Already flagged' });
    comment.flaggedBy.push(userId);
    comment.flagCount += 1;
    if (comment.flagCount >= 3) comment.isFlagged = true;
    await comment.save();
    res.json({ message: 'Comment flagged for review', flagCount: comment.flagCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  APPROVE / REJECT (pending comments) 
router.patch('/:orgSlug/:commentId/approve', requireAuth, loadOrg, async (req, res) => {
  try {
    if (!hasPermission(req.org, req.user._id, 'approve_comments', req.user.role === 'superadmin')) {
      return res.status(403).json({ error: 'No permission to approve comments' });
    }
    const { Comment } = req.orgModels;
    const comment = await Comment.findByIdAndUpdate(
      req.params.commentId,
      { $set: { status: 'approved' } },
      { new: true }
    );
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    Organization.findByIdAndUpdate(req.org._id, { $inc: { totalComments: 1 } }).catch(() => {});
    res.json({ message: 'Comment approved', comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:orgSlug/:commentId/reject', requireAuth, loadOrg, async (req, res) => {
  try {
    if (!hasPermission(req.org, req.user._id, 'approve_comments', req.user.role === 'superadmin')) {
      return res.status(403).json({ error: 'No permission to reject comments' });
    }
    const { Comment } = req.orgModels;
    await Comment.findByIdAndUpdate(req.params.commentId, { $set: { status: 'rejected', isDeleted: true, content: '[rejected by moderator]' } });
    res.json({ message: 'Comment rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
