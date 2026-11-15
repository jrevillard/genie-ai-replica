---
title: 'Editor surface — split entries, seam preview, store, i18n'
type: 'feature'
created: '2026-11-15'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '374c2bbd3388b975265750da435ad19b78b11a54'
context:
  - '_bmad-output/specs/spec-okf-curator-split/SPEC.md'
  - '_bmad-output/specs/spec-okf-curator-split/implementation-grounding.md'
  - '_bmad-output/implementation-artifacts/issue-1577-curator-split-backend-story.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The split API (MR !888) has no affordance: a steward who hits `CONCEPT_TOO_LARGE` is told to split but has no button. CAP-3's contract — "legible before, provable after" — has no surface.

**Approach:** Add a split affordance to BOTH editor surfaces (concepts-tree row action + concept pane, next to the ceiling advisory, both read-only-gated), a confirm dialog that previews the proposed seams and per-part sizes BEFORE any write (server preview endpoint — the ONE engine computes the seams; no client-side port), a Vuex action riding the story-1 endpoint, i18n in every locale, and the smoke/e2e UI leg. After a successful split the tree refreshes showing part 1 under the original id + parts 2..N suffixed.

## Boundaries & Constraints

**Always:**
- DS primitives + tokens only (`DsDialog`, `DsPill`, DS buttons); Options API; the editor's `readOnly` prop gating on both entry surfaces; the preview renders BEFORE any write happens (CAP-3).
- The preview and the write run the SAME server-side preflight — one seam engine (`splitConceptBody`), one ceiling (`maxConceptDocChars()`), no second algorithm client-side.
- i18n keys in ALL 14 locales, deep-key-identical, inserted verbatim (escape-safe strings); real translations for leaves ≥25 chars (the untranslated-leaf guard).
- `data-test-id` (hyphenated) spelling — the OKF surface's convention; new testids: tree-row split action, pane split action, preview dialog + its per-part rows, confirm action.
- Errors surface through the store's `{ok, code, message}` contract; refusal codes (TOO_LARGE/WITHIN_CEILING/TOO_MANY_PARTS/PART_ID_CONFLICT/READ_ONLY) render their messages verbatim.

**Never:**
- No client-side reimplementation/port of `splitConceptBody` (the drift this whole initiative forbids).
- No change to repo-level resplit machinery (ResplitModal, `okf/resplitRepo`, `/resplit`), the wizard, charts/UnifiedAnalytics (scope fence), chat surfaces, or the backend write semantics of the split route (story-1 contract is frozen; the preview endpoint is additive and writes nothing).
- No batch/multi-select splitting; no manual seam editing (SPEC non-goals).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview happy | draft repo, over-ceiling concept, admin token, split invoked | dialog shows per-part rows (id, path, chars ≤ ceiling) + ceiling line; confirm enabled | preview fetch fails → error line in dialog, confirm disabled |
| Confirm happy | preview confirmed | POST split → dialog closes, tree refreshes, part 1 selected, success toast with created/updated counts | write refusal → message rendered verbatim in dialog, dialog stays open |
| Within-ceiling | concept fits | preview answers within-ceiling → confirm disabled, message states nothing to split (the affordance may still be offered for granularity) | N/A |
| Unsplittable | one line over ceiling | preview answers unsplittable + reason → confirm disabled, remedy shown | N/A |
| Part-id conflict | unrelated `foo-part-N` row exists | preview lists the colliding ids → confirm disabled, resolve advice shown | N/A |
| Read-only / serving | repo ingested (`readOnly`) | split affordances HIDDEN on both surfaces (same gating as delete) | N/A |

</frozen-after-approval>

## Code Map

