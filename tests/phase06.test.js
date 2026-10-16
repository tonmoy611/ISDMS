'use strict';
// No database or mail server needed: templates, masking, code hashing, token separation and request validation.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const { templates } = require('../backend/src/services/communication/templates');
const { normalizeBdPhone, emailProviders } = require('../backend/src/services/communication/providers');
const comm = require('../backend/src/services/communication');
const verification = require('../backend/src/services/verificationService');
const tokens = require('../backend/src/utils/tokens');
const app = require('../backend/src/app');

test('templates escape HTML and never mention a password in the welcome email', () => {
  const t = templates.accountCreated({ fullName: '<b>Ana</b>', loginId: 'S1', appUrl: 'https://x.edu' });
  assert.ok(!t.html.includes('<b>Ana</b>') && t.html.includes('&lt;b&gt;'));
  assert.ok(/not included/i.test(t.text));
});
test('SMS and email codes include the code and expiry', () => {
  const t = templates.verificationCode({ fullName: 'A', code: '123456', minutes: 10 });
  assert.ok(t.sms.includes('123456') && t.text.includes('123456') && t.sms.includes('10'));
});
test('masking hides most of the address and number', () => {
  assert.strictEqual(comm.maskEmail('student@uni.edu'), 's***@uni.edu');
  const m = comm.maskPhone('+8801712345678');
  assert.ok(m.startsWith('+880') && m.endsWith('78') && m.includes('*'));
});
test('Bangladesh phone normalization', () => {
  assert.strictEqual(normalizeBdPhone('01712345678'), '8801712345678');
  assert.strictEqual(normalizeBdPhone('+8801712345678'), '8801712345678');
});
test('codes are 6 digits, hashed, and bound to user and purpose', () => {
  assert.match(verification.generateCode(), /^\d{6}$/);
  const a = verification.hashCode(1, 'first_login', '123456');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a, verification.hashCode(2, 'first_login', '123456'));
  assert.notStrictEqual(a, verification.hashCode(1, 'password_reset', '123456'));
});
test('a verification token is not accepted as an access token, and the reverse', () => {
  const v = tokens.signVerificationToken(5);
  assert.throws(() => tokens.verifyAccessToken(v));
  assert.strictEqual(tokens.verifyVerificationToken(v).sub, '5');
  assert.throws(() => tokens.verifyVerificationToken(tokens.signAccessToken({ id: 5, role: 'student', university_id: 1 })));
});
test('the log email provider reports logged, never a real delivery', async () => {
  const quiet = console.log; console.log = () => {};
  const r = await emailProviders.log.send({ to: 'a@b.c', subject: 's', text: 't' });
  console.log = quiet;
  assert.strictEqual(r.logged, true);
});

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('verification endpoints reject bad input before touching the database', async () => {
  assert.strictEqual((await post('/auth/verification/send', { verificationToken: 'x', channel: 'email' })).status, 401);
  assert.strictEqual((await post('/auth/verification/send', { verificationToken: 'x', channel: 'fax' })).status, 422);
  assert.strictEqual((await post('/auth/verification/complete', { verificationToken: 'x', code: 'abc', newPassword: 'x' })).status, 422);
  assert.strictEqual((await post('/auth/password/forgot', {})).status, 422);
  assert.strictEqual((await post('/auth/password/reset', { loginId: 'a', code: '12', newPassword: 'x' })).status, 422);
});
