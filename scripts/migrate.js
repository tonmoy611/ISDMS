'use strict';
// Usage: node scripts/migrate.js   (applies pending SQL files from database/migrations in order)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('../backend/node_modules/mysql2/promise');
const env = require('../backend/src/config/env');

(async () => {
  const conn = await mysql.createConnection({
    host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password,
    database: env.db.database, multipleStatements: true, charset: 'utf8mb4',
  });
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));
  const dir = path.resolve(__dirname, '../database/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const sum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(f)) {
      if (applied.get(f) !== sum) throw new Error(`Migration ${f} was modified after being applied. Add a new migration instead.`);
      continue;
    }
    console.log(`Applying ${f} ...`);
    await conn.query(sql); // MySQL DDL auto-commits; keep each file small and focused.
    await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [f, sum]);
    count++;
  }
  console.log(count ? `Applied ${count} migration(s).` : 'Database is up to date.');
  await conn.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
