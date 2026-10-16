'use strict';
/** Operational error with an HTTP status and a stable machine-readable code. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
  static badRequest(msg = 'Bad request', d) { return new AppError(400, 'BAD_REQUEST', msg, d); }
  static unauthorized(msg = 'Authentication required') { return new AppError(401, 'UNAUTHORIZED', msg); }
  static forbidden(msg = 'You do not have permission to do this') { return new AppError(403, 'FORBIDDEN', msg); }
  static notFound(msg = 'Resource not found') { return new AppError(404, 'NOT_FOUND', msg); }
  static conflict(msg = 'Conflict with existing data', d) { return new AppError(409, 'CONFLICT', msg, d); }
  static validation(msg = 'Validation failed', d) { return new AppError(422, 'VALIDATION_ERROR', msg, d); }
  static rateLimited(msg = 'Too many requests. Please wait and try again.') { return new AppError(429, 'RATE_LIMITED', msg); }
}
module.exports = AppError;
