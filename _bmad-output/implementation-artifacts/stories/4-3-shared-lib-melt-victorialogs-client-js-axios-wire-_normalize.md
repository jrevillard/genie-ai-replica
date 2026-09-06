---
key: 4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize
title: "shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AccountID/ProjectID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`"
epic: epic-4
status: done
effort: 0.5
depends_on: [4.1]
files: components/shared/lib/melt/victorialogs-client.js` (new); components/shared/lib/package.json (ADD `axios@^1.7.0` to dependencies — without this edit `require('axios')` fails in shared/lib; aligned with backend `^1.10.0` per architecture spine line 230)
baseline_revision: 4e1b0b8a30fb5aac7f6161af911f4b04e3f80bfd
review_loop_iteration: 0
followup_review_recommended: true
deferred:
  - summary: >-
      No co-located unit test for the adapter. Contract is exercised
      by the contract test gate (CAP-3 / CAP-4) in downstream stories
      (4.5, 5.x).
    evidence: |-
      No `__tests__/victorialogs-client.test.js` shipped in this
      diff. Story 4.5's spec covers axios mock + normalization +
      AccountID headers + retry behavior + reserved-char escape —
      adapter-level invariants get transitive coverage there.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      No `AbortSignal` / cancellation hook on `query()` / `hits()`.
      Long-running admin calls hold open sockets if the user closes
      the logs tab.
    evidence: |-
      Public methods accept no `signal` parameter; axios is invoked
      without `cancelToken`. Future Epic 5/6 may want cancellation
      when the admin UI abandons a request.
    severity: low
  - summary: >-
      No retry on transient `query()` / `hits()` 5xx or timeout.
      AD-16 retry policy applies only to the health probe.
    evidence: |-
      AD-16 pins retries only on the lazy health probe (`3×5 s`).
      Read-only LogSQL queries are idempotent and could safely
      retry; deferred to a future spike.
    severity: low
  - summary: >-
      Adapter-level constants (`HEALTH_PROBE_ATTEMPTS`,
      `HEALTH_PROBE_BACKOFF_MS`, `DEFAULT_TENANT_ID`,
      `DEFAULT_LEVEL`, `DEFAULT_SERVICE`) are module-scoped and not
      overridable per-construction. Test fixtures that need to tune
      them cannot inject.
    evidence: |-
      Story 4.5 spec is the venue for test fixture needs; if 4.5
      surfaces a need to override these constants, hoist them onto
      the constructor options then. Module-level constants stay
      simpler for the production path.
    severity: low
  - summary: >-
      `index.js` was edited (load-order change + destructure of
      `require('./victorialogs-client')`) beyond the spec's listed
      `files:`. Intent title listed only `victorialogs-client.js` +
      `package.json`; the seam edit is the minimum change required
      for `class VictoriaLogsAdapter extends LogQueryRepository` to
      resolve at module load.
    evidence: |-
      Reviewer (intent-alignment) flagged a Reading A / Reading C
      divergence: with the spec's two-file scope as-written, the
      adapter cannot load (circular require, `extends` evaluates to
      `undefined`). Reading C permits the minimal `index.js` edit;
      classifying as `bad_spec` would have triggered a revert +
      re-derivation loop that re-introduces the same edit. Kept as
      a deferred finding so the spec amendment can be made on a
      future epic-4 retrospective.
    location: >-
      components/shared/lib/melt/index.js:94-109
    severity: low
context:
  - components/shared/lib/melt/types.js
  - components/shared/lib/melt/index.js
  - components/shared/lib/boolean-env.js
  - components/shared/lib/eslint.config.js
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-3
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-15
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-16
  - _bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md
---

# Story 4.3 — shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AccountID/ProjectID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`

**Epic**: epic-4 (0.5 SP)
**Files**: `components/shared/lib/melt/victorialogs-client.js` (new); `components/shared/lib/package.json` (modify); `components/shared/lib/melt/index.js` (load-order, see Spec Change Log)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 4 review):**
- `files:` includes `components/shared/lib/package.json` for axios dep addition.
- HTTP headers `AccountID` + `ProjectID` (NOT `AcctID` / `ProjID`) per AD-15.
- `VL_QUERY_TIMEOUT_MS` env var read with default `30000`.

## Code Map

