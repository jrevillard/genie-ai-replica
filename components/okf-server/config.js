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
  }
};
