---
baseline_commit: a84ca779
---
# Story 7.7: Produce OKF repository from selected documents — multi-select, whole-corpus, source-busy gate

Status: ready-for-dev (NEXT WORK ITEM — David, 2026-09-14)

Story key: `7-7-produce-okf-from-selected-documents` | Epic: 7 (AI-Driven OKF Producer) / rides Epic 11's Source Adapter Framework as the **Class-0 flagship adapter** | Branch: `feat/okf-server`
FRs: FR-37 (amended), FR-39 (Class 0), FR-42 (xlsx semantics) | Design: [documents-to-okf-import-design-2026-09-14](../planning-artifacts/documents-to-okf-import-design-2026-09-14.md) (anchors verified against live code 2026-09-14)

> **The gap (amended 2026-09-14):** the original 7.7 text gated IMPORT on "not yet ingested". David's
> directive supersedes: **ingested documents CAN be imported**; the gate moves to the OKF lifecycle — the
> repository **CANNOT be ingested (drained) until its source documents are Retracted** in doc-repo, so the
> same content never serves twice through two RAG channels. Everything else is the decided Class-0 path:
> multi-select in Document Management → one OKF repo → processed/linked/labeled AS A WHOLE → normal
> six-step workflow. Existing import features (free-form ingest, crawl conversion) are untouched.

## Story

As a **steward**,
I want **to multi-select uploaded documents (pdf, docx, xlsx, md, html, txt) in Document Management and import them into a single OKF repository — including documents already ingested free-form**,
So that **existing document batches become one governed, cross-linked, coherently labeled OKF knowledge base — without double-serving content that is already live in RAG**.

## Acceptance Criteria

