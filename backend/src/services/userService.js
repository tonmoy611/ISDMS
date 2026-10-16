'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const pw = require('../utils/password');
const v = require('../utils/validate');
const { writeAudit } = require('./audit');
const comm = require('./communication');

const BASE = `SELECT u.id, u.university_id, u.login_id, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at, r.code AS role
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL`;

const dto = (u) => ({
  id: u.id, universityId: u.university_id, loginId: u.login_id, fullName: u.full_name, email: u.email,
  phone: u.phone, role: u.role, status: u.status, lastLoginAt: u.last_login_at, createdAt: u.created_at,
});

/** Tenant + visibility rules: a university-scoped actor sees only that university; only Super Admin sees Super Admins. */
function scope(actor, params) {
  let sql = '';
  if (actor.university_id == null && actor.role !== 'super_admin') sql += ' AND 1 = 0'; // no university, no data
  if (actor.university_id != null) { sql += ' AND u.university_id = ?'; params.push(actor.university_id); }
  if (actor.role !== 'super_admin') sql += " AND r.code <> 'super_admin'";
  return sql;
}

async function list(actor, query) {
  const { page, pageSize, offset } = v.parsePage(query);
  const params = [];
  let where = scope(actor, params);
  if (query.role) { where += ' AND r.code = ?'; params.push(String(query.role)); }
  if (query.status) { where += ' AND u.status = ?'; params.push(String(query.status)); }
  if (query.q) {
    const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`;
    where += ' AND (u.login_id LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
    params.push(like, like, like, like);
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL${where}`, params);
  const [rows] = await pool.query(`${BASE}${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map(dto), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function getVisible(actor, id, conn = pool) {
  const params = [id];
  const [rows] = await conn.query(`${BASE} AND u.id = ?${scope(actor, params)}`, params);
  if (!rows[0]) throw AppError.notFound('User not found');
  return rows[0];
}

const get = async (actor, id) => dto(await getVisible(actor, id));

function dupError(err) {
  if (err.code !== 'ER_DUP_ENTRY') return err;
  const field = /uq_users_login_id/.test(err.message) ? 'loginId' : /uq_users_email/.test(err.message) ? 'email' : /uq_users_phone/.test(err.message) ? 'phone' : null;
  const label = { loginId: 'login ID', email: 'email', phone: 'phone number' }[field] || 'value';
  return AppError.conflict(`That ${label} is already used by another account.`, field ? { [field]: `Already in use.` } : undefined);
}

async function create(actor, body, ctx) {
  const b = body || {};
  const errors = {};
  const allowed = actor.role === 'super_admin' && actor.university_id == null ? ['teacher', 'staff', 'super_admin'] : ['teacher', 'staff'];
  if (!v.isLoginId(b.loginId)) errors.loginId = 'Use 3-50 letters, numbers, dots, dashes or underscores.';
  if (!v.isName(b.fullName)) errors.fullName = 'Enter the full name.';
  if (!v.isEmail(b.email)) errors.email = 'Enter a valid email address.';
  if (b.phone && !v.isPhone(b.phone)) errors.phone = 'Enter digits only, with an optional leading +.';
  if (!allowed.includes(b.role)) errors.role = 'Choose a valid role.';
  const problems = pw.policyProblems(b.temporaryPassword, { loginId: b.loginId, email: b.email });
  if (problems.length) errors.temporaryPassword = problems;
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  let universityId = actor.university_id ?? null;
  if (universityId == null) {
    const given = b.universityId != null && b.universityId !== '';
    if (!given && b.role !== 'super_admin') throw AppError.validation('Choose a university.', { universityId: 'Teacher and staff accounts must belong to a university.' });
    if (given) {
      const [u] = await pool.query("SELECT id FROM universities WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [Number(b.universityId)]);
      if (!u[0]) throw AppError.validation('University not found.', { universityId: 'University not found or inactive.' });
      universityId = u[0].id;
    }
  }

  const hash = await pw.hash(b.temporaryPassword);
  let id;
  try {
    const [res] = await pool.query(
      `INSERT INTO users (university_id, role_id, login_id, full_name, email, phone, password_hash, status, must_change_password)
       VALUES (?, (SELECT id FROM roles WHERE code = ?), ?, ?, ?, ?, ?, 'active', 1)`,
      [universityId, b.role, b.loginId, b.fullName.trim(), b.email, b.phone || null, hash]);
    id = res.insertId;
  } catch (err) { throw dupError(err); }

  await writeAudit({ ctx, userId: actor.id, universityId, action: 'user_created', targetType: 'user', targetId: id, newValue: { loginId: b.loginId, role: b.role, email: b.email } });
  comm.notify.accountCreated({ id, fullName: b.fullName.trim(), loginId: b.loginId, email: b.email, universityId });
  return get(actor, id);
}

async function update(actor, id, body, ctx) {
  const target = await getVisible(actor, id);
  const b = body || {};
  const errors = {};
  const next = { full_name: target.full_name, email: target.email, phone: target.phone };
  if ('fullName' in b) { if (!v.isName(b.fullName)) errors.fullName = 'Enter the full name.'; else next.full_name = b.fullName.trim(); }
  if ('email' in b) { if (!v.isEmail(b.email)) errors.email = 'Enter a valid email address.'; else next.email = b.email; }
  if ('phone' in b) { if (b.phone && !v.isPhone(b.phone)) errors.phone = 'Enter digits only, with an optional leading +.'; else next.phone = b.phone || null; }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  try {
    await pool.query('UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?', [next.full_name, next.email, next.phone, id]);
  } catch (err) { throw dupError(err); }
  await writeAudit({
    ctx, userId: actor.id, universityId: target.university_id, action: 'user_updated', targetType: 'user', targetId: id,
    oldValue: { fullName: target.full_name, email: target.email, phone: target.phone },
    newValue: { fullName: next.full_name, email: next.email, phone: next.phone },
  });
  return get(actor, id);
}

async function setStatus(actor, id, status, ctx) {
  if (!['active', 'blocked', 'inactive'].includes(status)) throw AppError.validation('Choose a valid status.', { status: 'Choose active, blocked or inactive.' });
  if (id === actor.id) throw AppError.badRequest('You cannot change the status of your own account.');

  const oldStatus = await withTransaction(async (conn) => {
    const target = await getVisible(actor, id, conn);
    if (target.status === status) throw AppError.conflict(`The account is already ${status}.`);
    if (target.status === 'pending_verification' && status === 'active') {
      throw AppError.conflict('This account has not completed first-time verification, so it cannot be activated manually.');
    }
    if (target.role === 'super_admin' && status !== 'active') {
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'super_admin' AND u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ? FOR UPDATE`, [id]);
      if (n < 1) throw AppError.conflict('At least one active Super Admin must remain.');
    }
    await conn.query(
      'UPDATE users SET status = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [status, id]);
    if (status !== 'active') await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    return { old: target.status, universityId: target.university_id };
  });
  await writeAudit({ ctx, userId: actor.id, universityId: oldStatus.universityId, action: 'user_status_changed', targetType: 'user', targetId: id, oldValue: { status: oldStatus.old }, newValue: { status } });
  return get(actor, id);
}

async function resetPassword(actor, id, temporaryPassword, ctx) {
  const target = await getVisible(actor, id);
  const problems = pw.policyProblems(temporaryPassword, { loginId: target.login_id, email: target.email });
  if (problems.length) throw AppError.validation('Temporary password does not meet the requirements.', { temporaryPassword: problems });
  const hash = await pw.hash(temporaryPassword);
  await withTransaction(async (conn) => {
    await conn.query(
      'UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_attempts = 0, locked_until = NULL, password_changed_at = NOW() WHERE id = ?', [hash, id]);
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: target.university_id, action: 'password_reset_by_admin', targetType: 'user', targetId: id });
  comm.notify.passwordChanged({ id, fullName: target.full_name, email: target.email, universityId: target.university_id }, 'reset by an administrator');
}

module.exports = { list, get, create, update, setStatus, resetPassword };
