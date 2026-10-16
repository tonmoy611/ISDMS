'use strict';
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const env = require('../config/env');

function notFound(req, res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl.split('?')[0]} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again later.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409; code = 'CONFLICT'; message = 'A record with the same unique value already exists.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_REQUEST'; message = 'Request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 400; code = 'BAD_REQUEST'; message = 'Request body is too large.';
  } else if (err.message === 'CORS_NOT_ALLOWED') {
    status = 403; code = 'FORBIDDEN'; message = 'Origin not allowed.';
  }

  if (status >= 500) {
    // Full detail goes to logs only, never to the client.
    logger.error('Unhandled error', { requestId: req.id, path: req.originalUrl, error: err.message, stack: env.isProd ? undefined : err.stack });
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}), requestId: req.id },
  });
}

module.exports = { notFound, errorHandler };
