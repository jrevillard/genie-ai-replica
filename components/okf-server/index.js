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
const metricsMiddleware = require('./shared-lib/metrics-middleware'); // shared OTel HTTP metrics → OTLP (MELT)
const healthRoutes = require('./routes/health-routes');
const okfRoutes = require('./routes/okf-routes');
const internalRoutes = require('./routes/internal-routes');
const errorHandler = require('./middleware/error-handler');

/**
 * Create an isolated Express app (createApp pattern for testability).
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();
  app.set('trust proxy', 1); // trust Kong proxy → correct req.ip for audit source_ip
  app.use(helmet());
  const corsAllowlist = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : true;
  app.use(cors({ origin: corsAllowlist }));
  app.use(express.json({ limit: '10mb' }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
  app.use(metricsMiddleware()); // OTel HTTP metrics → OTLP → VictoriaMetrics (MELT)
  app.use((req, res, next) => {
    req.startedAt = Date.now();
    next();
  });

  // Public health endpoints (no auth)
  app.use('/health', healthRoutes);
  app.use('/ready', healthRoutes);
  // OKF API surface (auth applied per-route within the router). The INTERNAL
  // surface is mounted FIRST so /api/okf/internal/* is not swallowed by the
  // authenticated router's requireScope gate (Story 4.8-amend).
  app.use('/api/okf/internal', internalRoutes);
  app.use('/api/okf', okfRoutes);

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3002;
  const { ensureCollections } = require('./db/collections');
  // Ensure the four OKF control-plane collections exist BEFORE accepting requests
  // (settles first; non-fatal — logged on failure so boot doesn't hang). The shared
  // db-connection-service retries transient failures.
  ensureCollections()
    .catch((err) => logger.error('OKF collection ensure failed (non-fatal)', { error: err.message }))
    .finally(() => {
      app.listen(PORT, () => logger.info(`OKF Server listening on port ${PORT}`));
      // Story 2.9.4: the ingestion worker drains Pending OKF files docs
      // (crawlWorker pattern). Opt-out via OKF_INGEST_WORKER_ENABLED=false.
      const ingestWorker = require('./workers/ingestWorker');
      ingestWorker.start();
    });
}

module.exports = { createApp };
