'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const pw = require('../utils/password');
const v = require('../utils/validate');
const { resolveUniversity } = require('./structureService');
const userService = require('./userService');
const { writeAudit } = require('./audit');
const comm = require('./communication');

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
// Profile fields: API key -> column and rule. Only SELF fields may be edited by the student.
const PROFILE = {
  admissionDate: { col: 'admission_date', type: 'date', required: true },
  dateOfBirth: { col: 'date_of_birth', type: 'date' },
  gender: { col: 'gender', type: 'enum', values: ['male', 'female', 'other'] },
  bloodGroup: { col: 'blood_group', type: 'enum', values: BLOOD },
  nationalId: { col: 'national_id', type: 'string', max: 30 },
  fatherName: { col: 'father_name', type: 'string', max: 150 },
  motherName: { col: 'mother_name', type: 'string', max: 150 },
  guardianPhone: { col: 'guardian_phone', type: 'phone' },
  presentAddress: { col: 'present_address', type: 'string', max: 255 },
  permanentAddress: { col: 'permanent_address', type: 'string', max: 255 },
  emergencyContactName: { col: 'emergency_contact_name', type: 'string', max: 150 },
  emergencyContactPhone: { col: 'emergency_contact_phone', type: 'phone' },
};
const SELF = ['guardianPhone', 'presentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactPhone'];
const SENSITIVE = ['nationalId'];
const PLACEMENT = [
  ['departmentId', 'department_id', 'departments'], ['programId', 'program_id', 'programs'], ['batchId', 'batch_id', 'batches'],
  ['academicYearId', 'academic_year_id', 'academic_years'], ['semesterId', 'semester_id', 'semesters'], ['shiftId', 'shift_id', 'shifts'],
];
const ACADEMIC_STATUS = ['studying', 'graduated', 'withdrawn', 'suspended'];

function parseProfile(body, keys, creating) {
  const values = {}; const errors = {};
  for (const k of keys) {
    const d = PROFILE[k];
    if (!(k in body)) { if (creating && d.required) errors[k] = 'This field is required.'; continue; }
    const s = body[k] == null ? '' : String(body[k]).trim();
    if (!s) { if (d.required) errors[k] = 'This field is required.'; else values[d.col] = null; continue; }
    if (d.type === 'string') { if (s.length > d.max) errors[k] = `Use at most ${d.max} characters.`; else values[d.col] = s; }
    else if (d.type === 'phone') { if (v.isPhone(s)) values[d.col] = s; else errors[k] = 'Enter digits only, with an optional leading +.'; }
    else if (d.type === 'date') { if (v.isDate(s)) values[d.col] = s; else errors[k] = 'Enter a valid date (YYYY-MM-DD).'; }
    else if (d.values.includes(s)) values[d.col] = s; else errors[k] = 'Choose a valid option.';
  }
  return { values, errors };
}

/** Every referenced record must exist in THIS university, be active, and fit together (program in department, etc.). */
async function placementErrors(conn, uni, ids) {
  const errors = {}; const rows = {};
  for (const [key, , table] of PLACEMENT) {
    const id = Number(ids[key]);
    if (!Number.isInteger(id) || id < 1) { errors[key] = 'Choose an option.'; continue; }
    const [r] = await conn.query(`SELECT * FROM ${table} WHERE id = ? AND university_id = ?`, [id, uni]);
    if (!r[0]) errors[key] = 'That option does not exist in this university.';
    else if (r[0].status === 'inactive') errors[key] = 'That option is inactive.';
    else rows[key] = r[0];
  }
  if (rows.programId && rows.departmentId && rows.programId.department_id !== rows.departmentId.id) errors.programId = 'This program does not belong to the chosen department.';
  if (rows.batchId && rows.programId && rows.batchId.program_id !== rows.programId.id) errors.batchId = 'This batch does not belong to the chosen program.';
  if (rows.semesterId && rows.academicYearId && rows.semesterId.academic_year_id !== rows.academicYearId.id) errors.semesterId = 'This semester does not belong to the chosen academic year.';
  return errors;
}

const SEL = `SELECT s.*, u.full_name, u.email, u.phone, u.status AS account_status, u.last_login_at,
  d.name AS department_name, p.name AS program_name, b.name AS batch_name, ay.name AS academic_year_name, sem.name AS semester_name, sh.name AS shift_name
  FROM students s JOIN users u ON u.id = s.user_id
  LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN programs p ON p.id = s.program_id LEFT JOIN batches b ON b.id = s.batch_id
  LEFT JOIN academic_years ay ON ay.id = s.academic_year_id LEFT JOIN semesters sem ON sem.id = s.semester_id LEFT JOIN shifts sh ON sh.id = s.shift_id
  WHERE s.deleted_at IS NULL AND u.deleted_at IS NULL`;

