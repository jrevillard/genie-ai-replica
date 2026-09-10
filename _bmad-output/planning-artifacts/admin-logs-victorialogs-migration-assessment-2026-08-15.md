# Assessment — Admin Dashboard Logs & Security Scanning Facilities: VictoriaLogs Migration Gap

| Field | Detail |
|---|---|
| **Date** | 2026-08-15 |
| **Author** | Claude Code (verification agent), commissioned by David Forden |
| **Status** | Assessment / gap report — pre-PRD input |
| **Scope** | Admin dashboard *Logs* facility + *Security scanning* facility backend services vs. the Victoria MELT stack (VictoriaMetrics / VictoriaLogs / VictoriaTraces) |
| **Verification method** | Every claim below was verified against live code on `feat/okf-server` (file:line cited). Items that could not be statically verified are explicitly marked **[verify at runtime]**. |

---

## 1. Executive Summary

**The hypothesis is CONFIRMED.** Both admin-facing facilities are still 100% wired to the legacy Winston file-based logging pipeline and were never migrated to query VictoriaLogs:

1. **The logs facility** (`GET /api/admin/logs`, `/logs/summary`, `/logs/search`, `POST /logs/rollover`) reads Winston `combined-*.log` / `error-*.log` files from disk with regex line-parsers (`components/gov-chat-backend/services/logs-service.js`, `services/admin-dashboard-service.js`).
2. **The security scanning facility** (`POST /api/admin/security-scan`, `GET /security-metrics`, `/security/last-scan`) streams those same Winston files through worker threads and pattern-matches lines (`services/security-scan-service.js`).
3. **No application code anywhere in the repo queries VictoriaLogs.** The only consumer is Grafana (datasource `configs/grafana/provisioning/datasources/vm-datasource.yml:5-9`). The migration to Victoria (Epic 7, testing-framework initiative) shipped the *pipeline* (fluentd → OTel Collector → VictoriaLogs) and Grafana dashboards, but the admin backend services were deliberately left on files — Story 7.6's review explicitly deferred this work (see §5).
4. **Worse: on the cloud deployment VictoriaLogs is not even running.** `enable_observability: "0"` in `deploy/ansible/group_vars/all.yml:38` and `deploy/ansible/group_vars/cloud_deploy/vars.yml:13` — the observability stack (including VictoriaLogs) is profile-gated and off. Any migration therefore has a **deployment prerequisite decision**, not just a code change (§8, D1).

**Why this matters (beyond consistency):** the admin users are non-technical and must never be sent to Grafana. Today the admin UI shows *only the backend's own logs* (doc-repo, okf-server, Kong, Keycloak, nginx, OPEA services are invisible to it), parsed through fragile regexes that have already drifted (Finding F4 — `/api/admin/logs` most likely returns an empty set against the current Winston format). Migrating these two services to VictoriaLogs is both a correctness fix and a functional upgrade: one query surface, all services, retention-managed, replica-safe.

**Producer-side mandate (D. Forden, 2026-08-15):** *the logger itself must write to VictoriaLogs — not merely to the console and not merely via an indirect chain.* Today the shared Winston logger (`components/shared/lib/logger.js`) has **no VictoriaLogs sink at all**; its only path into VictoriaLogs is the incidental one — Console transport → container stdout → Docker fluentd driver → OTel Collector → VictoriaLogs — which is gated behind `ENABLE_OBSERVABILITY` and silently drops logs when the Collector is down (Finding F11). The admin dashboard requirements (non-technical operators, full-stack visibility, always available) make VictoriaLogs the authoritative log store, and the logger must feed it as an explicit, first-class destination. The target architecture (§6) therefore covers **both sides**: the producer (shared logger gains a VictoriaLogs transport) and the consumers (admin logs facility + security scanner query it). One transport covers the whole Node fleet: backend, doc-repo, and okf-server all import this same shared logger (`gov-chat-backend/index.js:14`, `document-repository/src/server.js:10`, `okf-server/index.js:13`; copied into okf-server at build, `okf-server/Dockerfile:10,20`).

---

## 2. Verified Current State — What Reads/Writes What

### 2.1 Log production (unchanged by the Victoria migration)

The shared Winston logger still writes **four** destinations (`components/shared/lib/logger.js:41-70`):

| Transport | Destination | Notes |
|---|---|---|
| Console | stdout/stderr | **This** is what the fluentd driver ships to VictoriaLogs |
| `DailyRotateFile` | `logs/error-%DATE%.log` | 10 MB, 30 d, gzipped (`logger.js:48-55`) |
| `DailyRotateFile` | `logs/combined-%DATE%.log` | 10 MB, 30 d, gzipped (`logger.js:56-62`) |
| `File` (tailable) | `logs/combined.log` | 5 MB cap (`logger.js:63-69`) |

