'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const rules = require('./resultRules');
const permissionService = require('./permissionService');
const enrollment = require('./enrollmentService');
const { resolveUniversity } = require('./structureService');
const { writeAudit } = require('./audit');

const first = (r) => r[0][0];
const num = (x) => (x == null ? null : Number(x));
const blank = (x) => x === undefined || x === null || x === '';
const parseChanges = (x) => (typeof x === 'string' ? JSON.parse(x) : x);
const rejected = (message, details) => new AppError(422, 'RESULT_REJECTED', message, details);

// ---------- access -------------------------------------------------------------------------------------------
/** A section's own teacher may enter marks and request corrections; results.manage may do so for any section. */
async function sectionCtx(actor, sectionId, conn = pool) {
  const params = [sectionId];
  let sql = `SELECT s.id, s.university_id, s.semester_id, s.course_id, s.teacher_id, s.section_code, s.status, c.code AS course_code, c.title AS course_title, c.credit,
      sem.name AS semester_name FROM sections s JOIN courses c ON c.id = s.course_id JOIN semesters sem ON sem.id = s.semester_id WHERE s.id = ?`;
  if (actor.university_id != null) { sql += ' AND s.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const section = first(await conn.query(sql, params));
  if (!section) throw AppError.notFound('Section not found');
  const perms = await permissionService.forUser(actor);
  const has = (p) => perms.includes('*') || perms.includes(p);
  const owner = actor.role === 'teacher' && section.teacher_id === actor.id;
  const manage = has('results.manage');
  return { section, owner, manage, canEdit: manage || owner, canView: manage || owner || has('results.view'), canPublish: has('results.publish'), has };
}
const need = (ok, msg) => { if (!ok) throw AppError.forbidden(msg); };

async function ensureBatch(conn, section, { lock = false } = {}) {
  await conn.query('INSERT IGNORE INTO result_batches (university_id, section_id) VALUES (?, ?)', [section.university_id, section.id]);
  return first(await conn.query(`SELECT * FROM result_batches WHERE section_id = ?${lock ? ' FOR UPDATE' : ''}`, [section.id]));
}

async function loadScale(conn, universityId) {
  const [rows] = await conn.query('SELECT letter, min_percent, grade_point, is_pass FROM grade_scale_entries WHERE university_id = ? ORDER BY min_percent DESC', [universityId]);
  return rows.map((r) => ({ letter: r.letter, minPercent: Number(r.min_percent), gradePoint: Number(r.grade_point), isPass: !!r.is_pass }));
}

async function componentsOf(conn, sectionId) {
  const [rows] = await conn.query('SELECT id, name, max_marks, sort_order FROM assessment_components WHERE section_id = ? ORDER BY sort_order, id', [sectionId]);
  return rows.map((r) => ({ id: r.id, name: r.name, maxMarks: Number(r.max_marks) }));
}
async function rosterOf(conn, sectionId) {
  const [rows] = await conn.query(
    `SELECT e.id AS enrollment_id, e.student_id, e.credit, st.student_id AS code, u.full_name FROM enrollments e JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
     WHERE e.section_id = ? AND e.status = 'enrolled' ORDER BY st.student_id`, [sectionId]);
  return rows;
}
async function marksOf(conn, componentIds) {
  const map = new Map(); // enrollmentId -> Map(componentId -> number)
  if (!componentIds.length) return map;
  const [rows] = await conn.query('SELECT component_id, enrollment_id, marks FROM marks WHERE component_id IN (?)', [componentIds]);
  rows.forEach((m) => { if (!map.has(m.enrollment_id)) map.set(m.enrollment_id, new Map()); map.get(m.enrollment_id).set(m.component_id, Number(m.marks)); });
  return map;
}

const batchDto = (b) => ({ status: b.status, submittedAt: b.submitted_at, publishedAt: b.published_at });
const resultDto = (r) => (r ? { id: r.id, totalMarks: num(r.total_marks), maxMarks: num(r.max_marks), percentage: num(r.percentage), letterGrade: r.letter_grade, gradePoint: num(r.grade_point), isPass: !!r.is_pass } : null);

// ---------- the marks sheet ----------------------------------------------------------------------------------
async function getSheet(actor, sectionId) {
  const c = await sectionCtx(actor, sectionId); need(c.canView);
  const batch = await ensureBatch(pool, c.section);
  const [components, roster, scale] = await Promise.all([componentsOf(pool, sectionId), rosterOf(pool, sectionId), loadScale(pool, c.section.university_id)]);
  const marks = await marksOf(pool, components.map((x) => x.id));
  const [results] = await pool.query('SELECT * FROM results WHERE section_id = ?', [sectionId]);
  const byEnrollment = new Map(results.map((r) => [r.enrollment_id, r]));
  const [pending] = await pool.query("SELECT rc.result_id FROM result_corrections rc JOIN results r ON r.id = rc.result_id WHERE r.section_id = ? AND rc.status = 'pending'", [sectionId]);
  const pendingSet = new Set(pending.map((p) => p.result_id));

  const students = roster.map((s) => {
    const m = marks.get(s.enrollment_id) || new Map();
    const t = rules.computeTotals(components, m);
    const g = scale.length && t.complete ? rules.gradeFor(t.percentage, scale) : null;
    const saved = byEnrollment.get(s.enrollment_id);
    return {
      enrollmentId: s.enrollment_id, studentId: s.student_id, studentCode: s.code, fullName: s.full_name,
      marks: Object.fromEntries([...m.entries()]), complete: t.complete, total: t.total, percentage: t.percentage,
      letterGrade: g?.letter ?? null, gradePoint: g?.gradePoint ?? null, result: batch.status === 'draft' ? null : resultDto(saved), pendingCorrection: saved ? pendingSet.has(saved.id) : false,
    };
  });
  const draft = batch.status === 'draft';
  return {
    section: { id: c.section.id, courseCode: c.section.course_code, courseTitle: c.section.course_title, sectionCode: c.section.section_code, semesterName: c.section.semester_name, credit: Number(c.section.credit) },
    batch: batchDto(batch), components, students, scaleMissing: scale.length === 0,
    can: { edit: c.canEdit && draft, submit: c.canEdit && draft, reopen: c.manage && batch.status === 'submitted', publish: c.canPublish && batch.status === 'submitted', requestCorrection: c.canEdit && batch.status === 'published' },
  };
}

async function setComponents(actor, sectionId, raw, ctx) {
  const c = await sectionCtx(actor, sectionId); need(c.canEdit);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) throw AppError.validation('Add between 1 and 10 assessment parts.', { components: ['Add between 1 and 10 assessment parts.'] });
  const problems = []; const names = new Set();
  const list = raw.map((x, i) => {
    const name = String(x?.name ?? '').trim(); const max = Number(x?.maxMarks);
    if (!name || name.length > 60) problems.push(`Part ${i + 1}: enter a name of up to 60 characters.`);
    if (names.has(name.toLowerCase())) problems.push(`Part ${i + 1}: the name "${name}" is used twice.`); names.add(name.toLowerCase());
    if (!Number.isFinite(max) || max <= 0 || max > 1000 || Math.round(max * 100) !== max * 100) problems.push(`Part ${i + 1}: maximum marks must be above 0, at most 1000, with up to 2 decimals.`);
    return { id: blank(x?.id) ? null : Number(x.id), name, max, order: i };
  });
  if (problems.length) throw AppError.validation('Please fix the assessment parts.', { components: problems });

  const before = await withTransaction(async (conn) => {
    const batch = await ensureBatch(conn, c.section, { lock: true });
    if (batch.status !== 'draft') throw AppError.conflict('Marks are locked. Ask the office to reopen the results first.');
    const [existing] = await conn.query('SELECT id, name FROM assessment_components WHERE section_id = ? FOR UPDATE', [sectionId]);
    const existingIds = new Set(existing.map((e) => e.id));
    if (list.some((x) => x.id && !existingIds.has(x.id))) throw AppError.validation('One of the assessment parts no longer exists. Reload the page.');
    const keep = new Set(list.filter((x) => x.id).map((x) => x.id));
    const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length) await conn.query('DELETE FROM assessment_components WHERE id IN (?)', [drop]); // marks go with them
    for (const x of list.filter((y) => y.id)) {
      const [[over]] = await conn.query('SELECT MAX(marks) AS m FROM marks WHERE component_id = ?', [x.id]).then((r) => [[r[0][0]]]);
      if (over.m != null && Number(over.m) > x.max) throw AppError.validation(`${x.name}: marks above ${x.max} are already entered.`, { components: [`${x.name}: marks above ${x.max} are already entered.`] });
      await conn.query('UPDATE assessment_components SET name = ?, max_marks = ?, sort_order = ? WHERE id = ?', [x.name, x.max, x.order, x.id]);
    }
    const fresh = list.filter((x) => !x.id);
    if (fresh.length) await conn.query('INSERT INTO assessment_components (university_id, section_id, name, max_marks, sort_order) VALUES ?', [fresh.map((x) => [c.section.university_id, sectionId, x.name, x.max, x.order])]);
    return { names: existing.map((e) => e.name), removed: drop.length };
  }).catch((err) => { if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('Two assessment parts have the same name.'); throw err; });
  await writeAudit({ ctx, userId: actor.id, universityId: c.section.university_id, action: 'result_components_changed', targetType: 'section', targetId: sectionId, oldValue: { components: before.names }, newValue: { components: list.map((x) => `${x.name} (${x.max})`), removed: before.removed } });
  return getSheet(actor, sectionId);
}

