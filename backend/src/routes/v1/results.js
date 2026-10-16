'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/resultService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

// Section-level routes: the section's teacher, or the matching results.* permission. Decided in the service.
router.get('/sections', asyncHandler(async (req, res) => ok(res, await svc.listSections(req.user, req.query))));
router.get('/sections/:id/sheet', asyncHandler(async (req, res) => ok(res, await svc.getSheet(req.user, parseId(req.params.id)))));
router.put('/sections/:id/components', asyncHandler(async (req, res) => ok(res, await svc.setComponents(req.user, parseId(req.params.id), req.body?.components, ctx(req)))));
router.put('/sections/:id/marks', asyncHandler(async (req, res) => ok(res, await svc.saveMarks(req.user, parseId(req.params.id), req.body?.entries, ctx(req)))));
router.post('/sections/:id/submit', asyncHandler(async (req, res) => ok(res, await svc.submit(req.user, parseId(req.params.id), ctx(req)))));
router.post('/sections/:id/reopen', asyncHandler(async (req, res) => ok(res, await svc.reopen(req.user, parseId(req.params.id), ctx(req)))));
router.post('/sections/:id/publish', asyncHandler(async (req, res) => ok(res, await svc.publish(req.user, parseId(req.params.id), ctx(req)))));

router.post('/entries/:resultId/corrections', asyncHandler(async (req, res) => ok(res, await svc.requestCorrection(req.user, parseId(req.params.resultId), req.body, ctx(req)), 201)));
router.get('/entries/:resultId/history', asyncHandler(async (req, res) => ok(res, await svc.history(req.user, parseId(req.params.resultId)))));
router.get('/corrections', requirePermission('results.approve'), asyncHandler(async (req, res) => ok(res, await svc.listCorrections(req.user, req.query))));
router.post('/corrections/:id/approve', requirePermission('results.approve'), asyncHandler(async (req, res) => ok(res, await svc.decide(req.user, parseId(req.params.id), true, req.body?.note, ctx(req)))));
router.post('/corrections/:id/reject', requirePermission('results.approve'), asyncHandler(async (req, res) => ok(res, await svc.decide(req.user, parseId(req.params.id), false, req.body?.note, ctx(req)))));

router.get('/grade-scale', requirePermission('results.view'), asyncHandler(async (req, res) => ok(res, await svc.getScale(req.user, req.query.universityId))));
router.put('/grade-scale', requirePermission('results.manage'), asyncHandler(async (req, res) => ok(res, await svc.setScale(req.user, req.body, ctx(req)))));
router.post('/grade-scale/default', requirePermission('results.manage'), asyncHandler(async (req, res) => ok(res, await svc.useDefaultScale(req.user, req.body, ctx(req)))));

router.get('/me', authorize('student'), asyncHandler(async (req, res) => ok(res, await svc.studentResults(await svc.studentByUser(req.user)))));
router.get('/students/:studentId', requirePermission('results.view'), asyncHandler(async (req, res) => ok(res, await svc.studentResults(await svc.studentById(req.user, parseId(req.params.studentId))))));

module.exports = router;
