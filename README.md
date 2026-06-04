# Commex

> The modern, self-hosted embeddable comment & reaction platform. You own your data.

![Commex](https://img.shields.io/badge/version-1.0.0-7c3aed?style=flat-square)
![Node](https://img.shields.io/badge/node-18+-green?style=flat-square)
![MongoDB](https://img.shields.io/badge/database-MongoDB-4ade80?style=flat-square)

---

## What is Commex?

Commex is a **Disqus alternative** where each organization stores its own comment data in its own MongoDB database. You embed a two-line script on your site, and visitors get a full-featured comment box — dark-themed, mobile-ready, with reactions, GIFs, threading, mentions, and more.

**Architecture:**
- **Central DB** (your main `MONGODB_URI`): stores users and organization metadata only
- **Per-org DB** (each org provides its own `mongodb+srv://...`): stores all comments, reactions, notifications for that org

---

## Features

-  **Own your data** — each org connects to its own MongoDB
-  **2-line embed** — `<div>` + `<script>` and you're live
-  **Threaded comments** — nested replies with depth tracking
-  **10 emoji reactions** + upvote/downvote with live counts
-  **GIF picker** — Tenor integration (set `TENOR_API_KEY`//OR GIPHY)
-  **Image support** — URL-based image attachments
- **@Mentions** — notify users when mentioned
-  **Pin comments** — moderators can highlight key comments
-  **Flagging** — community-driven spam reporting
-  **Edit & delete** — with soft-delete to preserve thread structure
-  **Word filter** — org-level banned word list
-  **Domain allowlist** — restrict your embed to specific domains
-  **Custom accent colors** — per-org branding
-  **Notifications** — reply & mention notifications stored per-org
-  **Dashboard** — manage orgs, copy embed snippet, toggle features
-  **Responsive** — works on all screen sizes, dark-first

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/Commex/commex.git
cd commex
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/commex
JWT_SECRET=your-long-random-secret-here
APP_URL=https://your-commex-domain.com
TENOR_API_KEY=your-tenor-api-key   # optional, for GIF search
```

### 3. Start the server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Visit `http://localhost:3000` — you'll see the Commex landing page.

---

## Creating your first organization

1. **Register an account** at your Commex instance
2. Go to **Dashboard → New organization**
3. Enter your org name and your **MongoDB connection string** (this is where comments will be stored)
4. Commex tests the connection before saving
5. Copy the **embed snippet** from the Embed tab

---

## Embedding on your website

Add this to any page where you want comments:

```html
<!-- Commex Comments Widget -->
<div id="commex-widget"></div>
<script>
  window.CommexConfig = {
    orgSlug: "your-org-slug",
    pageUrl: window.location.href,
    pageTitle: document.title,
  };
</script>
<script src="https://commex.onrender.app/embed/commex.js" async></script>
```

### CommexConfig options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `orgSlug` | ✅ | — | Your organization slug |
| `pageUrl` | — | `window.location.href` | Page identifier for comments |
| `pageTitle` | — | `document.title` | Title shown in notifications |
| `targetId` | — | `commex-widget` | ID of the mount element |
| `theme` | — | `dark` | `dark` or `light` |

---

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orgs/mine` | My organizations |
| POST | `/api/orgs` | Create organization |
| GET | `/api/orgs/:slug` | Get org details |
| PATCH | `/api/orgs/:slug` | Update org |
| DELETE | `/api/orgs/:slug` | Delete org |
| POST | `/api/orgs/:slug/test-db` | Test DB connection |
| GET | `/api/orgs/:slug/embed-snippet` | Get embed code |

### Comments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/comments/:orgSlug?pageUrl=` | Get comments for a page |
| POST | `/api/comments/:orgSlug` | Post a comment |
| PATCH | `/api/comments/:orgSlug/:id` | Edit a comment |
| DELETE | `/api/comments/:orgSlug/:id` | Delete a comment |
| PATCH | `/api/comments/:orgSlug/:id/pin` | Pin/unpin |
| POST | `/api/comments/:orgSlug/:id/flag` | Flag for review |

### Reactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reactions/:orgSlug/:commentId` | Add/remove/change reaction |
| GET | `/api/reactions/:orgSlug/page?pageUrl=` | Page-level reaction counts |

### GIFs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gifs/search?q=` | Search GIFs |
| GET | `/api/gifs/trending` | Trending GIFs |

### Embed
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/embed/config/:orgSlug` | Org config for the widget |

---

## Org Schema (stored in org's own MongoDB)

**comments** — page URL, author, content, GIF, threading, reactions, moderation flags  
**reactions** — one per user per comment, emoji type  
**pageReactions** — page-level reactions (not per-comment)  
**notifications** — reply/mention/reaction alerts per user  

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | — | Server port (default: 3000) |
| `MONGODB_URI` | ✅ | Main database URI |
| `JWT_SECRET` | ✅ | Secret for JWT signing |
| `JWT_EXPIRES_IN` | — | Token lifetime (default: 7d) |
| `APP_URL` | ✅ | Public URL of your Commex instance |
| `TENOR_API_KEY` | — | Tenor API key for GIF search |
| `RATE_LIMIT_WINDOW_MS` | — | Rate limit window (default: 900000) |
| `RATE_LIMIT_MAX` | — | Max requests per window (default: 100) |

---

## Production Deployment

### PM2 (recommended)

```bash
npm install -g pm2
pm2 start src/server.js --name commex
pm2 save
pm2 startup
```

### Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name your-commex-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

---

## Security notes

- JWT secret should be a long random string (32+ chars). Use `openssl rand -base64 32`.
- Set `allowedDomains` on your org to prevent your embed from being used on other sites.
- Rate limiting is applied to all `/api/` routes.

---