async function saveMarks(actor, sectionId, raw, ctx) {
  const c = await sectionCtx(actor, sectionId); need(c.canEdit);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5000) throw AppError.validation('Send between 1 and 5000 mark entries.');
  const stats = await withTransaction(async (conn) => {
    const batch = await ensureBatch(conn, c.section, { lock: true });
    if (batch.status !== 'draft') throw AppError.conflict('Marks are locked. Ask the office to reopen the results first.');
    const comps = new Map((await componentsOf(conn, sectionId)).map((x) => [x.id, x]));
    const enrolled = new Set((await rosterOf(conn, sectionId)).map((r) => r.enrollment_id));
    const problems = []; const upserts = []; const clears = [];
    raw.forEach((e, i) => {
      const comp = comps.get(Number(e?.componentId)); const enrollmentId = Number(e?.enrollmentId);
      if (!comp) { problems.push(`Entry ${i + 1}: unknown assessment part.`); return; }
      if (!enrolled.has(enrollmentId)) { problems.push(`Entry ${i + 1}: the student is not enrolled in this section.`); return; }
      const p = rules.parseMark(e.marks, comp.maxMarks);
      if (p.error) problems.push(`Entry ${i + 1} (${comp.name}): ${p.error}`);
      else if (p.value === null) clears.push([comp.id, enrollmentId]);
      else upserts.push([comp.id, enrollmentId, p.value, actor.id]);
    });
    if (problems.length) throw AppError.validation('Please fix the marks.', { marks: problems.slice(0, 30) });
    if (upserts.length) await conn.query('INSERT INTO marks (component_id, enrollment_id, marks, entered_by) VALUES ? ON DUPLICATE KEY UPDATE marks = VALUES(marks), entered_by = VALUES(entered_by)', [upserts]);
    if (clears.length) await conn.query('DELETE FROM marks WHERE (component_id, enrollment_id) IN (?)', [clears]);
    return { entered: upserts.length, cleared: clears.length };
  });
  await writeAudit({ ctx, userId: actor.id, universityId: c.section.university_id, action: 'marks_saved', targetType: 'section', targetId: sectionId, newValue: stats });
  return getSheet(actor, sectionId);
}