Line format: `YYYY-MM-DD HH:mm:ss [LEVEL]: message trace_id="…" span_id="…"` (`logger.js:24-30`), with OTel trace context injected (`logger.js:9-21`). All three Node services persist files to host bind mounts: backend `${DATA_DIR}/logs/backend:/app/logs` (`docker-compose.yaml:431`), doc-repo (`:636`), okf-server (`:532`), plus shared `backend_data:/app/data` volume (`:432`) which holds the security-scan cache (§2.3).

### 2.2 The logs facility — full call chain (all file-based)

Frontend (`components/gov-chat-frontend/src/services/adminDashboardService.js`) → Kong `/api/admin/*` → `components/gov-chat-backend/routes/admin-routes.js` → services:

| Endpoint | Route handler | Backend implementation | Data source |
|---|---|---|---|
| `GET /api/admin/logs` | `admin-routes.js:141` | `adminDashboardService.getLogs()` (`admin-dashboard-service.js:466-585`) | **fs.readFile of `logs/combined-<date>.log`** (`:475-508, 518`) |
| `GET /api/admin/logs/summary` | `admin-routes.js:374` | `logsService.getLogsSummary()` (`logs-service.js:64-127`) | **file scan** via `getLogFilesInRange` (`:75`) |
| `GET /api/admin/logs/search` | `admin-routes.js:435` | `adminDashboardService.searchLogs()` → `logsService.searchLogs()` (`admin-dashboard-service.js:1186-1196`; `logs-service.js:132-246`) | **file scan**, `readLogFile` incl. gunzip (`logs-service.js:269-310`) |
| `POST /api/admin/logs/rollover` | `admin-routes.js:170` | `adminDashboardService.rolloverLogs()` (`admin-dashboard-service.js:591-621`) | **fs.rename of today's file** |
| `POST /api/logger/configure` | `logger-routes.js:97` | `reconfigureLogger()` (rotation sizes/retention) | in-process Winston |
| `POST /api/logger/rollover` | `logger-routes.js:198` | `triggerLogRollover()` | in-process Winston |

File enumeration logic — `combined.log`, `combined1.log`, `error.log` plus dated `combined|error-YYYY-MM-DD.log[.N][.gz]` — lives at `logs-service.js:315-426`. Parsing is a chain of **three** line-format regexes plus embedded-log-line recovery heuristics (`logs-service.js:557-678`), with hard caps of 20 MB / 200 000 lines per file (`logs-service.js:12-14`). "Service" attribution is keyword guessing from the message text (`detectService`, `logs-service.js:701-726`). The summary groups by 8 hardcoded message patterns + generic first-token fallback (`groupLogs`, `logs-service.js:492-552`).

Frontend consumers: `AdminDashboard.vue` (log-summary tables `:669-768`, log table `:1425`, Security tab `:112`) and `LogSearchDialog.vue`.

### 2.3 The security scanning facility (all log-analysis parts file-based)

`POST /api/admin/security-scan` (`admin-routes.js:268`) → `securityScanService.runSecurityScan(logsService)` (`security-scan-service.js:72-102`):

1. `processLogsInParallel()` asks **`logsService.getLogFilesInRange(today-10d, today)`** (`security-scan-service.js:231`, `DAYS_TO_PROCESS = 10` at `:12`) — i.e., it is hard-coupled to the Winston file layout.
2. Valid files (gzip-checked, date-pattern-filtered, `:232-246`) are streamed line-by-line in **worker threads** (`fs.createReadStream` + gunzip, `:1101-1105`).
3. Each line is parsed by one of **three** format regexes (`parseLogLine`, `:356-416`) and matched against **14 vulnerability patterns** + suspicious-activity patterns (`:111-226`), aggregated into critical/medium/low with first/last-seen and instance counts (worker `:1040-1099`).
4. Results are cached to `/app/data/security/last-scan-results.json` (1 h cache read at `:55-70`, write at `:999-1012`); `GET /security-metrics` (`admin-routes.js:227-248`) and `GET /security/last-scan` (`:302-315`) serve from that cache.

Parts of the scanner that are **not** log-dependent and unaffected by this migration: HTTP header checks, server-leakage, timestamp-disclosure, CORS, hidden-file probes (`security-scan-service.js:457-720`) and the recommendations generator (`:828-997`).

### 2.4 The Victoria MELT pipeline (what actually exists)

