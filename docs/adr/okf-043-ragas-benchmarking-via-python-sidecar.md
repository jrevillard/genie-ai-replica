# ADR okf-043: Run RAGAS benchmarking in a Python sidecar orchestrated by the Testing Lab

**Status**: Accepted (David directive, 2026-10-17 — spec `okf-ragas-benchmarking`)
**Date**: 2026-10-17
**Decision owners**: David (product), Winston-slot (architecture)
**Implemented in**: Story 8-6, branch `feat/okf-ragas` (pending)

## Context

The Testing Lab (Story 1-8 series) proves *routing* — which repository should answer — via
`head-test-service`/`head-suite-service` in Node.js, replaying retrieval directly against
ArangoDB/TEI/rerank and never calling chatqna over HTTP. Jerome's `tests/rag-benchmarks`
harness proves *answer quality* via RAGAS (faithfulness, context_precision, context_recall,
answer_relevancy), but only as an operator-run CLI on the swarm node with its own xlsx-based
suite format and multi-phase runbook.

David's directive (2026-10-17) brings RAGAS into the Lab: generate suites with expected
outputs from the current + selectable related repos, import/export suites and results as xlsx
compatible with Jerome's formats, execute and display results (table + charts), and explain
failures with advice — all 100% additive to the existing test infrastructure and UI.

Two hard facts shape the decision:

1. **RAGAS is a Python-only library** (0.4.3, requiring the langchain stack), while the Lab
   and okf-server are Node.js. Reimplementing the metrics in Node would diverge from Jerome's
   numbers — unacceptable, since the xlsx interop promises interchangeability.
2. **xlsx parity is positional and tab-exact** (`xlsx_to_gold.py`, `enrich_xlsx_v2.py`):
   one implementation must own both directions to avoid drift, and it should use the same
   openpyxl version his toolchain pins.

## Decision

1. **A new stateless Python sidecar, `components/ragas-service/`** (FastAPI, mirroring the
   `pii-service` packaging precedent), owns the three things only Python can do faithfully:
   ragas `TestsetGenerator` (suite generation with reference answers), ragas `evaluate()`
   (the metric catalog — the harness-compatible four as the default selection, the full
   single-turn RAG set selectable per suite/run), and all xlsx serialization (openpyxl,
   deps frozen to his `requirements.txt` versions). **okf-server (Node) keeps orchestration** — jobs,
   persistence, authz, audit — in a new `ragas-suite-service.js` that clones the
   `head-suite-service.js` skeleton (same `okf_head_test_runs` collection with new kinds
   `ragas_suite`/`ragas_run`/`ragas_explain`, same 202+poll job pattern, locks, orphan
   reaping). Sidecar auth is a shared-secret header defaulting to `OKF_INTERNAL_SECRET`,
   the dataprep-callback contract.
2. **Runs replay retrieval Lab-internally** (the head Lab's philosophy): embed via the TEI
   seam, AQL per selected repo's `_SOURCE` with head-weighted merge mirroring the
   retriever's fan-out, unified rerank, answer via `vllmChatCompletions` with a
   `CHATQNA_SYSTEM_PROMPT`-shaped assembly; fidelity knobs are recorded on the run doc.
   Driving chatqna over HTTP (Jerome's dump-tuples path, VT trace harvest) is explicitly
   out of scope for v1 — the CLI harness owns full-stack fidelity, and the xlsx interop
   bridges Lab suites to it.
3. **Compatibility contract** (see the spec companion `xlsx-compat-formats.md`): suite
   export emits his input format (sheet `Test Dataset`, header row 1, positional
   id/difficulty/query/answer/passages/source, `new-N` id joins, blank-line passages,
   `N/A` = out-of-scope) so it feeds `xlsx_to_gold.py` unmodified; results export uses his
   v2 vocabulary (Gold + `Run_<label>` + Compare + empty Calibrate; 22 `NEW_COLS`,
   18 `COMPARE_HEADERS`; anchor columns blank; metrics beyond the default four append
   extra `ragas_<metric>` columns his tooling ignores). **Suites import in his format;
   results export only — no results import** (per David 2026-10-17).
4. **Sovereign judging**: the sidecar's judge/embedder point at the deployment's local
   vLLM/TEI via `RAGAS_JUDGE_*`/`RAGAS_EMBED_*` (compose defaults from `VLLM_ENDPOINT`,
   `VLLM_LLM_MODEL_ID`, `VLLM_API_KEY`, `EMBED_MODEL_ID`) — the same deployment-local
   pattern Jerome's `EVAL_JUDGE_*`/`EVAL_EMBED_*` document.

## Consequences

- A 17th container image enters the deployment surface (compose always-on, CI
  build/scan/promote, Ansible `deploy-shared-facts` + `env.j2` + `env` template rows,
  config-validator four-site parity). The Lab degrades honestly per-route
  (`503 RAGAS_UNAVAILABLE`) when the sidecar is absent — the same contract as the
  Keycloak access-control 503.
- Metric numbers are only as faithful as the Lab's replay. The run doc records fidelity
  knobs, and the division of labor is explicit: Lab = fast in-product iteration; Jerome's
  harness = full-stack deep evaluation. Anyone needing serving-fidelity numbers exports
  the suite and runs his chain.
- The frozen ragas pin (0.4.3 + langchain versions) blocks dependency drift but also
  blocks ragas upgrades until a deliberate re-pin re-verifies number parity — the same
  trade-off Jerome's own pin makes.
- `okf_head_test_runs` gains three kinds with zero migration; existing list/poll paths
  already discriminate by kind, and the saved-suites UI becomes a mixed list (RAGAS
  suites differentiated by a `DsPill`) — the integrated-but-differentiated list the
  directive requires.
- Suite generation and runs consume shared-GPU LLM time; both are bounded
  (`OKF_RAGAS_TESTSET_SIZE_DEFAULT`, `OKF_RAGAS_MAX_ENTRIES`, `OKF_RAGAS_RUN_CONCURRENCY`)
  so benchmarking cannot starve chat answering.
