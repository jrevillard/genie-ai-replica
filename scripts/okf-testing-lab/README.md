# OKF Testing Lab — probe scripts (salvaged 2026-10-08)

Reference implementations from the Story 1.3 calibration and the 1.6/1.8
tag-routing experiments. They lived as untracked scratch in the local
build root (C:\Dev\builds\main) and were salvaged into the repo so the
next build re-sync cannot destroy them. They are NOT wired to CI.

| Script | What it does |
|---|---|
| `probe1.3.py` | Deploy smoke probe: embeds via the remote TEI (https://ai.assembly.govstack.global:444/embed, Bearer VLLM_API_KEY) and calls the retriever `/v1/retrieval` directly with a 9-graph carrier |
| `routing_probe.js` | Asks Arango (localhost:8529, `_db/genie-ai`) what the current routing would select for several bali queries |
| `routing_probe2.js` | Deterministic synthetic-embedding bali routing demo (no live TEI) |
| `tag_dryrun.py` | Dry-run: LLM auto-tags 4 repos, then simulates routing for 4 user queries using ONLY the generated tags (the bali-misroute bug-class measurement) |

**Known fidelity gap (fixed in the 1-8 service, kept here for the
record):** these probes embed the RAW query without the BGE
query-instruction prefix. Production chatqna embeds WITH the prefix
(`Represent this sentence for searching relevant passages: ` —
`genie-ai-overlay/core/embedding_query_prefix.py`). The Story 1-8
`head-test-service.js` applies the prefix; numbers from these scripts
are therefore not byte-faithful to production routing.

The productized version of these experiments lives in
`components/okf-server/services/head-test-service.js`
(POST `/api/okf/repos/:id/routing-test`).

## Story 8-6 — RAGAS benchmarking lab

Added for the RAGAS benchmarking work (2026-10). The scripts above are
**read-only probes of the local build**; the ones below either read Arango
directly, drive a live benchmark, or repair stored state.

| Script | What it does |
|---|---|
| `smoke-8-6.js` | Live smoke of the whole RAGAS surface against the deployed stack (sidecar + okf-server + remote GPU judge) |
| `ragas-compare.js` | Re-runs an existing suite and compares the new run against the stored one |
| `ragas-diff.js` | Read-only row-by-row comparison of two runs: per-metric means, the answer-changed set, per-row deltas |
| `ragas-precision-analysis.js` | Read-only: why `context_precision` dropped between two runs |
| `ragas-probe.js` | Read-only shape probe — repos, suites, runs and their metrics |
| `ragas-row-inspector.js` | Read-only: the run-doc fields for named failing rows |
| `ragas-rescore-judge.js` | Re-score a **stored** run with a **different** judge (needs `x-ragas-secret`) |
| `ragas-compare-judges.js` | Read-only: compare a **finished** re-score job against the stored scores of the run it re-scored — the mean-per-metric table and the biggest movers |
| `ragas-abstention-backfill.js` | One-off repair: re-flag every stored run with the authoritative abstention detector |
| `trigger-explain.js` | Run **inside** the okf-server container: regenerate attribution + advisor advice for one run against the deployed code |
| `run-judge-baseline.js` | Read-only: the recent runs with their judge, row count and per-metric means |
| `row-peek.js` / `run-peek.js` / `run-results.js` | Read-only Arango views: rows of a run, newest runs of a suite, full summary of one run |
| `ragas-regenerate-reference.js` | Run **inside** the okf-server container: rewrite a suite entry's reference answer so it is grounded in the corpus VERBATIM, and write it only if `context_entities_recall` on the rewrite scores BETTER than on the original |
| `ragas-gate-audit.js` | Run inside the okf-server container: read-only — score a suite's ORIGINAL references with the same metric the regeneration gate uses, and list the ones the corpus cannot ground |
| `ragas-regenerate-entry.js` | Run **inside** the okf-server container: regenerate an ENTRY (question + expected passage + answer) against the published corpus, for the rows whose reference cannot be grounded at all. `--audit` lists which entries need it; `--judge env` picks the env judge (the suite's own judge cannot always drive RAGAS's synthesizer) |
| `ropc-verify-revert.js` | One-shot: mint a master token, force ROPC off, verify — the hardening the earlier harness left unchecked |

**Sidecar-internal scripts.** `ragas-rescore-judge.js` and `trigger-explain.js`
call the RAGAS sidecar / the deployed service directly and expect
`x-ragas-secret` (`RAGAS_INTERNAL_SECRET` / `OKF_INTERNAL_SECRET`). They are
dev tools, not part of the product surface.
