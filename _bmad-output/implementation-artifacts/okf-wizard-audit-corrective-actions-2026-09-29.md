# OKF Wizard — spec-vs-implementation audit + corrective actions

**Date:** 2026-09-29 · **Authority:** [`okf-wizard-ux-review-2026-09-28.md`](okf-wizard-ux-review-2026-09-28.md) (rev 3 FINAL, D1–D8)
**Method:** 6 parallel auditors, one per wizard slice; every finding cites file:line read from the current
`feat/okf-server` tree (commit 43f091db6). Unit tests were NOT accepted as evidence. The story file's
dev-log claims were checked, not trusted.

## Verdict at a glance

| Slice | Done | Partial | Wrong | Missing |
|---|---|---|---|---|
| Step 2 picker (E2.1–2.4, D1) | 5 | 1 (E1.3/T9, known P1) | 0 | 0 |
| Step 2 workbench (E2.5–2.9, D5/D6) | 3 | 3 | 1 | 0 |
| Step 3 Produce (E3.1–3.3, D2, F10) | 2 | 4 | 1 | 2 |
| Steps 4–7 (E4–E7) | 1 | 3 | 0 | 2 |
| Steps 8–9 + shell (E8–E10, D4 purge) | 2 | 3 | 0 | 1 |
| Editor parity + backend deps | 4 | 1 | 0 | 1 |
| **Total (42 findings)** | **17** | **15** | **2** | **6** |

**Headline:** the T1 picker is genuinely good (David's screenshot complaints were the stale-deploy
bundle — verified independently in code), and T5's handoff is real in English. But the sweep shipped
**2 wrong-behavior bugs, a functionally-dead Auto-correct step, a publish-language residue in 13
locales, and a handoff path that writes garbage ids** — none of which any test caught.

---

## A. P0 corrective actions — defects in work claimed DONE

### A1. Auto-correct step is functionally dead (E7.1/T4) — WORSE than the placeholder it replaced
- **Evidence:** `AutocorrectPanel.vue:188-192` — the ONLY scan trigger is `watch: { visible(v) { if (v) this.runDryRun() } }`, not `immediate`, no `mounted()` call. `StudioWizard.vue:46-49` remounts each step via `:key="activeStep"`, so on entry `visible` is ALREADY true → watcher never fires → no dry-run → panel renders the FALSE clean state "Nothing to fix — all frontmatter already conforms" (`:36-38`) with Apply permanently disabled (`:171-186`). No manual re-scan button exists.
- **Fix:** add `immediate: true` to the watcher (or call `runDryRun()` from `mounted()` when `visible`). Extend `autocorrect-publish.test.js` with a case asserting the `okf/autocorrectRepo` dry-run dispatch fires on step mount with a repoId (the existing test asserts props only — exactly how this stayed green).

### A2. Produce dispatches by VARIANT, not by each file's origin (E3.1/D6 contract)
- **Evidence:** `Produce.vue:244` — `variant === 'documents'` → one `importDocuments` batch; EVERY other variant → the per-file `convertFromCrawlInto` chain. But Input allows mixed-origin picks in ANY variant (`Input.vue:16-18` even promises "whatever sources are picked (in ANY variant)"). Consequences: a crawled .md routed through convert-from-documents is heading-segmented (`producer-service.js:201-233`) and never gains per-URL slug identity → cross-crawl exact-slug merge silently broken; a non-crawl upload routed through `convertFromCrawlInto` yields ZERO pages silently (`crawl-conversion-service.js:269-296` — `iteratePages` emits only after a `## Source:` marker) while reporting "done".
- **Fix:** carry each picked id's origin into `draft.input.document_names` (Input already writes this row shape at `:334`; extend it with the T1 `source` stamp). In Produce, route `source==='crawl'` ids through the crawl chain and the rest through ONE documents batch (two sequential legs).

### A3. Mid-chain conversion failure wedges the Produce step at "running" (F10 regression)
- **Evidence:** only the FIRST kick is guarded (`Produce.vue:204-223` friendly 409 mapping). `kickNextCrawl` (`:288-305`) has no try/catch and is called from `onConversionDone` (`:337`) and the resume path (`:183`). A mid-chain 409/5xx/network error clears the poll interval at `:371` and is then swallowed by the transient catch at `:392-394` → status stuck `running`, gate closed, **Retry disabled** (`:58`).
- **Fix:** wrap the leg kick in try/catch → `status='failed'`, `friendlyError(err)`, `$emit('gate', true)`, clear interval. Add a short retry/delay for the `CONVERSION_IN_FLIGHT` live-registry race between the "done" poll and the runner's `live.delete` (`crawl-conversion-service.js:840-843`).

