---
title: 'In-image contract gates for ungated overlay surfaces'
type: 'chore'
created: '2026-08-12'
status: 'done'
baseline_revision: 'e3696035b5bea781d8550c7b7857d67c8f5b9181'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}genie-ai-overlay/contracts/README.md'
  - '{project-root}.claude/rules/TESTING.md'
warnings:
  - multiple-goals
deferred: []
---

<intent-contract>

## Intent

**Problem:** Seven deferred-work entries (DW-8, DW-12, DW-13, DW-20, DW-22, DW-24, DW-28) expose "ungated in-image behaviour" gaps across the overlay — four modules (reranker, chatqna, embedding, textgen) have zero CI jobs that import or run code inside the built image, no job measures image size, and no job verifies the `.pth` site-startup hooks actually auto-load at runtime. A shim failure, a v1.3-on-3.11 break, or a torch bloat would ship silently green.

**Approach:** Add per-module contract/smoke CI jobs and supporting test files in `genie-ai-overlay/contracts/` that exercise the uncovered surfaces inside the built images — reranker shim+entry-point import, chatqna v1.3-on-3.11 import, site-startup `.pth` auto-load for all six images, dataprep heavy-deps post-import, and image-size ceilings for the three torch-bearing modules. No Dockerfile or source changes; this is purely gating infrastructure.

## Boundaries & Constraints

**Always:**
- Reuse the existing `&contract_template` and `smoke:*` patterns (docker create + docker cp, JUnit artifacts, same `rules:` trigger paths).
- Every new test file carries the ITU copyright header and follows `ruff` conventions (PEP 8, line length 120).
- Contract tests use `require_real_comps()` or `in_image_comps_importable()` guards from `_harness.py` — no silent skips on the wrong image.
- Image-size ceilings are generous (fail on 2× regression, not 10% drift); record actual sizes in the job log.
- Site-startup verification asserts both `genie_ssl_patch` AND `docarray_alias_shim` (where the shim is installed) import cleanly — the `.pth` mechanism is the gate, not a separate `sitecustomize.py`.

**Block If:**
- A test requires network, GPU, or live services — the contract suite runs HTTP-mocked, no external dependencies.
- A Dockerfile change is needed to make a gate pass — report it as a deferred finding, do not modify the Dockerfile.

**Never:**
- Add mocked `conftest.py` stubs to `contracts/` — the directory's purpose is real `comps` only.
- Run the full service entry point (uvicorn bind + listen) — import-only smoke, not startup.
- Hardcode site-packages paths (e.g. `/usr/local/lib/python3.11/...`) — always derive from `site.getsitepackages()`.
- Gate on exact image sizes (CI image layers fluctuate) — ceiling assertions only, with actual size logged.

</intent-contract>

## Code Map

