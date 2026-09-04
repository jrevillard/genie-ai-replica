# Phases

One MR per phase. Branch `feat/admin-logs-victorialogs`; never commit to `main`.

## P0 — Enable VL pipeline (D1) + CI gap fix

**Goal:** `victorialogs` + `otel-collector` always run with the stack; no consumer behaviour change yet.

**Files:**
- `docker-compose.yaml` — `:1650` (otel-collector-init), `:1671` (otel-collector), `:1749` (victorialogs): remove `profiles: [observability]` so the three services start unconditionally; pin `victorialogs.deploy.replicas: 1` (was `${ENABLE_OBSERVABILITY:-0}`). Leave `victoriametrics :1716`, `victoriatraces :1818`, `grafana :1854` under `[observability]`.
- `configs/otel/otel-collector-config.yaml` — `:183-189` logs pipeline receivers: add `- otlp` so apps can POST to `:4318/v1/logs`. Final: `receivers: [fluent_forward, otlp]`.
- `deploy/ansible/templates/env.j2` — after `:239` (unconditional): `VICTORIALOGS_URL`, `VICTORIALOGS_TENANT_ID`, `VL_QUERY_TIMEOUT_MS`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `LOG_TO_VICTORIALOGS`. New SECTION 12D after 12C: `MELT_PROVIDER`, `VL_FAIL_OPEN`, `ADMIN_LOGS_SOURCE`, `SECURITY_SCAN_BACKEND`, `LOG_TO_FILE`.
- `env` (root) — add commented templates for the new vars under SECTION 12D.

**Acceptance:** `docker compose up -d` (no profile flag) brings up VL + Collector; `curl http://victorialogs:9428/health` returns `{"status":"ok"}`; `curl -X POST http://otel-collector:4318/v1/logs` returns 200.

**Effort:** 1 SP. **Rollback:** revert the 3 compose profile lines.

## P1a — Producer: Winston → VictoriaLogs transport (+ JSON format)

**Goal:** New `VictoriaLogsTransport` writes records via OTel `LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter`. Winston format switches from printf to JSON.

**Files:**
- `components/shared/lib/victorialogs-transport.js` (new) — Winston `TransportStream` subclass; reads `info.trace_id` / `info.span_id` as JSON keys (not printf substrings); maps winston levels → `SeverityNumber`; sets `service.name` + `deployment.environment` as stream fields; lazy-requires OTel SDK so document-repository (no OTel today) does not break. **Lazy-init on first emit, not on module load** — buffers pre-init log lines in a bounded ring buffer (e.g. 100 records) and flushes once the OTel `LoggerProvider` is set.
- `components/shared/lib/logger.js` — replace `traceFormat` printf at `:24-30` with `winston.format.combine(timestamp(), errors({stack:true}), json())`. Add VL transport gated on a boolean coercion helper (accepts `1`, `true`, `TRUE`, `yes`): `LOG_TO_VICTORIALOGS && ENABLE_OBSERVABILITY`. **Do NOT add a custom `setOtelLoggerProvider` setter** — use the standard OTel `logs.setGlobalLoggerProvider(provider)` from `tracing.js`; multi-process-safe and avoids the last-wins collision across backend + document-repository. `reconfigureLogger` `:77-122` re-checks `LOG_TO_VICTORIALOGS` after `logger.clear()` at `:112`.
- `components/gov-chat-backend/tracing.js` — after `:117`, instantiate `LoggerProvider` + `OTLPLogExporter(url: ${endpointBase}/v1/logs)` + `BatchLogRecordProcessor({maxExportBatchSize: 512, scheduledDelayMillis: 5000, maxQueueSize: 2048})`. Export `loggerProvider` at line 230 and call `logs.setGlobalLoggerProvider(loggerProvider)`. Wire a Prometheus metric `log_record_dropped_total{reason=...}` (`reason ∈ {queue_full, otlp_unreachable, observability_disabled}`) via the existing backend `metrics.js` endpoint. Expose `log_record_dropped_total{reason="observability_disabled"}` when the AND-gate suppresses emission so cloud operators see a non-zero counter.
- `components/shared/lib/package.json` + `components/gov-chat-backend/package.json` — add `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http` aligned with `sdk-node` version.

