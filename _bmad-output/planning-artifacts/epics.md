# Admin Logs + Security-Scan → VictoriaLogs — Epics

**Initiative key:** `admin-logs-victorialogs`
**Source spec:** `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
**Architecture spine:** `_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md` (20 ADs, hexa/onion MELT layout)
**Branch:** `feat/admin-logs-victorialogs`
**First MR:** !335 (planning, opened)

---

## Epic 1 — Pipeline enablement (D1)

**Goal:** VictoriaLogs + OTel Collector run unconditionally; CI gap stub unblocks scheduled jobs.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 1.1 docker-compose: VL + Collector → profiles:[core] | `docker-compose.yaml:1650,1671,1749` | 0.5 SP | — |
| 1.2 otel-collector-config: add `otlp` to logs receivers | `configs/otel/otel-collector-config.yaml:183-189` | 0.25 SP | — |
| 1.3 env.j2: render 3 new vars unconditionally | `deploy/ansible/templates/env.j2` (after `:239`) | 0.25 SP | — |
| 1.4 env (root): commented templates for new vars | `env` (Section 12C) | 0.1 SP | — |
| 1.5 tests/melt-correlation/: CI stub (exit 0) + README | `tests/melt-correlation/{run-melt-test.sh,README.md}` (new) | 0.1 SP | — |
| 1.6 docs/security/cve-triage-2026q3.md update (optional) | verify `allow_failure: true` on `scheduled:melt-correlation` (`.gitlab-ci.yml:2942-2984`) | 0.1 SP | — |

**Acceptance for Epic 1:**
- `docker compose --profile core up -d` brings VL + Collector without `--profile observability`
- `curl http://victorialogs:9428/health` returns `{"status":"ok"}`
- `curl -X POST http://otel-collector:4318/v1/logs` returns 200
- Scheduled `melt-correlation` job runs without error (stub exit 0)
- Smoke tested on `govstack@10.0.0.102` (release/el-salvador) before merge to main

---

## Epic 2 — Producer: Winston → VictoriaLogs (+ JSON format, OTel)

**Goal:** Winston emits structured JSON records via OTel LoggerProvider + new VictoriaLogsTransport. PII scrubbed on attributes + body. Logging stays non-blocking under VL outage.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 2.1 shared/lib: add `@opentelemetry/api-logs` peer-dep | `components/shared/lib/package.json` | 0.1 SP | — |
| 2.2 shared/lib: add boolean-env helper (`boolean-env.js`) | `components/shared/lib/boolean-env.js` (new) | 0.1 SP | — |
| 2.3 shared/lib: add shared `otel-batch-config.js` | `components/shared/lib/otel-batch-config.js` (new) | 0.1 SP | — |
| 2.4 shared/lib: add `victorialogs-transport.js` (Winston TransportStream) | `components/shared/lib/victorialogs-transport.js` (new) | 0.5 SP | 2.1 |
| 2.5 shared/lib/logger.js: format=json, drop traceFormat, add VL transport | `components/shared/lib/logger.js:24-30, 41-70, 77-122` | 0.5 SP | 2.4 |
| 2.6 gov-chat-backend: tracing.js → LoggerProvider + setGlobalLoggerProvider + PII processor | `components/gov-chat-backend/tracing.js` (after `:117`) | 0.5 SP | 2.3 |
| 2.7 gov-chat-backend: package.json add sdk-logs + exporter-logs-otlp-http | `components/gov-chat-backend/package.json` | 0.1 SP | 2.6 |
| 2.8 tests: extend logger-functions, logger-otel-trace (JSON-key assertions) | `components/gov-chat-backend/__tests__/{logger-functions,logger-otel-trace}.test.js` | 0.25 SP | 2.5 |
| 2.9 tests: PII scrubbing covers body field (not just attributes) | `components/gov-chat-backend/__tests__/p-l-lig-pii-scrubbing.test.js` (new) | 0.25 SP | 2.6 |
| 2.10 tests: `victorialogs-transport.test.js` (severity + trace_id flow) | `components/shared/lib/__tests__/victorialogs-transport.test.js` (new) | 0.25 SP | 2.4 |
| 2.11 tests: `logger-vl-integration.test.js` (fake OTLPLogExporter) | `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (new) | 0.25 SP | 2.6 |
| 2.12 Prometheus: `log_record_dropped_total{reason=...}` counter | `components/gov-chat-backend/metrics.js` | 0.25 SP | 2.6 |

**Acceptance for Epic 2:**
- `logger.info('hello')` produces POST to `otel-collector:4318/v1/logs` within 5s
- VL `?q=service:genie-backend` returns the record
- Killing VL does NOT block services; `log_record_dropped_total{reason="queue_full"}` increments
- File lines are valid JSON when `LOG_TO_FILE=1`
- PII redaction applies to `body` (test: `logger.info('Login failed for user@example.com')` → redacted body)
- Dual-emit window filter applied (Story 2.5 acceptance bonus)

---

## Epic 3 — Document-repository producer-side init

**Goal:** document-repository gains the same VictoriaLogs path as backend (logs-only, no traces/metrics, per AD-18 + AD-20 ClamAV observability).

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 3.1 document-repository: package.json add OTel deps + winston-format-json | `components/document-repository/package.json` | 0.1 SP | — |
| 3.2 document-repository: tracing.js (logs-only path) | `components/document-repository/src/tracing.js` (new) | 0.5 SP | 3.1, Epic 2 |
| 3.3 document-repository: require('./tracing') at app.js:1 | `components/document-repository/src/app.js` | 0.05 SP | 3.2 |
| 3.4 document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20 | ClamAV scan call site + structured Winston events | 0.5 SP | 3.3 |

**Acceptance:** `service.name=genie-document-repository` records appear in VL; `_msg:clamav.scan.*` events queryable; document-repository stays producer-only (no admin endpoints).

---

## Epic 4 — MELT seam + VL client (hexagonal layout per AD-3)

**Goal:** shared/lib/melt/ implements domain / port / adapter / application; single backend (`VictoriaLogsAdapter`) today, ELK/Loki-ready via port.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 4.1 shared/lib/melt/types.js: `LogQuery`, `VictoriaLogsRow`, `LogQueryResult` (zero-dep) | `components/shared/lib/melt/types.js` (new) | 0.1 SP | — |
| 4.2 shared/lib/melt/index.js: export `LogQueryRepository` (port), `VictoriaLogsAdapter` (impl), `VictoriaLogsClient` (application) | `components/shared/lib/melt/index.js` (new) | 0.25 SP | 4.1 |
| 4.3 shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AcctID/ProjID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS` | `components/shared/lib/melt/victorialogs-client.js` (new) | 0.5 SP | 4.1 |
| 4.4 shared/lib/index.js: re-export `melt/` | `components/shared/lib/index.js` | 0.05 SP | 4.2 |
| 4.5 tests: `melt/victorialogs-client.test.js` (axios mock + normalize + AccountID headers + retry behavior + empty trace_id drop + reserved-char escape) | `components/shared/lib/__tests__/melt/victorialogs-client.test.js` (new) | 0.25 SP | 4.3 |
| 4.6 tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs} | `tests/config-validator/validators/validate-features.js` | 0.1 SP | — |
| 4.7 tests: empty `MELT_PROVIDER` whitelist verification on boot | `tests/config-validator/__tests__/melt-provider.test.js` (new) | 0.1 SP | 4.6 |

