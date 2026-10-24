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
    url: process.env.DOCUMENT_REPOSITORY_URL || 'http://document-repository:3001',
    // Bundle-store POST (base64-in-JSON, can be tens of MB) — the receipt +
    // ClamAV scan of a large zip can outrun a short timeout.
    bundleStoreTimeoutMs: parseInt(process.env.OKF_BUNDLE_STORE_TIMEOUT_MS, 10) || 300000
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
  },
  // Story 1.7 (ADR-okf-039 D3): retrieval mode governance. These are the BOOT
  // DEFAULTS — the okf_system_config doc (_key='retrieval') overrides field-by-
  // field once a steward PUTs a config; the doc never has to exist (legacy is
  // the safe default and needs no row). The read side (chatqna/retriever) adds
  // its own ≤30s TTL cache on top; okf-server always answers from current state.
  retrieval: {
    mode: process.env.OKF_RETRIEVAL_MODE || 'legacy',
    maxFanoutGraphs: parseInt(process.env.OKF_RETRIEVAL_MAX_FANOUT_GRAPHS || '5', 10),
    spineMaxHops: parseInt(process.env.OKF_RETRIEVAL_SPINE_MAX_HOPS || '2', 10),
    extractedHopCap: parseInt(process.env.OKF_RETRIEVAL_EXTRACTED_HOP_CAP || '1', 10),
    candidateCapPerGraph: parseInt(process.env.OKF_RETRIEVAL_CANDIDATE_CAP_PER_GRAPH || '50', 10),
    candidateCapGlobal: parseInt(process.env.OKF_RETRIEVAL_CANDIDATE_CAP_GLOBAL || '200', 10)
  }
};