async function submit(actor, sectionId, ctx) {
  const c = await sectionCtx(actor, sectionId); need(c.canEdit);
  const count = await withTransaction(async (conn) => {
    const batch = await ensureBatch(conn, c.section, { lock: true });
    if (batch.status !== 'draft') throw AppError.conflict('These results were already submitted.');
    const scale = await loadScale(conn, c.section.university_id);
    if (!scale.length) throw rejected('The grading scale has not been set up yet. Ask the office to set it before submitting.');
    const comps = await componentsOf(conn, sectionId);
    if (!comps.length) throw rejected('Add the assessment parts and enter marks first.');
    const roster = await rosterOf(conn, sectionId);
    if (!roster.length) throw rejected('Nobody is enrolled in this section.');
    const marks = await marksOf(conn, comps.map((x) => x.id));
    const missing = []; const rows = [];
    for (const s of roster) {
      const m = marks.get(s.enrollment_id) || new Map();
      const t = rules.computeTotals(comps, m);
      if (!t.complete) { missing.push(`${s.code} ${s.full_name}: missing ${comps.filter((x) => !m.has(x.id)).map((x) => x.name).join(', ')}`); continue; }
      const g = rules.gradeFor(t.percentage, scale);
      rows.push([c.section.university_id, batch.id, sectionId, s.enrollment_id, s.student_id, c.section.semester_id, c.section.course_id, Number(c.section.credit), t.total, t.max, t.percentage, g.letter, g.gradePoint, g.isPass ? 1 : 0]);
    }
    if (missing.length) throw rejected(`Marks are missing for ${missing.length} student(s).`, { missing: missing.slice(0, 30) });
    await conn.query(
      `INSERT INTO results (university_id, batch_id, section_id, enrollment_id, student_id, semester_id, course_id, credit, total_marks, max_marks, percentage, letter_grade, grade_point, is_pass) VALUES ?
       ON DUPLICATE KEY UPDATE batch_id = VALUES(batch_id), credit = VALUES(credit), total_marks = VALUES(total_marks), max_marks = VALUES(max_marks), percentage = VALUES(percentage),
         letter_grade = VALUES(letter_grade), grade_point = VALUES(grade_point), is_pass = VALUES(is_pass)`, [rows]);
    await conn.query("UPDATE result_batches SET status = 'submitted', submitted_by = ?, submitted_at = NOW() WHERE id = ?", [actor.id, batch.id]);
    return rows.length;
  });
  await writeAudit({ ctx, userId: actor.id, universityId: c.section.university_id, action: 'results_submitted', targetType: 'section', targetId: sectionId, newValue: { students: count } });
  return getSheet(actor, sectionId);
}

