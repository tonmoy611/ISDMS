'use strict';
// No database needed: grading maths and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const r = require('../backend/src/services/resultRules');
const app = require('../backend/src/app');

const scale = r.UGC_DEFAULT_SCALE;
test('the default scale is valid', () => assert.deepStrictEqual(r.scaleProblems(scale), []));
test('scale validation catches the usual mistakes', () => {
  assert.ok(r.scaleProblems([{ letter: 'A', minPercent: 50, gradePoint: 4 }, { letter: 'F', minPercent: 10, gradePoint: 0 }]).some((p) => p.includes('0%')));
  assert.ok(r.scaleProblems([{ letter: 'A', minPercent: 50, gradePoint: 4 }, { letter: 'a', minPercent: 0, gradePoint: 0 }, { letter: 'B', minPercent: 60, gradePoint: 5 }]).length > 0);
  assert.ok(r.scaleProblems([{ letter: 'A', minPercent: 0, gradePoint: 4 }, { letter: 'B', minPercent: 60, gradePoint: 0 }]).some((p) => p.includes('more grade points')));
  assert.ok(r.scaleProblems([{ letter: 'A', minPercent: 0, gradePoint: 4 }]).length > 0);
});
test('grade boundaries: the minimum itself earns the grade', () => {
  assert.strictEqual(r.gradeFor(80, scale).letter, 'A+');
  assert.strictEqual(r.gradeFor(79.99, scale).letter, 'A');
  assert.strictEqual(r.gradeFor(79.994, scale).letter, 'A');
  assert.strictEqual(r.gradeFor(79.995, scale).letter, 'A+'); // rounds to 80.00 first
  assert.strictEqual(r.gradeFor(40, scale).letter, 'D');
  assert.deepStrictEqual([r.gradeFor(39.99, scale).letter, r.gradeFor(39.99, scale).isPass], ['F', false]);
  assert.strictEqual(r.gradeFor(0, scale).letter, 'F');
  assert.strictEqual(r.gradeFor(100, scale).gradePoint, 4);
});
const comps = [{ id: 1, maxMarks: 20 }, { id: 2, maxMarks: 30 }, { id: 3, maxMarks: 50 }];
test('totals and completeness', () => {
  const t = r.computeTotals(comps, { 1: 15, 2: 24.5, 3: 41 });
  assert.deepStrictEqual([t.complete, t.total, t.max, t.percentage], [true, 80.5, 100, 80.5]);
  assert.strictEqual(r.computeTotals(comps, { 1: 15, 2: 24 }).complete, false);
  assert.strictEqual(r.computeTotals(comps, new Map([[1, 0], [2, 0], [3, 0]])).complete, true); // zero is a real mark
  assert.strictEqual(r.computeTotals([{ id: 1, maxMarks: 40 }], { 1: 30 }).percentage, 75); // totals need not be 100
  assert.strictEqual(r.computeTotals([], {}).complete, false);
});
test('mark parsing', () => {
  assert.strictEqual(r.parseMark('12.5', 20).value, 12.5);
  assert.strictEqual(r.parseMark('', 20).value, null);
  assert.ok(r.parseMark('21', 20).error);
  assert.ok(r.parseMark('-1', 20).error);
  assert.ok(r.parseMark('1.234', 20).error);
  assert.ok(r.parseMark('abc', 20).error);
  assert.strictEqual(r.parseMark('20', 20).value, 20);
});
test('semester GPA is credit weighted', () => {
  assert.strictEqual(r.semesterGpa([{ credit: 3, gradePoint: 4 }, { credit: 1.5, gradePoint: 3 }]), 3.67);
  assert.strictEqual(r.semesterGpa([{ credit: 3, gradePoint: 0 }]), 0);
  assert.strictEqual(r.semesterGpa([]), null);
});
test('CGPA: a retaken course counts once, by its latest attempt', () => {
  const rows = [
    { courseId: 1, credit: 3, gradePoint: 0, isPass: false, order: 1 },
    { courseId: 2, credit: 3, gradePoint: 4, isPass: true, order: 1 },
    { courseId: 1, credit: 3, gradePoint: 3, isPass: true, order: 2 },
  ];
  const c = r.cgpa(rows);
  assert.deepStrictEqual([c.cgpa, c.creditsAttempted, c.creditsEarned], [3.5, 6, 6]);
  const failedOnly = r.cgpa([{ courseId: 1, credit: 3, gradePoint: 0, isPass: false, order: 1 }]);
  assert.deepStrictEqual([failedOnly.cgpa, failedOnly.creditsEarned], [0, 0]);
});
test('student summary groups by semester in order', () => {
  const row = (courseId, sem, order, credit, gp, pass = true) => ({ courseId, semesterId: sem, semesterName: `S${sem}`, semesterOrder: order, credit, gradePoint: gp, isPass: pass });
  const s = r.summarizeStudent([row(2, 20, 2, 3, 3.5), row(1, 10, 1, 3, 4), row(3, 10, 1, 3, 3)]);
  assert.deepStrictEqual(s.semesters.map((x) => [x.name, x.gpa, x.credits]), [['S10', 3.5, 6], ['S20', 3.5, 3]]);
  assert.strictEqual(s.cgpa, 3.5);
  assert.strictEqual(s.creditsEarned, 9);
});

let server; let base;
test.before(async () => { await new Promise((res) => { server = app.listen(0, res); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('result endpoints require a session', async () => {
  for (const p of ['/results/sections', '/results/sections/1/sheet', '/results/me', '/results/grade-scale', '/results/corrections', '/results/students/1']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
});
