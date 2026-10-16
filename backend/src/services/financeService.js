'use strict';
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const fee = require('./feeRules');
const { todayIn } = require('./enrollmentRules');
const enrollmentService = require('./enrollmentService');
const permissionService = require('./permissionService');
const documentService = require('./documentService');
const comm = require('./communication');
const { resolveUniversity } = require('./structureService');
const { writeAudit } = require('./audit');

const first = (r) => r[0][0];
const today = () => todayIn(env.timezone);
const cents = fee.toCents;
const money = fee.fromCents;
const intId = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };
const blank = (x) => x === undefined || x === null || x === '';
const rejected = (code, message, details) => new AppError(422, code, message, details);
const need = (ok, msg) => { if (!ok) throw AppError.forbidden(msg); };
const amountText = (x) => /^\d{1,10}(\.\d{1,2})?$/.test(String(x).trim());

// ---------- settings -----------------------------------------------------------------------------------------
const DEFAULTS = { lateMode: 'none', lateValue: 0, graceDays: 0, capCents: null, admitCardRequiresClearance: false, defaultDueDays: 14 };
async function loadSettings(conn, uni) {
  const r = first(await conn.query('SELECT * FROM fee_settings WHERE university_id = ?', [uni]));
  if (!r) return { ...DEFAULTS };
  return { lateMode: r.late_mode, lateValue: Number(r.late_value), graceDays: r.late_grace_days, capCents: r.late_cap == null ? null : cents(r.late_cap), admitCardRequiresClearance: !!r.admit_card_requires_clearance, defaultDueDays: r.default_due_days };
}
const settingsDto = (s) => ({ lateMode: s.lateMode, lateValue: s.lateValue, lateGraceDays: s.graceDays, lateCap: s.capCents == null ? null : money(s.capCents), admitCardRequiresClearance: s.admitCardRequiresClearance, defaultDueDays: s.defaultDueDays });

async function getSettings(actor, rawUni) { return settingsDto(await loadSettings(pool, resolveUniversity(actor, rawUni, true))); }
async function saveSettings(actor, body, ctx) {
  const b = body || {}; const uni = resolveUniversity(actor, b.universityId, true);
  const errors = {};
  if (!['none', 'flat', 'percent'].includes(b.lateMode)) errors.lateMode = 'Choose none, flat or percent.';
  const value = Number(b.lateValue ?? 0);
  if (!Number.isFinite(value) || value < 0 || (b.lateMode === 'percent' && value > 100)) errors.lateValue = b.lateMode === 'percent' ? 'Enter a percentage from 0 to 100.' : 'Enter an amount of 0 or more.';
  const grace = Number(b.lateGraceDays ?? 0);
  if (!Number.isInteger(grace) || grace < 0 || grace > 365) errors.lateGraceDays = 'Enter 0 to 365 days.';
  const cap = blank(b.lateCap) ? null : Number(b.lateCap);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) errors.lateCap = 'Enter an amount of 0 or more, or leave it empty.';
  const due = Number(b.defaultDueDays ?? 14);
  if (!Number.isInteger(due) || due < 1 || due > 365) errors.defaultDueDays = 'Enter 1 to 365 days.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  const before = await loadSettings(pool, uni);
  await pool.query(
    `INSERT INTO fee_settings (university_id, late_mode, late_value, late_grace_days, late_cap, admit_card_requires_clearance, default_due_days) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE late_mode = VALUES(late_mode), late_value = VALUES(late_value), late_grace_days = VALUES(late_grace_days), late_cap = VALUES(late_cap),
       admit_card_requires_clearance = VALUES(admit_card_requires_clearance), default_due_days = VALUES(default_due_days)`,
    [uni, b.lateMode, value, grace, cap, b.admitCardRequiresClearance === true ? 1 : 0, due]);
  const after = await loadSettings(pool, uni);
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'fee_settings_changed', oldValue: settingsDto(before), newValue: settingsDto(after) });
  return settingsDto(after);
}

// ---------- fee heads and schedule ---------------------------------------------------------------------------
const headDto = (r) => ({ id: r.id, code: r.code, name: r.name, calcType: r.calc_type, appliesTo: r.applies_to, status: r.status });
async function listHeads(actor, rawUni) {
  const uni = resolveUniversity(actor, rawUni, true);
  const [rows] = await pool.query('SELECT * FROM fee_heads WHERE university_id = ? ORDER BY applies_to, name', [uni]);
  return rows.map(headDto);
}
async function createHead(actor, body, ctx) {
  const b = body || {}; const uni = resolveUniversity(actor, b.universityId, true);
  const code = String(b.code ?? '').trim().toUpperCase(); const name = String(b.name ?? '').trim();
  const errors = {};
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) errors.code = 'Use 2-30 letters, numbers, dashes or underscores.';
  if (name.length < 2 || name.length > 100) errors.name = 'Enter a name of 2 to 100 characters.';
  if (!fee.CALC_TYPES.includes(b.calcType)) errors.calcType = 'Choose how the fee is calculated.';
  if (!['admission', 'semester'].includes(b.appliesTo)) errors.appliesTo = 'Choose admission or semester.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  try {
    const [r] = await pool.query('INSERT INTO fee_heads (university_id, code, name, calc_type, applies_to) VALUES (?, ?, ?, ?, ?)', [uni, code, name, b.calcType, b.appliesTo]);
    await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'fee_head_created', targetType: 'fee_head', targetId: r.insertId, newValue: { code, name, calcType: b.calcType, appliesTo: b.appliesTo } });
    return headDto(first(await pool.query('SELECT * FROM fee_heads WHERE id = ?', [r.insertId])));
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('A fee with that code already exists.', { code: 'Already in use.' }); throw err; }
}
async function updateHead(actor, id, body, ctx) {
  const params = [id]; let sql = 'SELECT * FROM fee_heads WHERE id = ?';
  if (actor.university_id != null) { sql += ' AND university_id = ?'; params.push(actor.university_id); } else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const row = first(await pool.query(sql, params));
  if (!row) throw AppError.notFound('Fee not found');
  const set = {}; const errors = {};
  if ('name' in (body || {})) { const n = String(body.name).trim(); if (n.length < 2 || n.length > 100) errors.name = 'Enter a name of 2 to 100 characters.'; else set.name = n; }
  if ('status' in (body || {})) { if (['active', 'inactive'].includes(body.status)) set.status = body.status; else errors.status = 'Choose active or inactive.'; }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  if (Object.keys(set).length) {
    await pool.query('UPDATE fee_heads SET ? WHERE id = ?', [set, id]);
    await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'fee_head_changed', targetType: 'fee_head', targetId: id, oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, row[k]])), newValue: set });
  }
  return headDto(first(await pool.query('SELECT * FROM fee_heads WHERE id = ?', [id])));
}