async function reopen(actor, sectionId, ctx) {
  const c = await sectionCtx(actor, sectionId); need(c.manage, 'Only the results office can reopen submitted results.');
  await withTransaction(async (conn) => {
    const batch = await ensureBatch(conn, c.section, { lock: true });
    if (batch.status !== 'submitted') throw AppError.conflict(batch.status === 'published' ? 'Published results cannot be reopened. Use a correction.' : 'These results are not submitted.');
    await conn.query('DELETE FROM results WHERE batch_id = ?', [batch.id]);
    await conn.query("UPDATE result_batches SET status = 'draft', submitted_by = NULL, submitted_at = NULL WHERE id = ?", [batch.id]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: c.section.university_id, action: 'results_reopened', targetType: 'section', targetId: sectionId });
  return getSheet(actor, sectionId);
}

async function publish(actor, sectionId, ctx) {
  const c = await sectionCtx(actor, sectionId); need(c.canPublish, 'You may not publish results.');
  const count = await withTransaction(async (conn) => {
    const batch = await ensureBatch(conn, c.section, { lock: true });
    if (batch.status !== 'submitted') throw AppError.conflict('Only submitted results can be published.');
    if (batch.submitted_by === actor.id) throw AppError.forbidden('A different person must publish results you submitted.');
    const [h] = await conn.query(
      `INSERT INTO result_history (result_id, version, total_marks, max_marks, percentage, letter_grade, grade_point, is_pass, reason, changed_by)
       SELECT r.id, 1, r.total_marks, r.max_marks, r.percentage, r.letter_grade, r.grade_point, r.is_pass, 'Published', ? FROM results r JOIN enrollments e ON e.id = r.enrollment_id
       WHERE r.batch_id = ? AND e.status = 'enrolled'`, [actor.id, batch.id]);
    // The prerequisite check reads enrollments.outcome, so publication is what unlocks follow-on courses.
    await conn.query("UPDATE enrollments e JOIN results r ON r.enrollment_id = e.id SET e.outcome = IF(r.is_pass = 1, 'passed', 'failed') WHERE r.batch_id = ? AND e.status = 'enrolled'", [batch.id]);
    await conn.query("UPDATE result_batches SET status = 'published', published_by = ?, published_at = NOW() WHERE id = ?", [actor.id, batch.id]);
    return h.affectedRows;
  });
  await writeAudit({ ctx, userId: actor.id, universityId: c.section.university_id, action: 'results_published', targetType: 'section', targetId: sectionId, newValue: { students: count } });
  return getSheet(actor, sectionId);
}

// ---------- corrections --------------------------------------------------------------------------------------
async function resultRow(actor, resultId) {
  const r = first(await pool.query('SELECT r.*, b.status AS batch_status FROM results r JOIN result_batches b ON b.id = r.batch_id WHERE r.id = ?', [resultId]));
  if (!r) throw AppError.notFound('Result not found');
  const c = await sectionCtx(actor, r.section_id); // also enforces tenant scope
  return { r, c };
}

async function requestCorrection(actor, resultId, body, ctx) {
  const { r, c } = await resultRow(actor, resultId); need(c.canEdit);
  if (r.batch_status !== 'published') throw AppError.conflict('Only published results need a correction request. Edit the marks directly while results are still in draft.');
  const b = body || {};
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 10 || reason.length > 500) throw AppError.validation('Explain the reason in 10 to 500 characters.', { reason: 'Explain the reason in 10 to 500 characters.' });
  if (!Array.isArray(b.changes) || !b.changes.length || b.changes.length > 10) throw AppError.validation('Choose the marks to change.', { changes: ['Choose the marks to change.'] });
  const comps = new Map((await componentsOf(pool, r.section_id)).map((x) => [x.id, x]));
  const current = (await marksOf(pool, [...comps.keys()])).get(r.enrollment_id) || new Map();
  const problems = []; const changes = [];
  b.changes.forEach((x, i) => {
    const comp = comps.get(Number(x?.componentId));
    if (!comp) { problems.push(`Change ${i + 1}: unknown assessment part.`); return; }
    const p = rules.parseMark(x.marks, comp.maxMarks);
    if (p.error || p.value === null) { problems.push(`Change ${i + 1} (${comp.name}): ${p.error || 'enter the new marks.'}`); return; }
    if (current.get(comp.id) === p.value) return;
    changes.push({ componentId: comp.id, oldMarks: current.get(comp.id) ?? null, newMarks: p.value });
  });
  if (problems.length) throw AppError.validation('Please fix the corrections.', { changes: problems });
  if (!changes.length) throw AppError.validation('None of the marks are different from the published ones.', { changes: ['None of the marks are different from the published ones.'] });
  let id;
  try {
    const [ins] = await pool.query('INSERT INTO result_corrections (university_id, result_id, requested_by, reason, changes) VALUES (?, ?, ?, ?, ?)', [r.university_id, resultId, actor.id, reason, JSON.stringify(changes)]);
    id = ins.insertId;
  } catch (err) { if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('There is already a pending correction for this result.'); throw err; }
  await writeAudit({ ctx, userId: actor.id, universityId: r.university_id, action: 'result_correction_requested', targetType: 'result', targetId: resultId, newValue: { correctionId: id, changes, reason } });
  return { id };
}

