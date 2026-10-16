'use strict';
// No database needed: all fee maths and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const f = require('../backend/src/services/feeRules');
const app = require('../backend/src/app');

const head = (headId, name, calcType, amount) => ({ headId, name, calcType, unitCents: f.toCents(amount) });
const schedule = [head(1, 'Tuition (per credit)', 'per_credit', 4500), head(2, 'Semester fee', 'fixed', 3000), head(3, 'Lab fee', 'per_lab_course', 1500), head(4, 'Library', 'per_course', 100)];

test('credit-wise charges: credits x rate, labs and courses counted, zero quantities dropped', () => {
  const lines = f.computeCharges(schedule, { credits: 15, courses: 5, labCourses: 2 });
  assert.deepStrictEqual(lines.map((l) => [l.description, l.quantity, l.amountCents]), [['Tuition (per credit)', 15, 6750000], ['Semester fee', 1, 300000], ['Lab fee', 2, 300000], ['Library', 5, 50000]]);
  const noLab = f.computeCharges(schedule, { credits: 12.5, courses: 4, labCourses: 0 });
  assert.ok(!noLab.some((l) => l.description === 'Lab fee'));
  assert.strictEqual(noLab[0].amountCents, 5625000); // 12.5 credits x 4500
});
test('a program item overrides the default for the same head only', () => {
  const merged = f.resolveSchedule([{ headId: 1, v: 'default' }, { headId: 2, v: 'default' }], [{ headId: 1, v: 'program' }, { headId: 9, v: 'program' }]);
  assert.deepStrictEqual(merged.map((i) => [i.headId, i.v]).sort(), [[1, 'program'], [2, 'default'], [9, 'program']]);
});
test('percent concession on one head; fixed concession on everything; never below zero', () => {
  const charges = f.computeCharges(schedule, { credits: 10, courses: 1, labCourses: 0 }); // 45000 + 3000 + 100 = 48100
  const d = f.applyConcessions(charges, [
    { id: 1, kind: 'scholarship', mode: 'percent', value: 50, feeHeadId: 1, reason: 'Merit' },
    { id: 2, kind: 'waiver', mode: 'fixed', value: 3000, feeHeadId: null, reason: 'Need' },
  ]);
  assert.deepStrictEqual(d.map((x) => x.amountCents), [-2250000, -300000]);
  assert.strictEqual(charges.reduce((a, l) => a + l.amountCents, 0) + d.reduce((a, l) => a + l.amountCents, 0), 4810000 - 2550000);
});
test('concessions are capped by what is left of the charge', () => {
  const charges = f.computeCharges([head(2, 'Semester fee', 'fixed', 3000)], { credits: 0, courses: 0, labCourses: 0 });
  const d = f.applyConcessions(charges, [{ id: 1, kind: 'discount', mode: 'percent', value: 100, feeHeadId: 2, reason: 'a' }, { id: 2, kind: 'waiver', mode: 'fixed', value: 500, feeHeadId: null, reason: 'b' }]);
  assert.deepStrictEqual(d.map((x) => x.amountCents), [-300000]); // second one has nothing left to reduce
  assert.deepStrictEqual(f.applyConcessions(charges, [{ id: 3, kind: 'discount', mode: 'percent', value: 10, feeHeadId: 99, reason: 'x' }]), []);
});
test('cents arithmetic has no floating-point drift', () => {
  assert.strictEqual(f.toCents(0.1 + 0.2), 30);
  assert.strictEqual(f.toCents('19.99'), 1999);
  assert.strictEqual(f.fromCents(1999), 19.99);
});
test('late fee: after the grace period, once, flat or percent, capped', () => {
  const flat = { lateMode: 'flat', lateValue: 500, graceDays: 3, capCents: null };
  assert.strictEqual(f.lateFeeCents(flat, { dueDate: '2026-01-10', today: '2026-01-13', balanceCents: 100000 }), 0);
  assert.strictEqual(f.lateFeeCents(flat, { dueDate: '2026-01-10', today: '2026-01-14', balanceCents: 100000 }), 50000);
  assert.strictEqual(f.lateFeeCents(flat, { dueDate: '2026-01-10', today: '2026-02-14', balanceCents: 100000, alreadyAssessed: true }), 0);
  assert.strictEqual(f.lateFeeCents(flat, { dueDate: '2026-01-10', today: '2026-02-14', balanceCents: 0 }), 0);
  const pct = { lateMode: 'percent', lateValue: 5, graceDays: 0, capCents: 20000 };
  assert.strictEqual(f.lateFeeCents(pct, { dueDate: '2026-01-10', today: '2026-01-11', balanceCents: 100000 }), 5000);
  assert.strictEqual(f.lateFeeCents(pct, { dueDate: '2026-01-10', today: '2026-01-11', balanceCents: 1000000 }), 20000);
  assert.strictEqual(f.lateFeeCents({ lateMode: 'none' }, { dueDate: '2026-01-10', today: '2027-01-01', balanceCents: 9 }), 0);
});
test('invoice state', () => {
  const s = (o) => f.invoiceState({ totalCents: 1000, paidCents: 0, cancelled: false, dueDate: '2026-02-01', today: '2026-01-15', ...o });
  assert.strictEqual(s({}), 'unpaid');
  assert.strictEqual(s({ paidCents: 400 }), 'partial');
  assert.strictEqual(s({ paidCents: 1000 }), 'paid');
  assert.strictEqual(s({ paidCents: 1500 }), 'paid');
  assert.strictEqual(s({ today: '2026-02-02' }), 'overdue');
  assert.strictEqual(s({ today: '2026-02-02', paidCents: 1000 }), 'paid');
  assert.strictEqual(s({ cancelled: true }), 'cancelled');
  assert.strictEqual(s({ totalCents: 0 }), 'paid');
});
test('installments: equal split, leftover on the last, validation, allocation in order', () => {
  const parts = f.splitInstallments(100001, 3, '2026-01-31', 30);
  assert.deepStrictEqual(parts.map((p) => p.amountCents), [33333, 33333, 33335]);
  assert.deepStrictEqual(parts.map((p) => p.dueDate), ['2026-01-31', '2026-03-02', '2026-04-01']);
  assert.deepStrictEqual(f.installmentProblems(parts, 100001), []);
  assert.ok(f.installmentProblems(parts, 100000).length);
  assert.ok(f.installmentProblems([{ dueDate: '2026-01-31', amountCents: 5 }, { dueDate: '2026-01-31', amountCents: 5 }], 10).length);
  assert.ok(f.installmentProblems([{ dueDate: '2026-01-31', amountCents: 10 }], 10).length);
  const alloc = f.allocateInstallments(parts, 40000, '2026-03-05');
  assert.deepStrictEqual(alloc.map((a) => a.status), ['paid', 'partial', 'unpaid']);
  assert.deepStrictEqual(alloc.map((a) => a.overdue), [false, true, false]);
});
test('effective due date follows the first unpaid installment', () => {
  const inst = [{ dueDate: '2026-02-01', amountCents: 500 }, { dueDate: '2026-03-01', amountCents: 500 }];
  assert.strictEqual(f.effectiveDueDate({ invoiceDue: '2026-01-15', installments: inst, paidCents: 0, totalCents: 1000 }), '2026-02-01');
  assert.strictEqual(f.effectiveDueDate({ invoiceDue: '2026-01-15', installments: inst, paidCents: 500, totalCents: 1000 }), '2026-03-01');
  assert.strictEqual(f.effectiveDueDate({ invoiceDue: '2026-01-15', installments: inst, paidCents: 1000, totalCents: 1000 }), null);
  assert.strictEqual(f.effectiveDueDate({ invoiceDue: '2026-01-15', installments: inst, paidCents: 1000, totalCents: 1200 }), '2026-03-01'); // a late fee after the plan is covered
  assert.strictEqual(f.effectiveDueDate({ invoiceDue: '2026-01-15', installments: [], paidCents: 0, totalCents: 1000 }), '2026-01-15');
});

let server; let base;
test.before(async () => { await new Promise((res) => { server = app.listen(0, res); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('finance endpoints require a session', async () => {
  for (const p of ['/finance/me', '/finance/summary', '/finance/invoices', '/finance/invoices/1', '/finance/fee-heads', '/finance/fee-schedule', '/finance/settings']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
});
