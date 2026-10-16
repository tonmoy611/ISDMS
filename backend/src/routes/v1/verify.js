'use strict';
// Public: anyone holding a document can check it. Rate limited, and it reveals nothing without the printed code.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const AppError = require('../../utils/AppError');
const asyncHandler = require('../../utils/asyncHandler');
const svc = require('../../services/documentService');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(AppError.rateLimited('Too many checks. Please wait and try again.')),
});

router.get('/:serial', limiter, asyncHandler(async (req, res) => {
  const code = String(req.query.code || '');
  if (!/^[0-9A-Fa-f]{12}$/.test(code)) throw AppError.validation('Enter the 12-character verification code printed on the document.', { code: 'Enter the 12-character code.' });
  res.json({ success: true, data: await svc.verify(req.params.serial.toUpperCase(), code) });
}));

module.exports = router;