async function scheduleItems(conn, uni, programId) {
  const [rows] = await conn.query(
    `SELECT i.fee_head_id, i.amount, h.code, h.name, h.calc_type, h.applies_to, h.status FROM fee_schedule_items i JOIN fee_heads h ON h.id = i.fee_head_id
     WHERE i.university_id = ? AND ${programId === null ? 'i.program_id IS NULL' : 'i.program_id = ?'} ORDER BY h.applies_to, h.name`, programId === null ? [uni] : [uni, programId]);
  return rows.map((r) => ({ feeHeadId: r.fee_head_id, code: r.code, name: r.name, calcType: r.calc_type, appliesTo: r.applies_to, headStatus: r.status, amount: Number(r.amount) }));
}
async function programInUni(uni, programId) { return !!first(await pool.query('SELECT id FROM programs WHERE id = ? AND university_id = ?', [programId, uni])); }

async function getSchedule(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, true);
  const programId = blank(query.programId) ? null : intId(query.programId);
  if (!blank(query.programId) && !(programId && await programInUni(uni, programId))) throw AppError.notFound('Program not found');
  return { programId, items: await scheduleItems(pool, uni, programId), defaultItems: programId ? await scheduleItems(pool, uni, null) : [] };
}
async function setSchedule(actor, body, ctx) {
  const b = body || {}; const uni = resolveUniversity(actor, b.universityId, true);
  const programId = blank(b.programId) ? null : intId(b.programId);
  if (!blank(b.programId) && !(programId && await programInUni(uni, programId))) throw AppError.validation('Program not found in this university.', { programId: 'Program not found.' });
  if (!Array.isArray(b.items) || b.items.length > 50) throw AppError.validation('Send up to 50 fee items.');
  const problems = []; const seen = new Set();
  const items = b.items.map((x, i) => {
    const headId = intId(x?.feeHeadId);
    if (!headId) problems.push(`Item ${i + 1}: choose a fee.`); else if (seen.has(headId)) problems.push(`Item ${i + 1}: the fee is listed twice.`);
    seen.add(headId);
    if (!amountText(x?.amount)) problems.push(`Item ${i + 1}: enter an amount with at most 2 decimals.`);
    return { headId, amount: Number(x?.amount) };
  });
  if (problems.length) throw AppError.validation('Please fix the fee items.', { items: problems });
  const before = await scheduleItems(pool, uni, programId);
  await withTransaction(async (conn) => {
    if (items.length) {
      const [heads] = await conn.query('SELECT id FROM fee_heads WHERE id IN (?) AND university_id = ?', [items.map((i) => i.headId), uni]);
      if (heads.length !== items.length) throw AppError.validation('One or more fees do not exist in this university.', { items: ['Unknown fee.'] });
    }
    await conn.query(`DELETE FROM fee_schedule_items WHERE university_id = ? AND ${programId === null ? 'program_id IS NULL' : 'program_id = ?'}`, programId === null ? [uni] : [uni, programId]);
    if (items.length) await conn.query('INSERT INTO fee_schedule_items (university_id, program_id, fee_head_id, amount) VALUES ?', [items.map((i) => [uni, programId, i.headId, i.amount])]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'fee_schedule_changed', targetType: 'program', targetId: programId ?? 'default', oldValue: { items: before.map((x) => [x.code, x.amount]) }, newValue: { items: items.map((x) => [x.headId, x.amount]) } });
  return getSchedule(actor, { universityId: uni, programId });
}

// ---------- concessions --------------------------------------------------------------------------------------
const concessionDto = (r) => ({ id: r.id, kind: r.kind, mode: r.mode, value: Number(r.value), feeHeadId: r.fee_head_id, feeHeadName: r.head_name || null, semesterId: r.semester_id, semesterName: r.semester_name || null, reason: r.reason, status: r.status, createdAt: r.created_at });
async function listConcessions(student) {
  const [rows] = await pool.query('SELECT c.*, h.name AS head_name, s.name AS semester_name FROM student_concessions c LEFT JOIN fee_heads h ON h.id = c.fee_head_id LEFT JOIN semesters s ON s.id = c.semester_id WHERE c.student_id = ? ORDER BY c.id DESC', [student.id]);
  return rows.map(concessionDto);
}
async function addConcession(actor, student, body, ctx) {
  const b = body || {}; const errors = {};
  if (!['discount', 'scholarship', 'waiver'].includes(b.kind)) errors.kind = 'Choose discount, scholarship or waiver.';
  if (!['percent', 'fixed'].includes(b.mode)) errors.mode = 'Choose percent or fixed amount.';
  const value = Number(b.value);
  if (!amountText(b.value) || !(value > 0) || (b.mode === 'percent' && value > 100)) errors.value = b.mode === 'percent' ? 'Enter a percentage above 0 and up to 100.' : 'Enter an amount above 0.';
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 255) errors.reason = 'Give a reason of 3 to 255 characters.';
  let headId = null; let semesterId = null;
  if (!blank(b.feeHeadId)) { headId = intId(b.feeHeadId); if (!(headId && first(await pool.query('SELECT id FROM fee_heads WHERE id = ? AND university_id = ?', [headId, student.university_id])))) errors.feeHeadId = 'Choose a fee from this university.'; }
  if (!blank(b.semesterId)) { semesterId = intId(b.semesterId); if (!(semesterId && first(await pool.query('SELECT id FROM semesters WHERE id = ? AND university_id = ?', [semesterId, student.university_id])))) errors.semesterId = 'Choose a semester from this university.'; }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  const [r] = await pool.query('INSERT INTO student_concessions (university_id, student_id, kind, mode, value, fee_head_id, semester_id, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [student.university_id, student.id, b.kind, b.mode, value, headId, semesterId, reason, actor.id]);
  await writeAudit({ ctx, userId: actor.id, universityId: student.university_id, action: 'concession_added', targetType: 'student', targetId: student.id, newValue: { id: r.insertId, kind: b.kind, mode: b.mode, value, feeHeadId: headId, semesterId, reason } });
  return listConcessions(student);
}
async function revokeConcession(actor, student, id, ctx) {
  const [r] = await pool.query("UPDATE student_concessions SET status = 'revoked', revoked_by = ?, revoked_at = NOW() WHERE id = ? AND student_id = ? AND status = 'active'", [actor.id, id, student.id]);
  if (!r.affectedRows) throw AppError.notFound('Active concession not found');
  await writeAudit({ ctx, userId: actor.id, universityId: student.university_id, action: 'concession_revoked', targetType: 'student', targetId: student.id, newValue: { id } });
  return listConcessions(student);
}

// ---------- invoice building blocks --------------------------------------------------------------------------
async function factsFor(conn, studentId, semesterId) {
  const r = first(await conn.query(
    `SELECT COUNT(*) AS courses, COALESCE(SUM(e.credit), 0) AS credits, COALESCE(SUM(c.course_type IN ('lab', 'theory_lab')), 0) AS labs
     FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND e.semester_id = ? AND e.status = 'enrolled'`, [studentId, semesterId]));
  return { courses: Number(r.courses), credits: Number(r.credits), labCourses: Number(r.labs) };
}
async function scheduleFor(conn, student, appliesTo) {
  const [rows] = await conn.query(
    `SELECT i.fee_head_id, i.amount, i.program_id, h.name, h.calc_type FROM fee_schedule_items i JOIN fee_heads h ON h.id = i.fee_head_id
     WHERE i.university_id = ? AND (i.program_id IS NULL OR i.program_id = ?) AND h.status = 'active' AND h.applies_to = ?`, [student.university_id, student.program_id, appliesTo]);
  const map = (r) => ({ headId: r.fee_head_id, name: r.name, calcType: r.calc_type, unitCents: cents(r.amount) });
  return fee.resolveSchedule(rows.filter((r) => r.program_id === null).map(map), rows.filter((r) => r.program_id !== null).map(map));
}
async function concessionsFor(conn, student, semesterId) {
  const [rows] = await conn.query("SELECT id, kind, mode, value, fee_head_id, reason FROM student_concessions WHERE student_id = ? AND status = 'active' AND (semester_id IS NULL OR semester_id <=> ?) ORDER BY id", [student.id, semesterId]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, value: Number(r.value), feeHeadId: r.fee_head_id, reason: r.reason }));
}
const lineRow = (invoiceId, l) => [invoiceId, l.kind, l.feeHeadId ?? null, l.concessionId ?? null, l.description, l.quantity, money(l.unitCents), money(l.amountCents)];
const LINE_COLS = 'invoice_id, kind, fee_head_id, concession_id, description, quantity, unit_amount, amount';

