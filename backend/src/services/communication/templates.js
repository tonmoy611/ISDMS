'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(heading, lines, footer) {
  const text = [heading, '', ...lines, '', footer, '', 'ISDMS by TD-X Lab'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;color:#10272b">
<h2 style="margin:0 0 12px">${esc(heading)}</h2>${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}
<p style="margin:16px 0 0;color:#50666a;font-size:13px">${esc(footer)}</p><p style="color:#50666a;font-size:13px">ISDMS by TD-X Lab</p></div>`;
  return { text, html };
}

const templates = {
  accountCreated: ({ fullName, loginId, appUrl }) => ({
    subject: 'Your ISDMS account has been created',
    ...layout(`Welcome, ${fullName}`, [
      'A university administrator created an account for you.',
      `Your login ID is: ${loginId}`,
      'The university office will give you your temporary password. It is not included in this email.',
      `Sign in at ${appUrl}/login. On your first sign-in you will confirm your identity with a one-time code sent to your email or phone, then choose your own password.`,
    ], 'If you did not expect this, ignore this email or contact your university office.'),
  }),
  verificationCode: ({ fullName, code, minutes }) => ({
    subject: 'Your ISDMS verification code',
    sms: `ISDMS verification code: ${code}. Valid for ${minutes} minutes. Do not share it with anyone.`,
    ...layout(`Hello ${fullName}`, [`Your verification code is: ${code}`, `It expires in ${minutes} minutes and works only once.`], 'ISDMS staff will never ask you for this code.'),
  }),
  passwordResetCode: ({ fullName, code, minutes }) => ({
    subject: 'Your ISDMS password reset code',
    sms: `ISDMS password reset code: ${code}. Valid for ${minutes} minutes. Do not share it with anyone.`,
    ...layout(`Hello ${fullName}`, [`Your password reset code is: ${code}`, `It expires in ${minutes} minutes and works only once.`], 'If you did not ask for this, ignore it. Your password has not changed.'),
  }),
  enrollmentConfirmation: ({ fullName, semester, courses, totalCredits }) => ({
    subject: `Course registration confirmed: ${semester}`,
    ...layout(`Hello ${fullName}`, [`Your registration for ${semester} is confirmed.`, ...courses.map((c) => `${c.code} ${c.title} (section ${c.section}, ${c.credit} credits)`), `Total credits: ${totalCredits}`],
      'If this does not look right, contact your university office before the add/drop deadline.'),
  }),
  paymentConfirmation: ({ fullName, amount, receiptNo, invoiceNo, balance }) => ({
    subject: `Payment received: ${receiptNo}`,
    ...layout(`Hello ${fullName}`, [`We received your payment of BDT ${amount}.`, `Receipt no.: ${receiptNo}`, `Invoice no.: ${invoiceNo}`, `Balance remaining: BDT ${balance}`],
      'You can download the receipt from My documents. If you do not recognise this payment, contact the accounts office.'),
  }),
  passwordChanged: ({ fullName, how }) => ({
    subject: 'Your ISDMS password was changed',
    ...layout(`Hello ${fullName}`, [`Your password was changed (${how}). You were signed out on other devices.`], 'If this was not you, contact your university administration immediately.'),
  }),
};

module.exports = { templates, esc };
