'use strict';
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const rules = require('./attendanceRules');
const enrollment = require('./enrollmentService');
const permissionService = require('./permissionService');
const { resolveUniversity } = require('./structureService');
const { todayIn } = require('./enrollmentRules');
const { writeAudit } = require('./audit');

const today = () => todayIn(env.timezone);
const first = (r) => r[0][0];

// ---------- access -------------------------------------------------------------------------------------------
/** A section's own teacher may view and mark it; attendance.manage may do both for any section; attendance.view may only view. */
async function sectionAccess(actor, sectionId) {
  const params = [sectionId];
  let sql = `SELECT s.id, s.university_id, s.semester_id, s.teacher_id, s.section_code, s.status, c.code AS course_code, c.title AS course_title,
      sem.name AS semester_name, sem.start_date, sem.end_date FROM sections s JOIN courses c ON c.id = s.course_id JOIN semesters sem ON sem.id = s.semester_id WHERE s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const section = first(await pool.query(sql, params));
  if (!section) throw AppError.notFound('Section not found');
  const perms = await permissionService.forUser(actor);
  const manage = perms.includes('*') || perms.includes('attendance.manage');
  const owner = actor.role === 'teacher' && section.teacher_id === actor.id;
  return { section, manage, canMark: manage || owner, canView: manage || owner || perms.includes('attendance.view') };
}

async function sessionAccess(actor, sessionId) {
  const ses = first(await pool.query('SELECT * FROM attendance_sessions WHERE id = ?', [sessionId]));
  if (!ses) throw AppError.notFound('Class session not found');
  return { session: ses, ...(await sectionAccess(actor, ses.section_id)) };
}

const need = (ok) => { if (!ok) throw AppError.forbidden(); };
const dateText = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const sessionDto = (r) => ({ id: r.id, sectionId: r.section_id, date: dateText(r.session_date), classNo: r.class_no, topic: r.topic });
const sectionDto = (s) => ({ id: s.id, courseCode: s.course_code, courseTitle: s.course_title, sectionCode: s.section_code, semesterName: s.semester_name });

// ---------- policy -------------------------------------------------------------------------------------------
async function minPercent(universityId) {
  const row = first(await pool.query("SELECT setting_value FROM system_settings WHERE university_id = ? AND setting_key = 'attendance.min_percent'", [universityId]));
  const n = row ? Number(row.setting_value) : NaN;
  return Number.isFinite(n) ? n : rules.DEFAULT_MIN_PERCENT;
}
async function getPolicy(actor, rawUni) {
  const uni = resolveUniversity(actor, rawUni, true);
  return { minPercent: await minPercent(uni), editDays: env.attendanceEditDays };
}
async function setPolicy(actor, body, ctx) {
  const uni = resolveUniversity(actor, body?.universityId, true);
  const n = Number(body?.minPercent);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw AppError.validation('Enter a percentage from 0 to 100.', { minPercent: 'Enter a percentage from 0 to 100.' });
  const old = await minPercent(uni);
  await pool.query("INSERT INTO system_settings (university_id, setting_key, setting_value) VALUES (?, 'attendance.min_percent', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [uni, String(n)]);
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'attendance_policy_changed', oldValue: { minPercent: old }, newValue: { minPercent: n } });
  return { minPercent: n, editDays: env.attendanceEditDays };
}

// ---------- sessions -----------------------------------------------------------------------------------------
async function listSessions(actor, sectionId) {
  const a = await sectionAccess(actor, sectionId); need(a.canView);
  const [rows] = await pool.query(
    `SELECT ss.*, SUM(r.status = 'present') AS p, SUM(r.status = 'absent') AS a, SUM(r.status = 'late') AS l, SUM(r.status = 'excused') AS x
     FROM attendance_sessions ss LEFT JOIN attendance_records r ON r.session_id = ss.id WHERE ss.section_id = ? GROUP BY ss.id ORDER BY ss.session_date DESC, ss.class_no DESC`, [sectionId]);
  return {
    section: sectionDto(a.section), today: today(), canMark: a.canMark,
    sessions: rows.map((r) => ({ ...sessionDto(r), present: Number(r.p) || 0, absent: Number(r.a) || 0, late: Number(r.l) || 0, excused: Number(r.x) || 0 })),
  };
}

async function createSession(actor, sectionId, body, ctx) {
  const a = await sectionAccess(actor, sectionId); need(a.canMark);
  const b = body || {};
  if (a.section.status === 'cancelled') throw AppError.conflict('This section is cancelled.');
  const problem = rules.sessionDateProblem(b.date, today(), a.section);
  if (problem) throw AppError.validation(problem, { date: problem });
  if (!a.manage && !rules.editWindowOpen(b.date, today(), env.attendanceEditDays)) {
    const m = `Teachers can only record classes from the last ${env.attendanceEditDays} days. Ask the office to add this one.`;
    throw AppError.validation(m, { date: m });
  }
  const classNo = b.classNo === undefined || b.classNo === '' ? 1 : Number(b.classNo);
  if (!Number.isInteger(classNo) || classNo < 1 || classNo > 5) throw AppError.validation('Class number must be 1 to 5.', { classNo: 'Use 1 to 5.' });
  if (b.topic && String(b.topic).length > 200) throw AppError.validation('Use at most 200 characters.', { topic: 'Too long.' });
  let id;
  try {
    const [r] = await pool.query('INSERT INTO attendance_sessions (university_id, section_id, session_date, class_no, topic, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [a.section.university_id, sectionId, b.date, classNo, b.topic ? String(b.topic).trim() : null, actor.id]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('A class with this date and number already exists for this section.', { date: 'Already exists.' });
    throw err;
  }
  await writeAudit({ ctx, userId: actor.id, universityId: a.section.university_id, action: 'attendance_session_created', targetType: 'section', targetId: sectionId, newValue: { date: b.date, classNo } });
  return getSession(actor, id);
}

async function getSession(actor, sessionId) {
  const a = await sessionAccess(actor, sessionId); need(a.canView);
  const [enrolled] = await pool.query(
    `SELECT e.id AS enrollment_id, s.id AS student_pk, s.student_id AS code, u.full_name FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
     WHERE e.section_id = ? AND e.status = 'enrolled' ORDER BY s.student_id`, [a.session.section_id]);
  const [recs] = await pool.query('SELECT student_id, status, note FROM attendance_records WHERE session_id = ?', [sessionId]);
  const byStudent = new Map(recs.map((r) => [r.student_id, r]));
  const date = dateText(a.session.session_date);
  const open = a.manage || rules.editWindowOpen(date, today(), env.attendanceEditDays);
  return {
    section: sectionDto(a.section), session: sessionDto(a.session), canMark: a.canMark && open, editWindowDays: a.manage ? null : env.attendanceEditDays,
    students: enrolled.map((e) => ({ studentId: e.student_pk, studentCode: e.code, fullName: e.full_name, status: byStudent.get(e.student_pk)?.status || null, note: byStudent.get(e.student_pk)?.note || '' })),
  };
}

async function markRecords(actor, sessionId, raw, ctx) {
  const a = await sessionAccess(actor, sessionId); need(a.canMark);
  const date = dateText(a.session.session_date);
  if (!a.manage && !rules.editWindowOpen(date, today(), env.attendanceEditDays)) {
    throw AppError.forbidden(`Teachers can only change attendance from the last ${env.attendanceEditDays} days. Ask the office to correct this class.`);
  }
  if (!Array.isArray(raw) || !raw.length || raw.length > 500) throw AppError.validation('Send between 1 and 500 attendance entries.');
  const problems = []; const seen = new Set();
  const entries = raw.map((x, i) => {
    const studentId = Number(x?.studentId);
    if (!Number.isInteger(studentId) || studentId < 1) problems.push(`Entry ${i + 1}: unknown student.`);
    else if (seen.has(studentId)) problems.push(`Entry ${i + 1}: the student appears twice.`);
    seen.add(studentId);
    if (!rules.STATUSES.includes(x?.status)) problems.push(`Entry ${i + 1}: choose present, absent, late or excused.`);
    if (x?.note && String(x.note).length > 255) problems.push(`Entry ${i + 1}: note is too long.`);
    return { studentId, status: x?.status, note: x?.note ? String(x.note).trim() : null };
  });
  if (problems.length) throw AppError.validation('Please fix the attendance entries.', { records: problems });

  const result = await withTransaction(async (conn) => {
    const [enrolled] = await conn.query("SELECT id, student_id FROM enrollments WHERE section_id = ? AND status = 'enrolled' AND student_id IN (?)", [a.session.section_id, [...seen]]);
    const enrollmentOf = new Map(enrolled.map((e) => [e.student_id, e.id]));
    const stray = entries.filter((e) => !enrollmentOf.has(e.studentId));
    if (stray.length) throw AppError.validation('Some students are not enrolled in this section.', { records: stray.map((s) => `Student ${s.studentId} is not enrolled in this section.`) });
    const [old] = await conn.query('SELECT student_id, status FROM attendance_records WHERE session_id = ?', [sessionId]);
    const before = new Map(old.map((o) => [o.student_id, o.status]));
    await conn.query(
      `INSERT INTO attendance_records (session_id, student_id, enrollment_id, status, note, marked_by) VALUES ?
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), marked_by = VALUES(marked_by), marked_at = NOW()`,
      [entries.map((e) => [sessionId, e.studentId, enrollmentOf.get(e.studentId), e.status, e.note, actor.id])]);
    return { changed: entries.filter((e) => before.get(e.studentId) !== e.status).length, corrected: entries.filter((e) => before.has(e.studentId) && before.get(e.studentId) !== e.status).length };
  });
  const counts = rules.summarize(Object.fromEntries(rules.STATUSES.map((s) => [s, entries.filter((e) => e.status === s).length])));
  await writeAudit({ ctx, userId: actor.id, universityId: a.section.university_id, action: 'attendance_marked', targetType: 'attendance_session', targetId: sessionId,
    newValue: { present: counts.present, absent: counts.absent, late: counts.late, excused: counts.excused, changed: result.changed, corrections: result.corrected } });
  return getSession(actor, sessionId);
}

async function deleteSession(actor, sessionId, ctx) {
  const a = await sessionAccess(actor, sessionId); need(a.canMark);
  const date = dateText(a.session.session_date);
  if (!a.manage && !rules.editWindowOpen(date, today(), env.attendanceEditDays)) throw AppError.forbidden('This class is too old for a teacher to remove. Ask the office.');
  await pool.query('DELETE FROM attendance_sessions WHERE id = ?', [sessionId]);
  await writeAudit({ ctx, userId: actor.id, universityId: a.section.university_id, action: 'attendance_session_deleted', targetType: 'section', targetId: a.session.section_id, oldValue: { date, classNo: a.session.class_no } });
}

// ---------- summaries ----------------------------------------------------------------------------------------
async function sectionSummary(actor, sectionId) {
  const a = await sectionAccess(actor, sectionId); need(a.canView);
  const min = await minPercent(a.section.university_id);
  const [rows] = await pool.query(
    `SELECT s.id AS student_pk, s.student_id AS code, u.full_name,
       SUM(r.status = 'present') AS p, SUM(r.status = 'absent') AS a, SUM(r.status = 'late') AS l, SUM(r.status = 'excused') AS x
     FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
     LEFT JOIN attendance_records r ON r.student_id = e.student_id AND r.session_id IN (SELECT id FROM attendance_sessions WHERE section_id = e.section_id)
     WHERE e.section_id = ? AND e.status = 'enrolled' GROUP BY s.id, s.student_id, u.full_name ORDER BY s.student_id`, [sectionId]);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM attendance_sessions WHERE section_id = ?', [sectionId]).then((r) => [[r[0][0]]]);
  return {
    section: sectionDto(a.section), minPercent: min, sessionsHeld: n,
    students: rows.map((r) => { const s = rules.summarize({ present: r.p, absent: r.a, late: r.l, excused: r.x }); return { studentId: r.student_pk, studentCode: r.code, fullName: r.full_name, ...s, below: rules.belowThreshold(s.percentage, min) }; }),
  };
}

async function currentSemesterId(universityId, raw) {
  if (raw) return Number(raw) || 0;
  const row = first(await pool.query('SELECT id FROM semesters WHERE university_id = ? AND is_current = 1', [universityId]));
  if (!row) throw AppError.notFound('No current semester has been set.');
  return row.id;
}

/** One student's attendance per enrolled course. Used by the student (own) and by staff (attendance.view, checked in the route). */
async function studentSummary(student, rawSemesterId) {
  const semesterId = await currentSemesterId(student.university_id, rawSemesterId);
  const min = await minPercent(student.university_id);
  const [rows] = await pool.query(
    `SELECT e.section_id, c.code, c.title, s.section_code,
       SUM(r.status = 'present') AS p, SUM(r.status = 'absent') AS a, SUM(r.status = 'late') AS l, SUM(r.status = 'excused') AS x
     FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = e.course_id
     LEFT JOIN attendance_sessions ss ON ss.section_id = e.section_id LEFT JOIN attendance_records r ON r.session_id = ss.id AND r.student_id = e.student_id
     WHERE e.student_id = ? AND e.semester_id = ? AND e.status = 'enrolled' GROUP BY e.section_id, c.code, c.title, s.section_code ORDER BY c.code`, [student.id, semesterId]);
  const sem = first(await pool.query('SELECT name FROM semesters WHERE id = ?', [semesterId]));
  return {
    student: { id: student.id, studentId: student.code, fullName: student.full_name }, semester: { id: semesterId, name: sem?.name }, minPercent: min,
    courses: rows.map((r) => { const s = rules.summarize({ present: r.p, absent: r.a, late: r.l, excused: r.x }); return { sectionId: r.section_id, courseCode: r.code, courseTitle: r.title, sectionCode: r.section_code, ...s, below: rules.belowThreshold(s.percentage, min) }; }),
  };
}

async function studentDays(student, sectionId) {
  const own = first(await pool.query("SELECT id FROM enrollments WHERE student_id = ? AND section_id = ? AND status = 'enrolled'", [student.id, sectionId]));
  if (!own) throw AppError.notFound('You are not enrolled in this section.');
  const [rows] = await pool.query(
    `SELECT ss.session_date, ss.class_no, ss.topic, r.status, r.note FROM attendance_sessions ss LEFT JOIN attendance_records r ON r.session_id = ss.id AND r.student_id = ?
     WHERE ss.section_id = ? ORDER BY ss.session_date DESC, ss.class_no DESC`, [student.id, sectionId]);
  return { days: rows.map((r) => ({ date: dateText(r.session_date), classNo: r.class_no, topic: r.topic, status: r.status, note: r.note })) };
}

async function report(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, true);
  const semesterId = await currentSemesterId(uni, query.semesterId);
  const min = await minPercent(uni);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = [uni, semesterId]; let where = "e.university_id = ? AND e.semester_id = ? AND e.status = 'enrolled'";
  if (query.sectionId) { where += ' AND e.section_id = ?'; params.push(Number(query.sectionId) || 0); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (st.student_id LIKE ? OR u.full_name LIKE ?)'; params.push(like, like); }
  const having = query.belowThreshold === '1' || query.belowThreshold === 'true'
    ? 'HAVING (COUNT(r.id) - SUM(r.status = \'excused\')) > 0 AND SUM(r.status IN (\'present\', \'late\')) * 100 < ? * (COUNT(r.id) - SUM(r.status = \'excused\'))' : '';
  const hp = having ? [min] : [];
  const inner = `SELECT st.id AS student_pk, st.student_id AS code, u.full_name, e.section_id, c.code AS course_code, s.section_code,
       SUM(r.status = 'present') AS p, SUM(r.status = 'absent') AS a, SUM(r.status = 'late') AS l, SUM(r.status = 'excused') AS x
     FROM enrollments e JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = e.course_id
     LEFT JOIN attendance_sessions ss ON ss.section_id = e.section_id LEFT JOIN attendance_records r ON r.session_id = ss.id AND r.student_id = e.student_id
     WHERE ${where} GROUP BY st.id, st.student_id, u.full_name, e.section_id, c.code, s.section_code ${having}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${inner}) t`, [...params, ...hp]).then((r) => [[r[0][0]]]);
  const [rows] = await pool.query(`${inner} ORDER BY course_code, code LIMIT ? OFFSET ?`, [...params, ...hp, pageSize, offset]);
  return {
    minPercent: min, semesterId,
    items: rows.map((r) => { const s = rules.summarize({ present: r.p, absent: r.a, late: r.l, excused: r.x }); return { studentPk: r.student_pk, studentCode: r.code, fullName: r.full_name, sectionId: r.section_id, courseCode: r.course_code, sectionCode: r.section_code, ...s, below: rules.belowThreshold(s.percentage, min) }; }),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

module.exports = { getPolicy, setPolicy, listSessions, createSession, getSession, markRecords, deleteSession, sectionSummary, studentSummary, studentDays, report, studentByUser: enrollment.studentByUser, studentById: enrollment.studentById };
