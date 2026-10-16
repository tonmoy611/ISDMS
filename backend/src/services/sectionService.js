'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { resolveUniversity } = require('./structureService');
const sched = require('./scheduling');
const { writeAudit } = require('./audit');

const STATUSES = ['open', 'closed', 'cancelled'];
const SLOT_TYPES = ['lecture', 'lab', 'tutorial'];
const intId = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };
const blank = (x) => x === undefined || x === null || x === '';

const SEL = `SELECT s.*, c.code AS course_code, c.title AS course_title, c.credit AS course_credit, sem.name AS semester_name,
  u.full_name AS teacher_name, sh.name AS shift_name
  FROM sections s JOIN courses c ON c.id = s.course_id JOIN semesters sem ON sem.id = s.semester_id
  LEFT JOIN users u ON u.id = s.teacher_id LEFT JOIN shifts sh ON sh.id = s.shift_id`;

const dto = (r) => ({
  id: r.id, universityId: r.university_id, courseId: r.course_id, courseCode: r.course_code, courseTitle: r.course_title, credit: Number(r.course_credit),
  semesterId: r.semester_id, semesterName: r.semester_name, sectionCode: r.section_code, capacity: r.capacity,
  teacherId: r.teacher_id, teacherName: r.teacher_name, shiftId: r.shift_id, shiftName: r.shift_name, status: r.status, notes: r.notes,
});
const slotDto = (r) => ({ id: r.id, dayOfWeek: r.day_of_week, startTime: sched.hhmm(r.start_time), endTime: sched.hhmm(r.end_time), roomId: r.room_id, roomName: r.room_name || null, slotType: r.slot_type });