/** Rewrites the cached total, paid amount and next due date. Call inside the transaction that changed lines, payments or installments. */
async function refreshInvoice(conn, invoiceId) {
  const totalCents = cents(first(await conn.query('SELECT COALESCE(SUM(amount), 0) AS t FROM invoice_lines WHERE invoice_id = ?', [invoiceId])).t);
  const paidCents = cents(first(await conn.query("SELECT COALESCE(SUM(amount), 0) AS p FROM payments WHERE invoice_id = ? AND status = 'succeeded'", [invoiceId])).p);
  const inv = first(await conn.query('SELECT due_date FROM invoices WHERE id = ?', [invoiceId]));
  const [inst] = await conn.query('SELECT due_date, amount FROM invoice_installments WHERE invoice_id = ? ORDER BY seq', [invoiceId]);
  const next = fee.effectiveDueDate({ invoiceDue: inv.due_date, installments: inst.map((i) => ({ dueDate: i.due_date, amountCents: cents(i.amount) })), paidCents, totalCents });
  await conn.query('UPDATE invoices SET total = ?, paid_amount = ?, next_due_date = ? WHERE id = ?', [money(totalCents), money(paidCents), next, invoiceId]);
  return { totalCents, paidCents };
}

async function buildLines(conn, student, type, semesterId) {
  const facts = type === 'semester' ? await factsFor(conn, student.id, semesterId) : { courses: 0, credits: 0, labCourses: 0 };
  if (type === 'semester' && facts.courses === 0) throw rejected('NO_COURSES', 'This student has no registered courses in that semester, so there is nothing to charge.');
  const schedule = await scheduleFor(conn, student, type === 'semester' ? 'semester' : 'admission');
  if (!schedule.length) throw rejected('NO_FEES', 'No fees are set up for this program yet. Set up the fee structure first.');
  const charges = fee.computeCharges(schedule, facts);
  if (!charges.length) throw rejected('NO_FEES', 'The fee structure produces no charges for this student.');
  const discounts = fee.applyConcessions(charges, await concessionsFor(conn, student, semesterId));
  return [...charges, ...discounts];
}

