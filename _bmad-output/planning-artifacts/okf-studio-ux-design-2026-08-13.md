# OKF Studio — Creation & Curation UX Design (Epic 10)

**Date:** 2026-08-13 · **Branch:** `feat/okf-server` · **Status:** Recommended (unanimous, 3 judges 59/58/58) — for sign-off.
**Method:** BMAD design workflow — 4 parallel UX approaches (guided wizard · workspace/studio · pipeline+inline · template+bulk), scored by 3 independent judges, synthesized. Every citation verified against the real code.
**Constraint (user, 2026-08-13):** reuse the **existing admin-dashboard paradigms** (tabs/dialogs/stepper/httpService/DS primitives/Options API) — **zero UI inconsistencies**. The winner satisfies this by construction (no canvas, no SSE, no novel navigation).

---

## 1. The Design — OKF Studio Guided Linear Wizard

A single **resumable linear wizard** where **Crawler, Documents, and Manual** creation paths are **variants of one spine**, not three surfaces. Every workflow funnels into the same curation → validation → auto-correct → review → publish. A new **"OKF Studio" admin tab** (`AdminDashboard.vue:172` via `DsTabs`) hosts the multi-repo dashboard + resumable drafts + bulk operations.

### 1.1 The wizard spine (9 steps)
`OkfStudioWizard.vue` shell: persistent left-rail stepper + main canvas + slim context rail (repo identity, `unverified` trust badge, concept count, coverage meter). State = a resumable draft (`okf_repositories` lifecycle `register`/`validate` + `studio_step`/`studio_state` + `okf_studio_drafts`). Back-nav is non-destructive; future steps lock until Produce runs.

