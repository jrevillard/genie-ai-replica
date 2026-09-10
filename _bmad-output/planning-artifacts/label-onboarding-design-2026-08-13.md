# OKF Label Onboarding — Design (Epic 9)

**Date:** 2026-08-13 · **Branch:** `feat/okf-server` · **Status:** Approved (2026-08-13) — Wizard UX; service-categories canonical + one-way-sync; capture Epic 9.
**Method:** BMAD design workflow — 4 parallel UX/architecture approaches, scored by 3 independent judges, synthesized into one recommended design. Each approach was grounded in the real code (the dataprep labeler, `serviceTreeService`, FR-32, the orchestrator contract).
**Decisions (user-confirmed 2026-08-13):** primary UX = **Progressive Wizard** (non-expert curator); two-store = **service-categories canonical + one-way-sync** to the document-repository labels collection; capture as **new Epic 9**; fires as a **pre-ingest dry-run**.

---

## 1. Problem & Principle

When a new OKF repository is about to be ingested, its concepts need labels (for retrieval + ACL). Some already exist in the service-category **Knowledge Hierarchy**; some are genuinely new and needed for this domain. The constraint (the user's directive, 2026-08-13): the hierarchy must stay a **curated, bounded, steward-gated tree** — *"not an unlimited tree of every fucking imaginable word."* So we need a **slick, curator-driven way to add exactly the right new labels** — bounded, never exhaustive — before the repo is indexed.

The labeler prompt already forbids free-form suggestion (`LABEL_SELECTOR_SYSTEM_PROMPT`: *"Do NOT suggest new labels. Use ONLY exact strings from the list."*, genieai_dataprep_arangodb.py:138-139), and hierarchy additions are steward-gated (FR-32). **Label onboarding** is the deliberate, bounded mechanism that lets the hierarchy grow *the right way*.

## 2. Recommended Design — Progressive Label-Onboarding Wizard (refined)

A pre-ingest dry-run wizard that fires **only on under-labeled chunks** of a repo's staged concept corpus, clusters/merges/denylists the genuine gaps, and walks a steward through **Analyze → Cluster → Review → Apply** with smart-default traffic lights and a live before/after coverage preview.

### 2.1 Data flow (PRE-INGEST DRY-RUN → REVIEW → APPLY → INGEST)
1. Steward opens `OkfRepositoryDetails` for a repo in lifecycle `register`/`validate` (concepts staged, NOT yet ingested) → clicks **"Analyze labels"**.
2. `POST /api/okf/repos/:repo_id/label-gap/analyze` (`requireRole('tools-admin')`) → `label-onboarding-service.analyze(repo_id)`: fetches the staged concept corpus; fetches the **current taxonomy via the labeler's own path** — `_fetch_all_labels` logic (genieai_dataprep_arangodb.py:355-396 → `GET /api/service-categories/categories`, the `{name,children}` shape) — **NOT** `serviceTreeService.getAdminCategories()` (`/categories/detailed`).
3. Calls a **new dataprep endpoint** `POST /v1/dataprep/label_gap`: a gap-mode that runs the **same** `_label_with_llm` taxonomy-only pass (:467) + canonicalization (`_finalize_chunk_labels` :1051-1083), then — **for chunks that resolved <2 taxonomy labels** (the under-labeled trigger) — a second gap-proposal pass that captures the `new_labels` (:1067/:1083 — today discarded as a WARN at :1100-1102) **with per-chunk provenance**; then **short-circuits before `_process_batch`** (:1156) — no embed, no index, no SOURCE writes. Also runs a **layer-2 embedding-cosine near-dup merge** (reusing `_label_with_embedding.embed_documents` :1111) to collapse true synonyms (maize/corn). Returns `{gap_candidates:[{label, variants, frequency, sample_chunk_ids, confidence, nearest_existing, cos_to_nearest}], coverage_stats}`.
4. `label-onboarding-service.buildProposal` post-processes: dedup, apply the **shared `canonicalize_label()`** (extracted from :1074-1080), apply per-domain denylist, attach `suggested_parent` via embedding similarity, bucket confidence/frequency, enforce the **FAIL-not-truncate hard cap**; persists an **immutable proposal document** (`status=open`) in **new `okf_label_proposals`** collection — the diff + per-line decisions + actor + timestamp IS the audit record; returns `proposal_id`.
5. Steward reviews in `OkfLabelOnboardingWizard` (smart defaults applied + live before/after preview).
6. **Apply & Ingest** → `POST .../label-gap/apply {proposal_id, decisions}`: each approved ADD calls the **existing service-category CRUD** (`serviceTreeService.createCategory` :134 / `createService` :168) + **one-way-syncs** to the document-repository labels collection (ADR-okf-034); the **orchestrator** stamps the repo's `file_labels` with `t:/r:/d:` ACL prefixes (FR-34 / ADR-okf-021 — the wizard **never** injects ACLs); proposal flips `status=applied`.
7. The real ingest proceeds via `POST /api/okf/repos/:repo_id/ingest` → `_fetch_all_labels` now returns the enriched taxonomy → `_finalize_chunk_labels` resolves the previously-new labels cleanly (the `new_labels` WARN is empty). Labels exist before the first embed — first-embed correctness, no re-embed cost.

### 2.2 UI (Vue 3, Options API, per project-context)
New `OkfLabelOnboardingWizard.vue`, launched from `OkfRepositoryDetails` (Epic 3) inside the AdminDashboard OKF tab. Four steps + persistent right-hand preview pane:
- **ANALYZE** — summary card + ECharts coverage donut + `{silent:true}` poll.
- **CLUSTER** — candidates grouped by merge-cluster; smart-default traffic lights (green auto-accept / grey auto-reject / amber needs-review); per-candidate **provenance card** (the concept_id + chunk snippet that triggered it) + **"Never suggest again"** → per-domain denylist.
- **REVIEW** — placement picker (lazy tree from `getAdminCategories`, used **only** for placement) + **ghost nodes** (pending proposals rendered in-place on the live hierarchy tree with a confidence ring) + **"Ask why"** popover on amber items only (function-call-grounded, no chat/SSE) + the **live before/after preview pane** (sample chunks `[no match]` → `[Irrigation Scheduling, Drip Irrigation]` + coverage delta, pinned to the shared canonicalize).
- **APPLY** — diff summary + growth-budget meter + shareable `?proposal=<id>` URL + confirm.

### 2.3 Backend (new)
- **okf-server (Node):** `services/label-onboarding-service.js` + `routes/label-onboarding-routes.js` (under `/api/okf/repos/:repo_id/label-gap`: `/analyze`, `/proposals/:id`, `/preview`, `/apply` — all `requireRole('tools-admin')`); new `okf_label_proposals` collection (the immutable proposal-as-audit-record) + per-domain learned `okf_label_denylist` store. Mirrors `repository-service.js` (withSpan + audit-service + shared db-connection-service + MELT counter).
- **dataprep (additive Python):** `_label_gap_analysis(concepts, all_labels, domain, file_id)` — sibling of `_label_with_llm`; the **shared `canonicalize_label()`** lifted from :1074-1080 used by BOTH paths; exposed via `POST /v1/dataprep/label_gap`.

### 2.4 Boundedness — 9 mechanisms (failure mode = "too conservative", never "every word")
1. **Gap-only input** — candidates come only from the gap-mode; `LABEL_SELECTOR` stays taxonomy-only. 2. **Under-labeled trigger** — gap pass runs only on chunks resolving <2 taxonomy labels (strict subset of the raw `new_labels` branch). 3. **Existing-match suppression** via the shared `canonicalize_label()` (exact/case/plural). 4. **Layer-2 embedding-cosine variant merge** (cos ≥ 0.92) — collapses true synonyms. 5. **Frequency floor** (≥2 chunks). 6. **Confidence threshold** (~0.7). 7. **Learned per-domain denylist** (stop-list seed + every reject/snooze appended). 8. **Hard cap that FAILS** (`OKF_LABEL_GAP_MAX_ADDITIONS` ~25 — "narrow scope or raise threshold", not silent truncation). 9. **FR-32 steward gate** — no taxonomy write without explicit per-line Approve + final Apply.

### 2.5 Integration
- **Epic 3** (admin UI): the wizard + `okfLabelGapService.js` + Vuex `okf.proposals`.
- **Epic 7** (producer): producer proposals (Story 7.3) feed into the **same** `okf_label_proposals` collection + **same** wizard (`source='producer'` badge) — unifies producer-draft and pre-ingest-gap review into one steward gate.
- **FR-34 / ADR-okf-021:** the orchestrator remains the sole `t:/r:/d:` ACL injector — Apply populates `file_labels`, the orchestrator stamps prefixes.
- **Graph Router (FR-35):** newly-added labels become concept tags/type + repo domain (the selection signals) — onboarding directly improves multi-repo selection precision.
- **Two-store (ADR-okf-034):** service-categories canonical + one-way-sync on Apply.

## 3. Epic 9 — Stories
- **9.1** Gap-mode labeler + shared `canonicalize_label` + embedding variant merge [dataprep] + the contract test (gap-resolved == ingest-resolved).
- **9.2** Label-onboarding service + proposal API + `okf_label_proposals` collection + denylist store [okf-server].
- **9.3** `OkfLabelOnboardingWizard` UI (Analyze → Cluster → Review → Apply) [Epic 3 frontend; depends on Epic 3 OKF dialogs].
- **9.4** Apply → ingest wiring + two-store one-way-sync + producer unification (co-develops with Story 7.3).
- **9.5** Boundedness config + denylist management + golden-fixture tuning + SM-7 launch guardrail (gated by Story 8.1).

## 4. Decisions resolved (2026-08-13)
- **Primary UX:** Wizard (non-expert curator) — the live before/after preview is the slick core.
- **Two-store:** service-categories canonical + one-way-sync (ADR-okf-034).
- **Embedding-cosine merge:** ship in v1 as a steward-confirmable **amber merge line** (not silent); calibrate 0.92 against Story 8.1 fixtures (Story 9.5).
- **Bump gating:** two-phase — the **analyze/apply** legs are ungated (additive Python gap-mode, no `graph_name` wiring, short-circuits before graph insert); the **ingest** leg is bump-gated where per-repo graphs (Story 2.9.6) are involved.
- **Denylist scope:** per-domain (avoids cross-tenant leakage).
- **Dry-run stop point:** Analyze operates on parsed concepts in `okf_concepts_meta` (after the orchestrator's parse step) — depends on Story 2.9.1 (`ingest-service.js`, not yet built).

## 5. Open questions (to confirm at story creation)
- **Persona validation:** Wizard assumed; confirm OKF stewards are non-expert curators (vs technical — the Diff-Review aesthetic is the fallback).
- **Double-labeling GPU cost:** the dry-run is a second labeling pass (~doubles labeling cost for OKF repos). Acceptable for OKF's curated cadence; v1.1 may cache per-chunk gap suggestions and pass them to ingest to skip the second pass.
- **Embedding tolerance calibration:** 0.92 may over-merge distinct concepts (e.g. "Cats" musical vs "Cat" animal) — the amber merge line + Story 9.5 fixture tuning covers it.

## 6. Risks
- **Review-vs-ingest drift (highest):** mitigated by the ONE shared `canonicalize_label()` + the contract test (Story 9.1).
- **Projection drift:** the before/after preview is client-side — pinned to the shared canonicalize + exact `file_labels` scoping (covered by the same contract test).
- **Rubber-stamping / prompt injection (SM-7):** conservative defaults + "Accept all auto" never auto-applies producer-sourced/sub-threshold candidates without per-line confirm + the rejection-rate launch guardrail (Story 9.5).
- **Depends on Story 2.9.1** (`ingest-service.js`) for the dry-run orchestration.

## 7. References
- [ADR-okf-033](../../docs/adr/okf-033-label-onboarding.md) · [ADR-okf-034](../../docs/adr/okf-034-knowledge-hierarchy-canonical-store.md)
- Code: [genieai_dataprep_arangodb.py:130-153] (labeler prompt) · [:355-396] (`_fetch_all_labels`) · [:467] (`_label_with_llm`) · [:1051-1104] (`_finalize_chunk_labels` + `new_labels`) · [:1106-1133] (embedding/bm25) · [:1111] (`embed_documents`) · [components/gov-chat-frontend/.../serviceTreeService.js:30,134,168]
- PRD: FR-32 (steward-gated hierarchy), FR-34/FR-35, glossary "Knowledge Hierarchy"; epics.md Story 7.3; ADR-okf-021/024.
- Memory: `feedback_bounded-knowledge-hierarchy.md` (the principle).
