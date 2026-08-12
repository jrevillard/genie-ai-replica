// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { logger } = require('../shared-lib/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled OKF error', { error: err.message, path: req.path, method: req.method });
  res.status(err.status || 500).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Internal server error'
  });
}

module.exports = errorHandler;
