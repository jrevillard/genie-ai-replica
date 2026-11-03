# Stage 1 Defect Registry & Remediation Plan — 2026-09-07

**Trigger:** David's Stage 1 verdict = **REJECT — batch-fix first** (interview,
2026-09-07). Sections A (editor rework) and B (delete idempotency): **ALL PASS**.
Sections C/D/E (re-imports + verification): multiple FAILs, registered below.
**Directive:** debug in detail through the logs, explain, fix each issue, distribute
to sessions, supervise — ready for re-test.
**GitLab tracking (David, 2026-09-07: all fixes documented as issues):**
D-A→**#979** · D-B→**#980** · D-C→**#981** · D-D→**#982** · D-E→**#983** ·
D-F→**#984** · D-G→**#985** · D-H→**#986** · D-I→**#987** · D-J→**#988** ·
D-K→**#989** · D-L→**#990** — every fix MR must reference its issue IID.

**Test setup:** alphabet v0.2 zip + en-wikipedia full crawl, each imported TWICE
(Heuristics and "LLM assisted"; repo names containing LLM). Verified in DB:
`Alphabet Company Information` (5fa975f7, 17 concepts, draft) + `Alphabet LLM
Company Information` (7b6b823c, 17 concepts, draft) — **identical counts confirm
the LLM mode was a no-op (D-B)**.

---

## D-A · CRITICAL — Index concept loses its flag → flat repo, broken index/TOC

**Symptom (David):** expected tree structure; Alphabet import is flat;
"index.md and relationships look broken".
**Root cause (verified):** `concept-meta-service.js:124` — `is_index: fm.type === 'index'`.
The flag derives ONLY from the frontmatter type literal `'index'`. David's bundle
root carries the authorial type `"BundleRoot"` (which the import correctly refuses
to clobber) → `is_index=false` on the true index.
**Evidence (ArangoDB, Alphabet heuristic repo, index row):** `concept_id: "index"`,
`path: "index.md"`, `type: "BundleRoot"`, `links: [16]`, **`is_index: false`**.
Every tree/TOC/index-hub surface keys off `is_index` (concept-meta-service.js:400,435,445;
bundle-export-service.js:76; edge-service root stamping; graph index-hub toggle).
The lifecycle smoke bundle passed only because its root used `type: 'index'`.
**Fix (65):** derive `is_index` as `fm.type === 'index' || path === 'index.md' ||
concept_id === 'index'` (authorial type never blocks index detection); backfill
existing rows (both alphabet repos, both wikipedia repos — any repo with an
index-path row where is_index=false). Tests: BundleRoot-typed root is flagged;
authorial type preserved.

## D-B · CRITICAL (headline) — "LLM assisted" is a silent no-op; nothing labels

**Symptom (David):** LLM-assisted = same result as Heuristics; zero GPU on
nvidia-smi; NO labels assigned anywhere; requirement — "A label from the 2nd level
of the knowledge hierarchy in that subject area should be automatically assigned by
the LLM… users must not label 1000 pages manually."
**Root cause (verified):** `type-inference-service.js:27-29` — `resolveStrategy`
coerces everything non-`heuristics` to `heuristics` (`resolved_by: 'heuristics-fallback'`).
There is NO vLLM client in okf-server (DP-8 not yet built — the deliberate stub:
Auto-Curate AC-5). Labels are never auto-assigned by ANY path (Auto-Curate AC-3 is
spec-only, 19493fa). Descriptions are never generated (`summary: ""` on all rows).
**Fix (coordinator):** okf-server **vLLM curation client + import-time curation
pass** (this is AC-3+AC-5 pulled forward per David):
1. `llm-curation-service.js` (NEW): batched, lane-bounded under
   `OKF_IMPORT_CONCURRENCY`, fail-soft (falls back to heuristics + marks
   `curation.method='heuristics-fallback'` per concept).
