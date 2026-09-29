# Retrospective — prd-fix-shared-lib branch (2026-09-18)

Branch: `feat/admin-logs-victorialogs/prd-fix-shared-lib`
MR: [!383](https://opensource.unicc.org/un/itu/genie-ai/-/merge_requests/383) (25 commits at fork → 27+ at merge-ready)

Post-epic-7 retroactive cleanup + cross-cutting fixes uncovered during MR review.

## Scope delivered

### 1. uvicorn.access trace_id propagation (ASGI middleware bypass)
uvicorn's plain-text access log emit can't carry trace_id. State-of-the-art fix
per deep-research `wf_06e39e3a-da4`: silence uvicorn.access + install
JsonLogFormatter on the same logger name + ASGI middleware emits structured
JSON envelope stamped with trace_id/span_id via TraceContextFilter.

- `genie-ai-overlay/tracing.py` — `silence_uvicorn_access_log()`,
  `AccessLogASGIMiddleware` (raw ASGI, not `BaseHTTPMiddleware` to avoid
  streaming buffering), `install_uvicorn_access_log_middleware()`,
  `install_uvicorn_access_logging()` one-line entry point.
- Wired in 7 OPEA services: chatqna, dataprep-arango, dataprep-micro,
  reranking-micro, tei-reranker, retriever-arango, retriever-micro.
- MagicMock-safe (`try/except AttributeError` on MicroService.__init__ assignment —
  broke test collection across 8 files before fix in commit f03db64c8).

### 2. OTel identity hard-coded
User feedback: "non.. on ne devrait peut etre même pas pouvoir le customiser ca si ?"

- `OTEL_SERVICE_NAMESPACE` → hard-coded `genie-core` (backend, doc-repo) /
  `genieai` (OPEA).
- `OTEL_SERVICE_NAME` → hard-coded per-service.
- `SERVICE_VERSION` env read dropped from tracing.js.
- docker-compose.yaml: 18 lines removed.
- `env`: commented examples removed.

### 3. Dead env var cleanup (PRD D2)
5 PRD rollback switches — none were functional runtime switches. All removed.

- `env` Section 12D purged (5a3925be4).
- `deploy/ansible/templates/env.j2` Section 12D purged (5a3925be4).
- `tests/config-validator/validators/validate-features.js` — dropped
  `MELT_PROVIDER` future-provider seam (601d774b3).
- Test cases for `MELT_PROVIDER` removed (1fad0a9c0).
- `logs-no-vl-transport.test.js` `LOG_TO_VICTORIALOGS` regression-guard
  test removed (30c12202f) — env var is 100% dead, no code reads it.

VL is **always-on** (not gated by `ENABLE_OBSERVABILITY`):
- `victorialogs` has `replicas: 1` hardcoded (admin endpoints depend on it).
- `otel-collector` runs `mode: global` on every Swarm node unconditionally.
- Container stdout/stderr shipped to VL via fluentd driver regardless of
  `ENABLE_OBSERVABILITY`.
- `ENABLE_OBSERVABILITY=1` gates only in-app OTel SDK init + profile-gated
  services (Grafana, VictoriaMetrics, VictoriaTraces, tempo-proxy).

### 4. Documentation
14 doc commits across user-facing, operational, and project-level docs.

**User-facing (`site/content/en/docs/observability/`):**
- `overview.md` — data flow at user level.
- `tracing.md` — Trace ↔ Log correlation section.
- `dashboards.md` — 9 dashboards confirmed + pivot section.
- `alerting.md` — 2 missing collector alert rules added.
- `configuration.md` — `LOG_LEVEL` documented; stale `OTEL_*` env refs dropped.
- `_index.md` — cross-signal pivots + 9-dashboard count.

**Operational/technical:**
- `configs/otel/README.md` — accurate 6-transform pipeline description.
- `deploy/ansible/README.md` — operator-facing env vars + OTel hard-coding note.
- `tests/config-validator/` — `MELT_PROVIDER` test cleanup.

**Project-level:**
- `CHANGELOG.md` — 4 stale refs fixed.
- `genie-ai-overlay/CLAUDE.md` — "Public tracing API" section added,
  wrong `@tracing.trace_span(name)` reference corrected.
- `.claude/rules/OBSERVABILITY.md` — 9 dashboards, OTel identity, VL
  always-on documented.
- `.claude/rules/DEBUGGING-TRACING.md` — Compose vs Swarm translation
  table + swarm DNS stack-prefix clarified (verified live on El Salvador
  stack: `genieai-el-salvador_victoriatraces`).

## Lessons learned

1. **uvicorn.access + dictConfig wipe**: don't fight `dictConfig` — silence
   uvicorn.access early + install JsonLogFormatter on the same logger name.
   Trying to out-level-reset uvicorn's `setLevel(log_level)` after `dictConfig`
   is racy (proven in dab4f894c → b42b67438). The `_OnlyStructuredAccessFilter`
   at handler level (blocks records without `method` attr) survives any
   level reset.

2. **OTLPLogExporter claim was wrong**: MR description originally said
   "OPEA overlay wires OTLPLogExporter + LoggingHandler" — verified false
   in tracing.py (only OTLPSpanExporter + MeterProvider). Single-channel
   stdout → fluentd → collector → VL is the actual path. Caught on a doc
   audit. **Always verify claims against the actual code.**

3. **VL is always-on by design, not by accident**: `replicas: 1` hardcoded
   on `victorialogs` is a deliberate decision (admin endpoints depend on it).
   Don't try to "fix" this with `ENABLE_OBSERVABILITY` gating.

4. **Hard-coded OTel identity > env vars**: operators drift the env,
   per-service `service.name` becomes meaningless across the fleet. Hard-
   coding per binary is the right call.

5. **Dead code is never harmless**: 5 rollback switches + 1 future-provider
   seam sat in code for months as dead env reads. Each `if os.getenv(...)`
   was one `unset` away from a real bug. The
   `feedback_no_dead_code` rule applies to env reads too, not just code.

6. **Doc audit found more bugs than code review**: 3 parallel audit agents
   surfaced 14 doc commits worth of fixes. Code review would have shipped
   wrong OTLPLogExporter claims, wrong VL-gating claims, and the
   `@tracing.trace_span(name)` non-existent decorator reference.

## Stats

- 27 commits at MR merge-ready
- 192 files changed
- +12017 / -7815 lines
- 5 lint fix-round churn (uvicorn.access wiring)
- 0 production incidents
- 0 test regressions in final green

## Follow-ups (NOT in this MR)

- Custom Dockerfiles for upstream-only OPEA services (embedding, textgen,
  translation).
- OTel Collector json parser for fluentd `_msg` field (5x VL storage cost).
- OTel pipeline alerting (Collector down, exporter failing) — alert rules
  documented, rules themselves still need wiring.
- Sampling tuning (currently 100%, production usually 10-20%).
- Update `genie-ai-overlay/CLAUDE.md` line 68 — `install_uvicorn_access_log_middleware`
  signature may have shifted (verify after merge).
