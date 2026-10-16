'use strict';
// Declarative description of each structure resource. The generic service builds validation, SQL and audit from this.
const code = { key: 'code', col: 'code', type: 'string', required: true, max: 30, pattern: /^[A-Za-z0-9._-]+$/, patternMsg: 'Use letters, numbers, dots, dashes or underscores.' };
const name = (max = 150) => ({ key: 'name', col: 'name', type: 'string', required: true, max });
const status = { key: 'status', col: 'status', type: 'enum', values: ['active', 'inactive'], default: 'active' };
const date = (key, col) => ({ key, col, type: 'date', required: true });
const ref = (key, col, table, labelKey) => ({ key, col, type: 'ref', required: true, ref: table, labelKey });
const dateRule = (v) => (v.start_date && v.end_date && v.end_date <= v.start_date ? { endDate: 'End date must be after the start date.' } : null);

const optionalDate = (key, col) => ({ key, col, type: 'date', required: false });
// Registration closes after it opens; add/drop runs until at least the end of registration.
const registrationRule = (v) => {
  const e = {};
  if (v.registration_start && v.registration_end && v.registration_end < v.registration_start) e.registrationEnd = 'Registration cannot end before it starts.';
  if (v.registration_end && v.add_drop_end && v.add_drop_end < v.registration_end) e.addDropEnd = 'Add/drop cannot end before registration ends.';
  if (v.add_drop_end && !v.registration_end) e.registrationEnd = 'Set the registration end date first.';
  if (v.registration_end && !v.registration_start) e.registrationStart = 'Set the registration start date.';
  return Object.keys(e).length ? e : null;
};
const optionalRef = (key, col, table, labelKey) => ({ ...ref(key, col, table, labelKey), required: false });
// One-day events are allowed (end may equal start), unlike semesters and academic years.
const inclusiveDates = (v) => (v.start_date && v.end_date && v.end_date < v.start_date ? { endDate: 'End date cannot be before the start date.' } : null);

module.exports = {
  rooms: {
    table: 'rooms', label: 'Room', search: ['code', 'name', 'building'], perm: { view: 'sections.view', manage: 'sections.manage' },
    fields: [code, name(100), { key: 'building', col: 'building', type: 'string', max: 100 },
      { key: 'capacity', col: 'capacity', type: 'int', required: true, min: 1, max: 5000 },
      { key: 'roomType', col: 'room_type', type: 'enum', values: ['classroom', 'lab', 'auditorium', 'other'], default: 'classroom' },
      optionalRef('campusId', 'campus_id', 'campuses', 'campusName'), status],
  },
  'calendar-events': {
    table: 'calendar_events', label: 'Calendar event', search: ['title'], perm: { view: 'calendar.view', manage: 'calendar.manage' }, rules: [inclusiveDates],
    fields: [{ key: 'title', col: 'title', type: 'string', required: true, max: 200 },
      { key: 'eventType', col: 'event_type', type: 'enum', values: ['holiday', 'exam', 'registration', 'class_start', 'class_end', 'event', 'other'], default: 'event' },
      date('startDate', 'start_date'), date('endDate', 'end_date'),
      optionalRef('semesterId', 'semester_id', 'semesters', 'semesterName'),
      { key: 'description', col: 'description', type: 'string', max: 500 }],
  },
  courses: {
    table: 'courses', label: 'Course', search: ['code', 'title'], perm: { view: 'courses.view', manage: 'courses.manage' },
    fields: [code, { key: 'title', col: 'title', type: 'string', required: true, max: 200 },
      ref('departmentId', 'department_id', 'departments', 'departmentName'),
      { key: 'credit', col: 'credit', type: 'decimal', required: true, min: 0.5, max: 12, step: 0.5 },
      { key: 'courseType', col: 'course_type', type: 'enum', values: ['theory', 'lab', 'theory_lab', 'project', 'thesis', 'other'], default: 'theory' },
      { key: 'description', col: 'description', type: 'string', max: 500 }, status],
  },
  campuses: { table: 'campuses', label: 'Campus', search: ['code', 'name'], fields: [code, name(), { key: 'address', col: 'address', type: 'string', max: 255 }, status] },
  faculties: { table: 'faculties', label: 'Faculty', search: ['code', 'name'], fields: [code, name(), status] },
  departments: { table: 'departments', label: 'Department', search: ['code', 'name'], fields: [code, name(), ref('facultyId', 'faculty_id', 'faculties', 'facultyName'), status] },
  programs: {
    table: 'programs', label: 'Program', search: ['code', 'name'],
    fields: [code, name(), ref('departmentId', 'department_id', 'departments', 'departmentName'),
      { key: 'degreeLevel', col: 'degree_level', type: 'enum', values: ['diploma', 'bachelor', 'master', 'doctorate', 'other'], default: 'bachelor' },
      { key: 'durationSemesters', col: 'duration_semesters', type: 'int', required: true, min: 1, max: 24 }, status],
  },
  batches: { table: 'batches', label: 'Batch', search: ['code', 'name'], fields: [code, name(), ref('programId', 'program_id', 'programs', 'programName'), status] },
  'academic-years': { table: 'academic_years', label: 'Academic year', search: ['name'], current: true, rules: [dateRule], fields: [name(50), date('startDate', 'start_date'), date('endDate', 'end_date')] },
  semesters: {
    table: 'semesters', label: 'Semester', search: ['name'], current: true, rules: [dateRule, registrationRule],
    fields: [name(50), ref('academicYearId', 'academic_year_id', 'academic_years', 'academicYearName'), date('startDate', 'start_date'), date('endDate', 'end_date'),
      optionalDate('registrationStart', 'registration_start'), optionalDate('registrationEnd', 'registration_end'), optionalDate('addDropEnd', 'add_drop_end')],
  },
  shifts: {
    table: 'shifts', label: 'Shift', search: ['code', 'name'],
    fields: [code, name(100), { key: 'startTime', col: 'start_time', type: 'time', required: true }, { key: 'endTime', col: 'end_time', type: 'time', required: true }, status],
  },
};
