---
baseline_commit: 14205ae
---
# Story 3.8: OKF concept curator + validation panel

Status: ready-for-dev

Story key: `3-8-okf-concept-curator-validation-panel` | GitLab: #969
Epic: 3 (Admin UI) / **Epic 10** (OKF Studio capstone) | Branch: `feat/okf-server`
FRs: FR-25, FR-26 | Spec: [okf-studio-ux-design-2026-08-13](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) §1.1 Steps 5–6, §8.2

> **The gap:** the Studio's Step 5 (curate) and Step 6 (validate) need their components — the concept tree + inline editor integration, and a validation panel running the REAL conformance + PII + formatting checks. This story ships `OkfCuratorPanel.vue` + `OkfValidationPanel.vue`, composing the 4.2 editor and surfacing the conformance/format results live.

## Story

As a **knowledge author**,
I want **to curate a repo's concepts and see live validation (conformance, PII, formatting)**,
So that **I fix issues in-context before review — nothing invalid reaches publish**.

## Acceptance Criteria

1. **`OkfCuratorPanel.vue` (Step 5 — Curate)**: the repo's concept tree + an inline `OkfConceptEditor` (4.2) for the selected concept; edits re-parse → incremental re-index (the 4.1 contract); non-conformant saves blocked at the editor with the specific §11 error (4.2 AC).
   - For **clone-sourced** repos (the 2026-08-18 §8.1 amendment), the panel opens with the copied concepts + a `Cloned from <source> · version <vN>` banner; re-ingest of a modified concept flows through the clone's OWN graph.
2. **`OkfValidationPanel.vue` (Step 6 — Validate)**: runs the REAL `conformanceService.validateConcept` + `getRepoMetrics` (the 5 implemented codes — MISSING_TYPE, BAD_ACTOR_PREFIX, INVALID_STATUS_ENUM, UNPARSEABLE_STALE_AFTER, SOURCE_MISSING_RESOURCE), groups issues per concept, and shows a **formatting badge** ("N concepts need formatting") from the 4.2b formatter's DRY-RUN (no writes — Step 7 applies). PII is surfaced as a publish-gate status, not a Step-6 blocker (2.8).
3. **The fix path (Step 7 link)**: each validation issue links into the `OkfDiffReviewPanel` (10.1) proposal for that concept; a "Format this concept" action (the 4.2b formatter) is offered here as a dry-run preview with Accept — the same traffic-light discipline.
4. **Composition + standards**: DS primitives, Options API, Vuex `okf` module, `httpService`; i18n `okf.curate.*` / `okf.validate.*`; Jest tests (issue grouping, format-badge dry-run, blocked-save, clone banner).

## Tasks

- [ ] T1 `OkfCuratorPanel.vue` (concept tree + inline 4.2 editor + clone banner) + tests
- [ ] T2 `OkfValidationPanel.vue` (conformanceService + getRepoMetrics + issue grouping) + tests
- [ ] T3 Formatting badge (4.2b dry-run) + "Format this concept" preview + tests
- [ ] T4 i18n + Jest + lint/format; close-out (sprint/#969/push)

## Dev Notes

- **Anchors (verified 2026-08-18):** `conformance-service.js` (validateConcept :47, getRepoMetrics :146 — the 5 implemented codes) is LIVE and already smoke-verified; the 4.2 editor is the Step-5 component to import; `okf_concepts_meta` is the live source (concept tree reads it).
- **Real checks only (R2/R6):** the validation panel calls the actual conformance service — never a client-side reimplementation, never a mock echo. The format badge uses the 4.2b dry-run contract (`validateFormatting`), not a local heuristic.
- **The clone banner is the D-V5 lineage surface** (the 2026-08-18 amendment): `cloned_from: { repo_id, version }` read from the repo doc — the steward always knows the origin before editing.
- **Gating:** the format badge/format-action need 4.2b (formatter); the issue→diff-panel link needs 10.1; the editor needs 4.2. The panel + tree + grouping land regardless (conformance is live).
- **Existing UI paradigms (memory):** the concept-tree + inline-editor + validation-badge patterns from the admin dashboard; zero inconsistencies.

## Scope boundary (do NOT build)

The diff panel (10.1) · `auto-correct-service` (10.2) · the formatter service (4.2b — consumed, not built) · the editor internals (4.2) · the review/publish step UI (10.6).

## References

[Studio UX design §1.1 Steps 5–6, §8.2](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) · PRD FR-25/FR-26 · `conformance-service.js` · Stories 4.2/4.2b/10.1 · memory `feedback_existing-ui-paradigms`.
