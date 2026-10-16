'use strict';
// Pure builders: data in, a plain "document model" out. The HTML renderer turns a model into a printable page.
const crypto = require('crypto');
const rules = require('./resultRules');

const DOC_TYPES = {
  transcript: { prefix: 'TR', title: 'Academic Transcript' },
  semester_result: { prefix: 'SR', title: 'Semester Result' },
  admit_card: { prefix: 'AC', title: 'Admit Card' },
  enrollment_confirmation: { prefix: 'EC', title: 'Enrollment Confirmation' },
  payment_receipt: { prefix: 'PR', title: 'Payment Receipt' },
};

const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');
const money1 = (n) => (Number.isInteger(Number(n)) ? Number(n).toFixed(1) : String(Number(n)));
const gp = (n) => Number(n).toFixed(2);

const head = (type, university, student) => ({
  type, title: DOC_TYPES[type].title,
  university: { name: university.name, address: university.address || '' },
  student: { id: student.id, code: student.code, fullName: student.fullName },
});
const studentRows = (s) => [['Name', s.fullName], ['Student ID', s.code], ['Program', s.program || ''], ['Department', s.department || ''], ['Batch', s.batch || ''], ['Date of admission', dateOnly(s.admissionDate)]];

const courseRows = (courses) => courses.map((c) => [c.courseCode, c.courseTitle, money1(c.credit), c.letterGrade + (c.isPass ? '' : ' (F)'), gp(c.gradePoint)]);
const RESULT_HEAD = ['Code', 'Course title', 'Credit', 'Grade', 'Grade point'];

/** Printable ranges for the legend, derived from the university's own scale. */
function scaleLegend(scale) {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.map((e, i) => [e.letter, i === 0 ? `${e.minPercent} - 100` : `${e.minPercent} - below ${sorted[i - 1].minPercent}`, gp(e.gradePoint)]);
}

function buildTranscript({ university, student, summary, scale }) {
  const m = head('transcript', university, student);
  m.blocks = [{ kind: 'keyvalue', rows: studentRows(student) }];
  if (!summary.semesters.length) m.blocks.push({ kind: 'text', text: 'No results have been published for this student yet.' });
  summary.semesters.forEach((s) => {
    m.blocks.push({ kind: 'heading', text: s.name });
    m.blocks.push({ kind: 'table', head: RESULT_HEAD, align: ['l', 'l', 'r', 'c', 'r'], rows: courseRows(s.courses) });
    m.blocks.push({ kind: 'text', text: `Semester GPA: ${s.gpa === null ? '-' : gp(s.gpa)}    Credits attempted: ${money1(s.credits)}    Credits earned: ${money1(s.creditsEarned)}` });
  });
  if (summary.semesters.length) {
    m.blocks.push({ kind: 'summary', items: [['CGPA', summary.cgpa === null ? '-' : gp(summary.cgpa)], ['Credits earned', money1(summary.creditsEarned)], ['Credits attempted', money1(summary.creditsAttempted)]] });
    m.blocks.push({ kind: 'text', tone: 'small', text: 'For a course taken more than once, only the latest attempt is counted in the CGPA.' });
  }
  if (scale?.length) {
    m.blocks.push({ kind: 'heading', text: 'Grading scale' });
    m.blocks.push({ kind: 'table', head: ['Grade', 'Percentage', 'Grade point'], align: ['l', 'l', 'r'], rows: scaleLegend(scale) });
  }
  return m;
}

/** semester: one entry of summarizeStudent().semesters; upTo: all semesters up to and including it (for the cumulative CGPA). */
function buildSemesterResult({ university, student, semester, upTo }) {
  const m = head('semester_result', university, student);
  const cumulative = rules.cgpa(upTo.flatMap((s) => s.courses.map((c) => ({ courseId: c.courseId, credit: c.credit, gradePoint: c.gradePoint, isPass: c.isPass, order: c.semesterOrder }))));
  m.blocks = [
    { kind: 'keyvalue', rows: studentRows(student) },
    { kind: 'heading', text: semester.name },
    { kind: 'table', head: RESULT_HEAD, align: ['l', 'l', 'r', 'c', 'r'], rows: courseRows(semester.courses) },
    { kind: 'summary', items: [['Semester GPA', semester.gpa === null ? '-' : gp(semester.gpa)], ['CGPA to date', cumulative.cgpa === null ? '-' : gp(cumulative.cgpa)], ['Credits earned (semester)', money1(semester.creditsEarned)]] },
  ];
  return m;
}

