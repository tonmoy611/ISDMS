'use strict';
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const permissions = require('../services/permissionService');

/** Require ALL listed permission codes. Use after authenticate(). Super Admin always passes. */
module.exports = (...codes) => asyncHandler(async (req, res, next) => {
  if (!req.user) throw AppError.unauthorized();
  if (!req.permissions) req.permissions = await permissions.forUser(req.user);
  if (req.permissions.includes('*') || codes.every((c) => req.permissions.includes(c))) return next();
  throw AppError.forbidden();
});
