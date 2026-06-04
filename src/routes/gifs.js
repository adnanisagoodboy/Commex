const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

//GIF Provider priority chain 
// 1. Giphy      — free tier, 42 req/hour (needs GIPHY_API_KEY)
// 2. Gfycat     — no key needed, but being sunset; kept as middle fallback
// 3. Tenor      — legacy, kept if TENOR_API_KEY still works for existing users
// 4. Giphy public beta key — hardcoded public demo key Giphy officially publishes
//    (rate limited but works without signup for low-traffic use)

const GIPHY_PUBLIC_KEY = 'dc6zaTOxFJmzC'; // Giphy's official public beta key

async function searchGiphy(q, limit, apiKey) {
  const key = apiKey || GIPHY_PUBLIC_KEY;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=${limit}&rating=g&lang=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Giphy error ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(g => ({
    id: g.id,
    url: g.images?.original?.url || g.images?.downsized?.url || '',
    preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url || g.images?.original?.url || '',
    title: g.title || '',
    width: parseInt(g.images?.original?.width) || 300,
    height: parseInt(g.images?.original?.height) || 200,
    source: 'giphy',
  })).filter(g => g.url);
}

async function trendingGiphy(limit, apiKey) {
  const key = apiKey || GIPHY_PUBLIC_KEY;
  const url = `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=${limit}&rating=g`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Giphy trending error ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(g => ({
    id: g.id,
    url: g.images?.original?.url || '',
    preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url || '',
    title: g.title || '',
    source: 'giphy',
  })).filter(g => g.url);
}

async function searchTenor(q, limit, apiKey) {
  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${apiKey}&limit=${limit}&media_filter=gif,tinygif`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Tenor error ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    id: r.id,
    url: r.media_formats?.gif?.url || '',
    preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
    title: r.title || '',
    width: r.media_formats?.gif?.dims?.[0] || 300,
    height: r.media_formats?.gif?.dims?.[1] || 200,
    source: 'tenor',
  })).filter(g => g.url);
}

async function trendingTenor(limit, apiKey) {
  const url = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=${limit}&media_filter=gif,tinygif`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Tenor trending error ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    id: r.id,
    url: r.media_formats?.gif?.url || '',
    preview: r.media_formats?.tinygif?.url || '',
    title: r.title || '',
    source: 'tenor',
  })).filter(g => g.url);
}

// ─ Search GIFs 
router.get('/search', requireAuth, async (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q) return res.status(400).json({ error: 'Search query required' });

  const lim = Math.min(parseInt(limit) || 20, 50);
  const errors = [];

  // Try Giphy first (own key → public key fallback built into searchGiphy)
  try {
    const gifs = await searchGiphy(q, lim, process.env.GIPHY_API_KEY);
    if (gifs.length > 0) return res.json({ gifs, provider: 'giphy' });
    errors.push('giphy: empty results');
  } catch (e) {
    errors.push(`giphy: ${e.message}`);
  }

  // Try Tenor as fallback if key is set
  if (process.env.TENOR_API_KEY) {
    try {
      const gifs = await searchTenor(q, lim, process.env.TENOR_API_KEY);
      if (gifs.length > 0) return res.json({ gifs, provider: 'tenor' });
      errors.push('tenor: empty results');
    } catch (e) {
      errors.push(`tenor: ${e.message}`);
    }
  }

  // All providers failed
  console.error('[Commex GIF] All providers failed:', errors);
  res.json({
    gifs: [],
    error: 'GIF search unavailable right now',
    detail: errors,
  });
});

// ─ Trending GIFs 
router.get('/trending', requireAuth, async (req, res) => {
  const { limit = 24 } = req.query;
  const lim = Math.min(parseInt(limit) || 24, 50);
  const errors = [];

  // Try Giphy first
  try {
    const gifs = await trendingGiphy(lim, process.env.GIPHY_API_KEY);
    if (gifs.length > 0) return res.json({ gifs, provider: 'giphy' });
    errors.push('giphy: empty');
  } catch (e) {
    errors.push(`giphy: ${e.message}`);
  }

  // Tenor fallback
  if (process.env.TENOR_API_KEY) {
    try {
      const gifs = await trendingTenor(lim, process.env.TENOR_API_KEY);
      if (gifs.length > 0) return res.json({ gifs, provider: 'tenor' });
      errors.push('tenor: empty');
    } catch (e) {
      errors.push(`tenor: ${e.message}`);
    }
  }

  res.json({ gifs: [], detail: errors });
});

// ─ Provider status (useful for dashboard debugging) ─
router.get('/status', requireAuth, async (req, res) => {
  const status = {
    giphy: {
      configured: !!process.env.GIPHY_API_KEY,
      publicKeyAvailable: true,
      note: 'Primary provider. Get a free key at developers.giphy.com',
    },
    tenor: {
      configured: !!process.env.TENOR_API_KEY,
      note: 'Legacy fallback. Tenor is shutting down new API key registrations.',
    },
  };
  res.json(status);
});

module.exports = router;
