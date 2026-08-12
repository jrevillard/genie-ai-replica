// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF Server — GENIE.AI Open Knowledge Format governed serving layer (skeleton).
// Shared observability modules (tracing/metrics) MUST be required first for OTel auto-instrumentation.
require('./shared-lib/tracing');
require('./shared-lib/metrics');
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { logger } = require('./shared-lib/logger'); // shared logger — imported directly, not the full index
const healthRoutes = require('./routes/health-routes');
const okfRoutes = require('./routes/okf-routes');
const errorHandler = require('./middleware/error-handler');

/**
 * Create an isolated Express app (createApp pattern for testability).
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
  app.use((req, res, next) => { req.startedAt = Date.now(); next(); });

  // Public health endpoints (no auth)
  app.use('/health', healthRoutes);
  app.use('/ready', healthRoutes);
  // OKF API surface (auth applied per-route within the router)
  app.use('/api/okf', okfRoutes);

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => logger.info(`OKF Server listening on port ${PORT}`));
}

module.exports = { createApp };
