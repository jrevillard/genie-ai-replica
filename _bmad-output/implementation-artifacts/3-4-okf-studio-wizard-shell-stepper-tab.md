---
baseline_commit: 14205ae
---
# Story 3.4: OKF Studio wizard shell + stepper + Studio tab

Status: ready-for-dev

Story key: `3-4-okf-studio-wizard-shell-stepper-tab` | GitLab: #965
Epic: 3 (Admin UI) / **Epic 10** (OKF Studio capstone) | Branch: `feat/okf-server`
FRs: **FR-38** ("one wizard, 3 workflows" → now 4 sources), FR-26 | Spec: [okf-studio-ux-design-2026-08-13](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) §1.1, §1.4, §8.1

> **The gap:** the Studio wizard is designed (9-step guided linear wizard, unanimous 59/58/58) but no component exists. This story ships the **shell**: the resumable 9-step spine, the left-rail stepper, the context rail, the **Studio admin tab**, and the draft-state store — the surface every other Studio story mounts into.

## Story

As a **steward**,
I want **a resumable OKF Studio wizard that walks me from source selection through publish**,
So that **I can author an OKF repository from any source in one guided flow**.

## Acceptance Criteria

1. **`OkfStudioWizard.vue` (NEW, `components/gov-chat-frontend/src/components/okf/`)** — the shell:
   - Persistent **left-rail stepper** of the 9 steps (Entry → Choose workflow → Input → Produce → Label → Curate → Validate → Auto-correct → Review → Publish); back-nav non-destructive; future steps lock until the preceding gate (e.g. Produce) runs.
   - **Main canvas** renders the active step's panel; a slim **context rail** shows repo identity, `unverified` trust badge, concept count, and (per the 2026-08-18 amendment §8.1) `Cloned from <source> · version <vN>` when the repo has `cloned_from`.
   - **Step 0 — Entry/metadata**: `OkfRepositoryDialog` inline (name + domain picker via `serviceTreeService.getAdminCategories()`); `repository-service.create` mints `repo_id` + `graph_name=OKF_{repo_id}`.
   - **Step 1 — Choose workflow**: 4 DS cards — **Crawl / Documents / Clone / Manual** (the 2026-08-18 amendment added Clone; Manual retains the Domain-Template/blank choice); switching is free before Produce; only Step 2's renderer changes.
2. **Draft-state store (additive)**: `okf_studio_drafts` collection (Decision §5.4 — keyed by `repo_id`, holding `studio_step`/`studio_state` + per-step curation view-state) + `okf_repositories.studio_step` denormalized pointer; a `studio-service` client (`src/services/studioService.js`) wraps the CRUD (the 10.5 service is the server side — this story's client is additive and consumed by 10.5).
3. **Studio admin tab**: a `DsTabs` tab in `AdminDashboard.vue` (the existing `DsTabs` pattern) hosting the wizard + a link into the dashboard (3.5); resumable — re-opening a draft returns to its saved step (`{silent:true}` load pattern, no error spam).
4. **Standards**: DS primitives only, Options API, Vuex `okf` module, `httpService`; `okf.studio.*` i18n keys across all active locales; components Jest-tested (mount + step lock/resume + source-card switching + clone badge).
5. **Smoke/ATDD**: a frontend Jest suite asserting the stepper state machine (lock/resume), the 4 source cards, and the `cloned_from` badge; the LIVE end-to-end is the dual-facility smoke's authorship phase (clone → wizard mounts at Curate).

## Tasks

- [ ] T1 `OkfStudioWizard.vue` shell (stepper + canvas + context rail; Steps 0/1) + tests
- [ ] T2 `studioService.js` + `okf_studio_drafts` collection (additive db + collections)
- [ ] T3 Studio tab in AdminDashboard (DsTabs) + resume-on-open
- [ ] T4 i18n (`okf.studio.*`) + Jest + lint/format; close-out

## Dev Notes

- **Anchors (verified 2026-08-18):** `AdminDashboard.vue` (the DsTabs host — the tab registry), `serviceTreeService.js` (`getAdminCategories`), `components/ds/` (DS primitives), Options API + Vuex `okf` module conventions. No `okf/` component dir yet — create it.
- **The 2026-08-18 Clone amendment (§8.1):** Step 1 is FOUR cards; Clone's Step 2 is the source selector; a cloned repo SKIPS Produce and opens at Step 5 Curate. This story wires the shell so 3.9's action can jump to a step.
- **Draft store is additive** (R5): `okf_repositories` gains a `studio_step` pointer; `okf_studio_drafts` is a new collection (ensure-on-boot additive like `okf_versions`).
- **Composition rule (Studio §3):** this shell only IMPORTS/mounts step panels owned by their epics (3.6 doc entry, 3.7 crawl entry, 3.8 curator/validation, 3.9 clone, 4.2 editor) — no duplicated logic.
- **Existing UI paradigms (memory):** reuse admin-dashboard patterns — zero UI inconsistencies; i18n via `translate('key.path', 'default')`.

## Scope boundary (do NOT build)

The step PANELS (input/produce/label/curate/validate/auto-correct/review/publish renderers) — they are 3.6/3.7/3.8/3.9/4.2/10.6 · the diff panel (10.1) · `auto-correct-service` (10.2) · Domain Templates (10.3) · Cross-repo inbox (10.4) · the server-side `studio-service` aggregation (10.5).

## References

[Studio UX design §1.1/§1.4/§8.1](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) · PRD FR-38/FR-26 · memory `feedback_existing-ui-paradigms` · Decision §5.4 (drafts store).