- **Step 0 — Entry/metadata:** `OkfRepositoryDialog` inline — name + domain picker (`serviceTreeService.getAdminCategories`); `repository-service.create` mints `repo_id` + reserves `graph_name=OKF_{repo_id}`.
- **Step 1 — Choose workflow:** 3 DS cards (Crawl / Documents / Manual); switching is free before Produce; only Step 2's renderer changes.
- **Step 2 — Input (variant):** Crawl → multi-URL seed list (reuses `AddFromLinkDialog` SITE_PRESETS) + model tier; Documents → doc picker (`documentFileService.getFiles`, filtered to not-yet-OKF'd) + dropzone (existing ClamAV + text-extract); Manual → **Domain Template** gallery (graft) or blank.
- **Step 3 — Produce:** polls the producer job (`{silent:true}`); Crawl → `produce-from-crawl` (7.2), Documents → `produce-from-documents` (7.7); **Regenerate-with-impact-preview** (graft) shows what would change before commit. Drafts stage at `review`, server-enforced `unverified`.
- **Step 4 — Label Onboard:** `OkfLabelOnboardingWizard` (Epic 9/9.3) **embedded inline** (compact panel, not a modal) — the bounded gap-review + live before/after preview.
- **Step 5 — Curate:** concept tree + inline `OkfConceptEditor` (FR-25); edits re-parse → incremental re-index.
- **Step 6 — Validate:** `OkfValidationPanel` runs the **existing** `conformanceService.validateConcept` (conformance-service.js:47) + `getRepoMetrics` (L146); issues grouped by the 5 implemented codes; PII is a publish gate, not here.
- **Step 7 — Auto-Correct (the slick core):** `OkfDiffReviewPanel` — see §1.2.
- **Step 8 — Review:** summary + steward sign-off (tools-admin); reject → Curate with reason.
- **Step 9 — Publish:** lifecycle `review → approve → publish` (ADR-okf-030), PII-gated (2.8), `mintVersion()` (2.9.7); lands on the Studio dashboard.

### 1.2 OkfDiffReviewPanel — ONE unified reviewable-diff surface (the load-bearing piece)
A single reusable component, 3 lanes (Conformance fixes / Label mappings / Broken links). Each proposed change = a card {kind, severity, confidence, before→after red/green diff, rationale, source-provenance} with per-line Accept/Reject + lane-level "Auto-correct all" (pre-fills traffic-light defaults). Sticky "Apply N approved" disabled while amber items are unreviewed; growth-budget meter for the label cap. **The Apply click IS the FR-32 steward gate** (audit row + actor + timestamp; never silent mutation). Shareable `?proposal=<id>` URL.
- **Conformance remediation** (`auto-correct-service`): MISSING_TYPE→infer from H1; INVALID_STATUS_ENUM→clamp `draft`; BAD_ACTOR_PREFIX→prefix `agent:`/`human:`; UNPARSEABLE_STALE_AFTER→Luxon normalize; SOURCE_MISSING_RESOURCE→fill from producer source. (Works today — conformance-service exists.)
- **Label auto-mapping** (Epic 9 engine): gap-mode + shared `canonicalize_label` + embedding-cosine variant merge + denylist + cap. Bounded by construction (9 mechanisms). Producer proposals (7.3) appear with `source='producer'` badge — one label gate.
- **Broken-link resolution** (`auto-correct-service`): nearest-match via embedding, or drop. **Blocked** until Story 2.3b (link-existence signal; today parser emits links with no existence check, `getRepoMetrics` hardcodes `broken_link_count:0`).

### 1.3 Entry points (all 3 converge on Step 0/1)
- **(a) Document-management multi-select:** in `AdminDashboard.vue`'s document table (checkboxes `selectedDocuments` L517, `handleBatchAction('ingest')` L2957) — add a **sibling** "Create OKF repository" batch action (`showCreateOkfButton` mirroring `showIngestButton`); opens the wizard with file_ids pre-loaded on Documents. "Ingest Selected" (free-form) stays unchanged.
- **(b) Crawler UI:** extend `AddFromLinkDialog` (SITE_PRESETS L180) with a segmented "Create OKF repository" target + `FileDetailsDialog` "Create OKF from crawl" companion (visible when `crawlJob.status==='Succeeded'`). Crawl-to-corpus default unchanged.
- **(c) Manual editor:** `OkfConceptEditor` (FR-25) reachable from the wizard's Manual workflow + standalone from `OkfRepositoryDetails`.

### 1.4 Multi-repo (the "OKF Studio" tab)
`OkfStudioDashboard.vue` — pipeline/kanban of all OKF repos by stage (Draft/In-review/Published), cards with name/domain/concept-count/trust/health ring (conformance slice live via `getRepoMetrics`). Click → resume the draft at its saved step. Plus: **resumable drafts**, **per-domain shared label decisions** (one approval applies domain-wide, ACL-filtered by 6.1b), **Domain Templates** ("New from template"), **Cross-repo Auto-Correct Inbox** (graft — opt-in "all my repos" triage, GREEN-only "Accept all safe" under SM-7, ACL-filtered), **bulk publish** (each repo still passes its own gates).

### 1.5 No regression (existing single-doc flow stays + benefits)
The existing upload → ClamAV → text-extract → ingest-into-free-form-corpus is untouched; all OKF entry points are **additive sibling actions** (never replace/alias ingest). The free-form path **benefits** additively: the label-onboarding engine, conformance, and auto-correct services are source-agnostic; a future "Analyze labels"/"Validate & auto-correct" action on free-form docs reuses the identical `OkfDiffReviewPanel` + services.

## 2. Composition (every citation verified)
**Epic 7** (producer, ADR-okf-019 — `producer-service.js` not yet built): Steps 3 produce (7.2 crawl / 7.7 documents), 7.6 multi-seed, 7.4b post-crawl trigger (NEW — `crawlWorker.js:264-296` has no `config.okf` read today), 7.8 regenerate-preview, 7.5 eval/guardrail. **Epic 9** (label onboarding): Step 4 = 9.3 inline, Step 7-label = 9.2; producer proposals (7.3) unified. **Story 2.4** (conformance, DONE): Steps 6 + 7-conformance call `conformance-service.js` (L47/126/146) — works today. **FR-25 editor** (Story 4.2): Step 5. **Document-repository + crawler**: reused (ClamAV, text-extract, SITE_PRESETS, `scheduleSiteCrawl`). **Lifecycle** (Epic 4): Steps 8/9. **NEW Epic 10** (capstone): the wizard shell, diff panel, auto-correct service, templates, cross-repo inbox, studio orchestration.

## 3. Epic 10 — OKF Studio (capstone) stories
- **10.1** `OkfDiffReviewPanel` (the unified 3-lane reviewable-diff surface — the load-bearing FR-32 component).
- **10.2** `auto-correct-service` (conformance remediation + broken-link resolution proposal engines).
- **10.3** Domain Templates (conformance-clean-by-construction + Save-as-template + reconcile-on-apply).
- **10.4** Cross-repo Auto-Correct Inbox (aggregation, ACL-filtered by 6.1b).
- **10.5** `studio-service` (draft state CRUD, per-domain shared label decisions, bulk publish, aggregation) + the Studio dashboard (`OkfStudioDashboard`).
- **10.6** Step 8 Review + Step 9 Publish lifecycle UI.
- Plus Epic 3 frontend: 3.1 wizard shell + stepper + Studio tab; 3.2 Studio dashboard; 3.3 document-mgmt entry point; 3.4 crawler entry point; 3.5 curator + validation panel.
- Dependencies (gating): **2.3b** broken-link detection (blocks the link lane + health ring); **2.8** PII publish gate; **2.9.1** orchestrator (blocks Step 4 label dry-run).

## 4. Decisions resolved (2026-08-13)
- **Primary UX:** Guided Linear Wizard (unanimous; satisfies FR-38's "one wizard, 3 workflows" + the zero-inconsistencies constraint).
- **Grafts kept:** OkfDiffReviewPanel (winner's core), Domain Templates, Regenerate-with-impact-preview, Cross-repo Auto-Correct Inbox.
- **Bulk-partition ("50 PDFs → N repos") deferred to v1.1** — single-repo-per-run + Domain Templates covers "multiple repos easily" in v1.
- **Studio only IMPORTS/mounts** Epic 3/4/9 components; their logic stays owned by their epics (anti-scope-creep rule, enforced at review).

## 5. Open questions (to confirm at sign-off / story creation)
1. **Persona** (the decisive assumption): Wizard-first bets on non-expert stewards. If real stewards are technical, promote the Cross-repo Inbox + diff-everywhere ("power mode") sooner. Validate before Step 7 ships.
2. **"Document not yet in an OKF repo" signal** for the `showCreateOkfButton` gate — no existing OKF-membership field; needs a new lookup (e.g. `okf_concepts_meta.sources` join or `okf_repositories.source` ref).
3. **Taxonomy endpoint:** confirm gap-analysis uses the labeler's `/api/service-categories/categories` path (not `/categories/detailed`, which is placement-only) — don't conflate.
4. **Drafts store:** separate `okf_studio_drafts` collection vs `studio_step`/`studio_state` fields on `okf_repositories` (affects retention + concurrent-edit semantics).
5. **Producer-vs-autocorrect label gate semantics** — identical, or producer proposals stricter (always amber)?
6. **Cross-repo shared-label-decision cost** — per-repo coverage re-run (N model calls) vs cached.
7. **mintVersion (2.9.7) + review→approve→publish state machine (ADR-okf-030)** — fully specified, or co-designed at Step 8/9?

## 6. Risks (top)
- **Persona mismatch** (highest) — mitigated by the grafted "power mode" (diff panel + inbox) that can be promoted without re-architecture.
- **Capstone dependency chain** — full spine needs producer (7.x) + label-onboarding (9.x) + editor (4.2) + orchestrator (2.9.1). **Ship incrementally**: Manual+Validate+conformance-auto-correct work TODAY (conformance-service exists); add Crawl/Documents as Epic 7 lands; add Label as Epic 9 + 2.9.1 land.
- **Broken-link lane blocked** on Story 2.3b; **cross-tenant leakage** in the inbox/shared-decisions blocked on Story 6.1b (Authz Resolver) — do not wire those gates/health-rings before then.
- **Rubber-stamping / prompt injection** — gated by FR-32 + unverified cap + reviewable diffs (never silent) + SM-7 guardrail (7.5/9.5). If 7.5/9.5 slip, the producer stays disabled in production.

## 7. References
- Code: `AdminDashboard.vue:172,454-538,517,1844,2957` · `AddFromLinkDialog.vue:180,393,438` · `FileDetailsDialog.vue:568,586,1125` · `serviceTreeService.js:30,134,168` · `documentFileService.js:16,180` · `conformance-service.js:47,126,146,160-161` · `repository-service.js:28,111,132,142` · `crawlWorker.js:211,252,264-296` · `parser-service.js:109-110`.
- Planning: [label-onboarding-design-2026-08-13](label-onboarding-design-2026-08-13.md) · [okf-course-correction-2026-08-13](okf-course-correction-2026-08-13.md) · PRD FR-25/FR-32/FR-36/FR-37/FR-38 · ADR-okf-019/020/030/033/034.
- Memory: `feedback_existing-ui-paradigms` (zero inconsistencies) · `feedback_bounded-knowledge-hierarchy` · `feedback_story-whole-initiative-detail`.
