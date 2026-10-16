'use strict';
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const elig = require('./eligibility');
const rules = require('./enrollmentRules');
const courseService = require('./courseService');
const comm = require('./communication');
const permissionService = require('./permissionService');
const { writeAudit } = require('./audit');

const intId = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };
const round1 = (n) => Math.round(n * 10) / 10;
const rejected = (errors, message = 'This registration cannot be completed.') => new AppError(422, 'ENROLLMENT_REJECTED', message, { errors });

// ---------- who is the student -------------------------------------------------------------------------------
const STUDENT_SQL = `SELECT s.id, s.university_id, s.user_id, s.student_id AS code, s.program_id, s.academic_status, u.full_name, u.email, u.status AS account_status
  FROM students s JOIN users u ON u.id = s.user_id WHERE s.deleted_at IS NULL AND u.deleted_at IS NULL`;

async function studentByUser(actor) {
  const [rows] = await pool.query(`${STUDENT_SQL} AND s.user_id = ?`, [actor.id]);
  if (!rows[0]) throw AppError.notFound('No student record is linked to this account.');
  return rows[0];
}
async function studentById(actor, id) {
  const params = [id]; let sql = `${STUDENT_SQL} AND s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(sql, params);
  if (!rows[0]) throw AppError.notFound('Student not found');
  return rows[0];
}

async function semesterFor(student, rawId, conn = pool) {
  const id = rawId ? intId(rawId) : null;
  const [rows] = id
    ? await conn.query('SELECT * FROM semesters WHERE id = ? AND university_id = ?', [id, student.university_id])
    : await conn.query('SELECT * FROM semesters WHERE university_id = ? AND is_current = 1', [student.university_id]);
  if (!rows[0]) throw AppError.notFound(id ? 'Semester not found' : 'No current semester has been set. Ask the university office.');
  return rows[0];
}
const windowOf = (sem) => rules.windowState(sem, rules.todayIn(env.timezone));

// ---------- data loaders -------------------------------------------------------------------------------------
async function slotsBySection(conn, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await conn.query('SELECT ss.section_id, ss.day_of_week, ss.start_time, ss.end_time, ss.slot_type, r.name AS room_name FROM section_slots ss LEFT JOIN rooms r ON r.id = ss.room_id WHERE ss.section_id IN (?) ORDER BY ss.day_of_week, ss.start_time', [ids]);
  rows.forEach((r) => {
    if (!map.has(r.section_id)) map.set(r.section_id, []);
    map.get(r.section_id).push({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, slotType: r.slot_type, roomName: r.room_name });
  });
  return map;
}
const slotOut = (s) => ({ dayOfWeek: s.dayOfWeek, startTime: String(s.startTime).slice(0, 5), endTime: String(s.endTime).slice(0, 5), slotType: s.slotType, roomName: s.roomName });

async function linesFor(conn, studentId, semesterId, { all = false } = {}) {
  const [rows] = await conn.query(
    `SELECT e.id, e.section_id, e.course_id, e.credit, e.status, e.outcome, e.enrolled_at, e.dropped_at, e.drop_reason, e.semester_id,
       s.section_code, c.code AS course_code, c.title AS course_title, u.full_name AS teacher_name
     FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = e.course_id LEFT JOIN users u ON u.id = s.teacher_id
     WHERE e.student_id = ? AND e.semester_id = ? ${all ? '' : "AND e.status = 'enrolled'"} ORDER BY c.code`, [studentId, semesterId]);
  const slots = await slotsBySection(conn, [...new Set(rows.map((r) => r.section_id))]);
  return rows.map((r) => ({
    id: r.id, sectionId: r.section_id, sectionCode: r.section_code, courseId: r.course_id, courseCode: r.course_code, courseTitle: r.course_title,
    credit: Number(r.credit), status: r.status, outcome: r.outcome, enrolledAt: r.enrolled_at, droppedAt: r.dropped_at, dropReason: r.drop_reason,
    teacherName: r.teacher_name, slots: (slots.get(r.section_id) || []).map(slotOut),
  }));
}

async function completedSet(conn, studentId) {
  const [a] = await conn.query("SELECT DISTINCT course_id FROM enrollments WHERE student_id = ? AND outcome = 'passed'", [studentId]);
  const [b] = await conn.query('SELECT course_id FROM prior_credits WHERE student_id = ?', [studentId]);
  return new Set([...a, ...b].map((r) => r.course_id));
}

async function prereqMapOf(conn, courseIds) {
  const map = new Map(); const codes = new Map();
  if (!courseIds.length) return { map, codes };
  const [rows] = await conn.query('SELECT cp.course_id, cp.prerequisite_id, p.code, p.credit, p.status FROM course_prerequisites cp JOIN courses p ON p.id = cp.prerequisite_id WHERE cp.course_id IN (?)', [courseIds]);
  rows.forEach((r) => {
    if (!map.has(r.course_id)) map.set(r.course_id, []);
    map.get(r.course_id).push(r.prerequisite_id);
    codes.set(r.prerequisite_id, { id: r.prerequisite_id, code: r.code, credit: Number(r.credit), status: r.status });
  });
  return { map, codes };
}

// ---------- the core: validate a set of sections and enroll them inside the caller's transaction ----------------
async function validateAndEnroll(conn, { student, semester, registrationId, sectionIds, checkMinimum }) {
  const ids = [...new Set((sectionIds || []).map(intId))];
  if (!ids.length || ids.includes(null) || ids.length > 12) throw AppError.validation('Choose between 1 and 12 sections.', { sectionIds: 'Choose between 1 and 12 sections.' });
  // Locking the sections (in id order, so concurrent requests cannot deadlock) makes the seat count below trustworthy.
  const [secs] = await conn.query(
    `SELECT s.id, s.course_id, s.section_code, s.capacity, s.status, c.code AS course_code, c.title AS course_title, c.credit, c.status AS course_status
     FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.id IN (?) AND s.university_id = ? AND s.semester_id = ? ORDER BY s.id FOR UPDATE OF s`,
    [ids, student.university_id, semester.id]);
  if (secs.length !== ids.length) throw AppError.validation('One or more sections are not offered in this semester.', { sectionIds: 'Not offered in this semester.' });

  const errors = [];
  const label = (s) => `${s.course_code} section ${s.section_code}`;
  const sectionOfCourse = new Map(secs.map((s) => [s.course_id, s.id]));
  secs.forEach((s) => { if (s.status !== 'open') errors.push({ code: 'SECTION_CLOSED', sectionId: s.id, message: `${label(s)} is not open for registration.` }); });

  const [held] = await conn.query("SELECT section_id, course_id, credit FROM enrollments WHERE student_id = ? AND semester_id = ? AND status = 'enrolled'", [student.id, semester.id]);
  const heldCourses = new Set(held.map((h) => h.course_id));
  secs.forEach((s) => { if (heldCourses.has(s.course_id)) errors.push({ code: 'ALREADY_REGISTERED', sectionId: s.id, message: `You are already registered for ${s.course_code} this semester.` }); });

  const courses = new Map(secs.map((s) => [s.course_id, { id: s.course_id, code: s.course_code, credit: Number(s.credit), status: s.course_status }]));
  const { map: prereqMap, codes } = await prereqMapOf(conn, [...courses.keys()]);
  codes.forEach((c, id) => { if (!courses.has(id)) courses.set(id, c); });
  const [cur] = await conn.query('SELECT course_id FROM program_courses WHERE program_id = ?', [student.program_id]);
  const rule = await courseService.effectiveRule(student.university_id, student.program_id, conn);
  const result = elig.evaluate({
    courses, selectedIds: secs.map((s) => s.course_id), prereqMap, completed: await completedSet(conn, student.id), curriculum: new Set(cur.map((r) => r.course_id)), rule,
    alreadyRegisteredCredits: round1(held.reduce((a, h) => a + Number(h.credit), 0)), checkMinimum,
  });
  result.errors.forEach((e) => errors.push({ ...e, sectionId: sectionOfCourse.get(e.courseId) }));

  // Timetable clashes with what the student already holds, and within the new selection.
  const allIds = [...new Set([...ids, ...held.map((h) => h.section_id)])];
  const slotMap = await slotsBySection(conn, allIds);
  const [heldInfo] = held.length ? await conn.query('SELECT s.id, c.code, s.section_code FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.id IN (?)', [held.map((h) => h.section_id)]) : [[]];
  const adding = secs.map((s) => ({ sectionId: s.id, label: label(s), slots: slotMap.get(s.id) || [] }));
  const heldItems = heldInfo.map((h) => ({ sectionId: h.id, label: `${h.code} section ${h.section_code}`, slots: slotMap.get(h.id) || [] }));
  rules.timetableClashes(adding, heldItems).forEach((c) => errors.push({ code: 'TIMETABLE_CLASH', ...c }));

  // Seats: counted while the sections are locked.
  const [counts] = await conn.query("SELECT section_id, COUNT(*) AS n FROM enrollments WHERE section_id IN (?) AND status = 'enrolled' GROUP BY section_id", [ids]);
  const taken = new Map(counts.map((c) => [c.section_id, c.n]));
  secs.forEach((s) => { if ((taken.get(s.id) || 0) >= s.capacity) errors.push({ code: 'SECTION_FULL', sectionId: s.id, message: `${label(s)} is full.` }); });

  if (errors.length) throw rejected(errors);

  try {
    await conn.query('INSERT INTO enrollments (university_id, registration_id, student_id, semester_id, section_id, course_id, credit) VALUES ?',
      [secs.map((s) => [student.university_id, registrationId, student.id, semester.id, s.id, s.course_id, Number(s.credit)])]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw rejected([{ code: 'ALREADY_REGISTERED', message: 'You are already registered for one of these courses.' }]);
    throw err;
  }
  return { added: secs.map((s) => ({ code: s.course_code, title: s.course_title, section: s.section_code, credit: Number(s.credit) })), total: result.totalCredits };
}

async function lockRegistration(conn, student, semester, { create }) {
  if (create) await conn.query("INSERT IGNORE INTO registrations (university_id, student_id, semester_id, status) VALUES (?, ?, ?, 'cancelled')", [student.university_id, student.id, semester.id]);
  const [rows] = await conn.query('SELECT * FROM registrations WHERE student_id = ? AND semester_id = ? FOR UPDATE', [student.id, semester.id]);
  return rows[0] || null;
}

function guard(student) {
  if (student.account_status !== 'active') throw AppError.forbidden('This student account is not active.');
  if (student.academic_status !== 'studying') throw AppError.forbidden(`Registration is not available for students whose status is "${student.academic_status}".`);
}
function needWindow(win, flag, override, what) {
  if (override) return;
  if (!win[flag]) throw new AppError(403, 'REGISTRATION_CLOSED', win.message || `${what} is not available right now.`);
}
const audit = (o, action, student, extra) => writeAudit({ ctx: o.ctx, userId: o.actor.id, universityId: student.university_id, action, targetType: 'student', targetId: student.id, ...extra, ...(o.override ? { newValue: { ...(extra?.newValue || {}), override: true } } : {}) });

// ---------- actions ------------------------------------------------------------------------------------------
async function register(student, body, o) {
  guard(student);
  const semester = await semesterFor(student, body.semesterId);
  const win = windowOf(semester);
  needWindow(win, 'canRegister', o.override, 'Registration');
  const out = await withTransaction(async (conn) => {
    const reg = await lockRegistration(conn, student, semester, { create: true });
    if (reg.status === 'confirmed') throw AppError.conflict('You are already registered for this semester. Use add or drop to change your courses.');
    const r = await validateAndEnroll(conn, { student, semester, registrationId: reg.id, sectionIds: body.sectionIds, checkMinimum: true });
    await conn.query("UPDATE registrations SET status = 'confirmed', confirmed_at = NOW(), cancelled_at = NULL, cancel_reason = NULL WHERE id = ?", [reg.id]);
    return r;
  });
  await audit(o, 'enrollment_registered', student, { newValue: { semesterId: semester.id, courses: out.added.map((a) => a.code), credits: out.total } });
  comm.notify.enrollmentConfirmed({ id: student.user_id, fullName: student.full_name, email: student.email, universityId: student.university_id }, { semester: semester.name, courses: out.added, totalCredits: out.total });
  return overview(student, semester.id);
}

async function add(student, body, o) {
  guard(student);
  const semester = await semesterFor(student, body.semesterId);
  needWindow(windowOf(semester), 'canAddDrop', o.override, 'Adding courses');
  const out = await withTransaction(async (conn) => {
    const reg = await lockRegistration(conn, student, semester, { create: false });
    if (!reg || reg.status !== 'confirmed') throw AppError.conflict('Register for the semester first.');
    return validateAndEnroll(conn, { student, semester, registrationId: reg.id, sectionIds: [body.sectionId], checkMinimum: false });
  });
  await audit(o, 'enrollment_added', student, { newValue: { semesterId: semester.id, courses: out.added.map((a) => a.code) } });
  comm.notify.enrollmentConfirmed({ id: student.user_id, fullName: student.full_name, email: student.email, universityId: student.university_id }, { semester: semester.name, courses: out.added, totalCredits: out.total });
  return overview(student, semester.id);
}

async function drop(student, body, o) {
  guard(student);
  const enrollmentId = intId(body.enrollmentId);
  if (!enrollmentId) throw AppError.validation('Choose a course to drop.');
  const [[line]] = await pool.query('SELECT semester_id FROM enrollments WHERE id = ? AND student_id = ?', [enrollmentId, student.id]).then((r) => [[r[0][0]]]);
  if (!line) throw AppError.notFound('Enrollment not found');
  const semester = await semesterFor(student, line.semester_id);
  needWindow(windowOf(semester), 'canAddDrop', o.override, 'Dropping courses');
  const reason = body.reason ? String(body.reason).slice(0, 255) : null;
  const dropped = await withTransaction(async (conn) => {
    await lockRegistration(conn, student, semester, { create: false });
    const [rows] = await conn.query("SELECT e.id, e.credit, e.course_id, c.code FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.id = ? AND e.student_id = ? AND e.status = 'enrolled' FOR UPDATE", [enrollmentId, student.id]);
    if (!rows[0]) throw AppError.conflict('That course is no longer registered.');
    const [sum] = await conn.query("SELECT COALESCE(SUM(credit), 0) AS total, COUNT(*) AS n FROM enrollments WHERE student_id = ? AND semester_id = ? AND status = 'enrolled'", [student.id, semester.id]);
    const remaining = round1(Number(sum[0].total) - Number(rows[0].credit));
    if (sum[0].n <= 1) throw rejected([{ code: 'LAST_COURSE', message: 'This is your last course. Cancel the registration instead of dropping it.' }]);
    const rule = await courseService.effectiveRule(student.university_id, student.program_id, conn);
    if (!o.override && rule?.min != null && remaining < rule.min) throw rejected([{ code: 'CREDIT_BELOW_MIN', message: `Dropping ${rows[0].code} would leave ${remaining} credits, below the minimum of ${rule.min}.` }]);
    await conn.query("UPDATE enrollments SET status = 'dropped', dropped_at = NOW(), drop_reason = ? WHERE id = ?", [reason, enrollmentId]);
    return rows[0].code;
  });
  await audit(o, 'enrollment_dropped', student, { newValue: { semesterId: semester.id, course: dropped, reason } });
  return overview(student, semester.id);
}

async function cancel(student, body, o) {
  const semester = await semesterFor(student, body.semesterId);
  needWindow(windowOf(semester), 'canAddDrop', o.override, 'Cancelling the registration');
  const reason = body.reason ? String(body.reason).slice(0, 255) : null;
  await withTransaction(async (conn) => {
    const reg = await lockRegistration(conn, student, semester, { create: false });
    if (!reg || reg.status !== 'confirmed') throw AppError.conflict('There is no active registration to cancel.');
    await conn.query("UPDATE enrollments SET status = 'dropped', dropped_at = NOW(), drop_reason = 'Registration cancelled' WHERE student_id = ? AND semester_id = ? AND status = 'enrolled'", [student.id, semester.id]);
    await conn.query("UPDATE registrations SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", [reason, reg.id]);
  });
  await audit(o, 'registration_cancelled', student, { newValue: { semesterId: semester.id, reason } });
  return overview(student, semester.id);
}

// ---------- reading ------------------------------------------------------------------------------------------
async function overview(student, rawSemesterId) {
  const semester = await semesterFor(student, rawSemesterId);
  const win = windowOf(semester);
  const [[reg]] = await pool.query('SELECT status, confirmed_at, cancelled_at FROM registrations WHERE student_id = ? AND semester_id = ?', [student.id, semester.id]).then((r) => [[r[0][0] || null]]);
  const enrolled = await linesFor(pool, student.id, semester.id);
  const totalCredits = round1(enrolled.reduce((a, l) => a + l.credit, 0));
  const rule = await courseService.effectiveRule(student.university_id, student.program_id);
  const [semesters] = await pool.query('SELECT id, name, is_current FROM semesters WHERE university_id = ? ORDER BY start_date DESC', [student.university_id]);

  // Courses of the program that have sections this semester, with eligibility and seats.
  const [rows] = await pool.query(
    `SELECT pc.semester_no, pc.is_mandatory, c.id AS course_id, c.code, c.title, c.credit, c.status AS course_status,
       s.id AS section_id, s.section_code, s.capacity, s.status AS section_status, u.full_name AS teacher_name
     FROM program_courses pc JOIN courses c ON c.id = pc.course_id JOIN sections s ON s.course_id = c.id AND s.semester_id = ? AND s.status = 'open'
     LEFT JOIN users u ON u.id = s.teacher_id WHERE pc.program_id = ? ORDER BY pc.semester_no, c.code, s.section_code`, [semester.id, student.program_id]);
  const completed = await completedSet(pool, student.id);
  const heldCourses = new Set(enrolled.map((l) => l.courseId));
  const sectionIds = rows.map((r) => r.section_id);
  const slots = await slotsBySection(pool, sectionIds);
  const [counts] = sectionIds.length ? await pool.query("SELECT section_id, COUNT(*) AS n FROM enrollments WHERE section_id IN (?) AND status = 'enrolled' GROUP BY section_id", [sectionIds]) : [[]];
  const taken = new Map(counts.map((c) => [c.section_id, c.n]));
  const { map: prereqMap, codes } = await prereqMapOf(pool, [...new Set(rows.map((r) => r.course_id))]);

  const available = [];
  for (const r of rows) {
    if (completed.has(r.course_id) || heldCourses.has(r.course_id) || r.course_status !== 'active') continue;
    let course = available.find((a) => a.courseId === r.course_id);
    if (!course) {
      const missing = (prereqMap.get(r.course_id) || []).filter((p) => !completed.has(p)).map((p) => codes.get(p)?.code || `#${p}`);
      course = { courseId: r.course_id, code: r.code, title: r.title, credit: Number(r.credit), programSemester: r.semester_no, isMandatory: !!r.is_mandatory, eligible: missing.length === 0, reasons: missing.length ? [`Requires ${missing.join(', ')} first.`] : [], sections: [] };
      available.push(course);
    }
    course.sections.push({ id: r.section_id, sectionCode: r.section_code, teacherName: r.teacher_name, capacity: r.capacity, seatsLeft: Math.max(0, r.capacity - (taken.get(r.section_id) || 0)), slots: (slots.get(r.section_id) || []).map(slotOut) });
  }
  return {
    student: { id: student.id, universityId: student.university_id, studentId: student.code, fullName: student.full_name },
    semester: { id: semester.id, name: semester.name, isCurrent: !!semester.is_current, registrationStart: semester.registration_start, registrationEnd: semester.registration_end, addDropEnd: semester.add_drop_end },
    semesters: semesters.map((s) => ({ id: s.id, name: s.name, isCurrent: !!s.is_current })),
    window: win, registration: reg ? { status: reg.status, confirmedAt: reg.confirmed_at, cancelledAt: reg.cancelled_at } : null,
    enrolled, totalCredits, rule, available,
  };
}

