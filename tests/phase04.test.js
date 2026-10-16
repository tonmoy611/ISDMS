'use strict';
// No database needed: config sanity, tenant resolution rules, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const RESOURCES = require('../backend/src/services/structureConfig');
const { resolveUniversity } = require('../backend/src/services/structureService');
const app = require('../backend/src/app');

test('every resource has fields, a table, and ref fields name their label key', () => {
  for (const [name, cfg] of Object.entries(RESOURCES)) {
    assert.ok(cfg.table && cfg.fields.length && cfg.search.length, name);
    cfg.fields.filter((f) => f.type === 'ref').forEach((f) => assert.ok(f.labelKey && f.ref, `${name}.${f.key}`));
  }
});
test('date rule rejects end before start', () => {
  const rule = RESOURCES.semesters.rules[0];
  assert.ok(rule({ start_date: '2026-06-01', end_date: '2026-05-01' }));
  assert.strictEqual(rule({ start_date: '2026-01-01', end_date: '2026-06-01' }), null);
});
test('university resolution: scoped actor pinned, platform admin must choose, others refused', () => {
  assert.strictEqual(resolveUniversity({ role: 'staff', university_id: 3 }, 99, true), 3);
  assert.strictEqual(resolveUniversity({ role: 'super_admin', university_id: null }, '5', true), 5);
  assert.throws(() => resolveUniversity({ role: 'super_admin', university_id: null }, '', true), (e) => e.status === 422);
  assert.throws(() => resolveUniversity({ role: 'staff', university_id: null }, 1, true), (e) => e.status === 403);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('structure and university endpoints require a session', async () => {
  for (const p of ['/universities', '/structure/campuses', '/structure/semesters/1']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
});