- All containers use the fluentd logging driver → OTel Collector `fluent_forward` receiver :24224 (`docker-compose.yaml:75-80`; `configs/otel/otel-collector-config.yaml:49-50`).
- Collector logs pipeline: `fluent_forward → batch → otlp_http → http://victorialogs:9428/insert/opentelemetry` (`otel-collector-config.yaml:138-147, 183-189`). **No parsing/transform processors on the logs pipeline** — Winston text lines land in VictoriaLogs as raw `_msg` text with the container tag (`genie.<name>`, e.g. `genie.backend`) as the stream field (confirmed by Grafana dashboard queries `_msg:~"trace_id="`, `configs/grafana/provisioning/dashboards/service-logs.json:170`, and the `genie.` prefix note in `deferred-work.md:72`).
- VictoriaLogs `v1.50.0`, retention `${VICTORIALOGS_RETENTION:-30d}` — matches Winston's 30 d (`docker-compose.yaml:1632-1659`). **Profile-gated**: `profiles: [observability]`, Swarm `replicas: ${ENABLE_OBSERVABILITY:-0}` (`:1634, 1652`).
- **Sole consumer: Grafana** (`vm-datasource.yml:5-9`, trace-ID derived fields `:13-21`).
- **Cloud deployment: observability OFF** (`group_vars/all.yml:38`, `group_vars/cloud_deploy/vars.yml:13`, templated at `deploy/ansible/templates/env.j2:230`).

### 2.5 VictoriaLogs query API available for the rewrite (v1.50.0)

Verified against VictoriaMetrics docs (`docs.victoriametrics.com/victorialogs/querying/`):

| Endpoint | Maps to | Key args |
|---|---|---|
| `POST /select/logsql/query` | `searchLogs`, scanner bulk pull | `query` (LogsQL), `limit` (= N most recent, gives sorting for free), `offset` (pagination), `start`/`end`, `timeout`; returns a JSON-lines stream `{_msg, _stream, _time, …}` |
| `GET /select/logsql/hits` | summary counts | `query`, `start`, `end`, `step`, `field=<name>` group-by, `fields_limit`; returns per-bucket + `total` counts |
| `GET /select/logsql/stats_query[_range]` | summary grouping | query must contain a `| stats by (…) count(*)` pipe; Prometheus-shaped response |
| `GET /select/logsql/field_values` / `streams` | service-filter dropdown values | `field`, `filter=substring`, `limit` |
| `GET /select/logsql/tail` | future live-tail feature | SSE-style streaming |

LogsQL supports stream filters (`{stream="genie.backend"}`), `_time` range filters, word/phrase/regex filters on `_msg`, and query-time field extraction with the `| parse` pipe — enough to reproduce every current filter without changing the log producers (see F6 for the structural caveat).

---

## 3. Findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| **F1** | **Logs facility reads Winston files, not VictoriaLogs.** All five log endpoints are fs-based. | Confirmed / High | §2.2 table |
| **F2** | **Security scanner reads Winston files, not VictoriaLogs.** Hard dependency on `logsService.getLogFilesInRange` + worker-thread file streaming. | Confirmed / High | §2.3; `security-scan-service.js:231, 1101-1105` |
| **F3** | **Zero application-side VictoriaLogs consumers.** Only Grafana queries it. | Confirmed | §2.4 |
| **F4** | **`GET /api/admin/logs` is parsing a format the logger no longer emits.** `getLogs` matches `\[ts\] \[level\] \[service\] msg` (`admin-dashboard-service.js:525`) but the logger produces `ts [LEVEL]: msg` (`logger.js:24-30`). Static analysis says near-zero lines parse; **[verify at runtime]**. Classic symptom of the regex-drift fragility of the file approach. | High (latent defect) | cited |
| **F5** | **Admin visibility is backend-only.** The files live in the backend container's `/app/logs` bind mount; doc-repo, okf-server, Kong, Keycloak, nginx, dataprep/chatqna logs never reach the admin UI. VictoriaLogs already holds them all. | High (functional gap) | `docker-compose.yaml:431, 532, 636` |
| **F6** | **Logs land in VictoriaLogs as unstructured text.** No level/service fields — the collector ships raw `_msg` lines (§2.4). A naive VL rewrite would have to regex-parse at query time to recover `level`/`service`. The clean fix (structured JSON logging) was explicitly deferred in Story 7.6. | Medium (design driver) | §2.4; §5 |
| **F7** | **Deployment dependency: VictoriaLogs is optional and off in cloud.** `ENABLE_OBSERVABILITY=0` means the admin features would query a nonexistent service after a code-only migration. Needs decision D1. | High (blocker) | §2.4 |
| **F8** | **Multi-writer / replica hazards of the file approach.** Backend currently `replicas: 1` (`docker-compose.yaml:506`), but scaling to N would have N tasks writing the same host bind-mounted files; Winston rotation + `rolloverLogs()`'s manual `fs.rename` (`admin-dashboard-service.js:596-603`) would corrupt/race. VL path is replica-safe. | Medium (latent) | cited |
| **F9** | **File-scan caps silently truncate.** 20 MB / 200 000-line caps and a 200 s scan budget (`logs-service.js:12-14`; `security-scan-service.js:11, 257`) mean big days are silently dropped from both search and security scans (`log_limit_exceeded` self-report, `security-scan-service.js:219-225`). VL queries don't have this failure mode. | Medium | cited |
| **F10** | **Blind spots of the file-based security scan.** The scanner's own patterns target backend-emitted messages (e.g. "Blocked access to sensitive path" is emitted by the backend itself, `index.js:553`), but gateway-level signals (Kong 401/404 probing, nginx blocks) that exist in VictoriaLogs are invisible to it. Migration is an opportunity to widen coverage, not just move it. | Low (enhancement) | §2.3 |
| **F11** | **The shared logger has no VictoriaLogs write path.** Its Console output only reaches VictoriaLogs through the incidental stdout→fluentd→Collector chain, which (a) is disabled unless `ENABLE_OBSERVABILITY=1`, (b) drops logs while the Collector is down (documented trade-off, `deferred-work.md:66`), and (c) ships raw text, so `level`/`service` are not queryable fields (F6). Per the producer-side mandate, the logger must write to VictoriaLogs as an explicit destination. | **High (mandate)** | `logger.js:41-70`; §2.4; §6 |

