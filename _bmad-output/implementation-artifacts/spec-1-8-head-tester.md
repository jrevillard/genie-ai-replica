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

## 8. Implementation plan (MR-sized, in order)

1. **MR-A backend core** — head/rebuild endpoint; forbidden-centroid
   fix (+ migration-safe: rebuild refreshes); routing-test endpoint
   (Leg A + Leg B + fidelity block); probe-script salvage. Tests:
   jest unit (okf-server) with TEI/vLLM mocks; AQL probe tested
   against the mocked Arango in the existing harness.
2. **MR-B suites + analytics** — suite generator (vllm), run-all,
   okf_head_test_runs collection + list endpoint; summary metrics.
3. **MR-C frontend** — headTestService + HeadTestDialog (3 tabs) +
   rail badge + Publish card + i18n + store actions.
4. **MR-D (Phase 2, separate) retriever head wiring** — pseudo-rows
   in `_route_graphs` behind `RETRIEVER_ROUTE_HEAD_WEIGHT` (default
   0.0), dim/model guards, pytest parity tests; validated by the
   Lab's Leg B replay before enabling anywhere.

Validation venue: local build (C:\Dev\builds\main) live cycle on the
two real repos (NCD Information — published, Alphabet — the older
serving repo), then the standard Path-1 MR flow.

## 9. Open questions for David (decide before MR-A)

1. **Phase 2 now or later?** Ship the retriever head-wiring (MR-D)
   inside this story behind the default-off knob, or defer to a
   follow-up story after the Lab proves head quality on real repos?
   (Recommendation: defer — the Lab is decision-support until head
   quality is proven; wiring first would be cargo-cult.)
2. **Suite storage collection** `okf_head_test_runs` — OK as
   proposed, or extend an existing collection?
3. **Negative-test authoring**: LLM-generated negatives
   (confusable-sibling targeting) + forbidden-derived negatives +
   curator free-text — all three, or trim?
4. **Sibling bound**: 20 nearest by head score for probe replay —
   acceptable, or cap differently?
