# Story 1-8 — OKF Head Tester & Routing Lab (spec, ready-for-review)

Author: Claude (GLM-5.3 session), 2026-10-08. Research basis: 4-agent
workflow over the live codebase (routing algorithm, head storage,
lifecycle machine, UI surfaces) + direct verification of the
transition table. Every claim below carries a file:line anchor.

## 1. Problem statement

Story 1.7a stores a vectorized head per OKF repo at publish time
(`okf_repositories.head`, built by `buildVectorizedHead`,
frontmatter-service.js:841-911) — but NOTHING reads it, the admin
cannot see it, and there is no way to know whether a repo's tags
would actually win (or lose) a fan-out routing competition BEFORE
ingesting. Mis-curated tags are discovered only after serving, when
fixing requires retract + re-ingest (the expensive path).

David's required loop: **publish → test the head → revert to review
→ fix tags → republish (new head) → retest → … until accuracy is
good → ingest** (the point of no return).

## 2. Ground truth the design builds on (verified)

| Fact | Anchor |
|---|---|
| Head doc = {text, vector[dim], per_field{topic,entity,keyword,summary,scope,forbidden}, dim, model, version, computed_at, computed_by} | frontmatter-service.js:894-910 |
| **per_field.forbidden is ALWAYS null today** (averageVectors weight 0 → totalW 0 → null) — a latent bug for misroute testing | frontmatter-service.js:858 + 648 |
| Head build is best-effort at publish; a published repo may have NO head (TEI outage) | lifecycle-service.js:668-679, 728-739 |
| Head rides every `GET /api/okf/repos/:id` (toResponse spreads all fields) | repository-service.js:115-122 |
| Production routing = Story 1.3 chunk-probe: per-graph top-40 APPROX_NEAR_COSINE probe over `{graph}_SOURCE`, global top-40 merge, graph qualifies iff ≥3 chunks in top-40 (ROUTE_MIN_CHUNKS), floor = best single graph, sticky bypasses, any probe failure → degraded all-graphs | retriever genieai_retriever_arangodb.py:1694-1788 |
| Routing consumes the request-carried embedding; chatqna embeds WITH the BGE query-instruction prefix ("Represent this sentence for searching relevant passages: ") | retriever:1821; chatqna:956-972; core/embedding_query_prefix.py:28,36 |
| **The retriever does not read `head` at all** (greenfield read side) | greps: zero matches |
| A published-but-not-ingested repo has NO graph/chunks — chunk probes cannot run for it. The head is the ONLY pre-ingest routing signal | ingest creates the graph; assertWritable gates on ingested_at |
| `unpublish: publish → review` EXISTS (added 2026-09-25 "for unbundling and rework") | lifecycle-service.js:90 |
| `publish` is legal from `publish` (re-publish re-mints vN+1 and rebuilds the head); `ingest` sets ingested_at → read-only forever | lifecycle-service.js:87-88; assertWritable :1035 |
| LLM transport (vllmChatCompletions: granite, json_object, retry) and teiEmbed are directly reusable for query embedding + test-suite generation | frontmatter-service.js:252-264, 278-301 |
| The 3 build-root probe scripts (probe1.3.py, routing_probe.js/2) are prototypes of exactly this feature and embed WITHOUT the prefix (fidelity gap to fix) | C:\Dev\builds\main root, untracked |

## 3. The honest two-leg design (core decision)

"Will the fan-out select my repo?" has TWO different answers today,
and the lab must show both, clearly labeled:

- **LEG A — Head routing (works pre-ingest; the future signal).**
  cosine(query_embedding, head.vector) across this repo + all
  sibling repos that have a head. Rank + margin. Per-field cosine
  attribution for the repo under test. Selection rule for the
  simulation: head-score ranking (winner = top score; configurable
  margin threshold, default = winner must beat runner-up by ≥0 —
  exposed as a display knob only, never claimed to be production).

- **LEG B — Live chunk-probe replay (ground truth; works only for
  repos WITH graphs, i.e. ingested siblings + previously-ingested
  versions).** Replicates the production algorithm exactly: same
  probe AQL, same top-40/≥3/floor/degraded semantics, same env
  knob defaults (ROUTE_TOP_K=40, ROUTE_MIN_CHUNKS=3,
  ROUTE_PROBE_TIMEOUT_MS=2000, ROUTE_RETRY=1 — read from env with
  the same defaults so local overrides are honored). The repo under
  test shows "no graph yet — head-only" until it is ingested; after
  ingest both legs run for it.

This split is not a dodge — it IS the product insight: the head is
the pre-ingest gate you asked for, and the chunk-probe replay is the
post-ingest verification that the real fan-out agrees.