function dto(r, detail) {
  const o = {
    id: r.id, userId: r.user_id, universityId: r.university_id, studentId: r.student_id, fullName: r.full_name, email: r.email, phone: r.phone,
    accountStatus: r.account_status, academicStatus: r.academic_status, lastLoginAt: r.last_login_at, createdAt: r.created_at,
    departmentId: r.department_id, departmentName: r.department_name, programId: r.program_id, programName: r.program_name,
    batchId: r.batch_id, batchName: r.batch_name, academicYearId: r.academic_year_id, academicYearName: r.academic_year_name,
    semesterId: r.semester_id, semesterName: r.semester_name, shiftId: r.shift_id, shiftName: r.shift_name,
  };
  for (const [k, d] of Object.entries(PROFILE)) if (detail || !SENSITIVE.includes(k)) o[k] = r[d.col];
  return o;
}

async function getRow(actor, id) {
  const params = [id];
  let sql = `${SEL} AND s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(sql, params);
  if (!rows[0]) throw AppError.notFound('Student not found');
  return rows[0];
}
const get = async (actor, id) => dto(await getRow(actor, id), true);

async function list(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = '';
  if (uni) { where += ' AND s.university_id = ?'; params.push(uni); }
  for (const [qk, col] of [['departmentId', 's.department_id'], ['programId', 's.program_id'], ['batchId', 's.batch_id'], ['semesterId', 's.semester_id']]) {
    if (query[qk]) { where += ` AND ${col} = ?`; params.push(Number(query[qk]) || 0); }
  }
  if (query.status) { where += ' AND u.status = ?'; params.push(String(query.status)); }
  if (query.academicStatus) { where += ' AND s.academic_status = ?'; params.push(String(query.academicStatus)); }
  if (query.q) {
    const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`;
    where += ' AND (s.student_id LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
    params.push(like, like, like, like);
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM students s JOIN users u ON u.id = s.user_id WHERE s.deleted_at IS NULL AND u.deleted_at IS NULL${where}`, params);
  const [rows] = await pool.query(`${SEL}${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map((r) => dto(r, false)), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

function dupMessage(err) {
  if (err.code !== 'ER_DUP_ENTRY') return err;
  const m = err.message;
  const field = /login_id|uq_students_university_sid/.test(m) ? 'studentId' : /email/.test(m) ? 'email' : /phone/.test(m) ? 'phone' : null;
  const label = { studentId: 'student ID', email: 'email', phone: 'phone number' }[field] || 'value';
  return AppError.conflict(`That ${label} is already used by another account.`, field ? { [field]: 'Already in use.' } : undefined);
}

async function create(actor, body, ctx) {
  const b = body || {};
  const uni = resolveUniversity(actor, b.universityId, true);
  const [unis] = await pool.query("SELECT id FROM universities WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [uni]);
  if (!unis[0]) throw AppError.validation('University not found or inactive.', { universityId: 'University not found or inactive.' });

  const errors = {};
  if (!v.isLoginId(b.studentId)) errors.studentId = 'Use 3-50 letters, numbers, dots, dashes or underscores.';
  if (!v.isName(b.fullName)) errors.fullName = 'Enter the full name.';
  if (!v.isEmail(b.email)) errors.email = 'Enter a valid email address.';
  if (!v.isPhone(b.phone)) errors.phone = 'Enter digits only, with an optional leading +.';
  const problems = pw.policyProblems(b.temporaryPassword, { loginId: b.studentId, email: b.email });
  if (problems.length) errors.temporaryPassword = problems;
  const profile = parseProfile(b, Object.keys(PROFILE), true);
  Object.assign(errors, profile.errors, await placementErrors(pool, uni, b));
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  // Friendly duplicate report; the database unique keys remain the final guard against races.
  const [dups] = await pool.query('SELECT login_id, email, phone FROM users WHERE login_id = ? OR email = ? OR phone = ?', [b.studentId, b.email, b.phone]);
  if (dups.length) {
    const d = {};
    if (dups.some((x) => x.login_id.toLowerCase() === b.studentId.toLowerCase())) d.studentId = 'Already in use.';
    if (dups.some((x) => x.email && x.email.toLowerCase() === b.email.toLowerCase())) d.email = 'Already in use.';
    if (dups.some((x) => x.phone === b.phone)) d.phone = 'Already in use.';
    throw AppError.conflict('A student or user with the same ID, email or phone already exists.', d);
  }

  const hash = await pw.hash(b.temporaryPassword);
  let id;
  try {
    id = await withTransaction(async (conn) => {
      const [ur] = await conn.query(
        `INSERT INTO users (university_id, role_id, login_id, full_name, email, phone, password_hash, status, must_change_password)
         VALUES (?, (SELECT id FROM roles WHERE code = 'student'), ?, ?, ?, ?, ?, 'pending_verification', 1)`,
        [uni, b.studentId, b.fullName.trim(), b.email, b.phone, hash]);
      const cols = ['university_id', 'user_id', 'student_id', ...PLACEMENT.map((p) => p[1]), ...Object.keys(profile.values)];
      const vals = [uni, ur.insertId, b.studentId, ...PLACEMENT.map((p) => Number(b[p[0]])), ...Object.values(profile.values)];
      const [sr] = await conn.query(`INSERT INTO students (${cols.join(', ')}) VALUES (?)`, [vals]);
      return sr.insertId;
    });
  } catch (err) { throw dupMessage(err); }

  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'student_created', targetType: 'student', targetId: id, newValue: { studentId: b.studentId, email: b.email, programId: Number(b.programId), batchId: Number(b.batchId) } });
  comm.notify.accountCreated({ id: null, fullName: b.fullName.trim(), loginId: b.studentId, email: b.email, universityId: uni });
  return get(actor, id);
}

async function update(actor, id, body, ctx) {
  const row = await getRow(actor, id);
  const b = body || {};
  const errors = {};
  const userSet = {};
  if ('fullName' in b) { if (v.isName(b.fullName)) userSet.full_name = b.fullName.trim(); else errors.fullName = 'Enter the full name.'; }
  if ('email' in b) { if (v.isEmail(b.email)) userSet.email = b.email; else errors.email = 'Enter a valid email address.'; }
  if ('phone' in b) { if (v.isPhone(b.phone)) userSet.phone = b.phone; else errors.phone = 'Enter digits only, with an optional leading +.'; }
  const set = {};
  if ('academicStatus' in b) { if (ACADEMIC_STATUS.includes(b.academicStatus)) set.academic_status = b.academicStatus; else errors.academicStatus = 'Choose a valid status.'; }
  const profile = parseProfile(b, Object.keys(PROFILE), false);
  Object.assign(errors, profile.errors); Object.assign(set, profile.values);

  if (PLACEMENT.some(([k]) => k in b)) {
    const merged = Object.fromEntries(PLACEMENT.map(([k, col]) => [k, k in b ? b[k] : row[col]]));
    const pe = await placementErrors(pool, row.university_id, merged);
    Object.assign(errors, pe);
    PLACEMENT.forEach(([k, col]) => { if (k in b && !pe[k]) set[col] = Number(b[k]); });
  }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  try {
    await withTransaction(async (conn) => {
      if (Object.keys(userSet).length) await conn.query('UPDATE users SET ? WHERE id = ?', [userSet, row.user_id]);
      if (Object.keys(set).length) await conn.query('UPDATE students SET ? WHERE id = ?', [set, id]);
    });
  } catch (err) { throw dupMessage(err); }

  const after = await getRow(actor, id);
  const changed = Object.keys(b).filter((k) => k in dto(row, true));
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'student_updated', targetType: 'student', targetId: id,
    oldValue: Object.fromEntries(changed.map((k) => [k, SENSITIVE.includes(k) ? '[hidden]' : dto(row, true)[k]])),
    newValue: Object.fromEntries(changed.map((k) => [k, SENSITIVE.includes(k) ? '[hidden]' : dto(after, true)[k]])) });
  return dto(after, true);
}

