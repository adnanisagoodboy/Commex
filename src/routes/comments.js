const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');
const { Organization } = require('../models/mainSchemas');
const { getOrgConnection } = require('../utils/database');
const { createOrgModels } = require('../models/orgSchemas');
const { requireAuth, optionalAuth } = require('../middleware/auth');

//  Middleware: load org + connect to its DB 
async function loadOrg(req, res, next) {
  const tag = `[loadOrg:${req.params.orgSlug}]`;
  try {
    console.log(`${tag} Looking up org...`);
    const org = await Organization.findOne({ slug: req.params.orgSlug }).select('+dbConnectionString');

    if (!org) {
      console.warn(`${tag} Org not found`);
      return res.status(404).json({ error: 'Organization not found' });
    }
    if (!org.isActive) {
      console.warn(`${tag} Org is inactive`);
      return res.status(404).json({ error: 'Organization not found' });
    }
    if (!org.dbConnectionString) {
      console.error(`${tag} Org has no dbConnectionString stored`);
      return res.status(500).json({ error: 'Organization database not configured' });
    }

    console.log(`${tag} Org found (id=${org._id}), connecting to org DB...`);
    const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
    console.log(`${tag} Org DB connected, readyState=${conn.readyState}`);

    req.org = org;
    req.orgModels = createOrgModels(conn);
    next();
  } catch (err) {
    console.error(`${tag} loadOrg failed:`, err.message, err.stack);
    res.status(500).json({ error: 'Failed to connect to organization database', detail: err.message });
  }
}

