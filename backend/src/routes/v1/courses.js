'use strict';
// Course CRUD itself (list, create, edit, delete) is served by /structure/courses. This router adds the course-specific rules.
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/courseService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data) => res.json({ success: true, data });
router.use(authenticate());

// Fixed paths first so they are never read as a course id.
router.get('/my', authorize('student'), asyncHandler(async (req, res) => ok(res, await svc.myCurriculum(req.user))));
router.get('/credit-rules', requirePermission('courses.view'), asyncHandler(async (req, res) => ok(res, { rules: await svc.listRules(req.user, req.query.universityId) })));
router.put('/credit-rules', requirePermission('courses.manage'), asyncHandler(async (req, res) => ok(res, { rules: await svc.saveRule(req.user, req.body, ctx(req)) })));
router.delete('/credit-rules/:id', requirePermission('courses.manage'), asyncHandler(async (req, res) => { await svc.deleteRule(req.user, parseId(req.params.id), ctx(req)); ok(res, null); }));
router.get('/curriculum/:programId', requirePermission('courses.view'), asyncHandler(async (req, res) => ok(res, await svc.curriculum(req.user, parseId(req.params.programId)))));
router.put('/curriculum/:programId', requirePermission('courses.manage'), asyncHandler(async (req, res) => ok(res, await svc.setCurriculum(req.user, parseId(req.params.programId), req.body?.items, ctx(req)))));
router.post('/validate-selection', requirePermission('courses.view'), asyncHandler(async (req, res) => ok(res, await svc.evaluateSelection(req.user, req.body))));

router.get('/:id', requirePermission('courses.view'), asyncHandler(async (req, res) => ok(res, await svc.detail(req.user, parseId(req.params.id)))));
router.put('/:id/prerequisites', requirePermission('courses.manage'), asyncHandler(async (req, res) => ok(res, await svc.setPrerequisites(req.user, parseId(req.params.id), req.body?.prerequisiteIds, ctx(req)))));

module.exports = router;
