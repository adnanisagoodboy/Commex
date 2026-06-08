require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const app = express();

//  Security & Middleware 
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,   // lets /embed/commex.js load cross-origin
  crossOriginOpenerPolicy: false,
}));

// Full CORS for all routes — embed widget calls the API from third-party sites
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Commex-Token'],
  credentials: false,
}));

// Handle preflight OPTIONS for every route
app.options('*', cors());

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

//  Rate Limiting 
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

//  Static Files 
// Serve public dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Serve embed script with explicit cross-origin headers
app.use('/embed', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
  next();
}, express.static(path.join(__dirname, '../embed')));

//  Database Connection 
const { connectDB } = require('./utils/database');
connectDB();

//  Routes 
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/orgs',          require('./routes/orgs'));
app.use('/api/comments',      require('./routes/comments'));
app.use('/api/reactions',     require('./routes/reactions'));
app.use('/api/gifs',          require('./routes/gifs'));
app.use('/api/embed',         require('./routes/embed'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/moderation',    require('./routes/moderation'));
app.use('/health',            require('./routes/health'));

//  Public profile & org pages 
app.get('/profile/:username', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile.html'));
});
app.get('/org/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/org.html'));
});

//  Serve Frontend (SPA fallback) 
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

//  Error Handler 
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

//  Start Server 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║         COMMEX SERVER RUNNING         ║
  ║   http://localhost:${PORT}               ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;

//  Public profile and org pages 
// These must come BEFORE the catch-all SPA fallback above
