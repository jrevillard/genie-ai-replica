---
id: SPEC-admin-logs-victorialogs-migration
companions:
  - phases.md
  - env-vars.md
  - vuln-patterns.md
  - rollback-matrix.md
  - verification.md
sources:
  - /home/jerome/.claude/plans/snuggly-mapping-aho.md
  - "https://opensource.unicc.org/un/itu/genie-ai/-/raw/feat/okf-server/_bmad-output/planning-artifacts/admin-logs-victorialogs-migration-assessment-2026-08-15.md?ref_type=heads"
---

> Canonical contract. Read SPEC.md plus the files in `companions:` for the complete, preservation-validated contract.

# Admin Logs + Security-Scan → VictoriaLogs Migration

## Why

A mandate from D. Forden (2026-08-15): the Winston logger must write directly to VictoriaLogs — not via console and not via the indirect fluentd-only chain.

Today the admin dashboard *Logs* facility and *Security scanning* facility both read `combined-*.log` / `error-*.log` files from disk. A live bug (F4) makes `GET /api/admin/logs` parse a triple-bracket format the logger no longer emits, so that endpoint returns an empty `logs[]` array for any real input. The producer constraint (printf format) that prevented an earlier JSON switch dissolves now that consumers query VL instead of files.

Migration runs producer-first across 7 phases (P0–P4 with sub-phases). D1 lifts VL + OTel Collector out of the optional observability profile into the always-on core stack so the admin endpoints stay functional without flipping `ENABLE_OBSERVABILITY=1`. A permanent `ADMIN_LOGS_SOURCE=file` escape hatch plus per-phase rollback switches keep operators unblocked during the multi-MR rollout.

## Capabilities

- **CAP-1 Producer emits structured log records to VictoriaLogs**
  - **intent:** Winston logger writes each record to VictoriaLogs via OTel `LoggerProvider` + `OTLPLogExporter` + `BatchLogRecordProcessor`, gated on `LOG_TO_VICTORIALOGS=1 && ENABLE_OBSERVABILITY=1`.
  - **success:** `logger.info('hello')` produces a POST to `otel-collector:4318/v1/logs` within 5 s; `curl http://victorialogs:9428/select/logsql/query?q=service:genie-backend` returns the record; killing VL does not block any Node service (drop counter visible; console mirror preserves records).
- **CAP-2 Winston format is JSON, not printf**
  - **intent:** Replace the printf format with `winston.format.combine(timestamp(), errors({stack:true}), json())`; `trace_id` / `span_id` become JSON keys, not printf substrings.
  - **success:** File lines are valid JSON (one record per line) when `LOG_TO_FILE=1`; `LogSearchDialog.test.js` Story 7.6 describe block parses JSON instead of regex; existing `logger-otel-trace.test.js` extends to assert `info.trace_id` / `info.span_id` are JSON keys.
- **CAP-3 Admin Logs endpoints query VictoriaLogs**
  - **intent:** `LogsService` and `admin-dashboard-service.js` use `VictoriaLogsClient` for `GET /api/admin/logs`, `/summary`, `/search`, `/debug-yesterday`; F4 regex at `admin-dashboard-service.js:525` removed.
  - **success:** `logs-vl-contract.test.js` captures responses from the legacy file path and the new VL path against the same fixture and asserts deep-equal on `{logs[], total, limit, offset}` and summary/search shapes; MR gate.
- **CAP-4 Security scanner queries VictoriaLogs**
  - **intent:** `POST /api/admin/security-scan` drops `worker_threads` file streaming and runs a single LogSQL `_msg OR`-joined query against all 14 vulnerability patterns over the scan window.
  - **success:** Scan over a 7-day window completes in < 2 s; response shape `vulnerabilities.{critical,medium,low}[]` unchanged; `/app/data/security/last-scan-results.json` cache write retained; `grep -n "worker_threads" services/security-scan-service.js` returns 0.
- **CAP-5 Graceful degradation when VictoriaLogs unreachable**
  - **intent:** Wrap VL client calls in `LogsService` and `securityScanService`; when 5xx / ECONNREFUSED / ENOTFOUND / timeout, return empty results + `degraded: true` flag (gated on `VL_FAIL_OPEN=true`); rate-limit the error log to 1 per minute.
  - **success:** With `VL_FAIL_OPEN=true`, `docker stop victorialogs` + `GET /api/admin/logs` returns `{logs:[], total:0, degraded:true}` AND `POST /api/admin/security-scan` returns `{vulnerabilities:{critical:[],medium:[],low:[]}, degraded:true, error:'vl_unreachable'}` within 5 s; `backend.logger.error` fires at most once per minute; rate-limit state persists across backend restarts via `/tmp/vl-fail-open-ts`.
