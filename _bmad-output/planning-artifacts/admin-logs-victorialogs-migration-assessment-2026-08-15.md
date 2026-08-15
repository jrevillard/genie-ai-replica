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
2. **Story 7.6 also fixed trace-correlation into the printf format** (`logger.js:24-31` patch, review item ~line 529) — deliberately kept backward-compatible with `logs-service.js`'s parser. Any format change (D3/Phase 4) must preserve `trace_id`/`span_id` emission and the Grafana derived-field links (`vm-datasource.yml:13-21`).
3. **A backend-agnostic MELT provider API was already designed** — `docs/logging-architecture-evaluation.md` §14: `MELTService` abstraction, `MELT_PROVIDER` env selection, factory pattern, `LogEntry`/`LogQuery`/`LogQueryResult` interfaces. The rewrite should land behind this interface from day one (provider: `victorialogs`), leaving the door open for other backends without a second rewrite.
4. **Deferred known trade-offs that now matter**: fluentd drops logs while the Collector is down (`fluentd-async`, documented `deferred-work.md:66`); `vlogs-data` volume has no backup strategy (`:70`). The admin features inherit these — call them out in the story ACs (§7, P1 verification).

---

## 6. Recommended Target Architecture

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

Key design points:

- **Config**: `VICTORIALOGS_URL` (default `http://victorialogs:9428`), `MELT_PROVIDER` (`victorialogs`), plus `ADMIN_LOGS_SOURCE` (`victorialogs` | `file`) as an explicit fallback switch for the transition window (D2).
- **Level/service extraction (bridging F6)**: query-time `| parse` pipe over the known Winston format (e.g. extract `[LEVEL]`) **or** in-service parse of returned `_msg` lines — the *existing* `parseLogs` regexes are reusable almost verbatim on `_msg`. Service attribution improves for free: prefer the stream field (`genie.<service>` → strip prefix — also resolves deferred-work `:72`) and keep message-keyword detection as fallback. Phase 4 (structured JSON logging) then makes `level`/`service` first-class VL fields and the parse bridge can be deleted.
- **Security scan**: replace "read 10 days of files" with bounded VL queries — one bulk `query` per day-window for messages matching the pattern union (`_time:[start,end) AND (error OR warn OR <keywords>)`, `limit` set so caps are explicit, plus a `log_limit_exceeded` equivalent surfaced honestly), then run the unchanged pattern/aggregation code. 200 s budget maps to VL `timeout` arg. Consider (P3, optional) adding 1–2 gateway patterns (Kong 401/404 bursts) — F10.
- **Scan-result cache**: keep `/app/data/security/last-scan-results.json` (volume-backed, `docker-compose.yaml:432`) so `/security-metrics` and `/last-scan` behavior is unchanged; optionally later move to ArangoDB.
- **Graceful degradation (F7)**: when VictoriaLogs is unreachable/disabled, endpoints return a *clear, honest* 503-style payload ("Centralized logging is not enabled on this deployment — set ENABLE_OBSERVABILITY=1") rather than empty arrays masquerading as "no logs" (per the smoke-test-integrity rule: never render a broken facility as a healthy empty one).
- **Deprecations**: `POST /admin/logs/rollover`, `POST /api/logger/rollover` and Winston rotation tuning in `/api/logger/configure` become no-ops/deprecated once files are no longer the source of truth (frontend button removal included). Winston **Console transport must stay** — it feeds the fluentd pipeline.

---

## 7. Migration Plan (phased stories)

