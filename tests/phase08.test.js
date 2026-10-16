'use strict';
// No database needed: pure timetable rules, resource config, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const sched = require('../backend/src/services/scheduling');
const RESOURCES = require('../backend/src/services/structureConfig');
const app = require('../backend/src/app');

const S = (day, start, end, roomId = null) => ({ dayOfWeek: day, startTime: start, endTime: end, roomId });

test('overlap: touching slots do not clash, overlapping ones do, other days never', () => {
  assert.strictEqual(sched.overlaps(S(1, '09:00', '10:30'), S(1, '10:30', '12:00')), false);
  assert.strictEqual(sched.overlaps(S(1, '09:00', '10:30'), S(1, '10:00', '11:00')), true);
  assert.strictEqual(sched.overlaps(S(1, '09:00', '10:30'), S(2, '09:00', '10:30')), false);
  assert.strictEqual(sched.overlaps(S(1, '09:00:00', '10:00:00'), S(1, '09:30', '09:45')), true);
});
test('slot validation', () => {
  assert.strictEqual(sched.slotProblem(S(1, '09:00', '10:00')), null);
  assert.ok(sched.slotProblem(S(0, '09:00', '10:00')));
  assert.ok(sched.slotProblem(S(8, '09:00', '10:00')));
  assert.ok(sched.slotProblem(S(1, '10:00', '09:00')));
  assert.ok(sched.slotProblem(S(1, '9am', '10:00')));
  assert.ok(sched.slotProblem(S(1, '09:00', '24:00')));
});
test('a section cannot overlap itself', () => {
  assert.strictEqual(sched.selfOverlaps([S(1, '09:00', '10:00'), S(1, '10:00', '11:00')]).length, 0);
  assert.strictEqual(sched.selfOverlaps([S(1, '09:00', '10:30'), S(1, '10:00', '11:00')]).length, 1);
});
test('room and teacher clashes against other sections', () => {
  const existing = [{ ...S(1, '09:00', '10:30', 5), teacherId: 7, label: 'CSE101 section A' }, { ...S(2, '09:00', '10:30', 6), teacherId: 8, label: 'MAT101 section B' }];
  const room = sched.findConflicts([S(1, '10:00', '11:00', 5)], existing, 99);
  assert.deepStrictEqual(room.map((c) => c.type), ['room']);
  assert.ok(room[0].message.includes('CSE101'));
  const teacher = sched.findConflicts([S(2, '10:00', '11:00', 9)], existing, 8);
  assert.deepStrictEqual(teacher.map((c) => c.type), ['teacher']);
  assert.strictEqual(sched.findConflicts([S(3, '10:00', '11:00', 5)], existing, 7).length, 0);
  assert.strictEqual(sched.findConflicts([S(1, '10:00', '11:00', 5)], existing, 7, { checkRooms: false }).map((c) => c.type).join(), 'teacher');
  assert.strictEqual(sched.findConflicts([S(1, '10:00', '11:00', null)], existing, null).length, 0);
});
test('rooms and calendar resources have their own permissions; one-day events are allowed', () => {
  assert.strictEqual(RESOURCES.rooms.perm.manage, 'sections.manage');
  assert.strictEqual(RESOURCES['calendar-events'].perm.view, 'calendar.view');
  const rule = RESOURCES['calendar-events'].rules[0];
  assert.strictEqual(rule({ start_date: '2026-02-21', end_date: '2026-02-21' }), null);
  assert.ok(rule({ start_date: '2026-02-21', end_date: '2026-02-20' }));
  const semester = RESOURCES['calendar-events'].fields.find((f) => f.key === 'semesterId');
  assert.strictEqual(semester.required, false);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('section endpoints require a session', async () => {
  for (const p of ['/sections', '/sections/1', '/sections/teachers', '/sections/timetable', '/sections/teaching', '/structure/rooms', '/structure/calendar-events']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
});
