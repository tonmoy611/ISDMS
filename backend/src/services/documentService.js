'use strict';
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const model = require('./documentModel');
const { renderHtml } = require('./documentHtml');
const resultService = require('./resultService');
const enrollmentService = require('./enrollmentService');
const attendanceService = require('./attendanceService');
const permissionService = require('./permissionService');
const { resolveUniversity } = require('./structureService');
const { todayIn } = require('./enrollmentRules');
const { writeAudit } = require('./audit');

const first = (r) => r[0][0];
const unavailable = (message, reasons) => new AppError(422, 'DOCUMENT_NOT_AVAILABLE', message, reasons ? { reasons } : undefined);

/**
 * Extra admit-card conditions can be added by later modules (for example fee clearance in the finance phase).
 * A check is async (student, semester) => ({ ok, message }).
 */
const admitCardChecks = [];
const registerAdmitCardCheck = (fn) => admitCardChecks.push(fn);

// ---------- building -----------------------------------------------------------------------------------------
async function profileOf(student) {
  const row = first(await pool.query(
    `SELECT st.id, st.student_id AS code, st.admission_date, u.full_name, un.name AS university_name, un.address AS university_address,
       d.name AS department, p.name AS program, b.name AS batch
     FROM students st JOIN users u ON u.id = st.user_id JOIN universities un ON un.id = st.university_id
     LEFT JOIN departments d ON d.id = st.department_id LEFT JOIN programs p ON p.id = st.program_id LEFT JOIN batches b ON b.id = st.batch_id WHERE st.id = ?`, [student.id]));
  return {
    university: { name: row.university_name, address: row.university_address },
    student: { id: row.id, code: row.code, fullName: row.full_name, program: row.program, department: row.department, batch: row.batch, admissionDate: row.admission_date },
  };
}

async function semesterOf(student, rawId) {
  const id = rawId ? Number(rawId) : null;
  const row = id
    ? first(await pool.query('SELECT id, name FROM semesters WHERE id = ? AND university_id = ?', [id, student.university_id]))
    : first(await pool.query('SELECT id, name FROM semesters WHERE university_id = ? AND is_current = 1', [student.university_id]));
  if (!row) throw AppError.notFound(id ? 'Semester not found' : 'No current semester has been set.');
  return row;
}

async function build(student, type, { semesterId, override, reason }) {
  const { university, student: s } = await profileOf(student);
  if (type === 'transcript') {
    const summary = await resultService.studentResults(student);
    const scale = await resultService.loadScale(pool, student.university_id);
    return { model: model.buildTranscript({ university, student: s, summary, scale }), semesterId: null };
  }
  const semester = await semesterOf(student, semesterId);

  if (type === 'semester_result') {
    const summary = await resultService.studentResults(student);
    const target = summary.semesters.find((x) => x.semesterId === semester.id);
    if (!target) throw unavailable(`No results have been published for ${semester.name}.`);
    return { model: model.buildSemesterResult({ university, student: s, semester: target, upTo: summary.semesters.filter((x) => x.order <= target.order) }), semesterId: semester.id };
  }

  const overview = await enrollmentService.overview(student, semester.id);
  if (overview.registration?.status !== 'confirmed') throw unavailable(`There is no confirmed registration for ${semester.name}.`);

  if (type === 'enrollment_confirmation') {
    return { model: model.buildEnrollmentConfirmation({ university, student: s, semester, confirmedAt: overview.registration.confirmedAt, lines: overview.enrolled, totalCredits: overview.totalCredits }), semesterId: semester.id };
  }

  // admit_card
  const attendance = await attendanceService.studentSummary(student, semester.id);
  const bySection = new Map(attendance.courses.map((c) => [c.sectionId, c]));
  const eligible = []; const ineligible = [];
  for (const l of overview.enrolled) {
    const a = bySection.get(l.sectionId);
    if (a?.below) ineligible.push({ courseCode: l.courseCode, courseTitle: l.courseTitle, reason: `Attendance ${a.percentage}% is below the required ${attendance.minPercent}%.` });
    else eligible.push(l);
  }
  const blockers = [];
  for (const check of admitCardChecks) { const r = await check(student, semester); if (!r.ok) blockers.push(r.message); }
  const problems = [...blockers, ...(eligible.length === 0 ? ineligible.map((x) => `${x.courseCode}: ${x.reason}`) : [])];
  if (override) {
    return { model: model.buildAdmitCard({ university, student: s, semester, eligible: overview.enrolled, ineligible: [], override: reason }), semesterId: semester.id, overrideReason: reason };
  }
  if (blockers.length || eligible.length === 0) throw unavailable('An admit card cannot be issued yet.', problems);
  return { model: model.buildAdmitCard({ university, student: s, semester, eligible, ineligible }), semesterId: semester.id };
}

