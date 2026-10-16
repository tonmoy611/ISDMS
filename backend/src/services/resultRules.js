'use strict';
// Pure grading rules: marks -> percentage -> grade, GPA and CGPA.
const round = (n, d = 2) => Math.round((Number(n) + Number.EPSILON) * 10 ** d) / 10 ** d;

/** Bangladesh UGC 4.00 scale, offered as a starting point. A university may change it. */
const UGC_DEFAULT_SCALE = [
  { letter: 'A+', minPercent: 80, gradePoint: 4.0, isPass: true }, { letter: 'A', minPercent: 75, gradePoint: 3.75, isPass: true },
  { letter: 'A-', minPercent: 70, gradePoint: 3.5, isPass: true }, { letter: 'B+', minPercent: 65, gradePoint: 3.25, isPass: true },
  { letter: 'B', minPercent: 60, gradePoint: 3.0, isPass: true }, { letter: 'B-', minPercent: 55, gradePoint: 2.75, isPass: true },
  { letter: 'C+', minPercent: 50, gradePoint: 2.5, isPass: true }, { letter: 'C', minPercent: 45, gradePoint: 2.25, isPass: true },
  { letter: 'D', minPercent: 40, gradePoint: 2.0, isPass: true }, { letter: 'F', minPercent: 0, gradePoint: 0, isPass: false },
];

/** Returns a list of problems; empty means the scale is usable. */
function scaleProblems(entries) {
  const out = [];
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 20) return ['Enter between 2 and 20 grades.'];
  const letters = new Set(); const mins = new Set();
  entries.forEach((e, i) => {
    const row = `Grade ${i + 1}`;
    if (typeof e?.letter !== 'string' || !/^[A-Za-z][A-Za-z+-]{0,3}$/.test(e.letter.trim())) out.push(`${row}: the letter must be 1-4 characters, for example A+.`);
    if (!Number.isFinite(Number(e?.minPercent)) || e.minPercent < 0 || e.minPercent > 100) out.push(`${row}: the minimum percentage must be 0 to 100.`);
    if (!Number.isFinite(Number(e?.gradePoint)) || e.gradePoint < 0 || e.gradePoint > 10) out.push(`${row}: the grade point must be 0 to 10.`);
    const l = String(e?.letter).trim().toUpperCase();
    if (letters.has(l)) out.push(`${row}: the letter ${e.letter} is used twice.`); letters.add(l);
    if (mins.has(Number(e?.minPercent))) out.push(`${row}: two grades start at ${e.minPercent}%.`); mins.add(Number(e?.minPercent));
  });
  if (out.length) return out;
  const sorted = [...entries].sort((a, b) => b.minPercent - a.minPercent);
  if (Number(sorted[sorted.length - 1].minPercent) !== 0) out.push('The lowest grade must start at 0% so every mark earns a grade.');
  for (let i = 1; i < sorted.length; i++) if (Number(sorted[i].gradePoint) > Number(sorted[i - 1].gradePoint)) out.push(`${sorted[i].letter} has more grade points than ${sorted[i - 1].letter}, which needs a higher percentage.`);
  return out;
}

/** The grade whose minimum is the highest one not above the (rounded) percentage. */
function gradeFor(percentage, scale) {
  const p = round(percentage);
  const sorted = [...scale].sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  const hit = sorted.find((e) => p >= Number(e.minPercent));
  return hit ? { letter: hit.letter, gradePoint: Number(hit.gradePoint), isPass: !!hit.isPass } : null;
}

/** components: [{id, maxMarks}], marks: Map or object componentId -> number. Complete only when every component has a mark. */
function computeTotals(components, marks) {
  const get = (id) => (marks instanceof Map ? marks.get(id) : marks?.[id]);
  let total = 0; let max = 0; let complete = components.length > 0;
  for (const c of components) {
    max += Number(c.maxMarks);
    const m = get(c.id);
    if (m === undefined || m === null || m === '') complete = false; else total += Number(m);
  }
  return { complete, total: round(total), max: round(max), percentage: max > 0 ? round((total / max) * 100) : 0 };
}

/** value: text or number. Marks are 0..max with at most 2 decimals. */
function parseMark(value, max) {
  if (value === null || value === undefined || String(value).trim() === '') return { value: null };
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Enter a number with at most 2 decimals.' };
  const n = Number(s);
  if (n > Number(max)) return { error: `Cannot be more than ${max}.` };
  return { value: n };
}

const semesterGpa = (rows) => {
  const credits = rows.reduce((a, r) => a + Number(r.credit), 0);
  return credits > 0 ? round(rows.reduce((a, r) => a + Number(r.credit) * Number(r.gradePoint), 0) / credits) : null;
};

/**
 * rows: [{courseId, credit, gradePoint, isPass, order}] across all semesters (order = chronological position).
 * Retake rule: for a course taken more than once only the LATEST attempt counts, and its credits count once.
 */
function cgpa(rows) {
  const latest = new Map();
  for (const r of rows) { const cur = latest.get(r.courseId); if (!cur || r.order >= cur.order) latest.set(r.courseId, r); }
  const counted = [...latest.values()];
  return { cgpa: semesterGpa(counted), creditsAttempted: round(counted.reduce((a, r) => a + Number(r.credit), 0), 1), creditsEarned: round(counted.filter((r) => r.isPass).reduce((a, r) => a + Number(r.credit), 0), 1) };
}

/** Groups published results by semester and adds GPA per semester and the overall CGPA. rows carry semesterId, semesterName, semesterOrder. */
function summarizeStudent(rows) {
  const bySem = new Map();
  rows.forEach((r) => { if (!bySem.has(r.semesterId)) bySem.set(r.semesterId, { semesterId: r.semesterId, name: r.semesterName, order: r.semesterOrder, courses: [] }); bySem.get(r.semesterId).courses.push(r); });
  const semesters = [...bySem.values()].sort((a, b) => a.order - b.order).map((s) => ({
    ...s, gpa: semesterGpa(s.courses), credits: round(s.courses.reduce((a, c) => a + Number(c.credit), 0), 1), creditsEarned: round(s.courses.filter((c) => c.isPass).reduce((a, c) => a + Number(c.credit), 0), 1),
  }));
  return { semesters, ...cgpa(rows.map((r) => ({ courseId: r.courseId, credit: r.credit, gradePoint: r.gradePoint, isPass: r.isPass, order: r.semesterOrder }))) };
}

module.exports = { round, UGC_DEFAULT_SCALE, scaleProblems, gradeFor, computeTotals, parseMark, semesterGpa, cgpa, summarizeStudent };
