# Sprint Change Proposal

**Date:** 2026-05-28
**Initiative:** testing-framework
**Trigger:** Code review of story 7-1 revealed Epic 7 instruments tests instead of application code
**Author:** Jerome Revillard
**Status:** Approved

---

## 1. Issue Summary

Epic 7 (MELT-Ready Test Instrumentation) was scoped to create mock trace IDs and log assertion helpers for test frameworks. This does not deliver real application observability — MELT (Metrics, Events, Logs, Traces) must instrument the production code (Express backend, FastAPI/OPEA services, RAG pipeline), not test fixtures.

**Discovery:** Identified during code review of story 7-1. The implemented code generates deterministic DJB2 hash-based mock trace IDs in Jest and pytest test fixtures. No consumer exists for these IDs, and they do not contribute to production service observability.

**Evidence:**
- Story 7-1 code (branch `feat/testing-framework/7-1-*`, unmerged) creates `tests/melt-helpers/trace-context.js` and `trace-context.py` — mock trace ID generators for test frameworks
- No major observability tool (Grafana, Datadog, New Relic) uses trace IDs in unit test results
- PRD success criteria line 93 mentions "trace failure through full request path using MELT distributed traces" — this requires instrumenting Express, FastAPI, and OPEA services, not tests
- The "Sprint 22/23 bridge pattern" creates mock instrumentation that will be discarded when real OTel is added

---

## 2. Impact Analysis

### Epic Impact

| Epic | Status | Impact |
|------|--------|--------|
| Epic 7 (3 stories) | 7-1 review, 7-2/7-3 backlog | **Replace entirely** with application observability epic |
| Epic 8 (RAG Quality) | backlog | No impact — independent |
| Epic 9 (AI Test Gen) | backlog | No impact — independent |

### PRD Impact

| Section | Change Required |
|---------|-----------------|
| Success Criteria line 93 | Already describes app-level tracing — keep as-is |
| MELT Integration (lines 114-124) | Rewrite: pivot from test instrumentation to application instrumentation |
| FR40-FR41 | Rescope: application telemetry, not test output |
| FR42 | Keep (log assertions are useful independently) |
| FR43-FR44 | Move to Vision section (requires MELT Provider API from Sprint 23) |
| NFR20 | Rescope: OTel compatibility for application services |
| Journeys 4-5 | Keep concept, clarify as application debugging |

### Architecture Impact

| Section | Change |
|---------|--------|
| Lines 269-280 (MELT bridge table) | Replace with application OTel architecture |
| Lines 478-505 (MELT patterns) | Replace mock patterns with real OTel SDK patterns |
| Lines 616-618 (melt-helpers/) | Remove or replace with OTel config |
| Line 302 (impl sequence) | Update item 6 from "MELT-ready hooks" to "OTel instrumentation" |

### Code Impact

- Branch `feat/testing-framework/7-1-*`: delete (unmerged, 3 commits)
- No production code affected

---

## 3. Recommended Approach

**Direct Adjustment** — Replace Epic 7 with properly scoped application observability epic. Update PRD and architecture to align.

**Rationale:**
- Only 1 story was implemented (unmerged) — low abandonment cost
- Stories 7-2 and 7-3 still in backlog — zero effort lost
- OTel SDK instrumentation is deployment-agnostic (survives Docker → K8s migration)
- Security is integrated as ACs in each story (PII sanitization, auth, network policies)

**Effort:** Low (documentary updates + story definitions)
**Risk:** Low (no merged code impacted)
**Timeline:** No impact on Epic 8 or 9 scheduling

---

## 4. Detailed Change Proposals

### Proposal A: Replace Epic 7 in epics.md

Remove stories 7-1 through 7-3. Insert new Epic 7 with 5 stories covering real OTel instrumentation of the application stack.

### Proposal B: PRD MELT Integration section (lines 114-124)

Replace "Testing x Observability Synergy" with "Application Observability Foundation" — describes OTel SDK instrumentation in Express and FastAPI services, not test fixtures.

### Proposal C: PRD Functional Requirements (lines 441-447)

Rescope FR40-FR41 from test framework to application services. Move FR43-FR44 to Vision section.

### Proposal D: PRD NFR20

Update from "Test output formats compatible with OTel" to "Application services emit OTel-compatible telemetry."

### Proposal E: PRD MVP section (line 150)

Replace "Test instrumentation patterns: structured log assertions, trace context propagation in test fixtures" with "Application OTel instrumentation: distributed traces from Express backend and OPEA services."

### Proposal F: Architecture MELT sections (lines 269-280, 478-505)

Replace mock trace ID patterns with real OTel SDK integration patterns. Update bridge table to show actual OTel Collector architecture.

### Proposal G: Sprint Status

Remove old Epic 7 entries. Add new Epic 7 entries (5 stories + retrospective, all backlog).

### Proposal H: Delete branch 7-1

Delete `feat/testing-framework/7-1-create-structured-test-output-and-trace-context-helpers` (unmerged).

---

## 5. Implementation Handoff

**Scope:** Moderate — backlog reorganization + documentary updates.

**Execution:**
1. Apply Proposals A-G (edit epics.md, prd.md, architecture.md, sprint-status.yaml)
2. Delete branch 7-1
3. Commit with message: `refactor(epic-7): rescope from test instrumentation to application OTel observability`

**Success Criteria:**
- Epic 7 contains 5 stories for real OTel instrumentation
- PRD success criteria, FRs, NFRs updated
- Architecture MELT sections reflect real OTel SDK patterns
- Sprint-status.yaml updated
- Branch 7-1 deleted

---

## Approval

- [x] Approved by: Jerome Revillard
- [x] Date: 2026-05-28