**Acceptance:** `logger.info('hello')` produces a POST to `otel-collector:4318/v1/logs` within 5 s; VL `?q=service:genie-backend` returns the record; killing VL does not block services (`log_record_dropped_total{reason="queue_full"} > 0` after the queue fills; console mirror preserves records); file lines are valid JSON (one record per line) when `LOG_TO_FILE=1`; UI shows an "indexing…" banner when the most recent record is < 10 s old to absorb the 5 s `scheduledDelayMillis` lag.

**Tests:** `components/shared/lib/__tests__/victorialogs-transport.test.js` (severity mapping, trace_id flow, error swallow); `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (fake OTLPLogExporter, assert POST); extend `logger-otel-trace.test.js` — drop printf-substring assertions, add JSON-key assertions. New: `p-l-lig-pii-scrubbing.test.js` asserting `body` field is redacted when it contains email / JWT / password substrings (not just attributes — see C-5).

**Effort:** 2 SP. **Rollback:** `LOG_TO_VICTORIALOGS=0` env (restart).

## P1b — Consumer: shared/lib/melt/ provider

**Goal:** Read-side HTTP client for VL. The contract P2/P3 depend on.

**Files:**
- `components/shared/lib/melt/victorialogs-client.js` (new) — wraps `/select/logsql/{query,hits,stats_query,field_values,streams,tail}` with axios (add `axios@^1.7.0` to `components/shared/lib/package.json`). **VL 1.50+ canonical headers**: send `AccountID: <tenant-account>` and `ProjectID: <tenant-project>` (NOT the legacy `VL-Tenant`). Default tenant reads from `VICTORIALOGS_TENANT_ID` env (e.g. `0:0` → headers `AccountID: 0`, `ProjectID: 0`). axios timeout = `VL_QUERY_TIMEOUT_MS` (default 30000). On startup, run a health probe `GET /health` with retries (3×, 5 s) before marking the client ready; reject early calls with a typed error so `VL_FAIL_OPEN` and DNS failures both surface. `_normalizeRows` maps `{_msg, _stream, _time, ...rest}` → `{timestamp, message, stream, fields, date, time, level, service}` to mirror LogsService shape. **Drop empty/absent `trace_id`** before adding to attributes — never promote a missing trace ID to a stream field (cardinality blowup).
- `components/shared/lib/melt/index.js` (new) — exports `VictoriaLogsClient` + `MELT_PROVIDER='victorialogs'` (single implementation; env-var reserved for future ELK/Loki provider).
- `components/shared/lib/index.js` — re-export so backend gets `require('./shared-lib').melt.VictoriaLogsClient`.
- `tests/config-validator/` — whitelist `MELT_PROVIDER ∈ {victorialogs}`; reject unknown values at boot.

**Tests:** `components/shared/lib/__tests__/melt/victorialogs-client.test.js` — axios mock; verify `_normalizeRows` field mapping; verify `AccountID`/`ProjectID` headers (not `VL-Tenant`); verify health-probe retry behavior; verify empty `trace_id` is dropped; verify `searchLogs` text input escapes LogSQL reserved chars (`* ? : " \`) before injecting into `_msg:"…"`.

**Effort:** 1 SP. **Rollback:** revert the MR — there are no consumers yet, so revert = git revert. `VL_FAIL_OPEN` is a no-op until P2 lands (see `rollback-matrix.md` P2 row for the actual escape switch).

## P1c — Producer cutover / dedup

**Goal:** Stop double-writing. Switch Node services Docker logging driver off `fluentd`.

**Files:**
- `docker-compose.yaml` ~`:75` — add YAML anchor `x-local-logging: &local-logging { driver: json-file, options: { max-size: "10m", max-file: "3", labels: "service,version" } }`.
- `:484` (backend), `:596` (document-repository) — `logging: *fluent-logging` → `logging: *local-logging`. Leave the 30+ other services untouched.

**Namespace note**: the Docker label `service` (e.g. `service=backend`) is used by `docker logs` greps and is independent of the OTel resource attribute `service.name` (e.g. `service.name=genie-backend`) used by VL stream queries. Both must coexist; do not rename either.