- `genie-ai-overlay/contracts/_harness.py` -- Shared harness: `require_real_comps()`, `in_image_comps_importable()`, `import_docarray(attr)` (asserts shim pin). All new contract tests import from here.
- `genie-ai-overlay/contracts/conftest.py` -- `comps` fixture: real vendored or skip. New tests reuse it.
- `genie-ai-overlay/contracts/test_contract_orchestrator_wire.py` -- Reference pattern for in-image contract test structure (import guard, fake HTTP, assertions).
- `.gitlab-ci.yml:759-794` -- `&contract_template` — docker create + docker cp pattern, JUnit artifact wiring. Reuse for `contract:reranker`.
- `.gitlab-ci.yml:1398-1434` -- `smoke:dataprep-arango` — reference pattern for import-only smoke jobs. Reuse for chatqna/embedding/textgen smoke jobs.
- `.gitlab-ci.yml:796-822` -- `contract:retriever-arango` — reference for per-module contract job with `CONTRACT_TEST_PATTERN` variable.
- `genie-ai-overlay/reranker/genieai_reranking_microservice.py:38` -- Imports `comps.cores.proto.docarray` under the shim pin. DW-8 gate target.
- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai:75` -- `CMD ["python", "comps/rerankings/src/opea_reranking_microservice.py"]`. DW-13 gate target — import this path, do not execute it.
- `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai:17` -- `FROM python:3.11-slim AS comps_base_builder` with `OPEA_VERSION="v1.3"`. DW-28 gate target.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:30-42` -- Top-level imports from `comps` (v1.3 symbols). Import this module to prove v1.3-on-3.11 works.
- `genie-ai-overlay/build-patches/install_site_startup.sh` -- Derives `site.getsitepackages()[0]`, copies hooks, writes `zz_genie_startup.pth`, runs build-time import guard. DW-12 gate target.
- `genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:11` -- Thin wrapper over `opea/embedding:1.5`, only adds SSL patch via `.pth`. DW-12 (embedding).
- `genie-ai-overlay/textgen/Dockerfile-textgen_genie-ai:11` -- Thin wrapper over `opea/llm-textgen:1.5`, only adds SSL patch via `.pth`. DW-12 (textgen).
- `genie-ai-overlay/dataprep/requirements-cpu.txt` -- torch 2.13.0 at line 5660. DW-22 (heavy deps) + DW-24 (image size).
- `genie-ai-overlay/retriever/requirements-cpu.txt:5503` -- torch 2.13.0. DW-24.
- `genie-ai-overlay/reranker/requirements-cpu.txt:3116` -- torch 2.13.0. DW-20 + DW-24.
- `configs/grafana/provisioning/dashboards/` -- Dashboard JSON files (scanned by `_harness.extract_dashboard_services`).

## Tasks & Acceptance

**Execution:**

- `genie-ai-overlay/contracts/test_contract_reranker_smoke.py` -- New contract test. Import the reranker module (`comps.rerankings.src.integrations.genieai_tei_reranker`), verify `import_docarray` shim pin holds, verify the entry-point module path (`comps/rerankings/src/opea_reranking_microservice.py`) is importable. Covers DW-8 + DW-13.
- `genie-ai-overlay/contracts/test_contract_site_startup.py` -- New contract test. Locate `zz_genie_startup.pth` via `site.getsitepackages()[0]`, parse its `import` lines, assert each named module is present in `sys.modules` (proving `.pth` auto-loaded them at site-init). No dependency on real `comps` — works in all six images including thin wrappers (embedding/textgen). Covers DW-12.
- `genie-ai-overlay/contracts/test_contract_chatqna_smoke.py` -- New contract test. Import `ChatQnA.genieai_chatqna` (the module the Dockerfile COPYs to `/app/ChatQnA/genieai_chatqna.py`). Verify v1.3 comps symbols (`ServiceType`, `MicroService`, `ServiceOrchestrator`) are importable and have expected attributes. Covers DW-28.
- `.gitlab-ci.yml` -- Add `contract:reranker` job (extends `&contract_template`, needs `build:reranker`, pattern `test_contract_reranker_smoke.py test_contract_site_startup.py`). Add `smoke:chatqna-server` job (extends `smoke:dataprep-arango` pattern, imports `ChatQnA.genieai_chatqna` + runs `test_contract_chatqna_smoke.py` inside image). Add `smoke:embedding` + `smoke:textgen` jobs (run `test_contract_site_startup.py` inside candidate images). Add `smoke:image-sizes` job (needs all three torch-bearing build jobs, measures sizes via `docker image inspect --format '{{.Size}}'`, asserts each ≤ 5 GB initial ceiling with actual size logged). Extend `smoke:dataprep-arango` to also import heavy deps (`pyspark`, `unstructured`, `graspologic`, `whisper`). Wire `test_contract_site_startup.py` into `contract:retriever-arango` and `contract:dataprep-arango` patterns. Covers DW-8, DW-12, DW-13, DW-20, DW-22, DW-24, DW-28.
- `genie-ai-overlay/contracts/README.md` -- Update suite layout table with new test files and invocation examples.

**Acceptance Criteria:**

