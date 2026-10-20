 'use strict';
const env = require('../../config/env');

/** BD mobile numbers to the 8801XXXXXXXXX form most local gateways expect. */
function normalizeBdPhone(raw) {
  const d = String(raw).replace(/[^\d]/g, '');
  if (/^01\d{9}$/.test(d)) return `88${d}`;
  return d;
}

/** Parses 'ISDMS <no-reply@example.edu>' or 'no-reply@example.edu' into { email, name? } (Brevo sender format). */
function parseSender(raw) {
  const s = String(raw || '').trim().replace(/^"+|"+$/g, '');
  const match = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"+|"+$/g, '');
    const email = match[2].trim();
    return name ? { email, name } : { email };
  }
  return { email: s, name: env.appName };
}

// Every provider: async send(message) -> { id?, logged? }. It must THROW on failure; it must never pretend to succeed.
const emailProviders = {
  // Development only: prints to the server console. Nothing is delivered. Production refuses to start with this.
  log: {
    name: 'log',
    send: async (m) => {
      console.log(`[DEV EMAIL] to=${m.to} subject="${m.subject}"\n${m.text}`);
      return { logged: true };
    },
  },

  smtp: {
    name: 'smtp',
    transport: null,
    async send(m) {
      // Loaded lazily so the app still starts without SMTP when using another provider.
      const nodemailer = require('nodemailer');
      this.transport = this.transport || nodemailer.createTransport({
        host: env.email.host,
        port: env.email.port,
        secure: env.email.secure,
        auth: env.email.user ? { user: env.email.user, pass: env.email.pass } : undefined,
      });
      const info = await this.transport.sendMail({
        from: env.email.from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        html: m.html,
      });
      return { id: info.messageId };
    },
  },

  // Brevo HTTP API: works on hosts that block outbound SMTP ports (like Render free).
  // Needs BREVO_API_KEY and EMAIL_FROM; the sender address must be verified in Brevo.
  brevo: {
    name: 'brevo',
    async send(m) {
      if (!env.email.brevoApiKey) throw new Error('Brevo is not configured: BREVO_API_KEY is missing');
      const sender = parseSender(env.email.from);
      if (!sender.email) throw new Error('Brevo is not configured: EMAIL_FROM is missing');

      const payload = {
        sender,
        to: [{ email: m.to }],
        subject: m.subject,
        textContent: m.text,
      };
      if (m.html) payload.htmlContent = m.html;

      const res = await fetch(env.email.brevoApiUrl, {
        method: 'POST',
        headers: {
          'api-key': env.email.brevoApiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(`Brevo rejected the email (${res.status}): ${body?.message || 'unknown'}`);
      }
      return { id: body?.messageId || null };
    },
  },
};

const smsProviders = {
  log: {
    name: 'log',
    send: async (m) => {
      console.log(`[DEV SMS] to=${m.to}\n${m.text}`);
      return { logged: true };
    },
  },

  // Check the field names and success code against your account's current gateway documentation before going live.
  bulksmsbd: {
    name: 'bulksmsbd',
    async send(m) {
      const res = await fetch(env.sms.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.sms.apiKey,
          senderid: env.sms.senderId,
          number: normalizeBdPhone(m.to),
          message: m.text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || Number(body.response_code) !== 202) {
        throw new Error(`SMS gateway did not accept the message (${body?.response_code ?? res.status})`);
      }
      return { id: null };
    },
  },
};

module.exports = { emailProviders, smsProviders, normalizeBdPhone };