**Dual-emit dedup (P1a → P1c overlap)**: between the P1a merge (VL transport on) and the P1c merge (backend off fluentd), backend logs land in VL twice — once via OTel (`service.name=genie-backend`) and once via the fluentd driver (`_stream:genie.backend`). During this window, `LogsService.getLogsInRange` filters with `service:genie-backend AND NOT _stream:genie.backend` to dedup at read time. Remove the filter in the P1c MR. Add a fixture-mode dedup check to `logs-vl-contract.test.js` (assert no duplicate `_msg` in 1-second windows). Lint rule: forbid `*fluent-logging` anchor references for js-runtime services after P1c lands.

**Acceptance:** `docker inspect backend --format '{{.HostConfig.LogConfig.Type}}'` → `json-file`; VL still receives Python OPEA logs (tei, chatqna); VL receives Winston backend logs; during the dual-emit window, the read-side filter hides the duplicates.

**Tests:** add `tests/smoke/docker-log-driver.sh` (shell, not Jest — Jest has no docker daemon in CI) asserting `docker logs backend 2>&1 | grep -c VictoriaLogs` is 0; `docker inspect` driver type per service; fluentd still ingests non-Node service logs. Wire the script into `.gitlab-ci.yml` deploy job.

**Effort:** ½ SP. **Rollback:** revert the YAML anchor at `:75` AND the per-service overrides at `:484, :596` (anchor + both service refs are required; reverting only one leaves half-applied config).

## P2 — Logs facility rewire + F4 fix + graceful degradation

**Goal:** Replace file reads in `LogsService` and `admin-dashboard-service.js` with VL queries. Fix F4. Preserve response shapes.

**Files:**
- `tests/test-fixtures/logs/combined-2026-08-15.log` (new) — NDJSON fixture, one record per line, schema `{timestamp, level, message, service, trace_id, span_id}`. ~500 records spanning ERROR / WARN / INFO levels. Loaded into both the legacy file path and the VL path during the contract test. Add an ingestion script that POSTs the same fixture to `/v1/logs` (OTLP) before the contract test runs.
- `components/gov-chat-backend/services/logs-service.js` (814 L) — inject `VictoriaLogsClient`; new `getLogsInRange`, `getLogsSummary` (single `/hits` call for `level:ERROR`/`WARN` buckets), `searchLogs`, `getDebugYesterday`. Keep `getLogFilesInRange` returning synthetic `{date, service, source:'victorialogs', query: '...'}` descriptors until P3 replaces it. **Read `process.env.ADMIN_LOGS_SOURCE` on every call inside `getLogs` / `getLogsSummary` / `searchLogs` / `getDebugYesterday`** — not at module load — so the D2 switch works without restart. If `ADMIN_LOGS_SOURCE='file'` is set while `LOG_TO_FILE !== '1'` (post-P4 default), return 503 with the recovery hint `"set LOG_TO_FILE=1"` instead of throwing ENOENT.
- `components/gov-chat-backend/services/admin-dashboard-service.js`:
  - `getLogs` `:466-585` — drop `fs.readFile` `:515-549` and `path.join` `:472-510`; delegate to `logsService.getLogsInRange`.
  - F4 fix `:525` — delete the triple-bracket regex; `ADMIN_LOGS_SOURCE=file` fallback path reads JSON (one record per line from P1a format change) and parses via `JSON.parse(line)` returning `{timestamp, level, message, trace_id, span_id, ...}`. **Wrap `JSON.parse` in try/catch** — on `SyntaxError` (truncated line from `kill -9` mid-write), read the next N bytes, attempt re-parse, otherwise skip with a `parse_error` counter. **For `error.stack` containing newlines**: rely on `winston.format.json({ replacer })` or accept that NDJSON lines may span records — add a guard that joins lines until a valid JSON object parses.
  - File-rotation race: re-read the directory listing before each file; tolerate `ENOENT` between `stat()` and `open()`. Concurrent-writer hazard (backend + doc-repo + future Node services on the same path): open with `O_EXCL` lock per PID or tail-style `fadvise(FADV_SEQUENTIAL)`.
  - `rolloverLogs` `:591` — return `{ success: true, message: 'Log rollover is deprecated; logs are written directly to VictoriaLogs.', deprecated: true }`. External cron callers that expected a real rollover should see **410 Gone** + `logs.warn(caller_ip)` instead of 200 (audit trail for ops follow-up).