async function history(student) {
  const [regs] = await pool.query(
    'SELECT r.semester_id, r.status, r.confirmed_at, r.cancelled_at, r.cancel_reason, sem.name AS semester_name FROM registrations r JOIN semesters sem ON sem.id = r.semester_id WHERE r.student_id = ? ORDER BY sem.start_date DESC', [student.id]);
  const out = [];
  for (const r of regs) out.push({ semesterId: r.semester_id, semesterName: r.semester_name, status: r.status, confirmedAt: r.confirmed_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, lines: await linesFor(pool, student.id, r.semester_id, { all: true }) });
  return out;
}

async function listRegistrations(actor, query, resolveUniversity) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND r.university_id = ?'; params.push(uni); }
  if (query.semesterId) { where += ' AND r.semester_id = ?'; params.push(Number(query.semesterId) || 0); }
  if (query.status && ['confirmed', 'cancelled'].includes(query.status)) { where += ' AND r.status = ?'; params.push(query.status); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (s.student_id LIKE ? OR u.full_name LIKE ?)'; params.push(like, like); }
  const from = 'FROM registrations r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id JOIN semesters sem ON sem.id = r.semester_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}${where}`, params);
  const [rows] = await pool.query(
    `SELECT r.id, r.status, r.confirmed_at, s.id AS student_pk, s.student_id AS code, u.full_name, sem.name AS semester_name,
       (SELECT COUNT(*) FROM enrollments e WHERE e.registration_id = r.id AND e.status = 'enrolled') AS courses,
       (SELECT COALESCE(SUM(e.credit), 0) FROM enrollments e WHERE e.registration_id = r.id AND e.status = 'enrolled') AS credits
     ${from}${where} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map((r) => ({ id: r.id, status: r.status, confirmedAt: r.confirmed_at, studentPk: r.student_pk, studentId: r.code, fullName: r.full_name, semesterName: r.semester_name, courses: r.courses, credits: Number(r.credits) })), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/** Roster: enrollment.view, or the section's own teacher. */
async function roster(actor, sectionId) {
  const params = [sectionId]; let sql = `SELECT s.id, s.university_id, s.teacher_id, s.section_code, s.capacity, c.code, c.title FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [[sec]] = await pool.query(sql, params).then((r) => [[r[0][0]]]);
  if (!sec) throw AppError.notFound('Section not found');
  const perms = await permissionService.forUser(actor);
  if (!(perms.includes('*') || perms.includes('enrollment.view') || (actor.role === 'teacher' && sec.teacher_id === actor.id))) throw AppError.forbidden();
  const [rows] = await pool.query(
    `SELECT e.id, e.enrolled_at, s.id AS student_pk, s.student_id AS code, u.full_name FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
     WHERE e.section_id = ? AND e.status = 'enrolled' ORDER BY u.full_name`, [sectionId]);
  return { section: { id: sec.id, courseCode: sec.code, courseTitle: sec.title, sectionCode: sec.section_code, capacity: sec.capacity }, students: rows.map((r) => ({ enrollmentId: r.id, studentPk: r.student_pk, studentId: r.code, fullName: r.full_name, enrolledAt: r.enrolled_at })) };
}

// ---------- prior credits ------------------------------------------------------------------------------------
async function listPriorCredits(student) {
  const [rows] = await pool.query('SELECT pc.id, pc.source, pc.note, pc.created_at, c.id AS course_id, c.code, c.title, c.credit FROM prior_credits pc JOIN courses c ON c.id = pc.course_id WHERE pc.student_id = ? ORDER BY c.code', [student.id]);
  return rows.map((r) => ({ id: r.id, source: r.source, note: r.note, courseId: r.course_id, code: r.code, title: r.title, credit: Number(r.credit) }));
}
async function addPriorCredit(student, body, o) {
  const courseId = intId(body.courseId);
  const source = body.source;
  if (!['transfer', 'exemption', 'legacy'].includes(source)) throw AppError.validation('Choose the source of the credit.', { source: 'Choose transfer, exemption or legacy.' });
  if (body.note && String(body.note).length > 255) throw AppError.validation('Use at most 255 characters.', { note: 'Too long.' });
  const [c] = courseId ? await pool.query('SELECT id, code FROM courses WHERE id = ? AND university_id = ?', [courseId, student.university_id]) : [[]];
  if (!c[0]) throw AppError.validation('Choose a course from this university.', { courseId: 'Course not found.' });
  try {
    await pool.query('INSERT INTO prior_credits (university_id, student_id, course_id, source, note, created_by) VALUES (?, ?, ?, ?, ?, ?)', [student.university_id, student.id, courseId, source, body.note ? String(body.note).trim() : null, o.actor.id]);
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('This course is already recorded as completed.'); throw err; }
  await audit(o, 'prior_credit_added', student, { newValue: { course: c[0].code, source } });
  return listPriorCredits(student);
}
async function removePriorCredit(student, id, o) {
  const [rows] = await pool.query('SELECT pc.id, c.code FROM prior_credits pc JOIN courses c ON c.id = pc.course_id WHERE pc.id = ? AND pc.student_id = ?', [id, student.id]);
  if (!rows[0]) throw AppError.notFound('Prior credit not found');
  await pool.query('DELETE FROM prior_credits WHERE id = ?', [id]);
  await audit(o, 'prior_credit_removed', student, { oldValue: { course: rows[0].code } });
  return listPriorCredits(student);
}

module.exports = { studentByUser, studentById, overview, register, add, drop, cancel, history, listRegistrations, roster, listPriorCredits, addPriorCredit, removePriorCredit };
