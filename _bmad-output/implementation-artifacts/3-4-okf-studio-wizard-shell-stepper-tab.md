---
baseline_commit: 14205ae
---
# Story 3.4: OKF Studio wizard shell + stepper + Studio tab

Status: in-progress — Amendment A (2026-09-27, below) is the READY-FOR-DEV vehicle: wizard completion & editor parity. Decisions locked with David 2026-09-27: amend-3.4+consolidate packaging; wizard is the DEFAULT repo surface; full editor parity incl. PII remediation in friendlier form; automation-first; KH-only labels.

Story key: `3-4-okf-studio-wizard-shell-stepper-tab` | GitLab: #966
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

---

## AMENDMENT A (2026-09-27) — Wizard completion & editor parity

> David's directives, 2026-09-26/27 (deep-dive found the shell live but the ACs unmet —
> steps never write back, Continue bypasses gates, resume NOT_READY, Input/Produce
> placeholders, context rail reads phantom shapes; full findings in the 2026-09-27
> session recap). This amendment is THE vehicle for finishing the wizard.

### Directive ledger (each is an acceptance criterion)

1. The wizard must be **idempotent** — every step re-entrant with its selections
   restored; no duplicate side-effects on re-advance (R-C/R-D store rules already
   tested; step-level write-back is the missing half).
2. The wizard must handle **BOTH existing-repo modification AND new-repo building**.
3. **Labels selectable in the wizard must come from the Knowledge Hierarchy** —
   KH L2 bounded to the repo's Subject Area (KH L1). No free-text label entry.
4. **Existing repo**: ALL files, frontmatter and metadata must be **displayed and
   editable** in the wizard.
5. **New repo**: the user must be able to **add files from the file system** and/or
   **create them in a markdown editor**.
6. **ALL features of the OKF repository editor must be available in the wizard, in
   a friendlier form for less experienced users** (feature parity, friendlier
   presentation — basic-mode defaults, plain language, progressive disclosure).
   6a. Explicit instance (2026-09-27): **PII scanning + the editing surface
   (redact, replace, remove, …) in the appropriate design form** — see B10.
7. **Routing**: the wizard is the DEFAULT surface when a steward opens a repo
   (dashboard card click); the editor shell's deep tooling is reachable from
   within the wizard (advanced disclosures), not as a competing first surface.

### Work items

**A. Shell contract (3.4 original ACs, finally real)**
- A1 Step→draft write-back: panels commit selections to the Vuex draft; advance
  persists; re-entry hydrates from the draft (idempotent per step).
- A2 Gate contract: each panel owns its Continue (canAdvance / completion rule);
  the footer Continue renders the ACTIVE step's gate — never a global bypass.
- A3 Create-in-Step-0: new-repo creation moves INTO Entry (create-on-advance,
  duplicate-name guard as in the StudioTab dialog, idempotent re-advance);
  existing-repo drafts hydrate from the real repo doc, not a synthesized stub.
- A4 Server-side resume: persist the draft server-side (10.5 `okf_studio_drafts`,
  or the cheap `okf_repositories.studio_step` pointer this story originally specced)
  so resume survives sessions; drop the R-D permanent-short-circuit once live.
- A5 Context rail: feed from the real repo doc (concept_count, trust_tier,
  source count, stale_after) — kill the phantom `provenance`/`lifecycle` shapes.

**B. Step panels (parity mapping — compose editor components, never duplicate)**
- B1 Step 2 Input (NEW mode): file-system multi-file picker (.md → concepts;
  other formats → the doc-repo import flow) + in-wizard markdown creation
  (reuse `DsOkfMarkdownEditor` / `AddConceptModal`); documents/crawl/clone
  variant panels mount the 3.6/3.7/3.9 flows.
- B2 Step 3 Produce: producer via Epic 7.2 with an idempotent job key
  (repo + content-hash — re-entering NEVER re-kicks a running job); wire the
  existing unused `fetchProducerJob`/`killProducerJob`; real progress.