function buildAdmitCard({ university, student, semester, eligible, ineligible = [], override = null }) {
  const m = head('admit_card', university, student);
  m.blocks = [
    { kind: 'keyvalue', rows: [...studentRows(student), ['Semester', semester.name]] },
    { kind: 'heading', text: 'Permitted to sit examinations in' },
    { kind: 'table', head: ['Code', 'Course title', 'Section', 'Credit'], align: ['l', 'l', 'c', 'r'], rows: eligible.map((c) => [c.courseCode, c.courseTitle, c.sectionCode, money1(c.credit)]) },
  ];
  if (ineligible.length) {
    m.blocks.push({ kind: 'heading', text: 'Not permitted' });
    m.blocks.push({ kind: 'table', head: ['Code', 'Course title', 'Reason'], align: ['l', 'l', 'l'], rows: ineligible.map((c) => [c.courseCode, c.courseTitle, c.reason]) });
  }
  if (override) m.blocks.push({ kind: 'text', tone: 'small', text: `Issued with special approval: ${override}` });
  m.blocks.push({ kind: 'text', tone: 'small', text: 'Bring this admit card and your student ID card to every examination.' });
  m.blocks.push({ kind: 'signatures', labels: ['Student signature', 'Controller of Examinations'] });
  return m;
}

function buildEnrollmentConfirmation({ university, student, semester, confirmedAt, lines, totalCredits }) {
  const m = head('enrollment_confirmation', university, student);
  m.blocks = [
    { kind: 'keyvalue', rows: [...studentRows(student), ['Semester', semester.name], ['Registration confirmed', dateOnly(confirmedAt)]] },
    { kind: 'heading', text: 'Registered courses' },
    { kind: 'table', head: ['Code', 'Course title', 'Section', 'Credit', 'Teacher'], align: ['l', 'l', 'c', 'r', 'l'], rows: lines.map((l) => [l.courseCode, l.courseTitle, l.sectionCode, money1(l.credit), l.teacherName || '']) },
    { kind: 'summary', items: [['Total credits', money1(totalCredits)]] },
  ];
  return m;
}

function buildPaymentReceipt({ university, student, payment, invoice }) {
  const m = head('payment_receipt', university, student);
  const tk = (n) => Number(n).toFixed(2);
  m.blocks = [
    { kind: 'keyvalue', rows: studentRows(student) },
    { kind: 'heading', text: 'Payment' },
    { kind: 'keyvalue', rows: [['Receipt no.', payment.receiptNo], ['Date received', dateOnly(payment.paidAt)], ['Method', payment.method.replace('_', ' ')], ['Reference', payment.reference || '-'], ['Invoice no.', invoice.number], ['For', invoice.description]] },
    { kind: 'summary', items: [['Amount received (BDT)', tk(payment.amount)], ['Invoice total', tk(invoice.total)], ['Paid to date', tk(invoice.paid)], ['Balance', tk(invoice.balance)]] },
    { kind: 'text', tone: 'small', text: 'Invoice figures are as of the date this receipt was issued.' },
    { kind: 'signatures', labels: ['Received by', 'Accounts officer'] },
  ];
  return m;
}

const stable = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`) : JSON.stringify(v));
/** Same content gives the same hash, regardless of key order. Used to avoid issuing duplicates. */
const contentHash = (model) => crypto.createHash('sha256').update(stable({ type: model.type, university: model.university, student: model.student, blocks: model.blocks })).digest('hex');

const makeSerial = (type, id, now = new Date()) => `${DOC_TYPES[type].prefix}-${now.getUTCFullYear()}-${String(id).padStart(6, '0')}`;
const makeCode = () => crypto.randomBytes(6).toString('hex').toUpperCase();

module.exports = { DOC_TYPES, buildPaymentReceipt, buildTranscript, buildSemesterResult, buildAdmitCard, buildEnrollmentConfirmation, scaleLegend, contentHash, makeSerial, makeCode, stable };
