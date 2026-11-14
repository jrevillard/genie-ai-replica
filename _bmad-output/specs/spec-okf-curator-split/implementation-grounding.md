# Implementation grounding — the facts the design stands on

Every claim below was verified against the current code (2026-11-14, post-!880/!885 main). Downstream skills read this companion INSTEAD of re-deriving the landscape.

## The legacy resplit path (NOT this operation — untouched)

- **Route:** `repos-routes.js:410` — `POST /:repo_id/resplit`, `requireRepoScope('repo_id', 'admin')`.
- **Controller:** `repository-controller.js:1753-1795` — modes A/B/C; `assertWritable` pre-gate; audit `repo.resplit` ("one of the most destructive repository actions"); responds `200 { ok, mode, ...summary }`.
- **Service:** `ingest-service.js:1211-1262` — `resplitRepo(repo_id, mode, opts)`; guards 404 FILE_NOT_FOUND / 400 MODE_NOT_IMPLEMENTED / 400 VALIDATION_ERROR; fetches the raw .md via `fetchFileBytes`; **DESTRUCTIVE:** `clearRepoConceptsAndGraph` (`:1270-1304`) deletes ALL meta rows + truncates every graph collection; re-ingests from ONE linked doc-repo file; mode B splits on `## Source:` markers, mode A is one mega-concept; NO ceiling awareness (the !788 pre-pool inside `ingestRepoConcepts` splits over-ceiling pages anyway — seams the curator never chose).
- **The flawed segmenter:** `producer-service.js:678-724` — `segmentMarkdown` drops every section under `MIN_SEGMENT_CHARS = 200` (`:694`) whenever one qualifies; splits only `#{1,3}`; NO maximum section size. Its overflow-tail drop was already fixed to merge (`:696-700`). `concept-splitter.js:18-22` names this file as the anti-pattern.

## The lossless engine (what the operation reuses)

- `concept-splitter.js` — `splitConceptBody(body, ceiling = DEFAULT_CEILING)`; returns `{ parts, unsplittable, reason, ceiling }` (`:58`, `:189`). Losslessness is structural: contiguous half-open line ranges, concatenation reproduces the original byte-for-byte, original EOLs preserved (`:24-32`, `:70-72`). Decomposition escalates heading → blank-line paragraph → line boundary, only as far as needed (`:116-148`); `greedyMerge` recombines while fits (`:100-114`); `absorbBlankParts` (`:158-174`); a single over-ceiling line with no boundary is UNSPLITTABLE, never hard-wrapped (`:142-147`).
- **Part identity:** `partPath(path, index)` — `ingest-service.js:188-194`: part 1 unsuffixed (inbound links keep resolving), parts 2..N `-part-<n>`.
- **Choke point precedent:** `applyDocumentCeiling` (`ingest-service.js:210-253`) runs inside `_ingestWithCap` (`:750-762`) BEFORE the `TOO_MANY_CONCEPTS` cap; unsplittable → `conceptTooLargeError` with status forced to 400 ON THE IMPORT PATH ONLY ("the two write paths use 409", `:222-239`); split report surfaces as `split_documents` (`:784-786`).

## The guards this operation must honor

