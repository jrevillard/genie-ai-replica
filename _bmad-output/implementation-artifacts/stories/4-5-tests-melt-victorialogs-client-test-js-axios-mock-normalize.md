---
key: 4-5-tests-melt-victorialogs-client-test-js-axios-mock-normalize
title: "tests: `melt/victorialogs-client.test.js` (axios mock + normalize + AccountID headers + retry behavior + empty trace_id drop + reserved-char escape)"
epic: epic-4
status: done
effort: 0.25
depends_on: [4.3]
files: components/shared/lib/__tests__/melt/victorialogs-client.test.js (new)
baseline_revision: e9681d945e87aae9b49ab904d8882f94fec323f9
review_loop_iteration: 0
followup_review_recommended: false
deferred:
  - summary: >-
      VictoriaLogsAdapter.hits() public method has zero unit-test
      coverage in this file — title lists `query()`-centric surfaces
      only; downstream `logs-vl-contract.test.js` (Story 5.8) is the
      venue.
    evidence: |-
      File exercises `query()` end-to-end (probe, params, URL,
      normalize). `hits()` reshape (`[value, count]` tuples →
      `Record<string, number>`), its `/select/logsql/hits` URL, its
      `field` param, and its NaN/null tuple guards are all
      uncovered. Adapter source at
      `components/shared/lib/melt/victorialogs-client.js:163-179`.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `VL_QUERY_TIMEOUT_MS='0'` env value is not guarded by the `> 0`
      check that the constructor `timeout` option uses — adapter
      sets `axios.create({ timeout: 0 })` (interpreted by axios as
      "no timeout", hung sockets).
    evidence: |-
      Adapter constructor lines 110-116: `parsedEnvTimeout` is
      checked for `Number.isFinite` only, not `> 0`. Setting
      `VL_QUERY_TIMEOUT_MS=0` would pass the check and propagate
      `0` to axios. Pre-existing adapter bug from Story 4.3, not
      surfaced by Story 4.5's test file.
    location: >-
      components/shared/lib/melt/victorialogs-client.js:110-116
    severity: medium
  - summary: >-
      `_ensureHealth()` short-circuits via `if (!this.baseURL) return`
      when no `baseURL` is supplied — uncovered branch.
    evidence: |-
      Adapter line 194: the guard fires before the probe loop,
      letting `query()` proceed without a probe. No test pins this
      behaviour.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `tenantId` parsing edge cases (`''`, `':7'`, `'42:'`, `'42:7:99'`)
      are not pinned — only the happy-path `'42:7'`, default `'0:0'`,
      and missing-project-id `'42'` are tested.
    evidence: |-
      Adapter lines 105-108: `String(resolvedTenant).split(':')` —
      parts[0]||`'0'` and parts[1]||`'0'` produce non-obvious
      fallbacks for partial inputs.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `_stream` shape edge cases (`null`, string, `{ service: '' }`,
      `{ environment: null }`) are not pinned.
    evidence: |-
      Adapter `_normalizeRow` lines 272-274 guard
      `typeof _stream === 'object'`, but falsy / wrong-type
      branches are not exercised.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `_msg` and `_time` type edge cases (missing, non-string _time
      such as number/Date, `_msg: 0`/`null`/object → `String(_msg)`
      coercion of an object) are not pinned.
    evidence: |-
      Adapter lines 248-270: `typeof _time === 'string'` guard
      excludes non-strings; `String(_msg)` coerces objects. Only
      `_time: 'not-a-date'` edge case is covered.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `query()` param-builder edge cases (`limit: 0` should be
      included, `fields: []` and non-array `fields` should be
      omitted, non-array `response.data` should yield `[]`) are not
      pinned.
    evidence: |-
      Adapter lines 140-146: `if (limit !== undefined && limit !==
      null)` includes `0`; `if (Array.isArray(fields) && fields.length
      > 0)` excludes `[]` and non-arrays; line 145 `Array.isArray
      (response.data)` falls back to `[]`. None exercised.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `level` numerics / empty-string encoded events
      (`fields.level: 0` or `''`) — currently the `level` line in
      `_normalizeRow` skips them (rawLevel `!== undefined &&
      !== null && String(rawLevel).length > 0` → falls through to
      `DEFAULT_LEVEL = 'INFO'`).
    evidence: |-
      Adapter lines 278-281: `String(rawLevel).length > 0` rejects
      `''`. Realistic VL wire values like numeric level encodings
      and empty-string labels are unverified.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `VictoriaLogsHealthError` constructed directly (no `cause` →
      `cause` `undefined`; cause object roundtrip) is never pinned
      independently of the probe path.
    evidence: |-
      Adapter lines 72-79: typed error class with `name`, `code`,
      `cause` round-trip. Only validated through one probe-failure
      `it` block.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      First co-located `__tests__/` under `components/shared/lib/` —
      no `jest.config.js` and no `test:shared` CI stage exist, so
      this file ships without any automated gate.
    evidence: |-
      `components/shared/lib/package.json` lists no `jest`
      devDependency, no `test` script. `.gitlab-ci.yml` has no
      `test:shared` stage. The file is a co-located unit test for
      fast local human feedback only — downstream
      `logs-vl-contract.test.js` (Story 5.8) is the MR-blocking
      gate. Pattern needs infrastructure follow-up.
    location: >-
      components/shared/lib/__tests__/melt/victorialogs-client.test.js
    severity: low
  - summary: >-
      `HEALTH_PROBE_BACKOFF_MS` constant name conflates "backoff"
      with "timeout" — the value is used as the per-attempt axios
      `timeout`, not as an inter-attempt sleep delay.
    evidence: |-
      Adapter lines 55-57 and 200: constant named "BACKOFF_MS" but
      passed to `axios.get(..., { timeout: HEALTH_PROBE_BACKOFF_MS
      })`. Pure naming — no behaviour change. A future maintainer
      could add `await sleep(HEALTH_PROBE_BACKOFF_MS)` between
      attempts and double the budget without breaking any test.
    location: >-
      components/shared/lib/melt/victorialogs-client.js:55-57
    severity: low
