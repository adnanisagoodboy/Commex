/**
 * Commex Embed Script v2.0
 * Drop-in comment & reaction widget
 */
(function (window, document) {
  'use strict';

  const config   = window.CommexConfig || {};
  const ORG_SLUG = config.orgSlug || '';
  const PAGE_URL = config.pageUrl || window.location.href;
  const PAGE_TITLE = config.pageTitle || document.title;
  const TARGET_ID  = config.targetId || 'commex-widget';

  if (!ORG_SLUG) { console.error('[Commex] orgSlug required'); return; }

  // Auto-detect API base from script src
  let API_BASE = config.apiUrl || '';
  if (!API_BASE) {
    const s = document.querySelector('script[src*="commex.js"]');
    if (s) { try { API_BASE = new URL(s.src).origin; } catch(_){} }
  }
  if (!API_BASE) API_BASE = window.location.origin;

  //  State 
  const S = {
    user: null, token: null,
    comments: [], orgConfig: null,
    page: 1, totalPages: 1, totalComments: 0,
    sort: 'newest',
    loading: false, posting: false,
    replyingTo: null, editingId: null,
    gifOpen: false, gifResults: [], gifQuery: '', gifLoading: false,
    selectedGif: null,
    userReactions: {},
    authMode: 'login', showAuth: false,
    authError: null, authLoading: false,
    emojiPickerFor: null,
    draftText: '', draftReply: {},
    flagged: {},       // commentId → true if user flagged it
    notifications: [],
    userRank: null,     // current user's rank object
    unreadCount: 0,
    showNotifs: false,  // notification dropdown open
  };

  //  Persist auth ─
  function loadAuth() {
    try { S.token = localStorage.getItem('cx_token'); S.user = JSON.parse(localStorage.getItem('cx_user') || 'null'); } catch(_){}
  }
  function saveAuth(token, user) {
    try { localStorage.setItem('cx_token', token); localStorage.setItem('cx_user', JSON.stringify(user)); } catch(_){}
  }
  function clearAuth() {
    try { localStorage.removeItem('cx_token'); localStorage.removeItem('cx_user'); } catch(_){}
  }

  //  API ─
  async function api(method, path, body) {
    const h = { 'Content-Type': 'application/json' };
    if (S.token) h['Authorization'] = `Bearer ${S.token}`;
    const r = await fetch(API_BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  //  Init 
  async function init() {
    loadAuth();
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    target.innerHTML = skeleton();
    try {
      const cfg = await api('GET', `/api/embed/config/${ORG_SLUG}`);
      S.orgConfig = cfg.org;
      if (S.token) {
        try { const me = await api('GET', '/api/auth/me'); S.user = me.user; saveAuth(S.token, me.user); }
        catch(_) { S.token = null; S.user = null; clearAuth(); }
      }
      await loadComments(true);
      if (S.user) { await loadNotifications(); await loadUserRank(); }
      mount(target);
    } catch(e) {
      target.innerHTML = `<div style="color:#ef4444;padding:20px;font-family:sans-serif;background:#0a0a0a;border-radius:12px">Commex: ${e.message}</div>`;
    }
  }

  async function loadComments(reset) {
    S.loading = true;
    if (reset) { S.page = 1; S.comments = []; }
    try {
      const d = await api('GET', `/api/comments/${ORG_SLUG}?pageUrl=${encodeURIComponent(PAGE_URL)}&page=${S.page}&limit=10&sort=${S.sort}`);
      if (reset) S.comments = d.comments;
      else S.comments = [...S.comments, ...d.comments];
      S.totalPages = d.pagination?.pages || 1;
      S.totalComments = d.pagination?.total || S.comments.length;
      S.userReactions = { ...S.userReactions, ...(d.userReactions || {}) };
    } catch(e) { console.error('[Commex]', e); }
    S.loading = false;
  }

  async function loadUserRank() {
    try {
      const d = await api('GET', '/api/users/me/ranks');
      S.userRank = d.currentRank;
      S.userNextRank = d.nextRank;
      S.userRankProgress = d.progress;
      S.userCommentCount = d.commentCount;
    } catch(e) { S.userRank = null; }
  }

  async function loadNotifications() {
    try {
      const d = await api('GET', '/api/users/me/notifications');
      S.notifications = d.notifications || [];
      S.unreadCount = d.unreadCount || 0;
    } catch(e) { S.notifications = []; S.unreadCount = 0; }
  }

  async function markNotifsRead(ids) {
    try {
      // Mark read in this org's DB (notifications are stored per-org)
      await api('PATCH', `/api/notifications/${ORG_SLUG}/read`, { ids: ids || [] });
      S.notifications.forEach(n => {
        if (!ids || ids.length === 0 || ids.includes(String(n._id))) n.isRead = true;
      });
      S.unreadCount = S.notifications.filter(n => !n.isRead).length;
    } catch(e) { console.warn('[Commex] markNotifsRead failed:', e.message); }
  }

  // ── Mount / Rerender ─────────────────────────────────────────────────────────
  function mount(el) { el.innerHTML = buildAll(); bind(el); }

  function rerender(el) {
    const ta = el.querySelector('#cx-main-textarea');
    if (ta) S.draftText = ta.value;
    el.querySelectorAll('[id^="cx-reply-"]').forEach(t => { S.draftReply[t.id.replace('cx-reply-','')] = t.value; });
    el.innerHTML = buildAll();
    bind(el);
    const rta = el.querySelector('#cx-main-textarea');
    if (rta && S.draftText) rta.setSelectionRange(rta.value.length, rta.value.length);
  }

  //  CSS ─
  function css() {
    const a = (S.orgConfig?.accentColor) || '#7c3aed';
    const a2 = a + '33'; const a3 = a + '18';
    return `<style>
*{box-sizing:border-box;margin:0;padding:0}
.cx{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#080808;color:#e4e4e7;border-radius:16px;overflow:hidden;border:1px solid #1a1a1a;max-width:100%}
.cx-hd{padding:16px 20px;border-bottom:1px solid #141414;display:flex;align-items:center;gap:10px;background:#0d0d0d;flex-wrap:wrap}
.cx-hd-brand{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.cx-hd-logo{width:26px;height:26px;border-radius:6px;background:${a};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;overflow:hidden}
.cx-hd-logo img{width:100%;height:100%;object-fit:cover}
.cx-hd-name{font-size:13px;font-weight:600;color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-hd-count{font-size:12px;color:#3f3f46;white-space:nowrap}
.cx-hd-user{display:flex;align-items:center;gap:6px;flex-shrink:0}
.cx-av{width:30px;height:30px;border-radius:50%;background:${a2};border:2px solid ${a};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${a};cursor:pointer;overflow:hidden;flex-shrink:0}
.cx-av img{width:100%;height:100%;object-fit:cover}
.cx-btn{padding:6px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
.cx-btn:disabled{opacity:.5;cursor:not-allowed}
.cx-primary{background:${a};color:#fff}
.cx-primary:hover:not(:disabled){filter:brightness(1.12)}
.cx-ghost{background:transparent;color:#71717a;border:1px solid #2a2a2a}
.cx-ghost:hover:not(:disabled){background:#1a1a1a;color:#a1a1aa}

/* sort bar */
.cx-sortbar{display:flex;align-items:center;gap:6px;padding:10px 20px;border-bottom:1px solid #111;background:#0a0a0a;flex-wrap:wrap}
.cx-sort-label{font-size:11px;color:#3f3f46;font-weight:500;margin-right:2px}
.cx-sort-btn{padding:4px 10px;border-radius:6px;border:1px solid #1e1e1e;background:transparent;color:#52525b;font-family:inherit;font-size:11px;cursor:pointer;transition:all .15s}
.cx-sort-btn:hover{border-color:#3a3a3a;color:#a1a1aa}
.cx-sort-btn.active{background:${a2};border-color:${a};color:${a}}

/* compose */
.cx-compose{padding:16px 20px;border-bottom:1px solid #111}
.cx-compose-row{display:flex;gap:10px;align-items:flex-start}
.cx-wrap{flex:1;background:#0f0f0f;border:1px solid #222;border-radius:12px;overflow:hidden;transition:border-color .15s}
.cx-wrap:focus-within{border-color:${a}88}
.cx-ta{width:100%;background:transparent;border:none;color:#e4e4e7;font-family:inherit;font-size:13.5px;resize:none;padding:11px 13px;outline:none;min-height:76px;line-height:1.65}
.cx-ta::placeholder{color:#333}
.cx-bar{display:flex;align-items:center;padding:6px 10px;border-top:1px solid #161616;gap:2px}
.cx-tb{background:none;border:none;color:#444;cursor:pointer;padding:5px 7px;border-radius:5px;font-size:14px;font-family:inherit;transition:all .15s;line-height:1;display:flex;align-items:center}
.cx-tb:hover{background:#1a1a1a;color:#a1a1aa}
.cx-tb.active{color:${a};background:${a3}}
.cx-spacer{flex:1}
.cx-gif-pre{padding:6px 12px;position:relative}
.cx-gif-pre img{max-height:100px;border-radius:7px;border:1px solid #222}
.cx-gif-rm{position:absolute;top:2px;right:8px;background:#080808;border:1px solid #222;color:#a1a1aa;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;line-height:1}

/* gif panel */
.cx-gif-panel{background:#0d0d0d;border:1px solid #1e1e1e;border-radius:10px;margin-top:8px;overflow:hidden}
.cx-gif-si{width:100%;background:transparent;border:none;border-bottom:1px solid #1e1e1e;color:#e4e4e7;font-family:inherit;font-size:13px;padding:9px 12px;outline:none}
.cx-gif-si::placeholder{color:#333}
.cx-gif-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;max-height:200px;overflow-y:auto;padding:8px}
.cx-gif-item{border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .12s;aspect-ratio:1;background:#1a1a1a}
.cx-gif-item:hover{border-color:${a}}
.cx-gif-item img{width:100%;height:100%;object-fit:cover}

/* comments */
.cx-list{padding:0}
.cx-comment{padding:14px 20px;border-bottom:1px solid #0f0f0f;transition:background .1s}
.cx-comment:hover{background:#0b0b0b}
.cx-comment.pinned{background:${a3};border-left:3px solid ${a}}
.cx-ci{display:flex;gap:10px}
.cx-cb{flex:1;min-width:0}
.cx-meta{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap}
.cx-author{font-size:13px;font-weight:600;color:#e4e4e7}
.cx-badge{font-size:10px;font-weight:600;padding:2px 5px;border-radius:4px;text-transform:uppercase;letter-spacing:.04em}
.cx-badge-admin{background:${a2};color:${a}}
.cx-badge-pin{background:#16a34a22;color:#4ade80}
.cx-time{font-size:11px;color:#3f3f46}
.cx-edited{font-size:10px;color:#2a2a2a;font-style:italic}
.cx-content{font-size:13.5px;line-height:1.7;color:#d4d4d8;word-break:break-word;white-space:pre-wrap}
.cx-content.del{color:#2a2a2a;font-style:italic}
.cx-content img{max-width:220px;border-radius:7px;margin-top:7px;display:block}
.cx-content strong{color:#e4e4e7;font-weight:600}
.cx-content em{font-style:italic;color:#c4c4c8}
.cx-content code{background:#151515;padding:1px 5px;border-radius:4px;font-size:.88em;font-family:'JetBrains Mono',monospace;color:#a78bfa}
.cx-content a{color:${a};text-decoration:underline;text-underline-offset:2px}
.cx-mention{color:${a};font-weight:500}
.cx-actions{display:flex;align-items:center;gap:2px;margin-top:8px;flex-wrap:wrap}
.cx-act{background:none;border:none;color:#3f3f46;cursor:pointer;font-size:12px;padding:3px 7px;border-radius:5px;transition:all .15s;display:flex;align-items:center;gap:3px;font-family:inherit}
.cx-act:hover{background:#141414;color:#71717a}
.cx-act.on{color:${a};background:${a3}}
.cx-act.flag-done{color:#ef4444;opacity:.6;cursor:default}
.cx-rx-bar{display:flex;flex-wrap:wrap;gap:3px;margin-top:7px}
.cx-pill{display:flex;align-items:center;gap:3px;background:#0f0f0f;border:1px solid #1e1e1e;border-radius:20px;padding:3px 9px;font-size:12px;cursor:pointer;transition:all .15s;color:#71717a;font-family:inherit}
.cx-pill:hover{border-color:${a}66;background:${a3}}
.cx-pill.mine{border-color:${a};background:${a2};color:${a}}
.cx-pill-n{font-size:10px;font-weight:600;color:#52525b}
.cx-ep{display:flex;flex-wrap:wrap;gap:3px;padding:7px;background:#0f0f0f;border:1px solid #1e1e1e;border-radius:9px;margin-top:6px}
.cx-eb{background:none;border:none;font-size:17px;cursor:pointer;padding:3px 5px;border-radius:5px;transition:all .12s;line-height:1}
.cx-eb:hover{background:#1a1a1a;transform:scale(1.2)}
.cx-replies{margin-top:10px;margin-left:38px;border-left:2px solid #141414;padding-left:14px}
.cx-reply-item{padding:8px 0;border-bottom:1px solid #0d0d0d}
.cx-reply-item:last-child{border-bottom:none}
.cx-rf{margin-top:8px;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:9px;overflow:hidden}
.cx-rf textarea{width:100%;background:transparent;border:none;color:#e4e4e7;font-family:inherit;font-size:13px;padding:9px 11px;resize:none;outline:none;min-height:54px}
.cx-rf textarea::placeholder{color:#333}
.cx-rf-actions{display:flex;justify-content:flex-end;padding:5px 7px;gap:5px;border-top:1px solid #141414}

/* load more */
.cx-loadmore{padding:14px;text-align:center}
.cx-empty{padding:36px 20px;text-align:center;color:#2a2a2a;font-size:13px}
.cx-empty-icon{font-size:28px;margin-bottom:8px}

/* auth */
.cx-auth{padding:22px}
.cx-auth-tabs{display:flex;border-bottom:1px solid #1a1a1a;margin-bottom:18px}
.cx-auth-tab{background:none;border:none;color:#3f3f46;font-family:inherit;font-size:13px;font-weight:500;padding:8px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.cx-auth-tab.active{color:${a};border-bottom-color:${a}}
.cx-field{margin-bottom:13px}
.cx-field label{display:block;font-size:11px;color:#52525b;margin-bottom:5px;font-weight:500}
.cx-fi{width:100%;background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;color:#e4e4e7;font-family:inherit;font-size:13px;padding:9px 11px;outline:none;transition:border-color .15s}
.cx-fi:focus{border-color:${a}88}
.cx-fi::placeholder{color:#2a2a2a}
.cx-err{color:#ef4444;font-size:11px;padding:7px 11px;background:#ef444411;border-radius:6px;margin-bottom:11px;border:1px solid #ef444433}

/* spinner */
.cx-spin{display:inline-block;width:13px;height:13px;border:2px solid #1e1e1e;border-top-color:${a};border-radius:50%;animation:cxspin .6s linear infinite}
@keyframes cxspin{to{transform:rotate(360deg)}}

/* rank badge */
.cx-rank{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:.03em;vertical-align:middle}
.cx-rank-progress{height:3px;border-radius:2px;background:#1a1a1a;overflow:hidden;margin-top:4px}
.cx-rank-fill{height:100%;border-radius:2px;transition:width .3s}
/* rank card in header */
.cx-user-card{padding:10px 14px;border-bottom:1px solid #111;background:#0a0a0a;display:flex;align-items:center;gap:10px}
.cx-rank-info{flex:1;min-width:0}
.cx-rank-name{font-size:12px;font-weight:600;color:#e4e4e7}
.cx-rank-sub{font-size:10px;color:#52525b;margin-top:1px}

/* notification bell */
.cx-bell{position:relative;background:none;border:none;cursor:pointer;padding:5px;color:#52525b;display:flex;align-items:center;transition:color .15s;border-radius:6px}
.cx-bell:hover{color:#a1a1aa;background:#141414}
.cx-bell-icon{font-size:16px;line-height:1}
.cx-badge-dot{position:absolute;top:2px;right:2px;min-width:16px;height:16px;background:#ef4444;border-radius:8px;font-size:9px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #080808}
.cx-notif-panel{position:absolute;top:calc(100% + 8px);right:0;width:320px;max-width:90vw;background:#0d0d0d;border:1px solid #1e1e1e;border-radius:14px;overflow:hidden;z-index:9999;box-shadow:0 8px 32px #000000aa;animation:cxfadein .15s ease}
@keyframes cxfadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.cx-notif-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #141414}
.cx-notif-title{font-size:13px;font-weight:600;color:#e4e4e7}
.cx-notif-mark{background:none;border:none;font-size:11px;color:#52525b;cursor:pointer;font-family:inherit;padding:3px 7px;border-radius:5px;transition:all .15s}
.cx-notif-mark:hover{background:#141414;color:#a1a1aa}
.cx-notif-list{max-height:320px;overflow-y:auto}
.cx-notif-item{padding:11px 14px;border-bottom:1px solid #0f0f0f;cursor:pointer;transition:background .1s;display:flex;gap:10px;align-items:flex-start}
.cx-notif-item:hover{background:#111}
.cx-notif-item.unread{background:#7c3aed08;border-left:3px solid #7c3aed}
.cx-notif-item.unread:hover{background:#7c3aed12}
.cx-notif-icon{font-size:16px;flex-shrink:0;margin-top:1px}
.cx-notif-body{flex:1;min-width:0}
.cx-notif-text{font-size:12px;color:#a1a1aa;line-height:1.5}
.cx-notif-text strong{color:#e4e4e7;font-weight:600}
.cx-notif-preview{font-size:11px;color:#3f3f46;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cx-notif-time{font-size:10px;color:#2a2a2a;margin-top:3px}
.cx-notif-empty{padding:24px;text-align:center;color:#3f3f46;font-size:12px}
.cx-hd-right{position:relative;display:flex;align-items:center;gap:6px}

/* footer */
.cx-foot{text-align:center;padding:10px;font-size:10px;color:#1e1e1e}
.cx-foot a{color:${a};text-decoration:none;opacity:.6}
.cx-foot a:hover{opacity:1}

@media(max-width:480px){
  .cx-comment{padding:11px 14px}
  .cx-compose{padding:13px 14px}
  .cx-hd{padding:12px 14px}
  .cx-replies{margin-left:20px;padding-left:10px}
}
</style>`;
  }

  //  Build HTML ─
  function buildAll() {
    return css() + `<div class="cx">${buildHeader()}${S.showAuth ? buildAuth() : buildMain()}</div>`;
  }

  function buildHeader() {
    const org = S.orgConfig || {};
    const a = org.accentColor || '#7c3aed';
    const notifPanel = S.showNotifs ? buildNotifPanel(a) : '';
    return `<div class="cx-hd">
  <div class="cx-hd-brand">
    <div class="cx-hd-logo">${org.logo ? `<img src="${org.logo}" alt="">` : 'cx'}</div>
    <span class="cx-hd-name">${org.name || 'Comments'}</span>
  </div>
  <span class="cx-hd-count">${S.totalComments} comment${S.totalComments !== 1 ? 's' : ''}</span>
  <div class="cx-hd-right">
    ${S.user ? `
      <button class="cx-bell" id="cx-bell-btn" title="Notifications">
        <span class="cx-bell-icon">🔔</span>
        ${S.unreadCount > 0 ? `<span class="cx-badge-dot">${S.unreadCount > 9 ? '9+' : S.unreadCount}</span>` : ''}
      </button>
      ${notifPanel}
      <div class="cx-av" title="${esc(S.user.displayName || S.user.username)}">
        ${S.user.avatar ? `<img src="${esc(S.user.avatar)}" alt="">` : esc((S.user.displayName||S.user.username||'U')[0]).toUpperCase()}
      </div>
      <button class="cx-btn cx-ghost" id="cx-logout" style="padding:5px 10px;font-size:11px">Sign out</button>
    ` : `<button class="cx-btn cx-primary" id="cx-signin" style="padding:5px 12px">Sign in</button>`}
  </div>
</div>`;
  }

  function buildNotifPanel(accent) {
    const notifs = S.notifications;
    const icons = { reply: '↩', mention: '@', reaction: '❤️', pin: '📌' };
    const labels = { reply: 'replied to your comment', mention: 'mentioned you', reaction: 'reacted to your comment', pin: 'pinned your comment' };
    return `<div class="cx-notif-panel" id="cx-notif-panel">
  <div class="cx-notif-hd">
    <span class="cx-notif-title">Notifications ${S.unreadCount > 0 ? `<span style="color:#ef4444;font-size:11px">(${S.unreadCount} new)</span>` : ''}</span>
    ${notifs.length > 0 ? `<button class="cx-notif-mark" id="cx-mark-all-read">Mark all read</button>` : ''}
  </div>
  <div class="cx-notif-list">
    ${notifs.length === 0
      ? `<div class="cx-notif-empty">🔔 No notifications yet</div>`
      : notifs.map(n => `
        <div class="cx-notif-item ${!n.isRead ? 'unread' : ''}" data-notif-id="${n._id}" data-notif-page="${esc(n.pageUrl||'')}">
          <span class="cx-notif-icon">${icons[n.type] || '🔔'}</span>
          <div class="cx-notif-body">
            <div class="cx-notif-text"><strong>${esc(n.fromUserName||'Someone')}</strong> ${labels[n.type]||'interacted with you'}</div>
            ${n.preview ? `<div class="cx-notif-preview">"${esc(n.preview)}"</div>` : ''}
            ${n.pageTitle ? `<div class="cx-notif-preview" style="color:#3f3f46">on: ${esc(n.pageTitle)}</div>` : ''}
            <div class="cx-notif-time">${timeAgo(n.createdAt)}</div>
          </div>
        </div>`).join('')}
  </div>
</div>`;
  }

  function buildMain() {
    return (S.user && S.userRank ? buildRankBar() : '') + buildSortBar() + buildCompose() + buildList() + `<div class="cx-foot">powered by <a href="${API_BASE}" target="_blank">commex</a></div>`;
  }

  function buildRankBar() {
    const r = S.userRank;
    const next = S.userNextRank;
    const prog = S.userRankProgress || 0;
    const a = (S.orgConfig?.accentColor) || '#7c3aed';
    return `<div class="cx-user-card">
  <div class="cx-av" style="width:26px;height:26px;flex-shrink:0">
    ${S.user.avatar ? `<img src="${esc(S.user.avatar)}" alt="">` : (S.user.displayName||S.user.username||'U')[0].toUpperCase()}
  </div>
  <div class="cx-rank-info">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;font-weight:600;color:#e4e4e7">${esc(S.user.displayName||S.user.username)}</span>
      <span class="cx-rank" style="background:${r.color}22;color:${r.color}">${r.emoji} ${r.label}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
      <div class="cx-rank-progress" style="flex:1;max-width:120px">
        <div class="cx-rank-fill" style="width:${prog}%;background:${r.color}"></div>
      </div>
      <span style="font-size:10px;color:#3f3f46">${S.userCommentCount||0} comments${next ? ` · ${next.min - (S.userCommentCount||0)} to ${next.emoji} ${next.label}` : ' · Max rank!'}</span>
    </div>
  </div>
</div>`;
  }

  function buildSortBar() {
    const sorts = [['newest','Newest'],['oldest','Oldest'],['popular','Top']];
    return `<div class="cx-sortbar">
  <span class="cx-sort-label">Sort:</span>
  ${sorts.map(([v,l]) => `<button class="cx-sort-btn ${S.sort===v?'active':''}" data-sort="${v}">${l}</button>`).join('')}
</div>`;
  }

  function buildCompose() {
    const org = S.orgConfig || {};
    const feat = org.features || {};
    const allowAnon = org.features?.anonymousComments === true;
    if (!S.user && !allowAnon) return `<div class="cx-compose"><div style="text-align:center;padding:10px 0;color:#3f3f46;font-size:13px"><span style="cursor:pointer;color:${org.accentColor||'#7c3aed'}" id="cx-signin-link">Sign in</span> to join the conversation</div></div>`;
    if (!S.user && allowAnon) return buildAnonCompose();
    const u = S.user;
    return `<div class="cx-compose">
  <div class="cx-compose-row">
    <div class="cx-av" style="flex-shrink:0;width:32px;height:32px">${u.avatar?`<img src="${esc(u.avatar)}" alt="">`:(u.displayName||u.username||'U')[0].toUpperCase()}</div>
    <div style="flex:1">
      <div class="cx-wrap">
        <textarea class="cx-ta" id="cx-main-ta" placeholder="Write a comment... (supports **bold**, *italic*, \`code\`, [link](url))">${esc(S.draftText)}</textarea>
        ${S.selectedGif ? `<div class="cx-gif-pre"><img src="${esc(S.selectedGif.preview)}" alt="GIF"><button class="cx-gif-rm" id="cx-rm-gif">×</button></div>` : ''}
        <div class="cx-bar">
          <button class="cx-tb" id="cx-tb-bold" title="Bold (**text**)"><strong>B</strong></button>
          <button class="cx-tb" id="cx-tb-italic" title="Italic (*text*)"><em>i</em></button>
          <button class="cx-tb" id="cx-tb-code" title="Code (\`code\`)" style="font-family:monospace;font-size:12px">{ }</button>
          <button class="cx-tb" id="cx-tb-link" title="Link ([text](url))">🔗</button>
          ${feat.gifs!==false?`<button class="cx-tb ${S.gifOpen?'active':''}" id="cx-tb-gif" title="Add GIF" style="font-size:11px;font-weight:700;letter-spacing:-.5px">GIF</button>`:''}
          <span class="cx-spacer"></span>
          <button class="cx-btn cx-primary" id="cx-post" style="padding:5px 14px;font-size:12px" ${S.posting?'disabled':''}>
            ${S.posting?'<span class="cx-spin"></span>':'Post'}
          </button>
        </div>
      </div>
      ${S.gifOpen ? buildGifPanel() : ''}
    </div>
  </div>
</div>`;
  }

  function buildAnonCompose() {
    const org = S.orgConfig || {};
    const a = org.accentColor || '#7c3aed';
    return `<div class="cx-compose">
  <div style="margin-bottom:10px;display:flex;gap:8px">
    <input class="cx-fi" id="cx-anon-name" placeholder="Your name (optional)" style="flex:1;padding:8px 11px;font-size:13px">
    <span style="font-size:11px;color:#3f3f46;align-self:center;white-space:nowrap">or <span style="cursor:pointer;color:${a}" id="cx-signin-link">sign in</span></span>
  </div>
  <div class="cx-wrap">
    <textarea class="cx-ta" id="cx-main-ta" placeholder="Write a comment..." rows="3">${esc(S.draftText)}</textarea>
    <div class="cx-bar">
      <span class="cx-spacer"></span>
      <button class="cx-btn cx-primary" id="cx-post" style="padding:5px 14px;font-size:12px" ${S.posting?'disabled':''}>
        ${S.posting?'<span class="cx-spin"></span>':'Post'}
      </button>
    </div>
  </div>
</div>`;
  }

  function buildGifPanel() {
    return `<div class="cx-gif-panel">
  <input class="cx-gif-si" id="cx-gif-si" placeholder="Search GIFs…" value="${esc(S.gifQuery)}">
  <div class="cx-gif-grid" id="cx-gif-grid">
    ${S.gifLoading ? '<div style="padding:16px;text-align:center;color:#3f3f46"><span class="cx-spin"></span></div>' : ''}
    ${!S.gifLoading && S.gifResults.length === 0 ? '<div style="padding:16px;text-align:center;color:#3f3f46;font-size:12px">Search above for GIFs</div>' : ''}
    ${S.gifResults.map(g => `<div class="cx-gif-item" data-url="${esc(g.url)}" data-pre="${esc(g.preview)}"><img src="${esc(g.preview)}" loading="lazy" alt=""></div>`).join('')}
  </div>
</div>`;
  }

  function buildList() {
    if (S.loading && S.comments.length === 0) return `<div class="cx-list"><div style="padding:28px;text-align:center"><span class="cx-spin"></span></div></div>`;
    if (S.comments.length === 0) return `<div class="cx-list"><div class="cx-empty"><div class="cx-empty-icon">💬</div>No comments yet — be the first!</div></div>`;
    return `<div class="cx-list">
  ${S.comments.map(c => buildComment(c, false)).join('')}
  ${S.page < S.totalPages ? `<div class="cx-loadmore"><button class="cx-btn cx-ghost" id="cx-loadmore">Load more comments</button></div>` : ''}
</div>`;
  }

  function buildComment(c, isReply) {
    const feat = (S.orgConfig||{}).features || {};
    const del = c.isDeleted;
    const uid = S.user && (S.user._id || S.user.id);
    const isOwn = S.user && c.authorId === uid;
    // isAdmin = global superadmin OR this user owns/moderates this specific org
    const isAdmin = S.user && (
      S.user.role === 'superadmin' ||
      (S.orgConfig && (
        S.orgConfig.ownerId === uid ||
        (S.orgConfig.memberIds || []).includes(uid)
      ))
    );
    const urx = S.userReactions[c._id];
    const rc = c.reactionCounts ? (c.reactionCounts instanceof Map ? Object.fromEntries(c.reactionCounts) : c.reactionCounts) : {};
    const pills = Object.entries(rc).filter(([,n])=>n>0).map(([t,n])=>`<button class="cx-pill ${urx===t?'mine':''}" data-rx="${t}" data-cid="${c._id}">${t} <span class="cx-pill-n">${n}</span></button>`).join('');
    const flagDone = S.flagged[c._id];

    const body = del
      ? `<span class="cx-content del">[deleted]</span>`
      : `<div class="cx-content">${md(c.content)}${c.gifUrl?`<img src="${esc(c.gifUrl)}" alt="GIF">`:''}</div>`;

    const replies = !isReply && c.replies?.length
      ? `<div class="cx-replies">${c.replies.map(r=>buildComment(r,true)).join('')}</div>` : '';

    const replyForm = S.replyingTo===c._id ? `<div class="cx-rf" style="margin-top:8px">
  <textarea placeholder="Reply to ${esc(c.authorName)}…" id="cx-reply-${c._id}">${esc(S.draftReply[c._id]||'')}</textarea>
  <div class="cx-rf-actions">
    <button class="cx-btn cx-ghost" data-cancel-reply="${c._id}" style="padding:4px 10px;font-size:11px">Cancel</button>
    <button class="cx-btn cx-primary" data-do-reply="${c._id}" style="padding:4px 10px;font-size:11px">Reply</button>
  </div>
</div>` : '';

    const editForm = S.editingId===c._id ? `<div class="cx-rf" style="margin-top:8px">
  <textarea id="cx-edit-${c._id}">${esc(c.content)}</textarea>
  <div class="cx-rf-actions">
    <button class="cx-btn cx-ghost" data-cancel-edit="${c._id}" style="padding:4px 10px;font-size:11px">Cancel</button>
    <button class="cx-btn cx-primary" data-do-edit="${c._id}" style="padding:4px 10px;font-size:11px">Save</button>
  </div>
</div>` : '';

    const av = isReply ? 26 : 34;

    return `<div class="${isReply?'cx-reply-item':'cx-comment'}${c.isPinned?' pinned':''}" id="cx-c-${c._id}">
  <div class="cx-ci">
    <div class="cx-av" style="width:${av}px;height:${av}px;flex-shrink:0">
      ${c.authorAvatar?`<img src="${esc(c.authorAvatar)}" alt="">`:(c.authorName||'U')[0].toUpperCase()}
    </div>
    <div class="cx-cb">
      <div class="cx-meta">
        <span class="cx-author">${esc(c.authorName)}</span>
        ${c.authorBadge === 'owner'     ? `<span class="cx-badge cx-badge-admin" style="background:#fbbf2422;color:#fbbf24">Owner</span>` : ''}
        ${c.authorBadge === 'admin'     ? `<span class="cx-badge cx-badge-admin">Admin</span>` : ''}
        ${c.authorBadge === 'moderator' ? `<span class="cx-badge" style="background:#06b6d422;color:#06b6d4;font-size:10px;font-weight:600;padding:2px 5px;border-radius:4px;text-transform:uppercase;letter-spacing:.04em">Mod</span>` : ''}
        ${c.authorRank ? `<span class="cx-rank" style="background:${c.authorRank.color}22;color:${c.authorRank.color}">${c.authorRank.emoji} ${c.authorRank.label}</span>` : ''}
        ${c.isPinned?'<span class="cx-badge cx-badge-pin">📌 Pinned</span>':''}
        <span class="cx-time">${timeAgo(c.createdAt)}</span>
        ${c.isEdited?'<span class="cx-edited">edited</span>':''}
      </div>
      ${S.editingId!==c._id ? body : ''}
      ${editForm}
      ${!del ? `
        <div class="cx-actions">
          ${feat.reactions!==false && S.user ? `<button class="cx-act" data-emoji-for="${c._id}">😊 React</button>` : ''}
          ${S.user && feat.threading!==false ? `<button class="cx-act" data-reply-to="${c._id}">↩ Reply</button>` : ''}
          ${feat.voting!==false ? `
            <button class="cx-act ${urx==='upvote'?'on':''}" data-rx="upvote" data-cid="${c._id}">▲ ${c.upvotes||0}</button>
            <button class="cx-act ${urx==='downvote'?'on':''}" data-rx="downvote" data-cid="${c._id}">▼ ${c.downvotes||0}</button>
          ` : ''}
          ${isOwn?`<button class="cx-act" data-edit="${c._id}">✏</button><button class="cx-act" data-del="${c._id}">🗑</button>`:''}
          ${isAdmin?`<button class="cx-act" data-pin="${c._id}">${c.isPinned?'Unpin':'📌 Pin'}</button>`:''}
          ${!isOwn && S.user ? `<button class="cx-act ${flagDone?'flag-done':''}" data-flag="${c._id}" ${flagDone?'disabled':''} title="Flag comment">⚑${flagDone?' Flagged':''}</button>` : ''}
        </div>
        ${pills||S.emojiPickerFor===c._id?`<div>
          ${pills?`<div class="cx-rx-bar">${pills}</div>`:''}
          ${S.emojiPickerFor===c._id?`<div class="cx-ep">
            ${['👍','❤️','😂','😮','😢','😡','🔥','🎉','🤔','👀'].map(e=>`<button class="cx-eb" data-rx="${e}" data-cid="${c._id}">${e}</button>`).join('')}
          </div>`:''}
        </div>`:''}
      ` : ''}
      ${replyForm}
    </div>
  </div>
  ${replies}
</div>`;
  }

  function buildAuth() {
    const login = S.authMode === 'login';
    return `<div class="cx-auth">
  <div class="cx-auth-tabs">
    <button class="cx-auth-tab ${login?'active':''}" id="cx-at-login">Sign in</button>
    <button class="cx-auth-tab ${!login?'active':''}" id="cx-at-reg">Create account</button>
  </div>
  ${S.authError ? `<div class="cx-err">${esc(S.authError)}</div>` : ''}
  ${login ? `
    <div class="cx-field"><label>Email or username</label><input class="cx-fi" id="cx-l-login" type="text" placeholder="you@example.com" autocomplete="username"></div>
    <div class="cx-field"><label>Password</label><input class="cx-fi" id="cx-l-pw" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    <button class="cx-btn cx-primary" id="cx-auth-go" style="width:100%;justify-content:center;padding:10px" ${S.authLoading?'disabled':''}>
      ${S.authLoading?'<span class="cx-spin"></span>':'Sign in'}
    </button>
  ` : `
    <div class="cx-field"><label>Username</label><input class="cx-fi" id="cx-r-un" type="text" placeholder="cooluser" autocomplete="username"></div>
    <div class="cx-field"><label>Email</label><input class="cx-fi" id="cx-r-em" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <div class="cx-field"><label>Password</label><input class="cx-fi" id="cx-r-pw" type="password" placeholder="Min. 8 chars" autocomplete="new-password"></div>
    <button class="cx-btn cx-primary" id="cx-auth-go" style="width:100%;justify-content:center;padding:10px" ${S.authLoading?'disabled':''}>
      ${S.authLoading?'<span class="cx-spin"></span>':'Create account'}
    </button>
  `}
  <div style="text-align:center;margin-top:12px">
    <button class="cx-btn cx-ghost" id="cx-auth-cancel" style="font-size:11px">Cancel</button>
  </div>
</div>`;
  }

  //  Events 
  function bind(el) {
    on(el,'#cx-signin',     ()=>{ S.showAuth=true; rerender(el); });

    // notification bell
    on(el,'#cx-bell-btn', async () => {
      S.showNotifs = !S.showNotifs;
      if (S.showNotifs) {
        await loadNotifications();
      }
      rerender(el);
    });
    on(el,'#cx-mark-all-read', async () => {
      await markNotifsRead([]);
      rerender(el);
    });
    // clicking a notification — mark read and scroll to page if possible
    el.querySelectorAll('[data-notif-id]').forEach(item => {
      item.addEventListener('click', async () => {
        await markNotifsRead([item.dataset.notifId]);
        S.showNotifs = false;
        rerender(el);
        if (item.dataset.notifPage && item.dataset.notifPage !== PAGE_URL) {
          window.open(item.dataset.notifPage, '_blank');
        }
      });
    });
    // close notif panel when clicking outside
    if (S.showNotifs) {
      setTimeout(() => {
        document.addEventListener('click', function closePanel(e) {
          const panel = el.querySelector('#cx-notif-panel');
          const bell = el.querySelector('#cx-bell-btn');
          if (panel && !panel.contains(e.target) && !bell?.contains(e.target)) {
            S.showNotifs = false;
            rerender(el);
            document.removeEventListener('click', closePanel);
          }
        });
      }, 50);
    }
    on(el,'#cx-signin-link',()=>{ S.showAuth=true; rerender(el); });
    on(el,'#cx-logout',     ()=>{ S.user=null; S.token=null; clearAuth(); rerender(el); });

    // sort
    el.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', async () => {
      S.sort = b.dataset.sort; await loadComments(true); rerender(el);
    }));

    // auth tabs
    on(el,'#cx-at-login',  ()=>{ S.authMode='login';    S.authError=null; rerender(el); });
    on(el,'#cx-at-reg',    ()=>{ S.authMode='register'; S.authError=null; rerender(el); });
    on(el,'#cx-auth-cancel',()=>{ S.showAuth=false; rerender(el); });
    on(el,'#cx-auth-go',   ()=> doAuth(el));

    // enter key in auth
    el.querySelectorAll('.cx-fi').forEach(i => i.addEventListener('keydown', e => { if(e.key==='Enter') doAuth(el); }));

    // post
    on(el,'#cx-post', ()=> doPost(el, null));

    // markdown toolbar
    on(el,'#cx-tb-bold',   ()=> wrap(el,'**','**'));
    on(el,'#cx-tb-italic', ()=> wrap(el,'*','*'));
    on(el,'#cx-tb-code',   ()=> wrap(el,'`','`'));
    on(el,'#cx-tb-link',   ()=> wrapLink(el));

    // gif
    on(el,'#cx-tb-gif', ()=>{
      S.gifOpen = !S.gifOpen;
      // When reopening, if we had a selected gif already allow changing it
      // gifResults are preserved in state so panel shows previous search
      rerender(el);
      setTimeout(()=>{ const i=el.querySelector('#cx-gif-si'); if(i){ i.focus(); i.select(); } },30);
    });
    on(el,'#cx-rm-gif', ()=>{ S.selectedGif=null; rerender(el); });

    const gsi = el.querySelector('#cx-gif-si');
    if (gsi) {
      gsi.addEventListener('input', debounce(async e => {
        S.gifQuery = e.target.value;
        if (S.gifQuery.length > 1) {
          S.gifLoading = true; rerender(el);
          await searchGifs(S.gifQuery);
          S.gifLoading = false; rerender(el);
        }
      }, 400));
    }

    el.querySelectorAll('.cx-gif-item').forEach(item => item.addEventListener('click', () => {
      S.selectedGif = { url: item.dataset.url, preview: item.dataset.pre };
      S.gifOpen = false; rerender(el);
    }));

    // load more
    on(el,'#cx-loadmore', async () => { S.page++; await loadComments(false); rerender(el); });

    // reply
    el.querySelectorAll('[data-reply-to]').forEach(b => b.addEventListener('click', () => {
      S.replyingTo = S.replyingTo===b.dataset.replyTo ? null : b.dataset.replyTo;
      S.editingId = null; rerender(el);
      setTimeout(() => { const t=el.querySelector(`#cx-reply-${b.dataset.replyTo}`); if(t)t.focus(); }, 40);
    }));
    el.querySelectorAll('[data-cancel-reply]').forEach(b => b.addEventListener('click', ()=>{ S.replyingTo=null; rerender(el); }));
    el.querySelectorAll('[data-do-reply]').forEach(b => b.addEventListener('click', () => {
      const t = el.querySelector(`#cx-reply-${b.dataset.doReply}`);
      if (t) doPost(el, b.dataset.doReply, t.value);
    }));

    // edit
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      S.editingId = S.editingId===b.dataset.edit ? null : b.dataset.edit;
      S.replyingTo = null; rerender(el);
      setTimeout(() => { const t=el.querySelector(`#cx-edit-${b.dataset.edit}`); if(t){ t.focus(); t.setSelectionRange(t.value.length,t.value.length); } }, 40);
    }));
    el.querySelectorAll('[data-cancel-edit]').forEach(b => b.addEventListener('click', ()=>{ S.editingId=null; rerender(el); }));
    el.querySelectorAll('[data-do-edit]').forEach(b => b.addEventListener('click', async () => {
      const t = el.querySelector(`#cx-edit-${b.dataset.doEdit}`);
      if (!t?.value?.trim()) return;
      try {
        await api('PATCH', `/api/comments/${ORG_SLUG}/${b.dataset.doEdit}`, { content: t.value });
        const c = findC(b.dataset.doEdit); if(c) c.content = t.value, c.isEdited = true;
        S.editingId = null; rerender(el); toast('Comment updated');
      } catch(e) { toast(e.message, 1); }
    }));

    // delete
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        await api('DELETE', `/api/comments/${ORG_SLUG}/${b.dataset.del}`);
        const c = findC(b.dataset.del); if(c){ c.isDeleted=true; c.content='[deleted]'; }
        rerender(el); toast('Comment deleted');
      } catch(e) { toast(e.message,1); }
    }));

    // pin
    el.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', async () => {
      try {
        const d = await api('PATCH', `/api/comments/${ORG_SLUG}/${b.dataset.pin}/pin`);
        const c = findC(b.dataset.pin); if(c) c.isPinned = d.isPinned;
        rerender(el);
      } catch(e) { toast(e.message,1); }
    }));

    // flag
    el.querySelectorAll('[data-flag]').forEach(b => b.addEventListener('click', async () => {
      if (S.flagged[b.dataset.flag]) return;
      try {
        await api('POST', `/api/comments/${ORG_SLUG}/${b.dataset.flag}/flag`);
        S.flagged[b.dataset.flag] = true; rerender(el);
        toast('Comment reported — thank you');
      } catch(e) { toast(e.message,1); }
    }));

    // reactions
    el.querySelectorAll('[data-rx][data-cid]').forEach(b => b.addEventListener('click', async () => {
      const allowAnon = S.orgConfig?.features?.anonymousComments === true;
    if (!S.user && !allowAnon) { S.showAuth=true; rerender(el); return; }
      try {
        const d = await api('POST', `/api/reactions/${ORG_SLUG}/${b.dataset.cid}`, { type: b.dataset.rx });
        const c = findC(b.dataset.cid);
        if (c) { c.reactionCounts = d.counts; c.upvotes = d.upvotes ?? c.upvotes; c.downvotes = d.downvotes ?? c.downvotes; }
        if (d.action==='removed') delete S.userReactions[b.dataset.cid];
        else S.userReactions[b.dataset.cid] = d.type || b.dataset.rx;
        S.emojiPickerFor = null; rerender(el);
      } catch(e) { toast(e.message,1); }
    }));

    // emoji picker toggle
    el.querySelectorAll('[data-emoji-for]').forEach(b => b.addEventListener('click', () => {
      S.emojiPickerFor = S.emojiPickerFor===b.dataset.emojiFor ? null : b.dataset.emojiFor;
      rerender(el);
    }));
  }

  //  Auth 
  async function doAuth(el) {
    // Read values FIRST before any rerender
    const loginV = el.querySelector('#cx-l-login')?.value?.trim() || '';
    const pwV    = el.querySelector('#cx-l-pw')?.value || '';
    const unV    = el.querySelector('#cx-r-un')?.value?.trim() || '';
    const emV    = el.querySelector('#cx-r-em')?.value?.trim() || '';
    const rpwV   = el.querySelector('#cx-r-pw')?.value || '';

    S.authLoading = true; S.authError = null; rerender(el);
    try {
      let d;
      if (S.authMode==='login') {
        d = await api('POST','/api/auth/login',{ login: loginV, password: pwV });
      } else {
        d = await api('POST','/api/auth/register',{ username: unV, email: emV, password: rpwV });
      }
      S.token = d.token; S.user = d.user;
      saveAuth(d.token, d.user);
      S.showAuth = false; S.authLoading = false;
      await loadComments(true);
      await loadUserRank();
      rerender(el);
      toast(`Welcome${S.authMode==='register'?' to Commex':' back'}, ${d.user.displayName||d.user.username}!`);
    } catch(e) {
      S.authError = e.message; S.authLoading = false; rerender(el);
    }
  }

  //  Post comment ─
  async function doPost(el, parentId, content) {
    const ta = content !== undefined ? null : el.querySelector('#cx-main-ta');
    const text = content !== undefined ? content : (ta?.value || '');
    if (!text.trim() && !S.selectedGif) return;
    const allowAnon = S.orgConfig?.features?.anonymousComments === true;
    if (!S.user && !allowAnon) { S.showAuth=true; rerender(el); return; }

    S.posting = true; rerender(el);
    try {
      const anonName = !S.user ? (el.querySelector('#cx-anon-name')?.value?.trim() || 'Anonymous') : undefined;
      const d = await api('POST', `/api/comments/${ORG_SLUG}`, {
        pageUrl: PAGE_URL, pageTitle: PAGE_TITLE,
        content: text.trim(),
        parentId: parentId || undefined,
        gifUrl: S.selectedGif?.url || undefined,
        anonName,
      });
      const isPending = d.status === 'pending';
      S.selectedGif = null; S.replyingTo = null; S.gifOpen = false;
      S.draftText = ''; S.draftReply = {};
      S.page = 1;
      await loadComments(true);
      S.posting = false; rerender(el);
      toast(isPending ? '⏳ Comment submitted — awaiting moderator approval' : '✓ Comment posted!');
    } catch(e) {
      S.posting = false; rerender(el); toast(e.message, 1);
    }
  }

  //  Markdown toolbar helpers 
  function wrap(el, before, after) {
    const ta = el.querySelector('#cx-main-ta');
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.substring(start, end) || 'text';
    const ins = before + sel + after;
    ta.value = ta.value.substring(0, start) + ins + ta.value.substring(end);
    ta.focus();
    ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    S.draftText = ta.value;
  }
  function wrapLink(el) {
    const ta = el.querySelector('#cx-main-ta');
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.substring(start, end) || 'link text';
    const url = prompt('Enter URL:');
    if (!url) return;
    const ins = `[${sel}](${url})`;
    ta.value = ta.value.substring(0, start) + ins + ta.value.substring(end);
    ta.focus(); S.draftText = ta.value;
  }

  //  GIF search ─
  async function searchGifs(q) {
    try {
      const d = await api('GET', `/api/gifs/search?q=${encodeURIComponent(q)}&limit=12`);
      S.gifResults = d.gifs || [];
    } catch(e) { S.gifResults = []; }
  }

  //  Markdown renderer 
  function md(text) {
    if (!text) return '';
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/@([a-zA-Z0-9_-]+)/g,'<span class="cx-mention">@$1</span>');
  }

  //  Helpers ─
  function on(el, sel, fn) { const b=el.querySelector(sel); if(b) b.addEventListener('click',fn); }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function findC(id) {
    for (const c of S.comments) {
      if (c._id===id) return c;
      if (c.replies) for (const r of c.replies) if(r._id===id) return r;
    }
  }
  function timeAgo(d) {
    const s = Math.floor((Date.now()-new Date(d))/1000);
    if(s<60) return 'just now';
    if(s<3600) return `${Math.floor(s/60)}m ago`;
    if(s<86400) return `${Math.floor(s/3600)}h ago`;
    if(s<2592000) return `${Math.floor(s/86400)}d ago`;
    return new Date(d).toLocaleDateString();
  }
  function toast(msg, err) {
    const old = document.querySelector('.cx-toast-el');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'cx-toast-el';
    t.style.cssText = `position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:1px solid ${err?'#ef4444':'#2a2a2a'};color:#e4e4e7;padding:10px 16px;border-radius:9px;font-size:13px;font-family:sans-serif;z-index:99999;animation:cxslidein .2s ease`;
    const style = document.createElement('style');
    style.textContent = '@keyframes cxslidein{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}';
    document.head.appendChild(style);
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 3200);
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
  }
  function skeleton() {
    return `<div style="font-family:sans-serif;padding:20px;background:#080808;border-radius:12px;border:1px solid #1a1a1a">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
        <div style="width:36px;height:36px;border-radius:50%;background:#141414;animation:cxp 1.4s infinite"></div>
        <div style="flex:1;height:36px;border-radius:8px;background:#141414;animation:cxp 1.4s infinite"></div>
      </div>
      <style>@keyframes cxp{0%,100%{opacity:.3}50%{opacity:.7}}</style>
      <p style="text-align:center;color:#333;font-size:12px;margin-top:8px">Loading Commex…</p>
    </div>`;
  }

  //  Boot 
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window, document);
