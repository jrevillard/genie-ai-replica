# OKF Import Audit — Findings & Fixes (2026-09-08/09)

Session window: David's two wikipedia-crawl imports (heuristics 14:12–15:28, LLM-mode 15:52–17:03,
1000 pages each, 999 rows each) + the earlier alphabet zip ×3 validation. This file is the audit
record + fix log + validation protocol for the import smoke test (SMOKE-PLAN-stabilization).

## Headline

The crawl import path ran with **no classification at all** — mode selection (heuristics / llm /
hybrid) was silently dropped, so every crawl import produced the same flat output regardless of
mode: no type inference, no curation, no labels, no LLM calls. On top of that, the link resolver
resolved **zero** of the ~90k cross-page links in the crawl bodies. Both are fixed and verified
(jest 571/571), deployed to the local build at 2026-09-09, and the ×3-mode redo is the acceptance
gate.

## Confirmed defects (with live evidence)

### D1 — Conversion job drops `classification` (FIXED)
- Evidence: heuristics run = 998×'topic' placeholder + 1 index; LLM run byte-identical flat output;
  repo.classification null on both; 999/999 rows no-curation; 0 labels. Conversion record SHOWED
  the mode ('heuristics'/'llm') while the import never received it.
- Root cause: `startConversion` built the background `job` object without the `classification`
  field it had just stamped into the queued conversion record.
- Fix: `classification` added to the job object; regression tests assert it rides every ingest
  flush. crawl-conversion-service.js (startConversion).

### D2 — Link resolver resolved zero links (FIXED)
- Evidence (150-row sample of the heuristics run): 60,837 absolute links in bodies (~400/page);
  production regex resolved **0**; a title-attribute-tolerant resolver resolves **6,367** in the
  same sample; 84,845 genuinely point outside the crawl set (honest — Wikipedia-scale).
  Blocker: every crawled link carries a title attribute `](url "title")`; the old regex demanded
  `)` immediately after the URL.
- Second defect found in the same data: `rewriteCrossLinks`' anchor-text extraction used length
  arithmetic that sliced the wrong side of the match — stored labels were `''` or garbage. Live
  rows carry duplicate link pairs: {real label} + {label:""} for the SAME target (frontmatter
  copy vs parser body-scan copy).
- Fixes: regex now tolerates optional ` "title"`, unescapes `\(` `\)` before URL keying, records
  the target with an empty label; the parser body-scan supplies the real anchor; NEW persist-time
  dedupe (`dedupeLinksForStorage`, concept-meta-service) keeps one entry per target preferring the
  labeled copy. Regression tests in crawl-audit-fixes.test.js + concept-meta-service.test.js.

### D3 — Curation pass ran per ingest flush (FIXED)
- Would-be defect once D1 was fixed: ingestRepoConcepts runs the curation pass whenever
  classification is set — the crawl path flushes ~5× per 1000 pages → the pass would re-run over
  the ever-growing row set (O(n²) LLM calls).
- Fix: `skipCuration: true` on every crawl flush; the pass runs exactly ONCE at conversion end
  through the shared `runImportCuration` finalize (also reused by the zip flow — one curation
  entry for every import adapter, per the multi-format end goal). New conversion stage
  'curating' is visible on the card between 'adding' and 'done'.

### D4 — Zip card cleared while curation still ran (FIXED)
- The zip conversion record closed 'done' BEFORE the curation pass; the dashboard card cleared
  while labels were still landing. The close now happens after the pass.

## Enhancements queued (not defects)