- `components/okf-server/services/concept-split-operation.js` — extract the preflight (getConceptMeta → splitter → within-ceiling/cap/collision checks) into an exported `previewConceptSplit(repoDoc, concept_id)` returning the plan or the typed refusal; `splitConcept` reuses it (one refusal source). NO write-path change.
- `components/okf-server/controllers/repository-controller.js` + `routes/repos-routes.js` — additive `GET /:repo_id/concepts/:concept_id/split-preview` (admin scope, getById read fence, NO assertWritable, zero writes), mirrors the POST's gate order minus the write.
- `components/gov-chat-frontend/src/components/okf/editor/ConceptList.vue` — tree-row glyph button in the existing `okf-cl__actions` spans (lines ~121-152 root, ~204-232 child), emits `split`; child rows get their first testid.
- `components/gov-chat-frontend/src/components/okf/editor/ConceptEditor.vue` — split button beside the ceiling advisory (lines ~295-307, `data-test-id="concept-ceiling"`); emits up; `readOnly` prop already gates.
- `components/gov-chat-frontend/src/components/okf/editor/RepoEditor.vue` — owns the dialog (the ResplitModal pattern: `resplitOpen` at :29, handler :386-392); wire both entries' emits; refresh via `okf/fetchConcepts` + reselect part 1.
- `components/ds/Dialog.vue` (DsDialog) — the modal primitive (props visible/title/size/actions, @close/@action); ResplitModal.vue is the flow template; AutocorrectPanel.vue is the preview-then-apply template.
- `components/gov-chat-frontend/src/store/modules/okf.js` — add `splitConcept` action (`{ok, code?, message?, ...summary}`, never throws, `setError` on failure, `fetchConcepts` refresh) beside `deleteConcept` (:842) / `resplitRepo` (:1133).
- `components/gov-chat-frontend/src/services/repoOkfService.js` — add `splitPreview(repoId, conceptId)` + `splitConcept(repoId, conceptId, actor)` mirroring `resplit` (:272).
- `src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js` — `okf.editor.split.*` namespace; en first, then real translations (the ≥25-char untranslated-leaf guard + placeholder parity).
- `tests/e2e/okf/concept-ceiling.spec.js` — extend with the UI leg (stubStudioRepoRoutes + openStudioRepo helpers; assert preview renders before write, confirm flow, refusal states).
- `data/okf/smoke-test/run-smoke-split.js` — add the preview-endpoint leg (preview before POST, same 32+assertion harness).
- NOT TOUCHED: StudioWizard + steps, charts/, UnifiedAnalytics.vue, chat surfaces, ResplitModal/`okf/resplitRepo` machinery.

## Tasks & Acceptance

**Execution:**
- [x] `components/okf-server/services/concept-split-operation.js` -- extract + export `previewConceptSplit` (typed plan/refusal), reuse in `splitConcept` -- one refusal source, server-side seams
- [x] `components/okf-server/controllers/repository-controller.js` + `routes/repos-routes.js` -- GET split-preview route (admin, read fence, no writes) + unit pins -- the preview API
- [x] `components/okf-server/__tests__/concept-split-operation.test.js` + `repos-routes.test.js` -- preview pins (plan shape, refusals, zero writes, read fence) -- the write path must not change
- [x] `components/gov-chat-frontend/src/services/repoOkfService.js` -- `splitPreview` + `splitConcept` client methods -- the API client
- [x] `components/gov-chat-frontend/src/store/modules/okf.js` -- `splitConcept` action + tree refresh + part-1 reselect -- the store contract
- [x] `components/gov-chat-frontend/src/components/okf/editor/ConceptList.vue` -- row split glyph (root + child rows, readOnly-gated, emits) -- tree entry
- [x] `components/gov-chat-frontend/src/components/okf/editor/ConceptEditor.vue` -- split button beside the ceiling advisory, readOnly-gated -- pane entry
- [x] `components/gov-chat-frontend/src/components/okf/editor/SplitPreviewModal.vue` (new) + `RepoEditor.vue` wiring -- DsDialog: preview rows (id/path/chars), ceiling line, refusal states, confirm -- CAP-3's legible-before
- [x] `src/i18n/locales/*.js` (14) -- `okf.editor.split.*` keys, en + real translations, verbatim -- localeConsistency + surface contract gates
- [x] `tests/e2e/okf/concept-ceiling.spec.js` -- UI leg: preview-before-write, confirm, refusal render -- the Playwright pin
- [x] `data/okf/smoke-test/run-smoke-split.js` -- preview leg + run live on the local build -- the story-1 harness stays whole
- [x] `components/okf-server/services/crawl-conversion-service.js` -- validate `source_document.url` scheme at the stamping site (http/https only, reject/strip others) + regression pin -- baseline F-1 (server half)
- [x] `components/gov-chat-frontend/src/components/okf/editor/RepoEditorShell.vue` -- guard the crawl-seed anchor `:href` with the existing `isExternalUrl` allow-list (fall back to plain text) + pin -- baseline F-1 (frontend half)

