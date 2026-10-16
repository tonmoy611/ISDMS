'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/userService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
router.use(authenticate());

router.get('/', requirePermission('users.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await svc.list(req.user, req.query) });
}));
router.post('/', requirePermission('users.create'), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: { user: await svc.create(req.user, req.body, ctx(req)) } });
}));
router.get('/:id', requirePermission('users.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: await svc.get(req.user, parseId(req.params.id)) } });
}));
router.patch('/:id', requirePermission('users.update'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: await svc.update(req.user, parseId(req.params.id), req.body, ctx(req)) } });
}));
router.post('/:id/status', requirePermission('users.status'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: await svc.setStatus(req.user, parseId(req.params.id), req.body?.status, ctx(req)) } });
}));
router.post('/:id/reset-password', requirePermission('users.update'), asyncHandler(async (req, res) => {
  await svc.resetPassword(req.user, parseId(req.params.id), req.body?.temporaryPassword, ctx(req));
  res.json({ success: true, data: null });
}));

module.exports = router;
