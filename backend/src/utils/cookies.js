'use strict';
const env = require('../config/env');

const ACCESS = 'isdms_at';
const REFRESH = 'isdms_rt';
const isProd = process.env.NODE_ENV === 'production';
const base = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };
const refreshPath = `${env.apiPrefix}/auth`;

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS, accessToken, { ...base, path: '/', maxAge: env.auth.accessTtlMin * 60 * 1000 });
  res.cookie(REFRESH, refreshToken, { ...base, path: refreshPath, maxAge: env.auth.refreshTtlDays * 86400 * 1000 });
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS, { ...base, path: '/' });
  res.clearCookie(REFRESH, { ...base, path: refreshPath });
}

module.exports = { ACCESS, REFRESH, setAuthCookies, clearAuthCookies };