---

## 4. What "Same High-Quality Responses" Requires (response-contract preservation)

The frontend must keep working unchanged (except intentional improvements). The backend rewrite has to reproduce these exact response shapes from VictoriaLogs data:

- `GET /admin/logs` → `{ logs: [{date, time, level, service, message, messageKey}], total, limit, offset }` (`admin-dashboard-service.js:533-577`) — **and fix F4 in the process**.
- `GET /admin/logs/summary` → `{ errors: [{type, typeKey, service, count}], warnings: […], date }` (`logs-service.js:113-121`; grouping `:492-552`).
- `GET /admin/logs/search` → `{ logs: [{date, time, level, service, message}], total }` (`logs-service.js:228-241`).
- `POST /admin/security-scan` → `{ scanTime, vulnerabilities: {critical, medium, low, details}, vulnerabilityDetails, failedLoginDetails, suspiciousDetails, status, message }` (`security-scan-service.js:80-93`) + cache file contract for `/security-metrics` and `/security/last-scan`.
- Recommendations output (`generateRecommendations`, `security-scan-service.js:828-997`) unchanged.

Recommended implementation stance for fidelity: **pull the matching messages from VictoriaLogs, then run the existing, unit-tested classification/aggregation logic in-process** (patterns, `groupLogs`, dedup, recommendations all survive verbatim). Use VL `| stats` / `hits` endpoints only where pure counts are needed (e.g. summary counts at scale). This keeps behavioral parity risk near zero.

---

## 5. Precedent & Prior Decisions (do not re-litigate, build on)

1. **Story 7.6 explicitly deferred this work.** Its review notes record: *"Structured JSON logging migration — deferred to dedicated story. Analysis: requires rewriting logs-service.js (3 regex parsers), updating LogSearchDialog.test.js, logger-functions.test.js, AdminDashboard.vue parseLogMessage(). Full impact documented in deferred-work.md."* (`_bmad-output/archived/testing-framework/implementation-artifacts/7-6-…md`, review item ~line 540). **Note:** the promised entry is *absent* from `deferred-work.md`'s 7-6 section (`:64-72` only lists pipeline items) — this assessment supersedes/fills that gap.
2. **Story 7.6 also fixed trace-correlation into the printf format** (`logger.js:24-31` patch, review item ~line 529) — deliberately kept backward-compatible with `logs-service.js`'s parser. The producer rewire (§6.1) supersedes this printf mechanism (trace correlation becomes native OTel log-record context) and must preserve the Grafana derived-field links (`vm-datasource.yml:13-21`) by keeping trace IDs as queryable fields.
3. **A backend-agnostic MELT provider API was already designed** — `docs/logging-architecture-evaluation.md` §14: `MELTService` abstraction, `MELT_PROVIDER` env selection, factory pattern, `LogEntry`/`LogQuery`/`LogQueryResult` interfaces. The rewrite should land behind this interface from day one (provider: `victorialogs`), leaving the door open for other backends without a second rewrite.
4. **Deferred known trade-offs that now matter**: fluentd drops logs while the Collector is down (`fluentd-async`, documented `deferred-work.md:66`); `vlogs-data` volume has no backup strategy (`:70`). The admin features inherit these — call them out in the story ACs (§7, P1 verification).

