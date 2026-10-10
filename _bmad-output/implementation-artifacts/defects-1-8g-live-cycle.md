# 1-8g live-cycle defects — separate work items (David, 2026-10-10)

Rule for this cycle (David): **every bug is a separate work item, every fix
its own commit → its own MR** (branch cut at push time, cherry-pick the
commit; the 1-8b branch MR merges first since these build on its probe/
advisor code). Status: DONE = fixed + deployed to the local build;
BACKLOG = logged rework, fix pending David's go.

---

## 1-8g-a — Corpus column blank + no probe summary (DONE, df8aa9539 + d66544128)

**Symptom.** After a click-test nothing appeared in the Corpus column; no
summary panel; "unanswerable must state exactly WHY; answerable shows the
stats".

**Root cause (two-layer).** (1) `suiteEditableRows`' final map — the one
merging run outcomes — rebuilt every row WITHOUT `lastProbe`; the payload
kept it, the rendered rows lost it. The first fix (df8aa9539) patched only
the `push` above the map; the jest test asserted the payload, not the
computed output — mock-hides-wiring. (2) "Run All" never probed at all —
the corpus verdict was click-test-only, so the column could not fill for a
suite run by design.

**Fix.** The final map carries `lastProbe` (regression test asserts the
computed OUTPUT). `runSuite` probes every row (embed → top-K → pipeline
rerank → verdict; default ON, `{probe:false}` opt-out) and persists the
verdicts on the suite rows — one Run fills the column for the whole suite.
The summary panel (df8aa9539) shows both legs, the evidence-based reason
(`probeReason`), reference files and rerank-ordered chunks.

---

## 1-8g-b — Advisor simulation embeds queries in the WRONG vector space (BACKLOG — the correctness bug)

**Symptom.** The advisor scorecard claimed "Now: positives 13/50 claimed"
while the run strip said 29/50 — the "Now" was fiction.

**Root cause** (investigation 2026-10-10): the advisor's gate simulation
embeds queries with bare `teiEmbed` (`head-suite-service.js` recommendTagSet
~:1810) but the LIVE gate embeds with the BGE query-instruction prefix
(`headTestService.embedQuery` — "EXACTLY like production chatqna"). With
margin 0.01 the cosine shift flips verdicts wholesale: the sim saw 13/50,
the live run 29/50. Secondary: text-dedup shrinks 116 rows → 100 unique
(16/66 duplicate negative rows — see 1-8g-h), so the counts disagree with
the strip.

**Fix (planned).** Embed through `embedQuery` at the one call site; scope
line names suite_key + tagset hash + run age (runs already stamp `tagset`).
Own MR.

---

## 1-8g-c — Advisor cannot improve positives: 23 veto-kills, `remove=[]` forever (BACKLOG — the rework)

**Symptom.** "2 runs of the advisor and explain failures failed to improve
the positives" (27→29→27→27 across four runs).

