/**
 * Drop-in comment and reaction widget for any website
 * Usage: Add <div id="commex-widget"></div> and include this script
 */
(function (window, document) {
  'use strict';

  const COMMEX_VERSION = '1.0.0';
  const config = window.CommexConfig || {};
  const API_URL = config.apiUrl || 'https://commex.app'; // Will be auto-detected
  const ORG_SLUG = config.orgSlug || '';
  const PAGE_URL = config.pageUrl || window.location.href;
  const PAGE_TITLE = config.pageTitle || document.title;
  const TARGET_ID = config.targetId || 'commex-widget';
  const THEME = config.theme || 'dark';

  if (!ORG_SLUG) {
    console.error('[Commex] orgSlug is required in CommexConfig');
    return;
  }

  //  State ─
  let state = {
    user: null,
    token: null,
    comments: [],
    orgConfig: null,
    page: 1,
    loading: false,
    posting: false,
    replyingTo: null,
    editingId: null,
    gifSearchOpen: false,
    gifResults: [],
    gifSearchQuery: '',
    selectedGif: null,
    userReactions: {},
    darkMode: THEME === 'dark',
    authMode: 'login', // 'login' | 'register'
    showAuth: false,
    notification: null,
    draftText: '',     // preserved across rerenders
    draftReply: {},    // reply textarea drafts keyed by commentId
  };

  // Detect API URL from script tag
  const scripts = document.querySelectorAll('script[src]');
  for (const s of scripts) {
    if (s.src.includes('commex.js')) {
      try {
        const url = new URL(s.src);
        state.apiBaseUrl = url.origin;
      } catch (e) {}
      break;
    }
  }
  const API_BASE = state.apiBaseUrl || API_URL;

  //  Auth 
  function getSavedToken() {
    try { return localStorage.getItem('commex_token'); } catch (e) { return null; }
  }
  function saveToken(t) {
    try { localStorage.setItem('commex_token', t); } catch (e) {}
  }
  function clearToken() {
    try { localStorage.removeItem('commex_token'); localStorage.removeItem('commex_user'); } catch (e) {}
  }
  function getSavedUser() {
    try { return JSON.parse(localStorage.getItem('commex_user') || 'null'); } catch (e) { return null; }
  }
  function saveUser(u) {
    try { localStorage.setItem('commex_user', JSON.stringify(u)); } catch (e) {}
  }

  //  API calls ─
  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  //  Init 
  async function init() {
    // Restore session
    state.token = getSavedToken();
    state.user = getSavedUser();

    // Mount container
    const target = document.getElementById(TARGET_ID);
    if (!target) {
      console.error(`[Commex] #${TARGET_ID} not found`);
      return;
    }

    target.innerHTML = renderSkeleton();

    try {
      // Load org config
      const configData = await api('GET', `/api/embed/config/${ORG_SLUG}`);
      state.orgConfig = configData.org;

      // If we have a saved token, validate it
      if (state.token) {
        try {
          const me = await api('GET', '/api/auth/me');
          state.user = me.user;
          saveUser(me.user);
        } catch (e) {
          state.token = null;
          state.user = null;
          clearToken();
        }
      }

      // Load comments
      await loadComments();
      render(target);
    } catch (err) {
      target.innerHTML = `<div style="color:#ef4444;padding:20px;font-family:sans-serif">Commex: ${err.message}</div>`;
    }
  }

  async function loadComments() {
    state.loading = true;
    try {
      const data = await api('GET', `/api/comments/${ORG_SLUG}?pageUrl=${encodeURIComponent(PAGE_URL)}&page=${state.page}&sort=newest`);
      state.comments = state.page === 1 ? data.comments : [...state.comments, ...data.comments];
      state.pagination = data.pagination;
      state.userReactions = data.userReactions || {};
    } catch (e) {
      console.error('[Commex] Failed to load comments:', e);
    }
    state.loading = false;
  }

  //  Render ─
  function render(container) {
    container.innerHTML = '';
    const shadow = container.attachShadow ? container : container;
    shadow.innerHTML = buildHTML();
    attachEvents(shadow);
  }

  function renderSkeleton() {
    return `<div style="font-family:sans-serif;padding:24px;background:#0d0d0d;border-radius:12px;color:#888">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:50%;background:#1a1a1a;animation:pulse 1.5s infinite"></div>
        <div style="flex:1;height:40px;border-radius:8px;background:#1a1a1a;animation:pulse 1.5s infinite"></div>
      </div>
      <style>@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}</style>
      <p style="text-align:center;color:#555;font-size:13px">Loading Commex...</p>
    </div>`;
  }

  function buildHTML() {
    const org = state.orgConfig || {};
    const accent = org.accentColor || '#6366f1';
    const features = org.features || {};
    const commentCount = state.pagination?.total || state.comments.length;

    return `
<style>
  :host, * { box-sizing: border-box; }
  .cx-root {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0a0a0a;
    color: #e4e4e7;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #1e1e1e;
    max-width: 100%;
  }
  .cx-header {
    padding: 20px 24px 16px;
    border-bottom: 1px solid #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0d0d0d;
  }
  .cx-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cx-brand-logo {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: ${accent};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
    color: white;
    letter-spacing: -1px;
  }
  .cx-brand-name {
    font-size: 14px;
    font-weight: 600;
    color: #71717a;
    letter-spacing: 0.02em;
  }
  .cx-count {
    font-size: 13px;
    color: #52525b;
  }
  .cx-user-area {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cx-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: ${accent}33;
    border: 2px solid ${accent}55;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    color: ${accent};
    cursor: pointer;
    overflow: hidden;
  }
  .cx-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .cx-btn {
    padding: 7px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
    font-family: inherit;
  }
  .cx-btn-primary {
    background: ${accent};
    color: white;
  }
  .cx-btn-primary:hover { filter: brightness(1.1); }
  .cx-btn-ghost {
    background: transparent;
    color: #71717a;
    border: 1px solid #2a2a2a;
  }
  .cx-btn-ghost:hover { background: #1a1a1a; color: #a1a1aa; }
  .cx-btn-sm { padding: 4px 10px; font-size: 12px; }
  .cx-compose {
    padding: 20px 24px;
    border-bottom: 1px solid #141414;
  }
  .cx-compose-inner {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .cx-textarea-wrap {
    flex: 1;
    background: #111111;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .cx-textarea-wrap:focus-within {
    border-color: ${accent}88;
  }
  .cx-textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: #e4e4e7;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    padding: 12px 14px;
    outline: none;
    min-height: 80px;
    line-height: 1.6;
  }
  .cx-textarea::placeholder { color: #3f3f46; }
  .cx-toolbar {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-top: 1px solid #1a1a1a;
    gap: 4px;
  }
  .cx-tool-btn {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 16px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
  }
  .cx-tool-btn:hover { background: #1f1f1f; color: #a1a1aa; }
  .cx-tool-spacer { flex: 1; }
  .cx-gif-preview {
    padding: 8px 12px;
    position: relative;
  }
  .cx-gif-preview img {
    max-height: 120px;
    border-radius: 8px;
    border: 1px solid #2a2a2a;
  }
  .cx-gif-remove {
    position: absolute;
    top: 4px;
    right: 8px;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #a1a1aa;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cx-comments { padding: 0; }
  .cx-comment {
    padding: 16px 24px;
    border-bottom: 1px solid #111111;
    transition: background 0.1s;
  }
  .cx-comment:hover { background: #0d0d0d; }
  .cx-comment.pinned {
    background: ${accent}08;
    border-left: 3px solid ${accent};
  }
  .cx-comment-inner {
    display: flex;
    gap: 12px;
  }
  .cx-comment-body { flex: 1; min-width: 0; }
  .cx-comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .cx-author {
    font-size: 13px;
    font-weight: 600;
    color: #e4e4e7;
  }
  .cx-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cx-badge-admin { background: ${accent}33; color: ${accent}; }
  .cx-badge-pinned { background: #16a34a22; color: #4ade80; }
  .cx-time { font-size: 12px; color: #52525b; }
  .cx-edited { font-size: 11px; color: #3f3f46; font-style: italic; }
  .cx-content {
    font-size: 14px;
    line-height: 1.7;
    color: #d4d4d8;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .cx-content.deleted { color: #3f3f46; font-style: italic; }
  .cx-content img {
    max-width: 240px;
    border-radius: 8px;
    margin-top: 8px;
    display: block;
  }
  .cx-mention { color: ${accent}; font-weight: 500; }
  .cx-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .cx-action-btn {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
  }
  .cx-action-btn:hover { background: #1a1a1a; color: #a1a1aa; }
  .cx-action-btn.active { color: ${accent}; background: ${accent}15; }
  .cx-reaction-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 10px;
  }
  .cx-reaction-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 20px;
    padding: 3px 10px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    color: #a1a1aa;
    font-family: inherit;
  }
  .cx-reaction-pill:hover { border-color: ${accent}66; background: ${accent}11; }
  .cx-reaction-pill.mine { border-color: ${accent}; background: ${accent}22; color: ${accent}; }
  .cx-reaction-count { font-size: 11px; font-weight: 600; color: #71717a; }
  .cx-emoji-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px;
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    margin-top: 8px;
  }
  .cx-emoji-btn {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    transition: all 0.15s;
    line-height: 1;
  }
  .cx-emoji-btn:hover { background: #1f1f1f; transform: scale(1.2); }
  .cx-replies {
    margin-top: 12px;
    margin-left: 44px;
    border-left: 2px solid #1a1a1a;
    padding-left: 16px;
  }
  .cx-reply { padding: 10px 0; border-bottom: 1px solid #0f0f0f; }
  .cx-reply:last-child { border-bottom: none; }
  .cx-reply-form {
    margin-top: 12px;
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 10px;
    overflow: hidden;
  }
  .cx-reply-form textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: #e4e4e7;
    font-family: inherit;
    font-size: 13px;
    padding: 10px 12px;
    resize: none;
    outline: none;
    min-height: 60px;
  }
  .cx-reply-form textarea::placeholder { color: #3f3f46; }
  .cx-reply-actions {
    display: flex;
    justify-content: flex-end;
    padding: 6px 8px;
    gap: 6px;
    border-top: 1px solid #1a1a1a;
  }
  .cx-gif-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    max-height: 240px;
    overflow-y: auto;
    padding: 8px;
  }
  .cx-gif-item {
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.15s;
    aspect-ratio: 1;
    background: #1a1a1a;
  }
  .cx-gif-item:hover { border-color: ${accent}; }
  .cx-gif-item img { width: 100%; height: 100%; object-fit: cover; }
  .cx-gif-panel {
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    overflow: hidden;
    margin-top: 8px;
  }
  .cx-gif-search-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2a2a2a;
    color: #e4e4e7;
    font-family: inherit;
    font-size: 13px;
    padding: 10px 12px;
    outline: none;
  }
  .cx-gif-search-input::placeholder { color: #3f3f46; }
  .cx-load-more {
    padding: 16px;
    text-align: center;
  }
  .cx-empty {
    padding: 40px 24px;
    text-align: center;
    color: #3f3f46;
    font-size: 14px;
  }
  .cx-empty-icon { font-size: 32px; margin-bottom: 8px; }
  .cx-auth-modal {
    padding: 24px;
  }
  .cx-auth-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 20px;
    border-bottom: 1px solid #1e1e1e;
  }
  .cx-auth-tab {
    background: none;
    border: none;
    color: #52525b;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all 0.15s;
  }
  .cx-auth-tab.active { color: ${accent}; border-bottom-color: ${accent}; }
  .cx-field {
    margin-bottom: 14px;
  }
  .cx-field label {
    display: block;
    font-size: 12px;
    color: #71717a;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .cx-field input {
    width: 100%;
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    color: #e4e4e7;
    font-family: inherit;
    font-size: 13px;
    padding: 9px 12px;
    outline: none;
    transition: border-color 0.15s;
  }
  .cx-field input:focus { border-color: ${accent}88; }
  .cx-error-msg {
    color: #ef4444;
    font-size: 12px;
    padding: 8px 12px;
    background: #ef444411;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .cx-success-msg {
    color: #4ade80;
    font-size: 12px;
    padding: 8px 12px;
    background: #4ade8011;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .cx-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #e4e4e7;
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 13px;
    font-family: inherit;
    z-index: 9999;
    animation: slideIn 0.2s ease;
    max-width: 280px;
  }
  @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .cx-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid #2a2a2a;
    border-top-color: ${accent};
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .cx-powered {
    text-align: center;
    padding: 12px;
    font-size: 11px;
    color: #2a2a2a;
  }
  .cx-powered a { color: ${accent}; text-decoration: none; opacity: 0.7; }
  .cx-powered a:hover { opacity: 1; }
  @media (max-width: 480px) {
    .cx-comment { padding: 12px 16px; }
    .cx-compose { padding: 16px; }
    .cx-header { padding: 14px 16px 12px; }
    .cx-replies { margin-left: 24px; padding-left: 12px; }
  }
</style>
<div class="cx-root">
  ${buildHeader()}
  ${state.showAuth ? buildAuthForm() : ''}
  ${!state.showAuth ? buildCompose() : ''}
  ${!state.showAuth ? buildCommentList() : ''}
  ${!state.showAuth ? buildPoweredBy() : ''}
</div>`;
  }

  function buildHeader() {
    const org = state.orgConfig || {};
    const total = state.pagination?.total || 0;
    return `
<div class="cx-header">
  <div class="cx-brand">
    ${org.logo ? `<img src="${org.logo}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : `<div class="cx-brand-logo">CX</div>`}
    <span class="cx-brand-name">${org.name || 'Comments'}</span>
  </div>
  <span class="cx-count">${total} comment${total !== 1 ? 's' : ''}</span>
  <div class="cx-user-area">
    ${state.user ? `
      <div class="cx-avatar" id="cx-user-menu-btn" title="${state.user.displayName || state.user.username}">
        ${state.user.avatar ? `<img src="${state.user.avatar}" alt="">` : (state.user.displayName || state.user.username || 'U')[0].toUpperCase()}
      </div>
      <button class="cx-btn cx-btn-ghost cx-btn-sm" id="cx-logout-btn">Sign out</button>
    ` : `
      <button class="cx-btn cx-btn-primary cx-btn-sm" id="cx-signin-btn">Sign in</button>
    `}
  </div>
</div>`;
  }

  function buildCompose() {
    const org = state.orgConfig || {};
    const features = org.features || {};
    if (!state.user) return `
<div class="cx-compose">
  <div style="text-align:center;padding:12px 0;color:#52525b;font-size:14px">
    <span style="cursor:pointer;color:#${org.accentColor?.replace('#','') || '6366f1'}" id="cx-signin-link">Sign in</span> to join the conversation
  </div>
</div>`;

    return `
<div class="cx-compose">
  <div class="cx-compose-inner">
    <div class="cx-avatar" style="flex-shrink:0">
      ${state.user.avatar ? `<img src="${state.user.avatar}" alt="">` : (state.user.displayName || state.user.username || 'U')[0].toUpperCase()}
    </div>
    <div style="flex:1">
      <div class="cx-textarea-wrap">
        <textarea class="cx-textarea" id="cx-main-textarea" placeholder="Share your thoughts..." rows="3">${state.draftText}</textarea>
        ${state.selectedGif ? `
          <div class="cx-gif-preview">
            <img src="${state.selectedGif.preview}" alt="GIF">
            <button class="cx-gif-remove" id="cx-remove-gif">×</button>
          </div>` : ''}
        <div class="cx-toolbar">
          ${features.gifs !== false ? `<button class="cx-tool-btn" id="cx-gif-btn" title="Add GIF">GIF</button>` : ''}
          <button class="cx-tool-btn" id="cx-bold-btn" title="Bold"><strong>B</strong></button>
          <button class="cx-tool-btn" id="cx-italic-btn" title="Italic"><em>i</em></button>
          <button class="cx-tool-btn" id="cx-link-btn" title="Link">🔗</button>
          <span class="cx-tool-spacer"></span>
          <button class="cx-btn cx-btn-primary cx-btn-sm" id="cx-post-btn" ${state.posting ? 'disabled' : ''}>
            ${state.posting ? '<span class="cx-spinner"></span>' : 'Post'}
          </button>
        </div>
      </div>
      ${state.gifSearchOpen ? buildGifPanel() : ''}
    </div>
  </div>
</div>`;
  }

  function buildGifPanel() {
    return `
<div class="cx-gif-panel">
  <input class="cx-gif-search-input" id="cx-gif-search" placeholder="Search GIFs..." value="${state.gifSearchQuery}">
  <div class="cx-gif-grid" id="cx-gif-grid">
    ${state.gifResults.length === 0 ? '<div style="padding:20px;text-align:center;color:#52525b;font-size:12px">Search for a GIF above</div>' : ''}
    ${state.gifResults.map(gif => `
      <div class="cx-gif-item" data-gif-url="${gif.url}" data-gif-preview="${gif.preview}" data-gif-id="${gif.id}">
        <img src="${gif.preview}" alt="${gif.title}" loading="lazy">
      </div>`).join('')}
  </div>
</div>`;
  }

  function buildCommentList() {
    if (state.loading && state.comments.length === 0) {
      return `<div style="padding:32px;text-align:center"><span class="cx-spinner"></span></div>`;
    }

    if (state.comments.length === 0) {
      return `
<div class="cx-empty">
  <div class="cx-empty-icon">💬</div>
  <div>No comments yet. Be the first to share your thoughts!</div>
</div>`;
    }

    return `
<div class="cx-comments">
  ${state.comments.map(c => buildComment(c, false)).join('')}
  ${state.pagination && state.page < state.pagination.pages ? `
    <div class="cx-load-more">
      <button class="cx-btn cx-btn-ghost" id="cx-load-more-btn">Load more comments</button>
    </div>` : ''}
</div>`;
  }

  function buildComment(comment, isReply) {
    const org = state.orgConfig || {};
    const features = org.features || {};
    const isDeleted = comment.isDeleted;
    const isOwn = state.user && comment.authorId === state.user.id;
    const isOrgAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'superadmin');
    const userReaction = state.userReactions[comment._id];

    // Build reaction pills
    const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '🤔', '👀'];
    const reactionCounts = comment.reactionCounts ? 
      (comment.reactionCounts instanceof Map ? Object.fromEntries(comment.reactionCounts) : comment.reactionCounts) : {};
    
    const activePills = Object.entries(reactionCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `
        <button class="cx-reaction-pill ${userReaction === type ? 'mine' : ''}" 
                data-reaction="${type}" data-comment-id="${comment._id}">
          ${type} <span class="cx-reaction-count">${count}</span>
        </button>`).join('');

    const contentHtml = isDeleted 
      ? '<span class="cx-content deleted">[deleted]</span>'
      : `<div class="cx-content">${formatContent(comment.content)}${
          comment.gifUrl ? `<img src="${comment.gifUrl}" alt="GIF" style="max-width:240px;border-radius:8px;margin-top:8px">` : ''
        }${comment.imageUrl ? `<img src="${comment.imageUrl}" alt="" style="max-width:240px;border-radius:8px;margin-top:8px">` : ''}</div>`;

    const repliesHtml = !isReply && comment.replies?.length > 0 ? `
      <div class="cx-replies">
        ${comment.replies.map(r => buildComment(r, true)).join('')}
      </div>` : '';

    const replyForm = state.replyingTo === comment._id ? `
      <div class="cx-reply-form" style="margin-top:10px">
        <textarea placeholder="Reply to ${comment.authorName}..." id="cx-reply-${comment._id}">${state.draftReply[comment._id] || ''}</textarea>
        <div class="cx-reply-actions">
          <button class="cx-btn cx-btn-ghost cx-btn-sm" data-cancel-reply="${comment._id}">Cancel</button>
          <button class="cx-btn cx-btn-primary cx-btn-sm" data-submit-reply="${comment._id}">Reply</button>
        </div>
      </div>` : '';

    const editForm = state.editingId === comment._id ? `
      <div class="cx-reply-form" style="margin-top:10px">
        <textarea id="cx-edit-${comment._id}">${comment.content}</textarea>
        <div class="cx-reply-actions">
          <button class="cx-btn cx-btn-ghost cx-btn-sm" data-cancel-edit="${comment._id}">Cancel</button>
          <button class="cx-btn cx-btn-primary cx-btn-sm" data-submit-edit="${comment._id}">Save</button>
        </div>
      </div>` : '';

    return `
<div class="cx-comment ${comment.isPinned ? 'pinned' : ''}" id="cx-comment-${comment._id}">
  <div class="cx-comment-inner">
    <div class="cx-avatar" style="flex-shrink:0;width:${isReply ? '28px' : '36px'};height:${isReply ? '28px' : '36px'}">
      ${comment.authorAvatar ? `<img src="${comment.authorAvatar}" alt="">` : (comment.authorName || 'U')[0].toUpperCase()}
    </div>
    <div class="cx-comment-body">
      <div class="cx-comment-meta">
        <span class="cx-author">${comment.authorName}</span>
        ${comment.authorBadge === 'admin' ? '<span class="cx-badge cx-badge-admin">Admin</span>' : ''}
        ${comment.isPinned ? '<span class="cx-badge cx-badge-pinned">📌 Pinned</span>' : ''}
        <span class="cx-time">${timeAgo(comment.createdAt)}</span>
        ${comment.isEdited ? '<span class="cx-edited">edited</span>' : ''}
      </div>
      ${state.editingId !== comment._id ? contentHtml : ''}
      ${editForm}
      ${!isDeleted ? `
        <div class="cx-actions">
          ${features.reactions !== false && state.user ? `
            <button class="cx-action-btn" data-toggle-emoji="${comment._id}">😊 React</button>` : ''}
          ${state.user && features.threading !== false ? `
            <button class="cx-action-btn" data-reply-to="${comment._id}">↩ Reply</button>` : ''}
          ${features.voting !== false ? `
            <button class="cx-action-btn ${userReaction === 'upvote' ? 'active' : ''}" data-reaction="upvote" data-comment-id="${comment._id}">
              ▲ ${comment.upvotes || 0}
            </button>
            <button class="cx-action-btn ${userReaction === 'downvote' ? 'active' : ''}" data-reaction="downvote" data-comment-id="${comment._id}">
              ▼ ${comment.downvotes || 0}
            </button>` : ''}
          ${isOwn && !isDeleted ? `
            <button class="cx-action-btn" data-edit="${comment._id}">✏️ Edit</button>
            <button class="cx-action-btn" data-delete="${comment._id}">🗑 Delete</button>` : ''}
          ${isOrgAdmin ? `
            <button class="cx-action-btn" data-pin="${comment._id}">${comment.isPinned ? '📌 Unpin' : '📌 Pin'}</button>` : ''}
          ${!isOwn && state.user ? `
            <button class="cx-action-btn" data-flag="${comment._id}" title="Flag">⚑</button>` : ''}
          ${comment.replyCount > 0 && !comment.replies?.length ? `
            <button class="cx-action-btn" data-load-replies="${comment._id}">
              ↳ ${comment.replyCount} repl${comment.replyCount === 1 ? 'y' : 'ies'}
            </button>` : ''}
        </div>
        ${activePills || state.emojiPickerFor === comment._id ? `
          <div>
            ${activePills ? `<div class="cx-reaction-bar">${activePills}</div>` : ''}
            ${state.emojiPickerFor === comment._id ? `
              <div class="cx-emoji-picker">
                ${['👍','❤️','😂','😮','😢','😡','🔥','🎉','🤔','👀'].map(e => `
                  <button class="cx-emoji-btn" data-reaction="${e}" data-comment-id="${comment._id}">${e}</button>`).join('')}
              </div>` : ''}
          </div>` : ''}
      ` : ''}
      ${replyForm}
    </div>
  </div>
  ${repliesHtml}
</div>`;
  }

  function buildAuthForm() {
    const org = state.orgConfig || {};
    const accent = org.accentColor || '#6366f1';
    const isLogin = state.authMode === 'login';

    return `
<div class="cx-auth-modal">
  <div class="cx-auth-tabs">
    <button class="cx-auth-tab ${isLogin ? 'active' : ''}" id="cx-tab-login">Sign in</button>
    <button class="cx-auth-tab ${!isLogin ? 'active' : ''}" id="cx-tab-register">Create account</button>
  </div>
  ${state.authError ? `<div class="cx-error-msg">${state.authError}</div>` : ''}
  ${state.authSuccess ? `<div class="cx-success-msg">${state.authSuccess}</div>` : ''}
  ${isLogin ? `
    <div class="cx-field">
      <label>Email or username</label>
      <input type="text" id="cx-login-input" placeholder="you@example.com" autocomplete="email">
    </div>
    <div class="cx-field">
      <label>Password</label>
      <input type="password" id="cx-password-input" placeholder="••••••••" autocomplete="current-password">
    </div>
    <button class="cx-btn cx-btn-primary" id="cx-auth-submit" style="width:100%;margin-top:4px" ${state.authLoading ? 'disabled' : ''}>
      ${state.authLoading ? '<span class="cx-spinner"></span>' : 'Sign in'}
    </button>
  ` : `
    <div class="cx-field">
      <label>Username</label>
      <input type="text" id="cx-reg-username" placeholder="cooluser123" autocomplete="username">
    </div>
    <div class="cx-field">
      <label>Email</label>
      <input type="email" id="cx-reg-email" placeholder="you@example.com" autocomplete="email">
    </div>
    <div class="cx-field">
      <label>Password</label>
      <input type="password" id="cx-reg-password" placeholder="Min. 8 characters" autocomplete="new-password">
    </div>
    <button class="cx-btn cx-btn-primary" id="cx-auth-submit" style="width:100%;margin-top:4px" ${state.authLoading ? 'disabled' : ''}>
      ${state.authLoading ? '<span class="cx-spinner"></span>' : 'Create account'}
    </button>
  `}
  <div style="text-align:center;margin-top:12px">
    <button class="cx-btn cx-btn-ghost cx-btn-sm" id="cx-auth-cancel">Cancel</button>
  </div>
</div>`;
  }

  function buildPoweredBy() {
    return `<div class="cx-powered">powered by <a href="${API_BASE}" target="_blank">commex</a></div>`;
  }

  //  Event Handlers ──
  function attachEvents(root) {
    // Auth buttons
    const signinBtn = root.querySelector('#cx-signin-btn');
    if (signinBtn) signinBtn.addEventListener('click', () => { state.showAuth = true; rerender(root); });
    
    const signinLink = root.querySelector('#cx-signin-link');
    if (signinLink) signinLink.addEventListener('click', () => { state.showAuth = true; rerender(root); });

    const logoutBtn = root.querySelector('#cx-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      state.user = null; state.token = null; clearToken(); rerender(root);
    });

    // Auth form
    const tabLogin = root.querySelector('#cx-tab-login');
    if (tabLogin) tabLogin.addEventListener('click', () => { state.authMode = 'login'; state.authError = null; rerender(root); });
    const tabReg = root.querySelector('#cx-tab-register');
    if (tabReg) tabReg.addEventListener('click', () => { state.authMode = 'register'; state.authError = null; rerender(root); });
    
    const authSubmit = root.querySelector('#cx-auth-submit');
    if (authSubmit) authSubmit.addEventListener('click', () => handleAuth(root));
    
    const authCancel = root.querySelector('#cx-auth-cancel');
    if (authCancel) authCancel.addEventListener('click', () => { state.showAuth = false; rerender(root); });

    // Allow Enter key in auth inputs
    const authInputs = root.querySelectorAll('#cx-login-input, #cx-password-input, #cx-reg-username, #cx-reg-email, #cx-reg-password');
    authInputs.forEach(input => input.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleAuth(root);
    }));

    // Post comment
    const postBtn = root.querySelector('#cx-post-btn');
    if (postBtn) postBtn.addEventListener('click', () => handlePostComment(root, null));

    // GIF button
    const gifBtn = root.querySelector('#cx-gif-btn');
    if (gifBtn) gifBtn.addEventListener('click', () => { state.gifSearchOpen = !state.gifSearchOpen; rerender(root); });

    const gifSearch = root.querySelector('#cx-gif-search');
    if (gifSearch) {
      gifSearch.focus();
      gifSearch.addEventListener('input', debounce(async (e) => {
        state.gifSearchQuery = e.target.value;
        if (e.target.value.length > 1) {
          await searchGifs(e.target.value);
          rerender(root);
        }
      }, 400));
    }

    const removeGif = root.querySelector('#cx-remove-gif');
    if (removeGif) removeGif.addEventListener('click', () => { state.selectedGif = null; rerender(root); });

    // GIF items
    root.querySelectorAll('.cx-gif-item').forEach(item => {
      item.addEventListener('click', () => {
        state.selectedGif = {
          url: item.dataset.gifUrl,
          preview: item.dataset.gifPreview,
          id: item.dataset.gifId,
        };
        state.gifSearchOpen = false;
        rerender(root);
      });
    });

    // Reply buttons
    root.querySelectorAll('[data-reply-to]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.replyingTo = state.replyingTo === btn.dataset.replyTo ? null : btn.dataset.replyTo;
        state.editingId = null;
        rerender(root);
        setTimeout(() => {
          const ta = root.querySelector(`#cx-reply-${btn.dataset.replyTo}`);
          if (ta) ta.focus();
        }, 50);
      });
    });

    root.querySelectorAll('[data-cancel-reply]').forEach(btn => {
      btn.addEventListener('click', () => { state.replyingTo = null; rerender(root); });
    });

    root.querySelectorAll('[data-submit-reply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ta = root.querySelector(`#cx-reply-${btn.dataset.submitReply}`);
        if (ta) handlePostComment(root, btn.dataset.submitReply, ta.value);
      });
    });

    // Edit buttons
    root.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.editingId = state.editingId === btn.dataset.edit ? null : btn.dataset.edit;
        state.replyingTo = null;
        rerender(root);
        setTimeout(() => {
          const ta = root.querySelector(`#cx-edit-${btn.dataset.edit}`);
          if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        }, 50);
      });
    });

    root.querySelectorAll('[data-cancel-edit]').forEach(btn => {
      btn.addEventListener('click', () => { state.editingId = null; rerender(root); });
    });

    root.querySelectorAll('[data-submit-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ta = root.querySelector(`#cx-edit-${btn.dataset.submitEdit}`);
        if (!ta || !ta.value.trim()) return;
        try {
          await api('PATCH', `/api/comments/${ORG_SLUG}/${btn.dataset.submitEdit}`, { content: ta.value });
          state.editingId = null;
          await loadComments();
          rerender(root);
          showToast('Comment updated');
        } catch (e) { showToast(e.message, true); }
      });
    });

    // Delete
    root.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await api('DELETE', `/api/comments/${ORG_SLUG}/${btn.dataset.delete}`);
          await loadComments();
          rerender(root);
          showToast('Comment deleted');
        } catch (e) { showToast(e.message, true); }
      });
    });

    // Pin
    root.querySelectorAll('[data-pin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api('PATCH', `/api/comments/${ORG_SLUG}/${btn.dataset.pin}/pin`);
          await loadComments();
          rerender(root);
        } catch (e) { showToast(e.message, true); }
      });
    });

    // Flag
    root.querySelectorAll('[data-flag]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api('POST', `/api/comments/${ORG_SLUG}/${btn.dataset.flag}/flag`);
          showToast('Comment reported, thank you');
        } catch (e) { showToast(e.message, true); }
      });
    });

    // Reactions
    root.querySelectorAll('[data-reaction][data-comment-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!state.user) { state.showAuth = true; rerender(root); return; }
        try {
          const data = await api('POST', `/api/reactions/${ORG_SLUG}/${btn.dataset.commentId}`, { type: btn.dataset.reaction });
          // Update local state
          const comment = findComment(btn.dataset.commentId);
          if (comment) {
            comment.reactionCounts = data.counts;
            if (data.action === 'removed') delete state.userReactions[btn.dataset.commentId];
            else state.userReactions[btn.dataset.commentId] = data.type;
          }
          state.emojiPickerFor = null;
          rerender(root);
        } catch (e) { showToast(e.message, true); }
      });
    });

    // Emoji picker toggle
    root.querySelectorAll('[data-toggle-emoji]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.emojiPickerFor = state.emojiPickerFor === btn.dataset.toggleEmoji ? null : btn.dataset.toggleEmoji;
        rerender(root);
      });
    });

    // Load more
    const loadMoreBtn = root.querySelector('#cx-load-more-btn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', async () => {
      state.page++;
      await loadComments();
      rerender(root);
    });
  }

  //  Actions 
  async function handleAuth(root) {
    // !! Read values BEFORE any rerender — rerender destroys the DOM inputs
    const loginVal    = root.querySelector('#cx-login-input')?.value?.trim() || '';
    const passwordVal = root.querySelector('#cx-password-input')?.value || '';
    const usernameVal = root.querySelector('#cx-reg-username')?.value?.trim() || '';
    const emailVal    = root.querySelector('#cx-reg-email')?.value?.trim() || '';
    const regPassVal  = root.querySelector('#cx-reg-password')?.value || '';

    state.authLoading = true;
    state.authError = null;
    rerender(root);

    try {
      let data;
      if (state.authMode === 'login') {
        const login = loginVal;
        const password = passwordVal;
        data = await api('POST', '/api/auth/login', { login, password });
      } else {
        const username = usernameVal;
        const email = emailVal;
        const password = regPassVal;
        data = await api('POST', '/api/auth/register', { username, email, password });
      }

      state.token = data.token;
      state.user = data.user;
      saveToken(data.token);
      saveUser(data.user);
      state.showAuth = false;
      state.authLoading = false;
      await loadComments();
      rerender(root);
      showToast(`Welcome${state.authMode === 'register' ? ' to Commex' : ' back'}, ${data.user.displayName || data.user.username}!`);
    } catch (e) {
      state.authError = e.message;
      state.authLoading = false;
      rerender(root);
    }
  }

  async function handlePostComment(root, parentId, content) {
    const textarea = content !== undefined ? null : root.querySelector('#cx-main-textarea');
    const text = content !== undefined ? content : (textarea?.value || '');

    if (!text.trim() && !state.selectedGif) return;
    if (!state.user) { state.showAuth = true; rerender(root); return; }

    state.posting = true;
    rerender(root);

    try {
      await api('POST', `/api/comments/${ORG_SLUG}`, {
        pageUrl: PAGE_URL,
        pageTitle: PAGE_TITLE,
        content: text.trim(),
        parentId: parentId || undefined,
        gifUrl: state.selectedGif?.url || undefined,
      });

      state.selectedGif = null;
      state.replyingTo = null;
      state.gifSearchOpen = false;
      state.draftText = '';          // clear draft on successful post
      state.draftReply = {};
      state.page = 1;
      await loadComments();
      state.posting = false;
      rerender(root);
      showToast('Comment posted!');
    } catch (e) {
      state.posting = false;
      rerender(root);
      showToast(e.message, true);
    }
  }

  async function searchGifs(query) {
    try {
      const data = await api('GET', `/api/gifs/search?q=${encodeURIComponent(query)}&limit=12`);
      state.gifResults = data.gifs || [];
    } catch (e) {
      console.error('[Commex] GIF search failed:', e);
    }
  }

  //  Helpers 
  function rerender(root) {
    // Persist textarea drafts before wiping the DOM
    const mainTA = root.querySelector('#cx-main-textarea');
    if (mainTA) state.draftText = mainTA.value;

    // Persist reply textarea drafts
    root.querySelectorAll('[id^="cx-reply-"]').forEach(ta => {
      const id = ta.id.replace('cx-reply-', '');
      state.draftReply[id] = ta.value;
    });

    root.innerHTML = buildHTML();
    attachEvents(root);

    // Restore cursor to end of main textarea if it exists
    const restored = root.querySelector('#cx-main-textarea');
    if (restored && state.draftText) {
      restored.setSelectionRange(restored.value.length, restored.value.length);
    }

    // Restore reply drafts
    Object.entries(state.draftReply).forEach(([id, val]) => {
      const ta = root.querySelector(`#cx-reply-${id}`);
      if (ta && val) ta.value = val;
    });
  }

  function findComment(id) {
    for (const c of state.comments) {
      if (c._id === id) return c;
      if (c.replies) for (const r of c.replies) if (r._id === id) return r;
    }
    return null;
  }

  function formatContent(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:#1a1a1a;padding:1px 5px;border-radius:4px;font-size:0.9em">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>')
      .replace(/@([a-zA-Z0-9_-]+)/g, '<span class="cx-mention">@$1</span>');
  }

  function timeAgo(date) {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(date).toLocaleDateString();
  }

  function showToast(msg, isError) {
    const existing = document.querySelector('.cx-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'cx-toast';
    toast.style.borderColor = isError ? '#ef4444' : '#2a2a2a';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  //  Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
