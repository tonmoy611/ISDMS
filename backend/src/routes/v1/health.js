'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { checkConnection } = require('../../config/db');
const env = require('../../config/env');

// Liveness + dependency status. Returns 503 when the database is unreachable.
router.get('/', asyncHandler(async (req, res) => {
  const db = await checkConnection();
  res.status(db.ok ? 200 : 503).json({
    success: db.ok,
    data: {
      status: db.ok ? 'ok' : 'degraded',
      app: env.appName,
      version: env.version,
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: db.ok ? 'up' : 'down', latencyMs: db.latencyMs },
      timestamp: new Date().toISOString(),
    },
  });
}));

module.exports = router;