---

## 6. Recommended Target Architecture

Two sides, one store — **the logger writes to VictoriaLogs; the admin facilities read from it.**

### 6.1 Producer path — the shared logger gains a VictoriaLogs transport (fixes F11, F6 at the source)

```
components/shared/lib/logger.js   ← single change point; backend, doc-repo, okf-server
                                    all import this logger (gov-chat-backend/index.js:14,
                                    document-repository/src/server.js:10, okf-server/index.js:13
                                    + Dockerfile:10,20)
  Winston createLogger
    ├─ Console transport            (kept: docker logs, local dev, always-on mirror)
    └─ NEW VictoriaLogsTransport    (custom Winston transport)
         → OTel LoggerProvider + BatchLogRecordProcessor   (async, buffered, never blocks requests)
         → OTLP HTTP logs exporter
             default: http://otel-collector:4318/v1/logs       (collector forwards; reuses retry/queue)
             direct:  http://victorialogs:9428/insert/opentelemetry/v1/logs   (option, see D6)
         structured fields on every record: level, service.name, trace_id, span_id
         VL-Stream-Fields header pins stream identity (service.name, deployment.environment)
    └─ DailyRotateFile transports   (deployment: removed in P5; local dev: optional)
```

Producer design points:

- **OTel-native, not a bespoke HTTP client.** The backend already initializes the OTel SDK (`tracing.js`); adding the OTel logs API (`@opentelemetry/sdk-logs` + `@opentelemetry/exporter-logs-otlp-http`) keeps a single telemetry idiom, gives automatic trace-context correlation on every record (the manual `traceFormat` printf injection at `logger.js:9-30` becomes redundant), and inherits batching/queue/retry semantics. VictoriaLogs officially supports OTLP log ingestion at `/insert/opentelemetry/v1/logs` and treats resource attributes as stream fields (VictoriaMetrics docs, *VictoriaLogs → Data Ingestion → OpenTelemetry*; the Collector already uses this insert path, `otel-collector-config.yaml:139`).
- **Structured from day one.** Every record carries `level`, `service.name`, `trace_id`, `span_id` as real fields — first-class filterable dimensions in VictoriaLogs, which is exactly what the admin UI's level/service filters and the security scanner consume. This dissolves F6 structurally rather than patching it with query-time parsing.
- **Non-blocking guarantee.** `BatchLogRecordProcessor` exports asynchronously; a VictoriaLogs/Collector outage never blocks or crashes request handling — records queue, and drop on overflow with a visible drop counter. The Console transport stays as the always-on mirror (`docker logs`, local dev, and forensic fallback).
- **Duplication control (critical detail).** While stdout is *also* shipped by the fluentd driver, every line would land **twice** in VictoriaLogs (direct OTLP + fluentd→Collector). Mitigation: once direct export is verified in an environment, switch the direct-writing services' Docker `logging:` driver from `fluentd` to `local`/`json-file` (per-service override in `docker-compose.yaml`; Docker dual logging keeps `docker logs` functional). Non-Node services (Kong, Keycloak, nginx, postgres, OPEA/Python) remain on fluentd → Collector, so the Collector stays in the loop for them and for metrics/traces.
- **Config** (defaults in code/compose per the env-file DRY convention): `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `VL-Stream-Fields`, `LOG_TO_VICTORIALOGS` (`1` in deployment; off for bare-metal local dev where no VL exists).

### 6.2 Consumer path — admin facilities query VictoriaLogs

```
AdminDashboard.vue / LogSearchDialog.vue          (unchanged contract; optional: multi-service filter)
        │  /api/admin/logs*, /security-*
Kong → gov-chat-backend
        │
        ├─ services/logs-service.js               (public methods unchanged:
        │     searchLogs / getLogsSummary / getLogs   → now build LogsQL, call provider)
        ├─ services/security-scan-service.js      (patterns/aggregation unchanged;
        │     file streaming + worker threads deleted → provider queries)
        └─ NEW shared/lib/melt/                    (MELT provider per docs §14)
              ├─ types (LogEntry, LogQuery, LogQueryResult)
              ├─ providers/victorialogs.js        (axios; /select/logsql/query|hits|stats_query|field_values;
              │                                    JSON-lines stream parse; timeout; error mapping)
              └─ index.js createMELTService()     (MELT_PROVIDER=victorialogs default)
