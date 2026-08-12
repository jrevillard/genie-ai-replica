# Contract tests — real `comps`, inside the built image

This suite proves the overlay's contracts against the **real vendored `comps`**
(the OPEA library baked into each module image), as opposed to the `tests/`
suite which stubs `comps` in `sys.modules` and is blind to runtime `comps` API
changes.

- **Directory:** `genie-ai-overlay/contracts/` — a **sibling** of `tests/` so the
  mocked suite (`pytest.ini` → `testpaths = tests`) never collects these.
- **Isolation:** the `comps` fixture (conftest.py) returns the real vendored
  `comps` and **skips** when it is absent (dev venv / wrong module image). A
  test running against the mocked library would prove nothing about the bump.
- **Sensitivity:** every test asserts a shape the upgrade actually changes
  (kwargs forwarding, docarray shim pin, chunk shape, label-filter AQL, telemetry
  span names, response schema). A green-on-green test is a quality failure.

## Invocation

Run against a built module image (the overlay + real `comps` are baked in):

```bash
# Full retriever-capable suite:
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-retriever-arango:latest \
  -c "cd /contracts && python -m pytest test_contract_orchestrator_wire.py test_contract_label_filter.py test_contract_retriever_fusion.py test_contract_telemetry.py test_contract_e2e_pipeline.py test_contract_nfrp_budgets.py test_contract_site_startup.py -p no:cacheprovider"

# Dataprep-capable suite (chunker-dependent):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-dataprep-arango:latest \
  -c "cd /contracts && python -m pytest test_contract_ingest.py test_contract_nfrp_budgets.py::test_ingest_wall_clock_within_budget test_contract_site_startup.py -p no:cacheprovider"

# Reranker-capable suite (shim pin + entry-point + site-startup):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-reranker:latest \
  -c "cd /contracts && python -m pytest test_contract_reranker_smoke.py test_contract_site_startup.py -p no:cacheprovider"

# ChatQnA-capable suite (v1.3-on-3.11 import + symbol shape + site-startup):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-chatqna-server:latest \
  -c "cd /contracts && python -m pytest test_contract_chatqna_smoke.py test_contract_site_startup.py -p no:cacheprovider"

# Site-startup only (works in thin wrappers — embedding, textgen):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-embedding:latest \
  -c "cd /contracts && python -m pytest test_contract_site_startup.py -p no:cacheprovider"

# Pure logic (dev venv — no image needed):
cd genie-ai-overlay && python -m venv .venv && .venv/bin/pip install pytest pytest-asyncio
.venv/bin/python -m pytest contracts/test_contract_harness.py contracts/test_contract_telemetry.py -p no:cacheprovider
```

CI runs the per-module jobs in the `contract-in-image` stage (`contract:retriever-arango`,
`contract:dataprep-arango`, `contract:reranker`) with `--junitxml` artifacts.
Smoke jobs (`smoke:chatqna-server`, `smoke:embedding`, `smoke:textgen`,
`smoke:image-sizes`) run import-only gates in the `scan` stage.

## Suite layout

| File | Contract under test |
|------|---------------------|
| `_harness.py` | Shared harness: in-image `comps` guard, fake HTTP (aiohttp + requests), dashboard-derived telemetry extraction, budget table |
| `conftest.py` | The `comps` fixture — real vendored `comps` or skip |
| `test_contract_harness.py` | Pure-logic unit tests for the harness (runs in dev venv) |
| `test_contract_orchestrator_wire.py` | The 6 GENIE kwargs reach the handlers with exact values; all RAG services register |
| `test_contract_ingest.py` | Real docling chunker: structured, text-bearing, deterministic chunks |
| `test_contract_label_filter.py` | Wrong-category excluded; the AQL `FILTER` clause is built AND passed to the vector search; the installed `ArangoVector` exposes `filter_clause` as a named param |
| `test_contract_retriever_fusion.py` | `rrf_fuse` dense+BM25 fusion behavior (dedup, weights, unkeyed-doc isolation); hybrid `invoke` still calls `rrf_fuse` with the default ON |
| `test_contract_telemetry.py` | Span operation names the dashboards rely on are emitted; dashboard service set stays populated |
| `test_contract_e2e_pipeline.py` | Label-filter `search_start` roundtrip, streaming metadata shape, one full graph schedule |
| `test_contract_nfrp_budgets.py` | Wire latency + one-doc ingest wall-clock budgets |
| `test_contract_reranker_smoke.py` | Reranker shim pin (docarray), entry-point importability, microservice module import (DW-8, DW-13) |
| `test_contract_site_startup.py` | `.pth` auto-load: `zz_genie_startup.pth` parsed, each `import` line verified in `sys.modules` (DW-12) |
| `test_contract_chatqna_smoke.py` | ChatQnA v1.3-on-3.11 import, v1.3 comps symbols shape, docarray symbols under shim (DW-28) |

## Red-green validation

1. **Green on v1.3** — the suite was proven green against the
   `OPEA_VERSION="v1.3"` images (story 1-5); after the retriever re-graft the
   retriever suite now targets the v1.5 images (story 2-3).
2. **Red on a bare v1.5 bump** — rebuild the module image with
   `--build-arg OPEA_VERSION=v1.5` and NO overlay re-graft. The red is proven at
   the BUILD surface — the v1.5 image cannot build with the v1.3 overlay (see
   `_bmad-output/implementation-artifacts/red-run-v1.5-bare.md`). The
   assertion-level suite red (a deliberate contract break making the pipeline go
   red via a mutation probe) is delivered by the CI enforcement work, and the
   evidence stage re-checks the red-run logs for freshness.

   The bare bump fails on real surfaces: `REQ_PATH` points at
   `retrievers/src/requirements.txt` which does not exist in v1.5 (compiled
   lock), the compiled lock requires Python 3.11 (image base is 3.10), and the
   GPU-adjacent pins pull system libs the image lacks. Each is evidence the
   safety net catches a real 1.5 break — not green-on-green.

## Notes

- Do NOT add a mocked `conftest.py` here. This directory's whole purpose is the
  opposite of `tests/`'s mocking.
- The harness fakes `aiohttp` AND `requests` (the orchestrator uses both).
- Copyright headers + ruff conventions apply (PEP 8, line length 120).
