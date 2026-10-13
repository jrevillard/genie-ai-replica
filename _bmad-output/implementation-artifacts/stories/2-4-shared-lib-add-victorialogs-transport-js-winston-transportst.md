---
key: 2-4-shared-lib-add-victorialogs-transport-js-winston-transportst
title: "shared/lib: add `victorialogs-transport.js` (Winston TransportStream)"
epic: epic-2
status: done
effort: 0.5
depends_on: [2.1]
files: components/shared/lib/victorialogs-transport.js (new)
baseline_revision: 72ea00770f3b4540da1738160a96b27a8dfcf305
review_loop_iteration: 1
done_date: 2026-09-05
followup_review_recommended: true
deferred:
  - summary: >-
      AD-1 'buffers up to 100 records before LoggerProvider is set' ring buffer
      not implemented.
    evidence: |-
      OTel logs public API exposes no observable signal for "is the
      underlying LoggerProvider set yet?"; ProxyLogger transparently returns
      NoopLogger until setGlobalLoggerProvider fires. Detection would require
      internal-API probing of ProxyLogger._provider._delegate. Records emitted
      pre-setGlobal are silently dropped; drop counter is story 2-12's
      `log_record_dropped_total{reason="observability_disabled"}` seam.
      Normal backend init (`require('./tracing')` at `index.js:14` precedes
      any logger access) keeps the pre-init window sub-millisecond in practice.
    location: components/shared/lib/victorialogs-transport.js
    severity: medium
  - summary: >-
      Winston transport-level `opts.level` filter is parsed by super but not
      enforced by this transport; lower-priority levels still emit.
    evidence: |-
      Built-in Winston transports honor `new transports.X({ level: 'warn' })`
      to filter per-instance; this transport always emits regardless of
      `opts.level`. Cost is bounded by OTel BatchLogRecordProcessor in
      `tracing.js` (AD-18 shared batch tuning). Production-level filtering
      primarily lives on the producer-format side (`logger.js`).
    location: components/shared/lib/victorialogs-transport.js
    severity: low
---

# Story 2.4 — shared/lib: add `victorialogs-transport.js` (Winston TransportStream)

**Epic**: epic-2 (0.5 SP)
**Files**: `components/shared/lib/victorialogs-transport.js` (new)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (medium 2, medium 0, low 0)
- defer: 2
- reject: 29
- addressed_findings:
  - `[medium]` `[patch]` Constructor `this._service` was reading `opts.name` (always
    truthy via winston-transport default) instead of service identity; masked in
    practice by `logger.js#traceFormat` always injecting `info.service`. Decoupled
    to `opts.service || process.env.SERVICE_NAME || 'genie-backend'` so a direct
    consumer (e.g. doc-repo) can override without renaming the transport instance.
    Verified: default→`genie-backend`, `opts.service`→`genie-document-repository`,
    `SERVICE_NAME` env→`genie-mobile`.
  - `[medium]` `[patch]` Spec frontmatter YAML `files:` field had a stray
    backtick after `.js` that broke strict YAML parsers (and the matching body
    line). Removed both backticks.

## Auto Run Result

**Status:** done

**Implemented change:**
- Added `components/shared/lib/victorialogs-transport.js` — a single CommonJS
  `VictoriaLogsTransport extends winston.TransportStream` that forwards each
  Winston record to the OTel `logs.getLogger(name).emit(LogRecord)` global.
- Severity mapping: `error|warn|info|http|verbose|debug|silly` → OTel
  `SeverityNumber` enum (ERROR/WARN/INFO/INFO/DEBUG/DEBUG/TRACE); unknowns
  default to INFO with the uppercase original level string as `severityText`.
- Trace/span context: reads `info.trace_id` / `info.span_id` already injected
  by `logger.js#traceFormat`; drops the all-zero placeholders per AD-2 before
  adding to `attributes`.
