// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Minimal config via process.env with inline defaults (DRY: defaults in code, not env files).
module.exports = {
  port: process.env.PORT || 3002,
  nodeEnv: process.env.NODE_ENV || 'development',
  // PII sidecar (ADR-okf-004 rev) — internal container-to-container call,
  // same pattern as doc-repo -> dataprep. Fail-closed on the client side.
  piiService: {
    url: process.env.PII_SERVICE_URL || 'http://pii-service:8000',
    timeoutMs: parseInt(process.env.PII_TIMEOUT_MS || '10000', 10),
    retries: parseInt(process.env.PII_RETRIES || '2', 10),
    scanPath: '/v1/pii/scan'
  },
  documentRepository: {
    url: process.env.DOCUMENT_REPOSITORY_URL || 'http://document-repository:3001'
  },
  // Story 4.8-amend: content-only chunking — the worker POSTs concepts directly
  // to dataprep (no doc-repo files doc), and dataprep's completion callback hits
  // the okf-server internal endpoint.
  dataprep: {
    url: process.env.DATAPREP_URL || 'http://dataprep-arango-service:5000',
    ingestPath: '/v1/dataprep/ingest_file'
  },
  // Shared secret for the INTERNAL concept-status callback (dataprep → okf-server).
  // Empty ⇒ the internal endpoint refuses all callbacks (fail-closed). This is a
  // separate surface from the authenticated /api/okf router.
  internal: {
    secret: process.env.OKF_INTERNAL_SECRET || ''
  }
};
