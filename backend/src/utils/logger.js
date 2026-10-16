'use strict';
const env = require('../config/env');
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SENSITIVE = /(password|secret|token|authorization|cookie|api[_-]?key)/i;

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v);
  return out;
}

function log(level, message, meta) {
  if (LEVELS[level] > (LEVELS[env.logLevel] ?? 2)) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...(meta ? { meta: redact(meta) } : {}) });
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = {
  error: (m, meta) => log('error', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  info: (m, meta) => log('info', m, meta),
  debug: (m, meta) => log('debug', m, meta),
};