1. **Entry point (Document Management, existing multi-select):** `okfRepoGate` drops the
   `alreadyIngested` refusal (keeps `emptySelection`, `alreadyInOkf`-foreign-repo). Selecting ingested docs
   ENABLES the button with an amber warning tooltip ("N document(s) still serve the free-form corpus — the
   new repository cannot be ingested until they are retracted"). "Create OKF repository" opens
   `ImportDocumentsDialog` (name, domain, classification strategy heuristics|llm|hybrid, per-file preflight
   list) → `POST /api/okf/repos/convert-from-documents {file_ids[], name, domain, model_tier}`
   (tools-admin) → routes to the repo's in-progress lane.
2. **Whole-corpus conversion (`producer-service.js`):** per-format converters (pdf/docx/md/txt via the
   doc-repo extracted text or the same libs on streamed bytes; html via the existing Turndown+cheerio path;
   **xlsx via a dedicated sheetjs converter implementing FR-42 DECIDED semantics** — per-sheet
   data-dictionary concept + capped row-group concepts, dictionary↔data `links[]`); then ONE cross-file
   link-resolution pass over the whole draft set (closed concept-ID namespace, self-loops/externals
   dropped) and ONE corpus classification pass (Subject Area + KH-L2 labels, strategy user-selectable) →
   `ingestRepoConcepts` (existing 4a–4g) → repo at `status=review`, server-enforced `unverified`, never
   auto-publish. Per-file isolation: one failed file lands in `conversion.per_file[]` (error + skipped
   why) and never aborts the batch; the post-import report carries the partial-failure framing.
3. **Job mechanics = crawl-conversion pattern:** conversion record on the repo doc
   (`fetching → converting(files_done/files_total) → segmenting → cross-linking → classifying →
   conforming → pii → done|failed`; terminal `done|failed` ONLY), shared FIFO slot semaphore,
   `sweepInterruptedOnce` crash sweep, per-file byte cap, max-files quota (env), audit on start/done.
4. **SOURCES-BUSY lifecycle gate:** a new blocker in `buildingBlocker(repo)` fires ONLY on the `ingest`
   transition and ONLY for repos carrying `source_documents[]`: live doc-repo re-check, **fail-closed** —
   block while any source doc's `dataprep.status ∈ {Ingesting, Ingested, Ingested with Warnings}`;
   `409 SOURCES_NOT_RETRACTED` names the offending files. **Must NOT trip on the repo's own bundle zip**
   (`is_bundle=true` docs report `Ingested` — gate keys on `source_documents[]`, never on
   okf_repo_id-scans; pinned by a named test). Crawl repos: zero behavior change. Repo payload surfaces a
   derived `sources_blocked` summary rendered in the dashboard/Studio ("retract to enable ingest" + link
   to the filtered doc list). Retracting a source doc uses the EXISTING doc-repo retract flow.
5. **Provenance popup links:** every drafted concept carries `sources[]` with
   `{file_id, file_name, locator}` (page/section/sheet rows). BOTH hover cards — the tree card
   (`ConceptList`) and the graph card (`RepoGraphView.showCard`) — render a "Source document" row per
   source with a link that opens `FileDetailsDialog` via a deep link
   (`admin route ?tab=documents&file=<file_id>`; AdminDashboard watches `$route.query` → tab +
   `selectedFileId` + dialog) — the SAME details view as Document Management.
6. **Composition + standards:** additive data only (`source_documents[]`, `okf_repo_id` stamp,
   `conversion.per_file[]`); DS primitives + Options API + Vuex + httpService; i18n ×14 for every new
   string; zero changes to free-form ingest, the crawl path, or the six-step contract.

## Tasks

- [ ] T1 Server: `producer-service.js` (validate+createRepo+stamp, slot semaphore, sweep, conversion record with `per_file[]`) + `POST /repos/convert-from-documents` route + tests
- [ ] T2 Converters: text/md/txt direct, pdf (`pdf-parse`), docx (`mammoth`), html (Turndown reuse), `xlsxSheetConverter.js` (sheetjs; FR-42 dictionary+row-groups+links, caps, loud sheet rejection) + tests
- [ ] T3 Whole-corpus passes: `resolveCrossFileLinks` (rewriteCrossLinks generalization) + single classification pass + index.md TOC + tests
- [ ] T4 SOURCES-BUSY gate in `buildingBlocker` (ingest-only, source_documents-keyed, live fail-closed re-check, `SOURCES_NOT_RETRACTED` with file names) + the is_bundle non-trip test + crawl-regression test
- [ ] T5 Frontend: `okfRepoGate` amendment (drop alreadyIngested → amber warning), `ImportDocumentsDialog`, conversion progress (`per_file`), `sources_blocked` surfacing on repo lanes
- [ ] T6 Popup-card source links: `sources[]` section on both hover cards + `$route.query` deep-link watcher + FileDetailsDialog open + tests
- [ ] T7 i18n ×14; jest/lint/format both components; smoke extension: import(pdf,md,xlsx) → review → ingest 409 → retract source → ingest OK → card link opens details; free-form + crawl non-breaking regressions

## Dev Notes

- **Anchors (verified 2026-09-14, live code):** formats `appConfig.js:45`; extraction `fileService.js:43`
  (`_extractText` — xlsx returns ''); status enum `fileRoutes.js:906`; download `fileRoutes.js:531`;
  gate `AdminDashboard.vue:1881` (`okfRepoGate`), multi-select `:525`; details dialog `:1538`
  (`selectedFileId`); conversion pattern `crawl-conversion-service.js:100–260` (semaphore/sweep/record),
  `:149` (`stampSourceDocument` — `kind` discriminator), `:321` (`rewriteCrossLinks`); lifecycle seam
  `lifecycle-service.js:114` (`buildingBlocker`) + `:85` (`ingest` from publish); route precedent
  `repos-routes.js:26` (`convert-from-crawl`).
- **⚠️ The bundle trap:** the repo's OWN bundle zip is a doc-repo file with
  `dataprep.status='Ingested'` + `is_bundle=true` (`fileService.js:1000`). A naive "any Ingested doc with
  my okf_repo_id blocks me" scan bricks EVERY crawl repo at ingest. The gate reads `source_documents[]`
  (stamped `kind:'document'`, bundles excluded) — test T4 pins this.
- **Naming:** keep "import/conversion" for this direction; "ingest" is ONLY the dataprep drain (memory:
  no-ingest-word). The route is `convert-from-documents` (sibling of `convert-from-crawl`), superseding
  the old `produce-from-documents` name in the 7.7 epic text — reconcile epics.md at close-out.
- **xlsx has NO doc-repo text extraction** (`_extractText` returns '') — the sheetjs converter is NOT
  optional; it is the only path for .xlsx. Loud-reject unreadable sheets (gap-analysis D-x), never silent
  empty concepts.
- **Gate freshness:** statuses are re-checked LIVE at transition time (doc-repo GET), never trusted from
  the import-time snapshot; retraction of a source DURING an active drain is harmless (content already
  chunked into the repo's own graph) — the gate guards the transition, not the drain.
- **Idempotency:** re-importing a doc into the SAME repo is allowed (content-hash dedup absorbs it);
  importing a doc stamped with a DIFFERENT `okf_repo_id` is a 409 at the route.
- **Class 0:** no egress, no connector registry dependency, no PII-at-acquisition addition (docs were
  ClamAV-scanned at upload; the blocking Presidio publish gate applies downstream unchanged).
- **Story rule:** extend the smoke harness (T7) and re-run it live before close-out.

## Scope boundary (do NOT build)

csv / json / pptx (doc-repo doesn't accept them; FR-37 amendment rides Epic 11) · recurring sync/delta
(Epic 11 scheduler) · Git/S3 adapters · Import-Profile rules engine (v1 defaults only, DP-9) · free-form
ingest changes · crawl-path changes · a second details dialog (reuse FileDetailsDialog) · auto-publish
(never).

## References

[Design doc](../planning-artifacts/documents-to-okf-import-design-2026-09-14.md) · [Story 3.6](3-6-document-mgmt-create-okf-entry-point.md) (entry point; amended by this story) · epics.md:785 (original 7.7 text) · import-scope gap-analysis §5.3/§5.6 (FR-42 semantics, Class-0 flagship) · Studio UX §1.3a/§5.2 · memory `feedback_no-ingest-word`, `feedback_existing-ui-paradigms`, `feedback_additive-first-core-changes`, `feedback_no-dirty-hacks`.
