const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

router.get('/', (req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    db: dbState[mongoose.connection.readyState] || 'unknown',
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage().heapUsed,
  });
});

module.exports = router;
