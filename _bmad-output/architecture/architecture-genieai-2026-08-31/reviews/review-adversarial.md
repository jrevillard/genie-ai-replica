# Adversarial Review — GENIE.AI Admin Logs → VictoriaLogs Architecture Spine

**Reviewer:** adversarial (pair-construction lens)
**Spine:** `ARCHITECTURE-SPINE.md` (2026-08-31)
**Companions consulted:** `.memlog.md`, `phases.md`
**Method:** For each AD, construct two implementations that each obey **every** AD to the letter yet build incompatibly. A finding is genuine iff a unit obeying every AD could be paired with a second unit also obeying every AD and the pair would fail to interoperate at runtime, in CI, or under rollback.

---

## TL;DR — Verdict

**`fail`** (pass-with-fixes achievable in one revision round).

13 of 19 ADs contain one or more unresolved collision points. The highest-impact gaps are: (a) **no ownership rule for the shared `booleanEnv` helper, the shared rate-limit file lock, the `BatchLogRecordProcessor` tuning, and the PII regex set**; (b) **silent ambiguity in `_normalizeRows` field sub-shapes** that lets `LogsService` and `securityScanService` both pass AD-3 yet iterate `fields`/`stream`/`level` differently; (c) **AD-5's lint rule has a phantom anchor** that does not exist in `docker-compose.yaml` as drafted in `phases.md P1c`.

---

## Per-AD findings

### AD-1 — Logging transport paradigm

**Collision pair A vs. B:**

- *Implementer A* (P1a) puts the `VictoriaLogsTransport` registration in `shared/lib/logger.js` constructor; lazy-init ring buffer lives on a module-level variable. `reconfigureLogger` (existing `:77-122`) re-calls `logger.clear()` + `logger.add(VLTransport)` when `LOG_TO_VICTORIALOGS` flips.
- *Implementer B* puts the same registration behind a getter, lazy-instantiates on first call, ring buffer is a closure-private. `reconfigureLogger` is unchanged.

Both comply with AD-1. **Collision:** when P1a's MR merges and P4 later removes file transports, the `LOG_TO_FILE` env flip path goes through `reconfigureLogger`. A's design holds the ring buffer at module scope; B's holds it inside a closure that is destroyed on `logger.clear()`. B silently loses pre-init records emitted during a reconfigure; A does not. CI cannot detect this — there is no test in `phases.md` that exercises a reconfigure-then-emit sequence with the buffered ring buffer surviving.

**Missing rule:** "ring buffer MUST be re-attached to the new transport after `logger.clear()`; provide a single helper `withLazyBuffer(transport)` consumed by every reconfigure path." Without it, the parity test between VL path and file path (AD-17) is only valid pre-P4.

---

### AD-2 — VL stream field pinning

**Collision pair A vs. B:**

- *Implementer A* (backend `tracing.js`) sets `service.name = 'genie-backend'`, `deployment.environment = process.env.DEPLOYMENT_ENV || 'dev'`.
- *Implementer B* (doc-repo `tracing.js`) sets `service.name = 'genie-document-repository'`, `deployment.environment = process.env.DEPLOYMENT_ENV || 'production'`.

Both pass AD-2 (stream fields are bounded). **Collision:** AD-5's filter `service:genie-backend AND NOT _stream:genie.backend` references `genie-backend` as a literal. P1c's smoke test (`phases.md P1c` `docker inspect backend --format '{{.HostConfig.LogConfig.Type}}'`) never asserts the actual `_stream` value. If implementer B's doc-repo `_stream` happens to be `genie.document-repository`, the dual-emit filter cannot exclude doc-repo duplicates from admin view because the negation `NOT _stream:genie.backend` does not match doc-repo streams at all. This is not a bug per AD-5 (the filter only protects backend dedup) but the architectural diagram in `phases.md P1c` implies all Node services share the dual-emit window. If both backend and doc-repo are between P1a and P1c, the filter underspecifies doc-repo dedup.

**Missing rule:** "every js-runtime service in the dual-emit window MUST publish a stream field that begins with `genie.<service>` (kebab-case), AND the dual-emit filter MUST be expressed as `service:<name> AND NOT _stream:genie.<name>` per service — never as a single literal." Also: `deployment.environment` cardinality is unconstrained; if two deploys disagree (dev vs production), VL bucket explosion is silent. AD-2 should forbid `process.env.DEPLOYMENT_ENV || 'production'` fallback patterns.

---

### AD-3 — `_normalizeRows` shape

**Collision pair A vs. B:**

The output keys are pinned (`{timestamp, message, stream, fields, date, time, level, service}`) but the **sub-shapes** are not:

