const express = require('express');
const router = express.Router();
const { Organization } = require('../models/mainSchemas');

//  Get org config for embed widget 
router.get('/config/:orgSlug', async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.orgSlug, isActive: true })
      .select('-dbConnectionString -bannedWords');

    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Domain restriction check
    const origin = req.headers.origin || req.headers.referer;
    if (org.allowedDomains?.length > 0 && origin) {
      try {
        const originHost = new URL(origin).hostname;
        const isAllowed = org.allowedDomains.some(d =>
          originHost === d || originHost.endsWith(`.${d}`)
        );
        if (!isAllowed) return res.status(403).json({ error: 'Domain not authorized' });
      } catch (_) {}
    }

    // Expose owner + member IDs so embed can show pin/flag to correct users
    const memberIds = org.members.map(m => m.user.toString());

    res.json({
      org: {
        id: org._id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        accentColor: org.accentColor,
        theme: org.theme,
        features: org.features,
        customEmojis: org.customEmojis,
        websiteUrl: org.websiteUrl,
        // These let the embed know who can moderate
        ownerId: org.owner.toString(),
        memberIds,
      },
      apiUrl: process.env.APP_URL || 'http://localhost:3000',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
