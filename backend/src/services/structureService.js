'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { writeAudit } = require('./audit');

/** Which university a request works in. A university-scoped actor is pinned to theirs; Super Admin chooses. */
function resolveUniversity(actor, raw, required) {
  if (actor.university_id != null) return actor.university_id;
  if (actor.role !== 'super_admin') throw AppError.forbidden('Your account is not linked to a university.');
  if (raw == null || raw === '') {
    if (required) throw AppError.validation('Choose a university.', { universityId: 'Choose a university.' });
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw AppError.validation('Choose a valid university.', { universityId: 'Choose a valid university.' });
  return id;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);

async function checkField(f, raw, universityId, conn) {
  if (raw === undefined || raw === null || raw === '') {
    if (f.required) return { error: 'This field is required.' };
    return { value: f.default !== undefined ? f.default : null };
  }
  switch (f.type) {
    case 'string': {
      const s = String(raw).trim();
      if (s.length > f.max) return { error: `Use at most ${f.max} characters.` };
      if (f.pattern && !f.pattern.test(s)) return { error: f.patternMsg };
      return { value: s };
    }
    case 'enum': return f.values.includes(raw) ? { value: raw } : { error: `Choose one of: ${f.values.join(', ')}.` };
    case 'int': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= f.min && n <= f.max ? { value: n } : { error: `Enter a whole number from ${f.min} to ${f.max}.` };
    }
    case 'decimal': {
      const n = Number(raw);
      const ok = Number.isFinite(n) && n >= f.min && n <= f.max && Math.abs(n / f.step - Math.round(n / f.step)) < 1e-9;
      return ok ? { value: Math.round(n * 10) / 10 } : { error: `Enter a number from ${f.min} to ${f.max} in steps of ${f.step}.` };
    }
    case 'date': return isDate(raw) ? { value: raw } : { error: 'Enter a valid date (YYYY-MM-DD).' };
    case 'time': return isTime(raw) ? { value: raw.length === 5 ? `${raw}:00` : raw } : { error: 'Enter a valid time (HH:MM).' };
    case 'ref': {
      const id = Number(raw);
      if (!Number.isInteger(id) || id < 1) return { error: 'Choose a valid option.' };
      // The parent must belong to the SAME university: this is what keeps tenants isolated.
      const [rows] = await conn.query(`SELECT id FROM ${f.ref} WHERE id = ? AND university_id = ?`, [id, universityId]);
      return rows[0] ? { value: id } : { error: 'That option does not exist in this university.' };
    }
    default: return { error: 'Unsupported field.' };
  }
}

async function validate(cfg, body, universityId, existing) {
  const errors = {};
  const values = {};
  const b = body || {};
  for (const f of cfg.fields) {
    if (existing && !(f.key in b)) { values[f.col] = existing[f.col]; continue; }
    const r = await checkField(f, b[f.key], universityId, pool);
    if (r.error) errors[f.key] = r.error; else values[f.col] = r.value;
  }
  if (!Object.keys(errors).length) for (const rule of cfg.rules || []) Object.assign(errors, rule(values) || {});
  if (Object.keys(errors).length) throw AppError.validation('Please check the highlighted fields.', errors);
  return values;
}

function selectSql(cfg) {
  const cols = ['t.id', 't.university_id', ...cfg.fields.map((f) => `t.${f.col}`)];
  if (cfg.current) cols.push('t.is_current');
  const joins = cfg.fields.filter((f) => f.type === 'ref').map((f) => ({ f, alias: `j_${f.col}` }));
  joins.forEach(({ f, alias }) => cols.push(`${alias}.name AS ${f.labelKey}`));
  const joinSql = joins.map(({ f, alias }) => ` LEFT JOIN ${f.ref} ${alias} ON ${alias}.id = t.${f.col}`).join('');
  return `SELECT ${cols.join(', ')} FROM ${cfg.table} t${joinSql}`;
}

function dto(cfg, r) {
  const o = { id: r.id, universityId: r.university_id };
  for (const f of cfg.fields) {
    o[f.key] = f.type === 'decimal' && r[f.col] != null ? Number(r[f.col]) : r[f.col];
    if (f.type === 'ref') o[f.labelKey] = r[f.labelKey];
  }
  if (cfg.current) o.isCurrent = !!r.is_current;
  return o;
}

function dupError(err) {
  if (err.code !== 'ER_DUP_ENTRY') return err;
  const field = /_code'?$|_code\b/.test(err.message) ? 'code' : 'name';
  return AppError.conflict(`That ${field} is already used in this university.`, { [field]: 'Already in use.' });
}

