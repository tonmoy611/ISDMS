'use strict';
// Pure attendance rules.
const STATUSES = ['present', 'absent', 'late', 'excused'];
const DEFAULT_MIN_PERCENT = 75;

/**
 * Late counts as attended. Excused classes are left out of both sides, so they never hurt the percentage.
 * percentage is null when nothing countable has been held yet.
 */
function summarize({ present = 0, absent = 0, late = 0, excused = 0 } = {}) {
  const p = Number(present) || 0; const a = Number(absent) || 0; const l = Number(late) || 0; const x = Number(excused) || 0;
  const total = p + a + l + x;
  const counted = total - x;
  const attended = p + l;
  return { total, present: p, absent: a, late: l, excused: x, attended, counted, percentage: counted > 0 ? Math.round((attended / counted) * 1000) / 10 : null };
}

const belowThreshold = (percentage, min) => percentage !== null && percentage < min;

const isDateText = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** Returns an error message, or null when the date is acceptable for a class. */
function sessionDateProblem(date, today, semester) {
  if (!isDateText(date)) return 'Enter a valid date (YYYY-MM-DD).';
  if (date > today) return 'Attendance cannot be recorded for a future date.';
  if (semester?.start_date && date < semester.start_date) return `The date is before the semester starts (${semester.start_date}).`;
  if (semester?.end_date && date > semester.end_date) return `The date is after the semester ends (${semester.end_date}).`;
  return null;
}

/** Teachers may only create or correct recent classes. */
const editWindowOpen = (date, today, days) => daysBetween(date, today) <= days;

module.exports = { STATUSES, DEFAULT_MIN_PERCENT, summarize, belowThreshold, isDateText, daysBetween, sessionDateProblem, editWindowOpen };
