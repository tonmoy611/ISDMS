'use strict';
// Pure rules for course selection. No database access, so enrollment (a later phase) and tests share one implementation.
const round1 = (n) => Math.round(n * 10) / 10;

/** True if giving `courseId` the prerequisites `newPrereqIds` would create a loop (A needs B needs A). edges: [[courseId, prerequisiteId], ...] */
function wouldCreateCycle(edges, courseId, newPrereqIds) {
  const adj = new Map();
  for (const [c, p] of edges) {
    if (c === courseId) continue; // this course's old prerequisites are being replaced
    if (!adj.has(c)) adj.set(c, []);
    adj.get(c).push(p);
  }
  const seen = new Set();
  const stack = [...newPrereqIds];
  while (stack.length) {
    const n = stack.pop();
    if (n === courseId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(adj.get(n) || []));
  }
  return false;
}

const missingPrerequisites = (courseId, prereqMap, completed) => (prereqMap.get(courseId) || []).filter((p) => !completed.has(p));

/** rule: {min, max} or null. Returns a list of problems for a total credit load. */
function creditLoadProblems(rule, total, { checkMinimum = true } = {}) {
  const out = [];
  if (!rule) return out;
  if (rule.max != null && total > rule.max) out.push({ code: 'CREDIT_ABOVE_MAX', message: `Selected credits (${total}) exceed the maximum of ${rule.max} per semester.` });
  if (checkMinimum && rule.min != null && total < rule.min) out.push({ code: 'CREDIT_BELOW_MIN', message: `Selected credits (${total}) are below the minimum of ${rule.min} per semester.` });
  return out;
}

/**
 * courses: Map id -> {id, code, credit, status}; prereqMap: Map id -> [prerequisiteIds];
 * completed: Set of course ids already passed; curriculum: Set of course ids in the student's program (or null to skip).
 */
function evaluate({ courses, selectedIds, prereqMap, completed = new Set(), curriculum = null, rule = null, alreadyRegisteredCredits = 0, checkMinimum = true }) {
  const errors = [];
  if (!selectedIds.length) errors.push({ code: 'EMPTY_SELECTION', message: 'Select at least one course.' });
  const seen = new Set();
  let selected = 0;
  for (const id of selectedIds) {
    const c = courses.get(id);
    if (!c) { errors.push({ code: 'UNKNOWN_COURSE', courseId: id, message: 'A selected course does not exist in this university.' }); continue; }
    if (seen.has(id)) { errors.push({ code: 'DUPLICATE_SELECTION', courseId: id, message: `${c.code} was selected twice.` }); continue; }
    seen.add(id);
    selected += Number(c.credit);
    if (c.status !== 'active') errors.push({ code: 'COURSE_INACTIVE', courseId: id, message: `${c.code} is not open for registration.` });
    if (curriculum && !curriculum.has(id)) errors.push({ code: 'NOT_IN_CURRICULUM', courseId: id, message: `${c.code} is not part of this program.` });
    if (completed.has(id)) errors.push({ code: 'ALREADY_COMPLETED', courseId: id, message: `${c.code} has already been completed.` });
    const missing = missingPrerequisites(id, prereqMap, completed);
    if (missing.length) {
      const names = missing.map((m) => courses.get(m)?.code || `#${m}`).join(', ');
      errors.push({ code: 'PREREQUISITE_MISSING', courseId: id, missing, message: `${c.code} requires ${names} to be completed first.` });
    }
  }
  const totalCredits = round1(Number(alreadyRegisteredCredits) + selected);
  errors.push(...creditLoadProblems(rule, totalCredits, { checkMinimum }));
  return { ok: errors.length === 0, totalCredits, selectedCredits: round1(selected), errors };
}

module.exports = { wouldCreateCycle, missingPrerequisites, creditLoadProblems, evaluate };
