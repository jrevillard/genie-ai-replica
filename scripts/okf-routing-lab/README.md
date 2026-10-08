# OKF Routing Lab — probe scripts (salvaged 2026-10-08)

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