2. Per concept: classify `type` (taxonomy: topic/entity/process/event/source),
   auto-assign ONE KH **L2 service label** bounded to the repo's Subject Area
   (source of truth: `serviceCategories` L1 + `services` L2 in ArangoDB; L1 match
   by the repo's subject_area slug), generate `summary` (description).
3. Wire at `classification: 'llm'|'hybrid'` (heuristic-only stays zero-LLM);
   strict-JSON responses (guided JSON); results persisted per concept with
   `curation: { method, resolved_by, label_source }` (feeds D-G).
4. GPU-visible by design (vLLM on the GPU node — nvidia-smi becomes the
   user-visible proof David watched for).
**Sequencing:** build standalone service + tests NOW; wire into ingest-service
AFTER 65's D-A lands there (file-claim order).

## D-C · HIGH — Retract keeps the serving graph (+ Kenya orphan)

**Symptom (David):** retracted Kenya; graph not removed. Ruling: "When OKF
repositories are retracted, the associated graph in ArangoDB MUST be dropped along
with all its underlying collections."
**Root cause (verified):** `lifecycle-service.js:386-395` — retract only flips
`lifecycle_state: 'retracted'` (stays visible/editable; no graph teardown; graph
drops happen only in the DELETE cascade).
**Evidence (ArangoDB):** `OKF_kenya-government-services_v4` exists right now.
**Fix (65):** retract tears down the serving graph + underlying collections
(reuse the delete-cascade's idempotent drop helpers — 404-class = warn-only);
re-ingest from retracted REBUILDS the graph from the version (drain already does
born-right naming). One-time cleanup: drop existing retracted-but-graph-bearing
orphans (Kenya v4). Smoke harness: add R-case "retract → graph gone; re-ingest →
graph rebuilt".

## D-D · HIGH — Descriptions absent on all imports

**Symptom:** frontmatter description missing from all of the import.
**Root cause:** nothing ever populates it (`summary: ""` everywhere; no generation
code exists in any import path).
**Fix:** part of D-B step 2 (LLM writes `summary` per concept; heuristic mode
leaves empty + visible as a curation gap in the work queue later).

## D-E · MEDIUM — Wikipedia crawl: every page typed `topic`

**Symptom:** topic type selected for every page (descriptions "seem well aligned"
= titles/summaries sane, but no type variety, no labels).
**Root cause:** heuristics-only classification (D-B) — wiki pages are all
topic-shaped to the deterministic rules. The alphabet bundle shows the OPPOSITE
works: its authorial types (Subsidiary, OperatingSegment, BundleRoot…) were
preserved intact by the authorial guard.
**Fix:** D-B LLM classification differentiates; authorial types keep absolute
precedence.

## D-F · HIGH — Only 4 frontmatter fields are editable

**Symptom:** "Some of the frontmatter created is not editable. ALL of the
frontmatter MUST be editable and be able to be auto-corrected."
**Root cause (verified):** `ConceptEditor.vue` fm-bar edit form covers ONLY
`{type, title, labels, description}` (`fmDraft` :184, `saveFm` patch :350-352).
Everything else in `frontmatter` (sources[], links, license, custom keys) is
display-only. The backend PATCH `{frontmatter}` mode already merges arbitrary
keys server-side (c05485fc9) — the UI is the limiter.
**Fix (15):** the expanded fm form renders the FULL frontmatter set: curated
fields (type/title/labels/description) + generic key/value rows for every other
key (typed inputs: string/number/boolean/array-of-strings), per-field validation,
save via the existing `{frontmatter}` PATCH; auto-correct hook = the
AutocorrectPanel dry-run/apply. Nothing hidden, nothing read-only.

## D-G · MEDIUM — Activity log has no import method or curation decisions

**Symptom (David):** "The activity log must also include the method used for the
import and any decisions made by heuristics or LLM."
**Root cause (verified):** import-time `writeAudit` rows don't record the
classification method; per-concept `resolved_by` is computed
(`type-inference-service.js:99`) then DISCARDED (ingest-service.js:321-325 keeps
only the type).
**Fix:** 65 persists `curation: {method, resolved_by, label_source}` per meta row
+ one audit row per import (`method`, counts, fallback count); 15 surfaces it in
the Logs dialog / repo details (method badge + per-concept decision origin).

## D-H · LOW — PII "hit" on the alphabet index row

**Evidence:** `pii_state: "hit"` + `pii_hits_summary` populated on the index meta
row. Likely legitimate (bundle text contains PII-shaped strings — emails/handles).
**Action (65):** inspect `pii_hits_summary` for the row; report what matched;
confirm fail-closed gating didn't silently degrade anything. No code change
expected unless a detector misfires.

## D-I · MEDIUM — First "Alphabet LLM" import failed completely (deleted)

**Symptom:** LLM import of the alphabet zip failed outright the first time.
**Status:** NOT YET TRACED — the okf-server log window pulled (14h) shows no
conversion/import errors; the failure predates the window (Sep 6 evening).
**Action (65):** widen the log sweep to 48h around the first attempt; identify
the error (conversion? validation? import route?); classify one-off vs systemic.
The second LLM attempt succeeded (as a no-op), so the failure may be transient —
but prove it.

## D-J · LOW — Log spam: firstExample "no match" at ERROR level

**Evidence:** `docker logs main-okf-server-1` — trace e35456e6… repeats
`[DB_EXECUTE] collection.firstExample failed … no match` as WARN+ERROR pairs every
~3s (14:13 window). An expected DB miss is logged as an ERROR and retried forever.
**Fix (65):** identify the polling caller; treat `no match` as an expected result
(not an error); demote to debug; stop the retry storm on a not-found verdict.

## D-K · HIGH — Wikipedia cross-link density ~an order of magnitude too low

**Symptom (David, 2026-09-07):** "the wikipedia imports do not have a very
conjoined graph in the UI… suspiciously like they were not indexed well"
(= cross-linked).
**Evidence (ArangoDB, BOTH wikipedia repos identical):** 999 concepts,
**1,201 total links, only 74 concepts (7.4%) carry ≥1 link**, **0 dangling**,
index flagged correctly (crawl path writes type 'index').
**Reading:** the resolver resolves everything it receives (0 dangling) — the
loss is UPSTREAM: the converter is being fed almost no links. Prime suspect: the
doc-repo `pageProcessor` content-pruning heuristic (drops blocks with >5 links
and <15 chars/link — eats 'See also' / 'Related pages' / nav+infobox link
clusters, the link-richest regions of a wikipedia page; flagged as a tuning
candidate on 2026-09-05, now confirmed relevant by data). Secondary: body
wiki-link survival through the HTML→markdown conversion. Identical counts on the
"LLM" import = D-B no-op again.
**Fix (65, wave 1):** trace the exact loss point with before/after evidence
(pageProcessor output vs converter input vs links[] persisted); exempt
heading-adjacent link-dense lists from the pruning heuristic; re-measure density
on re-import. **Acceptance: the majority of crawled concepts carry ≥1
inter-concept link.**
**D-B acceptance addition (David's ruling, 2026-09-07):** LLM-assisted must be
**far more accurate and complete** than heuristics — types beyond `topic`,
labels on essentially all concepts (KH-L2, Subject-Area-bounded), populated
descriptions, and semantic link proposals where confident — slower is
acceptable, progress must be visible. Exact words: "otherwise it is fucking
useless" — that is the bar, registered verbatim as the acceptance criterion.

## D-M · P0 (RE-TEST BLOCKER) — Re-ingest after retract yields an EMPTY graph

**Symptom (David, 2026-09-08, first step of the re-test):** Kenya — retracted in
prior tests — new version v4 published (fm/labels edited), ingested; system says
ingested; `OKF_kenya-government-services_v4` EXISTS but EMPTY. David's forensics:
`_LINKS_TO` populated, `_ENTITY`/`_SOURCE`/`_HAS_SOURCE` empty.
**Root cause:** D-C's retract drops the graph + collections but leaves meta rows
`index_status='indexed'`. The drain's queue IS the meta rows → re-ingest claims
nothing → zero dataprep work → promote → nothing repopulates the dropped graph.
The edge-materialization pass alone ran (driven by the kept meta links[]).
Secondary: David's v4 fm/label edits never reached chunks (stale RAG content).
**Fix contract (65, expedited):** RETRACT resets meta rows (index_status→'parsed',
claim stamps cleared) after the graph drop; PUBLISH (mint) likewise — a new
version must re-drain. Import-efficiency mandate untouched (PII state not reset).
Success criterion: David's ArangoDB view — all four collections populated for
Kenya v4. **Lesson recorded: mock-green ≠ live-green for drain paths; the smoke
D-C case must assert node/edge counts, not existence.**

**RESOLUTION CHAIN (2026-09-08, live-proven on David's own Kenya):**
- **P0-1 `082b3e8d1`** — requeueRepoForRedrain at retract + publish (4-field
  reset: index_status/worker_claimed_at/last_good_index_at/reindex_retry);
  fatal-on-failure; verified 555/555; pushed after one network-flake retry.
- **P0-2 `082340a`** — the SECOND defect the re-drain exposed: a settle that
  bypassed the worker's refresh (per-concept callbacks died on missing
  `_ENTITY/_LINKS_TO` collections) left `rag_ingestion.status='draining'`
  forever → dashboard isBuilding() pinned a SERVING repo to Import/"Building…"
  ("0/5"). Fix at the authority: `_settleIngest` writes the terminal
  rag_ingestion record on EVERY settle path (worker refresh stays = progress;
  settle = last writer). Kenya v5 record repaired live.
- **Shell mechanism (65, #981 note 54673):** promoteGraph's unconditional
  `createGraph` minted EMPTY collections when the drop removed everything —
  dead code until D-C exposed it. P0-1+P0-2 make the shell path unreachable;
  hardening approved (409 DRAIN_DID_NOT_RUN on resolve-fall-through) for the
  next window.
- **LIVE PROOF (Kenya v6, rolled build):** serving, 5/5 indexed, record
  completed (after a one-time repair — v6 settled on the pre-roll container),
  graph 64 ENTITY / 11 SOURCE / 117 HAS_SOURCE / 69 LINKS_TO.
- **TRUE ROOT CAUSE (65, `7818d0658`, 2026-09-08):** dataprep's
  `_process_batch` swallowed ALL exceptions — the remote LLM 502'd during
  graph EXTRACTION, every batch was skipped, `asyncio.gather` never raised,
  and the 'Ingested' callback fired with ZERO graph writes (v8 shell). Batches
  now report `{inserted, failed}`; all-fail-and-zero-landed raises through the
  DESIGNED error path ('Ingestion Error' + auto-retract + row 'failed', NEVER
  'indexed'); honest-empty stays 'Ingested'; partial ingests with failures
  logged. 3 new pytest (all-fail / honest-empty / partial); 122 passed
  in-container. Pushed with the smoke gate `49ff25e0e`.
- **ZERO-WRITE GATE (`49ff25e0e`):** the lifecycle harness previously asserted
  graph EXISTENCE after re-ingest — the exact blind spot that let the v8 shell
  pass. It now counts ENTITY/SOURCE/HAS_SOURCE/LINKS_TO and fails on any zero.
  ALL PASS ×2 on the rolled build; final proof line: `ZERO-WRITE GATE: graph
  holds data — ENTITY=9 SOURCE=2 HAS_SOURCE=15 LINKS_TO=15`.
- **PROTOCOL (David-mandated, permanent):** coordinator runs David's exact
  flow on a scratch repo (retract → publish → ingest, four collections
  populated) BEFORE David re-tests Kenya. Executed 2026-09-08 — evidence above.
- **REMAINING P0-UI (15):** dashboard precedence — a serving repo must never
  render Import/Building (stageLabel isBuilding-first override); genuine
  re-drains show a 'Re-draining…' chip on the SERVING card.

---

## D-L · HIGH — Autocorrect proposes nothing when frontmatter is absent/blank

**Symptom (David, 2026-09-07, verbatim force):** "Autocorrect on frontmatter does
jack shit… if there is no frontmatter then there is no before and after… if
before is blank then after should be the correct frontmatter for the whole fucking
OKF repo."
**Root cause (INVESTIGATED 2026-09-07):** the backend autocorrect
(`planAutocorrectForConcept`, concept-meta-service.js:779-821, Story #978) is a
**placeholder-filler, not a curator** — exactly 4 mechanical rules: missing
type → the `'topic'` PLACEHOLDER; missing title → first H1/path; missing
sources → `[]`; missing status → `'draft'`. Authorial types outside the enum
(e.g. `BundleRoot`) only emit a warning. It has NO label rule, NO description
rule, no LLM, no repo context (Subject Area, KH) — so it can never produce
"the correct frontmatter for the whole repo", and its output rows are
placeholder noise David rightly calls jack shit.
**Mode ruling (David, 2026-09-07):** proposals must follow the repo's
classification mode — heuristics OR LLM; **LLM is expected to be more
accurate**.
**Required behavior:** blank/missing frontmatter → autocorrect proposes the
COMPLETE correct frontmatter for that concept in that repo: type, title,
Subject-Area-bounded KH-L2 label(s), description, sources[] — repo-consistent per
OKF v0.2 + the conformance rules. Before renders as "(blank)"; after renders the
full proposal; per-field apply.
**Fix:** the proposal engine IS the D-B curation engine — one engine, two
surfaces: (a) import-time curation (automatic), (b) an autocorrect PROPOSE
endpoint (per-concept + batch dry-run) returning {before, after, changes[]}
with from-empty support — replacing the NOT_READY client-side stubs.
Backend (coordinator, D-B family): the propose API.
Frontend (15): AutocorrectPanel renders empty-before → full-proposal; per-field
apply via the PATCH (incl. null-deletes once live).

---

## Distribution & sequence (David: distribute + supervise; one pusher at a time)

| Wave | Owner | Items |
|---|---|---|
| 1 (backend) | 65 | D-A (+backfill), D-C (+Kenya cleanup), D-K (link-density trace + See-also exemption), D-J, D-I forensics, D-H inspection, D-G persistence |
| 1 (frontend, parallel tree) | 15 | D-F full fm editor, D-G surface, D-B UI honesty (selector copy + curation progress), D-L panel UX (empty-before → full proposal) |
| 2 (backend) | coordinator | D-B vLLM curation client + auto-label/classify/describe pass + autocorrect PROPOSE endpoint (D-L backend), wired after 65's D-A lands in ingest-service |
| 3 | David | Re-test: re-import both inputs ×both modes + retract/re-ingest check + fm edit + activity log |

Crawler-resilience + kill-before-delete (65's approved plan) and Stage 2 UX move
AFTER this batch. Auto-Curate AC-1/AC-2 (coverage score, review-by-exception queue)
ride after D-B — D-B IS AC-3+AC-5.

## Re-test gates (David's re-run, only failed steps + these new checks)

1. Alphabet zip ×(heuristics + LLM): tree structure present (index flagged),
   links resolved, labels auto-assigned under Subject Area (LLM), descriptions
   populated, types sensible, full frontmatter editable.
2. Wikipedia crawl ×(heuristics + LLM): labels auto-assigned at scale, GPU
   visibly active in LLM mode, types varied, import duration still sane (LLM adds
   bounded time — lane-batched).
3. Retract Kenya (or any serving repo) → graph + collections GONE from ArangoDB;
   re-ingest → rebuilt.
4. Activity log shows import method + per-concept decisions.
5. A–B stay green (no regression).
