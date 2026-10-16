'use strict';
// Pure enrollment rules: registration dates and student timetable clashes.
const sched = require('./scheduling');

/** Today's date (YYYY-MM-DD) in the given time zone. */
const todayIn = (tz, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/**
 * Dates are plain YYYY-MM-DD strings, compared as text. New registration only while registration is open;
 * add/drop continues until add_drop_end (or the registration end when no separate date is set).
 */
function windowState(sem, today) {
  const start = sem.registration_start; const end = sem.registration_end;
  if (!start || !end) return { state: 'not_configured', canRegister: false, canAddDrop: false, message: 'Registration dates have not been set for this semester.' };
  const addDropEnd = sem.add_drop_end || end;
  if (today < start) return { state: 'not_open', canRegister: false, canAddDrop: false, message: `Registration opens on ${start}.` };
  if (today <= end) return { state: 'open', canRegister: true, canAddDrop: true, message: `Registration is open until ${end}.` };
  if (today <= addDropEnd) return { state: 'add_drop', canRegister: false, canAddDrop: true, message: `Registration has closed. You can still add or drop courses until ${addDropEnd}.` };
  return { state: 'closed', canRegister: false, canAddDrop: false, message: 'Registration and add/drop have ended for this semester.' };
}

/**
 * Clashes between sections the student is adding and sections already held (or also being added).
 * items: [{ sectionId, label, slots:[{dayOfWeek,startTime,endTime}] }]
 */
function timetableClashes(adding, held) {
  const out = [];
  const seen = new Set();
  const check = (a, b) => {
    const key = [a.sectionId, b.sectionId].sort().join('-');
    if (seen.has(key)) return;
    for (const x of a.slots) for (const y of b.slots) {
      if (sched.overlaps(x, y)) { seen.add(key); out.push({ sectionId: a.sectionId, message: `${a.label} clashes with ${b.label} on ${sched.DAYS[x.dayOfWeek]} ${sched.hhmm(x.startTime)}-${sched.hhmm(x.endTime)}.` }); return; }
    }
  };
  adding.forEach((a, i) => {
    held.forEach((h) => check(a, h));
    adding.slice(i + 1).forEach((b) => check(a, b));
  });
  return out;
}

module.exports = { todayIn, windowState, timetableClashes };
