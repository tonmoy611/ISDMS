'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const pw = require('../utils/password');
const tokens = require('../utils/tokens');
const auth = require('./authService');
const verification = require('./verificationService');
const comm = require('./communication');
const permissionService = require('./permissionService');
const { writeAudit } = require('./audit');
const logger = require('../utils/logger');

const expired = () => AppError.unauthorized('Your verification session expired. Please sign in again.');

async function pendingUserFromToken(token) {
  let payload;
  try { payload = tokens.verifyVerificationToken(String(token || '')); } catch { throw expired(); }
  const [rows] = await pool.query(`${auth.USER_SQL}u.id = ?`, [payload.sub]);
  const user = rows[0];
  if (!user || user.status !== 'pending_verification') throw expired();
  return user;
}

async function sendVerificationCode(token, channel, ctx) {
  const user = await pendingUserFromToken(token);
  const option = comm.channelsFor(user).find((c) => c.channel === channel);
  if (!option) throw AppError.validation('Choose one of the available contact methods.', { channel: 'Not available for this account.' });
  await verification.issue(user, 'first_login', channel);
  await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'verification_code_sent', newValue: { channel } });
  return { channel, destination: option.masked };
}

async function completeVerification(token, code, newPassword, ctx) {
  const user = await pendingUserFromToken(token);
  // Check the password first so a weak password never burns a valid code.
  const problems = pw.policyProblems(newPassword, { loginId: user.login_id, email: user.email });
  if (!problems.length && (await pw.compare(newPassword, user.password_hash))) problems.push('Choose a password different from your temporary one.');
  if (problems.length) throw AppError.validation('New password does not meet the requirements.', { newPassword: problems });

  await verification.verify(user.id, 'first_login', code);
  const hash = await pw.hash(newPassword);
  const active = { ...user, status: 'active' };
  const session = await withTransaction(async (conn) => {
    await conn.query(
      "UPDATE users SET password_hash = ?, status = 'active', must_change_password = 0, password_changed_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?", [hash, user.id]);
    await auth.revokeAll(conn, user.id);
    return auth.createSession(conn, active, ctx);
  });
  await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'account_verified' });
  comm.notify.passwordChanged({ id: user.id, fullName: user.full_name, email: user.email, universityId: user.university_id }, 'first-time account setup');
  return { user: { ...auth.publicUser({ ...active, must_change_password: 0 }, await permissionService.forUser(active)) }, ...session };
}

/** Always resolves the same way, so it cannot be used to discover which IDs exist. */
async function forgotPassword(loginId, channel, ctx) {
  try {
    const [rows] = await pool.query(`${auth.USER_SQL}(u.login_id = ? OR u.email = ?) LIMIT 1`, [loginId, loginId]);
    const user = rows[0];
    if (!user || user.status !== 'active') return;
    const options = comm.channelsFor(user);
    const chosen = options.find((c) => c.channel === channel) || options[0];
    if (!chosen) return;
    await verification.issue(user, 'password_reset', chosen.channel);
    await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'password_reset_requested', newValue: { channel: chosen.channel } });
  } catch (err) {
    logger.warn('Password reset request not completed', { error: err.message });
  }
}

async function resetPassword(loginId, code, newPassword, ctx) {
  const [rows] = await pool.query(`${auth.USER_SQL}(u.login_id = ? OR u.email = ?) LIMIT 1`, [loginId, loginId]);
  const user = rows[0];
  const problems = user ? pw.policyProblems(newPassword, { loginId: user.login_id, email: user.email }) : pw.policyProblems(newPassword);
  if (problems.length) throw AppError.validation('New password does not meet the requirements.', { newPassword: problems });
  if (!user || user.status !== 'active') throw AppError.validation('That code is invalid or has expired. Request a new one.', { code: 'Invalid or expired code.' });

  await verification.verify(user.id, 'password_reset', code);
  const hash = await pw.hash(newPassword);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [hash, user.id]);
    await auth.revokeAll(conn, user.id);
  });
  await writeAudit({ ctx, userId: user.id, universityId: user.university_id, action: 'password_reset_completed' });
  comm.notify.passwordChanged({ id: user.id, fullName: user.full_name, email: user.email, universityId: user.university_id }, 'password reset');
}

module.exports = { sendVerificationCode, completeVerification, forgotPassword, resetPassword };