- Graceful degradation: wrap VL calls; on 5xx / ECONNREFUSED / ENOTFOUND / timeout, log once per minute (rate-limit state persisted to `/tmp/vl-fail-open-ts` so backend restarts don't reset the counter); default `VL_FAIL_OPEN=false` (5xx surfaces to admin), `VL_FAIL_OPEN=true` returns empty results + `degraded: true`.
- D2 switch: `ADMIN_LOGS_SOURCE=file|victorialogs` (default `victorialogs` after first release; permanent).

**Acceptance:** All 6 endpoints return schema-identical responses; `GET /api/admin/logs?level=ERROR&limit=50` shape unchanged; killing VL with `VL_FAIL_OPEN=true` returns empty results + `degraded: true`; `LogSearchDialog.vue` renders an i18n-keyed alert banner when `response.degraded === true` (computed property added in P2 frontend — see frontend scope note below); `grep -n worker_threads components/gov-chat-backend/services/logs-service.js` returns 0 (file-fallback path uses readline, not Worker).

**Tests:** `logs-vl-contract.test.js` (new) — capture responses from file path and VL-path using `tests/test-fixtures/logs/combined-2026-08-15.log`; `expect(...).toEqual(...)` deep-equal. `logs-vl-degradation.test.js` (new) — verify 5xx / ECONNREFUSED / ENOTFOUND handling + rate-limit persistence across simulated restart. `logs-service-admin-source.test.js` (new) — toggle `process.env.ADMIN_LOGS_SOURCE` mid-suite and assert path switch without restart. Rewrite `LogSearchDialog.test.js:885-948` Story 7.6 — drop printf regex, assert JSON-shape parsing. **Also grep + fix any other printf regex assertions**: `grep -rn '\\[[a-z]*\\]\\s*\\[message\\]' components/gov-chat-frontend/src/__tests__` in the P2 MR.

**Frontend scope (P2)**: a single MR touch on `LogSearchDialog.vue` adds a `computed.banner` derived from `response.degraded`; render via existing alert component; i18n keys under `src/i18n/locales/*.js`. Vue 3 Options API preserved.

**Effort:** 2 SP. **Rollback:** `ADMIN_LOGS_SOURCE=file` (no restart, per-call env read).

## P3 — Security scanner rewire

**Goal:** Replace `worker_threads` streaming with VL bulk queries.

**Files:**
- `components/gov-chat-backend/services/security-scan-service.js` (1127 L):
  - Drop `const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')` at `:9`.
  - Drop `processFile` `:418` and worker block `:1015-1125`.
  - Rewrite `processLogsInParallel` `:105-313` — build LogSQL `_msg:"needle1" OR _msg:"needle2" ... AND service:*` from the 14 patterns at `:111-226`; one `vlClient.query({q, start, end, limit: 100000})`; for hits-only pre-flight use `/select/logsql/hits`.
  - **Dedupe hits**: a single log line can match multiple patterns (e.g. `401 forbidden` → patterns 6 + 9). Group by `${_time}|${_stream.service}|${_msg}` and dedupe so each record contributes to at most one vulnerability bucket. Without dedup, double-counting inflates critical/medium buckets and skews security posture.
  - **Truncation guard**: if `vlClient.query` returns `length === limit`, loop with `_stream`/`_time` cursors, OR assert and set `degraded: true` in the response. Silent under-counts at >100k hits.
  - **Retention check**: compare `Math.floor((now - start) / 86400e3)` against `VICTORIALOGS_RETENTION_DAYS` (parse the `30d` env). If retention < scan window, set `degraded: true` and cap the scan start to `now - retention`.
  - Keep `/app/data/security/last-scan-results.json` cache write (verify exact line in MR description). **Schema-validate cache on read**: if the JSON doesn't match the new shape (e.g. legacy worker_threads output left on disk), treat as cache miss + regenerate.
  - Constructor accepts `victoriaLogsClient` arg for DI.

**Acceptance:** `POST /api/admin/security-scan` returns same JSON shape; `grep -n "worker_threads" services/security-scan-service.js` returns 0; 7-day scan completes < 2 s; `security-scan-vl-degradation.test.js` asserts `{vulnerabilities:{critical:[],medium:[],low:[]}, degraded:true, error:'vl_unreachable'}` within 5 s when VL is down with `VL_FAIL_OPEN=true` (extends CAP-5 to cover security-scan).

**Tests:** `security-scan-service.test.js` — replace `Worker: jest.fn()` mock `:74-81` with `VictoriaLogsClient` mock. **Delete dead gzip / Worker test cases** at `:683-740` region (`it('should filter invalid gzip files', ...)` and friends depend on `getLogFilesInRange` + `isGzipValid`, both gone). New `security-scan-vl-bulk.test.js` — verify shape parity with worker_threads output for same fixture (one parity test, since worker_threads is gone). New `security-scan-vl-degradation.test.js` — mirrors `logs-vl-degradation.test.js`.

**Effort:** 2 SP. **Rollback:** `SECURITY_SCAN_BACKEND=file` env (clear cache, no restart).

## P4 — Cleanup

**Goal:** Remove file transports. Deprecate rollover/configure endpoints. Reduce surface area.

**Files:**
- `components/shared/lib/logger.js:48-69` — wrap file transports in `if (process.env.LOG_TO_FILE === '1') { ... }`. `reconfigureLogger` `:77-122` same wrap. Default `LOG_TO_FILE=0`; keep `LOG_TO_FILE=1` as escape hatch for first 30 days. **Dual-write volume note**: when `LOG_TO_FILE=1` is set with `LOG_TO_VICTORIALOGS=1` (post-cutover audit retention), disk fills at the historical 10 MB/day cadence — document this in `runbook` or operator notes.
- `components/gov-chat-backend/routes/admin-routes.js:170` — `POST /logs/rollover` returns `{ deprecated: true, message: 'Log rollover is deprecated; logs are written directly to VictoriaLogs.' }`.
- `components/gov-chat-backend/routes/logger-routes.js:97, :198` — same deprecation shape. **Refactor `logger-routes.js` in the same MR** to import `triggerLogRollover` / `cleanupCombinedLog` via internal `./logger` (not via shared/lib `index.js` re-exports) — otherwise the deprecation breaks the route handler with `TypeError: triggerLogRollover is not a function`. Add a lint rule: `npm run lint` fails if `logger-routes.js` imports a symbol that `index.js` no longer re-exports.
- `components/shared/lib/index.js` — stop re-exporting `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog` after one release.
- `deploy/ansible/templates/env.j2` — remove `LOG_LEVEL` mapping once file logs are gone (or keep for stdout level).
- `.gitlab-ci.yml` — verify the `scheduled:melt-correlation` job at `:2942-2984` is `allow_failure: true` (quote the exact lines in MR description). If false, the P0 stub alone won't unblock the pipeline.

**Acceptance:** `grep "DailyRotateFile\|winston-daily-rotate" components/shared/lib/logger.js` shows file transports inside `LOG_TO_FILE === '1'` guard; `logs/error-*.log` / `combined-*.log` / `combined.log` disk usage is 0 after one daily-rotate cycle. Verify from inside the backend container: `docker exec backend sh -c 'du -sh /app/logs/*.log 2>/dev/null || echo 0'` (the host path `components/shared/lib/logs/*.log` does not resolve from inside the container's `/app` cwd).

**Tests:** `routes/logger-routes.test.js` — deprecated endpoints return `{ deprecated: true, ... }`; extend `logger.test.js` — `LOG_TO_FILE=1` adds file transports, `LOG_TO_FILE=0` only Console + VictoriaLogs. New `linter-shared-lib-re-exports.test.js` — asserts `logger-routes.js` imports `triggerLogRollover` from `./logger` not from `shared/lib`.

**Effort:** 1 SP. **Rollback:** `LOG_TO_FILE=1` env (restart).

## Worktree + MR cadence

```
git worktree add .claude/worktrees/admin-logs-vl -b feat/admin-logs-victorialogs origin/main
```

One MR per phase boundary; each MR description: phase name, ENV vars added/changed, manual smoke checklist, rollback line. CI gating per MR: backend `npm run lint && npm run format:check`, backend `npm test`, security-scan, smoke. The `scheduled:melt-correlation` job stays `allow_failure: true` until `tests/melt-correlation/` is filled (P3 MR).

**Merge order gate**: MR-N+1 must not merge to `main` until MR-N's pipeline is green on the release branch. Half-rewired code under a container restart will either fail VL queries or emit Winston nowhere — block in the `rules:` / `needs:` of the relevant jobs.