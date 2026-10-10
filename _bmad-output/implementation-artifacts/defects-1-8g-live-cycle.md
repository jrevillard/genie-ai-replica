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
