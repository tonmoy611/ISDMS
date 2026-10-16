'use strict';
const { pool } = require('../config/db');
const logger = require('../utils/logger');

/** Records a security-relevant event. Never throws: an audit failure must not break the user's request. */
async function writeAudit({ ctx = {}, universityId = null, userId = null, action, targetType = null, targetId = null, oldValue = null, newValue = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (university_id, user_id, action, target_type, target_id, old_value, new_value, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [universityId, userId, action, targetType, targetId && String(targetId),
        oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null,
        ctx.ip || null, ctx.userAgent ? ctx.userAgent.slice(0, 255) : null],
    );
  } catch (err) {
    logger.error('Audit write failed', { action, error: err.message });
  }
}

module.exports = { writeAudit };