**Acceptance:** `require('shared/lib').melt.VictoriaLogsClient` resolves; `_normalizeRows` produces exact `VictoriaLogsRow` per AD-3 sub-shapes; AccountID/ProjectID headers sent (not legacy VL-Tenant); `VL_FAIL_OPEN=true` makes client throw typed error caught by LogsService.

---

## Epic 5 — Logs facility rewire (admin endpoints + F4 fix)

**Goal:** LogsService + admin-dashboard-service.js query VL via MELT port. F4 regex deleted. `ADMIN_LOGS_SOURCE=file` no-restart fallback works. `LOG_TO_FILE=0` post-P4 default prevents ENOENT.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 5.1 fixture: `tests/test-fixtures/logs/combined-2026-08-15.log` (NDJSON, ~500 records, schema {timestamp, level, message, service, trace_id, span_id}) | new file | 0.1 SP | — |
| 5.2 ingestion script: POST same fixture to `/v1/logs` (OTLP) before contract test | new shell script | 0.1 SP | 5.1 |
| 5.3 logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors | `components/gov-chat-backend/services/logs-service.js` | 1.0 SP | Epic 4 |
| 5.4 admin-dashboard-service: drop fs.readFile path.join; delegate to logsService.getLogsInRange; F4 regex deleted; JSON.parse for file fallback (try/catch + N=4096 re-parse window + error.stack newline guard) | `components/gov-chat-backend/services/admin-dashboard-service.js:466-585, 525, 591` | 0.5 SP | 5.3 |
| 5.5 ADMIN_LOGS_SOURCE=file + LOG_TO_FILE !== '1' → 503 with recovery hint | `logs-service.js` | 0.1 SP | 5.3 |
| 5.6 ENOENT tolerance + O_EXCL concurrent-writer lock for file fallback | `logs-service.js` | 0.1 SP | 5.4 |
| 5.7 frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys | `components/gov-chat-frontend/src/components/` | 0.25 SP | 5.3 |
| 5.8 contract test: file path vs VL path deep-equal on same fixture | `components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js` (new) | 0.25 SP | 5.1, 5.2 |
| 5.9 degradation test: 5xx / ECONNREFUSED / ENOTFOUND handling + rate-limit persistence | `components/gov-chat-backend/__tests__/services/logs-vl-degradation.test.js` (new) | 0.25 SP | 5.3 |
| 5.10 admin-source test: toggle env mid-suite assert no-restart path switch | `components/gov-chat-backend/__tests__/services/logs-service-admin-source.test.js` (new) | 0.1 SP | 5.3 |
| 5.11 LogSearchDialog.test.js Story 7.6 rewrite (JSON parsing, no regex) | `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js:885-948` | 0.1 SP | 5.7 |
| 5.12 grep + fix other printf regex assertions in test suite | various | 0.1 SP | 5.11 |

