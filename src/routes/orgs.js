const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const slugify = require('../utils/slugify');
const { Organization, User } = require('../models/mainSchemas');
const { requireAuth } = require('../middleware/auth');
const { testOrgConnection, getOrgConnection, invalidateOrgConnection } = require('../utils/database');

//  Create Organization 
router.post('/', requireAuth, [
  body('name').trim().isLength({ min: 2, max: 60 }).withMessage('Name must be 2-60 characters'),
  body('dbConnectionString').trim().notEmpty().withMessage('MongoDB connection string is required'),
  body('websiteUrl').optional().isURL().withMessage('Invalid website URL'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, dbConnectionString, description, websiteUrl, accentColor } = req.body;

    // Generate unique slug
    let slug = slugify(name);
    const existing = await Organization.findOne({ slug });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    // Check name uniqueness
    const nameExists = await Organization.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (nameExists) {
      return res.status(409).json({ error: 'An organization with this name already exists' });
    }

    // Test the connection before saving
    const connTest = await testOrgConnection(dbConnectionString);
    if (!connTest.success) {
      return res.status(400).json({ 
        error: 'Could not connect to the provided MongoDB URI',
        detail: connTest.error 
      });
    }

    const org = await Organization.create({
      name,
      slug,
      owner: req.user._id,
      dbConnectionString,
      dbStatus: 'connected',
      dbLastChecked: new Date(),
      description: description || '',
      websiteUrl: websiteUrl || '',
      accentColor: accentColor || '#6366f1',
      members: [{ user: req.user._id, role: 'admin' }],
    });

    // Add org to user's owned orgs
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { ownedOrgs: org._id },
    });

    // Return without connection string
    const orgData = org.toObject();
    delete orgData.dbConnectionString;

    res.status(201).json({ message: 'Organization created successfully', org: orgData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create organization', detail: err.message });
  }
});

//  Get my organizations ──
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const orgs = await Organization.find({
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id },
      ],
    }).select('-dbConnectionString').populate('owner', 'username displayName avatar');

    res.json({ orgs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get single org by slug 
router.get('/:slug', requireAuth, async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.slug })
      .select('-dbConnectionString')
      .populate('owner', 'username displayName avatar')
      .populate('members.user', 'username displayName avatar');

    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Check access
    const isMember = org.members.some(m => m.user._id.toString() === req.user._id.toString())
      || org.owner._id.toString() === req.user._id.toString();

    if (!isMember && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ org });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Update organization 
router.patch('/:slug', requireAuth, [
  body('name').optional().trim().isLength({ min: 2, max: 60 }),
  body('websiteUrl').optional().isURL(),
  body('accentColor').optional().matches(/^#[0-9A-Fa-f]{6}$/),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const org = await Organization.findOne({ slug: req.params.slug }).select('+dbConnectionString');
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Only owner or admin can update
    const isOwner = org.owner.toString() === req.user._id.toString();
    const isAdmin = org.members.find(
      m => m.user.toString() === req.user._id.toString() && m.role === 'admin'
    );

    if (!isOwner && !isAdmin && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only org admins can update settings' });
    }

    const allowedUpdates = ['name', 'description', 'websiteUrl', 'accentColor', 'theme', 'features', 'customEmojis', 'bannedWords', 'allowedDomains', 'logo'];
    const updates = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Handle name change → regenerate slug
    if (updates.name && updates.name !== org.name) {
      const newSlug = slugify(updates.name);
      const slugExists = await Organization.findOne({ slug: newSlug, _id: { $ne: org._id } });
      updates.slug = slugExists ? `${newSlug}-${Date.now().toString(36)}` : newSlug;
    }

    // Handle new DB connection string
    if (req.body.dbConnectionString) {
      const connTest = await testOrgConnection(req.body.dbConnectionString);
      if (!connTest.success) {
        return res.status(400).json({ error: 'Could not connect to new MongoDB URI', detail: connTest.error });
      }
      updates.dbConnectionString = req.body.dbConnectionString;
      updates.dbStatus = 'connected';
      updates.dbLastChecked = new Date();
      invalidateOrgConnection(org._id.toString());
    }

    Object.assign(org, updates);
    await org.save();

    const orgData = org.toObject();
    delete orgData.dbConnectionString;

    res.json({ message: 'Organization updated', org: orgData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Test DB connection ─
router.post('/:slug/test-db', requireAuth, async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.slug }).select('+dbConnectionString');
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const isOwner = org.owner.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only the owner can test DB connection' });
    }

    const result = await testOrgConnection(org.dbConnectionString);
    
    org.dbStatus = result.success ? 'connected' : 'error';
    org.dbLastChecked = new Date();
    await org.save();

    res.json({ 
      status: result.success ? 'connected' : 'error',
      message: result.success ? 'Connection successful' : result.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Get embed snippet ──
router.get('/:slug/embed-snippet', requireAuth, async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.slug }).select('-dbConnectionString');
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const snippet = `<!-- Commex Comments Widget -->
<div id="commex-widget"></div>
<script>
  window.CommexConfig = {
    orgSlug: "${org.slug}",
    pageUrl: window.location.href,
    pageTitle: document.title,
  };
</script>
<script src="${appUrl}/embed/commex.js" async></script>`;

    res.json({ snippet, orgSlug: org.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Delete organization 
router.delete('/:slug', requireAuth, async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.slug });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    if (org.owner.toString() !== req.user._id.toString() && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only the owner can delete an organization' });
    }

    await Organization.deleteOne({ _id: org._id });
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { ownedOrgs: org._id },
    });

    res.json({ message: 'Organization deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
