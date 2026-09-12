// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { logger } = require('../shared-lib/logger');

function errorHandler(err, req, res, next) {
  // Interpolate into the message — the shared log format drops the meta object,
  // which hid a live 500's root cause ("db.query(...).all is not a function")
  // behind a bare "Unhandled OKF error" line for over an hour (2026-09-12).
  logger.error(
    'Unhandled OKF error: ' +
      (err && err.stack ? err.stack : String(err)) +
      ' path=' +
      req.path +
      ' method=' +
      req.method
  );
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || 500;
  // Don't leak internal error detail on 500-class errors; only echo messages for client errors.
  const isClientError = status < 500;
  const body = {
    error: err.code || 'INTERNAL_ERROR',
    message: isClientError ? err.message || 'Error' : 'Internal server error'
  };
  // Include structured details for client errors (e.g. joi validation failures).
  if (isClientError && err.details) {
    body.details = err.details;
  }
  res.status(status).json(body);
}

module.exports = errorHandler;