- `stream`: VL's `_stream` is the structured object `{service, env}`. *Implementer A* normalizes `stream` to the string `'genie-backend'`. *Implementer B* normalizes `stream` to `{service: 'genie-backend', env: 'production'}`. Both pass AD-3.
- `level`: *A* uppercases to match VL (`'ERROR'`). *B* leaves Winston's lowercase (`'error'`). Both pass AD-3.
- `date`/`time`: *A* splits `_time` as ISO date + ISO time. *B* uses `new Date(_time).toISOString().slice(0,10)` and `…slice(11,19)`. Both pass AD-3.

**Collision:** LogsService (`phases.md P2`) and securityScanService (`phases.md P3`) both depend on `_normalizeRows` output. If LogsService iterates `stream` as a string (matches A) and securityScanService uses `record.stream.service` per AD-19 (`'record.stream.service'`), they collide the moment the consumers merge in different MRs — P2 and P3 are independent phases. AD-19 assumes `record.stream.service` exists (object shape), but AD-3 permits a string. **P3's MR will pass tests against implementer A's shape; P2's MR will pass tests against implementer A's shape. If P3 lands first, P2's contract test breaks on the next run.**

**Missing rule:** "the sub-shapes of `_normalizeRows` output are pinned: `stream: {service: string, env: string}`, `level: SeverityNumber.uppercase()` (one of `TRACE|DEBUG|INFO|WARN|ERROR|FATAL`), `date: 'YYYY-MM-DD'`, `time: 'HH:mm:ss.SSS'` (UTC)." Without this, AD-19's bucket key expression `'record.stream.service'` is a free-text assumption that the AD-3 contract does not guarantee.

---

### AD-4 — PII scrubbing scope

**Collision pair A vs. B:**

- *Implementer A* implements `PIIRedactingLogRecordProcessor` with regexes: `email = /[\w.+-]+@[\w-]+\.[\w.-]+/`, `jwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/`, `password = /(password|passwd|pwd)["':= ]+\S+/i`.
- *Implementer B* implements the same processor with a slightly different `jwt` regex (e.g. base64url-strict `[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}`).

Both pass AD-4. **Collision:** A's regex matches the literal `eyJ…` prefix; B's matches any sufficiently-long base64url triple. A test record `eyJzdWIiOiIxMjM0In0.abc.def` is redacted by both; a test record `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` (random JWT without `eyJ` prefix) is redacted only by B. The `p-l-lig-pii-scrubbing.test.js` (`phases.md P1a`) cannot assert parity between VL and file paths because the regex set is not specified in the spine.

**Missing rule:** "the PII regex set is a single named export `pIIPatterns` in `shared/lib/pII.js`, consumed by both `PIIRedactionProcessor` (span attrs) AND `PIIRedactingLogRecordProcessor` (log body). One source of truth; one test fixture; no per-implementer drift." Without this, AD-4 is enforced only by tests against a single implementation, and silent drift between implementations is undetectable.

---

### AD-5 — Dual-emit window handling

**Collision pair A vs. B:**

- *Implementer A* (P2) writes the filter `service:genie-backend AND NOT _stream:genie.backend` literally as documented.
- *Implementer B* (P2) writes the same filter but uses LogSQL field `_stream:genie.backend` while OTel resource attributes are searched with `service.name:genie-backend` (different field name).

Both pass AD-5. **Collision:** VL's LogSQL field `service` is mapped to OTel resource attribute `service.name` per the OTel-to-VL schema convention; `_stream` is the VL-internal field for the structured stream object. If implementer B searches `service.name:genie-backend AND NOT _stream:genie.backend` and `service.name` is the OTel field, the first clause matches correctly; if implementer B assumes `service` is a top-level VL field (it is, mapped to `service.name`), it works. **But:** if implementer B parses `service` as a quoted string `service:"genie-backend"`, VL may interpret the quotes as literal containment and miss logs whose service name is exactly `genie-backend`. The dual-emit filter is brittle and the spine does not pin the exact LogSQL surface syntax.

Additionally: **the lint rule "forbid `*fluent-logging` anchor for js-runtime services post-P1c" references a YAML anchor (`*fluent-logging`) that does not exist in `phases.md P1c` description.** P1c introduces `x-local-logging: &local-logging`; the old anchor `*fluent-logging` is referenced in the rollback line but its declaration is not part of the diff described. The lint rule "forbid `*fluent-logging`" is unenforceable because there is nothing to forbid.

**Missing rules:**
1. The exact LogSQL surface syntax for the dual-emit filter must be quoted as a string literal in the AD (e.g. `` `service:genie-backend AND NOT _stream:genie.backend` `` is correct only if both fields exist; we need a contract test that asserts the VL tenant has these field names).
2. The lint rule must name the YAML anchor to forbid; the spine and phases.md are inconsistent.