// ---------- issuing ------------------------------------------------------------------------------------------
const meta = (r) => ({
  id: r.id, serial: r.serial, type: r.doc_type, title: model.DOC_TYPES[r.doc_type].title, semesterId: r.semester_id, isOfficial: !!r.is_official,
  issuedAt: r.created_at, revoked: !!r.revoked_at, revokeReason: r.revoke_reason, studentId: r.student_id, studentCode: r.student_code, studentName: r.student_name,
});
const META_SQL = `SELECT d.*, st.student_id AS student_code, u.full_name AS student_name FROM issued_documents d JOIN students st ON st.id = d.student_id JOIN users u ON u.id = st.user_id`;

async function generate(student, body, issuer) {
  const type = body?.type;
  if (!model.DOC_TYPES[type] || type === 'payment_receipt') throw AppError.validation('Choose a document type.', { type: 'Choose transcript, semester_result, admit_card or enrollment_confirmation.' });
  const override = body?.override === true;
  const reason = override ? String(body.reason ?? '').trim() : '';
  if (override) {
    if (type !== 'admit_card') throw AppError.validation('Only admit cards can be issued with an override.');
    if (!issuer.canOverride) throw AppError.forbidden('You may not issue an admit card despite failed checks.');
    if (reason.length < 10 || reason.length > 500) throw AppError.validation('Explain the approval in 10 to 500 characters.', { reason: 'Explain the approval in 10 to 500 characters.' });
  }
  const official = issuer.official || type !== 'transcript'; // a student's own transcript is an unofficial copy
  const built = await build(student, type, { semesterId: body?.semesterId, override, reason });
  return persist(student, type, built, official, issuer, override ? reason : null);
}

/** Receipts are issued from a recorded, succeeded payment. They are always official: the payment record backs them. */
async function generateReceipt(student, paymentId, issuer) {
  const id = Number(paymentId);
  const p = Number.isInteger(id) && id > 0 ? first(await pool.query(
    `SELECT p.*, i.number AS invoice_number, i.total, i.paid_amount, i.invoice_type, sem.name AS semester_name
     FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN semesters sem ON sem.id = i.semester_id WHERE p.id = ? AND p.student_id = ?`, [id, student.id])) : null;
  if (!p) throw AppError.notFound('Payment not found');
  if (p.status !== 'succeeded') throw unavailable('A receipt can only be issued for a payment that was received.');
  const { university, student: s } = await profileOf(student);
  const built = {
    semesterId: null,
    model: model.buildPaymentReceipt({
      university, student: s,
      payment: { receiptNo: p.receipt_no, amount: p.amount, method: p.method, reference: p.reference, paidAt: p.confirmed_at || p.created_at },
      invoice: { number: p.invoice_number, description: p.invoice_type === 'semester' ? `${p.semester_name} fees` : p.invoice_type === 'admission' ? 'Admission fees' : 'Fees', total: p.total, paid: p.paid_amount, balance: Math.max(0, Number(p.total) - Number(p.paid_amount)) },
    }),
  };
  return persist(student, 'payment_receipt', built, true, issuer, null);
}

async function persist(student, type, built, official, issuer, overrideReason) {
  const hash = model.contentHash(built.model);
  const [same] = await pool.query(
    `SELECT id FROM issued_documents WHERE student_id = ? AND doc_type = ? AND semester_id <=> ? AND content_hash = ? AND is_official = ? AND revoked_at IS NULL
       AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY) ORDER BY id DESC LIMIT 1`, [student.id, type, built.semesterId, hash, official ? 1 : 0]);
  if (same[0]) return { ...(await metaById(same[0].id)), reused: true };

  const code = model.makeCode();
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO issued_documents (university_id, student_id, doc_type, semester_id, verify_code, is_official, payload, content_hash, issued_by, override_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [student.university_id, student.id, type, built.semesterId, code, official ? 1 : 0, JSON.stringify(built.model), hash, issuer.actor.id, built.overrideReason || overrideReason || null]);
    const serial = model.makeSerial(type, r.insertId);
    const full = { ...built.model, footer: { serial, code, issuedAt: todayIn(env.timezone), verifyUrl: `${env.appUrl}/verify-document?s=${serial}&c=${code}`, official } };
    await conn.query('UPDATE issued_documents SET serial = ?, payload = ? WHERE id = ?', [serial, JSON.stringify(full), r.insertId]);
    return r.insertId;
  });
  const out = await metaById(id);
  await writeAudit({ ctx: issuer.ctx, userId: issuer.actor.id, universityId: student.university_id, action: 'document_issued', targetType: 'student', targetId: student.id,
    newValue: { type, serial: out.serial, official, ...(overrideReason ? { override: overrideReason } : {}) } });
  return { ...out, reused: false };
}