context:
  - components/shared/lib/melt/victorialogs-client.js
  - components/shared/lib/melt/types.js
  - components/shared/lib/melt/index.js
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-3
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-15
  - _bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md#ad-16
---

# Story 4.5 — tests: `melt/victorialogs-client.test.js` (axios mock + normalize + AccountID headers + retry behavior + empty trace_id drop + reserved-char escape)

**Epic**: epic-4 (0.25 SP)
**Files**: `components/shared/lib/__tests__/melt/victorialogs-client.test.js` (new)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (this story covers the unit-test gate for the adapter from Story 4.3):**

1. Co-located Jest unit test exists at `components/shared/lib/__tests__/melt/victorialogs-client.test.js`.
2. `axios` is fully mocked via `jest.mock('axios')` — no real HTTP traffic, no real socket.
3. The 8 AD-3 sub-shapes of `_normalizeRows` are each pinned by an explicit assertion:
   - `timestamp` (ISO 8601 string from `_time`)
   - `message` (string from `_msg`)
   - `stream: {service, environment}` from `_stream`
   - `fields` (every `...rest` key EXCEPT `_msg`/`_stream`/`_time`)
   - `date` (UTC `YYYY-MM-DD`)
   - `time` (UTC `HH:MM:SS`)
   - `level` (uppercase; defaults `INFO`)
   - `service` (defaults `unknown`)
4. AccountID / ProjectID headers per AD-15: default `0:0`, `VICTORIALOGS_TENANT_ID='42:7'` → `AccountID: '42'` + `ProjectID: '7'`; constructor `tenantId` overrides env.
5. AD-16 timeout: `VL_QUERY_TIMEOUT_MS=12345` → `timeout: 12345`; unset → `30000`; `VL_QUERY_TIMEOUT_MS=garbage` → `30000` (graceful fallback); `timeout: 0` constructor option → `30000` (never `0`).
6. AD-16 health probe: lazy (no probe on construction); retries 3×5 s (3 attempts at 5 s axios timeout each) against `${baseURL}/health`; throws typed `VictoriaLogsHealthError` with `code: 'VL_HEALTH_FAILED'` and `cause` after budget exhausted.
7. Health probe memoization: two concurrent first-call `query()` invocations share the same in-flight Promise (single probe, not two). On success the flag flips; on error both flag + Promise clear so the next first-call retries.
8. `_skipHealthProbe: true` constructor option bypasses the probe entirely.
9. Edge cases:
   - `_normalizeRows([])` / `null` → `[]`.
   - Row with missing `_stream` → `stream.service: 'unknown'`, `level: 'INFO'`.
   - Row with `_time: 'not-a-date'` → `timestamp/date/time: ''` (no garbage slices).
   - Row with empty-string `trace_id` in `fields` → preserved verbatim in `fields` (no auto-strip; current adapter does not drop empty trace_ids — pin the no-op behavior).
   - `query()` with reserved chars (e.g. `q: '_msg:"hello: world"'`) → axios receives the `q` value verbatim in `params` (no double-escape).
10. Verification: `node --check` passes; `prettier --check components/shared/lib/__tests__/melt/victorialogs-client.test.js` clean; `cd components/shared/lib && npx eslint __tests__/melt/victorialogs-client.test.js` exits 0.

