'use strict';
// One-time bootstrap. Reads SEED_ADMIN_* from the environment, so no credential lives in the code.
// The account must change its password at first login. Remove SEED_ADMIN_PASSWORD from .env afterwards.
const { pool } = require('../backend/src/config/db');
const pw = require('../backend/src/utils/password');

(async () => {
  const { SEED_ADMIN_LOGIN_ID: loginId, SEED_ADMIN_NAME: name, SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
  if (!loginId || !name || !email || !password) throw new Error('Set SEED_ADMIN_LOGIN_ID, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD first.');
  const problems = pw.policyProblems(password, { loginId, email });
  if (problems.length) throw new Error(`Password rejected: ${problems.join(' ')}`);

  const [existing] = await pool.query('SELECT id FROM users WHERE login_id = ? OR email = ?', [loginId, email]);
  if (existing.length) throw new Error('A user with that login ID or email already exists.');

  const [[role]] = await pool.query("SELECT id FROM roles WHERE code = 'super_admin'");
  await pool.query(
    `INSERT INTO users (university_id, role_id, login_id, full_name, email, password_hash, status, must_change_password)
     VALUES (NULL, ?, ?, ?, ?, ?, 'active', 1)`,
    [role.id, loginId, name, email, await pw.hash(password)]);
  console.log(`Super Admin "${loginId}" created. Sign in and change the password now, then remove SEED_ADMIN_PASSWORD from .env.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