```

Consumer design points:

- **Config**: `VICTORIALOGS_URL` (default `http://victorialogs:9428`), `MELT_PROVIDER` (`victorialogs`), plus `ADMIN_LOGS_SOURCE` (`victorialogs` | `file`) as an explicit fallback switch for the transition window (D2).
- **Level/service filters use real fields** (`level:`, `service.name:`) once §6.1 lands — no regex parsing of `_msg` for post-cutover logs. A small legacy-text parse bridge (reusing the existing, unit-tested `parseLogs` regexes over `_msg`) covers only pre-cutover records still within retention, and is deleted after the 30 d window passes.
- **Security scan**: replace "read 10 days of files" with bounded VL queries — one bulk `query` per day-window for messages matching the pattern union (`_time:[start,end) AND (error OR warn OR <keywords>)`, `limit` set so caps are explicit, plus a `log_limit_exceeded` equivalent surfaced honestly), then run the unchanged pattern/aggregation code. 200 s budget maps to VL `timeout` arg. Consider (P3, optional) adding 1–2 gateway patterns (Kong 401/404 bursts) — F10.
- **Scan-result cache**: keep `/app/data/security/last-scan-results.json` (volume-backed, `docker-compose.yaml:432`) so `/security-metrics` and `/last-scan` behavior is unchanged; optionally later move to ArangoDB.
- **Graceful degradation (F7)**: when VictoriaLogs is unreachable/disabled, endpoints return a *clear, honest* 503-style payload ("Centralized logging is not enabled on this deployment — set ENABLE_OBSERVABILITY=1") rather than empty arrays masquerading as "no logs" (per the smoke-test-integrity rule: never render a broken facility as a healthy empty one).
- **Deprecations**: `POST /admin/logs/rollover`, `POST /api/logger/rollover` and Winston rotation tuning in `/api/logger/configure` become no-ops/deprecated once files are no longer the source of truth (frontend button removal included). The Console transport **stays** as a mirror (`docker logs`, local dev) — but it is no longer the VictoriaLogs feed; that role moves to the §6.1 transport.

---

## 7. Migration Plan (phased stories)

| Phase | Story | Content | Exit criteria (measurable) |
|---|---|---|---|
| **P0** | Enable & verify pipeline | Decision D1 executed; VictoriaLogs running on target env; verify current stdout-shipped logs present in VL with expected stream values; document the exact field layout (`_msg`, stream name) — resolves the [verify] tags in §2.4 | Querying `{stream=~"genie.*"}` over 24 h returns entries from ≥ backend, doc-repo, okf-server; Grafana service-logs dashboard shows them |
| **P1a** | **Producer: logger → VictoriaLogs transport** (the mandate) | §6.1: custom Winston transport in `shared/lib/logger.js` → OTel LoggerProvider + BatchLogRecordProcessor → OTLP HTTP logs exporter (via Collector `:4318/v1/logs`; add `otlp` receiver to the Collector logs pipeline); structured records (level, service.name, trace_id, span_id); `VL-Stream-Fields`; non-blocking with queue/drop counter; unit tests incl. `logger-functions.test.js` / `logger-otel-trace.test.js` updates; deploy backend+doc-repo+okf-server images | Trigger a request in each of the three Node services → records appear in VL with `level`, `service.name`, `trace_id` as **fields** (not text); killing VL does not block or crash any service (drop counter visible); no duplicate lines from a single emission |
| **P1b** | **Consumer: MELT provider + VL query client** | `shared/lib/melt/` per §6.2; unit tests with a mocked VL HTTP API (JSON-lines stream, hits, stats); timeout + error mapping; health probe | Provider unit + contract tests green in CI; no route changes yet |
| **P1c** | Producer cutover / dedup | After P1a verified per environment: switch the three Node services' Docker `logging:` driver `fluentd` → `local` (per-service override); update Grafana service-logs dashboard variables to the structured fields (`level`, `service.name`) | Each log line exists exactly once in VL; `docker logs` still works on the three services; Grafana dashboards filter on real fields |
| **P2** | Logs facility rewire | `logs-service.js` internals swapped to provider behind unchanged public methods; `getLogs` format bug (F4) fixed; field-based filters (post-cutover) + legacy `_msg` parse bridge (pre-cutover window); graceful-degradation payload; `ADMIN_LOGS_SOURCE=file` escape hatch; frontend regression-run of AdminDashboard + LogSearchDialog (update the Story-7.6 format-preservation tests to the new path) | `/admin/logs`, `/logs/summary`, `/logs/search` return contract-identical responses sourced from VL; Jest contract tests compare old/new shapes; manual e2e parity check on cloud |
| **P3** | Security scanner rewire | File enumeration + worker threads removed; VL bulk queries feed unchanged pattern engine; cache contract kept; timeout mapping; optional gateway patterns (F10) | `POST /admin/security-scan` on a day with known seeded security messages (e.g. a blocked-path request) reports them; scan completes ≪ 200 s on 10-day window; `/security-metrics` unchanged |
| **P4** | Cleanup (absorbs the old "structured JSON" phase — now native via P1a) | Remove DailyRotateFile/`combined.log` transports in deployment (env-gated, keep for local dev); delete the legacy `_msg` parse bridge once pre-cutover records age out of retention (30 d); deprecate rollover endpoints + frontend button; drop `./data/logs/*` bind mounts; archive the change in docs (`site/content/en/docs/observability/`) | Single source of truth = VictoriaLogs; no regex log parsing left in either service; docs updated; dead code removed |

