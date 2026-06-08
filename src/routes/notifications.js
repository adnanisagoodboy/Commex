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
    const conn = await getOrgConnection(org._id.toString(), org.dbConnectionString);
    req.org = org;
    req.orgModels = createOrgModels(conn);
    next();
  } catch (err) {
    res.status(500).json({ error: 'DB connection failed', detail: err.message });
  }
}

//  Mark notifications read in a specific org 
// Called by the embed widget: PATCH /api/notifications/:orgSlug/read
router.patch('/:orgSlug/read', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Notification } = req.orgModels;
    const userId = req.user._id.toString();
    const { ids } = req.body; // array of IDs, or empty/absent = mark all

    const filter = { userId };
    if (ids && ids.length > 0) filter._id = { $in: ids };

    const result = await Notification.updateMany(filter, { $set: { isRead: true } });
    console.log(`[notif read] Marked ${result.modifiedCount} notifications read for user ${userId} in org ${req.params.orgSlug}`);

    res.json({ message: 'Marked as read', modified: result.modifiedCount });
  } catch (err) {
    console.error('[notif read] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//  Get notifications for a specific org ─
router.get('/:orgSlug', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Notification } = req.orgModels;
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const filter = { userId: req.user._id.toString() };
    if (unreadOnly === 'true') filter.isRead = false;

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const unreadCount = await Notification.countDocuments({ userId: req.user._id.toString(), isRead: false });
    res.json({ notifications, total, unreadCount, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Delete a notification ─
router.delete('/:orgSlug/:notifId', requireAuth, loadOrg, async (req, res) => {
  try {
    const { Notification } = req.orgModels;
    await Notification.deleteOne({ _id: req.params.notifId, userId: req.user._id.toString() });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
