'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/attendanceService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

// Access to a section or session (its own teacher, attendance.manage, attendance.view) is decided inside the service.
router.get('/sections/:sectionId/sessions', asyncHandler(async (req, res) => ok(res, await svc.listSessions(req.user, parseId(req.params.sectionId)))));
router.post('/sections/:sectionId/sessions', asyncHandler(async (req, res) => ok(res, await svc.createSession(req.user, parseId(req.params.sectionId), req.body, ctx(req)), 201)));
router.get('/sections/:sectionId/summary', asyncHandler(async (req, res) => ok(res, await svc.sectionSummary(req.user, parseId(req.params.sectionId)))));
router.get('/sessions/:id', asyncHandler(async (req, res) => ok(res, await svc.getSession(req.user, parseId(req.params.id)))));
router.put('/sessions/:id/records', asyncHandler(async (req, res) => ok(res, await svc.markRecords(req.user, parseId(req.params.id), req.body?.records, ctx(req)))));
router.delete('/sessions/:id', asyncHandler(async (req, res) => { await svc.deleteSession(req.user, parseId(req.params.id), ctx(req)); ok(res, null); }));

// A student's own attendance, and staff looking at a student.
const me = authorize('student');
router.get('/me', me, asyncHandler(async (req, res) => ok(res, await svc.studentSummary(await svc.studentByUser(req.user), req.query.semesterId))));
router.get('/me/sections/:sectionId', me, asyncHandler(async (req, res) => ok(res, await svc.studentDays(await svc.studentByUser(req.user), parseId(req.params.sectionId)))));
const view = requirePermission('attendance.view');
router.get('/students/:studentId', view, asyncHandler(async (req, res) => ok(res, await svc.studentSummary(await svc.studentById(req.user, parseId(req.params.studentId)), req.query.semesterId))));
router.get('/students/:studentId/sections/:sectionId', view, asyncHandler(async (req, res) => ok(res, await svc.studentDays(await svc.studentById(req.user, parseId(req.params.studentId)), parseId(req.params.sectionId)))));

router.get('/report', view, asyncHandler(async (req, res) => ok(res, await svc.report(req.user, req.query))));
router.get('/policy', view, asyncHandler(async (req, res) => ok(res, await svc.getPolicy(req.user, req.query.universityId))));
router.put('/policy', requirePermission('attendance.manage'), asyncHandler(async (req, res) => ok(res, await svc.setPolicy(req.user, req.body, ctx(req)))));

module.exports = router;
