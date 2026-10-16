'use strict';
const AppError = require('../utils/AppError');

/** Allow only the listed role codes. Super Admin always passes. Use after authenticate(). */
module.exports = (...roles) => (req, res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  if (req.user.role === 'super_admin' || roles.includes(req.user.role)) return next();
  return next(AppError.forbidden());
};