async function me(actor) {
  const [rows] = await pool.query(`${SEL} AND s.user_id = ?`, [actor.id]);
  if (!rows[0]) throw AppError.notFound('No student record is linked to this account.');
  return rows[0];
}

async function getMe(actor) { return dto(await me(actor), true); }

async function updateMe(actor, body, ctx) {
  const row = await me(actor);
  const parsed = parseProfile(body || {}, SELF, false);
  if (Object.keys(parsed.errors).length) throw AppError.validation('Please check the highlighted fields.', parsed.errors);
  if (!Object.keys(parsed.values).length) throw AppError.validation('Nothing to update.');
  await pool.query('UPDATE students SET ? WHERE id = ?', [parsed.values, row.id]);
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'student_self_updated', targetType: 'student', targetId: row.id, newValue: Object.keys(parsed.values) });
  return getMe(actor);
}

async function setStatus(actor, id, status, ctx) {
  const row = await getRow(actor, id);
  await userService.setStatus(actor, row.user_id, status, ctx);
  return get(actor, id);
}

async function resetPassword(actor, id, temporaryPassword, ctx) {
  const row = await getRow(actor, id);
  await userService.resetPassword(actor, row.user_id, temporaryPassword, ctx);
}

/** Soft delete: the record and its history stay for audit; the account stops working. */
async function remove(actor, id, ctx) {
  const row = await getRow(actor, id);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE students SET deleted_at = NOW() WHERE id = ?', [id]);
    await conn.query("UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = ?", [row.user_id]);
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [row.user_id]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'student_deleted', targetType: 'student', targetId: id, oldValue: { studentId: row.student_id, fullName: row.full_name } });
}

module.exports = { list, get, create, update, getMe, updateMe, setStatus, resetPassword, remove, _internal: { parseProfile, PROFILE, SELF } };
