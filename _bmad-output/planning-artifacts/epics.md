# Admin Logs + Security-Scan → VictoriaLogs — Epics

**Initiative key:** `admin-logs-victorialogs`
**Source spec:** `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
**Architecture spine:** `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` (20 ADs, hexa/onion MELT layout)
**Branch:** `feat/admin-logs-victorialogs`
**First MR:** !335 (planning, opened)

---

---

## Epic 1 — Pipeline enablement (D1)

**Stories:**

### Story 1.1: docker-compose: VL + Collector → always-on (no profile)

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `docker-compose.yaml:1650,1671,1749` |
| Depends on | [] |

### Story 1.2: otel-collector-config: add `otlp` to logs receivers

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `configs/otel/otel-collector-config.yaml:183-189` |
| Depends on | [] |

### Story 1.3: env.j2: render 3 new vars unconditionally

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `deploy/ansible/templates/env.j2` (after `:239`)` |
| Depends on | [] |

### Story 1.4: env (root): commented templates for new vars

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `env` (Section 12C)` |
| Depends on | [] |

### Story 1.6: docs/security/cve-triage-2026q3.md update (optional)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `docs/security/cve-triage-2026q3.md` |
| Depends on | [] |

---

## Epic 2 — Producer: Winston → VictoriaLogs (+ JSON format, OTel)

**Stories:**

### Story 2.1: shared/lib: add `@opentelemetry/api-logs` peer-dep

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/shared/lib/package.json` |
| Depends on | [] |

### Story 2.2: shared/lib: add boolean-env helper (`boolean-env.js`)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/shared/lib/boolean-env.js` (new)` |
| Depends on | [] |

### Story 2.3: shared/lib: add shared `otel-batch-config.js`

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/shared/lib/otel-batch-config.js` (new)` |
| Depends on | [] |

### Story 2.4: shared/lib: add `victorialogs-transport.js` (Winston TransportStream)

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/shared/lib/victorialogs-transport.js` (new)` |
| Depends on | [2.1] |

### Story 2.5: shared/lib/logger.js: format=json, drop traceFormat, add VL transport

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/shared/lib/logger.js:24-30, 41-70, 77-122` |
| Depends on | [2.4] |

### Story 2.6: gov-chat-backend: tracing.js → LoggerProvider + setGlobalLoggerProvider + PII processor

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/gov-chat-backend/tracing.js` (after `:117`)` |
| Depends on | [2.3] |

### Story 2.7: gov-chat-backend: package.json add sdk-logs + exporter-logs-otlp-http

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/gov-chat-backend/package.json` |
| Depends on | [2.6] |

### Story 2.8: tests: extend logger-functions, logger-otel-trace (JSON-key assertions)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/__tests__/{logger-functions,logger-otel-trace}.test.js` |
| Depends on | [2.5] |

### Story 2.9: tests: PII scrubbing covers body field (not just attributes)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/__tests__/p-l-lig-pii-scrubbing.test.js` (new)` |
| Depends on | [2.6] |

### Story 2.10: tests: `victorialogs-transport.test.js` (severity + trace_id flow)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/shared/lib/__tests__/victorialogs-transport.test.js` (new)` |
| Depends on | [2.4] |

### Story 2.11: tests: `logger-vl-integration.test.js` (fake OTLPLogExporter)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (new)` |
| Depends on | [2.6] |

### Story 2.12: Prometheus: `log_record_dropped_total{reason=...}` counter

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/metrics.js` |
| Depends on | [2.6] |

---

## Epic 3 — Document-repository producer-side init

**Stories:**

### Story 3.1: document-repository: package.json add OTel deps + winston-format-json

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/document-repository/package.json` |
| Depends on | [] |

### Story 3.2: document-repository: tracing.js (logs-only path)

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/document-repository/src/tracing.js` (new)` |
| Depends on | [3.1, Epic 2] |

### Story 3.4: document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `ClamAV scan call site + structured Winston events` |
| Depends on | [3.3] |

---

## Epic 4 — MELT seam + VL client (hexagonal layout per AD-3)

**Stories:**

### Story 4.1: shared/lib/melt/types.js: `LogQuery`, `VictoriaLogsRow`, `LogQueryResult` (zero-dep)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/shared/lib/melt/types.js` (new)` |
| Depends on | [] |

### Story 4.2: shared/lib/melt/index.js: export `LogQueryRepository` (port), `VictoriaLogsAdapter` (impl), `VictoriaLogsClient` (application)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/shared/lib/melt/index.js` (new)` |
| Depends on | [4.1] |

### Story 4.3: shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AcctID/ProjID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/shared/lib/melt/victorialogs-client.js` (new)` |
| Depends on | [4.1] |

### Story 4.4: shared/lib/index.js: re-export `melt/`

| Field | Value |
| --- | --- |
| Effort | 0.05 SP |
| Files | `components/shared/lib/index.js` |
| Depends on | [4.2] |

### Story 4.5: tests: `melt/victorialogs-client.test.js` (axios mock + normalize + AccountID headers + retry behavior + empty trace_id drop + reserved-char escape)

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/shared/lib/__tests__/melt/victorialogs-client.test.js` (new)` |
| Depends on | [4.3] |