async function createInvoice(conn, student, { type, semesterId, dueDate, actorId, settings }) {
  const lines = await buildLines(conn, student, type, semesterId);
  const due = dueDate || fee.addDays(today(), settings.defaultDueDays);
  let id;
  try {
    const [r] = await conn.query('INSERT INTO invoices (university_id, student_id, semester_id, invoice_type, issue_date, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [student.university_id, student.id, type === 'semester' ? semesterId : null, type, today(), due, actorId]);
    id = r.insertId;
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict(type === 'semester' ? 'This student already has an invoice for this semester.' : 'This student already has an admission invoice.'); throw err; }
  await conn.query('UPDATE invoices SET number = ? WHERE id = ?', [`INV-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`, id]);
  await conn.query(`INSERT INTO invoice_lines (${LINE_COLS}) VALUES ?`, [lines.map((l) => lineRow(id, l))]);
  await refreshInvoice(conn, id);
  return id;
}

async function semesterOf(student, rawId) {
  const id = intId(rawId);
  const r = id ? first(await pool.query('SELECT id, name, registration_end FROM semesters WHERE id = ? AND university_id = ?', [id, student.university_id]))
    : first(await pool.query('SELECT id, name, registration_end FROM semesters WHERE university_id = ? AND is_current = 1', [student.university_id]));
  if (!r) throw AppError.notFound(id ? 'Semester not found' : 'No current semester has been set.');
  return r;
}
function checkDueDate(d) { if (!blank(d) && !(fee.isDate(d) && d >= today())) throw AppError.validation('The due date must be today or later.', { dueDate: 'Enter a date from today onward.' }); }

async function generateForStudent(actor, student, body, ctx) {
  const b = body || {}; const type = b.type;
  if (!['semester', 'admission'].includes(type)) throw AppError.validation('Choose semester or admission.', { type: 'Choose semester or admission.' });
  checkDueDate(b.dueDate);
  const sem = type === 'semester' ? await semesterOf(student, b.semesterId) : null;
  const settings = await loadSettings(pool, student.university_id);
  const id = await withTransaction((conn) => createInvoice(conn, student, { type, semesterId: sem?.id ?? null, dueDate: blank(b.dueDate) ? null : b.dueDate, actorId: actor.id, settings }));
  const out = await getInvoiceById(id);
  await writeAudit({ ctx, userId: actor.id, universityId: student.university_id, action: 'invoice_created', targetType: 'invoice', targetId: id, newValue: { number: out.invoice.number, type, total: out.invoice.total } });
  return out;
}

async function bulkGenerate(actor, body, ctx) {
  const b = body || {}; const uni = resolveUniversity(actor, b.universityId, true);
  checkDueDate(b.dueDate);
  const semesterId = intId(b.semesterId);
  const sem = semesterId ? first(await pool.query('SELECT id, name FROM semesters WHERE id = ? AND university_id = ?', [semesterId, uni])) : null;
  if (!sem) throw AppError.validation('Choose a semester.', { semesterId: 'Choose a semester.' });
  const params = [semesterId, uni]; let extra = '';
  if (!blank(b.programId)) { extra += ' AND st.program_id = ?'; params.push(Number(b.programId) || 0); }
  if (!blank(b.batchId)) { extra += ' AND st.batch_id = ?'; params.push(Number(b.batchId) || 0); }
  const [students] = await pool.query(
    `SELECT st.id, st.university_id, st.program_id FROM registrations r JOIN students st ON st.id = r.student_id
     WHERE r.semester_id = ? AND r.status = 'confirmed' AND r.university_id = ? AND st.deleted_at IS NULL${extra} ORDER BY st.id LIMIT 3001`, params);
  if (students.length > 3000) throw AppError.validation('That is more than 3000 students. Narrow it by program or batch.');
  const settings = await loadSettings(pool, uni);
  const result = { created: 0, alreadyInvoiced: 0, skipped: 0, problems: [] };
  for (const st of students) {
    try {
      await withTransaction((conn) => createInvoice(conn, st, { type: 'semester', semesterId, dueDate: blank(b.dueDate) ? null : b.dueDate, actorId: actor.id, settings }));
      result.created++;
    } catch (err) {
      if (err instanceof AppError && err.status === 409) result.alreadyInvoiced++;
      else if (err instanceof AppError) { result.skipped++; if (result.problems.length < 20) result.problems.push(`Student ${st.id}: ${err.message}`); }
      else throw err;
    }
  }
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'invoices_bulk_created', targetType: 'semester', targetId: semesterId, newValue: { created: result.created, alreadyInvoiced: result.alreadyInvoiced, skipped: result.skipped } });
  return result;
}

