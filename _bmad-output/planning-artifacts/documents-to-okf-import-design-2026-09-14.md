# Design — Document-repository → OKF repository import (multi-select, whole-corpus)

**Date:** 2026-09-14 · **Status:** PROPOSED (David's directive, same day) · **Owner:** okf-server pillar
**Directive (David, 2026-09-14):** "select either single or multiple files that have been uploaded into the document repository … and import them into a single OKF repository. While the files are imported, they must be processed, linked and labeled as a whole … Once the OKF repo is imported, it will be treated like any other OKF repo and undergo the same workflow. This new feature must not break or modify the existing import features … The multi-select metaphor in the UI (which currently exists in the Document Management tab) must be used for this. Documents that have already been ingested CAN be imported into an OKF repository but that OKF repository CANNOT be ingested until the source documents have been retracted. The source document origins must be able to be viewed from imported OKF repositories using links on their popup cards (which can open the document details in the same details tab that is used from the document management tab)."

---

## 1. Placement in the decided architecture

This is **Story 7.7** ("Produce OKF repository from selected/uploaded documents", FR-37) realized as the
**Source Adapter Framework's Class-0 flagship adapter** (import-scope gap-analysis §5.6: "FR-37 documents
path becomes the framework's Class-0 flagship adapter"). Class 0 = user-provided files: **no egress,
default-on, no connector registry gate.**

The framework's one rule governs everything: **adapters end at the staging seam.** Doc-repository files are
ALREADY staged artifacts (retained truth, ADR-okf-016 tier-2) — so this feature has **zero acquisition
surface**. Its entire new surface is **conversion** (the crawl-conversion-service pattern) + one lifecycle
gate + provenance surfacing. Downstream of conversion, *nothing changes*: ingestRepoConcepts
(parse→meta→conformance→PII→dedup), curator, validate, review, publish (mintVersion), the drain worker,
born-right graph naming, retract.

```
 doc-repo files (ALREADY STAGED — Class 0, no acquisition)
     │  POST /api/okf/repos/convert-from-documents {file_ids[], name, model_tier, options}
     ▼
 DOCUMENTS-CONVERSION (new producer-service.js — crawl-conversion-service pattern)
     │  fetch bytes → per-format CONVERT → segment → draft frontmatter
     │  → CROSS-FILE link resolution (whole corpus) → CORPUS classification pass
     │  → ingestRepoConcepts (existing 4a–4g) → conversion record done
     ▼
 CURATE (editor / Auto-Curate / labels — unchanged)  →  VALIDATE → REVIEW → PUBLISH (mint)
     ▼
 ★ SOURCES-BUSY GATE (new lifecycle blocker on `ingest`)  →  RAG drain (existing worker) → serve
```

## 2. Verified fact base (2026-09-14, live code)

| Fact | Source |
|---|---|
| Accepted upload formats: **`.pdf .docx .xlsx .md .html .txt`** | `document-repository/src/config/appConfig.js:45` (`allowedExtensions`; MIME list at :36–42) |
| Text extraction: pdf (`pdf-parse`), docx (`mammoth`), `text/*` incl. HTML tag-stripping; **xlsx returns `''` (not extracted)** | `document-repository/src/services/fileService.js:43–87` (`_extractText`) |
| `dataprep.status` enum: **Pending / Ingesting / Ingested / Ingested with Warnings / Ingestion Error / Retracted** | `document-repository/src/routes/fileRoutes.js:906` |
| Free-form ingest gate already exists (`showIngestButton`); Create-OKF gate exists (`okfRepoGate` computed, 3 conditions, reason-key tooltip) | `AdminDashboard.vue:1857–1925` |
| Multi-select = `selectedDocuments` (array of `_key`s) + per-row checkboxes | `AdminDashboard.vue:525, 1752` |
| Document details view = `FileDetailsDialog` driven by `selectedFileId` | `AdminDashboard.vue:1538–1540, 1759` |
| Conversion-job pattern (job record on repo doc `conversion`, stage/batches/pages progress, FIFO slot semaphore, `sweepInterruptedOnce`, terminal `done|failed`) | `okf-server/services/crawl-conversion-service.js:100–260` |
| Source stamping precedent: repo doc gets `source_document: {kind:'crawl', file_id, file_name, …}` | `crawl-conversion-service.js:149` (`stampSourceDocument`) |
| Cross-file link precedent: `rewriteCrossLinks(body, pageMap, …)` + `dedupeLinks` | `crawl-conversion-service.js:321, 344` |
| Lifecycle: `TRANSITIONS.ingest = {from:['publish']}` arms the drain; `buildingBlocker(repo)` is the transition-gate seam (BUILD_IN_PROGRESS, DRAIN_IN_PROGRESS precedents) | `okf-server/services/lifecycle-service.js:69–142` |
| Original bytes retrievable: `GET /api/files/:fileId/download` (streaming) | `document-repository/src/routes/fileRoutes.js:531` |
| Empty-repo creation primitive: `createRepo({name, domain})` (repo + index.md skeleton) | `gov-chat-frontend/src/services/okfRepoOps.js:123`; server-side equivalent used by crawl conversion |
| Convert route naming precedent: `POST /api/okf/repos/convert-from-crawl` (tools-admin) | `okf-server/routes/repos-routes.js:26` |
| Spreadsheet semantics DECIDED: per-sheet **data-dictionary concept** + N row-group concepts (cap ~200–500 rows), dictionary↔data `links[]` | import-scope gap-analysis §5.3 (ADR-okf-038), FR-42 |
| ⚠️ The repo's OWN bundle zip is a doc-repo file with `dataprep.status='Ingested'` + `is_bundle=true` | `fileService.js:1000` — see §6 gate-scope rule |

## 3. Data model (all additive; no collection changes)

**Repo doc (`okf_repositories`) — new `source_documents[]` array** (multi-file generalization of the crawl
`source_document` stamp, `kind`-discriminated so the two never collide):

```js
source_documents: [{
  kind: 'document',            // crawl stamps kind:'crawl' — discriminator
  file_id, file_name, file_type, size_bytes, uploaded_date,
  import_state: 'imported',    // reserved for 7-2 source-sync deltas
  retracted_at: null           // informational mirror; the GATE re-reads doc-repo live
}]
```

**Source docs (`files`) — additive `okf_repo_id` stamp** (Story 3.6's field, written at conversion start):
gates "already in an OKF repo" in the UI; free-form docs unaffected (field absent).

**Per-concept provenance** — `sources[]` on every drafted concept (FR-37 contract, already the parser's
shape): `{ resource: <doc download URL or file ref>, file_id, file_name, locator }` where `locator` is the
page/section/sheet-row-range the concept was segmented from. This is what the popup cards render.

**Conversion record** — reuses the existing `repo.conversion` record shape (dashboard/BuildProgressCard
already render it): stages `fetching → converting (per-file progress files_done/files_total) → segmenting
→ cross-linking → classifying → conforming → pii → done|failed`, plus `per_file: [{file_id, status,
error?, concepts}]` for the partial-failure report.

## 4. Conversion orchestration — `producer-service.js` (new, okf-server)

Implements the crawl-conversion pattern *exactly* (same skeleton, new source semantics):

1. **Validate + stamp** (synchronous, in the route): every `file_id` exists, is not a bundle
   (`is_bundle !== true`), is one of the six accepted formats; none already stamped with a DIFFERENT
   `okf_repo_id` (re-import into the SAME repo is idempotent — allowed, dedup by content hash downstream);
   `createRepo({name, domain})` → stamp `source_documents[]` + `okf_repo_id` on each source doc → create the
   conversion record → hand off.
2. **Job run** (slot-semaphore, FIFO — same `acquireSlot` discipline; `sweepInterruptedOnce` covers crashed
   jobs; terminal statuses `done | failed` ONLY, per the conversionTerminal contract):
   - **fetch + convert per file** (streaming via `/download`; per-file byte cap reusing
     `OKF_MAX_CRAWL_SOURCE_MB` semantics, per-file isolation — one failed file does NOT abort the batch;
     its error lands in `per_file[]` and the report):
     - `pdf` → doc-repo extraction is reused by fetching the STORED extracted text where present, else
       `pdf-parse` in okf-server on the streamed bytes (same library, additive dep);
     - `docx` → `mammoth.extractRawText` (same, additive dep);
     - `md / txt` → UTF-8 direct; `html` → the crawler's Turndown+cheerio path (EXISTING code, §5.3
       "html upload: reuse, not new code");
     - `xlsx` → **dedicated converter** (`services/converters/xlsxSheetConverter.js`, `sheetjs` dep):
       FR-42 DECIDED semantics — per SHEET: one *data-dictionary concept* (title, purpose, column table
       name/inferred-type/sample) + N *row-group concepts* (markdown tables, 200–500 rows, split on natural
       keys), dictionary↔data `links[]`, Import-Profile `stale_after` supported.
   - **segment + draft** per document → concept drafts (`generated.by=agent:okf-producer`, title/type
     heuristics, `sources[]` with `locator`), concept-ID namespace closed across the WHOLE corpus.
   - **cross-file link resolution** — `rewriteCrossLinks` generalized to the corpus: in-text references
     between concepts from DIFFERENT files resolve to `links[]` (label = anchor text, self-loops and
     externals dropped — born-right rules); file order stable (upload_date then name) for deterministic IDs.
   - **corpus classification pass** — ONE pass over all drafts (not per-file): Subject Area (KH L1)
     assignment + KH-L2 label candidates via the existing classification strategies
     (`heuristics | llm | hybrid`, user-selectable — llm-curation-service), so labels are coherent across
     the whole import as David required. Import-Profile defaults (v1: defaults only, DP-9) pre-fill.
   - **index.md TOC** — root concept generated from the file set (crawl's index derivation analog).
   - **ingestRepoConcepts** (existing 4a–4g: parse→meta→conformance→PII→dedup) → `conversion done` +
     post-import report (per UX §F partial-failure framing: N files, M concepts, K links, skipped+why).
3. **The repo lands `status=review`, server-enforced `unverified`, never auto-publish** — identical to the
   crawl path. From there it is a normal OKF repo through the six-step workflow.

## 5. Whole-corpus guarantee (David's "processed, linked and labeled as a whole")

- **Links:** resolved across ALL files in one namespace (step 2), not per-file — a concept in the abattoir
  PDF can link a concept in the xlsx.
- **Labels:** one classification pass over the full draft set (step 3) — consistent Subject Area and
  non-duplicative KH-L2 labels corpus-wide (bounded-growth rule intact).
- **Dedup:** the existing content-hash dedup runs corpus-wide, so overlapping documents (revised editions)
  collapse instead of duplicating concepts.

## 6. The SOURCES-BUSY gate — "OKF repo cannot be ingested until sources are retracted"

**Relaxation vs. the 7.7/3.6 text as written:** the OLD gate refused to IMPORT ingested docs. The NEW rule:
import is always allowed; the **ingest transition** is gated instead.

- **New lifecycle blocker** in `buildingBlocker(repo)` (the established seam), checked ONLY on `ingest`:
  ```js
  // SOURCES-BUSY (David, 2026-09-14): an OKF repo whose source documents are still
  // serving the free-form RAG corpus must not DOUBLE-SERVE that content via its own
  // graph. Block until every source doc is Retracted in doc-repo.
  if (action === 'ingest' && (repo.source_documents || []).length) { … }
  ```
  Doc-repo re-check is LIVE (`GET /api/files/:id` → `dataprep.status`), fail-closed: block when any source
  doc's status ∈ {`Ingesting`, `Ingested`, `Ingested with Warnings`}; pass when {`Retracted`, `Pending`,
  `Ingestion Error`}. Error: `409 SOURCES_NOT_RETRACTED` naming the offending `file_name`s (the reaper
  precedent for actionable errors). Crawl repos have no `source_documents[]` → zero behavior change.
- **⚠️ GATE-SCOPE RULE (live-code trap):** the repo's OWN bundle zip is itself a doc-repo file with
  `dataprep.status='Ingested'` + `is_bundle=true` (`fileService.js:1000`). The gate therefore keys on the
  `source_documents[]` list ONLY (never "any doc with okf_repo_id"), and the stamp excludes bundles —
  otherwise every crawl repo would brick itself at ingest.
- **Surfacing:** the repo payload gains a derived `sources_blocked` summary (blocked count + names) rendered
  in the dashboard lane + Studio publish/ingest step ("Source documents still serving in RAG — retract them
  to enable ingest", one click deep-links the filtered Document Management list). Retracting a source doc is
  the EXISTING doc-repo retract flow; no new retract machinery.
- **Consistency note:** re-import of the same doc into the same repo is allowed (idempotent); importing a
  doc already stamped with a DIFFERENT repo stays refused at the route (409) — one source, one OKF repo.

## 7. Provenance popup links ("source origins … links on their popup cards")

Both existing hover cards gain a **"Source document" section** rendered from the concept's `sources[]`:

- **Tree card** (`ConceptList.vue` — the ingest-failure card pattern just shipped): a source row per
  `sources[].file_id` — `file_name` + "view details →".
- **Graph card** (`RepoGraphView.vue` showCard): same rows.
- **Opening the details view:** `FileDetailsDialog` is driven by `AdminDashboard.selectedFileId`. Additive
  deep-link: the admin dashboard watches `$route.query` (`?tab=documents&file=<file_id>`) → switches tab,
  sets `selectedFileId`, opens the dialog; the cards push that route (router-link/`$router.push`). The SAME
  details view as Document Management — no second dialog, exactly David's requirement. Fallback when the
  admin page isn't mounted: the link routes to it with the query (normal navigation).

## 8. Frontend — import entry (extends the EXISTING multi-select metaphor)

- **Gate amendment (Story 3.6 `okfRepoGate`):** DROP the `alreadyIngested` refusal; keep `emptySelection`
  and `alreadyInOkf` (different-repo). NEW behavior for ingested selections: the button is ENABLED with an
  amber warning tooltip — "N selected document(s) still serve the free-form corpus; the new repository
  cannot be ingested until they are retracted" — guardrails-before-errors.
- **`ImportDocumentsDialog`** (DS primitives, AddFromLinkDialog-adjacent patterns): name + domain +
  classification strategy (heuristics|llm|hybrid) + per-file preflight list (format ✓, size, okf-stamp
  state) → `POST convert-from-documents` → routes to the repo's Studio/in-progress lane.
- **Progress:** the existing conversion-record rendering (BuildProgressCard) shows per-file progress via
  `conversion.per_file`.
- i18n ×14 for every new string; DS primitives only; zero new paradigms.

## 9. Security, governance, limits

- Scope: `requireRole('tools-admin')` + the created repo's admin scope (mirrors convert-from-crawl).
- No new egress (Class 0). PII: the existing blocking Presidio publish gate applies downstream, unchanged;
  source docs were already ClamAV-scanned at upload.
- Quotas: max files per import (env, default 100) + per-file byte cap (reuse `OKF_MAX_CRAWL_SOURCE_MB`);
  conversion slot semaphore shared with crawl conversion (one heavy conversion at a time — existing rule).
- Audit: conversion start/done + the gate's refusals audited (existing audit-service).

## 10. Testing

- **Unit:** per-format converters (pdf/docx/html/md/txt reuse; xlsx dictionary+row-groups), cross-file link
  resolution, corpus classification single-pass, gate (blocked on each serving status; passes on
  Retracted/Pending/Error; ignores `is_bundle`; crawl repos unaffected), partial-failure per_file report,
  route validation (unknown file, foreign okf_repo_id, bundle, oversize).
- **Smoke harness extension (per-story rule):** upload 3 docs (pdf/md/xlsx) → import → assert repo at
  review with linked+classified concepts → attempt ingest → assert `409 SOURCES_NOT_RETRACTED` → retract
  the free-form ingested doc → ingest succeeds → popup-card source links resolve to the details dialog.
- **Non-breaking proof:** full existing suites + the free-form "Ingest Selected" path + a crawl import
  regression (gate must not trip on `is_bundle`).

## 11. Non-goals (this iteration)

csv / json / pptx formats (doc-repo doesn't accept them yet — FR-37 amendment lands with Epic 11 staging);
recurring sync / delta drafts (Epic 11 scheduler); Git/S3 adapters; Import-Profile rules engine (v1 =
defaults only, DP-9); auto-publish (never — six-step contract).

## 12. Risks

| Risk | Mitigation |
|---|---|
| Gate trips on the repo's own bundle (`is_bundle` Ingested) | Gate keys on `source_documents[]` + excludes bundles — pinned by a named test |
| xlsx extraction quality (merged cells, formulas) | FR-42 dictionary-first semantics; caps; partial-failure report; loud-reject on unreadable sheets (gap-analysis D-x) |
| Big selections (100 files) clogging the shared conversion slot | Per-file cap + files_total progress + semaphore (crawl parity); OKF_IMPORT_CONCURRENCY lanes exist for the downstream |
| Sources retracted DURING a drain | Gate re-checks live at transition time only; mid-drain retraction is harmless (content already chunked into the repo's own graph) |
| `okf_repo_id` stamp on legacy docs lacking the field | Additive field, default absent — 3.6's established pattern |

## 13. References

Story 7.7 + 3.6 (epics.md:785, 3-6 story file) · import-scope gap-analysis §5 (Source Adapter Framework,
FR-39..43, ADR-036..038) · Studio UX §1.3a/§5.2 · `crawl-conversion-service.js` (the pattern) ·
`lifecycle-service.js` `buildingBlocker` · `AdminDashboard.vue` multi-select/gate/FileDetailsDialog ·
`appConfig.js:45` formats · `fileService.js:43` extraction · `fileRoutes.js:906` status enum.
