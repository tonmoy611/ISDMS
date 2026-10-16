'use strict';
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const comm = require('./communication');

const hashCode = (userId, purpose, code) => crypto.createHmac('sha256', env.auth.jwtSecret).update(`${userId}:${purpose}:${code}`).digest('hex');
const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const invalid = () => AppError.validation('That code is invalid or has expired. Request a new one.', { code: 'Invalid or expired code.' });

/**
 * Creates a single-use code (older unused codes are cancelled) and sends it.
 * Throws 429 when too many were requested, 503 when the message could not be sent.
 */
async function issue(user, purpose, channel) {
  const destination = channel === 'email' ? user.email : user.phone;
  if (!destination) throw AppError.badRequest('That contact method is not on file.');

  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM verification_codes WHERE user_id = ? AND purpose = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)', [user.id, purpose]);
  if (n >= env.verification.maxSends) throw AppError.rateLimited('Too many codes requested. Please wait 15 minutes and try again.');

  const code = generateCode();
  const id = await withTransaction(async (conn) => {
    await conn.query('UPDATE verification_codes SET consumed_at = NOW() WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL', [user.id, purpose]);
    const [r] = await conn.query(
      'INSERT INTO verification_codes (user_id, purpose, channel, code_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
      [user.id, purpose, channel, hashCode(user.id, purpose, code), env.verification.codeTtlMin]);
    return r.insertId;
  });

  const template = purpose === 'first_login' ? 'verificationCode' : 'passwordResetCode';
  const res = await comm.send(channel, template, { fullName: user.full_name, code, minutes: env.verification.codeTtlMin }, destination, { userId: user.id, universityId: user.university_id });
  if (!res.ok) {
    await pool.query('UPDATE verification_codes SET consumed_at = NOW() WHERE id = ?', [id]);
    throw new AppError(503, 'DELIVERY_FAILED', 'We could not send the code. Please try again in a few minutes.');
  }
}

/** Checks the newest unused code. A wrong guess counts against the attempt limit. A right guess is consumed atomically. */
async function verify(userId, purpose, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
  const [rows] = await pool.query(
    'SELECT id, code_hash, attempts FROM verification_codes WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [userId, purpose]);
  const row = rows[0];
  if (!row || row.attempts >= env.verification.maxAttempts) throw invalid();

  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(userId, purpose, code), 'hex');
  if (!crypto.timingSafeEqual(expected, given)) {
    await pool.query('UPDATE verification_codes SET attempts = attempts + 1, consumed_at = IF(attempts + 1 >= ?, NOW(), NULL) WHERE id = ?', [env.verification.maxAttempts, row.id]);
    throw invalid();
  }
  const [r] = await pool.query('UPDATE verification_codes SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL', [row.id]);
  if (r.affectedRows !== 1) throw invalid(); // another request used it first
}

module.exports = { issue, verify, hashCode, generateCode };