// ---------- reading invoices ---------------------------------------------------------------------------------
const INVOICE_SQL = `SELECT i.*, st.student_id AS student_code, st.user_id, u.full_name, sem.name AS semester_name FROM invoices i JOIN students st ON st.id = i.student_id JOIN users u ON u.id = st.user_id LEFT JOIN semesters sem ON sem.id = i.semester_id`;

function stateOf(row) {
  return fee.invoiceState({ totalCents: cents(row.total), paidCents: cents(row.paid_amount), cancelled: row.status === 'cancelled', dueDate: row.next_due_date || row.due_date, today: today() });
}
function invoiceDto(r) {
  const total = Number(r.total); const paid = Number(r.paid_amount);
  return {
    id: r.id, number: r.number, type: r.invoice_type, semesterId: r.semester_id, semesterName: r.semester_name, issueDate: r.issue_date, dueDate: r.due_date, nextDueDate: r.next_due_date,
    total, paid, balance: r.status === 'cancelled' ? 0 : Math.max(0, money(cents(total) - cents(paid))), state: stateOf(r), notes: r.notes, cancelReason: r.cancel_reason,
    student: { id: r.student_id, code: r.student_code, name: r.full_name },
  };
}

async function invoiceRow(actor, id) {
  const row = first(await pool.query(`${INVOICE_SQL} WHERE i.id = ?`, [id]));
  if (!row) throw AppError.notFound('Invoice not found');
  if (actor.role === 'student') { if (row.user_id !== actor.id) throw AppError.notFound('Invoice not found'); return { row, staff: false }; }
  if (actor.university_id != null && row.university_id !== actor.university_id) throw AppError.notFound('Invoice not found');
  const perms = await permissionService.forUser(actor);
  need(perms.includes('*') || perms.includes('finance.view'));
  return { row, staff: true, perms };
}

async function getInvoiceById(id, staff = true) {
  const row = first(await pool.query(`${INVOICE_SQL} WHERE i.id = ?`, [id]));
  const [lines] = await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [id]);
  const [inst] = await pool.query('SELECT * FROM invoice_installments WHERE invoice_id = ? ORDER BY seq', [id]);
  const [pays] = await pool.query(`SELECT p.*, u.full_name AS received_name FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.invoice_id = ? ${staff ? '' : "AND p.status IN ('succeeded', 'pending')"} ORDER BY p.id DESC`, [id]);
  const alloc = fee.allocateInstallments(inst.map((i) => ({ seq: i.seq, dueDate: i.due_date, amountCents: cents(i.amount) })), cents(row.paid_amount), today());
  return {
    invoice: invoiceDto(row),
    lines: lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), amount: Number(l.amount) })),
    installments: alloc.map((a) => ({ seq: a.seq, dueDate: a.dueDate, amount: money(a.amountCents), covered: money(a.coveredCents), status: a.status, overdue: a.overdue })),
    payments: pays.map((p) => ({ id: p.id, amount: Number(p.amount), method: p.method, status: p.status, receiptNo: p.receipt_no, reference: p.reference, note: p.note, receivedBy: p.received_name, at: p.confirmed_at || p.created_at })),
  };
}

async function getInvoice(actor, id) {
  const { row, staff } = await invoiceRow(actor, id);
  return getInvoiceById(row.id, staff);
}