---

### AD-6 — Per-call env read

**Collision pair A vs. B:**

- *Implementer A* (P2 `logs-service.js`) reads `process.env.ADMIN_LOGS_SOURCE` per call and constructs the client branch fresh each time. When `'file'` is requested and `LOG_TO_FILE !== '1'`, returns 503 + hint.
- *Implementer B* (P2) caches the resolved branch on first call but invalidates the cache when `ADMIN_LOGS_SOURCE` changes; same 503 behavior.

Both pass AD-6. **Collision:** under rollback (`ADMIN_LOGS_SOURCE=file`), A re-reads the file system on every request (5x slower under load if readDir is heavy); B caches and serves stale descriptors. Neither is wrong, but a contract test that asserts response latency might pass for one and fail for the other. The spine does not pin the cache policy.

Worse: AD-6 says "503 with recovery hint" but does not pin the HTTP status code. *Implementer A* returns 503; *Implementer B* returns 503 with `{retryAfter: 60}`. Both pass AD-6. The frontend `LogSearchDialog.vue` `computed.banner` (`phases.md P2`) renders an alert — it does not handle 503 specifically; only `degraded: true`. If A's 503 reaches the frontend, the alert is silent.

**Missing rules:**
1. The 503 body MUST be `{error: 'logs_source_unavailable', hint: 'set LOG_TO_FILE=1', degraded: true}` so the frontend banner fires on 503.
2. The file-read cache policy (per-call or memoized-with-invalidation) MUST be specified.

---

### AD-7 — Configuration split

**Collision pair A vs. B:**

- *Implementer A* (P0 compose): `LOG_TO_VICTORIALOGS=1` AND-gated with `ENABLE_OBSERVABILITY=1` via shell logic in `entrypoint.sh`. Exposes `log_record_dropped_total{reason="observability_disabled"}`.
- *Implementer B* (P0 compose): same AND-gate, but the metric is exposed via OTel Collector self-telemetry (not via the backend `metrics.js` endpoint).

Both pass AD-7. **Collision:** A's metric is a Prometheus counter scraped by VictoriaMetrics (observability profile); B's metric is internal to the Collector and never scraped. Cloud operators see `observability_disabled` counts in A; they see nothing in B. The metric's exposure is not pinned by AD-7.

Also: AD-7 says VL + Collector move to `profiles: [core]` "always-on". If `ENABLE_OBSERVABILITY=0`, VL is still running, but `LOG_TO_VICTORIALOGS=1` emits no logs (AND-gate). Admin endpoints reading VL (`phases.md P2`) hit a healthy VL with zero logs → admin UI is empty. Cloud operators see an empty admin UI with no indication that the policy disabled emission. AD-7 forbids this only via the metric, but the metric is a Prometheus counter — Grafana dashboards must be wired to surface it.

