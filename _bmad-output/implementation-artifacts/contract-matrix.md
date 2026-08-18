# Contract Test Matrix — OPEA v1.5 Upgrade

**Generated:** 2026-08-18 22:52:54 UTC
**Baseline revision:** `fef51ae5e8cfe8519f9bb18167704735d2fd15e2`
**Test suite:** `genie-ai-overlay/contracts/` (real vendored `comps`, not mocked)

## Summary

| Metric | Value |
|--------|-------|
| Total contract test files | 10 |
| Total test functions | 59 |
| Modules covered | 5 (chatqna, retriever, reranker, dataprep, embedding) |
| Test environment | In-image (real `comps`) + dev venv (pure logic) |
| CI stage | `contract-in-image` (per-module jobs with `--junitxml`) |

## Module Coverage Matrix

| Module | Test File | Tests | Purpose | Status |
|--------|-----------|-------|---------|--------|
| **chatqna** | test_contract_orchestrator_wire.py | 2 | 6 GENIE kwargs reach handlers; RAG services register | ✅ Present |
| **chatqna** | test_contract_e2e_pipeline.py | 7 | Label-filter roundtrip, streaming metadata, full graph schedule | ✅ Present |
| **retriever** | test_contract_label_filter.py | 8 | Wrong-category excluded; AQL FILTER clause built + passed; filter_clause param exposed | ✅ Present |
| **retriever** | test_contract_retriever_fusion.py | 14 | rrf_fuse dense+BM25 fusion (dedup, weights, unkeyed-doc isolation); hybrid invoke calls rrf_fuse | ✅ Present |
| **retriever** | test_contract_nfrp_budgets.py (partial) | 1 | Wire latency budget | ✅ Present |
| **reranker** | test_contract_reranker.py | 6 | GenieTEIReranking adapter imports; OpeaComponentRegistry registration; ServiceType.RERANK enum; @opea_telemetry decorator; invoke signature compatibility | ✅ Present |
| **dataprep** | test_contract_ingest.py | 2 | Real docling chunker: structured, text-bearing, deterministic chunks | ✅ Present |
| **dataprep** | test_contract_nfrp_budgets.py (partial) | 1 | One-doc ingest wall-clock budget | ✅ Present |
| **embedding** | (covered via retriever/chatqna) | — | Embedding service invoked by retriever/chatqna orchestrator | ✅ Present |
| **all** | test_contract_harness.py | 13 | Pure-logic unit tests for harness (dev venv, no image needed) | ✅ Present |
| **all** | test_contract_telemetry.py | 2 | Span operation names emitted; dashboard service set populated (dev venv) | ✅ Present |
| **all** | test_contract_mock_reality_parity.py | 2 | Mocked suite (tests/) vs real comps (contracts/) parity check | ✅ Present |

## Per-File Test Counts

| File | Tests | Module | Invocation |
|------|-------|--------|------------|
| test_contract_harness.py | 13 | all (pure logic) | `contract:unit` (dev venv) |
| test_contract_telemetry.py | 2 | all (pure logic) | `contract:unit` (dev venv) |
| test_contract_mock_reality_parity.py | 2 | all (parity check) | `contract:unit` (dev venv) |
| test_contract_orchestrator_wire.py | 2 | chatqna | `contract:retriever-arango` (in-image) |
| test_contract_label_filter.py | 8 | retriever | `contract:retriever-arango` (in-image) |
| test_contract_retriever_fusion.py | 14 | retriever | `contract:retriever-arango` (in-image) |
| test_contract_e2e_pipeline.py | 7 | chatqna, retriever | `contract:retriever-arango` (in-image) |
| test_contract_nfrp_budgets.py | 3 | retriever, dataprep | `contract:retriever-arango` + `contract:dataprep-arango` |
| test_contract_reranker.py | 6 | reranker | `contract:reranker` (in-image) |
| test_contract_ingest.py | 2 | dataprep | `contract:dataprep-arango` (in-image) |
| **TOTAL** | **59** | — | — |

## CI Jobs

| Job Name | Module | Image | Tests Run | JUnit XML |
|----------|--------|-------|-----------|-----------|
| `contract:retriever-arango` | retriever, chatqna | `genie-ai-retriever-arango:latest` | orchestrator_wire, label_filter, retriever_fusion, e2e_pipeline (subset), nfrp_budgets (wire latency) | `contract-retriever-arango.xml` |
| `contract:reranker` | reranker | `genie-ai-reranker:latest` | reranker | `contract-reranker.xml` |
| `contract:dataprep-arango` | dataprep | `genie-ai-dataprep-arango:latest` | ingest, nfrp_budgets (ingest wall-clock) | `contract-dataprep-arango.xml` |
| `contract:unit` | all (pure logic) | dev venv | harness, telemetry, mock_reality_parity | `contract-unit.xml` |

## Image Digests

Image digests are recorded in the CI pipeline artifacts (`contract-*.xml` JUnit XML files). The baseline revision `fef51ae5e8cfe8519f9bb18167704735d2fd15e2` corresponds to the merge of story 3-4 (upstream improvements verification) into the PRD branch.

## Notes

- **Mocked vs real parity**: `test_contract_mock_reality_parity.py` ensures the mocked `tests/` suite does not diverge from the real `contracts/` suite. A failure indicates the mocks are hiding a real break.
- **Red-green validation**: The suite was proven green on v1.3 (story 1-5) and red on a bare v1.5 bump (story 1-5, `red-run-v1.5-bare.md`). The overlay re-graft (stories 2-1 through 2-8) made the suite green again on v1.5.
- **Mutation probe**: Story 3-5 delivers a manual mutation probe job to prove the gates are not theater (deliberate break → pipeline red → revert → pipeline green).

## References

- Contract test suite: `genie-ai-overlay/contracts/`
- CI stage: `.gitlab-ci.yml` → `contract-in-image` stage
- Red-run log: `_bmad-output/implementation-artifacts/red-run-v1.5-bare.md`
- Evidence ledger: `_bmad-output/implementation-artifacts/evidence-ledger.md`
