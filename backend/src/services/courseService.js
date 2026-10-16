'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { resolveUniversity } = require('./structureService');
const elig = require('./eligibility');
const { writeAudit } = require('./audit');

const num = (x) => (x == null ? null : Number(x));
const intId = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };

async function courseRow(actor, id, conn = pool) {
  const params = [id];
  let sql = 'SELECT c.*, d.name AS department_name FROM courses c LEFT JOIN departments d ON d.id = c.department_id WHERE c.id = ?';
  if (actor.university_id != null) { sql += ' AND c.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await conn.query(sql, params);
  if (!rows[0]) throw AppError.notFound('Course not found');
  return rows[0];
}

async function programRow(actor, programId) {
  const [rows] = await pool.query('SELECT id, university_id, name, duration_semesters FROM programs WHERE id = ?', [programId]);
  const p = rows[0];
  // Same answer for "missing" and "someone else's": do not reveal other universities' records.
  if (!p || (actor.university_id != null && p.university_id !== actor.university_id) || (actor.university_id == null && actor.role !== 'super_admin')) throw AppError.notFound('Program not found');
  return p;
}

async function prereqMapFor(universityId, conn = pool) {
  const [rows] = await conn.query(
    'SELECT cp.course_id, cp.prerequisite_id FROM course_prerequisites cp JOIN courses c ON c.id = cp.course_id WHERE c.university_id = ?', [universityId]);
  return rows;
}

async function effectiveRule(universityId, programId, conn = pool) {
  const [rows] = await conn.query(
    'SELECT program_id, min_credits, max_credits, total_credits_required FROM credit_rules WHERE university_id = ? AND (program_id = ? OR program_id IS NULL) ORDER BY program_id IS NULL', [universityId, programId]);
  const r = rows[0];
  return r ? { programId: r.program_id, min: num(r.min_credits), max: num(r.max_credits), totalRequired: num(r.total_credits_required), source: r.program_id ? 'program' : 'university' } : null;
}

async function detail(actor, id) {
  const c = await courseRow(actor, id);
  const [prereqs] = await pool.query('SELECT p.id, p.code, p.title, p.credit FROM course_prerequisites cp JOIN courses p ON p.id = cp.prerequisite_id WHERE cp.course_id = ? ORDER BY p.code', [id]);
  const [requiredBy] = await pool.query('SELECT c2.id, c2.code, c2.title FROM course_prerequisites cp JOIN courses c2 ON c2.id = cp.course_id WHERE cp.prerequisite_id = ? ORDER BY c2.code', [id]);
  const [programs] = await pool.query(
    'SELECT pc.program_id, pr.name AS program_name, pc.semester_no, pc.is_mandatory FROM program_courses pc JOIN programs pr ON pr.id = pc.program_id WHERE pc.course_id = ? ORDER BY pr.name', [id]);
  return {
    course: { id: c.id, universityId: c.university_id, code: c.code, title: c.title, credit: num(c.credit), courseType: c.course_type, description: c.description, status: c.status, departmentId: c.department_id, departmentName: c.department_name },
    prerequisites: prereqs.map((p) => ({ id: p.id, code: p.code, title: p.title, credit: num(p.credit) })),
    requiredBy,
    programs: programs.map((p) => ({ programId: p.program_id, programName: p.program_name, semesterNo: p.semester_no, isMandatory: !!p.is_mandatory })),
  };
}

async function setPrerequisites(actor, id, rawIds, ctx) {
  const course = await courseRow(actor, id);
  if (!Array.isArray(rawIds)) throw AppError.validation('prerequisiteIds must be a list.');
  const ids = [...new Set(rawIds.map(intId))];
  if (ids.includes(null)) throw AppError.validation('Prerequisites must be course ids.');
  if (ids.includes(id)) throw AppError.validation('A course cannot be its own prerequisite.', { prerequisiteIds: 'A course cannot be its own prerequisite.' });
  if (ids.length > 20) throw AppError.validation('Use at most 20 prerequisites.');

  const before = await withTransaction(async (conn) => {
    if (ids.length) {
      const [found] = await conn.query('SELECT id FROM courses WHERE id IN (?) AND university_id = ?', [ids, course.university_id]);
      if (found.length !== ids.length) throw AppError.validation('One or more prerequisites do not exist in this university.', { prerequisiteIds: 'Unknown course.' });
    }
    const edges = (await prereqMapFor(course.university_id, conn)).map((e) => [e.course_id, e.prerequisite_id]);
    if (elig.wouldCreateCycle(edges, id, ids)) throw AppError.conflict('These prerequisites would create a loop: a course would end up requiring itself.');
    const [old] = await conn.query('SELECT p.code FROM course_prerequisites cp JOIN courses p ON p.id = cp.prerequisite_id WHERE cp.course_id = ?', [id]);
    await conn.query('DELETE FROM course_prerequisites WHERE course_id = ?', [id]);
    if (ids.length) await conn.query('INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES ?', [ids.map((p) => [id, p])]);
    return old.map((r) => r.code).sort();
  });
  const [now] = ids.length ? await pool.query('SELECT code FROM courses WHERE id IN (?)', [ids]) : [[]];
  await writeAudit({ ctx, userId: actor.id, universityId: course.university_id, action: 'course_prerequisites_changed', targetType: 'course', targetId: id, oldValue: { prerequisites: before }, newValue: { prerequisites: now.map((r) => r.code).sort() } });
  return detail(actor, id);
}

async function curriculum(actor, programId) {
  const p = await programRow(actor, programId);
  const [rows] = await pool.query(
    `SELECT pc.course_id, pc.semester_no, pc.is_mandatory, c.code, c.title, c.credit, c.status
     FROM program_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.program_id = ? ORDER BY pc.semester_no, c.code`, [programId]);
  const prereq = new Map();
  if (rows.length) {
    const [ps] = await pool.query('SELECT cp.course_id, p.id, p.code FROM course_prerequisites cp JOIN courses p ON p.id = cp.prerequisite_id WHERE cp.course_id IN (?)', [rows.map((r) => r.course_id)]);
    ps.forEach((x) => { if (!prereq.has(x.course_id)) prereq.set(x.course_id, []); prereq.get(x.course_id).push({ id: x.id, code: x.code }); });
  }
  const items = rows.map((r) => ({ courseId: r.course_id, code: r.code, title: r.title, credit: num(r.credit), status: r.status, semesterNo: r.semester_no, isMandatory: !!r.is_mandatory, prerequisites: prereq.get(r.course_id) || [] }));
  const sem = new Map(items.map((i) => [i.courseId, i.semesterNo]));
  const warnings = [];
  for (const i of items) for (const pr of i.prerequisites) {
    if (!sem.has(pr.id)) warnings.push(`${i.code} requires ${pr.code}, which is not in this program's curriculum.`);
    else if (sem.get(pr.id) >= i.semesterNo) warnings.push(`${i.code} (semester ${i.semesterNo}) requires ${pr.code}, which is not scheduled in an earlier semester.`);
  }
  const totalCredits = Math.round(items.reduce((a, i) => a + i.credit, 0) * 10) / 10;
  const rule = await effectiveRule(p.university_id, programId);
  const incomplete = rule?.totalRequired != null && totalCredits < rule.totalRequired;
  if (incomplete) warnings.push(`The curriculum totals ${totalCredits} credits but the program requires ${rule.totalRequired}.`);
  return { program: { id: p.id, name: p.name, durationSemesters: p.duration_semesters }, items, totalCredits, rule, warnings };
}

async function setCurriculum(actor, programId, rawItems, ctx) {
  const p = await programRow(actor, programId);
  if (!Array.isArray(rawItems) || rawItems.length > 300) throw AppError.validation('items must be a list of at most 300 courses.');
  const errors = [];
  const seen = new Set();
  const items = rawItems.map((x, i) => {
    const courseId = intId(x?.courseId); const semesterNo = Number(x?.semesterNo);
    if (!courseId) errors.push(`Row ${i + 1}: choose a course.`);
    else if (seen.has(courseId)) errors.push(`Row ${i + 1}: the course is listed twice.`);
    if (courseId) seen.add(courseId);
    if (!Number.isInteger(semesterNo) || semesterNo < 1 || semesterNo > p.duration_semesters) errors.push(`Row ${i + 1}: semester must be 1 to ${p.duration_semesters}.`);
    return { courseId, semesterNo, isMandatory: x?.isMandatory === false ? 0 : 1 };
  });
  if (errors.length) throw AppError.validation('Please fix the curriculum rows.', { items: errors });

  await withTransaction(async (conn) => {
    const ids = items.map((i) => i.courseId);
    if (ids.length) {
      const [found] = await conn.query('SELECT id FROM courses WHERE id IN (?) AND university_id = ?', [ids, p.university_id]);
      if (found.length !== ids.length) throw AppError.validation('One or more courses do not exist in this university.', { items: ['Unknown course.'] });
    }
    await conn.query('DELETE FROM program_courses WHERE program_id = ?', [programId]);
    if (items.length) await conn.query('INSERT INTO program_courses (university_id, program_id, course_id, semester_no, is_mandatory) VALUES ?', [items.map((i) => [p.university_id, programId, i.courseId, i.semesterNo, i.isMandatory])]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: p.university_id, action: 'curriculum_changed', targetType: 'program', targetId: programId, newValue: { courses: items.length } });
  return curriculum(actor, programId);
}

async function listRules(actor, rawUni) {
  const uni = resolveUniversity(actor, rawUni, true);
  const [rows] = await pool.query(
    'SELECT cr.*, p.name AS program_name FROM credit_rules cr LEFT JOIN programs p ON p.id = cr.program_id WHERE cr.university_id = ? ORDER BY cr.program_id IS NOT NULL, p.name', [uni]);
  return rows.map((r) => ({ id: r.id, programId: r.program_id, programName: r.program_name, minCredits: num(r.min_credits), maxCredits: num(r.max_credits), totalCreditsRequired: num(r.total_credits_required) }));
}

const credit = (x, max, optional) => {
  if (x === undefined || x === null || x === '') return optional ? { value: null } : { error: 'This field is required.' };
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 && n <= max && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 ? { value: n } : { error: `Enter a number from 0 to ${max} in steps of 0.5.` };
};

async function saveRule(actor, body, ctx) {
  const b = body || {};
  const uni = resolveUniversity(actor, b.universityId, true);
  const errors = {};
  const min = credit(b.minCredits, 40); const max = credit(b.maxCredits, 40); const total = credit(b.totalCreditsRequired, 400, true);
  if (min.error) errors.minCredits = min.error;
  if (max.error) errors.maxCredits = max.error;
  if (total.error) errors.totalCreditsRequired = total.error;
  if (!min.error && !max.error && min.value > max.value) errors.maxCredits = 'Maximum must be at least the minimum.';
  let programId = null;
  if (b.programId !== null && b.programId !== undefined && b.programId !== '') {
    programId = intId(b.programId);
    const [p] = programId ? await pool.query('SELECT id FROM programs WHERE id = ? AND university_id = ?', [programId, uni]) : [[]];
    if (!p[0]) errors.programId = 'Program not found in this university.';
  }
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  await pool.query(
    `INSERT INTO credit_rules (university_id, program_id, min_credits, max_credits, total_credits_required) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE min_credits = VALUES(min_credits), max_credits = VALUES(max_credits), total_credits_required = VALUES(total_credits_required)`,
    [uni, programId, min.value, max.value, total.value]);
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'credit_rule_saved', targetType: 'credit_rule', targetId: programId ?? 'default', newValue: { min: min.value, max: max.value, total: total.value } });
  return listRules(actor, uni);
}

