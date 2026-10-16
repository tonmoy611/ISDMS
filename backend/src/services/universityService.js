'use strict';
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { writeAudit } = require('./audit');

const COLS = 'id, code, name, short_name, contact_email, contact_phone, address, status, created_at';
const dto = (u) => ({ id: u.id, code: u.code, name: u.name, shortName: u.short_name, contactEmail: u.contact_email, contactPhone: u.contact_phone, address: u.address, status: u.status, createdAt: u.created_at });
const isPlatform = (actor) => actor.role === 'super_admin' && actor.university_id == null;

async function list(actor, query) {
  const { page, pageSize, offset } = v.parsePage(query, 200);
  const params = [];
  let where = ' WHERE deleted_at IS NULL';
  if (actor.university_id != null) { where += ' AND id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') where += ' AND 1 = 0';
  if (query.q) {
    const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`;
    where += ' AND (code LIKE ? OR name LIKE ?)'; params.push(like, like);
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM universities${where}`, params);
  const [rows] = await pool.query(`SELECT ${COLS} FROM universities${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map(dto), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function getVisible(actor, id) {
  if (actor.university_id != null && actor.university_id !== id) throw AppError.notFound('University not found');
  if (actor.university_id == null && actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(`SELECT ${COLS} FROM universities WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw AppError.notFound('University not found');
  return rows[0];
}

function check(b, creating) {
  const e = {};
  if (creating && !(typeof b.code === 'string' && /^[A-Za-z0-9._-]{2,30}$/.test(b.code))) e.code = 'Use 2-30 letters, numbers, dots, dashes or underscores.';
  if (!v.isName(b.name)) e.name = 'Enter the university name.';
  if (b.shortName && String(b.shortName).length > 50) e.shortName = 'Use at most 50 characters.';
  if (b.contactEmail && !v.isEmail(b.contactEmail)) e.contactEmail = 'Enter a valid email address.';
  if (b.contactPhone && !v.isPhone(b.contactPhone)) e.contactPhone = 'Enter digits only, with an optional leading +.';
  if (b.address && String(b.address).length > 255) e.address = 'Use at most 255 characters.';
  if (Object.keys(e).length) throw AppError.validation('Please check the highlighted fields.', e);
}

async function create(actor, body, ctx) {
  if (!isPlatform(actor)) throw AppError.forbidden('Only the platform Super Admin can create universities.');
  const b = body || {};
  check(b, true);
  let id;
  try {
    const [r] = await pool.query('INSERT INTO universities (code, name, short_name, contact_email, contact_phone, address) VALUES (?, ?, ?, ?, ?, ?)',
      [b.code, b.name.trim(), b.shortName || null, b.contactEmail || null, b.contactPhone || null, b.address || null]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw AppError.conflict('That university code is already used.', { code: 'Already in use.' });
    throw err;
  }
  await writeAudit({ ctx, userId: actor.id, universityId: id, action: 'university_created', targetType: 'university', targetId: id, newValue: { code: b.code, name: b.name } });
  return dto(await getVisible(actor, id));
}

async function update(actor, id, body, ctx) {
  const old = await getVisible(actor, id);
  const b = { ...dto(old), ...(body || {}) };
  check(b, false);
  await pool.query('UPDATE universities SET name = ?, short_name = ?, contact_email = ?, contact_phone = ?, address = ? WHERE id = ?',
    [b.name.trim(), b.shortName || null, b.contactEmail || null, b.contactPhone || null, b.address || null, id]);
  await writeAudit({ ctx, userId: actor.id, universityId: id, action: 'university_updated', targetType: 'university', targetId: id, oldValue: dto(old), newValue: { name: b.name, shortName: b.shortName, contactEmail: b.contactEmail, contactPhone: b.contactPhone, address: b.address } });
  return dto(await getVisible(actor, id));
}

async function setStatus(actor, id, status, ctx) {
  if (!isPlatform(actor)) throw AppError.forbidden('Only the platform Super Admin can change a university status.');
  if (!['active', 'inactive'].includes(status)) throw AppError.validation('Choose active or inactive.', { status: 'Choose active or inactive.' });
  const old = await getVisible(actor, id);
  await pool.query('UPDATE universities SET status = ? WHERE id = ?', [status, id]);
  await writeAudit({ ctx, userId: actor.id, universityId: id, action: 'university_status_changed', targetType: 'university', targetId: id, oldValue: { status: old.status }, newValue: { status } });
  return dto(await getVisible(actor, id));
}

module.exports = { list, create, update, setStatus, get: async (a, id) => dto(await getVisible(a, id)) };
