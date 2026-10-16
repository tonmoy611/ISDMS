'use strict';
// Pure timetable rules. Slots: { dayOfWeek 1-7, startTime 'HH:MM[:SS]', endTime, roomId }.
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const hhmm = (t) => String(t).slice(0, 5);
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const overlaps = (a, b) => a.dayOfWeek === b.dayOfWeek && toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime);

function slotProblem(s) {
  if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) return 'Choose a day of the week.';
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s.startTime)) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s.endTime))) return 'Enter times as HH:MM.';
  if (toMin(s.endTime) <= toMin(s.startTime)) return 'End time must be after the start time.';
  return null;
}

/** Slots of one section may not overlap each other. Returns messages. */
function selfOverlaps(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    if (overlaps(slots[i], slots[j])) out.push(`Slots ${i + 1} and ${j + 1} overlap on ${DAYS[slots[i].dayOfWeek]}.`);
  }
  return out;
}

/**
 * Clashes between this section's slots and other sections' slots in the same semester.
 * existing: [{ dayOfWeek, startTime, endTime, roomId, teacherId, label }]. A room clash needs the same room; a teacher clash the same teacher.
 */
function findConflicts(slots, existing, teacherId, { checkRooms = true } = {}) {
  const out = [];
  slots.forEach((s, i) => {
    for (const e of existing) {
      if (!overlaps(s, e)) continue;
      const when = `${DAYS[s.dayOfWeek]} ${hhmm(s.startTime)}-${hhmm(s.endTime)}`;
      if (checkRooms && s.roomId && e.roomId === s.roomId) out.push({ type: 'room', slot: i + 1, message: `Room is already used by ${e.label} on ${when}.` });
      if (teacherId && e.teacherId === teacherId) out.push({ type: 'teacher', slot: i + 1, message: `The teacher already teaches ${e.label} on ${when}.` });
    }
  });
  return out;
}

module.exports = { overlaps, slotProblem, selfOverlaps, findConflicts, toMin, hhmm, DAYS };
