// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { logger } = require('../shared-lib/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled OKF error', { error: err.message, path: req.path, method: req.method });
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
