'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const requirePermission = require('../../middleware/requirePermission');
const RESOURCES = require('../../services/structureConfig');
const svc = require('../../services/structureService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
router.use(authenticate());
router.param('resource', (req, res, next, name) => {
  if (!Object.prototype.hasOwnProperty.call(RESOURCES, name)) return next(AppError.notFound('Unknown resource'));
  req.cfg = RESOURCES[name];
  return next();
});

// A resource may name its own permissions (courses do); otherwise the structure permissions apply.
const guard = (kind) => (req, res, next) => requirePermission(req.cfg.perm?.[kind] || `structure.${kind}`)(req, res, next);
const view = guard('view');
const manage = guard('manage');

router.get('/:resource', view, asyncHandler(async (req, res) => res.json({ success: true, data: await svc.list(req.user, req.cfg, req.query) })));
router.post('/:resource', manage, asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { item: await svc.create(req.user, req.cfg, req.body, ctx(req)) } })));
router.get('/:resource/:id', view, asyncHandler(async (req, res) => res.json({ success: true, data: { item: await svc.get(req.user, req.cfg, parseId(req.params.id)) } })));
router.patch('/:resource/:id', manage, asyncHandler(async (req, res) => res.json({ success: true, data: { item: await svc.update(req.user, req.cfg, parseId(req.params.id), req.body, ctx(req)) } })));
router.delete('/:resource/:id', manage, asyncHandler(async (req, res) => { await svc.remove(req.user, req.cfg, parseId(req.params.id), ctx(req)); res.json({ success: true, data: null }); }));
router.post('/:resource/:id/set-current', manage, asyncHandler(async (req, res) => res.json({ success: true, data: { item: await svc.setCurrent(req.user, req.cfg, parseId(req.params.id), ctx(req)) } })));

module.exports = router;
