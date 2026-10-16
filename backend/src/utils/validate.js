'use strict';
const AppError = require('./AppError');

const isEmail = (v) => typeof v === 'string' && v.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v) => typeof v === 'string' && /^\+?[0-9]{7,15}$/.test(v);
const isLoginId = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{3,50}$/.test(v);
const isName = (v) => typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 150;

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw AppError.notFound();
  return id;
}

function parsePage(query, maxSize = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');

module.exports = { isDate, isEmail, isPhone, isLoginId, isName, parseId, parsePage, escapeLike };
