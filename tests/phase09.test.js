'use strict';
// No database needed: registration-date rules, timetable clashes, config, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const rules = require('../backend/src/services/enrollmentRules');
const RESOURCES = require('../backend/src/services/structureConfig');
const app = require('../backend/src/app');

const sem = (a, b, c) => ({ registration_start: a, registration_end: b, add_drop_end: c });

test('registration window states', () => {
  const s = sem('2026-01-10', '2026-01-20', '2026-01-27');
  assert.strictEqual(rules.windowState(s, '2026-01-09').state, 'not_open');
  assert.strictEqual(rules.windowState(s, '2026-01-10').state, 'open');
  assert.strictEqual(rules.windowState(s, '2026-01-20').state, 'open');
  const ad = rules.windowState(s, '2026-01-21');
  assert.deepStrictEqual([ad.state, ad.canRegister, ad.canAddDrop], ['add_drop', false, true]);
  assert.strictEqual(rules.windowState(s, '2026-01-27').state, 'add_drop');
  const closed = rules.windowState(s, '2026-01-28');
  assert.deepStrictEqual([closed.state, closed.canRegister, closed.canAddDrop], ['closed', false, false]);
});
test('without add/drop date it ends with registration; unset dates mean closed', () => {
  assert.strictEqual(rules.windowState(sem('2026-01-10', '2026-01-20', null), '2026-01-21').state, 'closed');
  const nc = rules.windowState(sem(null, null, null), '2026-01-15');
  assert.deepStrictEqual([nc.state, nc.canRegister], ['not_configured', false]);
});
test('today is computed in the university time zone', () => {
  const t = new Date('2026-03-01T20:30:00Z'); // already 2 March in Dhaka (UTC+6)
  assert.strictEqual(rules.todayIn('Asia/Dhaka', t), '2026-03-02');
  assert.strictEqual(rules.todayIn('UTC', t), '2026-03-01');
});
const item = (id, label, slots) => ({ sectionId: id, label, slots });
const S = (d, a, b) => ({ dayOfWeek: d, startTime: a, endTime: b });
test('timetable clashes with held sections and within the new selection, reported once per pair', () => {
  const held = [item(1, 'MAT101 section A', [S(1, '09:00', '10:30')])];
  const adding = [item(2, 'CSE101 section A', [S(1, '10:00', '11:30')]), item(3, 'PHY101 section B', [S(1, '11:00', '12:00')]), item(4, 'ENG101 section A', [S(2, '09:00', '10:00')])];
  const c = rules.timetableClashes(adding, held);
  assert.strictEqual(c.length, 2);
  assert.ok(c[0].message.includes('CSE101') && c[0].message.includes('MAT101'));
  assert.ok(c.some((x) => x.sectionId === 2 && x.message.includes('PHY101')));
  assert.strictEqual(rules.timetableClashes([item(5, 'X', [S(3, '09:00', '10:00')])], held).length, 0);
  assert.strictEqual(rules.timetableClashes([item(6, 'Y', [])], held).length, 0);
});
test('semester registration dates must be consistent', () => {
  const rule = RESOURCES.semesters.rules.find((r) => r.name === 'registrationRule');
  assert.strictEqual(rule({ registration_start: '2026-01-10', registration_end: '2026-01-20', add_drop_end: '2026-01-27' }), null);
  assert.ok(rule({ registration_start: '2026-01-10', registration_end: '2026-01-05' }).registrationEnd);
  assert.ok(rule({ registration_start: '2026-01-10', registration_end: '2026-01-20', add_drop_end: '2026-01-15' }).addDropEnd);
  assert.ok(rule({ registration_end: '2026-01-20' }).registrationStart);
  assert.strictEqual(rule({}), null);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('enrollment endpoints require a session', async () => {
  for (const p of ['/enrollment/me/overview', '/enrollment/me/history', '/enrollment/registrations', '/enrollment/sections/1/roster', '/enrollment/students/1/overview', '/enrollment/students/1/prior-credits']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
  const res = await fetch(`${base}/enrollment/me/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(res.status, 401);
});
