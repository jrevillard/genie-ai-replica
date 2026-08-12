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
  (kwargs forwarding, docarray rename, chunk shape, label-filter AQL, telemetry
  span names, response schema). A green-on-green test is a quality failure.

## Invocation

Run against a built module image (the overlay + real `comps` are baked in):

```bash
# Full retriever-capable suite:
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-retriever-arango:latest \
  -c "cd /contracts && python -m pytest test_contract_orchestrator_wire.py test_contract_label_filter.py test_contract_telemetry.py test_contract_e2e_pipeline.py test_contract_nfrp_budgets.py -p no:cacheprovider"

# Dataprep-capable suite (chunker-dependent):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh genie-ai-dataprep-arango:latest \
  -c "cd /contracts && python -m pytest test_contract_ingest.py test_contract_nfrp_budgets.py::test_ingest_wall_clock_within_budget -p no:cacheprovider"

# Pure logic (dev venv — no image needed):
cd genie-ai-overlay && python -m venv .venv && .venv/bin/pip install pytest pytest-asyncio
.venv/bin/python -m pytest contracts/test_contract_harness.py contracts/test_contract_telemetry.py -p no:cacheprovider
```

CI runs the per-module jobs in the `contract-in-image` stage (`contract:retriever-arango`,
`contract:dataprep-arango`) with `--junitxml` artifacts.

## Suite layout

| File | Contract under test |
|------|---------------------|
| `_harness.py` | Shared harness: in-image `comps` guard, fake HTTP (aiohttp + requests), dashboard-derived telemetry extraction, budget table |
| `conftest.py` | The `comps` fixture — real vendored `comps` or skip |
| `test_contract_harness.py` | Pure-logic unit tests for the harness (runs in dev venv) |
| `test_contract_orchestrator_wire.py` | The 6 GENIE kwargs reach the handlers with exact values; all RAG services register |
| `test_contract_ingest.py` | Real docling chunker: structured, text-bearing, deterministic chunks |
| `test_contract_label_filter.py` | Wrong-category excluded; the AQL `FILTER` clause is built AND passed to the vector search |
| `test_contract_telemetry.py` | Span operation names the dashboards rely on are emitted; dashboard service set stays populated |
| `test_contract_e2e_pipeline.py` | Label-filter `search_start` roundtrip, streaming metadata shape, one full graph schedule |
| `test_contract_nfrp_budgets.py` | Wire latency + one-doc ingest wall-clock budgets |

## Red-green validation

1. **Green on v1.3** — the suite passes against the current `OPEA_VERSION="v1.3"`
   images.
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
