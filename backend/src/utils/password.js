'use strict';
const bcrypt = require('bcryptjs');
const env = require('../config/env');

const hash = (plain) => bcrypt.hash(plain, env.auth.bcryptCost);
const compare = (plain, hashed) => bcrypt.compare(plain, hashed);

// Compared against when the account does not exist, so response time does not reveal valid IDs.
let dummy;
const dummyHash = () => (dummy = dummy || bcrypt.hashSync('not-a-real-password', env.auth.bcryptCost));

const COMMON = new Set(['password123', 'password1234', 'qwerty12345', '1234567890', 'admin12345', 'welcome123']);

/** Returns a list of problems; an empty list means the password is acceptable. */
function policyProblems(pw, { loginId, email } = {}) {
  const p = [];
  if (typeof pw !== 'string') return ['Password is required.'];
  if (pw.length < 10) p.push('Use at least 10 characters.');
  if (Buffer.byteLength(pw, 'utf8') > 72) p.push('Use at most 72 characters.');
  if (!/[a-z]/.test(pw)) p.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(pw)) p.push('Add an uppercase letter.');
  if (!/\d/.test(pw)) p.push('Add a number.');
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) p.push('Choose a less common password.');
  if ((loginId && lower === String(loginId).toLowerCase()) || (email && lower === String(email).toLowerCase())) {
    p.push('Password must differ from your login ID and email.');
  }
  return p;
}

module.exports = { hash, compare, dummyHash, policyProblems };