async function getRow(actor, id) {
  const params = [id]; let sql = `${SEL} WHERE s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(sql, params);
  if (!rows[0]) throw AppError.notFound('Section not found');
  return rows[0];
}

async function slotsOf(sectionId) {
  const [rows] = await pool.query('SELECT ss.*, r.name AS room_name, r.capacity AS room_capacity FROM section_slots ss LEFT JOIN rooms r ON r.id = ss.room_id WHERE ss.section_id = ? ORDER BY ss.day_of_week, ss.start_time', [sectionId]);
  return rows;
}

async function get(actor, id) {
  const row = await getRow(actor, id);
  return { section: dto(row), slots: (await slotsOf(id)).map(slotDto) };
}

async function list(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query, 200);
  const params = []; let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND s.university_id = ?'; params.push(uni); }
  for (const [k, col] of [['semesterId', 's.semester_id'], ['courseId', 's.course_id'], ['teacherId', 's.teacher_id']]) {
    if (query[k]) { where += ` AND ${col} = ?`; params.push(Number(query[k]) || 0); }
  }
  if (query.status && STATUSES.includes(query.status)) { where += ' AND s.status = ?'; params.push(query.status); }
  if (query.q) {
    const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`;
    where += ' AND (c.code LIKE ? OR c.title LIKE ? OR s.section_code LIKE ?)'; params.push(like, like, like);
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sections s JOIN courses c ON c.id = s.course_id${where}`, params);
  const [rows] = await pool.query(`${SEL}${where} ORDER BY s.semester_id DESC, c.code, s.section_code LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map(dto), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function teachers(actor, rawUni) {
  const uni = resolveUniversity(actor, rawUni, true);
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.login_id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.university_id = ? AND r.code = 'teacher' AND u.status = 'active' AND u.deleted_at IS NULL ORDER BY u.full_name`, [uni]);
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, loginId: r.login_id }));
}

async function teacherOk(uni, id) {
  const [r] = await pool.query(
    "SELECT u.id FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.id = ? AND u.university_id = ? AND ro.code = 'teacher' AND u.status = 'active' AND u.deleted_at IS NULL", [id, uni]);
  return !!r[0];
}

/** Other sections' slots in the same semester (cancelled sections do not block anything). */
async function semesterSlots(universityId, semesterId, excludeSectionId) {
  const [rows] = await pool.query(
    `SELECT ss.day_of_week, ss.start_time, ss.end_time, ss.room_id, s.teacher_id, CONCAT(c.code, ' section ', s.section_code) AS label
     FROM section_slots ss JOIN sections s ON s.id = ss.section_id JOIN courses c ON c.id = s.course_id
     WHERE s.university_id = ? AND s.semester_id = ? AND s.id <> ? AND s.status <> 'cancelled'`, [universityId, semesterId, excludeSectionId]);
  return rows.map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, roomId: r.room_id, teacherId: r.teacher_id, label: r.label }));
}

function dup(err) {
  if (err.code === 'ER_DUP_ENTRY') return AppError.conflict('This course already has a section with that code in this semester.', { sectionCode: 'Already in use.' });
  return err;
}

async function create(actor, body, ctx) {
  const b = body || {};
  const uni = resolveUniversity(actor, b.universityId, true);
  const errors = {};
  const courseId = intId(b.courseId); const semesterId = intId(b.semesterId);
  const sectionCode = String(b.sectionCode ?? '').trim().toUpperCase();
  const capacity = Number(b.capacity);
  const status = blank(b.status) ? 'open' : b.status;
  if (!courseId || !(await pool.query("SELECT id FROM courses WHERE id = ? AND university_id = ? AND status = 'active'", [courseId, uni]))[0][0]) errors.courseId = 'Choose an active course from this university.';
  if (!semesterId || !(await pool.query('SELECT id FROM semesters WHERE id = ? AND university_id = ?', [semesterId, uni]))[0][0]) errors.semesterId = 'Choose a semester from this university.';
  if (!/^[A-Z0-9]{1,10}$/.test(sectionCode)) errors.sectionCode = 'Use 1-10 letters or numbers, for example A.';
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) errors.capacity = 'Enter a whole number from 1 to 500.';
  if (!STATUSES.includes(status)) errors.status = 'Choose a valid status.';
  const teacherId = blank(b.teacherId) ? null : intId(b.teacherId);
  if (!blank(b.teacherId) && !(teacherId && (await teacherOk(uni, teacherId)))) errors.teacherId = 'Choose an active teacher from this university.';
  const shiftId = blank(b.shiftId) ? null : intId(b.shiftId);
  if (!blank(b.shiftId) && !(shiftId && (await pool.query("SELECT id FROM shifts WHERE id = ? AND university_id = ? AND status = 'active'", [shiftId, uni]))[0][0])) errors.shiftId = 'Choose an active shift from this university.';
  if (!blank(b.notes) && String(b.notes).length > 255) errors.notes = 'Use at most 255 characters.';
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  let id;
  try {
    const [r] = await pool.query(
      'INSERT INTO sections (university_id, course_id, semester_id, section_code, capacity, teacher_id, shift_id, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uni, courseId, semesterId, sectionCode, capacity, teacherId, shiftId, status, blank(b.notes) ? null : String(b.notes).trim()]);
    id = r.insertId;
  } catch (err) { throw dup(err); }
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'section_created', targetType: 'section', targetId: id, newValue: { courseId, semesterId, sectionCode, capacity, teacherId } });
  return get(actor, id);
}

async function update(actor, id, body, ctx) {
  const row = await getRow(actor, id);
  const b = body || {};
  const errors = {}; const set = {};
  if ('sectionCode' in b) { const c = String(b.sectionCode ?? '').trim().toUpperCase(); if (/^[A-Z0-9]{1,10}$/.test(c)) set.section_code = c; else errors.sectionCode = 'Use 1-10 letters or numbers.'; }
  if ('capacity' in b) { const n = Number(b.capacity); if (Number.isInteger(n) && n >= 1 && n <= 500) set.capacity = n; else errors.capacity = 'Enter a whole number from 1 to 500.'; }
  if ('status' in b) { if (STATUSES.includes(b.status)) set.status = b.status; else errors.status = 'Choose a valid status.'; }
  if ('notes' in b) { if (!blank(b.notes) && String(b.notes).length > 255) errors.notes = 'Use at most 255 characters.'; else set.notes = blank(b.notes) ? null : String(b.notes).trim(); }
  if ('shiftId' in b) {
    const sid = blank(b.shiftId) ? null : intId(b.shiftId);
    if (sid === null && !blank(b.shiftId)) errors.shiftId = 'Choose a valid shift.';
    else if (sid && !(await pool.query("SELECT id FROM shifts WHERE id = ? AND university_id = ? AND status = 'active'", [sid, row.university_id]))[0][0]) errors.shiftId = 'Choose an active shift from this university.';
    else set.shift_id = sid;
  }
  if ('teacherId' in b) {
    const tid = blank(b.teacherId) ? null : intId(b.teacherId);
    if (tid === null && !blank(b.teacherId)) errors.teacherId = 'Choose a valid teacher.';
    else if (tid && !(await teacherOk(row.university_id, tid))) errors.teacherId = 'Choose an active teacher from this university.';
    else set.teacher_id = tid;
  }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);

  const newStatus = set.status ?? row.status;
  if (set.teacher_id && set.teacher_id !== row.teacher_id && newStatus !== 'cancelled') {
    const mine = (await slotsOf(id)).map((s) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, roomId: s.room_id }));
    const clashes = sched.findConflicts(mine, await semesterSlots(row.university_id, row.semester_id, id), set.teacher_id, { checkRooms: false });
    if (clashes.length) throw AppError.conflict('That teacher is already teaching at one of this section\'s times.', { conflicts: clashes.map((c) => c.message) });
  }
  if (!Object.keys(set).length) return get(actor, id);
  try { await pool.query('UPDATE sections SET ? WHERE id = ?', [set, id]); } catch (err) { throw dup(err); }
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'section_updated', targetType: 'section', targetId: id,
    oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, row[k]])), newValue: set });
  return get(actor, id);
}

async function remove(actor, id, ctx) {
  const row = await getRow(actor, id);
  try { await pool.query('DELETE FROM sections WHERE id = ?', [id]); } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') throw AppError.conflict('This section has records attached to it. Set it to cancelled instead of deleting it.');
    throw err;
  }
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'section_deleted', targetType: 'section', targetId: id, oldValue: dto(row) });
}

async function setSlots(actor, id, raw, ctx) {
  const row = await getRow(actor, id);
  if (!Array.isArray(raw) || raw.length > 20) throw AppError.validation('slots must be a list of at most 20 entries.');
  const problems = [];
  const slots = raw.map((x, i) => {
    const s = { dayOfWeek: Number(x?.dayOfWeek), startTime: String(x?.startTime ?? ''), endTime: String(x?.endTime ?? ''), roomId: blank(x?.roomId) ? null : intId(x?.roomId), slotType: x?.slotType || 'lecture' };
    const p = sched.slotProblem(s);
    if (p) problems.push(`Slot ${i + 1}: ${p}`);
    if (!SLOT_TYPES.includes(s.slotType)) problems.push(`Slot ${i + 1}: choose lecture, lab or tutorial.`);
    if (!blank(x?.roomId) && !s.roomId) problems.push(`Slot ${i + 1}: choose a valid room.`);
    return s;
  });
  if (!problems.length) problems.push(...sched.selfOverlaps(slots));
  if (problems.length) throw AppError.validation('Please fix the schedule.', { slots: problems });

  const roomIds = [...new Set(slots.map((s) => s.roomId).filter(Boolean))];
  let rooms = [];
  if (roomIds.length) {
    [rooms] = await pool.query("SELECT id, name, capacity FROM rooms WHERE id IN (?) AND university_id = ? AND status = 'active'", [roomIds, row.university_id]);
    if (rooms.length !== roomIds.length) throw AppError.validation('One or more rooms do not exist or are inactive.', { slots: ['Choose active rooms from this university.'] });
  }
  if (row.status !== 'cancelled') {
    const clashes = sched.findConflicts(slots, await semesterSlots(row.university_id, row.semester_id, id), row.teacher_id);
    if (clashes.length) throw AppError.conflict('This schedule clashes with another section.', { conflicts: clashes.map((c) => `Slot ${c.slot}: ${c.message}`) });
  }
  const warnings = rooms.filter((r) => r.capacity < row.capacity).map((r) => `${r.name} seats ${r.capacity}, fewer than this section's capacity of ${row.capacity}.`);

  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM section_slots WHERE section_id = ?', [id]);
    if (slots.length) await conn.query('INSERT INTO section_slots (section_id, day_of_week, start_time, end_time, room_id, slot_type) VALUES ?',
      [slots.map((s) => [id, s.dayOfWeek, s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime, s.endTime.length === 5 ? `${s.endTime}:00` : s.endTime, s.roomId, s.slotType])]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'section_schedule_changed', targetType: 'section', targetId: id, newValue: { slots: slots.length } });
  return { ...(await get(actor, id)), warnings };
}