**Production wiring (Phase 2, separate MR, default-off):** inject
`(graph, cosine(q, head.vector))` pseudo-rows into `_route_graphs`'s
global top-40 pool (retriever:1744-1749) behind
`RETRIEVER_ROUTE_HEAD_WEIGHT` (default 0.0 = off), with dim+model
guards. Additive, rollout-safe, verifiable by the same lab.

## 4. Backend API (all new, okf-server)

| Endpoint | Scope | What it does |
|---|---|---|
| `POST /api/okf/repos/:id/head/rebuild` | requireRepoScope admin | Re-runs buildVectorizedHead from the CURRENT stored frontmatter (fixes missing/stale head; TEI best-effort, honest error) |
| `POST /api/okf/repos/:id/routing-test` | admin | Body: `{query: string, siblings?: "visible" (default) \| "none", include_probes?: bool (default true)}` → embeds the query (teiEmbed + BGE prefix, same credential chain), runs Leg A + Leg B, returns full per-repo result + verdict + fidelity block |
| `POST /api/okf/repos/:id/routing-testsuite` | admin (LLM-burning, 5-15s) | Body: `{n_positive=8, n_negative=6}` → one vllmChatCompletions call given this repo's frontmatter/head.text + sibling summaries; contract `{positive:[{query,reason}], negative:[{query,expected_repo,reason}], keywords:[...]}`; persists a suite doc |
| `POST /api/okf/repos/:id/routing-testsuite/:suiteKey/run` | admin | Executes every suite query in-process, persists a run doc with per-query results + summary |
| `GET /api/okf/repos/:id/routing-testsuite/runs?limit=20` | read | Analytics history (runs across tag cycles) |

New collection `okf_head_test_runs` (+ indexes repo_id, created_at)
holding suites and runs: `{_key, repo_id, kind: suite|run, suite_key,
repo_version, head_version, created_at, created_by, payload}`.
Run summary: `{pass_rate, avg_margin, steals: [{by_repo, count}]}`.

`routing-test` response (contract for the UI):

```json
{
  "query": "...", "embedded_with": "BAAI/bge-large-en-v1.5 + query-instruction",
  "under_test": {"repo_id": "...", "name": "...", "state": "publish",
                 "has_graph": false, "head": {"present": true, "stale": false,
                 "version": 3, "computed_at": "..."},
                 "probe": null,
                 "head_score": 0.71, "head_rank": 2,
                 "per_field": {"topic": 0.74, "entity": 0.69, ...}},
  "siblings": [{"repo_id": "...", "name": "...", "state": "ingested",
                "has_graph": true,
                "probe": {"top_score": 0.68, "chunks_in_top40": 31, "qualified": true, "error": null},
                "head_score": 0.55, "head_rank": 4}],
  "verdict": {
    "current_routing_winner": "<repo_id or 'degraded' or 'no-competitors'>",
    "head_routing_winner": "<repo_id>",
    "under_test_wins_head": true, "under_test_wins_current": false,
    "margin": 0.09,
    "provenance": "qualified | floor | degraded | sticky-unsupported"
  },
  "fidelity": {"algorithm": "story-1.3-replay+v1", "knobs": {"ROUTE_TOP_K": 40, "ROUTE_MIN_CHUNKS": 3}}
}
```

Authz: sibling set = repos visible to the caller's okf scopes
(reuse the authz-resolver graph list), bounded to 20 nearest by head
score (probe cost guard). Provenance mirrors production semantics
(qualified/floor/degraded); sticky is out of scope for a lab (fresh
queries) and labeled `sticky-unsupported`.

## 5. Fixes that ship WITH this story (small, in-scope)

1. **Forbidden centroid bug**: `buildVectorizedHead` computes
   per_field.forbidden with weight 0 → always null. Fix: average
   forbidden vectors with weight 1.0 for STORAGE (still excluded
   from the head average). Without it, negative/misroute testing
   has no forbidden vector to score against.
2. **Head staleness marker**: publish already rewrites head; add
   nothing server-side — staleness = `frontmatter.updated_at >
   head.computed_at` (computed client-side from the repo doc).
3. **Salvage the probe scripts**: move probe1.3.py, routing_probe.js,
   routing_probe2.js, tag_dryrun.py from the build root into
   `scripts/okf-routing-lab/` (reference implementations; they
   currently exist nowhere in the repo and die on the next sync).

## 6. Frontend

- **`HeadTestDialog.vue`** (new, `components/okf/editor/`) — a
  DsDialog with three DsTabs:
  1. **Head** — head.text rendered as tag chips per field, dim/model/
     version/computed_at/staleness badge, per-field weight legend,
     "Rebuild head" (admin) when missing/stale.
  2. **Test** — query input + Run; results table (repos as rows:
     name, state, head score bar, probe chunks, qualified mark),
     repo under test highlighted; verdict banner (both legs);
     adversarial toggle (expect NOT selected → forbidden-driven
     negative checks).
  3. **Suites & analytics** — Generate suite (long-action strip),
     Run all, pass-rate + margin chart (runs across versions),
     confusion pairs ("kenya stole 3 of 8 queries").