- `components/shared/lib/melt/victorialogs-client.js` — **NEW.** Concrete `VictoriaLogsAdapter` (axios HTTP wire + `_normalizeRows` + AccountID/ProjectID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`). CommonJS only.
- `components/shared/lib/melt/index.js` — **MODIFIED.** Two micro-edits: (1) early `module.exports.LogQueryRepository = LogQueryRepository` + relocate `require('./victorialogs-client')` to AFTER the port class definition so `class VictoriaLogsAdapter extends LogQueryRepository` resolves at adapter module-load; (2) destructure `{ VictoriaLogsAdapter }` from the new module exports (post-review patch 5 changed the export shape to `module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError }`). See Spec Change Log.
- `components/shared/lib/package.json` — **MODIFIED.** Add `"axios": "^1.7.0"` to `dependencies` (without this `require('axios')` fails in shared/lib; aligned with backend `^1.10.0` per spine line 230).
- `components/shared/lib/melt/types.js` — authoritative shape contracts for `VictoriaLogsRow` (8 AD-3 sub-shapes) and `LogQuery`.
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-3` — `_normalizeRows` shape contract.
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-15` — AccountID/ProjectID headers + tenant splitting.
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-16` — `VL_QUERY_TIMEOUT_MS` + lazy health probe semantics.

## Tasks & Acceptance

**Execution:**
- `components/shared/lib/melt/victorialogs-client.js` — CREATE — concrete `VictoriaLogsAdapter` class with: axios `create()` with `{baseURL, timeout, headers:{AccountID, ProjectID}}`; `query()` against `/select/logsql/query`; `hits()` against `/select/logsql/hits`; `_normalizeRows()` mapping VL wire `{_msg, _stream, _time, ...rest}` to `VictoriaLogsRow`; `_ensureHealth()` lazy probe (3×5 s, memoized in-flight Promise); `VictoriaLogsHealthError` typed error.
- `components/shared/lib/melt/index.js` — MODIFY — load-order change + destructure (cross-cutting fix; see Spec Change Log).
- `components/shared/lib/package.json` — MODIFY — add `axios ^1.7.0` dependency.

**Acceptance Criteria:**
- Given `components/shared/lib/melt/victorialogs-client.js` exists, when `require('./components/shared/lib/melt').VictoriaLogsAdapter` is invoked, then the class resolves and `new VictoriaLogsAdapter({baseURL, tenantId:'0:0', skipHealthProbe:true}) instanceof LogQueryRepository` is `true`.
- Given a constructed adapter with `tenantId:'42:7'`, when axios defaults are inspected, then `AccountID === '42'` and `ProjectID === '7'`.
- Given a constructed adapter with `VICTORIALOGS_TENANT_ID` unset, when axios defaults are inspected, then `AccountID === '0'` and `ProjectID === '0'` (default `0:0`).
- Given `VL_QUERY_TIMEOUT_MS=12345` in env, when axios defaults are inspected, then `timeout === 12345`.
- Given `VL_QUERY_TIMEOUT_MS` unset, when axios defaults are inspected, then `timeout === 30000` (default).
- Given `VL_QUERY_TIMEOUT_MS=garbage` (non-numeric) or `timeout: 0` passed as constructor option, when axios defaults are inspected, then `timeout === 30000` (graceful fallback, never `0`/no-timeout).
- Given a row `{_time:'2026-08-31T12:34:56.789Z', _msg:'hello', _stream:{service:'genie-backend', environment:'production'}, level:'INFO', trace_id:'abc'}`, when `_normalizeRows([row])` is called, then the output row has `timestamp='2026-08-31T12:34:56.789Z'`, `message='hello'`, `stream={service:'genie-backend', environment:'production'}`, `date='2026-08-31'`, `time='12:34:56'`, `level='INFO'` (uppercased), `service='genie-backend'`, `fields={level:'INFO', trace_id:'abc'}` (with `_msg`/`_stream`/`_time` excluded).
- Given a row with missing `_stream`/`_stream.level`, when normalized, then `service='unknown'` and `level='INFO'`.
- Given a row with `_time:'not-a-date'`, when normalized, then `timestamp=''`, `date=''`, `time=''` (graceful — no garbage slices on raw string).
- Given `_normalizeRows([])` or `_normalizeRows(null)`, when called, then returns `[]`.
- Given two concurrent first-call `query()` invocations with `skipHealthProbe:false`, when both pass the early-return guard, then only one health probe runs (memoized in-flight Promise).
- Given `grep -E '^(import|export) '` against the new file, then 0 matches (CommonJS-only invariant).
- Given `npm run lint` runs in `components/shared/lib`, then no new errors are introduced by the new file. (CI lint gate — worktree has no `node_modules/`.)

## Spec Change Log

