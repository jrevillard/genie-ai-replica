# Auto-Curate Pass — Epic Spec (David, approved 2026-09-06)

**Goal (David's words):** curate the data in the OKF repo as much as possible in an
automated manner, saving the admin user time and effort in the editor. The steward
never opens a file unless judgment is genuinely required — **review by exception**.

**Boundary (unchanged):** automation proposes with diffs; only mechanical fixes
auto-apply (with audit); the Knowledge Hierarchy stays bounded (labels only from
services under the repo's Subject Area; new labels only via Label Onboarding /
FR-36's steward gate); publish stays content-gated; nothing ingests early.
LLM passes use the internal vLLM (ADR-020 sovereignty) batched under the import
lane discipline (conc + PII workers), never per-page requests.

## Architecture: Import → Auto-Curate Pass → Review-by-Exception

Runs automatically at import/conversion completion (crawl mode B finalize AND
zip import), server-side, on the draft repo. Produces:

1. **Applied changes** (mechanical, auto-applied, audited in `okf_audit`):
   - Conformance auto-fixes (existing autocorrect engine: missing titles/types,
     malformed dates) — reuse `services/autocorrect` logic, no new rules here.
   - Index/TOC reconcile: Contents list synced to actual concepts
     (append missing via the existing appendToIndexToc mechanism, remove stale).
   - Near-duplicate FLAGS only (content-hash dedup already ran; flag same-title /
     high-similarity pairs for steward merge decisions — never auto-merge).
2. **Proposed changes** (queued, one-click accept in the wizard):
   - **Label pre-assignment**: per concept, match title+body against the services
     UNDER the repo's Subject Area (category → children). High-confidence
     (strong title/keyword overlap) → pre-assigned + logged; ambiguous → queued
     with top-3 suggestions. Zero-LLM pass first; the LLM pass refines later.
   - **Link repair**: dangling `links:`/wiki targets → closest-concept-title
     proposals (map/drop), one-click.
   - **Type conflicts**: authored vs inferred disagreement → queued with both.
3. **Curation coverage score** (per repo, recomputed on every pass + edit):
   % typed (non-placeholder), % labeled, link density (edges/concept), dangling
   links, open proposals, conformance issues. Surfaced in the StudioDashboard
   card + the wizard Validate step. Validate shows "curation complete" when
   open proposals = 0 and issues = 0 — the read-out that it's safe to proceed.
4. **Work queue UI** (wizard Curate/Validate steps): grouped, count-badged,
   accept-all / per-item actions; every action routes through the EXISTING
   write paths (PATCH fm mode / autocorrect endpoints) so the labels reach RAG
   via ingest_labels (composeIngestLabels) with no new write machinery.

## Stories (claim through the coordinator; each extends the smoke harness)

- **AC-1 — Mechanical pass + coverage engine (backend)**: server-side pass at
  import finalize; autocorrect wiring, TOC reconcile, dup flags; coverage
  computation + `GET /:repo_id/coverage` (or fold into metrics); audit rows.
  Tests: pass runs on import, changes audited, coverage fields correct.
  Smoke: R10 — post-import coverage endpoint exists + conformance fixes applied.
- **AC-2 — Review-by-exception UI (frontend)**: wizard Curate/Validate work
  queue + dashboard coverage chip; accept-all/per-item on proposals; DS
  components only; i18n keys ×14 locales.
  Smoke: UI-level manual pass item.
- **AC-3 — Bounded label pre-assignment (backend)**: the Subject-Area-bounded
  matcher + confidence rule; pre-assign high, queue ambiguous; FR-36 contract
  (never adds labels to the hierarchy — only maps existing services).
  Smoke: R11 — a labeled-at-import concept's chunk_labels carry the pre-assigned
  label after drain (already covered by R8b mechanics — assert the import path).
- **AC-4 — Link repair queue (backend + UI)**: dangling-link closest-title
  resolver + proposal store + accept/deny endpoints; UI section in the queue.
- **AC-5 — LLM auto-curate (Pass 3, follow-up)**: real LLM classification
  (un-stub `classification: 'llm'`), summaries, ambiguous-label refinement,
  cluster/structure proposal. Depends on the okf-server→vLLM client decision
  (dataprep owns the model — small classify endpoint there recommended).
  Sovereignty + lanes + steward-gate apply.

## Sequencing

AFTER David's re-import test validates the current foundation (in flight —
Subject-Area creation fix lands first). AC-1 + AC-2 first (pure wiring of
existing engines), then AC-3 (biggest time-saver), AC-4, AC-5.

## PRD linkage

Implements FR-36's label auto-mapping and FR-38's auto-correct/label-mapping/
link-resolution clauses — the wizard composes them into one automatic pass.