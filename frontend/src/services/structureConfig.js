// Client-side description of each structure resource: table columns and form fields.
// Keys match the API (camelCase). type: text | number | date | time | select | parent.
const status = { key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['inactive', 'Inactive']], default: 'active' };
const code = { key: 'code', label: 'Code', hint: 'Short and unique, for example CSE.' };
const name = { key: 'name', label: 'Name' };
const dates = [{ key: 'startDate', label: 'Start date', type: 'date' }, { key: 'endDate', label: 'End date', type: 'date' }];

export const RESOURCES = {
  universities: {
    title: 'Universities', single: 'university', itemKey: 'university', base: '/universities',
    columns: [['code', 'Code'], ['name', 'Name'], ['shortName', 'Short name'], ['status', 'Status']],
    fields: [{ ...code, hint: 'Cannot be changed later.', createOnly: true }, name, { key: 'shortName', label: 'Short name' },
      { key: 'contactEmail', label: 'Contact email' }, { key: 'contactPhone', label: 'Contact phone' }, { key: 'address', label: 'Address' }],
  },
  campuses: { title: 'Campuses', single: 'campus', columns: [['code', 'Code'], ['name', 'Name'], ['address', 'Address'], ['status', 'Status']], fields: [code, name, { key: 'address', label: 'Address' }, status] },
  faculties: { title: 'Faculties', single: 'faculty', columns: [['code', 'Code'], ['name', 'Name'], ['status', 'Status']], fields: [code, name, status] },
  departments: {
    title: 'Departments', single: 'department', columns: [['code', 'Code'], ['name', 'Name'], ['facultyName', 'Faculty'], ['status', 'Status']],
    fields: [code, name, { key: 'facultyId', label: 'Faculty', type: 'parent', parent: 'faculties' }, status],
  },
  programs: {
    title: 'Programs', single: 'program', columns: [['code', 'Code'], ['name', 'Name'], ['departmentName', 'Department'], ['degreeLevel', 'Level'], ['durationSemesters', 'Semesters'], ['status', 'Status']],
    fields: [code, name, { key: 'departmentId', label: 'Department', type: 'parent', parent: 'departments' },
      { key: 'degreeLevel', label: 'Degree level', type: 'select', default: 'bachelor', options: [['diploma', 'Diploma'], ['bachelor', 'Bachelor'], ['master', 'Master'], ['doctorate', 'Doctorate'], ['other', 'Other']] },
      { key: 'durationSemesters', label: 'Duration (semesters)', type: 'number' }, status],
  },
  batches: {
    title: 'Batches', single: 'batch', columns: [['code', 'Code'], ['name', 'Name'], ['programName', 'Program'], ['status', 'Status']],
    fields: [code, name, { key: 'programId', label: 'Program', type: 'parent', parent: 'programs' }, status],
  },
  'academic-years': {
    title: 'Academic years', single: 'academic year', current: true, columns: [['name', 'Name'], ['startDate', 'Starts'], ['endDate', 'Ends']],
    fields: [{ ...name, hint: 'For example 2026-2027.' }, ...dates],
  },
  semesters: {
    title: 'Semesters', single: 'semester', current: true, columns: [['name', 'Name'], ['academicYearName', 'Academic year'], ['startDate', 'Starts'], ['endDate', 'Ends']],
    fields: [{ ...name, hint: 'For example Spring 2026.' }, { key: 'academicYearId', label: 'Academic year', type: 'parent', parent: 'academic-years' }, ...dates,
      { key: 'registrationStart', label: 'Registration opens', type: 'date', hint: 'Students cannot register until the three registration dates are set.' },
      { key: 'registrationEnd', label: 'Registration closes', type: 'date' },
      { key: 'addDropEnd', label: 'Add/drop ends', type: 'date', hint: 'Optional. Defaults to the day registration closes.' }],
  },
  shifts: {
    title: 'Shifts', single: 'shift', columns: [['code', 'Code'], ['name', 'Name'], ['startTime', 'Starts'], ['endTime', 'Ends'], ['status', 'Status']],
    fields: [code, name, { key: 'startTime', label: 'Start time', type: 'time' }, { key: 'endTime', label: 'End time', type: 'time' }, status],
  },
};

// Courses are managed from the Courses section, not the structure tabs, so they are not in ORDER.
RESOURCES.courses = {
  title: 'Courses', single: 'course', manage: 'courses.manage', detail: (r) => `/courses/${r.id}`,
  columns: [['code', 'Code'], ['title', 'Title'], ['credit', 'Credit'], ['courseType', 'Type'], ['departmentName', 'Department'], ['status', 'Status']],
  fields: [{ ...code, hint: 'For example CSE101.' }, { key: 'title', label: 'Title' },
    { key: 'departmentId', label: 'Department', type: 'parent', parent: 'departments' },
    { key: 'credit', label: 'Credit', type: 'number', step: 0.5, hint: 'Steps of 0.5, for example 3 or 1.5.' },
    { key: 'courseType', label: 'Type', type: 'select', default: 'theory', options: [['theory', 'Theory'], ['lab', 'Lab'], ['theory_lab', 'Theory and lab'], ['project', 'Project'], ['thesis', 'Thesis'], ['other', 'Other']] },
    { key: 'description', label: 'Description' }, status],
};

RESOURCES.rooms = {
  title: 'Rooms', single: 'room', manage: 'sections.manage',
  columns: [['code', 'Code'], ['name', 'Name'], ['building', 'Building'], ['capacity', 'Seats'], ['roomType', 'Type'], ['status', 'Status']],
  fields: [code, name, { key: 'building', label: 'Building' }, { key: 'capacity', label: 'Seats', type: 'number' },
    { key: 'roomType', label: 'Type', type: 'select', default: 'classroom', options: [['classroom', 'Classroom'], ['lab', 'Lab'], ['auditorium', 'Auditorium'], ['other', 'Other']] },
    { key: 'campusId', label: 'Campus (optional)', type: 'parent', parent: 'campuses', optional: true }, status],
};
RESOURCES['calendar-events'] = {
  title: 'Academic calendar', single: 'event', manage: 'calendar.manage',
  columns: [['title', 'Title'], ['eventType', 'Type'], ['startDate', 'From'], ['endDate', 'To'], ['semesterName', 'Semester']],
  fields: [{ key: 'title', label: 'Title' },
    { key: 'eventType', label: 'Type', type: 'select', default: 'event', options: [['holiday', 'Holiday'], ['exam', 'Exam'], ['registration', 'Registration'], ['class_start', 'Classes begin'], ['class_end', 'Classes end'], ['event', 'Event'], ['other', 'Other']] },
    ...dates.map((d) => ({ ...d, hint: d.key === 'endDate' ? 'Same as the start date for a one-day event.' : undefined })),
    { key: 'semesterId', label: 'Semester (optional)', type: 'parent', parent: 'semesters', optional: true },
    { key: 'description', label: 'Description' }],
};

export const ORDER = ['universities', 'campuses', 'faculties', 'departments', 'programs', 'batches', 'academic-years', 'semesters', 'shifts'];
