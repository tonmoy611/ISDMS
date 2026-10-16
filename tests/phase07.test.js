'use strict';
// No database needed: the pure course rules, the configuration, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const elig = require('../backend/src/services/eligibility');
const RESOURCES = require('../backend/src/services/structureConfig');
const app = require('../backend/src/app');

const C = (id, code, credit = 3, status = 'active') => [id, { id, code, credit, status }];
const courses = new Map([C(1, 'MAT101'), C(2, 'MAT102'), C(3, 'CSE201'), C(4, 'CSE301', 1.5), C(5, 'OLD1', 3, 'inactive')]);
const prereq = new Map([[2, [1]], [3, [1, 2]]]);

test('cycle detection', () => {
  const edges = [[2, 1], [3, 2]]; // 2 needs 1, 3 needs 2
  assert.strictEqual(elig.wouldCreateCycle(edges, 1, [3]), true);   // 1 needs 3 -> 3 needs 2 needs 1
  assert.strictEqual(elig.wouldCreateCycle(edges, 1, [2]), true);
  assert.strictEqual(elig.wouldCreateCycle(edges, 4, [3]), false);
  assert.strictEqual(elig.wouldCreateCycle(edges, 3, [1]), false);  // replacing 3's old prerequisites is fine
  assert.strictEqual(elig.wouldCreateCycle([], 1, [1]), true);
});
test('missing prerequisites are reported by code', () => {
  const r = elig.evaluate({ courses, selectedIds: [3], prereqMap: prereq, completed: new Set([1]) });
  assert.ok(!r.ok);
  const e = r.errors.find((x) => x.code === 'PREREQUISITE_MISSING');
  assert.deepStrictEqual(e.missing, [2]);
  assert.ok(e.message.includes('MAT102'));
});
test('a prerequisite selected in the same registration does not count as completed', () => {
  const r = elig.evaluate({ courses, selectedIds: [1, 2], prereqMap: prereq });
  assert.ok(r.errors.some((x) => x.code === 'PREREQUISITE_MISSING' && x.courseId === 2));
});
test('completed prerequisites pass; credit total is computed with decimals', () => {
  const r = elig.evaluate({ courses, selectedIds: [3, 4], prereqMap: prereq, completed: new Set([1, 2]), rule: { min: 3, max: 9 }, alreadyRegisteredCredits: 3 });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.totalCredits, 7.5);
});
test('credit limits are enforced on both sides and per-rule', () => {
  assert.ok(elig.evaluate({ courses, selectedIds: [1, 4], prereqMap: new Map(), rule: { min: 3, max: 4 } }).errors.some((e) => e.code === 'CREDIT_ABOVE_MAX'));
  assert.ok(elig.evaluate({ courses, selectedIds: [4], prereqMap: new Map(), rule: { min: 3, max: 9 } }).errors.some((e) => e.code === 'CREDIT_BELOW_MIN'));
  assert.ok(elig.evaluate({ courses, selectedIds: [4], prereqMap: new Map(), rule: { min: 3, max: 9 }, checkMinimum: false }).ok);
  assert.ok(elig.evaluate({ courses, selectedIds: [1, 4], prereqMap: new Map(), rule: null }).ok);
});
test('inactive, duplicate, unknown, completed, not-in-curriculum and empty selections are rejected', () => {
  const codes = (sel, extra = {}) => elig.evaluate({ courses, selectedIds: sel, prereqMap: new Map(), ...extra }).errors.map((e) => e.code);
  assert.ok(codes([5]).includes('COURSE_INACTIVE'));
  assert.ok(codes([1, 1]).includes('DUPLICATE_SELECTION'));
  assert.ok(codes([99]).includes('UNKNOWN_COURSE'));
  assert.ok(codes([1], { completed: new Set([1]) }).includes('ALREADY_COMPLETED'));
  assert.ok(codes([1], { curriculum: new Set([2]) }).includes('NOT_IN_CURRICULUM'));
  assert.ok(codes([]).includes('EMPTY_SELECTION'));
});
test('course resource config: own permissions, decimal credit, enum filters', () => {
  const c = RESOURCES.courses;
  assert.deepStrictEqual(c.perm, { view: 'courses.view', manage: 'courses.manage' });
  const credit = c.fields.find((f) => f.key === 'credit');
  assert.strictEqual(credit.type, 'decimal');
  assert.ok(c.fields.some((f) => f.key === 'courseType' && f.type === 'enum'));
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('course endpoints require a session', async () => {
  for (const p of ['/courses/1', '/courses/my', '/courses/credit-rules', '/courses/curriculum/1', '/structure/courses']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
  const res = await fetch(`${base}/courses/validate-selection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(res.status, 401);
});