- Mounted from the **RepoEditorShell actions row** (next to
  Versions/Logs, RepoEditorShell.vue:65-105; dialog pattern
  OkfVersionsDialog :154-159). Button gated on
  `lifecycle_state ∈ {publish, approve}` or `repo.head` present —
  available on published AND ingested (read-only testing after
  ingest is legitimate verification).
- **Right-rail compact status** under FrontmatterPanel
  (RepoEditor.vue:134-142 area): head present/stale/missing badge +
  "Open Routing Lab" CTA.
- **Wizard Publish step**: read-only head card + handoff button
  ("Open the Routing Lab in the Editor") — NO mutations in the
  wizard (D4 rule, Publish.vue:3-4).
- `services/headTestService.js` wrapper (httpService, `/okf/...`
  paths); store actions in `okf.js` returning `{ok, code, message}`;
  i18n block `okf.headTest.*` (single literal — the en.js
  no-dupe-keys lesson).
- Cycle affordances in the dialog footer (non-mutating descriptions
  + deep links): "Unpublish to review" (invoke lifecycle unpublish
  from the EDITOR surface, allowed), "Re-publish" note explaining
  re-publish re-mints the version + rebuilds the head.

## 7. The user loop, end to end

```
Curate tags (chip UI/dialog) → approve → publish
   → head built (vN) ── open Routing Lab
   → generate suite (LLM) → run → pass rate/margins
   → bad? → Unpublish (publish→review, lifecycle-service.js:90)
        → fix tags → approve → publish (vN+1, fresh head)
   → retest (runs history shows the delta across versions)
   → good? → ingest (read-only from here; Lab still runnable for verification)
```

Fast path (documented in the UI): published-not-ingested is still
writable and `publish` is legal from `publish` — tag edits + direct
re-publish skip the unpublish ceremony. Both paths land on the same
re-mint + head rebuild.

## 8. Implementation plan

Superseded by §10 (revised after David's 2026-10-08 decisions —
MR-D retriever wiring moved IN-STORY, default-on). MR order and
content: see §10.

Validation venue: local build (C:\Dev\builds\main) live cycle on the
two real repos (NCD Information — published, Alphabet — the older
serving repo), then the standard Path-1 MR flow.

## 9. Decisions (David, 2026-10-08 — all four gates answered)

1. **Retriever head-wiring SHIPS NOW (in-story, not deferred).** David's
   framing: "this does not involve graphs and chunks — it only needs
   the head (in place after publishing) to ascertain selectivity for
   the OKF repo graph without having the graph. It is just
   signalling; the query would not be executed." Encoded as:
   - **Production (`_route_graphs`)**: head-affinity contributes to
     selection among CARRIER graphs — the repos actually on the
     fan-out. A graph-less repo never rides the real carrier
     (graph_names come from ingested graphs) and a head-only winner
     would burn one of MAX_GRAPHS=5 slots on an empty repo, so
     production selection stays graph-bearing; the head improves HOW
     those are chosen. Knob `RETRIEVER_ROUTE_HEAD_WEIGHT` (default
     1.0 = the signal is live; 0.0 = exact pre-1.8 behavior — the
     rollback). Missing head on a carrier repo → that repo falls
     back to chunk-probe-only scoring, never an error.
   - **The Lab (routing-test)**: the pre-ingest experimentation
     surface — head-bearing repos compete fully INCLUDING graph-less
     ones (siblings drawn from okf_repositories, not the carrier);
     a graph-less repo winning the head leg IS the selectivity
     signal. Leg B (chunk-probe replay) simply reports
     `has_graph: false` for those.
   - **Formula experimentation** lives in the Lab: `formula`
     parameter recomputes the head score from `head.per_field`
     vectors under alternate weights at query time ("default" =
     FIELD_RANGES, "uniform", or explicit overrides) — no head
     rebuild needed to try a formula; `head/rebuild` persists a new
     head when a formula is adopted.
2. **`okf_head_test_runs` collection** — approved as proposed.
3. **Negative tests: ALL THREE** (LLM-generated confusable-sibling
   negatives + forbidden-derived negatives + curator free-text) —
   "the negative tests are also very important for selection
   signalling."