### Story 4.6: tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs}

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `tests/config-validator/validators/validate-features.js` |
| Depends on | [] |

---

## Epic 5 — Logs facility rewire (admin endpoints + F4 fix)

**Stories:**

### Story 5.1: fixture: `tests/test-fixtures/logs/combined-2026-08-15.log` (NDJSON, ~500 records, schema {timestamp, level, message, service, trace_id, span_id})

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `new file` |
| Depends on | [] |

### Story 5.2: ingestion script: POST same fixture to `/v1/logs` (OTLP) before contract test

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `new shell script` |
| Depends on | [5.1] |

### Story 5.3: logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors

| Field | Value |
| --- | --- |
| Effort | 1.0 SP |
| Files | `components/gov-chat-backend/services/logs-service.js` |
| Depends on | [Epic 4] |

### Story 5.4: admin-dashboard-service: drop fs.readFile path.join; delegate to logsService.getLogsInRange; F4 regex deleted; JSON.parse for file fallback (try/catch + N=4096 re-parse window + error.stack newline guard)

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/gov-chat-backend/services/admin-dashboard-service.js:466-585, 525, 591` |
| Depends on | [5.3] |

### Story 5.7: frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-frontend/src/components/` |
| Depends on | [5.3] |

### Story 5.8: contract test: file path vs VL path deep-equal on same fixture

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js` (new)` |
| Depends on | [5.1, 5.2] |

### Story 5.9: degradation test: 5xx / ECONNREFUSED / ENOTFOUND handling + rate-limit persistence

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/__tests__/services/logs-vl-degradation.test.js` (new)` |
| Depends on | [5.3] |

### Story 5.10: admin-source test: toggle env mid-suite assert no-restart path switch

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/gov-chat-backend/__tests__/services/logs-service-admin-source.test.js` (new)` |
| Depends on | [5.3] |

### Story 5.11: LogSearchDialog.test.js Story 7.6 rewrite (JSON parsing, no regex)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js:885-948` |
| Depends on | [5.7] |

### Story 5.12: grep + fix other printf regex assertions — AdminDashboard.parseLogMessage + tests

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-frontend/src/__tests__/AdminDashboard.test.js` (rewrite lines 1036, 1038, 1042, 1044, 1056); `components/gov-chat-frontend/src/components/AdminDashboard.vue` (rewrite `parseLogMessage()` from regex to JSON.parse) |
| Depends on | [5.11] |

---

## Epic 6 — Security scanner rewire (worker_threads → VL bulk)

**Stories:**

### Story 6.1: security-scan-service: drop `worker_threads` import + `processFile` + worker block

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/services/security-scan-service.js:9, 418, 1015-1125` |
| Depends on | [Epic 4] |

### Story 6.2: security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+

| Field | Value |
| --- | --- |
| Effort | 1.0 SP |
| Files | `components/gov-chat-backend/services/security-scan-service.js:105-313` |
| Depends on | [6.1] |

### Story 6.3: replace `Worker: jest.fn()` mock at lines 74-81 with `VictoriaLogsClient` mock; delete dead gzip/Worker test cases (683-740); new `security-scan-vl-bulk.test.js` + `security-scan-vl-degradation.test.js`

| Field | Value |
| --- | --- |
| Effort | 0.5 SP |
| Files | `components/gov-chat-backend/__tests__/services/security-scan-service.test.js` + new files` |
| Depends on | [6.2] |

### Story 6.4: verify `SECURITY_SCAN_BACKEND=file` fallback works (no VL, no scan window check)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `manual smoke` |
| Depends on | [6.2] |

---

## Epic 7 — Cleanup (deprecate rollover, remove file transports)

**Stories:**

### Story 7.1: logger.js: wrap file transports in `LOG_TO_FILE === '1'` guard; reconfigure honors it

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/shared/lib/logger.js:48-69, 77-122` |
| Depends on | [Epic 2] |

### Story 7.2: routes: `POST /api/admin/logs/rollover` + `POST /api/logger/{configure,rollover}` return `{ deprecated: true, ... }`; `rolloverLogs` → 410 Gone for cron callers

| Field | Value |
| --- | --- |
| Effort | 0.25 SP |
| Files | `components/gov-chat-backend/routes/{admin,logger}-routes.js:170, 97, 198` |
| Depends on | [Epic 5] |

### Story 7.3: shared/lib/index.js: ADD re-exports for `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog` (latent prod crash fix)

| Field | Value |
| --- | --- |
| Effort | 0.05 SP |
| Files | `components/shared/lib/index.js` |
| Depends on | [] |

### Story 7.4: ESLint `no-restricted-imports` rule in `components/shared/eslint-rules-base.js` (ban `**/shared/lib/**` deep imports)

| Field | Value |
| --- | --- |
| Effort | 0.1 SP |
| Files | `components/shared/eslint-rules-base.js` (modify — add `no-restricted-imports` rule to existing exports; propagates to backend + frontend + shared/lib via existing spread) |
| Depends on | [7.3] |

### Story 7.5: ~~DELETED~~ — previously verify CI `allow_failure: true` on `scheduled:melt-correlation`. Cancelled 2026-09-04 (Epic 1 review): the scheduled CI jobs + stub are deleted; chaos/correlation testing is out of project scope. DW-325..DW-329 resolved by deletion.

---