async function listInvoices(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND i.university_id = ?'; params.push(uni); }
  if (query.semesterId) { where += ' AND i.semester_id = ?'; params.push(Number(query.semesterId) || 0); }
  const t = today();
  const states = {
    cancelled: "i.status = 'cancelled'",
    paid: "i.status = 'issued' AND i.paid_amount >= i.total",
    overdue: "i.status = 'issued' AND i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) < ?",
    partial: "i.status = 'issued' AND i.paid_amount > 0 AND i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) >= ?",
    unpaid: "i.status = 'issued' AND i.paid_amount = 0 AND i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) >= ?",
  };
  if (states[query.state]) { where += ` AND (${states[query.state]})`; if (query.state !== 'cancelled' && query.state !== 'paid') params.push(t); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (i.number LIKE ? OR st.student_id LIKE ? OR u.full_name LIKE ?)'; params.push(like, like, like); }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM invoices i JOIN students st ON st.id = i.student_id JOIN users u ON u.id = st.user_id${where}`, params).then((x) => [[x[0][0]]]);
  const [rows] = await pool.query(`${INVOICE_SQL}${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map(invoiceDto), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function listForStudent(student) {
  const [rows] = await pool.query(`${INVOICE_SQL} WHERE i.student_id = ? ORDER BY i.id DESC`, [student.id]);
  return rows.map(invoiceDto);
}

async function myFinance(student) {
  const invoices = (await listForStudent(student)).filter((i) => i.state !== 'cancelled');
  const sum = (arr, f) => money(arr.reduce((a, i) => a + cents(f(i)), 0));
  const [pays] = await pool.query("SELECT p.id, p.amount, p.method, p.receipt_no, p.confirmed_at, i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.student_id = ? AND p.status = 'succeeded' ORDER BY p.id DESC LIMIT 50", [student.id]);
  return {
    student: { id: student.id, studentId: student.code, fullName: student.full_name },
    totals: { billed: sum(invoices, (i) => i.total), paid: sum(invoices, (i) => i.paid), due: sum(invoices, (i) => i.balance), overdue: sum(invoices.filter((i) => i.state === 'overdue'), (i) => i.balance) },
    invoices, payments: pays.map((p) => ({ id: p.id, amount: Number(p.amount), method: p.method, receiptNo: p.receipt_no, invoiceNumber: p.number, at: p.confirmed_at })),
  };
}

// ---------- changing invoices --------------------------------------------------------------------------------
async function lockedInvoice(conn, actor, id) {
  const row = first(await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [id]));
  if (!row || (actor.university_id != null && row.university_id !== actor.university_id) || (actor.university_id == null && actor.role !== 'super_admin')) throw AppError.notFound('Invoice not found');
  if (row.status !== 'issued') throw AppError.conflict('This invoice is cancelled.');
  return row;
}

async function recalculate(actor, id, ctx) {
  const out = await withTransaction(async (conn) => {
    const inv = await lockedInvoice(conn, actor, id);
    if (cents(inv.paid_amount) > 0) throw AppError.conflict('Payments were already received, so the invoice cannot be recalculated. Use an adjustment instead.');
    if (inv.invoice_type === 'other') throw AppError.conflict('Only semester and admission invoices can be recalculated.');
    const student = first(await conn.query('SELECT id, university_id, program_id FROM students WHERE id = ?', [inv.student_id]));
    const lines = await buildLines(conn, student, inv.invoice_type, inv.semester_id);
    await conn.query("DELETE FROM invoice_lines WHERE invoice_id = ? AND kind IN ('charge', 'discount')", [id]);
    await conn.query('DELETE FROM invoice_installments WHERE invoice_id = ?', [id]);
    await conn.query(`INSERT INTO invoice_lines (${LINE_COLS}) VALUES ?`, [lines.map((l) => lineRow(id, l))]);
    const r = await refreshInvoice(conn, id);
    return { number: inv.number, oldTotal: Number(inv.total), newTotal: money(r.totalCents) };
  });
  await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: 'invoice_recalculated', targetType: 'invoice', targetId: id, oldValue: { total: out.oldTotal }, newValue: { total: out.newTotal } });
  return getInvoiceById(id);
}

async function addAdjustment(actor, id, body, ctx) {
  const b = body || {}; const errors = {};
  const description = String(b.description ?? '').trim();
  if (description.length < 3 || description.length > 200) errors.description = 'Describe the adjustment in 3 to 200 characters.';
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10000000 || Math.round(amount * 100) !== amount * 100) errors.amount = 'Enter a non-zero amount with at most 2 decimals (negative to reduce the invoice).';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  await withTransaction(async (conn) => {
    const inv = await lockedInvoice(conn, actor, id);
    const newTotal = cents(inv.total) + cents(amount);
    if (newTotal < cents(inv.paid_amount)) throw AppError.conflict('That would make the invoice total smaller than what has already been paid.');
    await conn.query(`INSERT INTO invoice_lines (${LINE_COLS}) VALUES (?)`, [lineRow(id, { kind: 'adjustment', description, quantity: 1, unitCents: cents(amount), amountCents: cents(amount) })]);
    await refreshInvoice(conn, id);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: 'invoice_adjusted', targetType: 'invoice', targetId: id, newValue: { description, amount } });
  return getInvoiceById(id);
}

async function setInstallments(actor, id, body, ctx) {
  const b = body || {};
  await withTransaction(async (conn) => {
    const inv = await lockedInvoice(conn, actor, id);
    const totalCents = cents(inv.total);
    let list;
    if (Array.isArray(b.installments) && b.installments.length === 0) list = [];
    else if (Array.isArray(b.installments)) list = b.installments.map((x) => ({ dueDate: x?.dueDate, amountCents: amountText(x?.amount) ? cents(x.amount) : NaN }));
    else {
      const count = Number(b.count); const interval = Number(b.intervalDays);
      if (!Number.isInteger(count) || count < 2 || count > 12 || !Number.isInteger(interval) || interval < 1 || interval > 365 || !fee.isDate(b.firstDueDate)) throw AppError.validation('Give the number of installments (2-12), the first due date and the days between them.', { installments: ['Give the number of installments (2-12), the first due date and the days between them.'] });
      list = fee.splitInstallments(totalCents, count, b.firstDueDate, interval);
    }
    if (list.length) {
      if (cents(inv.paid_amount) >= totalCents) throw AppError.conflict('This invoice is already fully paid.');
      const problems = fee.installmentProblems(list, totalCents);
      if (problems.length) throw AppError.validation('Please fix the installments.', { installments: problems });
    }
    await conn.query('DELETE FROM invoice_installments WHERE invoice_id = ?', [id]);
    if (list.length) await conn.query('INSERT INTO invoice_installments (invoice_id, seq, due_date, amount) VALUES ?', [list.map((x, i) => [id, i + 1, x.dueDate, money(x.amountCents)])]);
    await refreshInvoice(conn, id);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: 'invoice_installments_set', targetType: 'invoice', targetId: id });
  return getInvoiceById(id);
}

async function cancelInvoice(actor, id, reasonRaw, ctx) {
  const reason = String(reasonRaw ?? '').trim();
  if (reason.length < 5 || reason.length > 255) throw AppError.validation('Give a reason of 5 to 255 characters.', { reason: 'Give a reason of 5 to 255 characters.' });
  await withTransaction(async (conn) => {
    const inv = await lockedInvoice(conn, actor, id);
    const [pay] = await conn.query("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND status IN ('succeeded', 'pending')", [id]);
    if (pay[0].n > 0) throw AppError.conflict('This invoice has payments (or payments in progress). Reverse them first; it cannot be cancelled.');
    await conn.query("UPDATE invoices SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ? WHERE id = ?", [actor.id, reason, id]);
    return inv;
  });
  await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: 'invoice_cancelled', targetType: 'invoice', targetId: id, newValue: { reason } });
  return getInvoiceById(id);
}

async function assessLateFees(actor, body, ctx) {
  const b = body || {}; const uni = resolveUniversity(actor, b.universityId, true);
  const settings = await loadSettings(pool, uni);
  if (settings.lateMode === 'none') throw rejected('LATE_FEES_OFF', 'Late fees are not switched on. Set them up under fee settings first.');
  const params = [uni, today()]; let extra = '';
  if (!blank(b.semesterId)) { extra = ' AND i.semester_id = ?'; params.push(Number(b.semesterId) || 0); }
  const [due] = await pool.query(
    `SELECT i.id FROM invoices i WHERE i.university_id = ? AND i.status = 'issued' AND i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) < ?${extra}
       AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') ORDER BY i.id LIMIT 5000`, params);
  let assessed = 0; let totalCents = 0;
  for (const { id } of due) {
    await withTransaction(async (conn) => {
      const inv = first(await conn.query("SELECT * FROM invoices WHERE id = ? AND status = 'issued' FOR UPDATE", [id]));
      if (!inv) return;
      const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ? AND kind = 'late_fee'", [id]).then((x) => [[x[0][0]]]);
      const balance = cents(inv.total) - cents(inv.paid_amount);
      const amount = fee.lateFeeCents(settings, { dueDate: inv.next_due_date || inv.due_date, today: today(), balanceCents: balance, alreadyAssessed: n > 0 });
      if (amount <= 0) return;
      await conn.query(`INSERT INTO invoice_lines (${LINE_COLS}) VALUES (?)`, [lineRow(id, { kind: 'late_fee', description: 'Late fee', quantity: 1, unitCents: amount, amountCents: amount })]);
      await refreshInvoice(conn, id);
      assessed++; totalCents += amount;
    });
  }
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'late_fees_assessed', newValue: { invoices: assessed, total: money(totalCents) } });
  return { assessed, total: money(totalCents) };
}

