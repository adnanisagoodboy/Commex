# Commex – Complete Setup & Deployment Guide

Welcome to Commex, the modern, self-hosted embeddable commenting platform where you own your data. This guide covers everything you need to get up and running—from local development to production deployment.

**Firstly You can just create an Account in https://commex.anipub.xyz and create a org there ... get the embed code code and past it whereever you want in your website**

---

## Table of Contents

1. [What is Commex?](#what-is-commex)
2. [How Commex Compares](#how-commex-compares)
3. [System Requirements](#system-requirements)
4. [Quick Start](#quick-start)
5. [MongoDB Setup](#mongodb-setup)
   - [Option A: MongoDB Atlas (Cloud)](#option-a-mongodb-atlas-cloud)
   - [Option B: Self-Hosted MongoDB](#option-b-self-hosted-mongodb)
6. [Environment Configuration](#environment-configuration)
7. [Development](#development)
8. [Creating Your First Organization](#creating-your-first-organization)
9. [Embedding on Your Website](#embedding-on-your-website)
10. [Production Deployment](#production-deployment)
11. [Troubleshooting](#troubleshooting)
12. [Contributing](#contributing)

---

## What is Commex?

Commex is a Disqus alternative that gives you complete control over your data. Unlike traditional commenting platforms, each organization stores its data in its own MongoDB database, ensuring:

- You own your data — no third-party lock-in
- Privacy-first — comments never leave your infrastructure
- Self-hosted — deploy on your own server or cloud
- Easy embed — just 2 lines of code on your website

### Key Features

- Threaded Comments — nested replies with unlimited depth
- Reactions — 10+ emoji reactions + upvote/downvote
- GIF Picker — Tenor integration (or GIPHY)
- Image Support — URL-based attachments
- Mentions — notify users automatically
- Moderation — pin comments, flag spam, word filtering
- Edit & Delete — preserve thread structure with soft-delete
- Domain Allowlist — restrict embeds to your domains
- Custom Branding — per-org accent colors
- Notifications — reply & mention alerts
- Dashboard — manage all settings from one place
- Responsive Design — works on all devices

---

## How Commex Compares

| Feature | Commex | Disqus | Giscus | Utterances | Commento |
|---------|--------|--------|--------|-----------|----------|
| **Self-Hosted** | Yes | No | Yes | No | Yes |
| **Own Your Data** | Yes | No | Yes | No | Yes |
| **Cost** | Free (self-hosted) | $0-499/mo | Free | Free | Free/$5-10mo |
| **Database Type** | MongoDB (per-org) | Proprietary | GitHub Issues | GitHub Issues | SQLite/PostgreSQL |
| **Threaded Comments** | Yes | Yes | No | No | Yes |
| **Reactions/Emoji** | Yes (10+) | Yes | Yes (GitHub only) | Yes (GitHub only) | Limited |
| **GIF Support** | Yes | Yes | No | No | No |
| **Image Support** | Yes | Yes | No | No | No |
| **@Mentions** | Yes | Yes | Yes | No | Yes |
| **Moderation Tools** | Yes | Yes | Limited | No | Yes |
| **Mobile Responsive** | Yes | Yes | Yes | Yes | Yes |
| **Authentication** | Username/Email | Social/Email | GitHub | GitHub | Email/OAUTH |
| **Dark Mode** | Yes | Limited | Yes | Yes | Yes |
| **GDPR Compliant** | Yes | No | Yes | Yes | Yes |
| **Learning Curve** | Medium | Easy | Easy | Easy | Medium |
| **Performance** | Excellent | Good | Excellent | Excellent | Good |
| **Community Support** | Growing | Large | Large | Growing | Small |

### Why Choose Commex?

- **Data Ownership:** Your comments stay in your database—no vendor lock-in
- **Flexibility:** Each organization controls its own MongoDB instance
- **Privacy:** GDPR compliant with full data control
- **Modern UX:** Dark-first, responsive design with threading
- **Rich Media:** GIFs, images, and emoji reactions out of the box
- **Scalable:** Self-hosted means unlimited scale based on your infrastructure

---

## System Requirements

- Node.js 18+
- npm 8+ or yarn 3+
- MongoDB 4.4+ (Atlas or self-hosted)
- Git

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/OpenCommex/Commex.git
cd Commex
npm install
```

### 2. Set Up MongoDB

Choose one:
- MongoDB Atlas (Cloud) — Easiest, no setup required
- Self-Hosted MongoDB — Full control

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your MongoDB connection string:

```env
PORT=3000
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/commex
JWT_SECRET=your-long-random-secret-here
APP_URL=http://localhost:3000
TENOR_API_KEY=your-tenor-api-key  # optional
```

### 4. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` — you're live!

---

## MongoDB Setup

Commex uses two MongoDB databases:

1. **Central DB** — stores users and organization metadata (set in MONGODB_URI)
2. **Per-org DB** — each organization provides its own connection string for storing comments/reactions

Choose the setup that best fits your needs:

---

### Option A: MongoDB Atlas (Cloud)

Recommended for: First-time users, small to medium projects, minimal DevOps.

#### Step 1: Create a MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas
2. Click Sign Up and create your account
3. Verify your email

#### Step 2: Create a Project

1. Click New Project in the left sidebar
2. Enter a project name (e.g., "Commex")
3. Click Next → Create Project

#### Step 3: Create a Cluster

1. In your project, click Build a Cluster
2. Select the Free tier (M0) for testing, or M2/M5+ for production
3. Choose your cloud provider (AWS, Google Cloud, or Azure) and region closest to your users
4. Click Create Cluster (takes 2-3 minutes)

#### Step 4: Add Database User

1. Go to Database Access in the left sidebar
2. Click Add New Database User
3. Choose Password Authentication
4. Enter username: `commex_user`
5. Enter password: (generate a strong one or use the auto-generated option)
6. Limit to specific databases (optional, recommended)
7. Click Add User

Keep your password safe!

#### Step 5: Whitelist IP Address (Allow 0.0.0.0)

IMPORTANT: To allow connections from anywhere (development/testing), you must whitelist 0.0.0.0:

1. Go to Network Access in the left sidebar
2. Click Add IP Address
3. Enter `0.0.0.0/0` to allow all IPs (Development only!)

   For Production: Use your actual server IP address instead of 0.0.0.0

4. Click Confirm

SECURITY NOTE: 0.0.0.0/0 allows anyone to connect if they have your credentials. For production, replace with your server's IP or use other authentication methods (VPC, IP ranges, etc.).

#### Step 6: Get Connection String

1. Go back to Clusters
2. Click Connect on your cluster
3. Select Drivers
4. Choose Node.js and version 5.5 or later
5. Copy the connection string:

   ```
   mongodb+srv://commex_user:YOUR_PASSWORD@cluster.mongodb.net/commex
   ```

6. Replace YOUR_PASSWORD with your actual password

#### Step 7: Create Databases

1. Click Browse Collections in your cluster
2. Click + Create Database
3. Create the main database:
   - Database name: `commex`
   - Collection name: `users`
   - Click Create

Now add the connection string to your `.env`:

```env
MONGODB_URI=mongodb+srv://commex_user:YOUR_PASSWORD@cluster.mongodb.net/commex
```

---

### Option B: Self-Hosted MongoDB

Recommended for: Full control, large deployments, on-premises environments.

#### Step 1: Install MongoDB

On Ubuntu/Debian:

```bash
# Add MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/mongodb-server-7.0.gpg

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Update and install
sudo apt-get update
sudo apt-get install -y mongodb-org
```

On macOS (with Homebrew):

```bash
brew tap mongodb/brew
brew install mongodb-community
```

On Windows:

Download and run the MongoDB installer at https://www.mongodb.com/try/download/community

#### Step 2: Start MongoDB

On Linux (systemd):

```bash
sudo systemctl start mongod
sudo systemctl enable mongod  # Auto-start on reboot
```

On macOS (Homebrew):

```bash
brew services start mongodb-community
```

On Windows (PowerShell as Administrator):

```powershell
net start MongoDB
```

#### Step 3: Verify MongoDB is Running

```bash
mongo --eval "db.version()"
```

You should see the version number (e.g., 7.0.0).

#### Step 4: Create Database User

Open the MongoDB shell:

```bash
mongosh  # MongoDB 5.0+
# OR
mongo    # MongoDB <5.0
```

Run these commands:

```javascript
// Switch to admin database
use admin

// Create admin user (if needed)
db.createUser({
  user: "admin",
  pwd: "admin_password",
  roles: ["root"]
})

// Switch to your commex database
use commex

// Create commex user
db.createUser({
  user: "commex_user",
  pwd: "commex_password",
  roles: [
    { role: "readWrite", db: "commex" }
  ]
})

// Verify user was created
show users
```

Exit the shell:

```bash
exit
```

#### Step 5: Configure Network Access (Allow 0.0.0.0)

Edit MongoDB configuration file:

On Linux:

```bash
sudo nano /etc/mongod.conf
```

On macOS:

```bash
nano /usr/local/etc/mongod.conf
```

Find the `net:` section and update:

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0  # Allow connections from any IP
  # For production, use specific IPs: bindIp: 127.0.0.1,10.0.0.5
```

Restart MongoDB:

```bash
sudo systemctl restart mongod  # Linux
brew services restart mongodb-community  # macOS
```

#### Step 6: Enable Authentication (Optional but Recommended)

Edit MongoDB config:

```yaml
security:
  authorization: enabled
```

Restart MongoDB and reconnect:

```bash
mongosh -u admin -p admin_password --authenticationDatabase admin
```

#### Step 7: Get Connection String

Local Development:

```
mongodb://commex_user:commex_password@localhost:27017/commex
```

Remote Connection (from another server):

```
mongodb://commex_user:commex_password@YOUR_SERVER_IP:27017/commex
```

With Authentication:

```
mongodb://commex_user:commex_password@localhost:27017/commex?authSource=admin
```

Add to `.env`:

```env
MONGODB_URI=mongodb://commex_user:commex_password@localhost:27017/commex?authSource=admin
```

#### Step 8: Create Databases

```bash
mongosh -u commex_user -p commex_password --authenticationDatabase admin

use commex
db.createCollection("users")
```

---

## Environment Configuration

Create a `.env` file in the root directory:

```env
# Server
PORT=3000
NODE_ENV=development

# Database (Main)
MONGODB_URI=mongodb+srv://commex_user:YOUR_PASSWORD@cluster.mongodb.net/commex

# Security
JWT_SECRET=your-long-random-secret-here-change-this-in-production
JWT_EXPIRES_IN=7d

# Application
APP_URL=http://localhost:3000

# Optional: GIF Search
TENOR_API_KEY=your-tenor-api-key

# Optional: Rate Limiting
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX=100                # 100 requests per window
```

### Generate Secure JWT Secret

```bash
openssl rand -base64 32
```

Copy the output and paste it as JWT_SECRET.

---

## Development

### Start Development Server

```bash
npm run dev
```

The server will auto-reload on file changes. Visit http://localhost:3000

### Build for Production

```bash
npm run build
```

### Run Production Build

```bash
npm start
```

---

## Creating Your First Organization

1. Register an account at http://localhost:3000
2. Click Dashboard
3. Click Create Organization
4. Fill in:
   - Organization Name (e.g., "My Blog")
   - MongoDB Connection String — this is where comments will be stored

   Examples:
   - Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/my-blog`
   - Self-hosted: `mongodb://user:pass@localhost:27017/my-blog?authSource=admin`

5. Click Test Connection to verify
6. Click Create
7. Go to Embed tab and copy your snippet

---

## Embedding on Your Website

Add this to any HTML page where you want comments:

```html
<!-- Commex Comments Widget -->
<div id="commex-widget"></div>
<script>
  window.CommexConfig = {
    orgSlug: "my-blog",           // Your organization slug
    pageUrl: window.location.href, // Current page URL
    pageTitle: document.title,     // Current page title
  };
</script>
<script src="https://your-commex-domain.com/embed/commex.js" async></script>
```

### CommexConfig Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| orgSlug | Yes | — | Your organization slug (from dashboard) |
| pageUrl | No | window.location.href | Unique identifier for this page's comments |
| pageTitle | No | document.title | Page title shown in notifications |
| targetId | No | commex-widget | HTML element ID to mount widget |
| theme | No | dark | dark or light |
| accentColor | No | — | Custom accent color (hex, e.g., #7c3aed) |

### Example: Blog Post

```html
<article>
  <h1>My First Blog Post</h1>
  <p>Article content here...</p>
  
  <!-- Comments Section -->
  <section style="margin-top: 2rem;">
    <h2>Comments</h2>
    <div id="commex-widget"></div>
    <script>
      window.CommexConfig = {
        orgSlug: "my-blog",
        pageUrl: "https://example.com/blog/first-post",
        pageTitle: "My First Blog Post",
        theme: "dark"
      };
    </script>
    <script src="https://your-commex-domain.com/embed/commex.js" async></script>
  </section>
</article>
```

---

## Production Deployment

### Option 1: Docker

Create a Dockerfile (already in repo):

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

Build and run:

```bash
docker build -t commex .
docker run -p 3000:80 \
  -e MONGODB_URI="mongodb+srv://user:pass@..." \
  -e JWT_SECRET="your-secret" \
  -e APP_URL="https://commex.example.com" \
  commex
```

### Option 2: VPS with PM2

1. SSH into your server
2. Clone the repo:

```bash
git clone https://github.com/OpenCommex/Commex.git
cd Commex
npm install
```

3. Create `.env` with production values:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/commex
JWT_SECRET=$(openssl rand -base64 32)
APP_URL=https://commex.example.com
```

4. Install and start with PM2:

```bash
npm install -g pm2
pm2 start src/server.js --name commex
pm2 save
pm2 startup
```

5. Set up Nginx reverse proxy:

```nginx
server {
    listen 80;
    server_name commex.example.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name commex.example.com;
    
    ssl_certificate /etc/letsencrypt/live/commex.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/commex.example.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

6. Enable SSL with Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d commex.example.com
```

---

## Troubleshooting

### MongoDB Connection Failed

Error: `MongoNetworkError: getaddrinfo ENOTFOUND cluster.mongodb.net`

Solution:
- Check your MONGODB_URI is correct
- Verify IP 0.0.0.0 is whitelisted in MongoDB Atlas
- Ensure your network allows outbound connections on port 27017

### Port 3000 Already in Use

```bash
# Find and kill the process
lsof -i :3000
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### JWT Secret Missing

Error: `JWT_SECRET is required`

Solution:
```bash
# Generate one
openssl rand -base64 32

# Add to .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
```

### MongoDB Authentication Failed

Error: `MongoAuthenticationError: authentication failed`

Solution:
- Double-check username and password in MONGODB_URI
- For self-hosted: verify authSource=admin is in the connection string
- Reset MongoDB user credentials:

```bash
use admin
db.dropUser("commex_user")
db.createUser({
  user: "commex_user",
  pwd: "new_password",
  roles: [{ role: "readWrite", db: "commex" }]
})
```

### Embed Widget Not Appearing

1. Check console for errors (F12)
2. Verify orgSlug matches your dashboard slug
3. Ensure CORS is allowed (should be by default)
4. Check that APP_URL matches your domain in production

---

## Contributing

We love contributions! Here's how:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/awesome-feature`
3. Commit your changes: `git commit -m 'Add awesome feature'`
4. Push to the branch: `git push origin feature/awesome-feature`
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/OpenCommex/Commex.git
cd Commex
npm install
npm run dev
```

### Code Style

- Use 2-space indentation
- Follow ESLint rules: `npm run lint`
- Write meaningful commit messages

---

## License

GPL3 License — See LICENSE file for details.

---

## Support

- Issues: https://github.com/OpenCommex/Commex/issues
- Discussions: https://github.com/OpenCommex/Commex/discussions
- Email: abdullahaladnan95@gmail.com (maintainer)

---

## Stack

- Frontend: HTML, JavaScript, CSS (Dark-first design)
- Backend: Node.js 18+
- Database: MongoDB 4.4+
- Deployment: Docker, PM2, or VPS
- GIF Provider: Tenor API

---

Made with care by the OpenCommex team. Happy commenting!
