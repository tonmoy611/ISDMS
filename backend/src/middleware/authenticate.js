'use strict';
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const { ACCESS } = require('../utils/cookies');

/**
 * Verifies the access token and loads the CURRENT user from the database, so blocking
 * or deactivating an account takes effect on the next request.
 * Users who must change their password are refused unless allowPasswordChange is set.
 */
module.exports = ({ allowPasswordChange = false } = {}) => asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = req.cookies?.[ACCESS] || (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) throw AppError.unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw new AppError(401, err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.university_id, u.login_id, u.full_name, u.email, u.status, u.must_change_password, r.code AS role, un.status AS university_status
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN universities un ON un.id = u.university_id WHERE u.id = ? AND u.deleted_at IS NULL`, [payload.sub]);
  const u = rows[0];
  if (!u) throw AppError.unauthorized();
  if (u.status !== 'active') throw AppError.forbidden('This account is not active.');
  if (u.university_id != null && u.university_status !== 'active') throw new AppError(403, 'UNIVERSITY_INACTIVE', 'This university account is inactive.');
  if (u.must_change_password && !allowPasswordChange) {
    throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.');
  }
  req.user = u;
  next();
});