**Acceptance:** All 6 admin endpoints return schema-identical JSON; `LOG_TO_FILE=0` + `ADMIN_LOGS_SOURCE=file` → 503 with hint; `logs-vl-contract.test.js` passes deep-equal on fixture; frontend banner renders when `degraded: true`.

---

## Epic 6 — Security scanner rewire (worker_threads → VL bulk)

**Goal:** `POST /api/admin/security-scan` drops worker_threads, runs LogSQL bulk query. Vulnerability dedupe + truncation guard + retention check. Schema-validated cache.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 6.1 security-scan-service: drop `worker_threads` import + `processFile` + worker block | `components/gov-chat-backend/services/security-scan-service.js:9, 418, 1015-1125` | 0.25 SP | Epic 4 |
| 6.2 security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+ | `components/gov-chat-backend/services/security-scan-service.js:105-313` | 1.0 SP | 6.1 |
| 6.3 replace `Worker: jest.fn()` mock at lines 74-81 with `VictoriaLogsClient` mock; delete dead gzip/Worker test cases (683-740); new `security-scan-vl-bulk.test.js` + `security-scan-vl-degradation.test.js` | `components/gov-chat-backend/__tests__/services/security-scan-service.test.js` + new files | 0.5 SP | 6.2 |
| 6.4 verify `SECURITY_SCAN_BACKEND=file` fallback works (no VL, no scan window check) | manual smoke | 0.1 SP | 6.2 |

**Acceptance:** 7-day scan completes < 2s; response shape unchanged; `grep -n "worker_threads" services/security-scan-service.js` returns 0; dedupe + truncation tests pass.

---

## Epic 7 — Cleanup (deprecate rollover, remove file transports)

**Goal:** Remove Winston DailyRotateFile + tailable File from production. Deprecate rollover/configure endpoints. Lint guard prevents reintroduction.

| Story | File / scope | Effort | Depends on |
|---|---|---|---|
| 7.1 logger.js: wrap file transports in `LOG_TO_FILE === '1'` guard; reconfigure honors it | `components/shared/lib/logger.js:48-69, 77-122` | 0.25 SP | Epic 2 |
| 7.2 routes: `POST /api/admin/logs/rollover` + `POST /api/logger/{configure,rollover}` return `{ deprecated: true, ... }`; `rolloverLogs` → 410 Gone for cron callers | `components/gov-chat-backend/routes/{admin,logger}-routes.js:170, 97, 198` | 0.25 SP | Epic 5 |
| 7.3 shared/lib/index.js: stop re-exporting `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`; logger-routes.js imports internal `./logger` not via shared/lib | `components/shared/lib/index.js` + `components/gov-chat-backend/routes/logger-routes.js:4` | 0.25 SP | 7.2 |
| 7.4 tests: `linter-shared-lib-re-exports.test.js` (assert logger-routes.js imports from `./logger`); `routes/logger-routes.test.js` deprecated endpoints | `components/gov-chat-backend/__tests__/` (new) | 0.25 SP | 7.3 |
| 7.5 verify CI `allow_failure: true` on `scheduled:melt-correlation` (`.gitlab-ci.yml:2942-2984`); document volume backup/cleanup (DW-65) if VL prod | docs only | 0.1 SP | — |

**Acceptance:** `grep "DailyRotateFile\|winston-daily-rotate" components/shared/lib/logger.js` shows guards; `du -sh /app/logs/*.log` returns 0 inside backend container; deprecated endpoints return 200 `{deprecated:true}`; `logger-routes.js` does not import removed symbols.

---

## Cross-cutting acceptance (per spec kernel)

- All 4 Open Questions resolved (Q-1 → option C dep split; Q-2 → 1/min rate limit; Q-3 → multi-tenant out-of-scope, env kept as port seam; Q-4 → no per-service labels on drop counter)
- All 20 ADs honoured by code
- F4 regex at `admin-dashboard-service.js:525` removed; LogSearchDialog.test.js Story 7.6 describe block rewritten
- DW-325 logged; tests/melt-correlation/ stub exits 0
- Story 7-6 closure note appended (archived)
- One MR per phase boundary; AD-13 merge-order gate enforced
- Rollback switches tested pre-merge per `rollback-matrix.md`

## Sibling tracking

- `DW-325` (deferred-work.md) — `tests/melt-correlation/` full suite, separate epic
- Story 7-6 closure note appended at `_bmad-output/archived/testing-framework/implementation-artifacts/7-6-deploy-victorialogs-centralized-log-aggregation.md`
- MR !335 opened for planning artifacts (draft flag not set via CLI, manually toggle in GitLab UI if needed)