**Acceptance Criteria:**
- Given a draft repo with a seeded over-ceiling concept, when the steward clicks split on the tree row or the pane, then the dialog renders the seam preview (per-part ids/sizes, ceiling) BEFORE any write, and confirming refreshes the tree showing `-part-N` siblings with part 1 selected.
- Given a read-only (serving) repo, when viewing either surface, then no split affordance renders (same gating as delete).
- Given any refusal state (within-ceiling, unsplittable, conflict, read-only), then the dialog states it verbatim and the confirm stays disabled or the write refusal renders — the corpus never changes from a preview.
- Given the 14-locale suite, then localeConsistency + okf-surface-i18n-contract pass.
- Given the full frontend + okf-server suites, then all green with coverage never decreasing.

## Implementation Notes

- Baseline `/security-review` (pre-change, 2026-11-15): ONE finding — **F-1 (medium, conf 8, pre-existing)**: caller-supplied `source_document.url` is stamped unvalidated (`crawl-conversion-service.js` stampSourceDocument) and rendered as a raw `:href` anchor (`RepoEditorShell.vue:65`) → stored XSS via a `javascript:` scheme; amplified by tokens-in-localStorage. Disposition per the dispatch contract: **FIXED in this change set** (the two F-1 tasks above — server scheme validation at the stamping site + the frontend `isExternalUrl` guard). Everything else examined clean; carry-in rule: the new dialog renders TEXT only (no v-html); if any URL ever renders, it goes through the `isExternalUrl` allow-list (`src/utils/document-opener.js`).

## Spec Change Log

## Review Triage Log

