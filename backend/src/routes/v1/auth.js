'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const AppError = require('../../utils/AppError');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middleware/authenticate');
const svc = require('../../services/authService');
const permissionService = require('../../services/permissionService');
const account = require('../../services/accountService');
const { REFRESH, setAuthCookies, clearAuthCookies } = require('../../utils/cookies');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

// Brute-force protection per IP, on top of the per-account lockout. Successful requests are not counted.
const strict = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(AppError.rateLimited('Too many attempts. Please wait 15 minutes and try again.')),
});

// These count every request (not only failures) because they always answer successfully.
const everyRequest = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(AppError.rateLimited('Too many requests. Please wait 15 minutes and try again.')),
});
const str = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;

router.post('/verification/send', everyRequest, asyncHandler(async (req, res) => {
  const { verificationToken, channel } = req.body || {};
  if (!str(verificationToken, 2000)) throw AppError.unauthorized('Your verification session expired. Please sign in again.');
  if (!['email', 'sms'].includes(channel)) throw AppError.validation('Choose email or SMS.', { channel: 'Choose email or SMS.' });
  res.json({ success: true, data: await account.sendVerificationCode(verificationToken, channel, ctx(req)) });
}));

router.post('/verification/complete', strict, asyncHandler(async (req, res) => {
  const { verificationToken, code, newPassword } = req.body || {};
  if (!str(verificationToken, 2000)) throw AppError.unauthorized('Your verification session expired. Please sign in again.');
  const errors = {};
  if (!/^\d{6}$/.test(String(code || ''))) errors.code = 'Enter the 6-digit code.';
  if (!str(newPassword, 128)) errors.newPassword = 'Enter a new password.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  const result = await account.completeVerification(verificationToken, String(code), newPassword, ctx(req));
  setAuthCookies(res, result);
  res.json({ success: true, data: { user: result.user } });
}));

router.post('/password/forgot', everyRequest, asyncHandler(async (req, res) => {
  const { loginId, channel } = req.body || {};
  if (!str(loginId, 100)) throw AppError.validation('Enter your login ID or email.', { loginId: 'Enter your login ID or email.' });
  await account.forgotPassword(loginId.trim(), channel, ctx(req));
  res.json({ success: true, data: { message: 'If an account matches, a reset code has been sent.' } });
}));

router.post('/password/reset', strict, asyncHandler(async (req, res) => {
  const { loginId, code, newPassword } = req.body || {};
  const errors = {};
  if (!str(loginId, 100)) errors.loginId = 'Enter your login ID or email.';
  if (!/^\d{6}$/.test(String(code || ''))) errors.code = 'Enter the 6-digit code.';
  if (!str(newPassword, 128)) errors.newPassword = 'Enter a new password.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  await account.resetPassword(loginId.trim(), String(code), newPassword, ctx(req));
  res.json({ success: true, data: { message: 'Password changed. You can sign in now.' } });
}));

router.post('/login', strict, asyncHandler(async (req, res) => {
  const { loginId, password } = req.body || {};
  const errors = {};
  if (typeof loginId !== 'string' || !loginId.trim() || loginId.length > 100) errors.loginId = 'Enter your login ID or email.';
  if (typeof password !== 'string' || !password || password.length > 128) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  const result = await svc.login({ loginId: loginId.trim(), password }, ctx(req));
  if (result.verificationRequired) {
    return res.json({ success: true, data: { verificationRequired: true, verificationToken: result.verificationToken, channels: result.channels } });
  }
  setAuthCookies(res, result);
  res.json({ success: true, data: { user: result.user } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const result = await svc.refresh(req.cookies?.[REFRESH], ctx(req));
    setAuthCookies(res, result);
    res.json({ success: true, data: { user: result.user } });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await svc.logout(req.cookies?.[REFRESH], ctx(req));
  clearAuthCookies(res);
  res.json({ success: true, data: null });
}));

router.get('/me', authenticate({ allowPasswordChange: true }), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: svc.publicUser(req.user, await permissionService.forUser(req.user)) } });
}));

router.post('/change-password', strict, authenticate({ allowPasswordChange: true }), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
    throw AppError.validation('Enter your current and new password.');
  }
  const result = await svc.changePassword(req.user.id, { currentPassword, newPassword }, ctx(req));
  setAuthCookies(res, result);
  res.json({ success: true, data: { user: result.user } });
}));

module.exports = router;