async function timetable(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, true);
  const semesterId = intId(query.semesterId);
  if (!semesterId) throw AppError.validation('Choose a semester.', { semesterId: 'Choose a semester.' });
  const params = [uni, semesterId]; let where = "WHERE s.university_id = ? AND s.semester_id = ? AND s.status <> 'cancelled'";
  if (query.teacherId) { where += ' AND s.teacher_id = ?'; params.push(Number(query.teacherId) || 0); }
  if (query.roomId) { where += ' AND ss.room_id = ?'; params.push(Number(query.roomId) || 0); }
  const [rows] = await pool.query(
    `SELECT ss.*, s.id AS section_id, s.section_code, c.code AS course_code, c.title AS course_title, u.full_name AS teacher_name, r.name AS room_name
     FROM section_slots ss JOIN sections s ON s.id = ss.section_id JOIN courses c ON c.id = s.course_id
     LEFT JOIN users u ON u.id = s.teacher_id LEFT JOIN rooms r ON r.id = ss.room_id ${where} ORDER BY ss.day_of_week, ss.start_time, c.code`, params);
  return rows.map((r) => ({ ...slotDto(r), sectionId: r.section_id, sectionCode: r.section_code, courseCode: r.course_code, courseTitle: r.course_title, teacherName: r.teacher_name }));
}

async function teaching(actor, query) {
  const params = [actor.id]; let where = 'WHERE s.teacher_id = ?';
  if (query.semesterId) { where += ' AND s.semester_id = ?'; params.push(Number(query.semesterId) || 0); }
  const [rows] = await pool.query(`${SEL} ${where} ORDER BY s.semester_id DESC, c.code`, params);
  const out = [];
  for (const r of rows) out.push({ section: dto(r), slots: (await slotsOf(r.id)).map(slotDto) });
  return out;
}

module.exports = { list, get, create, update, remove, setSlots, timetable, teachers, teaching };
