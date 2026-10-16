'use strict';
const { pool } = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { emailProviders, smsProviders } = require('./providers');
const { templates } = require('./templates');

const smsEnabled = () => env.sms.provider !== 'none' && !!smsProviders[env.sms.provider];

const maskEmail = (e) => { const [u, d] = String(e).split('@'); return `${u[0]}***@${d}`; };
const maskPhone = (p) => { const s = String(p); return `${s.slice(0, 4)}${'*'.repeat(Math.max(0, s.length - 6))}${s.slice(-2)}`; };

/** Channels this user can receive on, with masked destinations that are safe to show before sign-in. */
function channelsFor(user) {
  const out = [];
  if (user.email) out.push({ channel: 'email', masked: maskEmail(user.email) });
  if (user.phone && smsEnabled()) out.push({ channel: 'sms', masked: maskPhone(user.phone) });
  return out;
}

async function dispatch(channel, provider, msg, meta) {
  let logId = null;
  try {
    const [r] = await pool.query(
      'INSERT INTO message_log (university_id, user_id, channel, template, recipient, subject, provider, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [meta.universityId ?? null, meta.userId ?? null, channel, meta.template, msg.to, msg.subject || null, provider.name, 'queued']);
    logId = r.insertId;
    const res = await provider.send(msg);
    await pool.query('UPDATE message_log SET status = ?, provider_message_id = ? WHERE id = ?', [res.logged ? 'logged' : 'sent', res.id || null, logId]);
    return { ok: true };
  } catch (err) {
    logger.error('Message delivery failed', { channel, template: meta.template, provider: provider.name, error: err.message });
    if (logId) await pool.query('UPDATE message_log SET status = ?, error = ? WHERE id = ?', ['failed', String(err.message).slice(0, 250), logId]).catch(() => {});
    return { ok: false };
  }
}

/** Never throws. Returns { ok }. ok=false means the message was NOT sent. */
async function send(channel, template, data, to, meta = {}) {
  const t = templates[template](data);
  if (channel === 'email') return dispatch('email', emailProviders[env.email.provider], { to, subject: t.subject, text: t.text, html: t.html }, { ...meta, template });
  if (!smsEnabled() || !t.sms) return { ok: false };
  return dispatch('sms', smsProviders[env.sms.provider], { to, text: t.sms }, { ...meta, template });
}

const quiet = (p) => p.catch((e) => logger.error('Notification error', { error: e.message }));

// Best-effort notifications: the user action has already succeeded, so a mail outage must not undo it.
const notify = {
  accountCreated: (u) => u.email && quiet(send('email', 'accountCreated', { fullName: u.fullName, loginId: u.loginId, appUrl: env.appUrl }, u.email, { userId: u.id, universityId: u.universityId })),
  enrollmentConfirmed: (u, data) => u.email && quiet(send('email', 'enrollmentConfirmation', { fullName: u.fullName, ...data }, u.email, { userId: u.id, universityId: u.universityId })),
  paymentConfirmed: (u, data) => u.email && quiet(send('email', 'paymentConfirmation', { fullName: u.fullName, ...data }, u.email, { userId: u.id, universityId: u.universityId })),
  passwordChanged: (u, how) => u.email && quiet(send('email', 'passwordChanged', { fullName: u.fullName, how }, u.email, { userId: u.id, universityId: u.universityId })),
};

module.exports = { send, notify, channelsFor, maskEmail, maskPhone, smsEnabled };
