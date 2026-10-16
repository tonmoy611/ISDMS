'use strict';
// No database needed: document models, the HTML renderer, hashing, and unauthenticated access.
const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
const m = require('../backend/src/services/documentModel');
const { renderHtml } = require('../backend/src/services/documentHtml');
const rules = require('../backend/src/services/resultRules');
const app = require('../backend/src/app');

const university = { name: 'Demo University', address: 'Dhaka' };
const student = { id: 1, code: '2026001', fullName: 'Ana <Rahman>', program: 'BSc CSE', department: 'CSE', batch: 'Batch 1', admissionDate: '2026-01-05' };
const row = (courseId, sem, order, credit, gp, pass = true, letter = 'A') => ({ semesterId: sem, semesterName: `Semester ${sem}`, semesterOrder: order, courseId, courseCode: `C${courseId}`, courseTitle: `Course ${courseId}`, credit, gradePoint: gp, isPass: pass, letterGrade: letter, percentage: 80 });
const summary = rules.summarizeStudent([row(1, 10, 1, 3, 4), row(2, 10, 1, 3, 3, true, 'B'), row(3, 20, 2, 3, 0, false, 'F')]);

test('transcript model has student details, every semester, the CGPA and the grading legend', () => {
  const t = m.buildTranscript({ university, student, summary, scale: rules.UGC_DEFAULT_SCALE });
  const text = JSON.stringify(t);
  assert.ok(text.includes('Semester 10') && text.includes('Semester 20') && text.includes('Grading scale') && text.includes('"CGPA"'));
  assert.ok(text.includes('2026001'));
  const legend = m.scaleLegend(rules.UGC_DEFAULT_SCALE);
  assert.deepStrictEqual(legend[0], ['A+', '80 - 100', '4.00']);
  assert.deepStrictEqual(legend[1], ['A', '75 - below 80', '3.75']);
  assert.deepStrictEqual(legend[legend.length - 1], ['F', '0 - below 40', '0.00']);
});
test('a failed course is marked and an empty transcript says so', () => {
  const t = m.buildTranscript({ university, student, summary, scale: [] });
  assert.ok(JSON.stringify(t).includes('F (F)'));
  const empty = m.buildTranscript({ university, student, summary: rules.summarizeStudent([]), scale: [] });
  assert.ok(JSON.stringify(empty).includes('No results have been published'));
});
test('semester result gives the cumulative CGPA up to that semester only', () => {
  const upTo = summary.semesters.filter((s) => s.order <= 1);
  const doc = m.buildSemesterResult({ university, student, semester: summary.semesters[0], upTo });
  const sum = doc.blocks.find((b) => b.kind === 'summary').items;
  assert.deepStrictEqual(sum.slice(0, 2), [['Semester GPA', '3.50'], ['CGPA to date', '3.50']]);
  const later = m.buildSemesterResult({ university, student, semester: summary.semesters[1], upTo: summary.semesters });
  assert.strictEqual(later.blocks.find((b) => b.kind === 'summary').items[1][1], '2.33');
});
test('admit card lists permitted and refused courses and any override reason', () => {
  const d = m.buildAdmitCard({ university, student, semester: { name: 'Spring' }, eligible: [{ courseCode: 'C1', courseTitle: 'X', sectionCode: 'A', credit: 3 }], ineligible: [{ courseCode: 'C2', courseTitle: 'Y', reason: 'Attendance 60% is below 75%' }], override: 'Medical leave approved' });
  const t = JSON.stringify(d);
  assert.ok(t.includes('Not permitted') && t.includes('Attendance 60%') && t.includes('Medical leave approved') && t.includes('Controller of Examinations'));
});
test('HTML output escapes data, shows serial and code, and carries no script', () => {
  const model = m.buildEnrollmentConfirmation({ university, student, semester: { name: 'Spring' }, confirmedAt: '2026-01-10T00:00:00Z', lines: [{ courseCode: 'C1', courseTitle: '<script>x</script>', sectionCode: 'A', credit: 3, teacherName: null }], totalCredits: 3 });
  model.footer = { serial: 'EC-2026-000001', code: 'ABC123DEF456', issuedAt: '2026-01-10', verifyUrl: 'https://x.edu/verify-document?s=EC-2026-000001&c=ABC123DEF456', official: true };
  const html = renderHtml(model);
  assert.ok(!html.includes('<script') && html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Ana &lt;Rahman&gt;'));
  assert.ok(html.includes('EC-2026-000001') && html.includes('ABC123DEF456'));
  assert.ok(!html.includes('NOT AN OFFICIAL') && !html.includes('REVOKED'));
  model.footer.official = false;
  assert.ok(renderHtml(model, { revoked: true }).includes('NOT AN OFFICIAL') && renderHtml(model, { revoked: true }).includes('REVOKED'));
});
test('content hash ignores key order and footer, and changes with the content', () => {
  const a = m.buildEnrollmentConfirmation({ university, student, semester: { name: 'Spring' }, confirmedAt: '2026-01-10', lines: [], totalCredits: 0 });
  const b = JSON.parse(JSON.stringify(a));
  b.footer = { serial: 'X' };
  const reordered = { blocks: b.blocks, student: b.student, university: b.university, type: b.type, title: b.title, footer: b.footer };
  assert.strictEqual(m.contentHash(a), m.contentHash(reordered));
  const c = m.buildEnrollmentConfirmation({ university, student, semester: { name: 'Fall' }, confirmedAt: '2026-01-10', lines: [], totalCredits: 0 });
  assert.notStrictEqual(m.contentHash(a), m.contentHash(c));
});
test('payment receipt shows the amount, reference, invoice and balance', () => {
  const r = m.buildPaymentReceipt({ university, student, payment: { receiptNo: 'RC-2026-000009', amount: '12000.00', method: 'bank_transfer', reference: 'TRX77', paidAt: '2026-02-01T10:00:00Z' }, invoice: { number: 'INV-2026-000004', description: 'Spring 2026 fees', total: '30000.00', paid: '12000.00', balance: 18000 } });
  const text = JSON.stringify(r);
  assert.ok(text.includes('RC-2026-000009') && text.includes('12000.00') && text.includes('bank transfer') && text.includes('TRX77') && text.includes('18000.00') && text.includes('Spring 2026 fees'));
  assert.strictEqual(m.makeSerial('payment_receipt', 5, new Date('2026-01-01T00:00:00Z')), 'PR-2026-000005');
});
test('serial and verification code formats', () => {
  assert.strictEqual(m.makeSerial('transcript', 123, new Date('2026-05-01T00:00:00Z')), 'TR-2026-000123');
  assert.match(m.makeCode(), /^[0-9A-F]{12}$/);
  assert.notStrictEqual(m.makeCode(), m.makeCode());
});

let server; let base;
test.before(async () => { await new Promise((res) => { server = app.listen(0, res); }); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());
test('document endpoints require a session, but verification is public', async () => {
  for (const p of ['/documents', '/documents/me', '/documents/1', '/documents/1/print']) assert.strictEqual((await fetch(`${base}${p}`)).status, 401, p);
  const v = await fetch(`${base}/verify/TR-2026-000001`); // no code
  assert.strictEqual(v.status, 422);
});
