'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
const app = require('../backend/src/app');

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());

test('GET /system/info returns product info', async () => {
  const res = await fetch(`${base}/system/info`);
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.data.developer, 'TD-X Lab');
});

test('unknown route returns sanitized 404', async () => {
  const res = await fetch(`${base}/nope`);
  const body = await res.json();
  assert.strictEqual(res.status, 404);
  assert.strictEqual(body.error.code, 'NOT_FOUND');
  assert.ok(!JSON.stringify(body).includes('stack'));
});

test('invalid JSON returns 400', async () => {
  const res = await fetch(`${base}/system/info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.strictEqual(res.status, 400);
});

test('security headers present', async () => {
  const res = await fetch(`${base}/system/info`);
  assert.ok(res.headers.get('x-content-type-options'));
  assert.strictEqual(res.headers.get('x-powered-by'), null);
});
