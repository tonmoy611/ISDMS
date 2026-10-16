'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const svc = require('../../services/financeService');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.use(authenticate());

const view = requirePermission('finance.view');
const manage = requirePermission('finance.manage');
const collect = requirePermission('finance.collect');

// A student's own fees.
const me = authorize('student');
router.get('/me', me, asyncHandler(async (req, res) => ok(res, await svc.myFinance(await svc.studentByUser(req.user)))));

// Setup.
router.get('/settings', view, asyncHandler(async (req, res) => ok(res, await svc.getSettings(req.user, req.query.universityId))));
router.put('/settings', manage, asyncHandler(async (req, res) => ok(res, await svc.saveSettings(req.user, req.body, ctx(req)))));
router.get('/fee-heads', view, asyncHandler(async (req, res) => ok(res, { heads: await svc.listHeads(req.user, req.query.universityId) })));
router.post('/fee-heads', manage, asyncHandler(async (req, res) => ok(res, { head: await svc.createHead(req.user, req.body, ctx(req)) }, 201)));
router.patch('/fee-heads/:id', manage, asyncHandler(async (req, res) => ok(res, { head: await svc.updateHead(req.user, parseId(req.params.id), req.body, ctx(req)) })));
router.get('/fee-schedule', view, asyncHandler(async (req, res) => ok(res, await svc.getSchedule(req.user, req.query))));
router.put('/fee-schedule', manage, asyncHandler(async (req, res) => ok(res, await svc.setSchedule(req.user, req.body, ctx(req)))));

// Per student.
router.get('/students/:studentId', view, asyncHandler(async (req, res) => {
  const student = await svc.studentById(req.user, parseId(req.params.studentId));
  ok(res, { ...(await svc.myFinance(student)), concessions: await svc.listConcessions(student) });
}));
router.post('/students/:studentId/invoices', manage, asyncHandler(async (req, res) => ok(res, await svc.generateForStudent(req.user, await svc.studentById(req.user, parseId(req.params.studentId)), req.body, ctx(req)), 201)));
router.post('/students/:studentId/concessions', manage, asyncHandler(async (req, res) => ok(res, { concessions: await svc.addConcession(req.user, await svc.studentById(req.user, parseId(req.params.studentId)), req.body, ctx(req)) }, 201)));
router.post('/students/:studentId/concessions/:id/revoke', manage, asyncHandler(async (req, res) => ok(res, { concessions: await svc.revokeConcession(req.user, await svc.studentById(req.user, parseId(req.params.studentId)), parseId(req.params.id), ctx(req)) })));

// Invoices.
router.get('/summary', view, asyncHandler(async (req, res) => ok(res, await svc.summary(req.user, req.query))));
router.get('/invoices', view, asyncHandler(async (req, res) => ok(res, await svc.listInvoices(req.user, req.query))));
router.post('/invoices/generate-semester', manage, asyncHandler(async (req, res) => ok(res, await svc.bulkGenerate(req.user, req.body, ctx(req)))));
router.post('/late-fees/assess', manage, asyncHandler(async (req, res) => ok(res, await svc.assessLateFees(req.user, req.body, ctx(req)))));
router.get('/invoices/:id', asyncHandler(async (req, res) => ok(res, await svc.getInvoice(req.user, parseId(req.params.id))))); // owner student or finance.view, decided in the service
router.post('/invoices/:id/recalculate', manage, asyncHandler(async (req, res) => ok(res, await svc.recalculate(req.user, parseId(req.params.id), ctx(req)))));
router.post('/invoices/:id/adjustments', manage, asyncHandler(async (req, res) => ok(res, await svc.addAdjustment(req.user, parseId(req.params.id), req.body, ctx(req)))));
router.put('/invoices/:id/installments', manage, asyncHandler(async (req, res) => ok(res, await svc.setInstallments(req.user, parseId(req.params.id), req.body, ctx(req)))));
router.post('/invoices/:id/cancel', manage, asyncHandler(async (req, res) => ok(res, await svc.cancelInvoice(req.user, parseId(req.params.id), req.body?.reason, ctx(req)))));

// Payments received at the cashier or bank. Gateway payments arrive in the next phase.
router.post('/invoices/:id/payments', collect, asyncHandler(async (req, res) => ok(res, await svc.recordPayment(req.user, parseId(req.params.id), req.body, ctx(req)), 201)));
router.get('/payments', view, asyncHandler(async (req, res) => ok(res, await svc.listPayments(req.user, req.query))));

module.exports = router;