- **CAP-6 Per-phase rollback escape hatches**
  - **intent:** Each phase ships with a tested env switch that re-enables the previous behaviour: `LOG_TO_VICTORIALOGS=0` (P1a), `ADMIN_LOGS_SOURCE=file` (P2), `VL_FAIL_OPEN=true` (P3), `LOG_TO_FILE=1` (P4).
  - **success:** Each switch tested with smoke on the deployed release branch before merge to `main`; `ADMIN_LOGS_SOURCE=file` is permanent and never removed.
- **CAP-7 VictoriaLogs + OTel Collector always-on core stack (D1)**
  - **intent:** Remove `profiles: [observability]` from `victorialogs`, `otel-collector`, and `otel-collector-init` in `docker-compose.yaml` so they start by default in `docker compose up`; pin `victorialogs.deploy.replicas: 1` so Swarm always runs one replica regardless of `ENABLE_OBSERVABILITY`. Non-Node services (Python OPEA, Kong, nginx, postgres) keep `fluentd → collector → VL`.
  - **success:** `docker compose config --services` lists VL + Collector + init alongside the always-on core services; `curl http://victorialogs:9428/health` returns `{"status":"ok"}`; `ENABLE_OBSERVABILITY=0` deployments keep the admin endpoints functional.

## Constraints

- **C-1 Backend JS = CommonJS only** — no ES `import`/`export`; Winston transport, `VictoriaLogsClient`, MELT module all use `require()` / `module.exports` (project-context.md rule 1).
- **C-2 Response shape contract preservation** — `LogsService` and `securityScanService` public methods return JSON identical to pre-migration. Contract tests gate MRs.
- **C-3 Logs egress via OTel Collector (D6)** — apps POST to `:4318/v1/logs`; direct VL is allowed only as env override.
- **C-4 VL stream fields pinned** — `service.name`, `deployment.environment` only; `trace_id` / `span_id` are attributes, not stream fields (cardinality control).
- **C-5 PII scrubbing on OTel LogRecord attributes** — never log raw tokens, passwords, or user PII in span/log attributes; reuse `PIIRedactionProcessor` pattern from `tracing.js:52-96,160`.
- **C-6 Retention aligned at 30 days** — VL `VICTORIALOGS_RETENTION=30d` matches existing Winston DailyRotateFile 30 d.
- **C-7 Git workflow** — never commit to `main` or `release/*` directly; one worktree + dedicated branch (`feat/admin-logs-victorialogs`) + one MR per phase; wait for CI pipeline green before merge.

## Non-goals

- **NG-1 okf-server migration** — does not exist in the repo (the 2026-08-15 study is wrong on this third Node service). Only `gov-chat-backend` + `document-repository` are Node services.
- **NG-2 Frontend contract changes** — `AdminDashboard.vue` / `LogSearchDialog.vue` shapes preserved by contract tests; Vue 3 Options API stays. UI gains a `degraded: true` banner via the existing mechanism.
- **NG-3 Grafana dashboard rewrites** — derived fields `TraceID` / `SpanID` at `configs/grafana/provisioning/datasources/vm-datasource.yml:13-21` already work with OTel logs; new structured `level` / `service.name` extract natively.
- **NG-4 Full `tests/melt-correlation/` implementation + CI stub** — P0 MR ships an `exit-0` stub at `tests/melt-correlation/{run-melt-test.sh,README.md}` to unblock `.gitlab-ci.yml:2942-2984`. The `scheduled:melt-correlation` job is `allow_failure: true` (verified before merge). The chaos/correlation suite itself is a separate epic.
- **NG-5 document-repository admin endpoints** — none exist; only the producer path lands on document-repository.

## Decisions

- **D1 (a)** Remove `profiles: [observability]` from VL + OTel Collector + otel-collector-init; pin `victorialogs.deploy.replicas: 1`. VL always-on; admin endpoints always functional regardless of `ENABLE_OBSERVABILITY`. Captured as constraint C-7 in production deploys.
- **D2** `ADMIN_LOGS_SOURCE=file|victorialogs` is a **permanent** escape hatch, never removed. Default is `victorialogs` after first release.
- **D3** VL service filter scope = all services (`service:*`). Admin UI default filter = "All". Full-stack view.
- **D4** Producer-first sequencing. Winston emits to VL before any consumer rewires land.
- **D6** Apps POST OTLP logs via OTel Collector at `:4318/v1/logs`. Direct VL is allowed only as env override.

## Success signal

See [`verification.md` §Final success signal](verification.md#final-success-signal).

## Success signal

See [`verification.md` §Final success signal](verification.md#final-success-signal).

## Assumptions

- **A-1** VL is reachable in-network from backend + document-repository via DNS `victorialogs:9428` (confirmed by `docker-compose.yaml:1749,1758`).
- **A-2** No other consumer of `admin-dashboard-service.js` public methods beyond `admin-routes.js`.

## Open Questions

*All open questions resolved. Q-1 → option C; Q-2 → 1/min; Q-3 → out-of-scope (single-tenant, env kept as port seam per AD-15). See memlog entries 34–35 for traceability.*