### A4. D4 publish-language purge is INCOMPLETE at the locale layer
- **Evidence (user-facing, verified by node extraction of the locale files):**
  - `okf.steps.publish.title` = "Publish this repository" IN ITS OWN LANGUAGE in all 13 non-en locales (de.js:2224 "Dieses Repository veröffentlichen", es, fr "Publier ce référentiel", pt, ru, zh "发布此知识库", ar, bn, id, man, st, sw, th) + the old "publishing creates v1" hint. A non-English user sees step 9 titled PUBLISH.
  - `okf.steps.review.hint` "A summary of what you are about to publish." survives in ALL 14 locales (en.js:2291, rendered by Review.vue:13).
  - `Review.vue:141` fallback "No versions yet — publish mints v1." — key `okf.steps.review.noVersions` absent from en.js entirely.
  - Dead orphan key `okf.wizard.publish` "Publish repository" (en.js:2147, zero usages).
  - Step-6 publish framing: `okf.steps.validate.hint` "…fixed before publishing" (en.js:2279), `okf.validation.headline.blockers` "fix before publishing" (en.js:2432, rendered Validate.vue:158), `okf.narrative.step6` (en.js:2028-2029), Validate.vue:56 PII glossary fallback. **David to rule:** reframe to "before hand-off" or accept as describing the downstream gate.
  - Cosmetic/internal: `Publish.vue` filename + `OkfStepPublish` name, `canPublish` computed, `okf.steps.publish.*` namespace, stale StudioWizard.vue:14 comment "9 Publish".
- **Fix:** force-rewrite `okf.steps.publish.title/hint` in the 13 locales (the filler never overwrites existing values — this needs a targeted overwrite pass, both quote styles); rewrite `okf.steps.review.hint` in all 14; add `okf.steps.review.noVersions` + `okf.wizard.finish: 'Open the Editor'` to en.js (the footer label currently renders via hardcoded fallback in ALL locales — violates story AC6) and drop `okf.wizard.publish`; David rules on step-6 framing.

### A5. i18n debt: Review-step strings and glossary keys NEVER existed in en.js
- **Evidence:** `okf.steps.review.state/labelsSet/ritualOutside/versions/logs/rename/versionSummary` (Review.vue:20,44,55,76,79,82) and `okf.glossary.lifecycle/reviewHandoff/labelsAuto` (Review.vue:24,62,38; LabelOnboard.vue:16) are referenced by components but ABSENT from en.js (review block en.js:2289-2296 holds only title/hint/repo/topics/labels/sources; glossary block en.js:1947-1996 lacks all three) → hardcoded English fallbacks in every locale.
- **Fix:** add all 9 keys to en.js, propagate via the filler to 13 locales.

### A6. Handoff draft seeds URL/filename STRINGS into `document_ids` (bogus file_ids)
- **Evidence:** `AddFromLinkDialog.vue:476` seeds `crawlSeeds: [this.url.trim()]` — a URL — even though `response.data.file_id` is in hand at `:454`. `FileDetailsDialog.vue:938-939` seeds `filename||url`. `StudioTab.vue:571-580` copies `crawlSeeds` into `draft.input.document_ids`, which Produce then sends to `convertFromCrawlInto`/`convertFromDocuments` as file_ids. Any user reaching the wizard via this path kicks conversions against garbage ids.
- **Fix:** seed the real file_id (`crawlSeeds: [response.data.file_id]`). FileDetailsDialog's primary OKF button may keep its direct single-file conversion (spec E1.3: "today's file-details path keeps working"), but its draft-seeding fallback must also use the real id.

