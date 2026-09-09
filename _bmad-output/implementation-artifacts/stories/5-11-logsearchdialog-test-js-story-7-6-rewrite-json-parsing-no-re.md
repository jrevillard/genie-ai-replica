---
key: 5-11-logsearchdialog-test-js-story-7-6-rewrite-json-parsing-no-re
title: LogSearchDialog.test.js Story 7.6 rewrite (JSON parsing, no regex)
epic: epic-5
status: done
followup_review_recommended: true
effort: 0.1
depends_on: [5.7]
files: "components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js"
baseline_revision: 5d78d059f5d76a754155d9702aceed290425a2f8
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

## Auto Run Result

Status: done

### Summary

Rewrote the `Story 7.6` describe block in `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js` from printf-regex assertions to JSON-shape parsing via a `parseNdjsonLine` helper.

### Files changed

- `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js` — replaced printf-regex assertions (8 tests) with 9 JSON-shape assertions (1 standard, 3 parameterized level, 1 trace keys, 1 non-JSON rejection, 2 parameterized missing-field rejection, 1 component render).

### Review findings breakdown

- Patches applied: 7 (1 high, 1 medium, 5 low)
- Items deferred: 0
- Items rejected: 0

### Follow-up review recommendation

Score = 3×medium(1) + 1×low(5) = 8. Threshold = 5. → `followup_review_recommended: true`.

### Verification

- `npx jest --testPathPattern="LogSearchDialog"` — 1259 PASS / 0 FAIL
- `npx jest --testPathPattern="LogSearchDialog" --testNamePattern="JSON log format shape"` — 9 PASS / 0 FAIL / 1250 skipped
- `npx prettier --check src/__tests__/components/LogSearchDialog.test.js` — clean
- `npx eslint src/__tests__/components/LogSearchDialog.test.js` — clean

### Residual risks

- Frontmatter `files` field was previously pinned to `:885-948`, but that range was stale post-story-5.7 (the block actually lived at 993-1068, now ~993-1085 after the review-pass patches). The field was updated to point at the file only (no line range) — future stories should grep for the describe block by name rather than trust a stale line range.
- `LogSearchDialog.vue` `performSearch` (lines 362-368) explicitly drops every API field outside `{date, time, level, service, message}` — `trace_id`/`span_id` from the API payload never reach the rendered output. Exposing them is out of scope for this story (separate AD-9 surface work tracked elsewhere in the epic).
- Helper `parseNdjsonLine` is a test-local utility (defined inside the describe block, not exported). It is intentionally not a production parser.