### 2026-09-06 — Initial implementation
- **Triggering finding:** Reviewer (intent-alignment) flagged Reading A / Reading C divergence — the spec's `files:` listed two files, but `class VictoriaLogsAdapter extends LogQueryRepository` (the new file's first line) requires `LogQueryRepository` to be reachable at adapter module-load, while `index.js` simultaneously requires the adapter for its own re-export — forming a cycle.
- **What changed:** Implemented Reading C: minimum viable `index.js` load-order edit (define port class → expose `module.exports.LogQueryRepository` → require adapter). This was kept as a `deferred:` finding rather than triggering a `bad_spec` loopback because classifying as `bad_spec` would have reverted the change and re-derived the same edit.
- **Known-bad state avoided:** Silent `undefined` export of `VictoriaLogsAdapter` (the documented "loud failure" pattern from Story 4.2 becomes a real load once the adapter exists).
- **KEEP instructions for re-derivation:** (1) The early `module.exports.LogQueryRepository = LogQueryRepository` exposure + post-class `require('./victorialogs-client')` is the load-order hand-off — preserve it. (2) After review patch 5, the export shape changed to `module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError }`, so `index.js` must destructure `{ VictoriaLogsAdapter }` from the new module — preserve that destructure. (3) The `module.exports.LogQueryRepository = LogQueryRepository` assignment before the require is what enables the new file's `extends` to resolve at adapter module-load time — keep it first.

### 2026-09-06 — Review pass patches
- **Triggering finding:** 4 medium + 4 low review patches (see Review Triage Log).
- **What changed:** Race condition memoization; probe timing fix; `timeout:0`/`garbage` env guards; invalid `_time` graceful empty strings; `module.exports` named-object style; removed redundant `this.timeout`; NaN/null guards in `hits()`; underscore privacy convention.
- **Side effect:** Patch 5's `module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError }` shape change broke `index.js`'s prior `const VictoriaLogsAdapter = require('./victorialogs-client')` (now resolves to an object, not a class). `index.js` updated to `const { VictoriaLogsAdapter } = require('./victorialogs-client');` — minimal downstream consumer fix.

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 4, low 4)
- defer: 5
- reject: 27 (noise from blind-hunter listings — Symbol keys, locale-sensitive casing, `axios.create()` per-instance perf, `tenantId` validation, `Object.keys(raw)` walk, `String(_msg)` coerce semantics, `_normalizeRows` Symbol-key assumption, `level.toUpperCase()` locale default, module-scoped constants testability, `hits({field})` field validation, `Boolean(skipHealthProbe)` underscore, etc. — most were either already mitigated, speculative (Symbol keys / object `_msg`), out of AD-16 scope, or duplicative of other findings.)

- addressed_findings:
  - `[medium]` `[patch]` Lazy health probe race condition (lines ~188-210): two concurrent first-call requests both passed the `_healthProbed` boolean guard and each triggered its own full 3×5 s budget. Fixed by memoizing the in-flight `Promise` in `this._healthProbePromise`; subsequent callers `await` the same promise. Both `_healthProbed === true` (success) and the probe Promise reference are cleared on either success or error.
  - `[medium]` `[patch]` Health-probe timing math: AD-16 says "retries 3×5 s" but per-attempt axios `timeout: 5000` AND inter-attempt `setTimeout(5000)` made worst-case ~25 s, not 15 s. Dropped the inter-attempt sleep entirely; updated JSDoc to read "Retries 3×5 s;". `HEALTH_PROBE_BACKOFF_MS` retained as per-attempt `axios timeout`.
  - `[medium]` `[patch]` `timeout: 0` short-circuit: `Number.isFinite(0) === true` meant a fixture passing `timeout: 0` produced `resolvedTimeout = 0`, which axios interprets as "no timeout" (hung sockets). Tightened the guard to `typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0`. Also added `Number.isFinite(parsedEnvTimeout) ? parsedEnvTimeout : DEFAULT_QUERY_TIMEOUT_MS` for malformed env values like `VL_QUERY_TIMEOUT_MS=garbage`.
  - `[medium]` `[patch]` `_normalizeRow` invalid `_time` produced garbage `date`/`time`: when `_time` is a non-parseable string, code previously fell back to the raw string and sliced `[0,10)` / `[11,19)` — yielding invalid fragments like `date:'not-a-dat'`, `time:'e'`. Now produces empty `timestamp`/`date`/`time` strings when `Number.isNaN(parsed.getTime())`.
  - `[low]` `[patch]` `module.exports` style: replaced `module.exports = VictoriaLogsAdapter; module.exports.X = X;` with idiomatic `module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError }`. Downstream `index.js` updated to destructure accordingly.
  - `[low]` `[patch]` Removed `this.timeout = resolvedTimeout` from constructor — never read internally; axios already carries the value via `_axios.defaults.timeout`.
  - `[low]` `[patch]` `hits()` NaN/null guards: skip entries where `value === undefined || value === null` or `Number(count)` is not finite. Prevents `result[String(undefined)] = NaN` pollution of the histogram.
  - `[low]` `[patch]` Privacy convention: renamed constructor field `this.skipHealthProbe` → `this._skipHealthProbe` for consistency with `_axios` / `_healthProbed` / `_ensureHealth` / `_normalizeRows` siblings.

