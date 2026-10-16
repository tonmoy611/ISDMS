'use strict';
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const pw = require('../utils/password');
const tokens = require('../utils/tokens');
const { writeAudit } = require('./audit');
const permissionService = require('./permissionService');
const comm = require('./communication');

const USER_SQL = `SELECT u.id, u.university_id, u.login_id, u.full_name, u.email, u.phone, u.password_hash, u.status,
  u.must_change_password, u.failed_login_attempts,
  (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked,
  GREATEST(TIMESTAMPDIFF(MINUTE, NOW(), u.locked_until), 0) + 1 AS lock_minutes_left,
  r.code AS role, un.status AS university_status
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN universities un ON un.id = u.university_id
  WHERE u.deleted_at IS NULL AND `;

const invalidLogin = () => AppError.unauthorized('Invalid login ID or password.');

const publicUser = (u, permissions = []) => ({
  id: u.id, universityId: u.university_id, loginId: u.login_id, fullName: u.full_name,
  email: u.email, role: u.role, status: u.status, mustChangePassword: !!u.must_change_password, permissions,
});

async function createSession(conn, user, ctx) {
  const refreshToken = tokens.newRefreshToken();
  const [r] = await conn.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?)`,
    [user.id, tokens.hashToken(refreshToken), env.auth.refreshTtlDays, ctx.ip || null, (ctx.userAgent || '').slice(0, 255) || null]);
  return { sessionId: r.insertId, accessToken: tokens.signAccessToken(user), refreshToken };
}

const revokeAll = (conn, userId) =>
  conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);

function assertCanSignIn(user) {
  if (user.university_id != null && user.university_status !== 'active') throw new AppError(403, 'UNIVERSITY_INACTIVE', 'This university account is inactive. Contact TD-X Lab or your administrator.');
  if (user.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED', 'This account is blocked. Contact the university administration.');
  if (user.status === 'inactive') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is inactive. Contact the university administration.');
}

async function login({ loginId, password }, ctx) {
  const [rows] = await pool.query(`${USER_SQL}(u.login_id = ? OR u.email = ?) LIMIT 1`, [loginId, loginId]);
  const user = rows[0];

  if (!user) {
    await pw.compare(password, pw.dummyHash());
    await writeAudit({ ctx, action: 'login_failed', newValue: { reason: 'unknown_account' } });
    throw invalidLogin();
  }
  if (user.is_locked) {
    await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'login_blocked_locked' });
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${user.lock_minutes_left} minute(s).`);
  }

  if (!(await pw.compare(password, user.password_hash))) {
    const nowLocked = user.failed_login_attempts + 1 >= env.auth.maxFailedAttempts;
    // locked_until must be assigned before failed_login_attempts: MySQL evaluates SET left to right.
    await pool.query(
      `UPDATE users SET locked_until = IF(failed_login_attempts + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), locked_until),
       failed_login_attempts = IF(failed_login_attempts + 1 >= ?, 0, failed_login_attempts + 1) WHERE id = ?`,
      [env.auth.maxFailedAttempts, env.auth.lockMinutes, env.auth.maxFailedAttempts, user.id]);
    await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: nowLocked ? 'account_locked' : 'login_failed' });
    throw invalidLogin();
  }

  assertCanSignIn(user);

  if (user.status === 'pending_verification') {
    // The temporary password is correct, but identity must still be confirmed by a one-time code before a session exists.
    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'login_verification_required' });
    return { verificationRequired: true, verificationToken: tokens.signVerificationToken(user.id), channels: comm.channelsFor(user) };
  }

  const session = await withTransaction(async (conn) => {
    await conn.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
    return createSession(conn, user, ctx);
  });
  await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'login' });
  return { user: publicUser(user, await permissionService.forUser(user)), ...session };
}

async function refresh(token, ctx) {
  if (!token) throw AppError.unauthorized();
  const outcome = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      'SELECT id, user_id, revoked_at, (expires_at <= NOW()) AS expired FROM refresh_tokens WHERE token_hash = ? FOR UPDATE',
      [tokens.hashToken(token)]);
    const row = rows[0];
    if (!row) return { fail: true };
    if (row.revoked_at) { await revokeAll(conn, row.user_id); return { fail: true, reuse: row.user_id }; }
    if (row.expired) return { fail: true };

    const [urows] = await conn.query(`${USER_SQL}u.id = ?`, [row.user_id]);
    const user = urows[0];
    if (!user || user.status !== 'active') { await revokeAll(conn, row.user_id); return { fail: true }; }

    const session = await createSession(conn, user, ctx);
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE id = ?', [session.sessionId, row.id]);
    return { user, session };
  });

  if (outcome.fail) {
    if (outcome.reuse) await writeAudit({ ctx, userId: outcome.reuse, action: 'refresh_token_reuse_detected' });
    throw AppError.unauthorized('Session expired. Please sign in again.');
  }
  return { user: publicUser(outcome.user, await permissionService.forUser(outcome.user)), ...outcome.session };
}

async function logout(token, ctx) {
  if (!token) return;
  const hash = tokens.hashToken(token);
  const [rows] = await pool.query('SELECT user_id FROM refresh_tokens WHERE token_hash = ?', [hash]);
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [hash]);
  if (rows[0]) await writeAudit({ ctx, userId: rows[0].user_id, action: 'logout' });
}

async function changePassword(userId, { currentPassword, newPassword }, ctx) {
  const [rows] = await pool.query(`${USER_SQL}u.id = ?`, [userId]);
  const user = rows[0];
  if (!user) throw AppError.unauthorized();

  if (!(await pw.compare(currentPassword, user.password_hash))) {
    await writeAudit({ ctx, userId, universityId: user.university_id, action: 'password_change_failed' });
    throw AppError.validation('Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
  }
  const problems = pw.policyProblems(newPassword, { loginId: user.login_id, email: user.email });
  if (newPassword === currentPassword) problems.push('New password must differ from the current one.');
  if (problems.length) throw AppError.validation('New password does not meet the requirements.', { newPassword: problems });

  const newHash = await pw.hash(newPassword);
  const session = await withTransaction(async (conn) => {
    await conn.query('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW() WHERE id = ?', [newHash, userId]);
    await revokeAll(conn, userId); // signs out every other device
    return createSession(conn, user, ctx);
  });
  await writeAudit({ ctx, userId, universityId: user.university_id, action: 'password_changed', targetType: 'user', targetId: userId });
  comm.notify.passwordChanged({ id: userId, fullName: user.full_name, email: user.email, universityId: user.university_id }, 'by you');
  return { user: { ...publicUser(user, await permissionService.forUser(user)), mustChangePassword: false }, ...session };
}

module.exports = { login, refresh, logout, changePassword, publicUser, createSession, revokeAll, USER_SQL };