- B3 Step 4 Label: KH L2 picker bounded to Subject Area via the existing
  `OkfLabelEditor`/KH machinery (Story 9.3's UI, composed here). Free-text
  adder REMOVED.
- B4 Step 5 Curate: full editing — concept list + body + FRONTMATTER +
  metadata via `ConceptEditor`-grade components (4.2 save path); today's
  local-mirror editor and the "full save ships with 4.2" deferral die here.
- B5 Step 6 Validate: live conformance-service call (3.8 completion) — real
  issue groups, real health score, expert raw-JSON toggle stays.
- B6 Step 7 Auto-correct: 10.2 service wired into the step.
- B7 Step 8 Review: lifecycle surfacing (submit → review → approve per role)
  + the 10.1 diff panel in its friendlier form.
- B8 Step 9 Publish: checklist from LIVE repo state (never the dead draft
  fields); R-C transition-validity stays.
- B9 Editor parity sweep: graph view (advanced disclosure in Curate), versions,
  logs, resplit, rename, ingest progress (BuildProgressCard) — every editor
  feature gets a wizard home per directive 6. An explicit parity checklist
  against `editor/` components is part of this story's review gate.
- B10 PII (David, 2026-09-27): the PII scanning AND editing surface —
  redact / replace / remove / accept — must exist in the wizard in the
  appropriate design form: scan results surface at Validate (repo-level
  health) with a guided remediation flow (friendlier form of
  `PiiOccurrences.vue` + the 2.8 scan backend), and per-concept PII
  occurrences surface inside Curate's editor. PII-completeness stays a
  publish gate — the wizard must make resolving it part of the guided flow,
  not a separate tool.
- B11 Automation-first (David, 2026-09-27): the wizard AUTOMATES everything
  the existing services can do — frontmatter, metadata and label generation
  included — and casts the steward as the REVIEWER, not the author.
  Verified service inventory (2026-09-27, okf-server/services/):
  `llm-curation-service` (classification heuristics|llm|hybrid → labels +
  metadata), `producer-service` (documents→concepts), `conformance-service`
  (validation + remediation), `pii-service` (scan + findings),
  `crawl-conversion-service`, plus the frontmatter machinery in the
  converter/exporter paths. Each step auto-runs its service on entry
  (idempotently — one run per content state), presents the proposal, and the
  steward accepts/adjusts. Any step whose automation is NOT covered by this
  inventory becomes an explicit backlog item (e.g. the 7.2 LLM producer for
  Produce), never a silent no-op.

**C. Routing**
- C1 Dashboard card click + open-existing → the wizard (mode by repo state);
  the editor shell remains reachable (advanced mode) — DsModeSwitch already
  in the StudioTab header.

### Owning-story map (sub-items reference, never fork logic)
shell/create/resume/routing → 3.4 (this amendment) · produce → 7.2/7.4 ·
KH labels → 9.3 · body/frontmatter save → 4.2 · live validation → 3.8 ·
autocorrect → 10.2 · diff/review/publish → 10.1/10.6 · server drafts → 10.5.

### Non-goals
No new backend endpoints beyond 10.5's drafts + existing services · no
re-styling of the editor components themselves (wrapping/presentation only) ·
no removal of the editor shell.

### Gap matrix — wizard vs editor parity (post-slice-1, 2026-09-27)

Editor inventory verified live: `RepoEditor` = three-pane (ConceptList with
add/resplit/delete/label/pii-bulk · ConceptEditor Source|Rendered with
debounced save + frontmatter bar · metadata panel with KH single-select
labels + type/title + status/trust) hosting Resplit + Autocorrect modals;
shell-level: RepoGraphView, VersionsDialog, LogsDialog, BuildProgressCard,
RenameRepoDialog, PiiOccurrences, ImportDocumentsDialog, AddConceptModal.

| Editor feature | Editor surface | Wizard state after slice 1 | Slice |
|---|---|---|---|
| Concept list + select/filter | ConceptList | Curate: flat tree + search only | **2 (B4)** |
| Concept body+fm editing w/ save | ConceptEditor (debounced save, fm bar, toolbar) | Curate: body-only LOCAL MIRROR, no save | **2 (B4)** |
| Metadata panel (type/title/KH label) | RepoEditor right pane | ABSENT (LabelOnboard free-text = wrong) | **2 (B4+B3)** |
| Add concept (md) | AddConceptModal | ABSENT | **2** |
| Delete concept | ConceptList @delete | ABSENT | **2** |
| Resplit / Autocorrect modals | hosted BY RepoEditor | ABSENT | **2 (rides B4)** |
| PII scan + remediation | PiiOccurrences + pii-bulk | ABSENT | **3 (B10)** |
| Live validation | conformance getRepoMetrics | Validate groups always empty | **3 (B5)** |
| Review lifecycle + diff | shell/dashboard transitions | Review step static; publish R-C works | **3 (B7/B8)** |
| Graph view / Versions / Logs / Build progress / Rename | shell-level dialogs+views | ABSENT | **3 (B9)** |
| Manual input (FS files + md create) | — (dialog only) | Input = declared placeholder | **4 (B1)** |
| Documents add-more in-wizard | ImportDocumentsDialog | 3.6 event opens Curate (works); no in-wizard add | **4 (B1)** |
| Crawl add-source in-wizard | AddFromLinkDialog | #977 opens Curate (works); no in-wizard add | **4 (B1)** |
| Produce (LLM topics) | — | placeholder; **7.2 LLM producer = the gap** | **4 (B2, gated)** |

**Creation paths today:** documents (ImportDocumentsDialog → convert → wizard
at Curate) and crawl (AddFromLinkDialog → convert → wizard at Curate) WORK
end-to-end for curation; manual creation stalls at the Input placeholder.
Doc-mgmt ↔ Studio alignment is largely delivered by 7.7 (entry points,
classification surface, provenance deep links); the residual gaps are all
wizard B-items above.

**Slice-2 key insight (equivalence move):** mount `OkfRepoEditor` INSIDE the
Curate step (same props the shell uses: repo-id / source-file-id / read-only)
— it carries the full three-pane editor, KH labels, add/delete/resplit/
autocorrect with zero duplication (composition rule). That single composition
closes B4+B3+most of B9 for existing repos. UX rule for the embedding
(David, laser focus): the editor appears in its FRIENDLIER form — Basic mode
hides raw source by default, the narrative card explains what curation is
and why it matters for RAG, the context rail keeps live counts, and no step
presents a dead end.

### ⓘ DsInfoTip coverage checklist (David, 2026-09-27: tips EVERYWHERE —

wizard + editor + document management — each explaining how the facet serves
RAG accuracy). Paradigm component: DsInfoTip (hover+focus). Each slice ships
its tips as part of acceptance; EN fallbacks OK, ×14 batch-inject at slice end.