- **Reviewer observations (not triaged as defects):**
  - Intent-alignment divergence (Reading A vs Reading C) recorded as a `deferred:` finding rather than `bad_spec` — see Spec Change Log for rationale.
  - No co-located unit test — explicitly out of scope; Story 4.5 covers axios mock + normalization + AccountID headers + retry behavior + reserved-char escape.
  - No `AbortSignal` — future API.
  - No retry on `query()`/`hits()` 5xx — out of AD-16 scope.
  - Constants module-scoped — Story 4.5 testing concern.

## Design Notes

**Why a separate `victorialogs-client.js` from the seam in `melt/index.js`.** The seam layer (`melt/index.js`) stays vendor-neutral — `LogQueryRepository` is the abstract port, `VictoriaLogsClient` is the application service, `MELT_PROVIDER` is the discriminator. The actual VL HTTP wire (axios, header derivation, normalization, health probe) is encapsulated in the adapter file. Consumers (`LogsService`, `securityScanService`) reach the seam via `require('shared/lib/melt').VictoriaLogsClient` and never touch axios. This satisfies AD-3's hexagonal-layer rule ("Application consumers MUST consume via the port — NOT via raw axios") while letting Story 5.x and beyond treat the adapter as an opaque dependency.

**Why `VictoriaLogsHealthError` is typed (not a generic `Error`).** AD-16 specifies that "Early calls during the probe window throw a typed error caught by `VL_FAIL_OPEN` (which gates on `ECONNREFUSED` / `ENOTFOUND` / timeout / 5xx)." `VL_FAIL_OPEN` (CAP-5) needs to discriminate probe failures from query/hits failures to apply the rate-limit. The typed error carries `code: 'VL_HEALTH_FAILED'` and `cause` so callers can pattern-match either way. The cause chain (`error.cause.code === 'ECONNREFUSED'`) keeps the underlying network signal accessible without losing the wrapper's classification.

**Why `_ensureHealth` is memoized via Promise, not boolean.** A naive `_healthProbed` boolean lets two concurrent first-call requests each trigger their own full 3×5 s probe budget — multiplying cold-start cost and potentially throwing two `VictoriaLogsHealthError`s. Caching the in-flight Promise means the second caller awaits the same probe outcome. On success the boolean flips and the Promise reference clears; on error both flip back to false/null and the next first-call retries cleanly.