Estimated effort: P1a ~1 story, P1b ~1 story, P1c ~½ story, P2 ~1–2 stories, P3 ~1 story, P4 ~½ story. **P1a is the foundation** — once the logger writes structured records to VictoriaLogs, P2/P3 read real fields and never need the regex bridge for new logs. P2+P3 are the user-visible admin-dashboard deliverable.

**Test strategy throughout**: Jest unit (mocked VL API) → route contract tests (response-shape equality vs. current fixtures) → cloud smoke test with pre-written success criteria (seed a security-relevant request, verify it appears in `/admin/logs/search` AND the next scan) — per the smoke-test-integrity rule, criteria defined before the run and each verified against ground truth.

---

## 8. Decisions Needed Before Implementation

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Is VictoriaLogs a hard dependency of the admin dashboard? | (a) Split VictoriaLogs (+ Collector, needed as OTLP egress) out of the `observability` profile into the core stack; (b) keep profile-gated, admin features degrade with an honest message; (c) require `ENABLE_OBSERVABILITY=1` wherever admin logs are used | **(a)** — reinforced by the producer mandate: once the logger writes directly to VL (§6.1), VictoriaLogs becomes the authoritative log store for the Node fleet, not an optional dashboard backend. Logs browsing + security scanning are core admin features for non-technical operators; the Collector is already `mode: global`. Keep metrics/traces/Grafana optional. Cost: modest always-on footprint on the `genieai` node. |
| **D2** | Cutover strategy | Big-bang swap vs. `ADMIN_LOGS_SOURCE` env fallback to files for one release | **Fallback switch for one release**, then remove in P4 (cleanup). |
| **D3** | Scope of the "service" filter post-migration | Backend-only (strict parity) vs. all services in VictoriaLogs | **All services** — the data is already there, and a full-stack view is precisely the value for a non-technical admin. Default filter = "All", with per-service dropdown from `/select/logsql/field_values`. |
| **D4** | Producer-first vs. consumer-first sequencing | Land §6.1 transport before rewiring the query services vs. the reverse | **Producer-first (P1a before P2/P3)** — once the logger emits structured records, the consumer rewrite reads real fields and never needs regex text-parsing for new logs; the bridge shrinks to the pre-cutover retention window. (This supersedes the earlier "structured JSON later" sequencing — it is now the point of the exercise, per the mandate.) |
| **D5** | Retention alignment | VL `VICTORIALOGS_RETENTION` (30 d default) vs. Winston 30 d | Already aligned; confirm per-environment (env §12C) when enabling P0. |
| **D6** | Producer egress path for OTLP logs | (a) Via OTel Collector `:4318/v1/logs` (add `otlp` receiver to its logs pipeline); (b) direct to `http://victorialogs:9428/insert/opentelemetry/v1/logs` | **(a) via the Collector** as default — one egress point, reuses its sending-queue/retry config, and the Collector stays required anyway for non-Node services' logs + metrics/traces. Keep (b) as an env-configurable override (also the answer if the Collector is ever split from the core in D1). |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| VictoriaLogs unavailable/observability off → admin features dead | D1 + explicit degradation payloads; health probe surfaced in `/api/health` |
| App-side runtime dependency on VL/Collector once the logger writes directly (§6.1) | BatchLogRecordProcessor is async & non-blocking by construction; queue-with-drop + drop counter; Console mirror keeps `docker logs`/stdout as forensic fallback; load-test AC in P1a ("kill VL, services keep serving") |
| **Duplicate ingestion** during the dual-ship window (direct OTLP + stdout→fluentd both landing in VL) | Explicit P1c cutover step: switch the three Node services' Docker logging driver off fluentd once direct export is verified per environment; never leave both active long-term |
| Silent log loss while Collector down (fluentd-async, known trade-off) | Improved by §6.1 (OTLP exporter has its own retry/queue); Console mirror still loses nothing locally; document residual window |
| `_msg`-text parsing drift (the F4 lesson) | Largely deleted by P1a (structured fields); legacy bridge kept only for pre-cutover records and removed in P4 |
| OTel logs SDK maturity in Node (`@opentelemetry/sdk-logs`) | Stable API since OTel JS 0.52+/experimental-mature; pin the version aligned with the SDK already used by `tracing.js`; fallback design (plain OTLP HTTP POST to `/insert/jsonline`) kept in the story as plan B |
| Stream-field cardinality (VL-Stream-Fields choice) | Pin to `service.name,deployment.environment` (low, bounded); do NOT put trace_id or per-request fields in stream fields |
| PII in structured fields | `tracing-pii.js` filters *span attributes* only — log record fields are a new surface; story AC: extend PII scrubbing to log-record attributes before P1a ships |
| VL query load from admin UI (summary endpoints) | `limit` args, `timeout`, sensible defaults; reuse the 2 s-refresh concern noted in `deferred-work.md:71` — admin UI is on-demand, not auto-refresh |
| Unauthenticated VL HTTP API on the internal network (pre-existing) | Backend-to-VL is internal-network only; note in security review; unchanged by this work |
| Scan semantics change (time-window boundaries, UTC vs. local timestamp drift between Winston wall-clock and VL ingest `_time`) | Pin TZ in containers (already UTC-based images); verify in P3 AC with seeded events |
| Frontend regressions | Contract tests + manual e2e on AdminDashboard tabs before/after P2/P3 |