- Given a MR touching `genie-ai-overlay/reranker/**/*`, when CI runs, then `contract:reranker` job executes `test_contract_reranker_smoke.py` + `test_contract_site_startup.py` against the `genie-ai-reranker` candidate image and produces a JUnit artifact.
- Given a MR touching `genie-ai-overlay/chatqna/**/*`, when CI runs, then `smoke:chatqna-server` job imports the chatqna module inside the `genie-ai-chatqna-server` candidate image and exits 0.
- Given a MR touching `genie-ai-overlay/embedding/**/*` or `genie-ai-overlay/textgen/**/*`, when CI runs, then `smoke:embedding` / `smoke:textgen` jobs verify `.pth` hook auto-load inside the candidate images.
- Given a MR touching any of `dataprep/**/*`, `retriever/**/*`, `reranker/**/*`, when CI runs, then `smoke:image-sizes` job measures all three torch-bearing images and asserts each ≤ 5 GB initial ceiling with actual sizes logged.
- Given the `smoke:dataprep-arango` job runs, when it imports heavy deps, then `pyspark`, `unstructured`, `graspologic`, and `whisper` imports succeed inside the dataprep image.
- Given any module with `install_site_startup.sh` in its Dockerfile, when its contract test runs, then `test_contract_site_startup.py` asserts `genie_ssl_patch` is in `sys.modules` (proving `.pth` auto-load, not manual import).

## Spec Change Log

## Review Triage Log

### 2026-08-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11 (1 high, 7 medium, 3 low)
- defer: 0
- reject: 9
- addressed_findings:
  - `[high]` `[patch]` smoke:embedding/textgen skip green when .pth missing — added hard .pth file existence assertion before pytest in both smoke jobs
  - `[medium]` `[patch]` SIZE arithmetic breaks on empty docker inspect — added guard in smoke:image-sizes script
  - `[medium]` `[patch]` _parse_pth_imports misses `from X import Y` — updated parser to handle both patterns
  - `[medium]` `[patch]` chatqna silent two-path fallback masks regressions — removed fallback, use canonical path only, broadened except clause
  - `[medium]` `[patch]` smoke:image-sizes trigger paths omit configs/ssl/**/* — added to all three changes: path lists
  - `[medium]` `[patch]` smoke:image-sizes artifacts:true misleading for registry images — changed to artifacts:false
  - `[medium]` `[patch]` test_pth_imports_are_loaded message should mention stderr swallowing — updated assertion message
  - `[medium]` `[patch]` smoke:chatqna-server not wired to full contract test — converted to contract template pattern, runs test_contract_chatqna_smoke.py
  - `[low]` `[patch]` chatqna unused pytest import after fallback removal — removed
  - `[low]` `[patch]` test_reranker_entrypoint_importable docstring — already correct, no change needed
  - `[low]` `[patch]` smoke:chatqna-server artifacts:true — changed to artifacts:false

### 2026-08-13 — Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (1 high, 4 medium, 3 low)
- defer: 2
- reject: 9
- addressed_findings:
  - `[high]` `[patch]` chatqna site-startup .pth not wired into CI — added test_contract_site_startup.py to smoke:chatqna-server CONTRACT_TEST_PATTERN
  - `[medium]` `[patch]` smoke:embedding/textgen re-implement inline instead of reusing contract template — converted to contract template pattern, run test_contract_site_startup.py inside images
  - `[medium]` `[patch]` smoke:embedding/textgen artifacts:true wastes CI time — changed to artifacts:false
  - `[medium]` `[patch]` smoke:image-sizes trigger paths omit build-patches/**/* — added to all three changes: path lists
  - `[medium]` `[patch]` _parse_pth_imports does not filter comment lines — added blank/comment line filtering
  - `[low]` `[patch]` site.getsitepackages() empty list causes IndexError — changed pytest.skip to hard assertion
  - `[low]` `[patch]` README chatqna example missing site-startup test — updated to include test_contract_site_startup.py
  - `[low]` `[patch]` smoke:embedding/textgen docstring mentions inline script but now uses contract template — updated docstrings

## Design Notes