**Missing rules:**
1. The metric `log_record_dropped_total` MUST be exposed via the backend's `/metrics` endpoint (Prometheus), not via OTel Collector self-telemetry.
2. When `ENABLE_OBSERVABILITY=0`, admin log endpoints MUST return `{degraded: true, reason: 'observability_disabled', hint: 'set ENABLE_OBSERVABILITY=1'}` so the frontend banner fires (mirroring AD-6's hint pattern).

---

### AD-8 — OTel global setter pattern

**Collision pair A vs. B:**

- *Implementer A* (backend `tracing.js`) calls `logs.setGlobalLoggerProvider(provider)` at module load, AFTER `provider.addLogRecordProcessor(new PIIRedactingLogRecordProcessor())`.
- *Implementer B* (doc-repo `tracing.js`) calls `logs.setGlobalLoggerProvider(provider)` AFTER `provider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter))` (no PII processor — different SDK init pattern).

Both pass AD-8. **Collision:** doc-repo logs are emitted without PII scrubbing on body. AD-4 says PII scrubbing applies to both span attributes AND log record body. AD-8 says each component owns its own provider. AD-4 implicitly requires PII scrubbing on every component's LoggerProvider — but AD-8 allows per-component processors, so doc-repo can opt out of `PIIRedactingLogRecordProcessor`. The pair A/B is fully AD-compliant, yet AD-4 is violated at the doc-repo boundary.

**Missing rule:** "`PIIRedactingLogRecordProcessor` is a mandatory processor in every component's LoggerProvider chain; AD-8's per-component init MUST include it as the first processor (before `BatchLogRecordProcessor`)."

---

### AD-9 — JSON log format

**Collision pair A vs. B:**

- *Implementer A* uses `winston.format.json()` with no `replacer` (default).
- *Implementer B* uses `winston.format.json({ replacer: (k, v) => k === 'stack' ? String(v).replace(/\n/g, ' \\n ') : v })`.

Both pass AD-9 (format is JSON, json() is the Winston formatter). **Collision:** AD-10 requires handling `error.stack` newlines. A relies on "winston.format.json({replacer}) or line-joining guard" — A picks the line-joining guard in the file-fallback parser; B picks the replacer. Both comply. But: NDJSON file produced by A has multi-line `stack` entries → file path returns `{timestamp, level, message: '<truncated>', trace_id, span_id, stack: 'Error: ... \n at ...'}` and the parser line-joins; file produced by B has inline-escaped `stack: 'Error: ... \\n at ...'`. The contract test (`phases.md P2` `logs-vl-contract.test.js`) compares responses from file path and VL path; if VL path receives the OTel-normalized record (no `stack` field) and file path receives either A or B shape, the contract test passes only if both implementations agree on the `stack` field's location and escaping.

**Missing rule:** "`stack` MUST be a top-level JSON field; newlines escaped as `\\n` (backslash-n literal in JSON, NOT the two characters). Replacer is mandatory."

---

### AD-10 — File rotation + concurrent-writer invariants

**Collision pair A vs. B:**

- *Implementer A* uses `O_EXCL` PID lock (`/tmp/admin-logs-<service>.lock`).
- *Implementer B* uses `fadvise(FADV_SEQUENTIAL)` with a tail-style reader.

Both pass AD-10. **Collision:** when backend + doc-repo write to the same `ADMIN_LOGS_SOURCE=file` path (e.g. shared NFS volume), A's `O_EXCL` lock serializes writers (one waits); B's fadvise does not lock. Under concurrent writer conditions, A reads sequentially with no contention but writes serialize (slow); B reads fast but may interleave partial lines (which the NDJSON parser must recover from). Both are AD-compliant. **The contract test (`logs-vl-contract.test.js`) only runs a single writer; it cannot detect the divergence.** In production with two Node services writing the same path (P4's escape hatch with `LOG_TO_FILE=1` for first 30 days), the pair could silently interleave.

Additionally: "read next N bytes and re-parse" — N is unspecified. A picks 256 bytes; B picks 4096. Both pass AD-10. `kill -9` mid-write of a 4 KB stack trace produces a truncated line of unknown length; A's heuristic succeeds on small errors; B's succeeds on large errors. **The contract test must pin N.**

**Missing rule:** "the NDJSON parser MUST read 4096 bytes on `SyntaxError` and re-parse from the last `{` byte; one constant value, not implementation-defined."

---

### AD-11 — Rate-limit state persistence

**Collision pair A vs. B:**

- *Implementer A* (LogsService) writes the timestamp to `/tmp/vl-fail-open-ts` as a plain Unix seconds integer.
- *Implementer B* (securityScanService) writes the same file as ISO 8601 milliseconds.

Both pass AD-11 (file path is specified, contents are not). **Collision:** when A writes `1756675200` and B reads it expecting ISO, `Date.parse('1756675200')` returns `NaN`; the rate-limit guard silently opens the flood gate. AD-11 says "both share the rate-limiter state file" — but does not pin the format. The race is also unaddressed: two concurrent writers to `/tmp/vl-fail-open-ts` without `O_EXCL` lock (AD-10's lock is for log files, not the rate-limit file) can produce a torn write (line longer than `PIPE_BUF` triggers POSIX atomicity loss).

**Missing rules:**
1. The rate-limit state file format is a single line: `<unix_ms>\n` (12-digit Unix milliseconds).
2. Writes MUST use `O_EXCL` lock at `/tmp/vl-fail-open-ts.lock` with the same pattern as AD-10's PID lock.
3. Reads MUST tolerate file absence (treat as "no recent emit").

---

### AD-12 — Cache schema validation

**Collision pair A vs. B:**

- *Implementer A* uses AJV with a JSON Schema declared in `shared/lib/schemas/last-scan-results.schema.json`.
- *Implementer B* uses `JSON.parse` + duck-typing on `vulnerabilities.critical` array existence.

Both pass AD-12 (validation occurs; mismatch = cache miss + regenerate). **Collision:** AJV catches `vulnerabilities.critical` being a string (vs array); B's duck-typing accepts a string and iterates `.length` (undefined). When the legacy `worker_threads` cache file on disk contains `{vulnerabilities: {critical: 'unknown'}}`, AJV rejects (cache miss, regenerate correctly); B accepts (serves legacy data, fails the AD-12 invariant). **AD-12 says "schema-validated on read" but does not specify the validator.** The pair can both comply yet behave differently against legacy on-disk data.

**Missing rule:** "schema validation MUST use AJV with the schema file at `shared/lib/schemas/last-scan-results.schema.json`; the schema is the canonical cache contract. AJV instance exported as `validateLastScanResults` from `shared/lib/schemas/`."

---

### AD-13 — CI merge-order gate

**Collision pair A vs. B:**

- *Implementer A* wires the gate via `rules:` on each MR's `.gitlab-ci.yml` pipeline definition; the `rules:` rule references the previous MR's branch name as `refs/heads/feat/admin-logs-victorialogs`.
- *Implementer B* wires the gate via a `needs:` job referencing `pipeline: $CI_PIPELINE_ID` of the previous MR's pipeline.

Both pass AD-13. **Collision:** A's `rules:` blocks the MR if the previous branch's pipeline status cannot be fetched (e.g. branch deleted); B's `needs:` requires the previous MR's pipeline to be replayable. Neither is wrong. **But the spine does not pin which mechanism; and GitLab CI does not natively support "block MR merge until pipeline green on a different branch."** The merge-order gate is enforceable as a CI job dependency (B's pattern) or as a manual gate (A's pattern) — the spine is ambiguous.

Worse: phases.md has 7 MRs (P0 + P1a + P1b + P1c + P2 + P3 + P4). MR-N+1 depends on MR-N. But P1a and P1b could in principle be developed in parallel worktrees (no shared files); if MR-2 (P1a) and MR-3 (P1b) merge in either order, the gate forces serialization. **The spine says "one MR per phase boundary" but does not say "phases are merge-ordered"; if MR-3 lands first, MR-2 must wait — but the dependency is on the *branch*, not the phase. The spine conflates phase-order with branch-order.**

**Missing rule:** "merge-order gate is implemented via a `needs:` job in the P2 MR's pipeline referencing `pipeline: $CI_PIPELINE_ID` of the P1c MR's last green pipeline. Worktrees MUST be rebased onto the prior phase's branch before merge; the gate fires when the prior branch is reachable from `origin`."

---

### AD-14 — Boolean env-var coercion

**Collision pair A vs. B:**

- *Implementer A* puts `booleanEnv(name)` in `shared/lib/env.js`, exports it.
- *Implementer B* puts `booleanEnv(name)` in `gov-chat-backend/utils/boolean-env.js` (consumer-local per project-context.md rule 1).

Both pass AD-14 (the helper exists; both files claim ownership). **Collision:** doc-repo (`components/document-repository`) imports the helper — from where? AD-14 does not pin the location. A's location forces `shared/lib` to depend on nothing (clean); B's location forces doc-repo to either depend on `gov-chat-backend` (forbidden by AD-18) or duplicate the helper. **The pair A/B is fully AD-compliant, but `booleanEnv` ownership is not pinned; one impl will violate AD-18 at the doc-repo boundary or duplicate code.**

**Missing rule:** "`booleanEnv(name)` is exported from `components/shared/lib/env.js`. Every Node service (`gov-chat-backend`, `document-repository`, future) imports from there. One canonical implementation, one test, one source of truth."

---

### AD-15 — VL tenant identity headers

**Collision pair A vs. B:**

- *Implementer A* reads `VICTORIALOGS_TENANT_ID` once in `VictoriaLogsClient` constructor and caches the parsed `{AccountID, ProjectID}` pair.
- *Implementer B* reads `VICTORIALOGS_TENANT_ID` per request inside `_request` interceptor.

Both pass AD-15. **Collision:** if `VICTORIALOGS_TENANT_ID` is mutated at runtime (operator edits env, restarts process — but the cached object in A survives if the client is a singleton within a process, mutated via `dotenv` re-load or similar dynamic pattern), A serves the stale pair; B serves the new one. The spine does not address tenant mutation policy.

Worse: AD-15 says "Multi-tenant deployment out of scope for this rollout." But A's constructor reads once; B's interceptor reads per call. If the runtime is updated to multi-tenant in a future rollout, **A requires a refactor of the constructor; B does not.** The pair is AD-compliant yet has asymmetric evolution cost.

**Missing rule:** "`VICTORIALOGS_TENANT_ID` is read per request (consistent with AD-6's per-call env read pattern). The constructor does NOT cache the parsed value."

---

### AD-16 — axios timeout + health-probe

**Collision pair A vs. B:**

- *Implementer A* runs the `GET /health` probe in the `VictoriaLogsClient` constructor (synchronously during module load).
- *Implementer B* runs the probe lazily on the first `query()` call.

Both pass AD-16. **Collision:** in the dual-emit window (P1a → P1c), A blocks module load by 15 seconds (3 retries × 5s) if VL is unreachable. The backend's `createApp()` test pattern (per project `CLAUDE.md`) instantiates the app in tests; A's constructor blocks Jest with a 15-second timeout. B's lazy probe allows tests to run with the probe mocked. **The contract test (`logs-vl-contract.test.js`) may pass for B and fail for A's constructor-blocking behavior.**

Worse: AD-16 says "early calls throw a typed error caught by `VL_FAIL_OPEN`". A's constructor throws if all 3 retries fail (module load fails); B's first call throws (request handler fails). The downstream `VL_FAIL_OPEN` (AD-11 rate limit) is designed for the request path, not the module-load path. **A's failure mode may not be caught by `VL_FAIL_OPEN` at all — it crashes the process.**

**Missing rules:**
1. The health probe MUST be lazy (on first request), NOT in the constructor. Construction is non-blocking.
2. The constructor MUST accept a `skipHealthProbe` option for tests.

---

### AD-17 — Contract-test fixture convention

**Collision pair A vs. B:**

- *Implementer A* writes the fixture with `{timestamp, level, message, service, trace_id, span_id}` exactly as the spine specifies. ~500 records.
- *Implementer B* writes the fixture with `{timestamp, level, message, service, ...rest}` where `rest` includes additional fields like `userId`, `requestId`. The 6 required fields are present; the extras are not.

Both pass AD-17 (fixture has all 6 fields; extras are not forbidden). **Collision:** LogsService's contract test (`logs-vl-contract.test.js`) does `expect(response.rows[0]).toEqual(expectedRow)` deep-equal. If VL ingest normalizes `_msg`, `_stream`, `_time` to `message`, `stream`, `timestamp` AND adds fields like `deployment.environment` to the response shape, the fixture's response (parsed from file) will not match the VL response (extra fields). The contract test may pass with `{...expectedRow, deployment: ...}` for VL and `{...expectedRow}` for file → deep-equal fails.

AD-17 says "Same input on both file path and VL path" — but the responses are post-normalization, and `_normalizeRows` (AD-3) may add fields the file path doesn't surface.

**Missing rules:**
1. The fixture schema is the **input** shape; the **output** shape is the AD-3 contract, which MUST NOT be deep-equal-tested against the fixture. The contract test asserts shape parity via `expect(Object.keys(response.rows[0])).toEqual(['timestamp', 'message', 'stream', 'fields', 'date', 'time', 'level', 'service'])` (key set, not values).
2. The fixture MUST omit `trace_id` in 50% of records (to exercise AD-2's empty-drop rule).

---

### AD-18 — Tracing SDK location

**Collision pair A vs. B:**

- *Implementer A* (backend `tracing.js`) sets `BatchLogRecordProcessor({maxExportBatchSize: 512, scheduledDelayMillis: 5000, maxQueueSize: 2048})`.
- *Implementer B* (doc-repo `tracing.js`) sets `BatchLogRecordProcessor({maxExportBatchSize: 100, scheduledDelayMillis: 10000, maxQueueSize: 500})`.

Both pass AD-18 (each component owns its own). **Collision:** VL sees backend logs every 5s (low latency, high burst), doc-repo logs every 10s (higher latency, lower burst). Admin UI's `getLogsInRange` ordering (`phases.md P2`) sorts by `_time` descending; backend logs dominate the first page during quiet doc-repo periods, doc-repo logs lag. **Admin operators see an inconsistent timeline.**

Also: AD-18 forbids cross-component `require`. But `shared/lib/victorialogs-transport.js` (a new file per `phases.md P1a`) is consumed by both backend and doc-repo via `require`. The transport file uses OTel globals (AD-8 compliant). However, the transport's *configuration* (e.g. severity mapping, batch size) is not duplicated — it lives in the transport. Both A and B's `tracing.js` set their own `BatchLogRecordProcessor` configs because the processor sits between the OTel SDK and the exporter, while the transport is a Winston-side shim. **The transport's batch behavior is opaque to AD-18 because AD-18 talks about `LoggerProvider`, not `Transport`.**

**Missing rule:** "`BatchLogRecordProcessor` tuning is a single shared constant in `shared/lib/otel-config.js`, imported by every component's `tracing.js`. One set of knobs across the codebase."

---

### AD-19 — Security-scan dedupe + truncation + retention

**Collision pair A vs. B:**

- *Implementer A* computes the bucket key as ``${record.time}|${record.stream.service}|${record.msg}`` directly (using `|` as separator).
- *Implementer B* computes the bucket key as ``${record.time}|${record.stream.service}|${record.msg}`` BUT URL-encodes the message first (because `record.msg` may contain `|`).

Both pass AD-19 (the expression is followed). **Collision:** A's bucket key for the message `401 | forbidden` produces `1756675200|genie-backend|401 | forbidden` (with the literal pipe inside the message); B's bucket key produces `1756675200|genie-backend|401 %7C forbidden` (URL-encoded). Two implementations collide in dedupe correctness — A treats `401 | forbidden` and `401 forbidden` as different records (split on pipe); B treats them as different records only if the raw messages differ after decoding. **The pair can pass tests with disjoint fixtures yet disagree on real log records containing pipes.**

Worse: AD-19 says `record.time` — but `_normalizeRows` (AD-3) returns `timestamp` as ISO 8601. Is `record.time` the raw VL `_time` (microsecond Unix) or the normalized `timestamp` (ISO 8601 string)? A uses ISO 8601; B uses microsecond Unix. Bucket keys differ.

**Missing rules:**
1. `record.time` in the bucket key is the AD-3 normalized `timestamp` field (ISO 8601 with millisecond precision), NOT the raw `_time`.
2. The bucket key separator `|` MUST be replaced with `\x1F` (ASCII Unit Separator) in both `record.msg` and as the separator, so messages containing `|` do not collide.

---

## Cross-cutting owner conflicts

### O1 — `victorialogs-transport.js` ownership

The spine (`ARCHITECTURE-SPINE.md` source tree, line 234) places `victorialogs-transport.js` in `components/shared/lib/`. AD-18 forbids `shared/lib/logger.js` from requiring `gov-chat-backend` paths — but the transport is consumed by both `gov-chat-backend` (via `logger.js`) and `document-repository` (via `document-repository/src/app.js`). The spine does not say whether the transport lives in shared lib or in a per-component location. **Two AD-compliant layouts:**

- *Layout A* (shared lib): both services `require('@shared/lib/victorialogs-transport')`. The transport lazy-instantiates its OTel dependency (`phases.md P1a` "lazy-requires OTel SDK so document-repository (no OTel today) does not break"). Doc-repo must transitively depend on OTel deps via shared lib — which contradicts `project-context.md rule 1` ("deps live with consumer").
- *Layout B* (per-component): each service has its own `victorialogs-transport.js`. Shared behavior must be in a smaller helper (e.g. `shared/lib/severity-map.js`) imported by both. The spine does not name this helper.

**Resolution needed:** explicit dep-location per `Q-1` (`memlog.md` "OTel deps location — `components/shared/lib/package.json` (shared) OR only `components/gov-chat-backend/package.json` + document-repository own"). Until Q-1 resolves, the transport's location is a coin-flip and the pair collide at require-time.

---

### O2 — `/tmp/vl-fail-open-ts` file location and lock

AD-11 names the file path; nothing else in the spine. The pair of implementations can:
- Use `/tmp/vl-fail-open-ts` (literal) — fine for Linux containers with writable `/tmp`.
- Use `/var/log/genie/vl-fail-open-ts` — fine if `/var/log` is writable.
- Use a Docker volume — depends on compose.

`phases.md` does not address this. **The pair collide on container platforms where `/tmp` is read-only (e.g. distroless, scratch images) or in k8s pods with `readOnlyRootFilesystem: true`.**

---

### O3 — `booleanEnv` helper location (covered in AD-14)

See AD-14 above. The pair collide on cross-component import path.

---

### O4 — `PIIRedactingLogRecordProcessor` location (covered in AD-4/AD-8)

See AD-4 and AD-8 above. The pair collide when doc-repo opts out of PII scrubbing on body.

---

### O5 — `BatchLogRecordProcessor` tuning (covered in AD-18)

See AD-18 above. The pair collide on backend vs doc-repo latency characteristics.

---

### O6 — `process.env.ADMIN_LOGS_SOURCE` and `SECURITY_SCAN_BACKEND` are *separate* flags with *different* defaults

AD-6 names both flags but does not say whether they are independent or coordinated. *Implementer A* assumes independent (admin can be `file` while scan is `victorialogs`). *Implementer B* assumes coordinated (a single source-of-truth flag, or both default to `victorialogs` simultaneously). Both pass AD-6. **But under rollback, A allows a partial rollback (admin falls back to file while scan continues on VL); B does not.** This is a feature-vs-consistency question; the spine does not decide.

---

## Summary table — collision density per AD

| AD | Collision count | Severity (1=advisory, 5=blocker) | Spec companion reference |
|---|---|---|---|
| AD-1 | 1 | 3 | `phases.md` P1a ring buffer |
| AD-2 | 2 | 4 | `phases.md` P1c stream field |
| AD-3 | 3 | 5 | `phases.md` P1b `_normalizeRows` |
| AD-4 | 2 | 4 | `phases.md` P1a PII test |
| AD-5 | 2 | 4 | `phases.md` P1c dual-emit |
| AD-6 | 2 | 3 | `phases.md` P2 escape hatch |
| AD-7 | 2 | 4 | `phases.md` P0 profile split |
| AD-8 | 1 | 3 | `phases.md` P1a setter pattern |
| AD-9 | 1 | 2 | `phases.md` P1a JSON format |
| AD-10 | 2 | 4 | `phases.md` P2 file fallback |
| AD-11 | 3 | 5 | `phases.md` P2 rate-limit |
| AD-12 | 1 | 3 | `phases.md` P3 cache schema |
| AD-13 | 2 | 3 | `phases.md` cadence section |
| AD-14 | 1 | 3 | `phases.md` P1a boolean helper |
| AD-15 | 1 | 2 | `phases.md` P1b tenant headers |
| AD-16 | 2 | 4 | `phases.md` P1b health probe |
| AD-17 | 2 | 3 | `phases.md` P2 fixture |
| AD-18 | 2 | 4 | `phases.md` P1a SDK location |
| AD-19 | 2 | 5 | `phases.md` P3 dedupe |

Total: 34 collision points across 19 ADs. 6 are severity 5 (blocker).

---

## Required spine amendments (one revision round to `pass-with-fixes`)

The following additions resolve all 34 collisions without changing the architecture:

1. **AD-3 amendment:** pin sub-shapes (`stream: {service, env}`, `level: SeverityNumber.uppercase()`, `date: 'YYYY-MM-DD' UTC`, `time: 'HH:mm:ss.SSS' UTC`).
2. **AD-4 + AD-8 amendment:** `PIIRedactingLogRecordProcessor` is a mandatory first processor in every component's `LoggerProvider` chain.
3. **AD-5 amendment:** quote the exact LogSQL filter as a single string literal; fix the lint rule to forbid `&x-fluent-logging` (or whatever the actual anchor name is).
4. **AD-6 amendment:** 503 body shape `{error, hint, degraded: true}`; cache policy pinned.
5. **AD-7 amendment:** admin endpoints return `{degraded: true, reason: 'observability_disabled', hint}` when observability is off; metric exposure pinned to backend `/metrics`.
6. **AD-9 amendment:** `stack` field top-level; `\\n` literal escape; replacer mandatory.
7. **AD-10 amendment:** NDJSON re-parse byte count fixed at 4096.
8. **AD-11 amendment:** rate-limit file format `<unix_ms>\n`; `O_EXCL` lock at `/tmp/vl-fail-open-ts.lock`.
9. **AD-12 amendment:** AJV with schema at `shared/lib/schemas/last-scan-results.schema.json`.
10. **AD-13 amendment:** `needs:` job pattern, not `rules:`; worktree rebase onto prior branch before merge.
11. **AD-14 amendment:** `booleanEnv` exported from `components/shared/lib/env.js`.
12. **AD-15 amendment:** `VICTORIALOGS_TENANT_ID` read per request, not cached in constructor.
13. **AD-16 amendment:** health probe lazy (on first request); constructor accepts `skipHealthProbe`.
14. **AD-17 amendment:** contract test asserts key-set parity, not deep-equal; 50% of fixture records omit `trace_id`.
15. **AD-18 amendment:** `BatchLogRecordProcessor` tuning shared from `shared/lib/otel-config.js`.
16. **AD-19 amendment:** bucket key uses `timestamp` (not `_time`); separator `\x1F`; `record.msg` is also `\x1F`-escaped.
17. **AD-2 amendment:** doc-repo stream field name `genie.document-repository` (kebab-case); dual-emit filter must be per-service.
18. **Cross-cutting:** Q-1 (deps location) must resolve before P1a MR; doc-repo dependency chain must be diagrammed.
19. **Cross-cutting:** `/tmp/vl-fail-open-ts` writable in all Node service containers (compose volume mount).

After these amendments, the spine's 19 ADs become implementable in exactly one way per pair, and the two-of-each problem dissolves.

---

## Sign-off

- **Blockers (severity 5):** AD-3 sub-shape, AD-11 file format + lock, AD-19 bucket key separator.
- **High-priority (severity 4):** AD-2 stream field naming, AD-4/AD-8 PII chain, AD-5 LogSQL filter + lint anchor, AD-7 observability_disabled metric + admin hint, AD-10 NDJSON byte count, AD-16 lazy probe, AD-18 shared tuning.
- **Medium-priority (severity 3):** AD-1 ring buffer reattach, AD-6 cache + 503 body, AD-12 AJV, AD-13 `needs:` pattern, AD-14 helper location, AD-17 contract test key-set.
- **Low-priority (severity 2):** AD-9 stack replacer, AD-15 per-call tenant read.

The spine is structurally sound (the paradigm is right, the phases are coherent, the rollback matrix is anchored). It underspecifies *inter-AD* contracts — what one AD leaves implicit, another AD allows divergence on. Closing those gaps is a documentation pass, not an architectural one.
