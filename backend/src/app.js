'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const csrfGuard = require('./middleware/csrfGuard');
const env = require('./config/env');
const requestId = require('./middleware/requestId');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');

const app = express();
app.disable('x-powered-by');
if (env.trustProxy) app.set('trust proxy', 1);

app.use(requestId);
app.use(helmet());
app.use(compression());
app.use(cors({
  origin(origin, cb) {
    if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS_NOT_ALLOWED'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(csrfGuard);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => logger.info('request', { id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - start }));
  next();
});

app.use(env.apiPrefix, rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(AppError.rateLimited()),
}));

app.use(env.apiPrefix, require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