**Root cause** (investigation 2026-10-10): every failing positive is a
VETO kill — meat-packaging (16-21/run) + food-safety-testing (6-7/run);
zero floor-fails, zero margin-kills (positives score 0.68-0.78 vs floor
0.55). The explain FOUND the removals ("remove or narrow meat-packaging,
food-safety-testing"); the advisor still recommended `remove=[]` because:
(1) `removalCandidates = current ∩ loopWritten ∖ baseline` where baseline =
`history[history.length-1]` — the OLDEST entry of the sliding 10-window,
which after ≥10 edits is itself loop-modified → candidates = []; (2) the
guard's own design never proposes removing curator-declared originals
(meat-packaging IS one). Also: the add-LLM is fed confusable + meta rows
(1-8g-d's garbage candidates), and "cancer-risk-assessment" et al. were
rejected chips in the transparency list — correct mechanism, opaque
presentation. NO cross-repo contamination (NCD cross-check: only shared
in-code template overlap).

**Fix (planned, additive).** (a) Surface `blocked_removals:
[{tag, predicted_positive_gain, reason}]` — tell the operator the ONE
action that fixes their positives instead of silently omitting it;
(b) repair the baseline concept (first-ever history shape or an explicit
curator baseline, not the sliding window's oldest entry); (c) a NARROW
option (replace an over-broad tag with a more specific one) when removal
would re-admit negatives; (d) filter the add-LLM's failing set to
cls ∈ {off-domain, forbidden, near-miss} — confusables belong to the
sibling-select leg, meta rows are Lab-noise; (e) render the query lineage
on candidate chips so "cancer-risk-assessment" is self-explanatory; (f)
eventual topic-add lever for genuinely floor-failing repos (absent today —
moot here). Each sub-item may split further at implementation time.

---

## 1-8g-d — Advisor feeds confusable/meta rows to the forbidden-add LLM (BACKLOG — fold into 1-8g-c or own MR)

**Symptom.** Candidate chips like `query-selection-process` (ACCEPTED and
baked into a head!) sourced from meta queries ("Which tags are considered
noise…?"), `cancer-risk-assessment` from NCD-sibling confusables.

**Root cause.** recommendTagSet passes EVERY simulated-claimed negative to
the add-LLM; class is not filtered. Meta rows describing the Lab itself are
garbage-in-garbage-out; confusables are the sibling's job.

**Fix (planned).** One-line class filter + chip lineage rendering (see
1-8g-c d/e).

---

## 1-8g-e — Per-concept frontmatter screen reads empty → "lost tags" (DONE, 95638ec30)

**Symptom.** "Tags saved in the wizard, not visible in the OKF editor
frontmatter edit screen."

**Root cause.** Scope divergence, silent in the UI: the wizard's Curate
card edits REPO-level frontmatter (`okf_repositories.frontmatter`); the
editor's per-concept frontmatter bar edits the CONCEPT's own YAML
(type/title/label/description — verified in the DB: concepts carry only
`links/sources/title/type/status`). Both are correct; nothing explained
the split.

**Fix.** The bar shows a one-line summary of the repo's tags pointing at
the Tags panel (`okf.fm.repoTagsHint` ×14).

---

## 1-8g-f — `frontmatter.updated_at` never restamped on save (DONE, 3e30a8078)

**Symptom.** Found during the e investigation: the repo doc's
`frontmatter.updated_at` read 2026-10-09T17:25Z (import time) although
David saved repeatedly at 12:52-13:01 on 10-10 — the logs showed 6
successful frontmatter writes.

**Root cause.** `repository-service.update()` replaced `frontmatter`
verbatim; whether a timestamp survived depended on which client path
spread the old object. The Lab's stale badge (fm.updated_at vs
head.computed_at) and the 1-8g-c investigation's fm↔head desync check
all read a possibly-false stamp.

**Fix.** Server invariant: update() restamps after tag dedup; a
client-supplied stale stamp is overwritten. Pinned by test. (Also the
precondition for 1-8g-c fix (e): badge/repair the fm↔head desync — the
current head is baked with 7 tags while the reverted fm carries 5.)

---

## 1-8g-g — ▶ probe 409s on a published-but-uningested repo (DONE, d66544128)

**Symptom.** "I just got a 409 trying to run an individual query from the
lab" — REPO_NOT_INGESTED from the probe endpoint (Slaugherhouse Heuristics
is published, never ingested; routing/head tests work head-only, the
corpus probe cannot).

**Fix (David's prescription).** The ▶ button is disabled until
`repo.ingested_graph_name` exists, with the reason as its tooltip; the
suite pane states why the Corpus column cannot fill.

---

## 1-8g-h — Suite generator emits duplicate negative rows (BACKLOG, minor)

16/66 negative rows are duplicate texts ("Map the distribution of
slaughterhouses across the country." ×3 per run), which shrinks the
advisor's deduped view (116→100) and skews per-class counts. Dedup at
generation/add time (the same first-occurrence-wins rule the write
boundary uses).

---

## Evidence anchors

- Live logs: `head-suite.explain_failures.done` failing=6, positive_kills=23,
  removals=2, suggested=0 (12:59:25 + 13:04:42, identical);
  `head-suite.recommend.done` add=[query-selection-process] remove=[]
  score 71→73 (13:00:31 + 13:05:52, identical — the fixed point David
  experienced); REPO_NOT_INGESTED unhandled-error trace 13:10:50.
- DB: 4 runs on suite s1791637021770-ca5aed; tagset hashes
  14401f9c → 19484a59 → 0a56561f ×2; per-run positive-kill attribution
  meat-packaging 16-21 + food-safety-testing 6-7; fm=5 tags vs head=7
  baked vectors (desync).
- Fix commits: d66544128 (a+g), ba53cc140 (i18n), 3e30a8078 (f),
  95638ec30 (e). Suite state at commit: okf-server 854/854,
  frontend 1676/1676, lint+prettier clean.

---

## Resolution addendum (2026-10-10, later cycle — David: "we need b, c, d and h fixed")

All four BACKLOG items above are now FIXED in c4bcb8619 (one rework commit —
the four fixes interleave in recommendTagSet/generateSuite/addQueries; the
per-item tests pin each behavior so cherry-pick splits remain possible at
MR time). okf-server 860/860, frontend 1678/1678.

- **1-8g-b DONE** — headTestService.embedQueryBatch() is the gate's
  embedding contract, batched; recommendTagSet embeds its query vectors
  through it (the sim and the live runs now share ONE vector space); the
  payload carries `scope` {suites, runs[{run_key, suite_key, created_at,
  tagset}], embedding_prefixed, embedding_model} and the scorecard line
  renders "suites: … · tag sets: …". Tests: parity + scope.
- **1-8g-c DONE** — recommendTagSet simulates EVERY non-candidate
  forbidden tag: `blocked_removals` [{tag, predicted_positive_gain,
  predicted_negative_loss, predicted_score, reason:
  'curator_original'|'history_rotated'}]; the Lab renders them as
  confirm chips (✓ toggles) that join Apply in the ONE frontmatter
  save. `narrow_options` = remove-broad/add-narrow pairs simulated
  against the current config that strictly dominate a bare removal —
  same chips, same save. The meat-packaging class of deadlocks now ends
  with the curator confirming the one action that recovers the
  positives. (The topic-add lever for genuinely floor-failing repos
  stays future — §c (f) — this repo had zero floor-fails.)
- **1-8g-d DONE** — the add-LLM's failing set filters to
  cls ∈ {off-domain, forbidden, near-miss}; confusable and meta rows
  can never seed a forbidden-tag proposal again (the prompt test pins
  the exclusion).
- **1-8g-h DONE** — generateSuite dedups positives and negatives by
  normalized text (first occurrence wins, order preserved) and drops
  negatives that duplicate a positive; addQueries dedups manual
  additions against the suite (same OR opposite kind) and reports
  `duplicates_dropped` so the curator is never silently ignored. The
  99-random contract test now asserts the UNIQUE-pool semantics that
  supersede the 1-8f cycling behavior.
- **1-8g-i DONE** (c04496cb9) — the document-management batch delete
  refused wholesale when ONE selected row was ingested/ingesting, with a
  tooltip-only signal (the live "it failed": the Slaugherhouse bundle was
  mid-ingest). The refusal is now a visible strip; a mixed selection
  deletes the clean subset (the confirm names the skipped rows; blocked
  rows stay selected); i18n ×14 + deleteRefuseReason backfilled.
- **1-8g-j DONE** (781d6474d) — dataprep's per-concept status callbacks
  fell through to the doc-repo PATCH when concept_id was lost, logging
  6× ERROR "Metadata not found" per OKF ingest (concept ids are not
  doc-repo files). Origin fix: the routing keys on the JOB (OKF ingest
  context) — the callback goes to the OKF control plane even without
  concept_id; only legacy single-file jobs PATCH doc-repo.

## Query audit (2026-10-10, David: "evaluate the last 8 queries") — verdict + work items k/m/n/l

Independent agent audit of the 8 RAG chat queries 13:10–15:01 UTC (traces +
logs + run docs + SOURCE spot-checks): **David's "looks pretty good" is
CONFIRMED** — routing 5/8 ideal (heads-supersede exclusive on clean claims,
legacy excluded, sticky carrier held across a repeat), 3/3 grounded answers
calibration-clean (top rerank 0.61/0.99/0.96, cited chunks verified to
exist), zero hallucinated-as-grounded answers, honest abstentions on all
off-corpus probes, and the earlier NCD zero-hit anomaly did NOT recur (the
one NCD leg in the window returned 20 chunks in 1.28s).

Real findings, each its own work item:

- **1-8g-k — abandoned retriever fanout worker threads (BUG, rework).**
  4× in 3 min: `Fan-out leg TIMED OUT after 9.91s (limit 8000ms) —
  worker thread abandoned in background`; the abandoned traversals keep
  hitting Arango and die at the 60s read timeout; spans stay open 86-119s
  (a 119.4s leg ends ~106s after the response shipped), dashboards lie,
  and the piled traversals plausibly slowed a probe 0.4s → 5.8s mid-window.
  Fix direction: real thread cancellation / detached-leg reaping + a span
  that ENDS when the leg is abandoned. Own MR.
- **1-8g-l — OKF_indonesia-history-llm_v1 pathological traversal
  (investigation).** Every competition leg on that graph timed out (8s
  limit) — competition silently degenerated to legacy-GRAPH-only on 3
  queries. Bali-drain family (oversized traversal neighborhood; check
  _LINKS_TO cardinality). Outcomes stayed honest, but stale-GRAPH-only
  grounding is a latent accuracy hazard. Own MR.
- **1-8g-m DONE** (this commit) — compose shipped
  RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES default **10** against the
  retriever's code default 1 and safe cap 4 → an ERROR-level cap warning on
  EVERY leg. Compose default aligned to the code default (1).
- **1-8g-n — the 8s leg-timeout is enforced by waiting (backlog, design).**
  ~10s of the user-facing wall on floored-head competition queries is
  spent inside the retrieval POST before fallback. Fail-fast or real
  cancellation reclaims it — folds into k's rework.

Calibration note (no action): the Lab's corpus probe scored the
slaughter-fees query "weak" (0.19, the PDF-link chunk) while chat grounded
0.61-0.96 on real fee-schedule chunks — probe-cosine and reranker score
disagree on this repo; chat was right. Expect Lab-probe↔chat disagreement
when a repo's best chunk is a link row.