**Two-layer gating:** smoke jobs (import-only, fast, in `scan` stage) for thin wrappers and entry-point verification; contract jobs (behavioral assertions, in `contract-in-image` stage) for modules with GENIE overlay code that exercises real `comps`. Embedding/textgen are thin wrappers — smoke only. Reranker has GENIE overlay code — contract. Chatqna has v1.3-on-3.11 risk — smoke (full contract deferred to story 2.6's re-graft).

**Site-startup test portability:** `test_contract_site_startup.py` runs in every module image that uses `install_site_startup.sh`. It locates `zz_genie_startup.pth` via `site.getsitepackages()[0]`, parses the `import` lines, and asserts each named module is in `sys.modules` — proving the `.pth` auto-loaded them at site-init. No dependency on real `comps`, so it works in thin wrappers (embedding/textgen) too.

**Image-size job design:** A single `smoke:image-sizes` job needs all three torch-bearing build jobs, pulls each image, runs `docker image inspect --format '{{.Size}}'`, and asserts each ≤ 5 GB (generous initial ceiling — actual sizes logged for future tightening). Implemented as shell assertions in the CI job script, not a separate Python test — the check is trivial and CI-native.

**Dataprep heavy-deps extension:** The existing `smoke:dataprep-arango` imports `docling` + the GENIE module. Extend the inline `python -c` to also import `pyspark`, `unstructured`, `graspologic`, `whisper`. These are in the compiled lock — if they install but fail to import (e.g., missing system lib, sdist build issue), the smoke catches it.

## Verification

**Commands:**
- `cd genie-ai-overlay/contracts && python -m pytest test_contract_reranker_smoke.py test_contract_site_startup.py test_contract_chatqna_smoke.py -p no:cacheprovider` -- expected: all tests skip (no real comps in dev venv for site-startup; chatqna module not on PYTHONPATH).
- `grep -c "contract:reranker\|smoke:chatqna-server\|smoke:embedding\|smoke:textgen\|smoke:image-sizes" .gitlab-ci.yml` -- expected: 5 new job definitions.
- `ruff check genie-ai-overlay/contracts/ && ruff format --check genie-ai-overlay/contracts/` -- expected: clean.

**Manual checks (if no CLI):**
- Verify each new CI job's `rules:` trigger paths match the module it tests.
- Verify each new test file has the ITU copyright header.
- Verify `smoke:dataprep-arango` inline script imports all five targets (docling, BaseText, genieai_dataprep_arangodb, pyspark, unstructured, graspologic, whisper).

## Auto Run Result

**Summary:** Follow-up review pass applied 8 patches to harden in-image contract gates. ChatQnA site-startup .pth now wired into CI (was missing). Embedding/textgen smoke jobs converted from inline scripts to contract template pattern (reuses test_contract_site_startup.py). Parser hardened against comment/blank lines. Trigger paths extended to include build-patches/.

**Files changed:**
- `.gitlab-ci.yml` — chatqna site-startup wired, embedding/textgen converted to contract template, build-patches trigger added
- `genie-ai-overlay/contracts/test_contract_site_startup.py` — getsitepackages guard, comment/blank filtering
- `genie-ai-overlay/contracts/README.md` — chatqna example updated

**Review findings breakdown:**
- Patches applied: 8 (1 high, 4 medium, 3 low)
- Items deferred: 2 (reranker torch import smoke, require_real_comps skip-all behavior)
- Items rejected: 9 (docs mismatch, line numbers drift, CHANGELOG, semicolon parsing, shell quoting, boundary ambiguity, allowlist design, deletion check, from-X-import-Y already handled)

**Follow-up review recommendation:** true (score = 8: 1 high + 4 medium + 3 low ≥ 5)

**Verification performed:**
- `ruff check` + `ruff format --check` on test_contract_site_startup.py — clean
- `grep -c "test_contract_site_startup.py" .gitlab-ci.yml` → 8 (all modules wired)

**Residual risks:**
- Reranker torch import not verified (DW-20 partially covered by image-size only)
- `require_real_comps()` skip-all behavior masks full-image failures (design choice, out of scope)

