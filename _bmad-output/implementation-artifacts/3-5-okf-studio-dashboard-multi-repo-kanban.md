---
baseline_commit: 14205ae
---
# Story 3.5: OKF Studio dashboard + multi-repo kanban

Status: ready-for-dev

Story key: `3-5-okf-studio-dashboard-multi-repo-kanban` | GitLab: #967
Epic: 3 (Admin UI) / **Epic 10** (OKF Studio capstone) | Branch: `feat/okf-server`
FRs: FR-26, FR-25 | Spec: [okf-studio-ux-design-2026-08-13](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) §1.4, §10.5

> **The gap:** the Studio has no overview surface — a steward cannot see every OKF repo and its stage at a glance, resume drafts, or drive bulk actions. This story ships `OkfStudioDashboard.vue`: the multi-repo pipeline/kanban of ALL OKF repos by stage, resumable drafts, per-domain shared-label decisions, and bulk publish (each repo still passes its own gates).

## Story

As a **steward**,
I want **a Studio dashboard showing every OKF repository by stage, with resume + bulk actions**,
So that **I can manage the whole OKF estate at a glance, not repo-by-repo**.

## Acceptance Criteria

1. **`OkfStudioDashboard.vue` (NEW, `components/gov-chat-frontend/src/components/okf/`)** — a pipeline/kanban of every OKF repo by lifecycle stage (**Draft / In-review / Published**), each card showing `name`, `domain`, `concept-count`, `trust` badge (`unverified` until publish), and a **health ring** (conformance slice live via `getRepoMetrics` — blank-stubbed until 2.9.8 provides `okf_sources` if the metric is unavailable, per the 3.2 convention).
   - **Click a card → resume** the repo's draft at its saved `studio_step` (the 3.4 draft store); published repos open the details view (3.2).
2. **Bulk actions**: **bulk publish** (each repo STILL passes its own gates — conformance + PII + review; a failing repo is skipped with a reason, never silently force-published), and a **Cross-repo Auto-Correct Inbox** link (gated: only wired when 10.4 + 6.1b land — the entry is hidden/disabled before that, per Studio §6).
3. **Per-domain shared-label decisions** surface (Decision §5.6): a steward can apply ONE approved label proposal across a domain (ACL-filtered by 6.1b's Authz Resolver — gated); the coverage projection is cached (`okf_label_proposals`) and invalidated on hierarchy change.
4. **Composition**: the dashboard imports 3.4's wizard (new draft), 3.2's details, 3.8's curator panel — no duplicated logic (Studio §3 anti-scope-creep). DS primitives, Options API, Vuex `okf` module, `httpService`; i18n `okf.studio.*`.
5. **Tests**: Jest mount + stage-grouping + resume routing + bulk-publish skip-with-reason (the gate semantics) + inbox-link gating (hidden pre-10.4/6.1b).

## Tasks

- [ ] T1 `OkfStudioDashboard.vue` (kanban by stage, cards, health ring) + tests
- [ ] T2 Resume routing (card → 3.4 draft step / 3.2 details) + published-open
- [ ] T3 Bulk publish (per-repo gate semantics, skip-with-reason) + tests
- [ ] T4 Shared-label-decision surface (gated on 6.1b) + inbox-link gating
- [ ] T5 i18n + Jest + lint/format; close-out (sprint/#966/push)

## Dev Notes

- **Anchors (verified 2026-08-18):** the Studio tab host (`AdminDashboard.vue` DsTabs registry), `components/ds/` (DS primitives — the kanban/cards use `DsCard`/`DsTag`/`DsProgress` conventions), `serviceTreeService.js`, Vuex `okf` module conventions. No `okf/` component dir yet — create it (shared with 3.4/3.8).
- **Gates are REAL, not decorative** (R4/R6): bulk publish must call the SAME transition endpoints (ADR-okf-030) per repo and surface per-repo failures. The health ring uses `getRepoMetrics` (conformance-service) — it is a live metric, never a mock.
- **Gated features (Studio §6):** the Cross-repo Inbox + shared-label decisions are blocked on 6.1b (Authz Resolver) — wire the ENTRY as hidden/disabled now; activate in 10.4/6.1b. Do not fake the ACL.
- **Existing UI paradigms (memory):** tabs/dialogs/stepper/httpService/DS/Options API — zero inconsistencies; i18n `translate('key.path', 'default')`.
- **Previous-story intelligence:** the 2.9.x backend is live (repos CRUD, conformance metrics, lifecycle, versions) — the dashboard reads REAL endpoints; the smoke's named-repo association (bundle → repo → graph) is the data model the cards render.

## Scope boundary (do NOT build)

The wizard shell (3.4) · the diff panel (10.1) · `auto-correct-service` (10.2) · Domain Templates (10.3) · the Cross-repo Inbox itself (10.4) · the server-side `studio-service` aggregation (10.5 — this story's client is additive) · the review/publish step UI (10.6).

## References

[Studio UX design §1.4/§10.5](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) · PRD FR-26/FR-25 · ADR-okf-030 (lifecycle) · memory `feedback_existing-ui-paradigms` · Decision §5.6 (shared-label cost/cache).
