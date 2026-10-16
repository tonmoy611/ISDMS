'use strict';
const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { parseId } = require('../../utils/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const requirePermission = require('../../middleware/requirePermission');
const perms = require('../../services/permissionService');
const users = require('../../services/userService');
const { writeAudit } = require('../../services/audit');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
router.use(authenticate());

router.get('/', requirePermission('permissions.view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await perms.catalog() });
}));

// Changing permissions is Super Admin only. It is not delegable, to prevent privilege escalation.
router.put('/roles/:code', authorize(), asyncHandler(async (req, res) => {
  const { before, after } = await perms.setRolePermissions(req.params.code, req.body?.permissions);
  await writeAudit({ ctx: ctx(req), userId: req.user.id, universityId: req.user.university_id, action: 'role_permissions_changed', targetType: 'role', targetId: req.params.code, oldValue: { permissions: before }, newValue: { permissions: after } });
  res.json({ success: true, data: { permissions: after } });
}));

router.get('/users/:id', requirePermission('permissions.view'), asyncHandler(async (req, res) => {
  const target = await users.get(req.user, parseId(req.params.id));
  const [effective, overrides, catalog] = await Promise.all([
    perms.forUser({ id: target.id, role: target.role }), perms.userOverrides(target.id), perms.catalog()]);
  const role = catalog.roles.find((r) => r.code === target.role);
  res.json({ success: true, data: { role: target.role, rolePermissions: role ? role.permissions : [], overrides, effective } });
}));

router.put('/users/:id', authorize(), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const target = await users.get(req.user, id);
  if (target.role === 'super_admin') throw AppError.badRequest('Super Admin accounts always have full access.');
  const { grant = [], deny = [] } = req.body || {};
  if (!Array.isArray(grant) || !Array.isArray(deny)) throw AppError.validation('grant and deny must be lists.');
  const { before, after } = await perms.setUserOverrides(id, grant, deny);
  await writeAudit({ ctx: ctx(req), userId: req.user.id, universityId: target.universityId, action: 'user_permissions_changed', targetType: 'user', targetId: id, oldValue: before, newValue: after });
  res.json({ success: true, data: { overrides: after } });
}));

module.exports = router;
