'use strict';
const env = require('../config/env');
const AppError = require('../utils/AppError');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie auth: SameSite=Lax cookies plus an Origin check on state-changing requests.
 * Browsers always send Origin on cross-site POST/PUT/PATCH/DELETE, so a forged request is rejected.
 * Non-browser clients send no Origin and are not affected by CSRF.
 */
module.exports = (req, res, next) => {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) return next(AppError.forbidden('Request origin is not allowed.'));
  return next();
};
