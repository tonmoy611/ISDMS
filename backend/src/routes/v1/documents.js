'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const permissionService = require('../../services/permissionService');
const svc = require('../../services/documentService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

// A student, for themselves. Their own transcript is an unofficial copy.
const me = authorize('student');
router.get('/me', me, asyncHandler(async (req, res) => ok(res, { documents: await svc.listForStudent(await svc.studentByUser(req.user)) })));
router.get('/me/options', me, asyncHandler(async (req, res) => ok(res, await svc.myOptions(await svc.studentByUser(req.user)))));
router.post('/me/generate', me, asyncHandler(async (req, res) => {
  const student = await svc.studentByUser(req.user);
  ok(res, { document: await svc.generate(student, { ...req.body, override: false }, { actor: req.user, official: false, canOverride: false, ctx: ctx(req) }) }, 201);
}));

router.post('/me/receipts', me, asyncHandler(async (req, res) => {
  const student = await svc.studentByUser(req.user);
  ok(res, { document: await svc.generateReceipt(student, req.body?.paymentId, { actor: req.user, official: true, canOverride: false, ctx: ctx(req) }) }, 201);
}));

// Staff, for a student.
router.get('/students/:studentId', requirePermission('documents.view'), asyncHandler(async (req, res) => ok(res, { documents: await svc.listForStudent(await svc.studentById(req.user, parseId(req.params.studentId))) })));
router.post('/students/:studentId/generate', requirePermission('documents.issue'), asyncHandler(async (req, res) => {
  const student = await svc.studentById(req.user, parseId(req.params.studentId));
  const perms = req.permissions || await permissionService.forUser(req.user);
  const canOverride = perms.includes('*') || perms.includes('documents.override');
  ok(res, { document: await svc.generate(student, req.body, { actor: req.user, official: true, canOverride, ctx: ctx(req) }) }, 201);
}));

// A cashier (finance.collect) may print receipts without being able to issue other documents.
const anyOf = (...codes) => asyncHandler(async (req, res, next) => {
  const perms = req.permissions || (req.permissions = await permissionService.forUser(req.user));
  if (perms.includes('*') || codes.some((c) => perms.includes(c))) return next();
  throw AppError.forbidden();
});
router.post('/students/:studentId/receipts', anyOf('documents.issue', 'finance.collect'), asyncHandler(async (req, res) => {
  const student = await svc.studentById(req.user, parseId(req.params.studentId));
  ok(res, { document: await svc.generateReceipt(student, req.body?.paymentId, { actor: req.user, official: true, canOverride: false, ctx: ctx(req) }) }, 201);
}));

router.get('/', requirePermission('documents.view'), asyncHandler(async (req, res) => ok(res, await svc.list(req.user, req.query))));
router.get('/:id', asyncHandler(async (req, res) => ok(res, { document: await svc.getMeta(req.user, parseId(req.params.id)) })));
router.post('/:id/revoke', requirePermission('documents.manage'), asyncHandler(async (req, res) => ok(res, { document: await svc.revoke(req.user, parseId(req.params.id), req.body?.reason, ctx(req)) })));

// The printable page. A strict policy: no scripts, no outside resources, only inline style.
router.get('/:id/print', asyncHandler(async (req, res) => {
  const { html, serial } = await svc.getHtml(req.user, parseId(req.params.id));
  res.set({
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    ...(req.query.download === '1' ? { 'Content-Disposition': `attachment; filename="${String(serial || 'document').replace(/[^A-Za-z0-9-]/g, '')}.html"` } : {}),
  });
  res.send(html);
}));

module.exports = router;