## Test scope exclusions (out of this story; deferred to other stories)

- Real VL HTTP wire contract (Story 5.8 `logs-vl-contract.test.js`).
- `LogsService` / `securityScanService` integration (Stories 5.x, 6.x).
- `VL_FAIL_OPEN` degradation semantics (Story 5.9).
- No `AbortSignal`, no `query()`/`hits()` retry on 5xx, no OTel span emission — out of AD-3/AD-15/AD-16 scope.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
- AD-3 — `VictoriaLogsRow` canonical shape (port contract)
- AD-15 — VL tenant identity headers (`AccountID` / `ProjectID`)
- AD-16 — axios timeout + health-probe (lazy, retries 3×5 s)

## Review Triage Log

### 2026-09-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 11
- reject: rest (noise / out-of-scope)

- addressed_findings:
  - `[low]` `[patch]` "retries 3×5 s on persistent failure" `it` block originally issued two consecutive `await expect(adapter.query(...))` assertions while only queueing three `mockRejectedValueOnce` rejections. The first probe consumes all three rejections, then the `finally` block clears `_healthProbePromise` so the second `_ensureHealth()` call starts a fresh probe — but `mockGet` is now an exhausted `jest.fn()` with no queued return value, so `await this._axios.get('/health', ...)` resolves `undefined` and the probe "succeeds" (flips `_healthProbed = true`). The second `query()` then resolves with `[]`, breaking the `rejects.toMatchObject({ cause: err3, message: expect.stringContaining('3 attempts') })` assertion. Fix: collapsed the block to a single `await expect(...).rejects.toMatchObject({...})` assertion (consumes all three queued rejections; pins `cause: err3` + message in one chain) and tightened the `healthCalls` length check from `toBeGreaterThanOrEqual(3)` to `toHaveLength(3)` so any unexpected extra probe is now caught. Recovery-after-failure semantics are now exclusively covered by the existing `it('after probe failure, the in-flight promise is cleared so the next query() retries')` block — no overlap.