// ---------- payments received in person ----------------------------------------------------------------------
const MANUAL_METHODS = ['cash', 'bank_transfer', 'cheque'];

async function recordPayment(actor, invoiceId, body, ctx) {
  const b = body || {}; const errors = {};
  if (!amountText(b.amount) || !(Number(b.amount) > 0)) errors.amount = 'Enter an amount above 0 with at most 2 decimals.';
  if (!MANUAL_METHODS.includes(b.method)) errors.method = 'Choose cash, bank transfer or cheque.';
  if (!blank(b.reference) && String(b.reference).length > 100) errors.reference = 'Use at most 100 characters.';
  if (!blank(b.note) && String(b.note).length > 255) errors.note = 'Use at most 255 characters.';
  if (!blank(b.idempotencyKey) && String(b.idempotencyKey).length > 64) errors.idempotencyKey = 'Use at most 64 characters.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  const key = blank(b.idempotencyKey) ? null : `manual:${String(b.idempotencyKey)}`.slice(0, 64);
  const amountC = cents(b.amount);

  const out = await withTransaction(async (conn) => {
    const inv = await lockedInvoice(conn, actor, invoiceId);
    if (key) { // a repeated submit (double click, retry) returns the first payment instead of charging twice
      const dup = first(await conn.query('SELECT id, invoice_id FROM payments WHERE idempotency_key = ?', [key]));
      if (dup) { if (dup.invoice_id !== invoiceId) throw AppError.conflict('That idempotency key was used for another invoice.'); return { id: dup.id, repeat: true }; }
    }
    const balance = cents(inv.total) - cents(inv.paid_amount);
    if (balance <= 0) throw AppError.conflict('This invoice is already fully paid.');
    if (amountC > balance) throw rejected('OVERPAYMENT', `The amount is more than the balance of ${money(balance).toFixed(2)}.`, { amount: `The balance is ${money(balance).toFixed(2)}.` });
    const [r] = await conn.query(
      "INSERT INTO payments (university_id, student_id, invoice_id, amount, method, status, reference, idempotency_key, note, received_by, confirmed_at) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, NOW())",
      [inv.university_id, inv.student_id, invoiceId, money(amountC), b.method, blank(b.reference) ? null : String(b.reference).trim(), key, blank(b.note) ? null : String(b.note).trim(), actor.id]);
    const receiptNo = `RC-${new Date().getUTCFullYear()}-${String(r.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE payments SET receipt_no = ? WHERE id = ?', [receiptNo, r.insertId]);
    await refreshInvoice(conn, invoiceId);
    return { id: r.insertId, receiptNo, repeat: false, invoiceNumber: inv.number, studentId: inv.student_id, balanceAfter: money(balance - amountC) };
  });
  if (!out.repeat) {
    await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: 'payment_recorded', targetType: 'invoice', targetId: invoiceId, newValue: { paymentId: out.id, receiptNo: out.receiptNo, amount: money(amountC), method: b.method } });
    const s = first(await pool.query('SELECT u.id, u.full_name, u.email, st.university_id FROM students st JOIN users u ON u.id = st.user_id WHERE st.id = ?', [out.studentId]));
    comm.notify.paymentConfirmed({ id: s.id, fullName: s.full_name, email: s.email, universityId: s.university_id }, { amount: money(amountC).toFixed(2), receiptNo: out.receiptNo, invoiceNo: out.invoiceNumber, balance: out.balanceAfter.toFixed(2) });
  }
  return { paymentId: out.id, repeated: out.repeat, ...(await getInvoiceById(invoiceId)) };
}

async function listPayments(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND p.university_id = ?'; params.push(uni); }
  if (['cash', 'bank_transfer', 'cheque', 'sslcommerz', 'bkash', 'nagad'].includes(query.method)) { where += ' AND p.method = ?'; params.push(query.method); }
  if (['pending', 'succeeded', 'failed', 'cancelled', 'refunded'].includes(query.status)) { where += ' AND p.status = ?'; params.push(query.status); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (p.receipt_no LIKE ? OR i.number LIKE ? OR st.student_id LIKE ? OR u.full_name LIKE ? OR p.reference LIKE ?)'; params.push(like, like, like, like, like); }
  const from = 'FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students st ON st.id = p.student_id JOIN users u ON u.id = st.user_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}${where}`, params).then((x) => [[x[0][0]]]);
  const [rows] = await pool.query(`SELECT p.id, p.amount, p.method, p.status, p.receipt_no, p.reference, p.confirmed_at, p.created_at, i.id AS invoice_id, i.number, st.id AS student_pk, st.student_id AS code, u.full_name ${from}${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map((r) => ({ id: r.id, amount: Number(r.amount), method: r.method, status: r.status, receiptNo: r.receipt_no, reference: r.reference, at: r.confirmed_at || r.created_at, invoiceId: r.invoice_id, invoiceNumber: r.number, studentPk: r.student_pk, studentCode: r.code, studentName: r.full_name })), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function summary(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, true);
  const params = [uni]; let extra = '';
  if (query.semesterId) { extra = ' AND i.semester_id = ?'; params.push(Number(query.semesterId) || 0); }
  const t = today();
  const r = first(await pool.query(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total), 0) AS billed, COALESCE(SUM(i.paid_amount), 0) AS collected,
       COALESCE(SUM(IF(i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) < ?, i.total - i.paid_amount, 0)), 0) AS overdue_amount,
       COALESCE(SUM(i.paid_amount >= i.total), 0) AS paid_n, COALESCE(SUM(i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) < ?), 0) AS overdue_n,
       COALESCE(SUM(i.paid_amount < i.total AND COALESCE(i.next_due_date, i.due_date) >= ?), 0) AS open_n
     FROM invoices i WHERE i.university_id = ? AND i.status = 'issued'${extra}`, [t, t, t, ...params]));
  const [methods] = await pool.query(
    `SELECT p.method, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS total FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.university_id = ? AND p.status = 'succeeded'${extra} GROUP BY p.method`, params);
  const billed = Number(r.billed); const collected = Number(r.collected);
  return {
    invoices: Number(r.invoices), billed, collected, outstanding: money(cents(billed) - cents(collected)), overdueAmount: Number(r.overdue_amount),
    counts: { paid: Number(r.paid_n), open: Number(r.open_n), overdue: Number(r.overdue_n) }, byMethod: methods.map((m) => ({ method: m.method, payments: Number(m.n), total: Number(m.total) })),
  };
}

