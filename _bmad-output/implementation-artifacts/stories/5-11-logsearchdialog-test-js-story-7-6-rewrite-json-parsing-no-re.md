---
key: 5-11-logsearchdialog-test-js-story-7-6-rewrite-json-parsing-no-re
title: LogSearchDialog.test.js Story 7.6 rewrite (JSON parsing, no regex)
epic: epic-5
status: done
followup_review_recommended: false
review_loop_iteration: 1
effort: 0.1
depends_on: [5.7]
files: "components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js"
baseline_revision: 5d78d059f5d76a754155d9702aceed290425a2f8
deferred:
  - summary: >-
      `makeRecord` defaults omit `trace_id` and `span_id`, even though the
      describe-block header comment lists the six-key wire schema including those
      two fields; defaulting them in the factory would close the doc/code drift
      and let the "standard" test cover a populated trace pair by default.
    evidence: |-
      The header comment at the top of `describe('JSON log format shape', ...)`
      documents the wire schema as `{timestamp, level, message, service,
      trace_id, span_id}`, but `makeRecord()` only stamps the first four; the
      "standard" test then asserts `record.trace_id`/`span_id` are `undefined`.
      Adding the two trace fields (or omitting them from the comment) would
      align the test fixture with its own docstring.
    location: >-
      components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js:1017-1025
    severity: low
---

# Story 5.11 — LogSearchDialog.test.js Story 7.6 rewrite (JSON parsing, no regex)

**Epic**: epic-5 (0.1 SP)
**Files**: `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-09 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7
  - 1: (high 1, medium 1, low 5)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Removed story/spec references (`Story 7.6`, `SPEC.md CAP-2 + AD-9`, `P1a`, `AD-9`) from header comment block and inline `// AD-9:` comment — violates project rule against story/FR/AC/D numbers in code comments.
  - `[medium]` `[patch]` Renamed component-level test from "component renders with trace_id/span_id JSON fields from API payload" to "renders API payload with JSON-shape message field (post-format cutover)" — title overstated what the assertions verified (component drops trace_id/span_id at performSearch boundary).
  - `[low]` `[patch]` Dropped the duplicated "rejects printf-style lines that previously matched the legacy regex" test — it asserted the same `SyntaxError` as the preceding non-JSON rejection test.
  - `[low]` `[patch]` Added a symmetric "missing level" test case via `it.each` so both required-field guards are exercised.
  - `[low]` `[patch]` Extracted `makeRecord(overrides)` factory to deduplicate the six repeated JSON.stringify(record-literal) call sites.
  - `[low]` `[patch]` Collapsed the three near-identical level cases (ERROR/WARN/DEBUG) into a single `it.each` parameterized test.
  - `[low]` `[patch]` Rewrote the header "smoke test" wording to honestly describe the actual scope (parsed shape, not cutover contract).

### 2026-09-09 — Follow-up review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4
  - 1: (high 0, medium 0, low 4)
- defer: 1
- reject: ~25 (helper exhaustiveness, helper-not-production-parser already documented, DOM-render pre-existing, Story 5.7 banner scope already covered by separate story, title "cutover" wording addressed via patch, level-set validation exhaustiveness, etc.)
- addressed_findings:
  - `[low]` `[patch]` Dropped the two `expect(...).not.toMatch(/trace_id=|span_id=/)` regex assertions from the trace-keys test — they had become tautological once the fixture no longer embedded printf fragments in `message`, and their presence violated the "no regex" literal intent of the story title.
  - `[low]` `[patch]` Replaced the six individual field assertions in "parses standard NDJSON winston record" with a single `toEqual({...})` shape assertion, so any extra field slipping through the helper would now fail loudly.
  - `[low]` `[patch]` Renamed "renders API payload with JSON-shape message field (post-format cutover)" to "renders API payload with JSON-shape message field" — the parenthetical referenced a future migration event not present in the test's actual scope.
  - `[low]` `[patch]` Added a "missing both" payload to the `it.each` missing-field rejection suite so the `message`-first guard is exercised when both required fields are absent (previously only one-at-a-time was tested).

## Auto Run Result

Status: done

### Summary

Rewrote the `Story 7.6` describe block in `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js` from printf-regex assertions to JSON-shape parsing via a `parseNdjsonLine` helper.

### Files changed

- `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js` — replaced printf-regex assertions (8 tests) with 10 JSON-shape assertions (1 standard with full-shape `toEqual`, 3 parameterized level, 1 trace keys, 1 non-JSON rejection, 3 parameterized missing-field rejection, 1 component render).

### Review findings breakdown

- Patches applied: 4 (low)
- Items deferred: 1 (low — makeRecord wire-schema doc/code drift, see deferred list)
- Items rejected: ~25 (helper exhaustiveness scope, helper-not-production-parser already documented, DOM-render pre-existing pattern, Story 5.7 banner scope tracked by separate story, etc.)

### Follow-up review recommendation

Score = 3×medium(0) + 1×low(4) = 4. Threshold = 5. → `followup_review_recommended: false`.

### Verification

- `npx jest --testPathPattern="LogSearchDialog"` — 1260 PASS / 0 FAIL (was 1259; +1 from new "missing both" case)
- `npx jest --testPathPattern="LogSearchDialog" --testNamePattern="JSON log format shape"` — 10 PASS / 0 FAIL / 1250 skipped (was 9)
- `npx prettier --check src/__tests__/components/LogSearchDialog.test.js` — clean
- `npx eslint src/__tests__/components/LogSearchDialog.test.js` — clean

### Residual risks

- Frontmatter `files` field was previously pinned to `:885-948`, but that range was stale post-story-5.7 (the block actually lived at 993-1068, now ~993-1085 after the review-pass patches). The field was updated to point at the file only (no line range) — future stories should grep for the describe block by name rather than trust a stale line range.
- `LogSearchDialog.vue` `performSearch` (lines 362-368) explicitly drops every API field outside `{date, time, level, service, message}` — `trace_id`/`span_id` from the API payload never reach the rendered output. Exposing them is out of scope for this story (separate AD-9 surface work tracked elsewhere in the epic).
- Helper `parseNdjsonLine` is a test-local utility (defined inside the describe block, not exported). It is intentionally not a production parser.
- Deferred item: `makeRecord` defaults omit `trace_id` and `span_id` even though the describe-block header comment lists the six-key wire schema including those fields. A future cleanup story could either add the two trace fields to the factory defaults or trim the comment to match.

