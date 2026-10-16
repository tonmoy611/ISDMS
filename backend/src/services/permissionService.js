'use strict';
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');

/** Effective permission codes: role defaults + user grants - user denies. Super Admin gets ['*']. */
async function forUser(user) {
  if (user.role === 'super_admin') return ['*'];
  const [rows] = await pool.query(
    `SELECT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id JOIN roles r ON r.id = rp.role_id WHERE r.code = ?
     UNION
     SELECT p.code FROM permissions p JOIN user_permissions up ON up.permission_id = p.id
       WHERE up.user_id = ? AND up.effect = 'grant'`, [user.role, user.id]);
  const set = new Set(rows.map((r) => r.code));
  const [denied] = await pool.query(
    `SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ? AND up.effect = 'deny'`, [user.id]);
  denied.forEach((r) => set.delete(r.code));
  return [...set].sort();
}

async function catalog() {
  const [perms] = await pool.query('SELECT code, module, description FROM permissions ORDER BY module, code');
  const [roles] = await pool.query('SELECT id, code, name FROM roles ORDER BY id');
  const [rp] = await pool.query(
    'SELECT r.code AS role, p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id');
  return {
    permissions: perms,
    roles: roles.map((r) => ({ code: r.code, name: r.name, permissions: rp.filter((x) => x.role === r.code).map((x) => x.code) })),
  };
}

async function validCodes(conn, codes) {
  if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string')) throw AppError.validation('Permissions must be a list of codes.');
  const unique = [...new Set(codes)];
  if (!unique.length) return [];
  const [rows] = await conn.query('SELECT id, code FROM permissions WHERE code IN (?)', [unique]);
  if (rows.length !== unique.length) throw AppError.validation('One or more permission codes do not exist.');
  return rows;
}

async function setRolePermissions(roleCode, codes) {
  return withTransaction(async (conn) => {
    const [[role]] = await conn.query('SELECT id FROM roles WHERE code = ?', [roleCode]);
    if (!role || roleCode === 'super_admin') throw AppError.badRequest('This role cannot be edited.');
    const rows = await validCodes(conn, codes);
    const [oldRows] = await conn.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', [role.id]);
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
    if (rows.length) await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [rows.map((r) => [role.id, r.id])]);
    return { before: oldRows.map((r) => r.code).sort(), after: rows.map((r) => r.code).sort() };
  });
}

async function userOverrides(userId) {
  const [rows] = await pool.query(
    'SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?', [userId]);
  return { grant: rows.filter((r) => r.effect === 'grant').map((r) => r.code).sort(), deny: rows.filter((r) => r.effect === 'deny').map((r) => r.code).sort() };
}

async function setUserOverrides(userId, grant, deny) {
  const overlap = grant.filter((c) => deny.includes(c));
  if (overlap.length) throw AppError.validation('A permission cannot be both granted and denied.', { overlap });
  return withTransaction(async (conn) => {
    const g = await validCodes(conn, grant);
    const d = await validCodes(conn, deny);
    const before = await userOverrides(userId);
    await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
    const values = [...g.map((r) => [userId, r.id, 'grant']), ...d.map((r) => [userId, r.id, 'deny'])];
    if (values.length) await conn.query('INSERT INTO user_permissions (user_id, permission_id, effect) VALUES ?', [values]);
    return { before, after: { grant: g.map((r) => r.code).sort(), deny: d.map((r) => r.code).sort() } };
  });
}

module.exports = { forUser, catalog, setRolePermissions, userOverrides, setUserOverrides };