// ---------- fee clearance for admit cards --------------------------------------------------------------------
// Active only when the university switched on "admit card requires fee clearance" in fee settings.
documentService.registerAdmitCardCheck(async (student, semester) => {
  const s = await loadSettings(pool, student.university_id);
  if (!s.admitCardRequiresClearance) return { ok: true };
  const inv = first(await pool.query("SELECT total, paid_amount, due_date, next_due_date FROM invoices WHERE student_id = ? AND semester_id = ? AND invoice_type = 'semester' AND status = 'issued'", [student.id, semester.id]));
  if (!inv) return { ok: false, message: 'Fees for this semester have not been assessed yet. Please contact the accounts office.' };
  const state = fee.invoiceState({ totalCents: cents(inv.total), paidCents: cents(inv.paid_amount), cancelled: false, dueDate: inv.next_due_date || inv.due_date, today: today() });
  return state === 'overdue' ? { ok: false, message: `Fees of BDT ${money(cents(inv.total) - cents(inv.paid_amount)).toFixed(2)} are overdue. Please clear your dues.` } : { ok: true };
});

module.exports = {
  getSettings, saveSettings, listHeads, createHead, updateHead, getSchedule, setSchedule, listConcessions, addConcession, revokeConcession,
  generateForStudent, bulkGenerate, getInvoice, listInvoices, listForStudent, myFinance, recalculate, addAdjustment, setInstallments, cancelInvoice, assessLateFees,
  recordPayment, listPayments, summary, refreshInvoice, studentByUser: enrollmentService.studentByUser, studentById: enrollmentService.studentById,
};