async function metaById(id) { return meta(first(await pool.query(`${META_SQL} WHERE d.id = ?`, [id]))); }

// ---------- reading ------------------------------------------------------------------------------------------
async function rowFor(actor, id) {
  const row = first(await pool.query(`${META_SQL} WHERE d.id = ?`, [id]));
  if (!row) throw AppError.notFound('Document not found');
  if (actor.role === 'student') {
    const own = first(await pool.query('SELECT id FROM students WHERE id = ? AND user_id = ?', [row.student_id, actor.id]));
    if (!own) throw AppError.notFound('Document not found');
    return row;
  }
  if (actor.university_id != null && row.university_id !== actor.university_id) throw AppError.notFound('Document not found');
  const perms = await permissionService.forUser(actor);
  if (!(perms.includes('*') || perms.includes('documents.view'))) throw AppError.forbidden();
  return row;
}

const getMeta = async (actor, id) => meta(await rowFor(actor, id));

async function getHtml(actor, id) {
  const row = await rowFor(actor, id);
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return { html: renderHtml(payload, { revoked: !!row.revoked_at }), serial: row.serial };
}

async function listForStudent(student) {
  const [rows] = await pool.query(`${META_SQL} WHERE d.student_id = ? ORDER BY d.id DESC LIMIT 100`, [student.id]);
  return rows.map(meta);
}

async function list(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND d.university_id = ?'; params.push(uni); }
  if (model.DOC_TYPES[query.type]) { where += ' AND d.doc_type = ?'; params.push(query.type); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (d.serial LIKE ? OR st.student_id LIKE ? OR u.full_name LIKE ?)'; params.push(like, like, like); }
  const from = 'FROM issued_documents d JOIN students st ON st.id = d.student_id JOIN users u ON u.id = st.user_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}${where}`, params).then((x) => [[x[0][0]]]);
  const [rows] = await pool.query(`${META_SQL}${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map(meta), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function revoke(actor, id, reasonRaw, ctx) {
  const row = await rowFor(actor, id);
  const reason = String(reasonRaw ?? '').trim();
  if (reason.length < 10 || reason.length > 500) throw AppError.validation('Explain the reason in 10 to 500 characters.', { reason: 'Explain the reason in 10 to 500 characters.' });
  if (row.revoked_at) throw AppError.conflict('This document is already revoked.');
  await pool.query('UPDATE issued_documents SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?', [actor.id, reason, id]);
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'document_revoked', targetType: 'document', targetId: id, newValue: { serial: row.serial, reason } });
  return metaById(id);
}

/** Public. The same answer is given for an unknown serial and a wrong code, so serials cannot be probed. */
async function verify(serial, code) {
  const notValid = { valid: false };
  if (!/^[A-Z]{2}-\d{4}-\d{6}$/.test(String(serial)) || !/^[0-9A-Fa-f]{12}$/.test(String(code))) return notValid;
  const row = first(await pool.query(
    `SELECT d.*, st.student_id AS student_code, u.full_name, un.name AS university_name, sem.name AS semester_name
     FROM issued_documents d JOIN students st ON st.id = d.student_id JOIN users u ON u.id = st.user_id JOIN universities un ON un.id = d.university_id LEFT JOIN semesters sem ON sem.id = d.semester_id
     WHERE d.serial = ?`, [serial]));
  const given = Buffer.from(String(code).toUpperCase());
  const real = Buffer.from(row ? row.verify_code : 'XXXXXXXXXXXX');
  const match = crypto.timingSafeEqual(given, real);
  if (!row || !match) return notValid;
  return {
    valid: !row.revoked_at, revoked: !!row.revoked_at, serial: row.serial, type: model.DOC_TYPES[row.doc_type].title, official: !!row.is_official,
    issuedAt: row.created_at, university: row.university_name, studentName: row.full_name, studentId: row.student_code, semester: row.semester_name || null,
  };
}

async function myOptions(student) {
  const ov = await enrollmentService.overview(student).catch(() => null);
  const results = await resultService.studentResults(student);
  const withResults = new Set(results.semesters.map((s) => s.semesterId));
  const [sems] = await pool.query('SELECT id, name, is_current FROM semesters WHERE university_id = ? ORDER BY start_date DESC', [student.university_id]);
  return { semesters: sems.map((s) => ({ id: s.id, name: s.name, isCurrent: !!s.is_current, hasResults: withResults.has(s.id) })), hasAnyResults: results.semesters.length > 0, currentRegistration: ov?.registration?.status === 'confirmed' };
}

module.exports = { generate, generateReceipt, getMeta, getHtml, listForStudent, list, revoke, verify, myOptions, registerAdmitCardCheck, studentByUser: enrollmentService.studentByUser, studentById: enrollmentService.studentById };
