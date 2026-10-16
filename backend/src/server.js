'use strict';
const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');
const logger = require('./utils/logger');

const server = app.listen(env.port, () => {
  logger.info(`${env.appName} API v${env.version} listening`, { port: env.port, env: env.nodeEnv });
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (r) => logger.error('unhandledRejection', { reason: String(r) }));
process.on('uncaughtException', (e) => { logger.error('uncaughtException', { error: e.message }); process.exit(1); });
