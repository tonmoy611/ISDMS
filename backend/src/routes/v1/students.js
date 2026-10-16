'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/studentService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

// A student's own record. Declared before /:id so "me" is never read as an id.
router.get('/me', authorize('student'), asyncHandler(async (req, res) => ok(res, { student: await svc.getMe(req.user) })));
router.patch('/me', authorize('student'), asyncHandler(async (req, res) => ok(res, { student: await svc.updateMe(req.user, req.body, ctx(req)) })));

router.get('/', requirePermission('students.view'), asyncHandler(async (req, res) => ok(res, await svc.list(req.user, req.query))));
router.post('/', requirePermission('students.create'), asyncHandler(async (req, res) => ok(res, { student: await svc.create(req.user, req.body, ctx(req)) }, 201)));
router.get('/:id', requirePermission('students.view'), asyncHandler(async (req, res) => ok(res, { student: await svc.get(req.user, parseId(req.params.id)) })));
router.patch('/:id', requirePermission('students.update'), asyncHandler(async (req, res) => ok(res, { student: await svc.update(req.user, parseId(req.params.id), req.body, ctx(req)) })));
router.post('/:id/status', requirePermission('students.status'), asyncHandler(async (req, res) => ok(res, { student: await svc.setStatus(req.user, parseId(req.params.id), req.body?.status, ctx(req)) })));
router.post('/:id/reset-password', requirePermission('students.update'), asyncHandler(async (req, res) => { await svc.resetPassword(req.user, parseId(req.params.id), req.body?.temporaryPassword, ctx(req)); ok(res, null); }));
router.delete('/:id', requirePermission('students.delete'), asyncHandler(async (req, res) => { await svc.remove(req.user, parseId(req.params.id), ctx(req)); ok(res, null); }));

module.exports = router;
