'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const permissionService = require('../../services/permissionService');
const { resolveUniversity } = require('../../services/structureService');
const svc = require('../../services/enrollmentService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data) => res.json({ success: true, data });
router.use(authenticate());

/** Same handlers serve a student acting for themselves (/me) and staff acting for a student (/students/:studentId). */
const resolve = (req) => (req.params.studentId ? svc.studentById(req.user, parseId(req.params.studentId)) : svc.studentByUser(req.user));
const mutate = (fn) => asyncHandler(async (req, res) => {
  const student = await resolve(req);
  const acting = !!req.params.studentId;
  const override = acting && req.body?.override === true;
  if (override) {
    const perms = req.permissions || await permissionService.forUser(req.user);
    if (!(perms.includes('*') || perms.includes('enrollment.override'))) throw AppError.forbidden('You may not act outside the registration dates.');
  }
  ok(res, await fn(student, req.body || {}, { actor: req.user, override, ctx: ctx(req) }));
});
const read = (fn) => asyncHandler(async (req, res) => ok(res, await fn(await resolve(req), req)));

// Student, for themselves.
const me = authorize('student');
router.get('/me/overview', me, read((s, req) => svc.overview(s, req.query.semesterId)));
router.get('/me/history', me, read((s) => svc.history(s)));
router.post('/me/register', me, mutate(svc.register));
router.post('/me/add', me, mutate(svc.add));
router.post('/me/drop', me, mutate(svc.drop));
router.post('/me/cancel', me, mutate(svc.cancel));

// Staff, for a student.
const view = requirePermission('enrollment.view');
const manage = requirePermission('enrollment.manage');
router.get('/registrations', view, asyncHandler(async (req, res) => ok(res, await svc.listRegistrations(req.user, req.query, resolveUniversity))));
router.get('/sections/:sectionId/roster', asyncHandler(async (req, res) => ok(res, await svc.roster(req.user, parseId(req.params.sectionId)))));
router.get('/students/:studentId/overview', view, read((s, req) => svc.overview(s, req.query.semesterId)));
router.get('/students/:studentId/history', view, read((s) => svc.history(s)));
router.post('/students/:studentId/register', manage, mutate(svc.register));
router.post('/students/:studentId/add', manage, mutate(svc.add));
router.post('/students/:studentId/drop', manage, mutate(svc.drop));
router.post('/students/:studentId/cancel', manage, mutate(svc.cancel));
router.get('/students/:studentId/prior-credits', view, read((s) => svc.listPriorCredits(s).then((credits) => ({ credits }))));
router.post('/students/:studentId/prior-credits', manage, mutate((s, b, o) => svc.addPriorCredit(s, b, o).then((credits) => ({ credits }))));
router.delete('/students/:studentId/prior-credits/:id', manage, asyncHandler(async (req, res) => {
  const student = await resolve(req);
  ok(res, { credits: await svc.removePriorCredit(student, parseId(req.params.id), { actor: req.user, ctx: ctx(req) }) });
}));

module.exports = router;