### A7. Input workbench deviations from D5/D6 (five items)
1. **`has-index` hardcoded false** (`Input.vue:134`): AddConceptModal always offers creating a second index and never shows "Append to index" — duplicate-index risk. Fix: computed `hasIndex` mirroring RepoEditor.vue:417-419, bind at :134.
2. **Clone variant hides the picker feeder** (`Input.vue:69` `v-if="variant !== 'clone'"`): violates D6 "ALL feeders always visible once the repo exists". Fix: drop the exclusion (per-variant label may stay).
3. **readOnly not threaded to the edit dialog or feeders**: `Input.vue:140-147` omits `:read-only` → on a serving repo, Save/autosave/frontmatter editing stay live (ConceptEditor defaults false; its own comment says "the steward must retract before editing"); feeder buttons (:69, :85, :97) not readOnly-gated — unlike Curate/RepoEditor which both thread it. Fix: thread the prop; add readOnly to feeder disabled conditions.
4. **Workbench delete has NO confirmation**: `ConceptList.vue:5-6` documents the contract "X → delete (parent confirms)"; RepoEditor confirms via dialog (`:250-267`); Input deletes on first click (`:395-408`). Fix: confirm dialog mirroring RepoEditor.
5. **Label affordance is a dead end**: Input passes `labelOptions: []` to the tree (`:56`) and nothing to the edit dialog — KH labels DISPLAY but cannot be SET (the inline select and the dialog's labels field have zero options). Fix: thread the repo's KH options (as RepoEditor does at `:78`) or hide the set-label affordance when empty.

### A8. Editor add-sources: tree refreshes at KICK time, never at completion
- **Evidence:** `RepoEditor.vue:567` dispatches `okf/fetchConcepts` immediately after the conversion kicks — but conversions are background 202 jobs. No poller/watch refreshes concepts on completion (the store's `pollCrawlConversions` updates only `reposById`). The sourceNote even concedes it: "topics land in the tree as conversions complete".
- **Fix:** after the kicks, poll the repo's conversion status to terminal (reuse the store poller or a light interval) then dispatch `okf/fetchConcepts` again.

### A9. Step 8 mounts the autocorrect panel as an UNCANCELLABLE modal (field freeze, 2026-09-29)
- **Evidence (David's live freeze on the deployed bundle):** `steps/Autocorrect.vue:39` mounted `<OkfAutocorrectPanel :visible="!!repoId">` with NO `@close` listener. The panel is a DsDialog — `Cancel`/`✕` emit `close` into the void, `visible` stays true, and the modal overlay walls off the entire wizard at step 8. Backing up to step 8 froze the session; only a page reload escapes (and it resumes at step 8 with the modal again).
- **Fix:** `inline` prop on AutocorrectPanel — the step renders the panel as an embedded card (no dialog, Apply in-body, nothing to cancel); the editor keeps its modal with its existing `@close`. Regression test asserts the step mounts NO DsDialog and carries the Apply control in-body. Companion: the `[OKF-ERR]` DIAG logger in httpService now honors the `silent` flag (the deferred 10.5 drafts endpoint no longer console-errors its expected 404).

---

## B. Corrective actions — accounting & D2 (spec'd, shallow)

### B1. Per-source merge accounting is a bare delta (E3.1/D2)
- **Evidence:** `Produce.vue:309-321` renders "+N new (total T)" only. Missing the D2 annotations ("2 auto-merged by slug", "3 near-dupes flagged"). Server-side: the crawl conversion DISCARDS the ingest summary that already computes created/updated (`crawl-conversion-service.js:502` ignores `ingestRepoConcepts`' return; contrast `producer-service.js:460-466` which persists one). The documents path produces NO accounting rows at all (`_currentId` only set in `kickNextCrawl`). Rows are component-local → lost on remount. First-leg delta includes the index concept (off-by-one; `crawl-conversion-service.js:661-677`).
- **Fix:** persist the per-leg ingest summary on the conversion record (mirror producer-service); render "N topics (M auto-merged)" from it; push a documents-batch row; persist `sourceLog` into the draft; exclude index rows from deltas/counts.

### B2. Near-dupe detection does not exist anywhere (D2 second half)
- **Evidence:** grep across okf-server for near.?dup/similar/fuzzy/levenshtein → no source require; only exact-id upsert + content-hash skip (`ingest-service.js:464-478`, silent, not flagged). No Curate markers (E5.3 unfed).
- **Fix:** fail-soft near-dupe pass (normalized-title similarity) in the conversion curation stage; stamp flagged pairs on meta rows; count on the conversion summary; feed Produce accounting + Curate markers. (P1-scale; schedule with T3 completion.)

### B3. Produced-topic preview is count-only (E3.2)
- Count includes index rows (over-reports); no names, no provenance, no jump-to-Curate. Fix: list produced topics (title + frontmatter sources provenance) with jump action; exclude index rows.

### B4. Conversion warnings never surface (E3.3, P2 but data already exists)
- `Produce.readProgress` (`:402-427`) reads only counters; the documents conversion record already carries per-file failures (`producer-service.js:388-392`). Fix: render `per_file` failures as inline warning rows; add crawl-leg warnings when B1's summary persistence lands.

---

## C. Honest not-started P1s (as planned in the story — confirm scope ordering)

| Item | Status | Note |
|---|---|---|
| E1.3/D3 crawler decision point + session handoff (T9) | missing | scaffold exists (`StudioTab.vue:565-583` consumes `okf:create-from-crawl`); no surface emits it with real ids; no session-file-ids endpoint |
| E4.1/D7 auto-label on Labels entry (T7) | missing | LabelOnboard is honestly preview-only (its own header says so); NO backend op exists (spec dep #3) — route/service/frontend all absent |
| E2.5/D8 round-trip UI (T8) | missing | **surprise: the export endpoint EXISTS** (`repos-routes.js:68` GET /:repo_id/export → zip, frontmatter preserved) — T8 is frontend-only wiring |
| E2.6 tree type-grouping | partial | index-pinned works; no type grouping/filter/chips (ConceptList `tree` computed `:381-387`) |
| E5.1/E8.1 checklists (T10) | missing/partial | only the Handoff step has a checklist; Review is a flat summary; no click-to-fix |
| E10.1 rail mini-tree | missing | right rail is a stats card with a COUNT (`StudioWizard.vue:94-97`) — the exact count-only state the story banned |
| E6.1 empty-body + dead-link checks | partial | conformance is frontmatter-only by design; EMPTY_BODY/DEAD_INTERNAL_LINK don't exist; non-PII issues not clickable |
| E2.6 formatted provenance ("pages 12–18") | partial | split path works; per-topic page provenance never rendered |
| E4.2 unlabeled count + jump | partial | derivable from "X of N labeled"; no explicit count/jump |

---

## D. Non-blocking deviations (record, decide later)

1. **Field naming:** spec says `crawl_seed_url`; implementation reuses `source_url` end-to-end (stamp → API → tooltip). Functionally consistent; rename only if the spec letter matters.
2. **Chip set:** All|Crawls|Uploads shipped (spec listed +Links; backend reserves `link`, nothing stamps it). Single-page link crawls stamp `crawl`.
3. **Session grouping:** picker rows are flat with a per-row crawl pill, not D1's "Crawl of naat.digital (47 pages)" groups — limited impact while session==file 1:1, becomes real when multi-file sessions exist (T9).
4. **Variant-shaped gate (E2.4 letter):** implemented variant-agnostic (any source OR any concept) — reads as the deliberate D6 interpretation; confirm as spec amendment.
5. **Stale comment:** `OkfSourceDialog.vue:172-174` says the crawl variant hides upload; behavior is D6-correct (all feeders). Fix the comment.
6. **Editor add-sources hardcodes classification 'heuristics'** (RepoEditor.vue:548) while the wizard exposes a user select — acceptable editor default.
7. **Restart-resume is session-scoped** (drafts are Vuex-only; server drafts = Story 10.5, out of scope).

## Recommended execution order

1. **P0 defect batch (A1–A8):** A1 auto-correct dead scan · A2 origin-keyed dispatch · A3 mid-chain wedge · A4+A5 locale purge & missing keys · A6 bogus ids · A7 workbench five · A8 editor refresh. All small, testable, no new backend surface (A2/B1 aside).
2. **B1 accounting persistence** (okf-server, small) — unblocks B2/B3/B4 display.
3. **P1 slice re-plan:** T7 auto-label (needs backend dep #3) · T8 round-trip (endpoint already exists — cheaper than planned) · T9 decision point + real handoff · T10 checklists + mini-tree · type-grouping.
4. David rules: step-6 "before publishing" framing (A4); variant-agnostic gate as amendment (D.4).

**Verification gate for the P0 batch:** every fix lands with a test that FAILS without it (A1's dead-scan is the cautionary tale — the props-only test kept a dead step green), the locale purge verifies by extraction (old strings ABSENT in all 14 files, with counts), and the bundle check repeats the NEW-present/OLD-absent rule on the running container.