async function list(actor, cfg, query) {
  const uni = resolveUniversity(actor, query.universityId, false);
  const { page, pageSize, offset } = v.parsePage(query, 200);
  const params = [];
  let where = ' WHERE 1 = 1';
  if (uni) { where += ' AND t.university_id = ?'; params.push(uni); }
  for (const f of cfg.fields) {
    if (f.type === 'ref' && query[f.key]) { where += ` AND t.${f.col} = ?`; params.push(Number(query[f.key]) || 0); }
  }
  for (const f of cfg.fields) {
    if (f.type === 'enum' && query[f.key] && f.values.includes(String(query[f.key]))) { where += ` AND t.${f.col} = ?`; params.push(String(query[f.key])); }
  }
  if (query.q) {
    const like = `%${v.escapeLike(String(query.q).slice(0, 100))}%`;
    where += ` AND (${cfg.search.map((c) => `t.${c} LIKE ?`).join(' OR ')})`;
    params.push(...cfg.search.map(() => like));
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${cfg.table} t${where}`, params);
  const [rows] = await pool.query(`${selectSql(cfg)}${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { items: rows.map((r) => dto(cfg, r)), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function getRow(actor, cfg, id) {
  const params = [id];
  let sql = `${selectSql(cfg)} WHERE t.id = ?`;
  if (actor.university_id != null) { sql += ' AND t.university_id = ?'; params.push(actor.university_id); }
  else if (actor.role !== 'super_admin') throw AppError.forbidden();
  const [rows] = await pool.query(sql, params);
  if (!rows[0]) throw AppError.notFound(`${cfg.label} not found`);
  return rows[0];
}

const get = async (actor, cfg, id) => dto(cfg, await getRow(actor, cfg, id));

async function create(actor, cfg, body, ctx) {
  const uni = resolveUniversity(actor, body?.universityId, true);
  const [u] = await pool.query("SELECT id FROM universities WHERE id = ? AND status = 'active'", [uni]);
  if (!u[0]) throw AppError.validation('University not found or inactive.', { universityId: 'University not found or inactive.' });
  const values = await validate(cfg, body, uni, null);
  const cols = Object.keys(values);
  let id;
  try {
    const [r] = await pool.query(`INSERT INTO ${cfg.table} (university_id, ${cols.join(', ')}) VALUES (?${cols.map(() => ', ?').join('')})`, [uni, ...cols.map((c) => values[c])]);
    id = r.insertId;
  } catch (err) { throw dupError(err); }
  await writeAudit({ ctx, userId: actor.id, universityId: uni, action: 'structure_created', targetType: cfg.table, targetId: id, newValue: values });
  return get(actor, cfg, id);
}

async function update(actor, cfg, id, body, ctx) {
  const row = await getRow(actor, cfg, id);
  const values = await validate(cfg, body, row.university_id, row);
  const cols = Object.keys(values);
  try {
    await pool.query(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => values[c]), id]);
  } catch (err) { throw dupError(err); }
  const oldValue = Object.fromEntries(cols.map((c) => [c, row[c]]));
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'structure_updated', targetType: cfg.table, targetId: id, oldValue, newValue: values });
  return get(actor, cfg, id);
}

async function remove(actor, cfg, id, ctx) {
  const row = await getRow(actor, cfg, id);
  try {
    await pool.query(`DELETE FROM ${cfg.table} WHERE id = ?`, [id]);
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') throw AppError.conflict(`This ${cfg.label.toLowerCase()} is in use. Set it to inactive instead of deleting it.`);
    throw err;
  }
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'structure_deleted', targetType: cfg.table, targetId: id, oldValue: dto(cfg, row) });
}

async function setCurrent(actor, cfg, id, ctx) {
  if (!cfg.current) throw AppError.notFound();
  const row = await getRow(actor, cfg, id);
  await withTransaction(async (conn) => {
    await conn.query(`UPDATE ${cfg.table} SET is_current = 0 WHERE university_id = ?`, [row.university_id]);
    await conn.query(`UPDATE ${cfg.table} SET is_current = 1 WHERE id = ?`, [id]);
  });
  await writeAudit({ ctx, userId: actor.id, universityId: row.university_id, action: 'structure_set_current', targetType: cfg.table, targetId: id });
  return get(actor, cfg, id);
}

module.exports = { list, get, create, update, remove, setCurrent, resolveUniversity };
