'use strict';
// No database needed: profile validation rules and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const { _internal } = require('../backend/src/services/studentService');
const v = require('../backend/src/utils/validate');
const app = require('../backend/src/app');
const { parseProfile, SELF, PROFILE } = _internal;

test('isDate accepts real dates only', () => {
  assert.ok(v.isDate('2026-02-28') && !v.isDate('2026-02-30') && !v.isDate('28/02/2026'));
});
test('create requires admission date; optional fields may be blank', () => {
  const r = parseProfile({ gender: '' }, Object.keys(PROFILE), true);
  assert.ok(r.errors.admissionDate);
  assert.strictEqual(r.values.gender, null);
});
test('profile rejects bad enum, phone and long text', () => {
  const r = parseProfile({ admissionDate: '2026-01-10', gender: 'x', guardianPhone: 'abc', fatherName: 'a'.repeat(200) }, Object.keys(PROFILE), true);
  assert.ok(r.errors.gender && r.errors.guardianPhone && r.errors.fatherName);
});
test('a student may edit only contact fields, never identity or academic fields', () => {
  assert.deepStrictEqual([...SELF].sort(), ['emergencyContactName', 'emergencyContactPhone', 'guardianPhone', 'permanentAddress', 'presentAddress']);
  const r = parseProfile({ presentAddress: 'Dhaka', admissionDate: '2020-01-01', nationalId: '1' }, SELF, false);
  assert.deepStrictEqual(Object.keys(r.values), ['present_address']);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('student endpoints require a session', async () => {
  for (const p of ['/students', '/students/me', '/students/1']) assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
});