| Surface | Facets needing ⓘ | Slice |
|---|---|---|
| Wizard Entry | Subject Area (✓ exists) + why it binds labels & retrieval scope | 2 |
| Wizard Choose | each of the 4 source cards — what it produces, what curation it needs | 2 |
| Wizard Curate (embedded editor) | concept list actions (add/delete/resplit/label/pii-bulk), metadata fields (type/KH label/status/trust), editor mode bar (Source vs Rendered), body-vs-frontmatter | **2** |
| Wizard Label/Validate/Autocorrect/Review/Publish | per-step what/why + gate meaning + what validation codes mean for retrieval | 3 |
| Editor (RepoEditor/ConceptList/ConceptEditor) | same facets as Curate (shared components — one pass serves both) | **2** |
| RepoGraphView / Versions / Logs | what the graph proves, what versions pin, what logs show | 3 |
| Doc-mgmt (FileDetailsDialog, ImportDocumentsDialog, table) | Create-OKF entry, classification choices (heuristics/llm/hybrid + RAG cost/quality), PII status, dataprep status meaning, OKF deep links | 4 |
| Crawler dialog (AddFromLinkDialog) | crawl scope, what gets converted, split implications | 4 |

RAG-accuracy copy pattern: "<facet> — what it is · what it changes in the
pipeline · what good looks like" (e.g. KH label: ties the topic to its service
category; retrieval fans out BY label — a wrong label hides the topic from the
questions it should answer).

### Dev-log — slice 1 LANDED (commit ca6d1bd4b, 2026-09-27)

A1–A5 + C1 done: step write-back via the update→update-draft→StudioTab event
chain (wizard never mutates a prop — vue/no-mutating-props clean); per-step
gate events drive the footer Continue; Entry's beforeAdvance creates the repo
(idempotent, DUPLICATE_REPO refuses the advance); studio_step resume pointer
PATCHes onto the repo doc (0-9|null validated, 400 otherwise; serving repos
READ-ONLY by design, pointer skipped frozen); context rail reads the REAL
repo doc; StudioTab opens repos on the WIZARD sub-tab by default. Remaining:
B1–B11 panels (B3 KH labels, B4 full edit, B10 PII, B11 automation wiring,
B2 produce last — 7.2 gap). Verified: frontend jest 1516/1516 (+15 new),
okf-server full suite green, localeConsistency 5/5 (keys ×14), ESLint/
Prettier clean, local build rebuilt + in-container markers verified
(studio_step ×4 backend, saveStudioStep in served bundle). David's UI pass
pending.