//  GET comments for a page ──
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
    const { pageUrl, page = 1, limit = 20, sort = 'newest' } = req.query;

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      popular: { score: -1, createdAt: -1 },
    };

    const filter = { pageUrl, isDeleted: false, parentId: null };
    const total = await Comment.countDocuments(filter);

    const topComments = await Comment.find(filter)
      .sort(sortMap[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const commentIds = topComments.map(c => c._id);
    const replies = await Comment.find({
      rootId: { $in: commentIds },
      isDeleted: false,
    }).sort({ createdAt: 1 }).lean();

    const replyMap = {};
    for (const reply of replies) {
      const key = reply.parentId.toString();
      if (!replyMap[key]) replyMap[key] = [];
      replyMap[key].push(reply);
    }

    const nested = topComments.map(comment => ({
      ...comment,
      replies: replyMap[comment._id.toString()] || [],
    }));

    let userReactions = {};
    if (req.user) {
      const { Reaction } = req.orgModels;
      const reactions = await Reaction.find({ pageUrl, userId: req.user._id.toString() }).lean();
      for (const r of reactions) {
        userReactions[r.commentId.toString()] = r.type;
      }
    }

    res.json({ comments: nested, pagination: { total, page, pages: Math.ceil(total / limit), limit }, userReactions });
  } catch (err) {
    console.error('[GET comments] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

//  POST a comment ──
router.post('/:orgSlug', requireAuth, loadOrg, [
  body('pageUrl').trim().notEmpty().withMessage('pageUrl is required'),
  body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Comment must be 1-10000 characters'),
  body('parentId').optional().isMongoId(),
], async (req, res) => {
  const tag = `[POST comment:${req.params.orgSlug}]`;
  console.log(`${tag} Request body:`, JSON.stringify({
    pageUrl: req.body.pageUrl,
    contentLength: req.body.content?.length,
    parentId: req.body.parentId,
    hasGif: !!req.body.gifUrl,
    userId: req.user?._id,
  }));

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.warn(`${tag} Validation failed:`, errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { Comment, Notification } = req.orgModels;
    const { pageUrl, pageTitle, content, parentId, gifUrl, imageUrl } = req.body;

    // Banned words check
    if (req.org.bannedWords?.length > 0) {
      const lower = content.toLowerCase();
      const found = req.org.bannedWords.find(w => lower.includes(w.toLowerCase()));
      if (found) {
        console.warn(`${tag} Banned word detected`);
        return res.status(400).json({ error: 'Comment contains prohibited content' });
      }
    }

    let depth = 0, rootId = null, parentComment = null;

    if (parentId) {
      console.log(`${tag} Looking up parent comment ${parentId}...`);
      parentComment = await Comment.findById(parentId);
      if (!parentComment) {
        console.warn(`${tag} Parent comment not found: ${parentId}`);
        return res.status(404).json({ error: 'Parent comment not found' });
      }
      depth = parentComment.depth + 1;
      rootId = parentComment.rootId || parentComment._id;
      console.log(`${tag} Reply depth=${depth}, rootId=${rootId}`);
    }

    let contentType = 'text';
    if (gifUrl && content?.trim()) contentType = 'mixed';
    else if (gifUrl) contentType = 'gif';
    else if (imageUrl) contentType = 'image';

    const mentions = (content.match(/@([a-zA-Z0-9_-]+)/g) || []).map(m => m.slice(1));

    const commentData = {
      pageUrl,
      pageTitle: pageTitle || '',
      authorId: req.user._id.toString(),
      authorName: req.user.displayName || req.user.username,
      authorAvatar: req.user.avatar || '',
      content,
      contentType,
      gifUrl: gifUrl || null,
      imageUrl: imageUrl || null,
      mentions,
      parentId: parentId || null,
      rootId,
      depth,
      isPinned: false,
    };

    console.log(`${tag} Creating comment with data:`, JSON.stringify({
      ...commentData,
      content: commentData.content.substring(0, 50) + (commentData.content.length > 50 ? '...' : ''),
    }));

    const comment = await Comment.create(commentData);
    console.log(`${tag} Comment created successfully, id=${comment._id}`);

    // Update parent reply count
    if (parentComment) {
      await Comment.findByIdAndUpdate(parentId, { $inc: { replyCount: 1 } });

      if (req.org.features?.notifications && parentComment.authorId !== req.user._id.toString()) {
        await Notification.create({
          userId: parentComment.authorId,
          type: 'reply',
          commentId: comment._id,
          fromUserId: req.user._id.toString(),
          fromUserName: req.user.displayName || req.user.username,
          pageUrl,
          pageTitle: pageTitle || '',
          preview: content.substring(0, 100),
        }).catch(e => console.warn(`${tag} Notification create failed (non-fatal):`, e.message));
      }
    }

    // @mention notifications
    if (mentions.length > 0 && req.org.features?.notifications) {
      for (const mention of mentions.slice(0, 5)) {
        if (mention !== req.user.username) {
          await Notification.create({
            userId: mention,
            type: 'mention',
            commentId: comment._id,
            fromUserId: req.user._id.toString(),
            fromUserName: req.user.displayName || req.user.username,
            pageUrl,
            preview: content.substring(0, 100),
          }).catch(() => {});
        }
      }
    }

    // Update org stats (non-fatal)
    Organization.findByIdAndUpdate(req.org._id, { $inc: { totalComments: 1 } })
      .catch(e => console.warn(`${tag} Org stats update failed (non-fatal):`, e.message));

    res.status(201).json({ comment, message: 'Comment posted' });
  } catch (err) {
    console.error(`${tag} FAILED — ${err.name}: ${err.message}`);
    console.error(`${tag} Stack:`, err.stack);
    res.status(500).json({ error: err.message, type: err.name });
  }
});

//  PATCH edit a comment ──
router.patch('/:orgSlug/:commentId', requireAuth, loadOrg, [
  body('content').trim().isLength({ min: 1, max: 10000 }),
], async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const isAuthor = comment.authorId === req.user._id.toString();
    const isOrgAdmin = req.org.members.find(
      m => m.user.toString() === req.user._id.toString() && ['admin', 'moderator'].includes(m.role)
    ) || req.org.owner.toString() === req.user._id.toString();

    if (!isAuthor && !isOrgAdmin) return res.status(403).json({ error: 'Cannot edit this comment' });

    comment.content = req.body.content;
    comment.isEdited = true;
    comment.editedAt = new Date();
    await comment.save();

    res.json({ comment, message: 'Comment updated' });
  } catch (err) {
    console.error('[PATCH comment] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

//  DELETE a comment 
router.delete('/:orgSlug/:commentId', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const isAuthor = comment.authorId === req.user._id.toString();
    const isOrgAdmin = req.org.members.find(
      m => m.user.toString() === req.user._id.toString() && ['admin', 'moderator'].includes(m.role)
    ) || req.org.owner.toString() === req.user._id.toString();

    if (!isAuthor && !isOrgAdmin) return res.status(403).json({ error: 'Cannot delete this comment' });

    comment.isDeleted = true;
    comment.content = '[deleted]';
    comment.gifUrl = null;
    comment.imageUrl = null;
    await comment.save();

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('[DELETE comment] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

//  PIN / UNPIN ──
router.patch('/:orgSlug/:commentId/pin', requireAuth, loadOrg, async (req, res) => {
  try {
    const isOrgAdmin = req.org.members.find(
      m => m.user.toString() === req.user._id.toString() && ['admin', 'moderator'].includes(m.role)
    ) || req.org.owner.toString() === req.user._id.toString();

    if (!isOrgAdmin) return res.status(403).json({ error: 'Moderator access required' });

    const { Comment } = req.orgModels;
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    comment.isPinned = !comment.isPinned;
    await comment.save();

    res.json({ isPinned: comment.isPinned, message: comment.isPinned ? 'Comment pinned' : 'Comment unpinned' });
  } catch (err) {
    console.error('[PIN comment] Error:', err.message, err.stack);
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

    res.json({ message: 'Comment flagged for review' });
  } catch (err) {
    console.error('[FLAG comment] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
