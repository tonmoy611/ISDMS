'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'ISDMS',
  version: process.env.APP_VERSION || '0.1.0',
  developer: 'TD-X Lab',
  port: int(process.env.PORT, 5000),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  corsOrigins: list(process.env.CORS_ORIGINS),
  trustProxy: process.env.TRUST_PROXY === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 900000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    poolLimit: int(process.env.DB_POOL_LIMIT, 10),
  },
};
env.isProd = env.nodeEnv === 'production';
env.auth = {
  jwtSecret: process.env.JWT_SECRET || '',
  accessTtlMin: int(process.env.ACCESS_TOKEN_TTL_MIN, 15),
  refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 7),
  maxFailedAttempts: int(process.env.MAX_FAILED_LOGINS, 5),
  lockMinutes: int(process.env.LOCK_MINUTES, 15),
  bcryptCost: int(process.env.BCRYPT_COST, 12),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env.isProd,
};
if (env.nodeEnv === 'test' && !env.auth.jwtSecret) env.auth.jwtSecret = 'test-only-secret-test-only-secret-1234';
if (env.auth.jwtSecret.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}

env.timezone = process.env.APP_TIMEZONE || 'Asia/Dhaka'; // used to decide what "today" is for registration dates
env.attendanceEditDays = int(process.env.ATTENDANCE_EDIT_DAYS, 7);
env.appUrl = process.env.APP_URL || 'http://localhost:5173';
env.email = {
  provider: process.env.EMAIL_PROVIDER || 'log', // smtp | log (log is development only)
  host: process.env.SMTP_HOST || '', port: int(process.env.SMTP_PORT, 587), secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASSWORD || '', from: process.env.EMAIL_FROM || '',
};
env.sms = {
  provider: process.env.SMS_PROVIDER || 'log', // none | log | bulksmsbd
  apiUrl: process.env.SMS_API_URL || 'https://bulksmsbd.net/api/smsapi', apiKey: process.env.SMS_API_KEY || '', senderId: process.env.SMS_SENDER_ID || '',
};
env.verification = {
  codeTtlMin: int(process.env.VERIFICATION_CODE_TTL_MIN, 10),
  maxAttempts: int(process.env.VERIFICATION_MAX_ATTEMPTS, 5),
  maxSends: int(process.env.VERIFICATION_MAX_SENDS_PER_15MIN, 3),
};

// Fail fast in production if required secrets/config are missing.
if (env.isProd) {
  const missing = [];
  if (!env.db.user) missing.push('DB_USER');
  if (!env.db.password) missing.push('DB_PASSWORD');
  if (!env.db.database) missing.push('DB_NAME');
  if (!env.corsOrigins.length) missing.push('CORS_ORIGINS');
  if (env.email.provider !== 'smtp') missing.push('EMAIL_PROVIDER=smtp');
  else for (const [k, val] of [['SMTP_HOST', env.email.host], ['EMAIL_FROM', env.email.from]]) if (!val) missing.push(k);
  if (env.sms.provider === 'log') missing.push('SMS_PROVIDER (none or a real provider; "log" is development only)');
  if (env.sms.provider === 'bulksmsbd') for (const [k, val] of [['SMS_API_KEY', env.sms.apiKey], ['SMS_SENDER_ID', env.sms.senderId]]) if (!val) missing.push(k);
  if (!process.env.APP_URL) missing.push('APP_URL');
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}
module.exports = env;