| Phase | Story | Content | Exit criteria (measurable) |
|---|---|---|---|
| **P0** | Enable & verify pipeline | Decision D1 executed; `ENABLE_OBSERVABILITY=1` on target env; verify backend+doc-repo+okf-server logs present in VL with expected stream values; document the exact field layout (`_msg`, stream name) — resolves the [verify] tags in §2.4 | Querying `{stream=~"genie.*"}` over 24 h returns entries from ≥ backend, doc-repo, okf-server; Grafana service-logs dashboard shows them |
| **P1** | MELT provider + VL client | `shared/lib/melt/` per §6; unit tests with a mocked VL HTTP API (JSON-lines stream, hits, stats); timeout + error mapping; health probe | Provider unit + contract tests green in CI; no route changes yet |
| **P2** | Logs facility rewire | `logs-service.js` internals swapped to provider behind unchanged public methods; `getLogs` format bug (F4) fixed; graceful-degradation payload; `ADMIN_LOGS_SOURCE=file` escape hatch; frontend regression-run of AdminDashboard + LogSearchDialog (update the Story-7.6 format-preservation tests to the new path) | `/admin/logs`, `/logs/summary`, `/logs/search` return contract-identical responses sourced from VL; Jest contract tests compare old/new shapes; manual e2e parity check on cloud |
| **P3** | Security scanner rewire | File enumeration + worker threads removed; VL bulk queries feed unchanged pattern engine; cache contract kept; timeout mapping; optional gateway patterns (F10) | `POST /admin/security-scan` on a day with known seeded security messages (e.g. a blocked-path request) reports them; scan completes ≪ 200 s on 10-day window; `/security-metrics` unchanged |
| **P4** | Structured JSON logging (the deferred 7.6 story) | Winston emits JSON (level/service/trace_id as fields) to Console; keep text format only for local file/dev; Grafana dashboards + admin filters move to real fields; delete the parse bridge; update `LogSearchDialog.test.js`, `logger-functions.test.js`, Grafana service-logs dashboard | VL shows `level`/`service` fields; admin filters use field values (`field_values` API); no regex parsing left in either service |
| **P5** | Cleanup | Remove DailyRotateFile/`combined.log` transports in deployment (env-gated, keep for local dev); deprecate rollover endpoints + frontend button; drop `./data/logs/*` bind mounts; archive the change in docs (`site/content/en/docs/observability/`) | Single source of truth = VictoriaLogs; docs updated; dead code removed |

Estimated effort: P1 ~1 story, P2 ~1–2 stories, P3 ~1 story, P4 ~1–2 stories, P5 ~½ story. P2+P3 are the user-visible deliverable; P4 is quality-of-life; P5 is hygiene.

**Test strategy throughout**: Jest unit (mocked VL API) → route contract tests (response-shape equality vs. current fixtures) → cloud smoke test with pre-written success criteria (seed a security-relevant request, verify it appears in `/admin/logs/search` AND the next scan) — per the smoke-test-integrity rule, criteria defined before the run and each verified against ground truth.

---

## 8. Decisions Needed Before Implementation

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Is VictoriaLogs a hard dependency of the admin dashboard? | (a) Split VictoriaLogs + Collector's logs pipeline out of the `observability` profile into the core stack; (b) keep profile-gated, admin features degrade with an honest message; (c) require `ENABLE_OBSERVABILITY=1` wherever admin logs are used | **(a)** — logs browsing + security scanning are core admin features for non-technical operators; the collector is already `mode: global`. Keep metrics/traces/Grafana optional. Cost: modest always-on footprint on the `genieai` node. |
| **D2** | Cutover strategy | Big-bang swap vs. `ADMIN_LOGS_SOURCE` env fallback to files for one release | **Fallback switch for one release**, then remove in P5. |
| **D3** | Scope of the "service" filter post-migration | Backend-only (strict parity) vs. all services in VictoriaLogs | **All services** — the data is already there, and a full-stack view is precisely the value for a non-technical admin. Default filter = "All", with per-service dropdown from `/select/logsql/field_values`. |
| **D4** | When to do P4 (structured JSON) | Before P2/P3 (clean foundation) vs. after (parity first) | **After** — the parse bridge is cheap and reuses tested regexes; P4 touches producers, Grafana, and three test suites and shouldn't block the user-visible fix. |
| **D5** | Retention alignment | VL `VICTORIALOGS_RETENTION` (30 d default) vs. Winston 30 d | Already aligned; confirm per-environment (env §12C) when enabling P0. |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| VictoriaLogs unavailable/observability off → admin features dead | D1 + explicit degradation payloads; health probe surfaced in `/api/health` |
| Silent log loss while Collector down (fluentd-async, known trade-off) | Document in feature docs; the degradation message covers outages; consider vlagent later |
| `_msg`-text parsing drift (the F4 lesson) | P4 structured JSON deletes the whole class; until then, reuse (don't reinvent) the existing regexes and pin them with format tests |
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
- VictoriaLogs query API — VictoriaMetrics docs, *VictoriaLogs → Querying* (`/select/logsql/*`), verified 2026-08-15 against v1.50.0