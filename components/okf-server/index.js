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
  // 50mb — whole-crawl mega-concepts (split mode A) and 200-concept ingest
  // batches legitimately carry tens of MB; the outer nginx already allows
  // client_max_body_size 50m. (10mb 413'd a 200-concept batch — 2026-09-01.)
  app.use(express.json({ limit: '50mb' }));
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
      // (David, 2026-09-04) stale conversions self-heal on EVERY restart —
      // the sweep was lazy (first startConversion) and dead jobs sat in the
      // UI lanes until someone started a new conversion. Boot-time, one-shot.
      require('./services/crawl-conversion-service')
        .sweepInterruptedOnce()
        .catch((err) => logger.error('Conversion boot sweep failed (non-fatal)', { error: err.message }));
      // 1-8g-w (2026-10-11): same self-heal for async suite runs — the
      // in-memory run lock dies with the process, so every 'running'
      // placeholder after a restart is an orphan. Mark them failed (the
      // poll-side lazy reap in getRunSuite covers the no-restart crash).
      require('./services/head-suite-service')
        .sweepInterruptedRuns()
        .catch((err) => logger.error('Head-suite run boot sweep failed (non-fatal)', { error: err.message }));
      // Story 10.5: same shape for the Studio wizard's resumable curation draft —
      // TTL-reap drafts idle past OKF_STUDIO_DRAFT_TTL_DAYS and any whose repo
      // is gone (incl. repos deleted before the cascade shipped). Boot-only
      // would never reap in a quiet studio, so saveDraft also triggers this
      // through the same throttled entry point.
      require('./services/studio-draft-service')
        .sweepStaleDrafts()
        .catch((err) => logger.error('Studio draft boot sweep failed (non-fatal)', { error: err.message }));
    });
}

module.exports = { createApp };