- **Ceiling authority:** `concept-ceiling.js` — `DEFAULT_MAX_CONCEPT_DOC_CHARS = 250000` (`:32`); `maxConceptDocChars()` reads the env at CALL time (`:43-47`); `ConceptTooLargeError` code `CONCEPT_TOO_LARGE` status **409** (`:63-75`); `conceptTooLargeError({label, chars, ceiling, remedy})` builds the shared refusal (`:83-94`). The env (`OKF_MAX_CONCEPT_DOC_CHARS`) is documented in `env:336` and `site/content/en/docs/configure/okf-variables.md:221-225`.
- **Publish gate:** `lifecycle-service.js:721-765` — refuses BEFORE `mintVersion` (`:781-783`), reads `maxConceptDocChars()`, lists offenders via `conceptMetaService.listOverCeiling` (`concept-meta-service.js:741-747`), 409 naming up to 10 offenders with the "Split them into smaller concepts" remedy — the advice this spec turns into an affordance.
- **Editor save guard:** `repository-controller.js:1540-1560` `assertWithinConceptCeiling` (measures the BODY, ceiling inclusive, no index exemption), called at `:1631`/`:1639-1641` in `patchConcept`; a content-hash change resets `index_status: 'parsed'` for re-index.
- **Drain contract:** the meta row IS the queue (`ingest-service.js:631`); the `[4b]` upsert stamps `index_status: 'parsed'` + born-right `graph_name` (`:545-553`, from `workingGraphName(repo)` at `:713`); requeue patterns: `requeueRepoForRedrain` (`concept-meta-service.js:339-361`), `stampRepoGraphName` (`:439-448`), `requeueFailedForReingest` (`:392+`, FAILED-only; `ingest_attempts: 0` is load-bearing against the reaper's dead-letter at `OKF_INGEST_WORKER_MAX_CLAIMS`, `:375-380`). Unchanged-hash + already-indexed rows skip enqueue (`:617-629`) — a split whose part 1 changes the body re-drains because the hash changes.

## The editor surface (where the entry goes)

- **Re-split today:** `ConceptList.vue:277-279` (footer DsButton, REPO-scoped, `@resplit` emit `:361`) → `RepoEditor.vue:29` (`resplitOpen`) → `OkfResplitModal` (`ResplitModal.vue`: props `{visible, repoId, fileId}` `:69-73`; modes B/A/C-disabled; confirm dispatches `okf/resplitRepo` `:108-131`) → store `okf/resplitRepo` (`okf.js:1129-1143`, refreshes concepts after) → `repoOkfService.resplit` (`repoOkfService.js:267-279`, POST body `{mode, file_id?}`, `x-actor-sub` header).
- **Per-concept action precedent:** the tree rows already carry readOnly-gated per-row actions (label/delete buttons, `ConceptList.vue:121-152` root rows, `:204-232` children).
- **i18n blocks of record:** `okf.editor.resplit.*` (`en.js:2997-3008`), `okf.editor.concepts.resplit` (`:2918`), `okf.glossary.resplit` (`:3341-3342`) — the new keys join the same families; all 16 locales carry them today.

## Tests that pin the ground

- Legacy resplit route: `repos-routes.test.js:1226-1299`.
- `segmentMarkdown`: `producer-documents.test.js:473-593`.
- Lossless engine: `concept-splitter.test.js` (boundaries, lossless round-trips incl. CRLF corpus bodies, never-exceeds-ceiling `:113`, determinism `:122`, re-split idempotence `:129`, unsplittable-not-wrapped `:183-191`).
- Ceiling guards (three paths, one suite): `concept-ceiling-guards.test.js` (env/default `:35-46`, shared refusal shape `:49-60`, editor-save 409 pins `:62-196`, import-path 400 pins `:201-286`).
- Publish gate placement: `lifecycle-service.test.js:1104-1175`.
- patchConcept surface: `repository-controller-surface.test.js` (steward `max_doc_chars` `:1140/:1245/:1253`; frontmatter-merge vs full-patch `:870-894`).
- Frontend: `editor.test.js:301-327` (ResplitModal), `okf-editor.test.js:327-333` + `okf-actions-coverage.test.js:1050-1100` (store), `repoOkfService.test.js:175-189` (service), `concept-ceiling.test.js:100-142` (editor ceiling UX), `input-split-report.test.js` (wizard split report), E2E `tests/e2e/okf/concept-ceiling.spec.js:127-190`.

## Known debt this spec must not worsen

- **#1588** — the ceiling-vs-document-budget drift, named while documenting the plan (`workplan-okf-2026-11-05.md:272-273`, also `concept-ceiling.js:15-22`): `DATAPREP_CONTEXTUAL_DOC_BUDGET` and `OKF_MAX_CONCEPT_DOC_CHARS` are different numbers. The operation reads ONLY `maxConceptDocChars()`.
- **The 6h lane stall risk** (plan §Risks): a wedged drain row holds its lane 6h (`ingest-worker` reaps at `windowMaxMs()`); splitting multiplies rows — the drain contract above keeps rows born-right so the reaper's accounting holds.