async function listCorrections(actor, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const status = ['pending', 'approved', 'rejected'].includes(query.status) ? query.status : 'pending';
  const { page, pageSize, offset } = v.parsePage(query, 50);
  const params = [status]; let where = 'rc.status = ?';
  if (uni) { where += ' AND rc.university_id = ?'; params.push(uni); }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM result_corrections rc WHERE ${where}`, params).then((x) => [[x[0][0]]]);
  const [rows] = await pool.query(
    `SELECT rc.*, r.section_id, r.enrollment_id, r.letter_grade, r.percentage, r.grade_point, st.student_id AS code, u.full_name, c.code AS course_code, s.section_code, rq.full_name AS requester
     FROM result_corrections rc JOIN results r ON r.id = rc.result_id JOIN students st ON st.id = r.student_id JOIN users u ON u.id = st.user_id
     JOIN courses c ON c.id = r.course_id JOIN sections s ON s.id = r.section_id JOIN users rq ON rq.id = rc.requested_by
     WHERE ${where} ORDER BY rc.created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  const scales = new Map(); const items = [];
  for (const x of rows) {
    if (!scales.has(x.university_id)) scales.set(x.university_id, await loadScale(pool, x.university_id));
    const comps = await componentsOf(pool, x.section_id);
    const cur = new Map((await marksOf(pool, comps.map((k) => k.id))).get(x.enrollment_id) || []);
    const raw = parseChanges(x.changes);
    const changes = raw.map((ch) => ({ ...ch, componentName: comps.find((k) => k.id === ch.componentId)?.name || `#${ch.componentId}` }));
    const next = new Map(cur); raw.forEach((ch) => next.set(ch.componentId, ch.newMarks));
    const t = rules.computeTotals(comps, next); const g = scales.get(x.university_id).length ? rules.gradeFor(t.percentage, scales.get(x.university_id)) : null;
    items.push({
      id: x.id, status: x.status, reason: x.reason, requestedBy: x.requester, requestedById: x.requested_by, createdAt: x.created_at, reviewNote: x.review_note,
      student: { code: x.code, fullName: x.full_name }, course: `${x.course_code} section ${x.section_code}`, changes,
      current: { letterGrade: x.letter_grade, percentage: Number(x.percentage), gradePoint: Number(x.grade_point) },
      proposed: t.complete ? { letterGrade: g?.letter ?? null, percentage: t.percentage, gradePoint: g?.gradePoint ?? null } : null,
    });
  }
  return { items, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function decide(actor, id, approve, note, ctx) {
  const out = await withTransaction(async (conn) => {
    const corr = first(await conn.query('SELECT * FROM result_corrections WHERE id = ? FOR UPDATE', [id]));
    if (!corr || (actor.university_id != null && corr.university_id !== actor.university_id)) throw AppError.notFound('Correction not found');
    if (actor.university_id == null && actor.role !== 'super_admin') throw AppError.forbidden();
    if (corr.status !== 'pending') throw AppError.conflict('This correction was already reviewed.');
    if (corr.requested_by === actor.id) throw AppError.forbidden('A different person must review this correction.');
    const reviewNote = blank(note) ? null : String(note).trim().slice(0, 500);
    if (!approve) {
      await conn.query("UPDATE result_corrections SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?", [actor.id, reviewNote, id]);
      return { resultId: corr.result_id, approved: false };
    }
    const changes = parseChanges(corr.changes);
    const res = first(await conn.query('SELECT * FROM results WHERE id = ? FOR UPDATE', [corr.result_id]));
    const comps = await componentsOf(conn, res.section_id);
    const marks = (await marksOf(conn, comps.map((k) => k.id))).get(res.enrollment_id) || new Map();
    for (const ch of changes) {
      if ((marks.get(ch.componentId) ?? null) !== ch.oldMarks) throw AppError.conflict('The marks changed after this correction was requested. Reject it and ask for a new one.');
    }
    changes.forEach((ch) => marks.set(ch.componentId, ch.newMarks));
    const scale = await loadScale(conn, res.university_id);
    if (!scale.length) throw rejected('The grading scale is missing.');
    const t = rules.computeTotals(comps, marks);
    if (!t.complete) throw rejected('The corrected marks are incomplete.');
    const g = rules.gradeFor(t.percentage, scale);
    await conn.query('INSERT INTO marks (component_id, enrollment_id, marks, entered_by) VALUES ? ON DUPLICATE KEY UPDATE marks = VALUES(marks), entered_by = VALUES(entered_by)', [changes.map((ch) => [ch.componentId, res.enrollment_id, ch.newMarks, corr.requested_by])]);
    await conn.query('UPDATE results SET total_marks = ?, max_marks = ?, percentage = ?, letter_grade = ?, grade_point = ?, is_pass = ? WHERE id = ?', [t.total, t.max, t.percentage, g.letter, g.gradePoint, g.isPass ? 1 : 0, res.id]);
    const ver = first(await conn.query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM result_history WHERE result_id = ?', [res.id])).v;
    await conn.query('INSERT INTO result_history (result_id, version, total_marks, max_marks, percentage, letter_grade, grade_point, is_pass, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [res.id, ver, t.total, t.max, t.percentage, g.letter, g.gradePoint, g.isPass ? 1 : 0, `Correction: ${corr.reason}`.slice(0, 500), actor.id]);
    await conn.query("UPDATE enrollments SET outcome = ? WHERE id = ? AND status = 'enrolled'", [g.isPass ? 'passed' : 'failed', res.enrollment_id]);
    await conn.query("UPDATE result_corrections SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?", [actor.id, reviewNote, id]);
    return { resultId: res.id, approved: true, version: ver, before: { letter: res.letter_grade, percentage: Number(res.percentage), gradePoint: Number(res.grade_point) }, after: { letter: g.letter, percentage: t.percentage, gradePoint: g.gradePoint } };
  });
  await writeAudit({ ctx, userId: actor.id, universityId: actor.university_id, action: out.approved ? 'result_correction_approved' : 'result_correction_rejected', targetType: 'result', targetId: out.resultId,
    ...(out.approved ? { oldValue: out.before, newValue: { ...out.after, version: out.version } } : { newValue: { correctionId: id } }) });
  return { approved: out.approved };
}

async function history(actor, resultId) {
  const { r, c } = await resultRow(actor, resultId); need(c.canView);
  const [rows] = await pool.query('SELECT h.*, u.full_name AS by_name FROM result_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.result_id = ? ORDER BY h.version DESC', [resultId]);
  return { resultId: r.id, versions: rows.map((h) => ({ version: h.version, totalMarks: num(h.total_marks), maxMarks: num(h.max_marks), percentage: num(h.percentage), letterGrade: h.letter_grade, gradePoint: num(h.grade_point), isPass: !!h.is_pass, reason: h.reason, changedBy: h.by_name, at: h.created_at })) };
}

// ---------- lists, scale, student view -----------------------------------------------------------------------
async function listSections(actor, query) {
  const perms = await permissionService.forUser(actor);
  const canAll = perms.includes('*') || perms.includes('results.view') || perms.includes('results.manage');
  if (!canAll && actor.role !== 'teacher') throw AppError.forbidden();
  const { page, pageSize, offset } = v.parsePage(query);
  const params = []; let where = "WHERE s.status <> 'cancelled'";
  if (actor.role === 'teacher' && !canAll) { where += ' AND s.teacher_id = ?'; params.push(actor.id); }
  const uni = resolveUniversity(actor, query.universityId, false);
  if (uni) { where += ' AND s.university_id = ?'; params.push(uni); }
  if (query.semesterId) { where += ' AND s.semester_id = ?'; params.push(Number(query.semesterId) || 0); }
  if (['draft', 'submitted', 'published'].includes(query.status)) { where += " AND COALESCE(b.status, 'draft') = ?"; params.push(query.status); }
  if (query.q) { const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`; where += ' AND (c.code LIKE ? OR c.title LIKE ?)'; params.push(like, like); }
  const from = 'FROM sections s JOIN courses c ON c.id = s.course_id JOIN semesters sem ON sem.id = s.semester_id LEFT JOIN users u ON u.id = s.teacher_id LEFT JOIN result_batches b ON b.section_id = s.id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${where}`, params).then((x) => [[x[0][0]]]);
  const [rows] = await pool.query(
    `SELECT s.id, c.code, c.title, s.section_code, sem.name AS semester_name, u.full_name AS teacher_name, COALESCE(b.status, 'draft') AS batch_status,
       (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = s.id AND e.status = 'enrolled') AS enrolled
     ${from} ${where} ORDER BY s.semester_id DESC, c.code, s.section_code LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map((r) => ({ id: r.id, courseCode: r.code, courseTitle: r.title, sectionCode: r.section_code, semesterName: r.semester_name, teacherName: r.teacher_name, status: r.batch_status, enrolled: r.enrolled })), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function getScale(actor, rawUni) {
  const uni = resolveUniversity(actor, rawUni, true);
  return { entries: await loadScale(pool, uni) };
}
async function setScale(actor, body, ctx) {
  const uni = resolveUniversity(actor, body?.universityId, true);
  const entries = (body?.entries || []).map((e) => ({ letter: String(e?.letter ?? '').trim(), minPercent: Number(e?.minPercent), gradePoint: Number(e?.gradePoint), isPass: e?.isPass === true || e?.isPass === 1 }));
  const problems = rules.scaleProblems(entries);
  if (problems.length) throw AppError.validation('The grading scale has problems.', { entries: problems });
  const before = await loadScale(pool, uni);
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM grade_scale_entries WHERE university_id = ?', [uni]);
    await conn.query('INSERT INTO grade_scale_entries (university_id, letter, min_percent, grade_point, is_pass) VALUES ?', [entries.map((e) => [uni, e.letter, e.minPercent, e.gradePoint, e.isPass ? 1 : 0])]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'grade_scale_changed', oldValue: { entries: before }, newValue: { entries } });
  return getScale(actor, uni);
}
async function useDefaultScale(actor, body, ctx) {
  const uni = resolveUniversity(actor, body?.universityId, true);
  if ((await loadScale(pool, uni)).length) throw AppError.conflict('A grading scale already exists. Edit it instead.');
  return setScale(actor, { universityId: uni, entries: rules.UGC_DEFAULT_SCALE }, ctx);
}

async function studentResults(student) {
  const [rows] = await pool.query(
    `SELECT r.*, c.code, c.title, sem.name AS semester_name, sem.start_date, s.section_code
     FROM results r JOIN result_batches b ON b.id = r.batch_id AND b.status = 'published' JOIN enrollments e ON e.id = r.enrollment_id AND e.status = 'enrolled'
     JOIN courses c ON c.id = r.course_id JOIN semesters sem ON sem.id = r.semester_id JOIN sections s ON s.id = r.section_id
     WHERE r.student_id = ? ORDER BY sem.start_date, c.code`, [student.id]);
  const dates = [...new Set(rows.map((r) => String(r.start_date)))].sort();
  const flat = rows.map((r) => ({
    semesterId: r.semester_id, semesterName: r.semester_name, semesterOrder: dates.indexOf(String(r.start_date)), courseId: r.course_id, courseCode: r.code, courseTitle: r.title, sectionCode: r.section_code,
    credit: Number(r.credit), totalMarks: num(r.total_marks), percentage: num(r.percentage), letterGrade: r.letter_grade, gradePoint: Number(r.grade_point), isPass: !!r.is_pass,
  }));
  return { student: { id: student.id, studentId: student.code, fullName: student.full_name }, ...rules.summarizeStudent(flat) };
}

module.exports = { loadScale, getSheet, setComponents, saveMarks, submit, reopen, publish, requestCorrection, listCorrections, decide, history, listSections, getScale, setScale, useDefaultScale, studentResults, studentByUser: enrollment.studentByUser, studentById: enrollment.studentById };