---

## 10. Evidence Index (primary sources)

- Winston logger & transports — `components/shared/lib/logger.js:9-70`
- Logs service (file enumeration, parsing, summary) — `components/gov-chat-backend/services/logs-service.js:12-14, 48, 64-127, 132-246, 269-310, 315-426, 557-678, 701-726, 492-552`
- `getLogs` + broken format regex + manual rollover — `components/gov-chat-backend/services/admin-dashboard-service.js:466-585, 525, 591-621`
- Security scanner — `components/gov-chat-backend/services/security-scan-service.js:11-12, 55-70, 72-102, 105-316, 356-416, 457-720, 828-997, 999-1012, 1016-1125`; blocked-path emission `index.js:553`
- Admin/loggers API surface — `components/gov-chat-backend/routes/admin-routes.js:141, 170, 227, 268, 302, 374, 435`; `routes/logger-routes.js:97, 198`
- Frontend consumers — `components/gov-chat-frontend/src/services/adminDashboardService.js:35, 71, 85, 105, 134, 157, 184`; `AdminDashboard.vue:112, 669-768, 1425`; `LogSearchDialog.vue`
- Log shipping & storage — `docker-compose.yaml:48, 69-80, 429-433, 506, 532, 636, 1632-1659`; `configs/otel/otel-collector-config.yaml:44-50, 112-147, 162-189`
- Grafana as sole VL consumer — `configs/grafana/provisioning/datasources/vm-datasource.yml:5-21`; `service-logs.json:170`
- Deployment gating — `deploy/ansible/group_vars/all.yml:38`; `deploy/ansible/group_vars/cloud_deploy/vars.yml:13`; `deploy/ansible/templates/env.j2:230`
- Prior decisions — `_bmad-output/archived/testing-framework/implementation-artifacts/7-6-deploy-victorialogs-centralized-log-aggregation.md` (review items incl. structured-logging deferral); `_bmad-output/implementation-artifacts/deferred-work.md:64-72`; `docs/logging-architecture-evaluation.md` §14 (MELT Provider API design)
- Shared-logger adoption across Node services — `components/gov-chat-backend/index.js:14`; `components/document-repository/src/server.js:10`; `components/okf-server/index.js:13` + `components/okf-server/Dockerfile:4,10,20`
- VictoriaLogs query API — VictoriaMetrics docs, *VictoriaLogs → Querying* (`/select/logsql/*`), verified 2026-08-15 against v1.50.0
- VictoriaLogs OTLP log ingestion (producer path, §6.1) — VictoriaMetrics docs, *VictoriaLogs → Data Ingestion → OpenTelemetry* (`/insert/opentelemetry/v1/logs`, `VL-Stream-Fields` header, resource attributes as stream fields), verified 2026-08-15