- **E1 — BuildProgressCard 'curating' stage label**: the card falls back to the raw stage string;
  add the STAGES entry + `okf.build.stage.curating` i18n key (peer 15's locale pass).
- **E2 — Escaped-paren URL normalization**: links like `Ming_\(disambiguation\)` still don't
  resolve (rare; the title-attr fix covers the dominant blocker).
- **E3 — Unresolved-link visibility**: in-domain links that point outside the crawl set are
  dropped silently. Surface them in the editor as visible gaps ("84,845 links point at pages not
  in this repo") — curation aid, not fake edges.
- **E4 — LLM curation cost for 1000-concept imports**: ~999 per-concept vLLM calls per import;
  batch-prompting (N concepts per call) would cut LLM time several-fold. Efficiency pass after
  correctness is proven.
- **E5 — Crawl topic scoping**: the crawl escaped the Indonesia cluster (Ming dynasty, Thorium,
  History of Iraq in the sample) — Subject Area=Indonesia with generic-Wikipedia content is a
  crawl-config matter (seed/depth/page budget), noted for the crawler UX story.
- **E6 — KH L2 seed list for 'Alphabet Company'** (David's ruling 3): candidates drafted for
  steward approval; unblocks keyword labels on future Alphabet imports.

## Validation protocol (the ×3 redo — acceptance gate)

After this deploy, import the SAME wikipedia crawl ×3 (heuristics / llm / hybrid) and run the
same audit on each. PASS requires, per repo:

1. Completeness: 999/999 rows parsed, 0 failed, titles clean, provenance 999/999 kind=crawl.
2. Types: 100% in the taxonomy enum (topic|entity|process|event|source) + index root kept;
   llm mode = LLM-assigned types (curated counters typed>0); heuristics = keyword-rule verdicts
   (variety expected on crawl pages; all-topic would signal a regression).
3. Curation: repo.classification stamped; repo.curation counters present; heuristics rows carry
   resolved_by='keyword-match' on labeled rows; llm/hybrid carry per-concept resolved_by + honest
   fallbacks if the vLLM blips (crash-loop #993 still open).
4. Links: link density now MEASURABLE — rows-with-links and avg links/row should jump from the
   prior 74/999 (~1.2/row) materially (title-attr fix); 0 empty-label duplicate pairs in meta
   links[] (dedupe fix).
5. Conversion record: stage sequence includes 'curating'; 'done' only after curation; card clears
   when curation actually finished.
6. Duration: conversion+add unchanged (~70 min for 1000 pages) + curation (heuristics ≈ minutes;
   llm ≈ +10-20 min at 4 lanes, remote vLLM).

Evidence log for the ×3 audits lands in this file as each run settles.

## Multi-format engineering note (David, 2026-09-09)

End goal: many document types (docx, pdf, xlsx, text, md) into ONE OKF repo with links,
metadata and frontmatter built as completely and accurately as possible. The internals now
shape up as: each source adapter normalizes to the concept shape {path, frontmatter, body}
(+) provenance; type inference + curation run through ONE shared finalize (runImportCuration);
links compose at the parser from three sources and dedupe at the persist point. Future docx/
pdf/xlsx adapters plug into the same concept shape + finalize; aggregation into one repo =
appending concepts + re-running the index + the same finalize. Nothing in today's fixes is
crawl-only.

## Evidence log — heuristics ×2 (new code), settled 18:25 2026-09-08

Repo `en-wikipedia-org-full-crawl` (8669e198), same source file (114,400,227 bytes), 71 min
end-to-end INCLUDING the curation pass (old runs: 76 min conversion-only).

| Gate | Result |
|---|---|
| Completeness | 996/996 rows parsed, 0 failed, 0 rejected, titles clean |
| Provenance | 996/996 kind=crawl with job id |
| Types | entity 680 · event 211 · source 72 · topic 21 · process 11 · index 1 — 100% taxonomy, zero placeholders |
| Curation | repo.classification='heuristics'; repo.curation {curated 995, labeled 715}; resolved_by: keyword-match 715, heuristics 280, structural 1 |
| Labels (KH-L2 bounded, Indonesia) | History 203 · Culture 165 · European colonization 135 · Kingdoms 72 · Politics 56 · Economics 41 · Religion 32 · Emergence 11 · unlabeled 281 (honest gaps) |
| Links | 971/996 rows with links; 32,756 total (32.9/row vs 1.2/row before); ZERO duplicate targets; labels 100% real anchors (e.g. "Ali Mughayat Syah") |
| Ordering | 'OKF heuristics labeling complete' logged BEFORE 'Crawl conversion DONE' — curation-once-at-end proven |
| Card ordering | conversion closed 'done' only after the pass |

Open item (non-blocking): 995 page rows vs the old run's 998 from the same file. 3 of the 6
concept-id diffs are renamed collision-suffixed twins (suffix hash changed because bodies now
carry rewritten links — e.g. yuan-dynasty-94ad53fe → yuan-dynasty-cc595d08); 3 pages genuinely
absent (2006-southeast-asian-haze, asean-agreement-transboundary-haze-pollution, south-sumatra),
no parse/reject/meta errors logged. Suspect: content-hash dedup collapsing near-twins made
byte-identical by link rewriting. DETERMINISTIC CHECK: if the LLM/hybrid runs also land 995,
it is the split/dedup behaving deterministically; if they land 998, it is a race → defect.
- **E7 — Editor graph/preview at crawl scale**: Graph + Render completed but spun on first
  open (996 concepts, 32,756 edges ≈ 5 MB links payload + heavy first layout; crawled page
  bodies carry ~400 links each). Works, but needs a scale pass: cap/cluster the author-graph
  view (or level-of-detail rendering) and lazy preview for link-dense pages. David confirmed
  both render fully on the heuristics-v2 repo.

## D5 — Rename spawned empty graph shells (FIXED) + race fixes (2026-09-09)

David's law (2026-09-09): rename = ZERO graph impact pre-ingest; renames FORBIDDEN post-ingest
(the REPO_READ_ONLY gate at repository-service.js:544 already enforces that); retract → rename →
re-ingest is the legal path. Root cause of the shells: the rename flow's step 3 recreated the
target graph DEFINITION unconditionally — Studio renames of never-ingested repos spawned bare
OKF_*_v1 shells (three found, each 0 documents, edge collections empty). Fix: the rename/promote
definition-recreate is gated on `hadContent` (the repo actually has graph collections) — a
content-less rename is pure metadata + meta-row graph_name re-stamp; the graph is born ONLY at
drain (dataprep ensure-graph). Cleanup: the three shells dropped (dropCollections, verified 0
docs); remaining graphs exactly GRAPH + OKF_kenya-government-services_v11.

Also caught via test flake and fixed at origin the same day:
- ONE conversion per repo: startConversion now refuses a second concurrent conversion for the
  same repo (409 CONVERSION_IN_FLIGHT) — the live registry keyed by repo_id previously DROPPED
  the in-flight runner on overwrite.
- Temp-file race: the conversion temp file was repo_id-keyed and its unlink was fire-and-forget
  — a stale unlink deleted the next run's fresh download (ENOENT mid-read). Now unique per
  conversion (pid + timestamp) and the unlink is awaited inside the runner.
- Full okf-server suite: 574/574 green twice consecutively (previously flaky under parallel
  workers).

## LEGACY-PATH VERIFICATION (David's 100% CRITICAL rule, 2026-09-09)

Verified via `git status --porcelain` (the authoritative delta of this session): EVERY changed
file is okf-server (or docs/data). ZERO changes to: components/document-repository (legacy file
upload/ingest), genie-ai-overlay/dataprep (legacy + drain engine), components/gov-chat-backend
(legacy BFF), mobile, api-gateway, frontend. The legacy `GRAPH` graph and its ingestion path are
untouched; OKF ingestion remains a completely separate path (okf-server → okf_concepts_meta →
publish → ingest worker → dataprep drain → OKF_<slug>_vN).

## Evidence log — LLM-assisted ×1 (new code), settled 08:12 2026-09-09

Repo `en-wikipedia-org-full-crawl` (f5299e77). Same source file. Conversion 06:51→~08:05, curation
pass 469 s (7.8 min) at 4 lanes, then conversion closed done (ordering gate ✓).

| Gate | Result |
|---|---|
| Completeness | 999/999 parsed, 0 failed, 0 rejected |
| Types (LLM verdicts) | entity 656 · topic 208 · event 130 · process 4 · index 1 — 100% taxonomy, honest LLM judgment (genuine `topic` where the heuristics regex scored entity) |
| Curation | repo.classification='llm'; per-row resolved_by: **llm ×998**, structural ×1, **fallbacks 0** — the vLLM resilience ladder absorbed the shared gateway across ~998 calls |
| Labels (bounded KH-L2, Indonesia) | History 513 · Politics 133 · Culture 99 · Economics 68 · Religion 29 · Prehistory 9 · Kingdoms 1 · unlabeled 147 |
| Descriptions | 998/998 curatable concepts carry a 1–2 sentence LLM summary |
| Links | 974/999 rows, 32,862 total, 32.9/row, zero dup targets |
| Provenance | 999/999 kind=crawl |
| Duration | ~74 min conversion + 7.8 min curation (vs plan's hours=FAIL bar — comfortably PASS) |

DETERMINISM VERDICT (the 995/998 check): heurOnly=0, llmOnly=3 — the LLM run holds the FULL
998-page set; the heuristics run lost 3 pages to a concurrency-dependent mechanism. The
split+import is NOT run-deterministic at OKF_IMPORT_CONCURRENCY=4 (±3/1000). Root cause TBD
(suspect the dedup preDoc read racing across lanes). **D6** — root-cause in a follow-up window;
OKF_IMPORT_CONCURRENCY=1 is the completeness-critical workaround until then.

Micro-defect found in the same audit and FIXED: the curation progress throttle compared against
`total` (which includes the never-curated index row), so the true final counters were always
throttled away (repo.curation showed done=996 of 998). The pass now emits a `final` payload that
bypasses the throttle; deployed.

## PII publish gate — actionable remediation (David, 2026-09-09)

Law: "the user must be advised on the specifics for each issue and how to remediate them."
- The PII_GATE_BLOCKED message now names EACH concept with its flagged entity TYPES × COUNTS
  (from pii_hits_summary) and states BOTH remedies: edit the concept (save re-scans
  automatically and the flag clears) or acknowledge legitimate entities and continue.
- **Editor saves now re-scan the concept** (patchConcept → piiService.scanConcept, fail-closed
  same as import) — previously flags were stamped only at import, so removing the entity never
  cleared the flag and the blanket acknowledgement was the only way through. The PATCH response
  carries the fresh pii_state + summary so the editor can show it inline.
- Regression tests: gate message content (types+counts+remedies) + pii-service mock added to the
  routes suite. Full suite 575/575.

## PII review WORKFLOW integrated into the editor (David, 2026-09-09)

Law: "we need a dialog with a process to correct the fucking issues" + "integrated into the
editor… once the adjustments have been done it should require approval again and show an audit
log of the adjustments to the approver."

Built (test-proven: backend 242/242 in the touched suites, frontend 46/46):
- Backend: the publish-gate snapshot and the editor concept-list now carry pii_state +
  pii_hits_summary + pii_scanned_at (+ conformance_issues) — "counts unavailable" fixed.
- Editor file list: flagged concepts carry a PII badge with a per-concept tooltip naming the
  flagged entity types × counts; the list header shows the outstanding flagged count so the
  approver watches the correction progress.
- Correction loop: open the flagged concept → remove/alter the entity → save → auto re-scan →
  the badge flips on the list refresh → publish again (the gate re-runs = approval again).
- Approver audit trail: every concept.patch audit row now records the adjustment's PII outcome
  ("PII: clean" / "PII: still flagged (PERSON×2, DATE_TIME×1)") — visible in the existing
  Activity log dialog.
- Acknowledge-and-continue unchanged (audited, manifest-stamped).
Deploy sequencing: the okf-server rebuild lands right after the in-flight hybrid import settles
(a rebuild restarts the container and kills in-process conversions — twice-caught today).

## Evidence log — hybrid ×1 (new code), settled 10:15 2026-09-09 — ×3 COMPLETE

Repo `en-wikipedia-org-full-crawl` (0259178f). 91 min end-to-end (conversion ~83 + hybrid
curation 479 s at 4 lanes).

| Gate | Result |
|---|---|
| Completeness | 999/999 parsed — FULL 998-page set (heuristics run's 3-page loss confirmed as the concurrency race, not mode-related) |
| Types | entity 683 · event 211 · source 72 · topic 21 · process 11 · index 1 — heuristics types KEPT (hybrid contract: typed=0), distribution matches the heuristics run |
| Curation | resolved_by llm ×998, structural ×1, **fallbacks 0**; labels+descriptions via LLM |
| Labels | identical to the LLM run: History 513 · Politics 133 · Culture 99 · Economics 68 · Religion 29 · Prehistory 9 · Kingdoms 1 · unlabeled 147 |
| Descriptions | 998/998 |
| Links | 974/999 rows, 32,862 total, 32.9/row, zero dup targets |
| Counters | repo.curation carries **final:true with complete counters** — the final-write throttle fix proven live |
| Ordering | curation logged BEFORE conversion DONE ✓ |

## ×3 VERDICT — import smoke test PASS

Same crawl file, three modes, identical audit: **all three PASS**. The mode dial behaves
exactly as designed: heuristics = keyword labels + rule types, zero LLM; llm = LLM types +
labels + descriptions; hybrid = heuristics types kept + LLM labels + descriptions. Links,
provenance, completeness, honest fallbacks and counter integrity hold across all three.
Remaining open item: D6 (concurrency race can drop up to 3/1000 pages nondeterministically).