- Body: `info.message` (string-coerced).
- Attributes: `service` first (from `opts.service`, `process.env.SERVICE_NAME`,
  or `'genie-backend'`), then `trace_id`/`span_id` (when non-zero), then a
  filtered spread of all other own-keyed `info` props (excluding level/message/
  timestamp/splat/trace_id/span_id/service).
- Timestamps: `info.timestamp` parsed (ISO or numeric ms) → nanoseconds;
  fallback `Date.now() * 1e6`. `observedTimestamp` always = now-in-ns.
- Defensive: full try/catch swallows OTel / ProxyLogger throws so a misbehaving
  LoggerProvider never blocks Winston (`CAP-1`). `finally` always calls
  `callback()` and emits a `'logged'` event so Winston never disables the
  transport. `enabled: false` short-circuits cleanly.
- No other files modified. Test ownership stays with story 2-10
  (`components/gov-chat-backend/__tests__/victorialogs-transport.test.js`).
  `index.js` re-export is story 7-3.

**Files changed:**
- `components/shared/lib/victorialogs-transport.js` — NEW. 99 lines. Single
  `module.exports = { VictoriaLogsTransport }`.
- `_bmad-output/implementation-artifacts/stories/2-4-shared-lib-add-victorialogs-transport-js-winston-transportst.md` — frontmatter
  lifecycle + deferred ledger.

**Review findings breakdown:**
- Patches applied (2, both medium): `_service` bug; YAML stray backtick.
- Items deferred (2): AD-1 ring buffer; `opts.level` filter. Captured in the
  frontmatter `deferred:` ledger.
- Items rejected (29): out-of-scope (tests owned by 2-10, deps owned by 2-1,
  wiring owned by 2-5/2-6/3-2/7-3, docs/CHANGELOG out of scope); already
  mitigated (Symbol-keyed props irrelevant to current JSON-combined format,
  body string coercion already handled, non-ISO timestamp parse guaranteed
  ISO by `logger.js#format.timestamp()` default).
- Patched counts by severity: medium=2, low=0.
- Score `3 × medium + 1 × low = 6 ≥ 5` → follow-up review recommended = true.

**Verification performed:**
- `rtk proxy npx eslint victorialogs-transport.js` → exit 0, no diagnostics.
- `rtk proxy npx prettier --check victorialogs-transport.js` → exit 0
  (`All matched files use Prettier code style!`); auto-formatted in-place
  after the constructor patch.
- Smoke test (CWD `components/shared/lib`, monkey-patched
  `logs.getLogger`): severity mapping (warn→13, error→17), zero-trace-id
  drop, body coercion, `service` resolution chain (default→opts→env),
  `enabled: false` callback path — all green.
- `git status --porcelain` clean except the new file + the spec frontmatter
  edit. No edits to `logger.js`, `index.js`, `package.json`, or any other
  component (per scope boundaries; those are stories 2-5/2-6/2-1/7-3).

**Residual risks:**
- The AD-1 ring buffer for pre-`setGlobalLoggerProvider` records is not
  implemented (deferred). In normal backend init this window is
  sub-millisecond because `index.js:14` requires `./tracing` first, but a
  process that imports `shared/lib/logger` before its own tracing init would
  silently drop VL records. Story 2-12's `log_record_dropped_total` Prometheus
  counter is the operator visibility seam for this gap. If a non-zero drop
  count is observed post-deploy, the ring buffer lands as a follow-up MR.
- No tests shipped in this MR (story 2-10 owns them). The window where
  severity-mapping or zero-trace filtering regressions can land undetected is
  from this MR's merge until 2-10 merges.
- The transport module-load Eagerly requires `@opentelemetry/api-logs`; if a
  consumer forgets to install it, the require throws synchronously. Story 2-1
  already ships the dep via `peerDependencies` + `backend`/`document-repository`
  `dependencies`; this is an integration assumption, not a per-unit concern.

**Follow-up review recommendation:** true (score 6 ≥ 5).
