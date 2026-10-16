'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/universityService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
router.use(authenticate());

router.get('/', requirePermission('structure.view'), asyncHandler(async (req, res) => res.json({ success: true, data: await svc.list(req.user, req.query) })));
router.get('/:id', requirePermission('structure.view'), asyncHandler(async (req, res) => res.json({ success: true, data: { university: await svc.get(req.user, parseId(req.params.id)) } })));
// Writes are Super Admin only; the service further limits create and status changes to the platform-level Super Admin.
router.post('/', authorize(), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { university: await svc.create(req.user, req.body, ctx(req)) } })));
router.patch('/:id', authorize(), asyncHandler(async (req, res) => res.json({ success: true, data: { university: await svc.update(req.user, parseId(req.params.id), req.body, ctx(req)) } })));
router.post('/:id/status', authorize(), asyncHandler(async (req, res) => res.json({ success: true, data: { university: await svc.setStatus(req.user, parseId(req.params.id), req.body?.status, ctx(req)) } })));

module.exports = router;