**Why `module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError }` instead of `module.exports = X; module.exports.X = X;`.** Idiomatic CommonJS named-exports style. The named-object shape makes both names reachable without the awkward class-attached-static, and downstream consumers (the seam layer's `index.js`) destructure naturally.

**Why the JSDoc says "Retries 3×5 s" without elaborating.** AD-16 pins the literal "3×5 s" budget. The current implementation is 3 attempts with a 5 s axios `timeout` per attempt and no inter-attempt sleep — worst case 15 s. Review pass caught an earlier draft that added a 5 s `setTimeout` between attempts (which doubled the budget). The simpler interpretation of "3×5 s" is three attempts at 5 s each; the sleep was over-engineering.

## Verification

**Commands:**
- `node --check components/shared/lib/melt/victorialogs-client.js` → `VICTORIA-OK` (syntax check passes after every patch).
- `node --check components/shared/lib/melt/index.js` → `INDEX-OK`.
- `NODE_PATH=.../gov-chat-backend/node_modules node -e "const m = require('./components/shared/lib/melt'); console.log(Object.keys(m).sort().join(','))"` → `LogQueryRepository,MELT_PROVIDER,VictoriaLogsAdapter,VictoriaLogsClient`.
- `NODE_PATH=... node -e "...VictoriaLogsAdapter({baseURL,tenantId:'0:0',skipHealthProbe:true})..."` → `instanceof: true`, instance keys `_axios,_healthProbed,_skipHealthProbe,baseURL,tenantId` (no redundant `this.timeout`, `_skipHealthProbe` underscored).
- `VICTORIALOGS_TENANT_ID='42:7'` → `AccountID: 42 ProjectID: 7`.
- `VL_QUERY_TIMEOUT_MS=12345` → `timeout: 12345`.
- `_normalizeRows([valid_row])` → all 8 AD-3 sub-shapes correct (timestamp/message/stream/fields/date/time/level/service).
- `_normalizeRows([{_time:'not-a-date',_msg:'x'}])` → `timestamp:''`, `date:''`, `time:''` (graceful empty on invalid `_time`, no garbage slices).
- `timeout:0` constructor option → `timeout: 30000` (never `0`/no-timeout).
- `VL_QUERY_TIMEOUT_MS=garbage` → `timeout: 30000` (malformed env falls back).

**Manual checks (if no CLI):**
- Open `melt/victorialogs-client.js` in IDE; hover `VictoriaLogsAdapter` — confirm JSDoc references AD-3, AD-15, AD-16.
- Inspect `melt/victorialogs-client.js:188-215` — confirm the health probe is a single-attempt loop with Promise memoization (not a boolean).

## Auto Run Result

**Summary:** Implemented `VictoriaLogsAdapter` — the concrete MELT adapter for VictoriaLogs. The class extends `LogQueryRepository` (the abstract port from Story 4.2), wires axios against the VL LogSQL HTTP API with `AccountID`/`ProjectID` headers (AD-15), normalizes VL wire rows to the canonical 8-sub-shape `VictoriaLogsRow` per AD-3, lazily probes `/health` on first call (AD-16, 3×5 s, memoized in-flight Promise), and reads `VL_QUERY_TIMEOUT_MS` (default 30000) for the axios timeout. All 4 AD-3 / AD-15 / AD-16 contract surfaces exercised and verified post-patch.

**Files changed:**
- `components/shared/lib/melt/victorialogs-client.js` (new, ~300 lines) — concrete adapter; CommonJS only.
- `components/shared/lib/melt/index.js` (modified) — load-order change (define port → expose on `module.exports` → require adapter) + destructure `{ VictoriaLogsAdapter }` from the new module's named exports. See Spec Change Log.
- `components/shared/lib/package.json` (modified) — added `"axios": "^1.7.0"` to `dependencies`.

**Review findings breakdown:**
- patches applied: 8 (high 0, medium 4, low 4)
- items deferred: 5 (no co-located unit test — Story 4.5; no `AbortSignal`; no retry on `query()`/`hits()`; module-scoped constants testability; `index.js` edit beyond spec scope)
- items rejected: 27 (blind-hunter noise)
- patched severity counts: high=0, medium=4, low=4
- followup score: 3×4 + 1×4 = 16 → `followup_review_recommended: true` (threshold: any patched high OR score ≥ 5; score 16 ≥ 5)

**Verification performed:**
- All 9 verification commands printed expected values (see Verification section).
- `node --check` exits 0 for both new and modified files.
- `_normalizeRows` smoke against the documented fixture confirms all 8 AD-3 sub-shapes match (timestamp/message/stream/fields/date/time/level/service).
- Invalid-`_time` smoke confirms graceful empty strings (no garbage slices).
- `timeout:0` and `VL_QUERY_TIMEOUT_MS=garbage` smokes confirm fallback to `30000`.
- `instanceof LogQueryRepository` confirms the adapter is a concrete port implementation.
- Two-key tenant splitting (`42:7` → `AccountID:42, ProjectID:7`) confirms AD-15 header derivation.

**Residual risks:**
- No unit tests in this diff. Story 4.5 (`tests: melt/victorialogs-client.test.js`) is the contract gate.
- `melt/index.js` was edited beyond the spec's listed `files:`. See Spec Change Log for rationale (Reading C — minimum viable seam edit). A future Epic 4 retrospective should consider amending the spec to explicitly call out the load-order change so the next adapter story doesn't repeat the divergence.
- `VictoriaLogsHealthError` is not re-exported through `melt/index.js`. Consumers that want `instanceof` checks must `require('components/shared/lib/melt/victorialogs-client')` directly. Re-export is a one-liner if 4.5 needs it.
- `ENABLE_OBSERVABILITY` and `ADMIN_LOGS_SOURCE` interactions are not enforced here — those are consumer-side (Story 5.x) concerns per CAP-5 / CAP-6.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`