4. **Sibling bound 20 nearest by head score** — approved ("also a
   potentially valuable insight").

## 10. Implementation plan (revised after decisions; MRs in order)

1. **MR-A backend core** — forbidden-centroid fix; head/rebuild;
   routing-test (Leg A incl. graph-less siblings + formula variants,
   Leg B replay, verdict + fidelity block); probe-script salvage;
   jest unit tests.
2. **MR-B suites + analytics** — suite generator (positives,
   confusable-sibling negatives, forbidden-derived negatives),
   curator free-text additions, run-all, okf_head_test_runs, list
   endpoint, summary metrics.
3. **MR-C frontend** — headTestService + HeadTestDialog (Head / Test
   / Suites tabs) + rail badge + Publish card + i18n ×14 + store.
4. **MR-D retriever head wiring (IN-STORY)** — head-affinity in
   `_route_graphs` for carrier graphs behind
   `RETRIEVER_ROUTE_HEAD_WEIGHT` (default 1.0, 0.0 rollback),
   dim/model guards, pytest parity + degradation tests.

Validation: local build live cycle on NCD Information (published,
pre-ingest) + the ingested repos as siblings; then Path-1 MR flow.

## 11. SHIPPED (2026-10-08 — all four MRs + the env externalization)

| Piece | Commit | Evidence |
|---|---|---|
| MR-A lab core | 1f6934473 | okf-server 762/762; live rebuild+routing-test 200 |
| await hotfix | e3662c725 | smoke-caught: reader-null, publish-gate skip, bundle-merge loss, teiEmbed export |
| MR-B suites+analytics | 6d8b80c0f, 22694a186 | 771/771; live gen/run/list 200, honest null negatives |
| MR-C frontend | fb318763d | 1637/1637; bundle live on the local build; dashboard/shell/rail/wizard entry points |
| MR-D retriever wiring | 66062714d | TestRouteGraphs 8/8; knob verified in-container |
| env externalization | dc23689f1 | env §15 inventory; env.j2 parity + dedupe; config-validator AC7 36/36 |

The pre-ingest→publish→test→re-tag→republish loop is live end-to-end on the
local build (NCD Information carries the only head until sibling repos
republish under the fixed publish path).

## 12. SHIPPED (2026-10-09 — the forbidden/noise GATE, "1-8a")

David 2026-10-08 (adversarial run on the lab): "under no circumstances
should 'fun in Indonesia' be routed to the NCD Information repo… this
should NEVER happen." Plus: "the genetics query… probably in, given the
tags."

The 1-8 verdict was rank alone — a one-repo universe always wins. The
gate makes negatives meaningful in ANY universe by replacing rank with
claim: a head CLAIMS a query only when its score clears its own forbidden
centroid by `ROUTE_HEAD_MARGIN` (default 0.01, calibrated on NCD 2026-10-08).

| Bucket | query | score − forbidden | gate verdict |
|---|---|---|---|
| Adversarial | "What is the latest guidance on mental-health?" | −0.002 | SUPPRESSED |
| Adversarial | "Explain the national policy for nutrition…" | −0.025 | SUPPRESSED |
| Adversarial | "What are the genetic risk factors for cancer?" | +0.024 | CLAIMED (the borderline-IN ruling) |
| Adversarial | "Give me statistics and recent data about exercise" | −0.062 | SUPPRESSED |
| Adversarial (unrelated) | "fun in Indonesia" | −0.008 | SUPPRESSED |
| Positive | "cancer screening guidelines" | +0.122 | CLAIMED |
| Positive | "How is asthma managed in primary care?" | +0.106 | CLAIMED |

The same gate in the retriever (`_route_graphs`): a head's pseudo-row is
dropped from the global top-K pool when `score − forbidden ≤ 0`. Gate
degrades open when the head has no forbidden centroid (pre-1.8a rebuild).

Files: `okf-server/services/head-test-service.js` (the gate + telemetry +
provenance "head-suppressed (forbidden/noise)"); `okf-server/services/head-suite-service.js`
(suite rows carry the gate fields; `summarizeRun` evaluates negatives
solo via `head_claimed === false`); `genie-ai-overlay/retriever/{config.py,
genieai_retriever_arangodb.py}` (drop-in-the-pool filter); frontend
`HeadTestDialog.vue` (new "Claims query" column; verdict distinguishes
rank-fail from gate-suppressed; adversarial text updated); i18n ×14
(5 new keys). Tests: okf-server 777/777 (+3); frontend 1640/1640 (+3);
retriever 8/8 (existing pool tests cover the change).
[UPDATE 2026-10-09: 1-8a MERGED — squash commit a1046629c via merge 2e9be556d
into feat/okf-server.]

## 13. SHIPPED-IN-WIP (2026-10-09 — gate v2, story 1-8b)

[UPDATE 2026-10-09: COMMITTED as f8ead5de0 (31 files, +1972) on
`fix/story-1-8b-routing-gate-v2` and VALIDATED live on the local build
(§14.2). Everything §13.7 lists as not-yet-done shipped in that commit:
the v2 unit tests (jest +176; pytest +287 gate parity in
test_fanout.py), the randomized suite negative classes, and the
HeadTestDialog 3-check gate breakdown + veto/floor teach panels
(i18n ×14). Status chain continues in §14.]

Status: the v2 core is IMPLEMENTED on `fix/story-1-8b-routing-gate-v2`
(cut from feat/okf-server 2e9be556) as UNCOMMITTED working-tree changes
to exactly 4 files; NOT yet validated (see the story file's validation
plan) — hence SHIPPED-IN-WIP, not SHIPPED. Story file:
`_bmad-output/implementation-artifacts/story-1-8b-routing-gate-v2.md`.

### 13.1 Why v2 — the margin-only gate (1-8a) fails two ways

19-query calibration probe on NCD Information (f043215b,
`gate-probe-inner.js`, production TEI endpoint, 2026-10-09):

1. **Off-domain claims.** Fully-unrelated queries score 0.32–0.484 on
   ANY head ("capital of France" 0.321, "forbidden noise gate" 0.407,
   "weather today" 0.484) — and unrelated text still sits slightly
   ABOVE the averaged forbidden centroid, so the margin rule is blind
   to it: France CLAIMED NCD at **+0.012** (> the 0.01 margin).
2. **Mixed-subject negatives slip the averaged centroid.** A
   two-subject query dilutes its forbidden half: the four failing
   negatives score ≥ 0.567 against their single dominant forbidden
   tag — genetics 0.617, epidemiology 0.619, exercise 0.638,
   incidence-trends/epi 0.567 — yet pass the margin test because the
   AVERAGED forbidden centroid absorbs the spike.

### 13.2 David's rulings (2026-10-09)

1. **"forbidden is forbidden — that is a hard contract, it should
   immediately score zero."** → the per-tag VETO.
2. **The routing decision must be an AFFIRMATIVE claim.** "We must
   ascertain that there either IS or IS NOT a reason to include any
   repo in the selected list for any given query… this is a key part
   of both the RAG accuracy and efficiency goals." A repo is in the
   selected list ONLY with positive evidence — suppression is a
   no-claim, never a rank demotion.
3. **The Lab must TEACH the user how to adjust tags** — a suppression
   must resolve to which condition fired + which forbidden tag + what
   to edit (the frontmatter forbidden list).
4. **The suite generator must produce MORE RANDOM adversarial
   negatives** (deterministic forbidden-derived negatives pattern-match
   too easily) — remaining work, `head-suite-service.js` untouched so far.

### 13.3 The three-condition claim contract

A head CLAIMS a query only when ALL of (replaces the 1-8a margin-only
rule; margin is kept as the third condition):

| # | Condition | Env knob (default) | Fires when | Kills |
|---|---|---|---|---|
| 1 | **floor** | `RETRIEVER_ROUTE_HEAD_FLOOR` (0.55) | score < 0.55 | off-domain noise — the whole 0.32–0.484 unrelated band; 0.55 sits mid-gap (legit claims ≥ 0.614) |
| 2 | **veto** | `RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX` (0.55) | ANY single forbidden tag cosine ≥ 0.55 | mixed-subject queries that slip the averaged centroid (failing ≥ 0.567 vs their tag; legit claims never exceed 0.529 on any tag) |
| 3 | **margin** | `RETRIEVER_ROUTE_HEAD_MARGIN` (0.01, unchanged) | score − averaged-forbidden-centroid ≤ 0.01 | forbidden-dominant queries (the 1-8a rule) |

`head_claimed = floor_pass && !tag_veto && marginPass`. The reported
`head_claim` is the FIRST failing condition — `floor | veto | margin |
claim` — which is the teach-the-user hook: it names the deciding
condition, and `tag_veto` carries the offending tag's name.

**Degradation (never silently suppress on missing data):** a head
without per-tag vectors (pre-1-8b rebuild) skips the veto but still
applies floor + margin; a head without a forbidden centroid skips the
margin. No condition ever fails closed on absence of data.

### 13.4 Lab contract changes (head-test-service.js)

- `scoreHead` returns `tag_cosines: [{tag, cosine}]` — per-tag cosines
  computed from the head's per-tag forbidden vectors.
- Every ranked row gains: `floor_pass`, `tag_veto` (tag name | null),
  `max_tag_cosine`, `head_margin`, `head_claimed`, and
  `head_claim ∈ {floor, veto, margin, claim}`.
- `verdict.head_suppressed` + new provenance strings:
  `'head-suppressed (off-domain)'` (floor),
  `'head-suppressed (forbidden: <tag>)'` (veto),
  `'head-suppressed (forbidden/noise)'` (margin — the legacy 1-8a text).
- `under_test` carries `tag_veto` / `max_tag_cosine` / `floor_pass` /
  `head_claim` / `head_claimed`.
- `fidelity.algorithm = 'story-1.3-replay+v2'`; `fidelity.knobs` now
  carries all three gate knobs beside the replay knobs.

### 13.5 Per-tag forbidden vectors at head build (frontmatter-service.js)

`buildVectorizedHead` now stores
`head.per_field.forbidden_vectors = [{tag, vector}]` — each forbidden
tag embedded INDIVIDUALLY at publish/rebuild time. The averaged
`per_field.forbidden` centroid is unchanged and remains the margin
rule's input. Requires a head REBUILD on existing repos to appear
(publish or `head/rebuild` — the validation plan's first step).

### 13.6 Retriever parity (config.py, genieai_retriever_arangodb.py)

`_route_graphs` applies the identical three conditions to each head
pseudo-row (floor → per-tag veto → margin) before it may enter the
global top-K pool. New observability:

- Counters `heads_floored` / `heads_vetoed` beside the 1-8a
  `heads_gated` (+ `head_rows` injected).
- Span attributes `rag.route.heads_floored` / `rag.route.heads_vetoed`
  (beside `rag.route.heads_gated`).
- The `Graph routing` log line extended with both new counters.

New env knobs (code-default, same family as ROUTE_TOP_K/MIN_CHUNKS/
WEIGHT — not part of the OKF env-file externalization set):
`RETRIEVER_ROUTE_HEAD_FLOOR=0.55`, `RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX=0.55`
(beside the existing `RETRIEVER_ROUTE_HEAD_MARGIN=0.01` and
`RETRIEVER_ROUTE_HEAD_WEIGHT`).

### 13.7 Test status

- Existing `head-test-service.test.js` suite 18/18 GREEN under v2
  (the 1-8a margin fixtures score 1.0, clearing the 0.55 floor; their
  heads carry no `forbidden_vectors`, so the veto degrades open) —
  re-run 2026-10-09.
- v2-specific unit tests (floor/veto/claim per condition, first-failing
  priority, degradation paths; jest + retriever pytest parity) NOT yet
  authored — part of the story's remaining work.

## 14. IN-WIP (2026-10-09 — 1-8c Lab teaching loop)

Status: 1-8b gate v2 COMMITTED (f8ead5de0) and validated live on the
local build (§14.2); 1-8c backend COMMITTED (c87b5e2dc, 5 files +291 —
near-miss class, per-class count controls, routing-explain + batch
suite-explain endpoints; jest updated for the 5-class negative merge,
17/17). Remaining: the frontend half of the loop — claim-side teach
panels, per-class count inputs in the suite dialog, and the in-Lab
tag-edit → rebuild → re-run flow. The 1-8b teaching UI covers the
suppression side only: the Test tab renders the 3-check gate breakdown
(Floor / Forbidden tags / Margin, DsPill pass/fail/na, thresholds from
`fidelity.knobs`) and teach panels for veto (which tag fired + what to
adjust + republish) and floor (confirms correct suppression). NOTHING
yet covers a CLAIM-side failure — a negative-classified query the head
wrongly claims.

### 14.1 David's requirements (2026-10-09)

1. When tests FAIL, the Lab MUST advise how to adjust the head —
   INCLUDING claim-side failures: suggest forbidden tags, let the user
   add them, rebuild, retest — INSIDE the Lab.
2. "Similar but wrong" negatives = the near-miss class.
3. User-controlled query counts per class in the suite dialog.
4. Tag editing + head regeneration from the Lab.
5. Batching — this must never become a per-query full-time admin job.

### 14.2 NCD validation evidence (2026-10-09) — and the gap it exposed

Gate v2 validated on NCD Information (f043215b) after a head rebuild
(mints `per_field.forbidden_vectors`): the **08:08 suite cycle ran
18/18 PASS** — positives CLAIMED, mixed-subject negatives VETOED,
off-domain FLOORED. David: **"testing is much better."**

The manual probe in the same cycle exposed the residual failure mode —
the one the gate cannot see BY DESIGN:

| Probe | head | max tag | margin | verdict |
|---|---|---|---|---|
| HIV / communicable-disease query | 0.594 (> floor 0.55) | 0.518 (< 0.55) | +0.049 (> 0.01) | **CLAIMED** |
| TB query | 0.509 (< floor 0.55) | — | — | floor-suppressed (correct) |

The HIV query clears ALL THREE gate conditions and claims, because
**communicable-disease is UNDECLARED** — no forbidden tag covers its
subject. A CURATION gap, not a gate bug: the gate answered correctly;
the Lab just had no surface to teach the curator what to add. That
surface is 1-8c.

### 14.3 The six wave-3 items

| # | Item | State |
|---|---|---|
| 1 | **Claim-side teaching** — `POST /api/okf/repos/:repo_id/routing-explain {query}` → full routingTest verdict + `suggestion {tags: [kebab-case forbidden tags], source: 'llm'\|'none', reason}` — populated ONLY when the head CLAIMS (`explainRouting`, head-test-service.js). The LLM proposes 1-3 tags capturing the query's subject that the declared scope genuinely excludes; deterministic empty fallback keeps the UI teaching ("no forbidden tag covers this subject — consider adding one") when vLLM is down. | backend DONE (c87b5e2dc) |
| 2 | **Batch advice — the anti-treadmill guarantee** — `POST /api/okf/repos/:repo_id/routing-testsuite/:suite_key/explain` → `{suite_key, run_key, failing_count, failing_queries: [{query, cls, head_claim}], suggested_tags (≤5), source, note}` — every failing negative of the LATEST run of the suite, ONE LLM call, consolidated tag suggestions (`explainSuiteFailures`, head-suite-service.js:755). Fails 404 RUN_NOT_FOUND when the suite has no run yet. | backend DONE (c87b5e2dc) |
| 3 | **Near-miss negative class** — new negative cls `near-miss`: repo vocabulary, out-of-scope intent — the hardest negatives ("similar but wrong"). LLM `near_miss[]` rows + deterministic `NEAR_MISS_TEMPLATES` fallback templated from the repo's entities, so the class is NEVER empty. | backend DONE (c87b5e2dc) |
| 4 | **Per-class count controls** — suite generator accepts `n_meta` (default 3, cap 8) and `n_near_miss` (default 4, cap 10) beside the existing `n_positive` (8..20) / `n_negative` (6..15) / `n_negative_random` (4..12); all clampCount-guarded. Suite dialog exposes per-class inputs. | backend DONE (c87b5e2dc); dialog UI remaining |
| 5 | **In-Lab tag edit + rebuild + re-run loop** — from advice → edit the frontmatter forbidden list → `head/rebuild` → re-run the suite, without leaving the Lab. | remaining (frontend) |
| 6 | **Initial-tag forbidden suggestions at curation time** — David: "look at the process of generating the initial tags too... if this can be improved without losing query fidelity on the target corpus then also fine." The curation-time tag proposal should surface candidate EXCLUSION tags alongside inclusions, so subjects like communicable-disease get declared BEFORE the first publish — closing the §14.2 gap at the source instead of after a failed suite run. Hard constraint from David: no loss of query fidelity on the target corpus. | follow-up (see §14.4) |

### 14.4 STRATEGIC FOLLOW-UP recorded for David: Subject-Area-inherited exclusions

The §14.2 HIV finding generalizes: most forbidden tags a repo needs are
not repo-specific judgments — they are BOUNDARY statements of the
subject area ("NCD repos do not cover communicable disease"). Proposal
recorded for David's decision: move boundary statements into the KH
taxonomy at Subject-Area level, with every repo INHERITING its area's
exclusions automatically at head build. Under that model per-repo
forbidden lists shrink to genuine repo-specific exceptions (the
exception path, not the main mechanism), and wave-3 item 6's
curation-time suggestions only ever propose what inheritance does not
already cover. Needs its own story: KH taxonomy schema for boundary
statements + inheritance at head build + migration note for existing
heads. DECISION REQUESTED alongside the wave-3 ship.

## 15. SHIPPED-IN-WIP (2026-10-09 — 1-8d teaching-loop guardrails)

Status: backend COMMITTED on `fix/story-1-8b-routing-gate-v2` —
130a99e (guardrail + positive-side advice + frontmatter history/revert
+ suite staleness snapshot) and 2f1cbd763 (veto-impact simulation in the
guardrail + always-on max_tag attribution). Frontend loop remaining
(§15.6). This section is the post-mortem and design record for David's
three requirements: (1) every cycle improves, (2) unlimited cycles,
(3) revert in the Lab.

### 15.1 The poisoning post-mortem (2026-10-09)

Three teaching-loop cycles applied LLM suggestions that included
**'lung-cancer' — the repo's OWN entity tag** — as a FORBIDDEN tag. The
prompt-only constraint ("do not propose the repo's own topics/entities")
failed the way prompt-only constraints fail: the model still proposed the
subject, and the add-all applied it. The self-forbidding tag turned the
0.55 veto bar against the repo's own corpus:

- positives collapsed **7/8 → 2/8** across the three cycles;
- negatives hit **20/20** — not because routing improved but by
  OVER-SUPPRESSION (a head that vetoes its own subject suppresses
  everything);
- the Explain button — gated on NEGATIVE failures only — disappeared
  exactly when the loop was most needed: the moment negatives looked
  "perfect", the advisory loop went dark.

David's three properties are the direct counter-design. (3) was proven by
hand first: the manual frontmatter restore that fixed the poisoning did
exactly what the Revert button now does — and surfaced the `_approved`
legacy-stamp 400 plus a stale-`updated_at` cosmetic, both fixed on the
way. The forbidden-tag ceiling was also raised 6 → 24 (47171229) — the
teaching loop's add-all on a repo that already held 5 tags was a
guaranteed 400.

### 15.2 The mechanical suggestion guardrail

`guardSuggestions(repoId, candidates, opts)`
(head-test-service.js) — every suggested forbidden tag is embedded
(`frontmatterService.teiEmbed`) and screened BEFORE it can reach the UI
chips. A screened-out proposal NEVER becomes a chip:

| Check | Bar (env knob) | Rejection reason |
|---|---|---|
| Self-subject | cosine vs ANY topic/entity/keyword head vector ≥ `OKF_GUARD_SELF_SUBJECT` (0.55) | "too close to the repository's own subject (similarity X >= 0.55)" |
| Veto-impact simulation (2f1cbd763) | cosine vs any of the run's own POSITIVE query vectors ≥ `ROUTE_FORBIDDEN_TAG_MAX` (0.55) | "would suppress N positives (e.g. \"...\")" — the kill list |
| Near-duplicate | cosine vs an existing forbidden vector ≥ `OKF_GUARD_DUPLICATE_FORBIDDEN` (0.9) | "already covered by an existing forbidden tag" |

Embedding failure rejects fail-closed ("embedding failed — cannot verify
against the repository scope"). Rejections are REPORTED, not swallowed:
`explainRouting` returns `suggestion.{tags, rejected, source:
'llm'|'guardrail'|'none', reason}` and `explainSuiteFailures` carries
`rejected: [...]` beside `suggested_tags`, with `source: 'guardrail'`
when everything was screened out. "Forbid your own subject" is now
structurally impossible — a property of the pipeline, not a request to
the model.

New env plumbing (defaults live in the service; env template §15 block,
compose pipes, ansible env.j2 parity, and config-validator pins all
wired): `OKF_GUARD_SELF_SUBJECT` (0.55), `OKF_GUARD_DUPLICATE_FORBIDDEN`
(0.9). The veto-impact bar deliberately REUSES the existing
`ROUTE_FORBIDDEN_TAG_MAX` — the same bar the live gate vetoes at, so the
simulation answers "what would the gate actually do".

### 15.3 Advice for BOTH failure kinds (unlimited cycles)

`explainSuiteFailures` response v2 — the loop now sees and names both
directions of failure:

- `removal_suggestions: [{tag, killed}]` — aggregated from the killed
  positives' `tag_veto` attribution, worst first: "positives vetoed by
  `cardiovascular-pharmacology` ×4, `clinical-protocols` ×3 → remove
  these?" — the inverse of add, feeding one-click remove chips.
- `positive_failures: {count, veto_counts, margin_killed}` — the
  over-suppression signature as data.
- `improvements` — explicit positive-improvement advice (David: "the
  feedback needs to make recommendations to improve the pass level on
  positives"): remove/narrow the vetoing tags; on margin kills, review
  the forbidden tags nearest to the killed positives (their centroid
  contribution suppresses in-scope queries).
- `under_test.max_tag` now names the nearest forbidden tag on EVERY query
  (not only vetoes) — margin-killed positives have attribution too.
- the no-failure note says **failures-are-suppressed-positives** when
  only positives failed ("no wrongly-claimed negatives — the failures
  are suppressed positives (see removal_suggestions)") — the §15.1
  Explain blind spot is closed at the API level.
- every explain run is PERSISTED as a `kind: 'explain'` doc in
  `okf_head_test_runs` (actor + timestamp + full payload) — cycles are
  auditable after the fact.

### 15.4 frontmatter_history + revert in the Lab

`repository-service.update()` snapshots EVERY frontmatter save into the
bounded `doc.frontmatter_history` (last 10, `{saved_at, actor, shape}`);
`frontmatterHistory(repo_id)` reads it; `revertFrontmatter(repo_id,
saved_at, actor)` restores a prior shape and RE-ENTERS `update()`, so
reverts are themselves snapshotted (revert-of-revert works, the history
never lies). Routes: `GET
/api/okf/repos/:repo_id/frontmatter/history` (read scope) and `POST
/api/okf/repos/:repo_id/frontmatter/revert {saved_at}` (admin scope).
The Lab's Revert-tags panel lists the saves; one click restores + offers
a head rebuild (a stale head would keep vetoing until rebuilt).

### 15.5 forbidden_snapshot (cycle staleness)

`generateSuite` stores `forbidden_snapshot` — the forbidden list at
generation time — on the suite payload, so a suite re-run against a
CHANGED forbidden list is detectably stale (the forbidden-derived rows
describe a head that no longer exists). The UI staleness flag and the
positive-regression tripwire (re-run vs previous run, red flag with
per-tag attribution + revert prompt) are the remaining frontend half —
the data they need is now in the payload.

### 15.6 Remaining (frontend) for 1-8d

- Guardrail reporting in HeadTestDialog: render `rejected` reasons,
  `source: 'guardrail'` states, remove chips from
  `removal_suggestions`.
- Revert-tags panel from `frontmatter_history` + rebuild offer.
- Positive-regression tripwire UI + suite-staleness flag from
  `forbidden_snapshot`.
- Cycle discipline: re-run-same-suite as the primary action;
  regeneration = explicit new benchmark identity; consolidation guidance
  when the 24-tag ceiling is hit.