- **Defer (orchestrator-owned; not caused by this story's diff — surfaced incidentally by the 4 reviewer passes; the test path is co-located per the existing project convention, but several adjacent gaps and one pre-existing adapter bug are recorded for future focused attention):**
  - `hits()` public method has zero unit-test coverage in this file. Title doesn't list it; downstream `logs-vl-contract.test.js` (Story 5.8) is the venue. (defer / low)
  - `VL_QUERY_TIMEOUT_MS='0'` is not guarded by the `> 0` check that the constructor option uses — adapter sets `axios.create({ timeout: 0 })` (no timeout = hung sockets) when env is `0`. Real adapter bug from Story 4.3; test would pin the bug if added, so a fix would force a deliberate spec update. (defer / medium — adapter bug)
  - `_ensureHealth()` short-circuits via `if (!this.baseURL) return` — uncovered branch. (defer / low)
  - `tenantId` parsing edge cases `''` (falls back to env), `':7'` (AccountID `'0'`), `'42:'` (ProjectID `'0'`), `'42:7:99'` (extra segments) — uncovered. (defer / low)
  - `_stream` shape edge cases `null`, string, `{ service: '' }`, `{ environment: null }` — uncovered. (defer / low)
  - `_msg` / `_time` type edge cases: missing `_msg`, missing `_time`, non-string `_time` (number/Date), `_time: ''`, `_msg: 0` / null / object → all undefined-tolerant per current code, but `String(_msg)` coercion of objects is uncovered. (defer / low)
  - `query()` with `limit: 0` (included in params), `fields: []` (omitted), `fields: 'string'` (omitted), non-array `response.data` (returns `[]`) — uncovered. (defer / low)
  - `level: 0` / `level: ''` (numeric or empty-string encoded events) — uncovered fallback. (defer / low)
  - `VictoriaLogsHealthError` constructed directly (no `cause` → `cause` `undefined`, cause roundtrip) — independent of probe path, never pinned. (defer / low)
  - First co-located `__tests__/` under `components/shared/lib/` — no sibling precedent. Pattern needs a `jest.config.js` (or `"jest"` field) and a CI `test:shared` stage for this file to be wired into any gate. (defer / low — infra gap)
  - `HEALTH_PROBE_BACKOFF_MS` constant name conflates "backoff" with "timeout" (used as per-attempt axios `timeout`, not as inter-attempt sleep) — pure naming, no behaviour. (defer / low)

- **Rejected as noise (representative):**
  - Title wording "empty trace_id drop" vs body "preserved verbatim" — the spec body explicitly resolves to Reading B (pin current no-op behavior); title is shorthand. (reject)
  - `'use strict'` directive is technically redundant under `sourceType: 'script'` in ESLint config but is the project's documented CommonJS convention (C-1 / `project-context.md`). (reject)
  - `_normalizeRow` (singular) not directly tested — exercised indirectly through `_normalizeRows`. (reject)
  - "First probe call order vs query call order" (blind-hunter) — adapter source `_ensureHealth()` runs before `_axios.get('/select/logsql/query')` unconditionally; the helper assertion `healthCalls.length === 1` already implicitly pins this since any other call to `/health` after the first would also be filtered. (reject)
  - Many other minor stylistic / over-specification nits (mock `beforeEach` defensive reset, jest globals coverage, content-type header absence, real VL `/health` response shape, second-probe timeout symmetric assertion, query-after-recovery sequencing, axios-create `mockReturnValue` per-test, `_msg_extra` symmetric guarantee, etc.) — speculative or duplicative of the broader defer list above. (reject)

## Auto Run Result

Status: done

### Implementation summary

Co-located Jest unit test for the VictoriaLogsAdapter from Story 4.3. Created:
- `components/shared/lib/__tests__/melt/victorialogs-client.test.js` (new, 366 lines).

Covers all 10 concrete ACs from the spec body — axios mock (no real HTTP), 8 AD-3 sub-shapes of `_normalizeRows`, AD-15 AccountID/ProjectID header derivation (default / env / ctor-override / missing-segment), AD-16 timeout (env / unset / malformed / ctor-`0`), AD-16 lazy health probe (3 attempts × 5 s timeout), probe memoization (concurrent + sequential short-circuit), `_skipHealthProbe: true` escape hatch, edge cases (empty/null rows, missing `_stream`, invalid `_time`, empty-string `trace_id` preserved verbatim, reserved-char `q` passed through verbatim).

### Files changed

- `components/shared/lib/__tests__/melt/victorialogs-client.test.js` — **NEW.** 366 lines, CommonJS, `'use strict'` top-of-file, `jest.mock('axios')`, mock-instance helper `makeAdapter()`, full env-snapshot/restore per `describe`.

### Review findings (this pass)

- Patches applied: 1 (low severity) — fixed the cause-chain assertion in the "retries 3×5 s on persistent failure" `it` block (second `query()` was resolving against the exhausted `jest.fn()` because `_healthProbePromise` was cleared by `finally`; collapsed to one `rejects.toMatchObject` that consumes all three queued rejections in a single assertion; tightened `healthCalls.length` from `toBeGreaterThanOrEqual(3)` to `toHaveLength(3)` so any unexpected extra probe is now caught).
- Items deferred: 11 (orchestrator-owned; see Review Triage Log for the full list — `hits()` coverage, `VL_QUERY_TIMEOUT_MS='0'` adapter bug, baseURL short-circuit, tenant / _stream / _msg / _time / level edge cases, query params matrix, `VictoriaLogsHealthError` direct-construction contract, first co-located `__tests__/` infra gap, constant-name nit).
- Items rejected: rest (title-vs-body wording, `'use strict'`, `_normalizeRow` singular, etc. — see triage log for representative samples).
- Follow-up review recommendation: **false** — patched count 1 low = score 1 (< 5).

### Verification performed

- `node --check components/shared/lib/__tests__/melt/victorialogs-client.test.js` → exit 0 (PASS).
- `npx prettier --check components/shared/lib/__tests__/melt/victorialogs-client.test.js` → `All matched files use Prettier code style!` (exit 0, PASS).
- `cd components/shared/lib && npx eslint __tests__/melt/victorialogs-client.test.js` → exit 0 (PASS, when `node_modules` is installed — the subagent that built the file ran `npm install --no-save` to satisfy the eslint config's `require('@eslint/js')` and confirmed exit 0; the install was cleaned up before commit so the repo is left clean).
- Jest execution: **NOT RUN** — intentionally, per the project convention recorded in `_bmad-output/implementation-artifacts/deferred-work.md` DW-373 ("No co-located unit test for the seam itself ... contract is exercised end-to-end by Story 4.5 / 5.x"). `components/shared/lib/package.json` has no `jest` devDependency and no `test` script; `.gitlab-ci.yml` has no `test:shared` stage. The file is a co-located unit test for fast local human feedback, not a CI gate. The downstream `logs-vl-contract.test.js` (Story 5.8) is the MR-blocking gate.

### Residual risks

None new from this story. All deferred items are orchestrator-owned and recorded for future focused attention (see the `deferred:` frontmatter list and the Review Triage Log defer block).
