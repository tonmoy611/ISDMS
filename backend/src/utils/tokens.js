'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const OPTS = { algorithms: ['HS256'], issuer: 'isdms' };

const signAccessToken = (user) =>
  jwt.sign({ role: user.role, uni: user.university_id ?? null }, env.auth.jwtSecret, {
    algorithm: 'HS256', issuer: 'isdms', subject: String(user.id), expiresIn: `${env.auth.accessTtlMin}m`,
  });

const verifyAccessToken = (token) => jwt.verify(token, env.auth.jwtSecret, OPTS);
const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// First-login verification token. Signed with a different secret so it can never be accepted as an access token.
const verifySecret = () => `${env.auth.jwtSecret}:verification`;
const signVerificationToken = (userId) => jwt.sign({ purpose: 'verify' }, verifySecret(), { algorithm: 'HS256', issuer: 'isdms', subject: String(userId), expiresIn: '15m' });
const verifyVerificationToken = (t) => {
  const p = jwt.verify(t, verifySecret(), OPTS);
  if (p.purpose !== 'verify') throw new Error('wrong token purpose');
  return p;
};

module.exports = { signVerificationToken, verifyVerificationToken, signAccessToken, verifyAccessToken, newRefreshToken, hashToken };
