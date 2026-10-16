'use strict';
const router = require('express').Router();
const env = require('../../config/env');

// Public, non-sensitive product information. Never include secrets here.
router.get('/info', (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Integrated Student Database Management System',
      shortName: env.appName,
      version: env.version,
      developer: env.developer,
      copyright: '© TD-X Lab 2026. All Rights Reserved.',
      apiVersion: 'v1',
    },
  });
});

module.exports = router;
