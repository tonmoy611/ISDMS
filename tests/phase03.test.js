'use strict';
// No database needed: validators, the permission middleware with preset permissions, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const v = require('../backend/src/utils/validate');
const requirePermission = require('../backend/src/middleware/requirePermission');
const app = require('../backend/src/app');

test('validators', () => {
  assert.ok(v.isEmail('a@b.co') && !v.isEmail('nope'));
  assert.ok(v.isPhone('+8801712345678') && !v.isPhone('12ab'));
  assert.ok(v.isLoginId('t.rahman') && !v.isLoginId('a b'));
  assert.strictEqual(v.escapeLike('50%_x'), '50\\%\\_x');
  assert.deepStrictEqual(v.parsePage({ page: '3', pageSize: '500' }), { page: 3, pageSize: 100, offset: 200 });
});

const run = (perms, ...codes) => new Promise((resolve) => {
  requirePermission(...codes)({ user: { id: 1, role: 'staff' }, permissions: perms }, {}, (err) => resolve(err || null));
});
test('requirePermission allows holders, super admin wildcard, and blocks others', async () => {
  assert.strictEqual(await run(['users.view'], 'users.view'), null);
  assert.strictEqual(await run(['*'], 'users.create'), null);
  assert.strictEqual((await run(['users.view'], 'users.create')).status, 403);
  assert.strictEqual((await run(['users.view'], 'users.view', 'users.create')).status, 403);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('user and permission endpoints require a session', async () => {
  for (const p of ['/users', '/users/1', '/permissions', '/permissions/users/1']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  }
  const res = await fetch(`${base}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(res.status, 401);
});