async function deleteRule(actor, id, ctx) {
  const params = [id]; let sql = 'SELECT id, university_id, program_id FROM credit_rules WHERE id = ?';
  if (actor.university_id != null) { sql += ' AND university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(sql, params);
  if (!rows[0]) throw AppError.notFound('Credit rule not found');
  await pool.query('DELETE FROM credit_rules WHERE id = ?', [id]);
  await writeAudit({ ctx, userId: actor.id, universityId: rows[0].university_id, action: 'credit_rule_deleted', targetType: 'credit_rule', targetId: id });
}

/** Dry-run of the rules enrollment will enforce. Nothing is saved. */
async function evaluateSelection(actor, body) {
  const b = body || {};
  const programId = intId(b.programId);
  if (!programId) throw AppError.validation('Choose a program.', { programId: 'Choose a program.' });
  const p = await programRow(actor, programId);
  const selectedIds = Array.isArray(b.courseIds) ? b.courseIds.map(intId) : null;
  if (!selectedIds || selectedIds.includes(null) || selectedIds.length > 60) throw AppError.validation('courseIds must be a list of course ids.');
  const completed = new Set(Array.isArray(b.completedCourseIds) ? b.completedCourseIds.map(intId).filter(Boolean) : []);
  const already = Number(b.alreadyRegisteredCredits || 0);
  if (!Number.isFinite(already) || already < 0 || already > 100) throw AppError.validation('alreadyRegisteredCredits is not valid.');

  const universityId = p.university_id;
  const allIds = [...new Set([...selectedIds, ...completed])];
  const [rows] = allIds.length ? await pool.query('SELECT id, code, credit, status FROM courses WHERE id IN (?) AND university_id = ?', [allIds, universityId]) : [[]];
  const courses = new Map(rows.map((c) => [c.id, c]));
  const edges = await prereqMapFor(universityId);
  const prereqMap = new Map();
  edges.forEach((e) => { if (!prereqMap.has(e.course_id)) prereqMap.set(e.course_id, []); prereqMap.get(e.course_id).push(e.prerequisite_id); });
  // Prerequisite codes are needed for messages even when they were not selected.
  const need = [...new Set(selectedIds.flatMap((id) => prereqMap.get(id) || []))].filter((id) => !courses.has(id));
  if (need.length) { const [more] = await pool.query('SELECT id, code, credit, status FROM courses WHERE id IN (?)', [need]); more.forEach((c) => courses.set(c.id, c)); }
  const [cur] = await pool.query('SELECT course_id FROM program_courses WHERE program_id = ?', [programId]);
  const rule = await effectiveRule(universityId, programId);
  return { ...elig.evaluate({ courses, selectedIds, prereqMap, completed, curriculum: new Set(cur.map((r) => r.course_id)), rule, alreadyRegisteredCredits: already, checkMinimum: b.checkMinimum !== false }), rule };
}

async function myCurriculum(actor) {
  const [rows] = await pool.query('SELECT program_id FROM students WHERE user_id = ? AND deleted_at IS NULL', [actor.id]);
  if (!rows[0]) throw AppError.notFound('No student record is linked to this account.');
  return curriculum({ ...actor, university_id: actor.university_id, role: 'student' }, rows[0].program_id);
}

module.exports = { detail, setPrerequisites, curriculum, setCurriculum, listRules, saveRule, deleteRule, evaluateSelection, myCurriculum, effectiveRule };
