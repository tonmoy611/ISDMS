'use strict';
// No database needed: attendance rules and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const r = require('../backend/src/services/attendanceRules');
const app = require('../backend/src/app');

test('percentage: late counts as attended, excused is left out', () => {
  assert.strictEqual(r.summarize({ present: 7, absent: 2, late: 1, excused: 0 }).percentage, 80);
  const s = r.summarize({ present: 6, absent: 2, late: 0, excused: 2 });
  assert.deepStrictEqual([s.total, s.counted, s.attended, s.percentage], [10, 8, 6, 75]);
  assert.strictEqual(r.summarize({ excused: 3 }).percentage, null);
  assert.strictEqual(r.summarize({}).percentage, null);
  assert.strictEqual(r.summarize({ present: '2', absent: '1' }).percentage, 66.7);
});
test('threshold: exactly the minimum is fine, nothing held is never flagged', () => {
  assert.strictEqual(r.belowThreshold(75, 75), false);
  assert.strictEqual(r.belowThreshold(74.9, 75), true);
  assert.strictEqual(r.belowThreshold(null, 75), false);
});
test('class dates: format, future, and semester bounds', () => {
  const sem = { start_date: '2026-01-10', end_date: '2026-05-30' };
  assert.strictEqual(r.sessionDateProblem('2026-02-01', '2026-02-01', sem), null);
  assert.ok(r.sessionDateProblem('2026-02-02', '2026-02-01', sem));
  assert.ok(r.sessionDateProblem('2026-01-09', '2026-02-01', sem));
  assert.ok(r.sessionDateProblem('2026-06-01', '2026-07-01', sem));
  assert.ok(r.sessionDateProblem('2026-02-30', '2026-03-01', sem));
  assert.ok(r.sessionDateProblem('1 Feb', '2026-03-01', sem));
});
test('teacher edit window', () => {
  assert.strictEqual(r.daysBetween('2026-02-01', '2026-02-08'), 7);
  assert.strictEqual(r.editWindowOpen('2026-02-01', '2026-02-08', 7), true);
  assert.strictEqual(r.editWindowOpen('2026-02-01', '2026-02-09', 7), false);
  assert.strictEqual(r.daysBetween('2026-02-28', '2026-03-01'), 1);
});

let server; let base;
test.before(async () => { await new Promise((r2) => { server = app.listen(0, r2); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('attendance endpoints require a session', async () => {
  for (const p of ['/attendance/sections/1/sessions', '/attendance/sessions/1', '/attendance/me', '/attendance/report', '/attendance/policy', '/attendance/students/1']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
  const res = await fetch(`${base}/attendance/sessions/1/records`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(res.status, 401);
});
