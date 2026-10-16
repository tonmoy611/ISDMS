'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/sectionService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

// Fixed paths before /:id. Rooms and calendar events are served by the generic /structure resources.
router.get('/teachers', requirePermission('sections.manage'), asyncHandler(async (req, res) => ok(res, { teachers: await svc.teachers(req.user, req.query.universityId) })));
router.get('/timetable', requirePermission('sections.view'), asyncHandler(async (req, res) => ok(res, { slots: await svc.timetable(req.user, req.query) })));
router.get('/teaching', authorize('teacher'), asyncHandler(async (req, res) => ok(res, { sections: await svc.teaching(req.user, req.query) })));

router.get('/', requirePermission('sections.view'), asyncHandler(async (req, res) => ok(res, await svc.list(req.user, req.query))));
router.post('/', requirePermission('sections.manage'), asyncHandler(async (req, res) => ok(res, await svc.create(req.user, req.body, ctx(req)), 201)));
router.get('/:id', requirePermission('sections.view'), asyncHandler(async (req, res) => ok(res, await svc.get(req.user, parseId(req.params.id)))));
router.patch('/:id', requirePermission('sections.manage'), asyncHandler(async (req, res) => ok(res, await svc.update(req.user, parseId(req.params.id), req.body, ctx(req)))));
router.delete('/:id', requirePermission('sections.manage'), asyncHandler(async (req, res) => { await svc.remove(req.user, parseId(req.params.id), ctx(req)); ok(res, null); }));
router.put('/:id/slots', requirePermission('sections.manage'), asyncHandler(async (req, res) => ok(res, await svc.setSlots(req.user, parseId(req.params.id), req.body?.slots, ctx(req)))));

module.exports = router;