| # | Finding (source) | Verdict | Evidence / routing |
|---|---|---|---|
| 1 | Stale preview race — modal `load()` has no request token; concept A's slow response can overwrite concept B's plan while confirm POSTs B (code-review F1, edge-case 1, blind-hunter 3) | **medium** | Verified in SplitPreviewModal.vue: the always-mounted dialog's `visible` watcher fires `load()` per open with no token; last-resolve wins → the displayed plan can belong to another concept than `conceptId` (CAP-3 broken in a race window; the WRITE stays safe — the server re-preflights). → **patch G1** |
| 2 | After a write refusal the old plan stays armed — confirm re-offers a split the server just refused (blind-hunter 2) | **low** | Verified: `onConfirm` refusal path keeps `plan`; the corpus is safe (server refuses again) but the dialog re-offers a known-refused action. → **patch G1** (re-preview on write refusal) |
| 3 | `REPO_NOT_FOUND` missing from the modal's REFUSAL_CODES — a repo deleted/scope-lost between render and fetch renders the generic line instead of the verbatim message (edge-case 2) | **low** | Verified: the preview controller throws exactly that code. → **patch G1** |
| 4 | Dead split glyph in the wizard workbench — steps/Input.vue mounts ConceptList with no `@split` handler (blind-hunter 1, edge-case 6) | **medium** | Verified: the glyph renders (readOnly=false on a draft) and emits into the void on a second shipped surface. → **patch G2** (show-split prop, wizard passes false) |
| 5 | Unsaved pane edits silently discarded by a successful split (blind-hunter 7, edge-case 7) | **medium** | Verified: `onSplitDone`'s reload-key remount re-reads the SAVED body; a dirty draft vanishes without warning while the preview described the saved body. → **patch G3** (dirty-hint warning line in the dialog) |
| 6 | F-1 predicate mismatch — `/i` stamp admits uppercase-scheme URLs the case-sensitive client gate demotes to plain text (code-review F2, edge-case 8) | **low** | Verified: fail-safe (never executes) but the two gates disagree and the comment claims "the same allow-list". → **patch G4** (case-sensitive stamp test) |
| 7 | Crawl-seed render gate has NO test — reverting RepoEditorShell to the raw anchor keeps the suite green (verification-gap V1) | **patch** | Pre-verified by the gap layer (mutation-demonstrated). → **patch G5** |
| 8 | Pane `@split` wiring untested — deleting the listener keeps every test green (verification-gap V2) | **patch** | Pre-verified. → **patch G5** |
| 9 | `onSplitDone` toast substitution + part-1 reselect unobserved (verification-gap V3) | **patch** | Pre-verified. → **patch G5** |
| 10 | Preview payload exclusion pinned by toMatchObject only — a `...plan` spread would leak bodies+meta with a green suite (verification-gap V4) | **patch** | Pre-verified. → **patch G5** (exact key-set assertion) |
| 11 | E2E route mocks hand-rolled instead of the mandated `runRouteHandler` wrapper (code-review F4) | **low** | Verified against tests/e2e/CLAUDE.md's own mandate; teardown-flake consequence. → **patch G6** |
| 12 | Dead hover rule — `.okf-cl__action--split:hover` restates the base `:hover` verbatim (code-review F3, blind-hunter 14) | **low** | Verified. → **patch G7** (delete) |
| 13 | Polymorphic `onSplitAsk(nodeOrId)` — one emitter sends the id, the other the node (blind-hunter 12) | **low** | Developer-only union contract; collapse to one shape. → **patch G7** |
| 14 | Smoke vacuous passes — `every([])` + `Math.max(-Infinity)` on a degenerate planned array (blind-hunter 15, edge-case 9) | **low** | Harness hygiene. → **patch G7** |
| 15 | User-facing docs stale — okf-studio.md's action list lacks split; ENVIRONMENT.md's ceiling paragraph names no escape hatch (blind-hunter 10, 11) | **low** | User-facing docs of shipped code ride the MR (the docs-merge exception). → **patch G7** |
| 16 | Test-harness inconsistency — hand-rolled mount + CSS-class locator in one unit test (blind-hunter 13) | **low** | Folded into G5's test work (use the established `mountEditor` helper). |
| 17 | Collision TOCTOU — `-part-N` created between the preflight check and the upserts (edge-case 5) | **defer** | Pre-existing story-1 window, width unchanged by this diff (the security layer measured it); same-repo admin×admin, sub-second. Not this story's regression. |
| 18 | Plan with empty/missing parts arms confirm blind (edge-case 3) | **false** | Unreachable: the only producer of `ok:true` is our controller, which always serializes `parts` from a plan that refused anything < 2 parts. |
| 19 | Unconditional affordance → guaranteed refusal for within-ceiling concepts (blind-hunter 8) | **false** | The frozen I/O matrix row explicitly accepts offer-then-refuse ("the affordance may still be offered for granularity"); the SPEC's assumption line names finer granularity as legitimate. Design, not defect. |
| 20 | Degenerate toast on an empty 200 body (blind-hunter 9) | **false** | Same unreachability as #18 — the server always answers the full summary. |
| 21 | Pane entry has no browser-level test (blind-hunter 6) | **false (after #8)** | The dead-wiring scenario the finding fears is killed by patch #8's unit pin; the browser suite proves the dialog itself. |

## Design Notes

- Preview endpoint = the same preflight the POST runs, minus the write: `previewConceptSplit` returns `{ok, plan:{parts:[{concept_id,path,title,chars}], ceiling, conflicts?, within_ceiling?, unsplittable_reason?}}` or `{ok:false, code, message}` — the dialog maps codes 1:1 to states. Confirm then POSTs; a post-preview mutation race is answered by the write path's own refusals (PART_ID_CONFLICT et al.) rendered verbatim.
- The dialog disables confirm until a successful preview lands; a preview failure renders its message and leaves the dialog open (never a half-informed confirm).

## Verification

**Commands:**
- `cd components/okf-server && npx jest --testMatch "**/__tests__/**/*.test.js"` -- expected: all green, coverage ≥ baseline
- `cd components/gov-chat-frontend && npm test` -- expected: all green incl. localeConsistency + okf-surface-i18n-contract
- `npm run lint` (both components) + `npm run format:check` -- expected: clean
- `npm audit` (both touched JS components) -- expected: report severity + fix availability; ZERO new dependencies
- Deploy to the local build (classic builder) + live smoke + e2e UI leg before merge -- expected: SMOKE OK, spec green

- Round complete (2026-11-15): the review cycle ran 5 layers (baseline + post-diff security — NO
  FINDINGS, the F-1 fix verified sound; /code-review high — 4 findings; blind-hunter — 15;
  edge-case — 9; verification-gap — 4 pre-verified). Triage: 16 patch fixes applied, 1 defer
  (collision TOCTOU → deferred-work.md), 4 false with refutations (see the Triage Log). /simplify:
  4 agents — 3 applied (the write reuses the plan title lineage — one computation; the refusal
  ORIGIN classification moved into repoOkfService.splitPreview as serverRefusal, deleting the
  modal vocabulary copy + adding the drift pin; the editor test scaffold deduplicated into ONE
  mountEditorFor), 3 skipped with reasons (shared URL predicate = #1692 scope; DsDialog :actions
  extension = a shared-primitive decision; okf.editor.split.open/.title = distinct slots).
  Suites: okf-server 2357/2357, frontend 4540/4540. Remaining before merge: local-build deploy
  + live smoke + the e2e venue leg.
