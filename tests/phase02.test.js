'use strict';
// These tests need no database: they cover pure logic and requests rejected before any query runs.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const pw = require('../backend/src/utils/password');
const tokens = require('../backend/src/utils/tokens');
const app = require('../backend/src/app');

test('password policy accepts a strong password', () => {
  assert.deepStrictEqual(pw.policyProblems('Sunrise2026Ok'), []);
});
test('password policy rejects weak and login-matching passwords', () => {
  assert.ok(pw.policyProblems('short1A').length > 0);
  assert.ok(pw.policyProblems('alllowercase123').length > 0);
  assert.ok(pw.policyProblems('Admin12345x', { loginId: 'admin12345x' }).length > 0);
});
test('password hash verifies and is not plaintext', async () => {
  const h = await pw.hash('Sunrise2026Ok');
  assert.notStrictEqual(h, 'Sunrise2026Ok');
  assert.ok(await pw.compare('Sunrise2026Ok', h));
  assert.ok(!(await pw.compare('wrong', h)));
});
test('access token round trip and tamper detection', () => {
  const t = tokens.signAccessToken({ id: 7, role: 'student', university_id: 1 });
  assert.strictEqual(tokens.verifyAccessToken(t).sub, '7');
  assert.throws(() => tokens.verifyAccessToken(`${t}x`));
});
test('refresh tokens are random and hashed to 64 hex chars', () => {
  assert.notStrictEqual(tokens.newRefreshToken(), tokens.newRefreshToken());
  assert.match(tokens.hashToken('abc'), /^[0-9a-f]{64}$/);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('login with empty fields returns 422 with field errors', async () => {
  const res = await post('/auth/login', {});
  const body = await res.json();
  assert.strictEqual(res.status, 422);
  assert.ok(body.error.details.loginId && body.error.details.password);
});
test('/auth/me without a session returns 401', async () => {
  assert.strictEqual((await fetch(`${base}/auth/me`)).status, 401);
});
test('tampered bearer token returns 401', async () => {
  const res = await fetch(`${base}/auth/me`, { headers: { Authorization: 'Bearer not.a.token' } });
  assert.strictEqual(res.status, 401);
});
test('state-changing request from a foreign origin is rejected (CSRF guard)', async () => {
  const res = await post('/auth/login', { loginId: 'a', password: 'b' }, { Origin: 'https://evil.example' });
  assert.strictEqual(res.status, 403);
});
