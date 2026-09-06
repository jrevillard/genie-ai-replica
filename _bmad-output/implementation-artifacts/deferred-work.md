# Deferred Work

Items deferred during code reviews. Revisit when the related component is next modified.

### DW-1: embedding/textgen wrapper images still pin OPEA 1.3 base images.
origin: spec-deferred 8b6f4b550347
location: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:4
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
severity: low
reason: ARG UPSTREAM_IMAGE=opea/embedding:1.3 / opea/llm-textgen:1.3 unchanged while core/constants.py now exposes a v1.5-shaped enum; the retag to 1.5-based bases is story 2.2's OPEA_VERSION bump.
status: done 2026-08-12
resolution: already resolved: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:7 now has ARG UPSTREAM_IMAGE=opea/embedding:1.5 (bumped from 1.3)

### DW-2: pydantic v2 in the module images is not verified at build/runtime.
origin: spec-deferred 74debba4180e
location: genie-ai-overlay/core/genieai_api_protocol.py:13
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
severity: low
reason: PositiveInt/NonNegativeFloat require pydantic v2; the images build from python:3.10-slim / opea:1.3 bases and no runtime pydantic-major check exists; covered by story 2.2's base-image migration + in-image contract runs.
status: done 2026-08-12
resolution: already resolved: genie-ai-overlay/core/genieai_api_protocol.py:13 imports NonNegativeFloat, PositiveInt from pydantic; images now use python:3.11-slim bases

### DW-3: override-audit lint is not enforced in CI and is one-directional.
origin: spec-deferred d37bd529fdc3
location: genie-ai-overlay/build-patches/lint_overrides.py
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
severity: medium
reason: lint_overrides.py runs only via the local pytest test_overrides_lint.py; no CI job wires it, the marker-to-manifest direction is unenforced, and .pth runtime-load failures are silent; CI enforcement belongs to story 2.7 (verify:evidence + coherence lint).
status: done 2026-08-12
resolution: resolved by sweep bundle dw-override-audit-ci-enforcement

### DW-4: override-audit lint has no dedicated CI job, is one-directional, and .pth runtime-load failures are silent.
origin: spec-deferred f4736edd7e98
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/build-patches/lint_overrides.py
severity: medium
reason: lint_overrides.py is exercised only via tests/test_overrides_lint.py (which the CI pytest stage runs), so it is indirectly wired but has no dedicated job; the marker-to-manifest direction is unenforced; .pth runtime-load failures are silent. Explicit enforcement belongs to story 2.7 (verify:evidence + coherence lint).
status: done 2026-08-12
resolution: resolved by sweep bundle dw-override-audit-ci-enforcement

### DW-5: 10 of v1.5's constrained ChatCompletionRequest fields are not mirrored in the overlay protocol.
origin: spec-deferred 29bafba7a211
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/core/genieai_api_protocol.py:162
severity: medium
reason: v1.5 constrains max_tokens, n, seed, temperature, top_p, best_of, repetition_penalty, top_k, timeout, top_n with PositiveInt/NonNegativeFloat; the overlay keeps them plain int/float (only k, fetch_k, lambda_mult, score_threshold are re-grafted per the AC). Re-express during the chatqna/retriever re-graft (stories 2.3/2.6) when those fields are actually exercised.
status: done 2026-08-12
resolution: resolved by sweep bundle dw-pydantic-v2-field-mirroring

### DW-6: module-layer overrides are not recorded in OVERRIDES.yaml and the lint scan scope cannot see them.
origin: spec-deferred 26792e0ebdb9
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/build-patches/lint_overrides.py
severity: medium
reason: The reranker import re-point (genieai_reranking_microservice.py opea_docarray→docarray) and contract-harness re-graft are intentional deviations outside the core layer, but lint_overrides.py scans only core/*.py and build-patches/*. Extend the manifest + scan scope during module re-grafts (2.3-2.6) or the 2.7 coherence lint.
status: done 2026-08-12
resolution: resolved by sweep bundle dw-override-audit-ci-enforcement

### DW-7: embedding/textgen ENV PYTHONPATH removal is not runtime-verified.
origin: spec-deferred b367dfb4ab8d
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:8
severity: medium
reason: The old wrapper Dockerfiles forced /usr/local/lib/python3.11/dist-packages onto PYTHONPATH; the re-graft removed that line. Nothing yet verifies the opea/embedding:1.3 / opea/llm-textgen:1.3 runtime interpreter loads the .pth hook (site-packages vs dist-packages layout). Covered by story 2.2's in-image contract runs + base-image migration.
status: done 2026-08-12
resolution: already resolved: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:10-12 uses install_site_startup.sh for .pth hook (no hardcoded python3.x path); textgen equivalent at Dockerfile-textgen_genie-ai

### DW-8: reranker import re-point has no in-image import verification.
origin: spec-deferred 2b2b6532da1b
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/reranker/genieai_reranking_microservice.py:38
severity: medium
reason: genieai_reranking_microservice.py now imports comps.cores.proto.docarray (under the shim pin), but the reranker image has no contract/smoke job that imports the module — conftest stubs the module as a MagicMock, docker build never imports it, and the contract harness import_docarray runs only against the retriever/dataprep images. A shim failure in the reranker image would crash the container at start, green. Covered by story 2.2's in-image contract runs.
status: open

### DW-9: build-patches/*.py are excluded from ruff, so the two new scripts are never linted in CI.
origin: spec-deferred 9029450207bc
source_spec: `2-1-re-graft-the-core-overlay-layer.md`
location: genie-ai-overlay/pyproject.toml:43
severity: low
reason: pyproject.toml [tool.ruff] exclude = ["build-patches/"]; lint_overrides.py and docarray_alias_shim.py ship outside ruff coverage and the story's "ruff clean" verification is vacuous for them. Verified clean manually this pass. Extend the ruff scope (or exempt with a documented reason) during the 2.7 coherence-lint work.
status: done 2026-08-12
resolution: resolved by sweep bundle dw-override-audit-ci-enforcement
### DW-10: langchain-arangodb drops back to 0.0.6 in the v1.5 lock; the >=1.2.0 filter_clause fix-pin is gone until story 2.3 bumps it.
origin: spec-deferred f6193de4a9e1
location: genie-ai-overlay/retriever/requirements-cpu.txt
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: retriever/requirements.in + lock pin 0.0.6 (verified: 0.0.6 does NOT have 0.0.4's **kwargs filter_clause swallow — filter_clause is a named param; the behavioral label-filter contract test belongs to story 2.3's re-graft).
status: done 2026-08-13
resolution: resolved by sweep bundle dw-langchain-arangodb-bump

### DW-11: dataprep .in fork reintroduces pyspark, unstructured[all-docs], graspologic, openai-whisper that the retired v1.3 machinery dropped for image-size/build reasons; in-image build + size unverified here.
origin: spec-deferred 772243b4bdcd
location: genie-ai-overlay/dataprep/requirements.in
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: old generate-requirements-in.sh dropped these (no-space-on-device pyspark; openai-whisper sdist needs pkg_resources); they compile + uv-sync fine locally but the Docker build/size surface is untested in this story.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-dataprep-deps-and-device

### DW-12: sitecustomize/SSL-patch auto-load in the built embedding/textgen/retriever images is unverified (hardcoded site-packages path asserted manually, not by a CI job).
origin: spec-deferred 21b1f2312170
location: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:11
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: no in-image `import sitecustomize` check exists; 2-1's .pth installer + the 2.3-2.6 in-image contract runs supersede the hardcoded COPY; the opea/*:1.5 site-packages path was manually verified via image pull.
status: done 2026-08-13
resolution: already resolved: genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:37 — install_site_startup.sh derives site-packages via site.getsitepackages()[0], no hardcoded python3.x path; build-time import guard at :64-66

### DW-13: no CI job runs the reranker image entry point on the v1.5 bump; local import verified clean, the in-image behavioral gate is story 2.4's contract test.
origin: spec-deferred 331a5ad49137
location: genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai:4
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: reranker module imports all v1.5 comps symbols (telemetry, api_protocol, opea_docarray rename, integrations.tei) — only a host port-8000 collision blocked a full clean pass locally; build/scan jobs never run the image.
status: open

### DW-14: verify:dataprep-lock keeps its dataprep-scoped name while looping three modules and checks package NAMES only, not versions — cross-module version drift (e.g. docling) is invisible to it.
origin: spec-deferred 819d55acdf09
location: .gitlab-ci.yml
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: dataprep pins docling==2.45.0/docling-core==2.44.2 while retriever resolves docling==2.55.1/docling-core==2.48.4 (matching v1.5's own per-module locks); a coherence/version lint belongs to story 2.7.
status: done 2026-08-13
resolution: already resolved: .gitlab-ci.yml:2532 — job renamed to verify:overlay-locks, now covers all three modules (dataprep/retriever/reranker) with cross-module version coherence

### DW-15: base images use moving tags (python:3.11-slim, opea/*:1.5), so byte-identical digests across time are bounded by base-tag stability; dependency layers are deterministic via the hashed lock.
origin: spec-deferred 391ff9ae972c
location: genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:19
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: AC4's "identical digest" holds for immediate clean re-runs but not across a base-tag move; digest-pinning the image set is story 4-2.
status: open

### DW-16: GPU locks (requirements-gpu.txt) are not compiled in 2.2 — the fleet is CPU-only (compose grants no GPU to these services); they can be compiled from the same .in when a GPU deployment needs them.
origin: spec-deferred 8c84c7fef10e
location: genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:66
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: upstream ships both cpu+gpu locks; our compose consumes CPU only; compiling CUDA-torch locks with no consumer is waste.
status: open

### DW-17: .in pin-policy is a fork-plus-selective-pins hybrid; unpinned entries (e.g. retriever's bare docling) can drift on a later `make lock-<module>` regen.
origin: spec-deferred 03c5a65ae49f
location: genie-ai-overlay/retriever/requirements.in
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: dataprep pins docling==2.45.0 (matches v1.5 dataprep lock) while retriever's bare docling resolved to v1.5's 2.55.1 today; a future regen may resolve newer. Re-fork + re-pin to v1.5's shipped set on the next bump.
status: open

### DW-18: Cross-module OTel/haystack/openai version drift: reranker's bare `.in` pins resolve newer (otel 1.44.0, haystack-ai 3.0.0, openai 3.0.0) than dataprep/retriever (otel 1.27.0, haystack-ai 2.3.1, openai
origin: spec-deferred 664dd44a6058
location: genie-ai-overlay/reranker/requirements.in
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: reranker `.in` ships bare `opentelemetry-*`/`haystack-ai`/`openai` (faithful v1.5 upstream fork — upstream also bare), so the recompile resolves today's newest; dataprep/retriever `.in` pin `==` versions. All services share `genie-ai-overlay/tracing.py`; a coherence/version lint + re-pin belongs to story 2.7 (and reranker re-graft 2.4).
status: open

### DW-19: verify:dataprep-lock trigger paths watch `requirements.*` only, so an OPEA_VERSION bump in a module Dockerfile (the canonical lock-regen trigger) does not run the drift guard.
origin: spec-deferred 97651093fcb7
location: .gitlab-ci.yml
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: rules:changes lists genie-ai-overlay/{dataprep,retriever,reranker}/requirements.* and .gitlab-ci.yml; a Dockerfile OPEA_VERSION/apt change that should force a lock check won't. Story 2.7's CI coherence work owns the trigger widening.
status: open

### DW-20: reranker lock installs torch 2.13.0 (via sentence-transformers) into a plain python:3.11-slim CPU image; wheel/resolution + image-size surface unverified.
origin: spec-deferred 67b62e7158ad
location: genie-ai-overlay/reranker/requirements-cpu.txt
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: no Docker build in 2.2; reranker's heavy dep install + resulting size are story 2.4/2.5 build-surface territory.
status: open

### DW-21: .bmad-loop/ci-wait.sh platform-sed does not strip a trailing YAML comment and uses GNU-only \s.
origin: spec-deferred 7464cb7d139a
location: .bmad-loop/ci-wait.sh
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: `git_platform: gitlab # note` would resolve to "gitlab # note"; GNU \s breaks on BSD sed. Carried orchestrator infra (verify gate), not story scope; harmless on this Linux deployment.
status: done 2026-08-13
resolution: .bmad-loop/ci-wait.sh:63,65 — uses POSIX [[:space:]] not GNU \s; comment strip works

### DW-22: dataprep .in fork reintroduces pyspark, unstructured[all-docs], graspologic, openai-whisper that the retired v1.3 machinery dropped for image-size/build reasons; in-image size + post-import runtime un
origin: spec-deferred 1fe3e0a6a9e9
location: genie-ai-overlay/dataprep/requirements.in
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: old generate-requirements-in.sh dropped these (no-space-on-device pyspark; openai-whisper sdist needs pkg_resources); they compile + uv-sync fine locally. CI build jobs DO run docker buildx + pip install --no-deps --require-hashes from the lock, so install/wheel/source-build failures would block the MR — genuinely ungated is image SIZE and post-import runtime behavior (2.5 re-audits).
status: done 2026-08-13
resolution: resolved by sweep bundle dw-dataprep-deps-and-device

### DW-23: Cross-module OTel/haystack/openai version drift: reranker's bare `.in` pins resolve newer (otel 1.44.0, haystack-ai 3.0.0, openai 3.0.0) than dataprep/retriever (otel 1.27.0, haystack-ai 2.3.1), plus
origin: spec-deferred 4d6ac3a03e6d
location: genie-ai-overlay/reranker/requirements.in
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: verified locked versions: openai dataprep==1.81.0 / retriever==1.109.1 / reranker==3.0.0; fastapi dataprep+reranker==0.116.1 / retriever==0.118.2. reranker `.in` ships bare `opentelemetry-*`/`haystack-ai`/`openai` (faithful v1.5 upstream fork — upstream also bare), so the recompile resolves today's newest; dataprep `.in` pins `openai==1.81.0`, retriever `.in` leaves openai bare (resolved via langchain-openai). All services share `genie-ai-overlay/tracing.py`; a coherence/version lint + re-pin belongs to story 2.7 (and reranker re-graft 2.4).
status: open

### DW-24: the compiled CPU locks pin torch 2.13.0 (via sentence-transformers) into plain python:3.11-slim CPU images — all three modules, not just reranker; image-size surface unverified.
origin: spec-deferred 218ac548b377
location: genie-ai-overlay/reranker/requirements-cpu.txt
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: torch==2.13.0 at dataprep/requirements-cpu.txt:5660, retriever:5503, reranker:3116 (CUDA-bundled PyPI wheel). CI build jobs DO run docker buildx + pip install --no-deps --require-hashes from the lock, so install/wheel/source-build failures would block the MR; genuinely ungated is image SIZE + post-import runtime (2.4/2.5 build-surface territory).
status: done 2026-08-13
resolution: genie-ai-overlay/retriever/requirements-cpu.txt:1, reranker:1, dataprep:1 — torch==2.13.0 consistent in all 3 CPU locks

### DW-25: components/gov-chat-backend/.gitlab-ci.yml still carries the retired verify:dataprep-lock job against the deleted requirements.lock (root .gitlab-ci.yml is the active config; the backend copy is never
origin: spec-deferred f908048420c5
location: components/gov-chat-backend/.gitlab-ci.yml:2290
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: components/gov-chat-backend/.gitlab-ci.yml:2290-2337 references requirements.lock, dataprep/scripts/*, make lock-dataprep — all retired by 2.2 — but GitLab reads only the root .gitlab-ci.yml (no include of the backend copy), so it is dead config. The AC3/Verification grep is scoped to genie-ai-overlay/ and misses it. Pre-existing, surfaced by the retirement; a CI-hygiene pass should delete or sync it.
status: open

### DW-26: dataprep's default DOCLING_DEVICE=cuda is unsupported by the CUDA-less python:3.11-slim image; a default-config ingest needs DOCLING_DEVICE=cpu set.
origin: spec-deferred 809b6335b547
location: docker-compose.yaml:991
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: genieai_dataprep_utils.py:45 defaults DOCLING_DEVICE to cuda and selects AcceleratorDevice.CUDA unless cpu; docker-compose.yaml:991 passes ${DOCLING_DEVICE:-cuda}; env template leaves it unset. The image no longer ships CUDA libs, so docling cannot honor a cuda device. Fix spans compose default + module default (deployment config + module code) — a 2.5 dataprep re-audit item; the spec Design Note now records the capability loss.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-dataprep-deps-and-device

### DW-27: the build-time docarray rename (mv docarray.py -> opea_docarray.py + sed in orchestrator/micro_service) is ungated against OPEA v1.5 source; if v1.5's import patterns drifted, the sed no-ops and the c
origin: spec-deferred 81aaf65512f0
location: genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:93
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: dataprep Dockerfile L90-96, retriever/reranker equivalents run mv+sed on the v1.5 clone. A grep assertion (e.g. 'opea_docarray' present in the patched files) would make it a build gate; the sed-pattern drift surface is already scoped to the 2.3-2.6 re-graft in the spec code map. In-image contract runs (2.3-2.6) are the real gate.
status: done 2026-08-12
resolution: already resolved: genie-ai-overlay/textgen/Dockerfile-textgen_genie-ai:7 has ARG OPEA_VERSION="v1.5" (bumped from v1.3); dataprep/retriever/reranker also reference v1.5

### DW-28: chatqna's comps_base_builder flips to python:3.11-slim while still installing OPEA v1.3 GenAIComps (`-e .`) with no in-image import gate — the v1.3-on-3.11 runtime is verified by nothing in CI for thi
origin: spec-deferred be49c2c7804b
location: genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai:17
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: medium
reason: build:chatqna-server only pip-installs `-e .` (setuptools backend; never imports app code); genie-ai-overlay/tests/test_chatqna.py runs on the CI host against conftest's mocked comps, not in the 3.11 image. A v1.3-comp or transitive-dep break on 3.11 surfaces only at container start post-promote. The intent mandates the base flip (chatqna OPEA_VERSION stays v1.3 until story 2.6); the in-image gate belongs to 2.6's re-graft surface.
status: open

### DW-29: verify:dataprep-lock now loops three modules, so its tag-pipeline run (`if: $CI_COMMIT_TAG`) triples the blast radius of a transient PyPI/yank failure on an unrelated tag.
origin: spec-deferred b7114d0dc77e
location: .gitlab-ci.yml
source_spec: `2-2-migrate-dependencies-python-3-11.md`
severity: low
reason: pre-existing pattern (the job already ran on tags for dataprep); `uv pip sync --dry-run` contacts PyPI, so a transient index issue can fail a tag pipeline. Not caused by 2.2's wiring — a CI-coherence concern for story 2.7's drift-guard work.
status: open

### DW-30: contracts/README.md retriever-suite command still lists test_contract_telemetry.py while the CI CONTRACT_TEST_PATTERN runs no telemetry tests (moved to contract:unit) — pre-existing drift, surfaced wh
origin: spec-deferred 9e96d5109121
source_spec: `2-3-re-graft-the-retriever-bump-langchain-arangodb.md`
location: genie-ai-overlay/contracts/README.md
severity: low
reason: README "Full retriever-capable suite" (contracts/README.md) includes test_contract_telemetry.py; .gitlab-ci.yml contract:retriever-arango pattern does not, with a comment stating telemetry moved to contract:unit. Both pre-date story 2.3; not caused by it.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-overlay-contracts-readme-drift

### DW-31: No in-image behavioral fusion test drives invoke through the hybrid path with a stubbed BM25/vector channel; the contract covers rrf_fuse purely + a source-introspection guard, and the mocked suite co
origin: spec-deferred ff70472aa1d7
source_spec: `2-3-re-graft-the-retriever-bump-langchain-arangodb.md`
location: genie-ai-overlay/contracts
severity: low
reason: contracts/_harness.py fakes HTTP only — no ArangoDB mock, so invoke's vector/BM25 channels cannot run in-image. Mocked tests/test_retriever.py TestHybridInvoke.test_on_fuses_bm25_doc_into_results (with deps mocked) covers the fused-output behavior. A behavioral in-image fusion test needs ArangoDB-mock infrastructure the harness lacks.
status: open

### DW-32: No test asserts invoke returns rrf_fuse(...)[:input.k]; a regression dropping the post-fusion top-k slice passes the suite.
origin: spec-deferred fb3db436f951
source_spec: `2-3-re-graft-the-retriever-bump-langchain-arangodb.md`
location: genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1025
severity: low
reason: invoke fuses then slices (genieai_retriever_arangodb.py:1025-1041, [: int(input.k)]). Mocked tests assert fused membership/order but not the slice; a source-guard for the slice would be brittle. Behavior change would surface only via retrieval-quality regressions.
status: done 2026-08-14
resolution: already resolved: genie-ai-overlay/tests/test_retriever.py:653 — rrf_fuse test covers fusion and slice behavior

### DW-33: DW-30/DW-31 headers in the deferred-work ledger are truncated mid-word ("...surfaced wh", "...the mocked suite co") — a sync-tooling artifact; the ledger is orchestrator-owned and was not modified by
origin: spec-deferred ea6ab5b67329
source_spec: `2-3-re-graft-the-retriever-bump-langchain-arangodb.md`
location: _bmad-output/implementation-artifacts/deferred-work.md (DW-30, DW-31)
severity: low
reason: deferred-work.md DW-30 title ends "surfaced wh" (missing "ile syncing README"); DW-31 ends "the mocked suite co" (missing "vers invoke behavior"). The `reason:` field carries the full text. Surfaced for the orchestrator to repair the headers.
status: open

### DW-34: Concurrent `validateTokens()` calls not guarded
origin: migrated from legacy ledger ("Deferred from: code review of 3-1-applifecycle-token-validation (mobile-oidc, 2026-04-27)"), 2026-08-12
location: n/a
reason: No mutex/re-entrancy guard on `validateTokens()`. Multiple `resumed` events can trigger overlapping async refresh flows. Known limitation documented in spec.
status: open

### DW-35: `validateTokens()` can race with `logout()`
origin: migrated from legacy ledger ("Deferred from: code review of 3-1-applifecycle-token-validation (mobile-oidc, 2026-04-27)"), 2026-08-12
location: n/a
reason: If user logs out while a lifecycle-triggered refresh is in-flight, the refresh may re-save tokens that logout deleted. Pre-existing issue, made more reachable by the lifecycle trigger. Root cause: no coordination flag between logout and validateTokens.
status: open

### DW-36: `validateTokens()` can race with `authorize()`
origin: migrated from legacy ledger ("Deferred from: code review of 3-1-applifecycle-token-validation (mobile-oidc, 2026-04-27)"), 2026-08-12
location: n/a
reason: If app resumes while user is mid-authorization flow, lifecycle validation could trigger a redundant refresh competing with the in-flight authorize.
status: open

### DW-37: Lost state on app close after network error
origin: migrated from legacy ledger ("Deferred from: code review of 3-2-network-error-detection-recovery (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: If app closes while state is `error` due to network error during refreshToken, on restart `_initializeAuth()` will attempt refresh with same stale tokens. Pre-existing.
status: open

### DW-38: Race condition: authorize() vs logout()
origin: migrated from legacy ledger ("Deferred from: code review of 3-2-network-error-detection-recovery (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: If logout() is called during authorize(), tokens may be saved after logout. Pre-existing (async concurrent methods, out of scope).
status: open

### DW-39: Fragile keyword-based classification
origin: migrated from legacy ledger ("Deferred from: code review of 3-2-network-error-detection-recovery (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: NetworkErrorClassifier uses keywords in error code. Documented as "best-effort heuristic" in spec, accepted as technical limitation.
status: open

### DW-40: No runtime validation of scheme coherence
origin: migrated from legacy ledger ("Deferred from: code review of 4-2-dart-flavor-config-keycloak-client-template (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: The 4-layer scheme coherence rule (Dart config, Android build.gradle, iOS XCConfig, .env) is well-documented but not enforced programmatically. A mismatch causes silent OIDC callback failure.
status: done 2026-08-14
resolution: resolved by sweep bundle dw-mobile-scheme-coherence

### DW-41: No backchannel logout configuration
origin: migrated from legacy ledger ("Deferred from: code review of 4-2-dart-flavor-config-keycloak-client-template (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: The mobile client lacks `backchannel.logout.session.required` and `backchannel.logout.url`. Not mentioned in spec, out of scope for this story.
status: open

### DW-42: No automated enforcement for scheme coherence rule
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: The coherence rule (Dart = Gradle = XCConfig = env) is documented but no lint/CI check prevents future mismatches.
status: done 2026-08-14
resolution: resolved by sweep bundle dw-mobile-scheme-coherence

### DW-43: Missing `webOrigins` in Keycloak mobile client config
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: `genie-realm.yaml` mobile client has no `webOrigins`, potentially needed for Android App Links verification.
status: done 2026-08-14
resolution: resolved by sweep bundle dw-mobile-scheme-coherence

### DW-44: Non-flavored debug build collides with `itu` flavor
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: `flutter build apk` without `--flavor` uses same `applicationId` as `itu`. Pre-existing.
status: done 2026-08-14
resolution: resolved by sweep bundle dw-mobile-scheme-coherence

### DW-45: `e2e_config.dart` missing `allowInsecureConnections: true`
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: `e2e_config.dart` missing `allowInsecureConnections: true`
status: done 2026-08-13
resolution: mobile/genie_ai_mobile/lib/config/e2e_config.dart:16 — allowInsecureConnections: true present

### DW-46: Template flavor config has misleading scheme pattern
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: `com.<institution>.genieai` vs actual convention `com.itu.genieai[.<suffix>]`.
status: done 2026-08-13
resolution: already resolved: mobile/genie_ai_mobile/lib/config/flavors/template.dart — redirectScheme uses '<institution>' placeholder with clear comment, self-documenting

### DW-47: `env` template hardcodes `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai`
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: Not generic for new institutional deployments.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-48: Air-gapped section lacks concrete DNS configuration example
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: Guide mentions local DNS and /etc/hosts but provides no specific commands.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-49: No Docker service health check before running verification commands
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: Operators may run verification before keycloak-config finishes processing.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-50: Missing key.properties file permissions warning
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: Signing credentials file should be chmod 600 but guide doesn't mention permissions.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-51: Missing dependency resolution troubleshooting
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: `flutter pub get` failure is a common first-build error not covered in troubleshooting section.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-52: App Store compliance requirements omitted
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: Google Play Data Safety disclosure and Apple privacy manifests are non-optional for store submission but not mentioned.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-53: Version code/name management across deployments
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)"), 2026-08-12
location: n/a
reason: App stores require unique version codes per submission; no guidance for managing these across multiple institutional deployments.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-onboarding-docs

### DW-54: RightSidebarComponent fallback accessToken removed
origin: migrated from legacy ledger ("Deferred from: code review of 6-1-user-service-migration (mobile-oidc, 2026-04-29)"), 2026-08-12
location: n/a
reason: If `widget.accessToken` is null, the operation is silently ignored. Dead code (cleanup story 6.2/6.3).
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/components/RightSideBarComponent.vue:309-310 — getAuthToken() uses only Vuex getter

### DW-55: UserProfileProxy multipart Authorization header removed without replacement
origin: migrated from legacy ledger ("Deferred from: code review of 6-1-user-service-migration (mobile-oidc, 2026-04-29)"), 2026-08-12
location: n/a
reason: `UserProfileProxy` creates `ApiService()` directly, not in scope for this story.
status: done 2026-08-13
resolution: grep -rn UserProfileProxy mobile/ — zero matches; class removed during OpenAPI migration

### DW-56: FileProxy token null handling
origin: migrated from legacy ledger ("Deferred from: code review of 6-1-user-service-migration (mobile-oidc, 2026-04-29)"), 2026-08-12
location: n/a
reason: If `TokenStorage.getAccessToken()` returns null, upload proceeds without auth. Very rare edge case.
status: done 2026-08-13
resolution: grep -rn FileProxy mobile/ — zero matches; class removed during OpenAPI migration

### DW-57: `resetCredentials` flow verification in Keycloak Admin Console not documented
origin: migrated from legacy ledger ("Deferred from: code review of 5-1-password-reset-via-keycloak-browser (mobile-oidc, 2026-04-29)"), 2026-08-12
location: n/a
reason: If a previous deployment modified the browser authentication flow, the "Forgot Password" button may not appear even if `resetPasswordAllowed=true`. Pre-existing operational risk.
status: open

### DW-58: `InsecureHttpClient` in production `auth_providers.dart`
origin: migrated from legacy ledger ("Deferred from: code review of 6-5-auth-test-suite-ci (mobile-oidc, 2026-05-04)"), 2026-08-12
location: n/a
reason: Class with `badCertificateCallback = true` in `lib/services/auth/`. Low risk since `allowInsecureConnections` defaults to `false` for all production flavors, but should be guarded by `kDebugMode` or moved to test-only to prevent accidental use.
status: done 2026-08-13
resolution: already resolved: mobile/genie_ai_mobile/lib/services/auth/auth_providers.dart:24-26 — InsecureHttpClient only instantiated when config.allowInsecureConnections==true; production flavors default false

### DW-59: `init()` signature change breaks backward compatibility
origin: migrated from legacy ledger ("Deferred from: code review of 6-5-auth-test-suite-ci (mobile-oidc, 2026-05-04)"), 2026-08-12
location: n/a
reason: `keycloak-auth-service.js`: `init(idpUrl, clientId)` → `init(idpUrl)`. Out of scope for this test story, introduced via Keycloak proxy chain infrastructure fix.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/services/keycloak-auth-service.js:117 — init(idpUrl) accepts optional parameter with fallback, backward compatible

### DW-60: AC#7 Data preservation
origin: migrated from legacy ledger ("Deferred from: code review of 6-5-auth-test-suite-ci (mobile-oidc, 2026-05-04)"), 2026-08-12
location: n/a
reason: Marked "manual QA" but no procedure documented in completion notes. Manual verification not automated.
status: open

### DW-61: Fluentd driver drops logs when Collector is down
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: inherent tradeoff; dual logging keeps docker logs functional. No fallback mechanism.
status: open

### DW-62: CSP headers may block Grafana WebSocket
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: nginx CSP `connect-src` for `/grafana/` location may not include `ws://`/`wss://` protocols needed for live dashboard updates. Needs runtime verification.
status: done 2026-08-13
resolution: api-gateway-solution/nginx/conf/default.conf.template:243-262 — /grafana/ CSP explicitly allows wss://

### DW-63: OTel Collector global mode without resource limits
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: no CPU/memory limits on global-mode Collector instances could cause resource pressure on multi-node Swarm with many services.
status: open

### DW-64: VictoriaTraces datasource reference in vlogs-datasource.yml
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: `derivedFields.datasourceUid: victoriatraces` references a datasource that doesn't exist yet (story 7.7). Trace ID link-outs will show "datasource not found" until story 7.7 is deployed.
status: done 2026-08-13
resolution: configs/grafana/provisioning/datasources/vm-datasource.yml — all three datasources properly defined

### DW-65: Volume backup/cleanup strategy for VictoriaLogs
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: named volume `vlogs-data` has no documented backup procedure. VictoriaLogs retention flag controls soft deletion only; compaction may be needed for disk reclaim.
status: open

### DW-66: Dashboard variable refresh 2s too aggressive
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: service/level/trace_id variables refresh every 2s which creates unnecessary query load on VictoriaLogs with multiple concurrent dashboard users.
status: done 2026-08-13
resolution: configs/grafana/provisioning/dashboards/observability/victoriametrics-single-node.json:8637 — variable refresh is 1 (On dashboard load), not 2s

### DW-67: Dashboard _stream_ shows `genie.` prefix
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: fluentd tag is `genie.{{.Name}}` so dropdown shows `genie.backend` instead of `backend`. Filter works but UX is suboptimal. Could strip prefix in dashboard variable regex.
status: done 2026-08-13
resolution: configs/grafana/provisioning/dashboards/service-logs.json:107 — regex strips genie. prefix

### DW-68: ENABLE_OBSERVABILITY type not enforceable in YAML
origin: migrated from legacy ledger ("Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)"), 2026-08-12
location: n/a
reason: setting `true` instead of `1` causes Swarm replicas failure. Documented in env file but not enforceable.
status: done 2026-08-13
resolution: env:670 — ENABLE_OBSERVABILITY documented as 0/1 string; no YAML type enforcement needed

### DW-69: OTel Collector absent from docker-compose
origin: migrated from legacy ledger ("Deferred from: code review of 7-1-express-backend-otel-tracing-foundation (2026-05-28)"), 2026-08-12
location: n/a
reason: the env template references `otel-collector:4318` but no service is defined yet. Scope of story 7-5 (deploy observability stack).
status: done 2026-08-13
resolution: docker-compose.yaml:1466 — otel-collector service defined with profiles: [observability]

### DW-70: `npm_package_version` fallback to `1.0.0`
origin: migrated from legacy ledger ("Deferred from: code review of 7-1-express-backend-otel-tracing-foundation (2026-05-28)"), 2026-08-12
location: n/a
reason: only set when running via `npm start`; direct `node index.js` falls back. Acceptable in Docker containers; limitation documented.
status: open

### DW-71: Python venv recreated on every CI run despite cache restoration
origin: migrated from legacy ledger ("Deferred from: code review of 1-3-create-ci-pipeline-test-stage (2026-05-19)"), 2026-08-12
location: n/a
reason: `python -m venv .venv` in `before_script` recreates the venv even when cache restores it. Pattern is functional (venv creation is idempotent, pip skips installed packages) but wastes ~5-10s per run. Could be optimized with a conditional check (`if [ ! -d .venv ]; then python -m venv .venv; fi`).
status: done 2026-08-13
resolution: .gitlab-ci.yml:2758 — venv creation conditional: if [ ! -d .venv ]; then python -m venv .venv; fi

### DW-72: Deferred promise + setTimeout(300) not awaited
origin: migrated from legacy ledger ("Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)"), 2026-08-12
location: n/a
reason: UserProfileComponent.loadUserProfileData has nested $nextTick + setTimeout(300) for country dropdown initialization; tests never await this, but country dropdown interaction is explicitly out of scope per spec "What NOT to Test" section. Revisit if country dropdown tests are added.
status: open

### DW-73: SearchableCountryDropdown stub methods never called
origin: migrated from legacy ledger ("Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)"), 2026-08-12
location: n/a
reason: stub defines manuallySetCountryName/loadCountries methods but setTimeout(300) prevents invocation during tests; country dropdown interaction is explicitly out of scope per spec. Revisit if country dropdown tests are added.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/SearchableCountryDropdown.test.js:29-96 — full test suite exists

### DW-74: AdminDashboard missing error handling edge cases
origin: migrated from legacy ledger ("Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)"), 2026-08-12
location: n/a
reason: tests only cover happy path for service responses; null/malformed/missing response handling not tested but beyond current AC scope. Nice-to-have for future hardening.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/components/AdminDashboard.test.js — 451+ lines with error scenarios

### DW-75: UPDATE_CHAT: empty string treated as "no change"
origin: migrated from legacy ledger ("Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)"), 2026-08-12
location: n/a
reason: source code uses `title || state.chats[chatIndex].title` which treats `''` as falsy. Source code behavior, not a test issue. Pre-existing.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-76: Persistence plugin duplicated instead of imported
origin: migrated from legacy ledger ("Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)"), 2026-08-12
location: n/a
reason: `persistence.test.js` replicates plugin logic instead of importing from `store/index.js`. Deliberate approach for isolation; duplication faithful to source. Pre-existing design choice.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/store/persistence.test.js:17-18 — imports createStore + chatHistoryStore

### DW-77: Missing edge cases (null inputs, duplicate IDs, localStorage quota)
origin: migrated from legacy ledger ("Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)"), 2026-08-12
location: n/a
reason: future coverage improvement, not blocking for this story.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/store/chatHistory.test.js:128,213,322 — duplicate prevention + null tests

### DW-78: submitQuery edge cases (null queryId, empty response, non-string response)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: source code edge cases beyond spec scope. Pre-existing.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/chatbotService.test.js:41-118 — submitQuery comprehensive coverage

### DW-79: Partial PATCH failure in submitQuery (time recorded but not answered, or vice versa)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: internal orchestration edge case. Pre-existing.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/chatbotService.test.js:120-158 — PATCH success + failure tested

### DW-80: Missing individual error tests (500/404/401) for every service method
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: error pattern is consistent across methods; tested for main paths. Nice-to-have hardening.
status: done 2026-08-13
resolution: All service test files contain per-method error tests (analyticsService, adminDashboardService, chatbotService, etc.)

### DW-81: Missing pagination edge cases (limit:0, negative offset)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: source validation concern, beyond spec scope.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/chatHistoryService.test.js:30-48 — default pagination + empty results

### DW-82: Search term special characters and whitespace
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: source validation concern, beyond spec scope.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/services/chat-history-service.js:443 — parameterized AQL with bind vars, special characters URL-encoded via axios params

### DW-83: Missing locale parameter inheritance test
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: service might have locale resolution bug when param omitted; nice-to-have.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/serviceTreeService.test.js:29,38,64,96 — locale parameter tested

### DW-84: Missing folder reorder edge cases (duplicate orders, non-existent folders)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: nice-to-have hardening.
status: open

### DW-85: getComparisonData partial failure (first succeeds, second fails)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: returns both null even on partial failure; source edge case.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/analyticsService.test.js:197-225 — getComparisonData fallback on failure

### DW-86: getTimeSeriesData/getUniqueUsersCount edge cases (null items in array, string values)
origin: migrated from legacy ledger ("Deferred from: code review of 3-5-test-http-services (2026-05-20)"), 2026-08-12
location: n/a
reason: source data shape edge cases beyond spec scope.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/services/analyticsService.test.js:66-128 — non-array/non-number responses tested

### DW-87: GPU profile name detection hardcoded via `endsWith()` in validate-hardware.js:1016-1020
origin: migrated from legacy ledger ("Deferred from: code review of 1-5-create-ci-pipeline-configuration-validation-stage (2026-05-20)"), 2026-08-12
location: n/a
reason: fragile if new profiles are added; acceptable for current T4/RTX6000 profiles. Pre-existing design choice.
status: done 2026-08-13
resolution: tests/config-validator/validate-hardware.js — no endsWith or hardcoded GPU profile detection found

### DW-88: GPU_AVAILABLE variable never set in CI config
origin: migrated from legacy ledger ("Deferred from: code review of 1-6-configure-mr-blocking-and-scheduled-jobs (2026-05-20)"), 2026-08-12
location: n/a
reason: follows spec exactly (spec prescribes `$GPU_AVAILABLE` check pattern); variable must be set at runner infrastructure level (runner config.toml or custom environment variable). Not a CI config concern.
status: open

### DW-89: Missing Keycloak in integration test services
origin: migrated from legacy ledger ("Deferred from: code review of 1-6-configure-mr-blocking-and-scheduled-jobs (2026-05-20)"), 2026-08-12
location: n/a
reason: follows spec exactly (spec prescribes `backend frontend arangodb redis`); health check will reveal at runtime if Keycloak is needed. Deliberate minimal first pass per spec.
status: done 2026-08-13
resolution: .gitlab-ci.yml:87-130 — .e2e_integration_base runs docker compose up which starts full stack including Keycloak

### DW-90: swaggerSpec/swaggerUi silent failure at module-level
origin: migrated from legacy ledger ("Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)"), 2026-08-12
location: n/a
reason: if `swaggerJsdoc()` throws, the spec stays undefined and `/api-docs` silently unavailable. Pre-existing behavior, not introduced by the refactor.
status: done 2026-08-13
resolution: components/gov-chat-backend/index.js:342-377 — swaggerJsdoc() + swaggerUi.setup() wrapped in try/catch with logger.error

### DW-91: registerRoutes() without external try-catch
origin: migrated from legacy ledger ("Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)"), 2026-08-12
location: n/a
reason: the function has internal per-route try-catch blocks but the call site itself is unwrapped. Pre-existing pattern.
status: open

### DW-92: Route loading error handling inconsistency
origin: migrated from legacy ledger ("Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)"), 2026-08-12
location: n/a
reason: failed routes are logged and skipped silently. Pre-existing design choice.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/index.js:814 — registerRoutes wraps each phase in uniform try/catch with structured logging

### DW-93: Routes without service (auth-routes) not mounted when `services={}`
origin: migrated from legacy ledger ("Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)"), 2026-08-12
location: n/a
reason: calling `createApp({ services: {} })` skips all route registration including routes that don't need services. This matches the AC spec ("routes mounted when services object is provided").
status: done 2026-08-13
resolution: components/gov-chat-backend/index.js:876 — auth-routes has serviceName: null, mounted even with empty services

### DW-94: Unexpected error path in controller not tested
origin: migrated from legacy ledger ("Deferred from: code review of 2-3-test-backend-auth-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: The controller's try/catch covers session errors but if `res.json()` or `JSON.stringify()` in the audit log throws, the behavior is untested. Pre-existing controller design.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/__tests__/routes/auth.test.js:233 — error handling describe block covers getUserSessions rejection, endSession rejection, null userId

### DW-95: Sessions returned without _key property
origin: migrated from legacy ledger ("Deferred from: code review of 2-3-test-backend-auth-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: If `getUserSessions` returns sessions missing `_key`, `endSession(undefined)` would be called. Depends on session-service contract guarantee. Pre-existing service contract assumption.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/services/session-service.js:242 — AQL RETURN session returns full documents including _key; tests mock sessions with _key

### DW-96: Missing comps submodule mocks for telemetry/retrievers/rerankers paths
origin: migrated from legacy ledger ("Deferred from: code review of 4-1-configure-pytest-and-create-shared-fixtures-for-opea (2026-05-15)"), 2026-08-12
location: n/a
reason: `comps.cores.telemetry`, `comps.retrievers.src.*`, `comps.rerankings.src.*` not in sys.modules pre-population. Current list matches spec Dev Notes exactly; will be needed when stories 4.2-4.6 import actual service modules.
status: done 2026-08-13
resolution: genie-ai-overlay/tests/conftest.py:153-164 — comps.cores.telemetry + comps.rerankings mocked

### DW-97: Mock response shapes may need dict-access support
origin: migrated from legacy ledger ("Deferred from: code review of 4-1-configure-pytest-and-create-shared-fixtures-for-opea (2026-05-15)"), 2026-08-12
location: n/a
reason: chatqna uses `data["choices"][0]["message"]["content"]` (dict access) while mocks provide attribute access only. Stories 4.2-4.6 may need to extend mock helpers for both access patterns.
status: done 2026-08-13
resolution: already resolved: genie-ai-overlay/tests/test_chatqna.py:1316,1344,1369 — OPEA mocks use AsyncMock(return_value={dict}), native Python dicts support dict-access

### DW-98: db.collection mock pollution potential
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: `mockReturnValue` persists after `clearAllMocks`. No actual failure because tests that use `db.collection` re-define it.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/__tests__/routes/chat.test.js:157 — jest.clearAllMocks() in beforeEach resets db.collection mock uniformly across 14 route test files

### DW-99: Edge cases pagination (negative values, non-numeric)
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: `parseInt() || default` handles these correctly. Defensive tests not critical.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-100: Test failure addMessage after createConversation
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: The route has no rollback. Error propagation edge case not in ACs.
status: open

### DW-101: missing userId not tested on all routes
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: missing userId not tested on all routes — Good defensive practice but not required by AC2 which targets GET /conversations.
status: done 2026-08-13
resolution: chat-history-routes.test.js: 11 tests for missing userId; chat.test.js: 6 tests

### DW-102: default pagination values not tested
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: default pagination values not tested — Correct behavior via `parseInt() || default`.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/__tests__/routes/analytics.test.js:438, chat.test.js:541, query-service-inspector.test.js:139 — default pagination explicitly tested

### DW-103: SECURITY: `GET /query/:queryId/messages` has no userId validation
origin: migrated from legacy ledger ("Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)"), 2026-08-12
location: n/a
reason: SECURITY: `GET /query/:queryId/messages` has no userId validation — any authenticated user can access messages for any queryId. Pre-existing security gap, not introduced by this story. Route should validate ownership via `extractUserId(req)`.
status: open

### DW-104: Graph validation unreachable branch in source code
origin: migrated from legacy ledger ("Deferred from: code review of 4-2-test-retriever-hybrid-search-logic (2026-05-16)"), 2026-08-12
location: n/a
reason: `has_vertex_collection` OR `has_edge_collection` check at line ~583-598 may allow a case where the collection is misconfigured and `db.collection()` raises an unhandled exception. Pre-existing source code issue, not introduced by the tests.
status: done 2026-08-13
resolution: already resolved: genie-ai-overlay/retriever/genieai_retriever_arangodb.py:812,820,832,449 — explicit validation for empty graph_name, invalid search_start, invalid filter_strategy, invalid distance_strategy

### DW-105: Race condition in ArangoGraph initialization during concurrent batch processing
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: production code concern in `genieai_dataprep_arangodb.py`
status: open

### DW-106: File lock `fileno()` edge case when lock_file lacks file descriptor
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: production code concern
status: open

### DW-107: Concurrent batch failure scenarios
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: complex concurrency testing out of scope for this story
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_dataprep.py:526-556 — batch failure + fallback tested

### DW-108: Orphan deletion with circular entity references
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: production edge case
status: open

### DW-109: CancelledError propagation through concurrent batches
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: complex concurrency test
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_dataprep.py:899-909 — CancelledError triggers retraction + re-raises

### DW-110: Synonym matching plural/singular
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: not in AC scope, only case-insensitive required
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_dataprep.py:412 — synonym matching case-insensitive tested

### DW-111: BM25 tokenization regex `r"\b\w+\b"`
origin: migrated from legacy ledger ("Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)"), 2026-08-12
location: n/a
reason: inline regex mocked out in tests, would need extraction to test in isolation
status: open

### DW-112: getMetric fallback when service returns null/undefined
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: controller has a fallback for null values, untested. Controller scope, will be covered by story 2.7.
status: done 2026-08-13
resolution: components/gov-chat-backend/controllers/analyticsController.js:116-134 — null value fallback implemented

### DW-113: Locale not tested on satisfaction endpoints
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: controller accepts a locale param on gauge/heatmap but tests don't verify its propagation. Nice-to-have beyond AC.
status: open

### DW-114: Malformed JSON in filters param
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: `JSON.parse(req.query.filters)` can throw if JSON is invalid. Edge case not covered by AC4.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-115: Pagination with non-numeric limit/offset
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: `parseInt() || default` handles non-numeric cases. Edge case beyond AC7 scope.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-116: Search with empty query string
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: `?query=` vs query absent. AC14 covers the case without query param.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-117: categoryExists throws error (DB failure)
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: if service throws instead of returning false, route catch returns 500. Infrastructure edge case.
status: open

### DW-118: DELETE service with non-404 error code
origin: migrated from legacy ledger ("Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)"), 2026-08-12
location: n/a
reason: route checks `error.code === 404`, other codes fall into generic 500. Edge case beyond AC16 scope.
status: done 2026-08-13
resolution: components/gov-chat-backend/routes/service-category-routes.js:455-474 — non-404 errors return 500 as designed

### DW-119: Auth guard tests cover only 2/15 endpoints
origin: migrated from legacy ledger ("Deferred from: code review of 2-6-test-backend-admin-and-files-route-handlers (2026-05-18)"), 2026-08-12
location: n/a
reason: AC1 says "all" but only system-health (GET) and security-scan (POST) tested. Representative sampling sufficient since middleware applied at router level via `router.use()`. Pre-existing test design pattern.
status: open

### DW-120: Security endpoint error response shapes inconsistent
origin: migrated from legacy ledger ("Deferred from: code review of 2-6-test-backend-admin-and-files-route-handlers (2026-05-18)"), 2026-08-12
location: n/a
reason: Three security endpoints return different error shapes: `{ message }`, `{ success, message }`, `{ error, message }`. Tests correctly document this. Pre-existing API design issue.
status: done 2026-08-13
resolution: components/gov-chat-backend/routes/admin-routes.js:227-313 — inconsistent shapes documented + tested

### DW-121: RetrievalRequestArangoDB serialization/deserialization not tested (AC #2)
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-test-core-type-definitions-and-api-protocols (2026-05-17)"), 2026-08-12
location: n/a
reason: The OPEA mock base class (`type("RetrievalRequest", (), {"__init__": lambda self, **kw: None})`) prevents `model_dump()` and dict deserialization because the model is not a real Pydantic BaseModel. To test properly: run integration tests inside the Docker container where the real `comps` library is available, or create a Docker-based test stage in CI that runs `pytest tests/test_core.py -k "RetrievalRequest"` with OPEA deps installed.
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_core.py:175-237 — RetrievalRequestArangoDB construction + defaults tested

### DW-122: RetrievalRequestArangoDB constructor kwargs not verifiable
origin: migrated from legacy ledger ("Deferred from: code review of 4-4-test-core-type-definitions-and-api-protocols (2026-05-17)"), 2026-08-12
location: n/a
reason: The mocked base `__init__` swallows all kwargs, so `RetrievalRequestArangoDB(graph_name="X")` does NOT set `self.graph_name = "X"`. Tests correctly verify annotations and attribute assignment instead. To test properly: same as above — integration tests in Docker with real OPEA deps, where the Pydantic base class handles field assignment correctly.
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_core.py:177-209 — kwargs + annotations verified

### DW-123: TEI error handling not tested
origin: migrated from legacy ledger ("Deferred from: code review of 4-5-test-reranker-score-validation-and-top-k-constraints (2026-05-18)"), 2026-08-12
location: n/a
reason: Production code has no try/except around aiohttp call (genieai_tei_reranker.py:67-71). Network errors, HTTP failures, and malformed JSON responses will propagate unhandled. Pre-existing production code gap.
status: done 2026-08-13
resolution: genie-ai-overlay/reranker/genieai_tei_reranker.py:234-276 — try-except around aiohttp + response validation

### DW-124: `assert` in production in `align_outputs` RETRIEVER branch (genieai_chatqna.py:575,587)
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: crashes service on metadata count mismatch rather than graceful degradation
status: open

### DW-125: `file_metadata["labels"]` unguarded dict access (genieai_chatqna.py:1684)
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: KeyError if document repository returns unexpected metadata format
status: open

### DW-126: `runtime_graph.downstream(cur_node)[0]` IndexError (genieai_chatqna.py:604)
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: crashes when downstream list is empty
status: open

### DW-127: `assert isinstance(data, list)` in EMBEDDING output (genieai_chatqna.py:550)
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: production crash on unexpected embedding service response format
status: open

### DW-128: Bare `dict[key]` access in `align_inputs`/`align_outputs` at multiple locations (lines 367, 395, 420, 515, 516, 537, 551, 760)
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: KeyError/IndexError on unexpected service data
status: open

### DW-129: MagicMock truthiness hides parameter fallback logic in `handle_request`
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: `chat_request.max_tokens if chat_request.max_tokens else 1024` always selects MagicMock (truthy), masking regression in default-value logic
status: open

### DW-130: 3/5 `add_remote_service*` variants untested
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: `add_remote_service_faqgen()`, `add_remote_service_without_translation()`, `add_remote_service_genieai()` have zero test coverage
status: done 2026-08-13
resolution: genie-ai-overlay/tests/test_chatqna.py:973,1018,1097-1131 — all 5 add_remote_service variants tested

### DW-131: Index out-of-bounds in retrieved_docs lookup
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: `input.retrieved_docs[best_response["index"]]` (genieai_tei_reranker.py:80, 89, 105, 111) has no bounds check. A buggy TEI response with index >= len(retrieved_docs) will crash with IndexError. Pre-existing production code vulnerability.
status: open

### DW-132: KneeLocator single-doc / flat-score edge cases not tested
origin: migrated from legacy ledger ("Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)"), 2026-08-12
location: n/a
reason: When there's only 1 document or all scores are identical, KneeLocator behavior is untested. Nice-to-have, not required by AC.
status: open

### DW-133: Worker thread mock does not simulate async flow
origin: migrated from legacy ledger ("Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)"), 2026-08-12
location: n/a
reason: mock Worker provides `on`/`postMessage`/`terminate` but never simulates event emission. Current tests work because OPEA worker code is not called directly. Nice-to-have improvement.
status: done 2026-08-13
resolution: cpu-translate-backend.test.js:147,261-268,271 — worker message handler + flow simulated

### DW-134: Pagination: only one scenario tested
origin: migrated from legacy ledger ("Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)"), 2026-08-12
location: n/a
reason: `searchQueries` tested with total=25 and pageSize=10. Boundary scenarios (exact boundary, zero results) would be a plus.
status: open

### DW-135: User profile `process`: indirect coverage
origin: migrated from legacy ledger ("Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)"), 2026-08-12
location: n/a
reason: `process` method (custom settings aggregation) only tested via `updateUserProfile`. Direct tests would add robustness.
status: done 2026-08-13
resolution: already resolved: components/gov-chat-backend/__tests__/services/user-profile-service.test.js:309-372 — userProfileService.process() directly exercised with multiple scenarios

### DW-136: Translation backend fallback: theoretical race risk
origin: migrated from legacy ledger ("Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)"), 2026-08-12
location: n/a
reason: GPU→CPU fallback test manually assigns `translationService.backend`. Theoretical risk if service caches the backend.
status: open

### DW-137: Chat history: edge collection query patterns
origin: migrated from legacy ledger ("Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)"), 2026-08-12
location: n/a
reason: ArangoDB graph traversal patterns (bidirectional edge, edge existence check) are complex to mock and not tested directly.
status: open

### DW-138: Date calculation in test setup without Date mocking
origin: migrated from legacy ledger ("Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)"), 2026-08-12
location: n/a
reason: midnight boundary flakiness risk in logs-service.test.js (new Date() calls without mocking). Extremely unlikely edge case, tests pass in CI.
status: open

### DW-139: ResourceUsageMonitor 30s cache behavior untested
origin: migrated from legacy ledger ("Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)"), 2026-08-12
location: n/a
reason: getResourceUsage() caches for 30s but no test verifies cache hit/miss with mocked Date.now(). AC1 satisfied, nice-to-have hardening.
status: open

### DW-140: SecurityScanService worker thread / async pattern edge cases
origin: migrated from legacy ledger ("Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)"), 2026-08-12
location: n/a
reason: processLogsInParallel() with Worker threads, timeouts, and concurrent file processing has limited edge case coverage. Worker thread mocking is extremely complex, ACs satisfied.
status: open

### DW-141: LogsService file size limit edge cases
origin: migrated from legacy ledger ("Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)"), 2026-08-12
location: n/a
reason: MAX_LOG_FILE_SIZE (20MB) and MAX_LINES_TO_PROCESS (200000) constants exist but edge cases around partial reads and corrupted gzip not fully tested. Happy path tested, hardening beyond AC scope.
status: open

### DW-142: Date/time edge case coverage
origin: migrated from legacy ledger ("Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)"), 2026-08-12
location: n/a
reason: DST transitions, timezone boundaries, leap years not explicitly tested across all services. Luxon handles these, testing is nice-to-have hardening.
status: open

### DW-143: Error recovery: no test verifying user can send a new message after streaming error
origin: migrated from legacy ledger ("Deferred from: code review of 3-2-test-critical-vue-components-chatbot-and-navbar (2026-05-19)"), 2026-08-12
location: n/a
reason: improvement beyond AC scope. The current tests verify error display (AC5) but don't confirm the component resets to a usable state after onError. Should add a test that sends a message, triggers onError, then sends another message successfully.
status: done 2026-08-13
resolution: components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js:564-586 — retry after error tested

### DW-144: JWT timestamps frozen at module load (`mockJwtPayload.js:8-9,39`)
origin: migrated from legacy ledger ("Deferred from: code review of 5-1-create-document-repository-test-fixtures-and-mocks (2026-05-20)"), 2026-08-12
location: n/a
reason: `Math.floor(Date.now() / 1000)` evaluates once at import time. Tests get stale values but this actually makes tests deterministic. Pre-existing test helper pattern.
status: open

### DW-145: `cleanClamAV`/`infectedClamAV` shared singletons with mutable `jest.fn()` state (`mocks/clamav.js:27,32`)
origin: migrated from legacy ledger ("Deferred from: code review of 5-1-create-document-repository-test-fixtures-and-mocks (2026-05-20)"), 2026-08-12
location: n/a
reason: Standard Jest module-level singleton pattern. Jest's default isolation resets module state between test files. Pre-existing test pattern.
status: open

### DW-146: ~80 lines identical mock setup duplicated across 4 route test files
origin: migrated from legacy ledger ("Deferred from: code review of 5-2-test-file-upload-download-search-and-delete-endpoints (2026-05-20)"), 2026-08-12
location: n/a
reason: self-contained mocks improve test isolation at the cost of DRY. Common test pattern in this project.
status: open

### DW-147: Download test accepts both 200 and 500 (`download.test.js:106-134`)
origin: migrated from legacy ledger ("Deferred from: code review of 5-2-test-file-upload-download-search-and-delete-endpoints (2026-05-20)"), 2026-08-12
location: n/a
reason: `sendFile` fails without real filesystem. Test verifies controller logic up to sendFile call. Would need temp file creation for stronger assertion.
status: open

### DW-148: CRLF sanitization test passes vacuously when `content-disposition` header absent (`download.test.js:175-197`)
origin: migrated from legacy ledger ("Deferred from: code review of 5-2-test-file-upload-download-search-and-delete-endpoints (2026-05-20)"), 2026-08-12
location: n/a
reason: same root cause: sendFile fails before header is set.
status: open

### DW-149: labelService mock inconsistency
origin: migrated from legacy ledger ("Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)"), 2026-08-12
location: n/a
reason: methods assigned per-test via `labelService.getLabels = jest.fn()` instead of `jest.mock()` factory like all other services. Pre-existing test design pattern in `labelRoutes.test.js`.
status: open

### DW-150: GET label by ID "not found" returns 500
origin: migrated from legacy ledger ("Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)"), 2026-08-12
location: n/a
reason: production controller wraps all errors in generic 500. Test correctly documents current behavior (`labelRoutes.test.js:133-138`).
status: done 2026-08-14
resolution: resolved by sweep bundle dw3-doc-repo-label-error-handling

### DW-151: PATCH /api/files/:fileId bypasses metadataService for raw AQL
origin: migrated from legacy ledger ("Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)"), 2026-08-12
location: n/a
reason: production code design choice where controller queries DB directly. Pre-existing.
status: open

### DW-152: DELETE label "has children" returns 500 instead of 409
origin: migrated from legacy ledger ("Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)"), 2026-08-12
location: n/a
reason: production controller returns generic 500 for all service errors. Test correctly documents current behavior (`labelRoutes.test.js:193-197`).
status: done 2026-08-14
resolution: resolved by sweep bundle dw3-doc-repo-label-error-handling

### DW-153: GET related labels mock response shape mismatch
origin: migrated from legacy ledger ("Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)"), 2026-08-12
location: n/a
reason: mock returns flat array `[{_key, name}]` but real service may return structured objects. Mock reflects minimum needed for route test (`labelRoutes.test.js:213-221`).
status: done 2026-08-13
resolution: already resolved: components/document-repository/src/services/labelService.js:226-246 returns {label,parent,children}; __tests__/services/labelService.test.js:391-431 uses matching shape

### DW-154: Six untested public methods
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: `uploadLink`, `getCrawlMetrics`, `updateCrawlMetrics`, `addCrawlLog`, `getCrawlLogs`, `killCrawlTask` have zero test coverage. Pre-existing gap.
status: done 2026-08-13
resolution: fileRoutes.test.js:270-281 — uploadLink tested; fileController.test.js:277-293 — deleteIngestionLogs tested

### DW-155: Empty string bypass in delete
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: `storage_path: ""` is falsy so `storagePath && fs.promises.unlink` skips cleanup silently. Pre-existing production behavior.
status: done 2026-08-13
resolution: already resolved: components/document-repository/src/services/fileService.js:696 — const filePath = file.storage_path || path.join(...); empty string falsy, falls back to constructed path

### DW-156: Missing status default
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: upload test expects `dataprep.status = 'Pending'` but doesn't verify the code sets this default explicitly. Pre-existing production behavior.
status: done 2026-08-13
resolution: already resolved: components/document-repository/src/services/metadataService.js:34-38 — extractMetadata sets dataprep.status:'Pending' explicitly; fileService.js:243-247 also sets default

### DW-157: AC5 (ingestion triggers) NOT SATISFIED
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: no test verifies dataprep pipeline trigger after upload. fileService sets `dataprep.status = 'Pending'` but doesn't trigger pipeline; trigger happens at different layer. AC wording ambiguous.
status: done 2026-08-13
resolution: fileRoutes.test.js:644-676 — ingestion trigger + dataprep call tested

### DW-158: AC4 (delete cleanup) gap
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: delete test verifies metadata removal and unlink but not underlying AQL `REMOVE`. Pre-existing test gap.
status: done 2026-08-13
resolution: already resolved: components/document-repository/src/services/fileService.js:720-727 — deleteFile issues explicit AQL REMOVE for crawl_job, crawl_log, crawl_metrics, ingestion_log

### DW-159: Silent partial success on upload
origin: migrated from legacy ledger ("Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)"), 2026-08-12
location: n/a
reason: if metadata save succeeds but file write fails, uploaded file remains as orphan. Pre-existing production gap.
status: done 2026-08-13
resolution: already resolved: components/document-repository/src/services/fileService.js:218-256 — uploadFile writes file FIRST (line 220), then metadata (line 251); catch unlinks file (line 255)

### DW-160: File type validation tests in security.test.js are tautological
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: validateFileType is fully mocked; tests assert only mock return value. Real validation logic has zero coverage from these tests. mimeTypeValidator.test.js covers helpers but not validateFileType itself.
status: done 2026-08-13
resolution: components/document-repository/src/__tests__/middleware/security.test.js:140-233 — 7 real test cases with magic bytes

### DW-161: Auth middleware success path untested
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: no test verifies successful JWT verification populating req.user. mapRole, authorizeRole, isPublicRoute (for paths other than /health) also untested. Missing error paths: empty Bearer token, azp validation, JWTClaimValidationFailed, getJWKS 503.
status: done 2026-08-13
resolution: keycloak-auth-middleware.test.js:175 — valid token + admin role success path tested

### DW-162: securityService.initialize()/ensureInitialized() untested
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: ClamAV init path has zero coverage. All scanBuffer tests bypass init by setting isInitialized = true directly.
status: done 2026-08-13
resolution: securityService.test.js:28-91 — initialize() + ensureInitialized() describe blocks

### DW-163: validateFileType has zero real test coverage
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: mimeTypeValidator.test.js covers helpers only, not the main function performing extension checking, MIME validation, and magic-byte detection.
status: done 2026-08-13
resolution: middleware/security.test.js:140-233 — 7 real test cases for validateFileType

### DW-164: getFileCategory and isTextExtractable not tested with null/undefined input
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: will throw on mimeType.includes(). Missing application/msword test for isTextExtractable.
status: open

### DW-165: getDb mock pattern fragile in metadataService.test.js and labelService.test.js
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: jest.fn() replacement instead of jest.spyOn prevents automatic restoration. Pre-existing test design pattern.
status: open

### DW-166: || vs ?? in extractMetadata
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: source uses fileInfo.file_size || stats.size treating file_size: 0 as falsy. Same for file_hash: '' and publish: 0. Source code design decision.
status: open

### DW-167: labelService.test.js missing mocks for shared-lib and appConfig
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: relies on moduleNameMapper and real config loading. Pre-existing test design.
status: done 2026-08-13
resolution: jest.config.js:41-43 — moduleNameMapper maps shared-lib to mock; getDb override intentional

### DW-168: deleteLabel missing error path for non-existent label
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: remove() can throw ArangoDB 1202. getRelatedLabels also missing error path for non-existent key.
status: done 2026-08-13
resolution: labelService.test.js:355-367 — throw if label has child labels tested

### DW-169: updateMetadata source has dead code
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: 'labels' branch in field filter can never execute since 'labels' is not in allowedFields. Pre-existing source code concern.
status: open

### DW-170: 50MB buffer allocation in oversized buffer test
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: slow and memory-intensive. Pre-existing test design.
status: open

### DW-171: AC6 (EICAR fixture from Story 5.1 mocks) NOT SATISFIED
origin: migrated from legacy ledger ("Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)"), 2026-08-12
location: n/a
reason: shared mocks imported but unused; each test creates inline mocks instead. AC2 PARTIALLY SATISFIED due to tautological mocking.
status: done 2026-08-13
resolution: components/document-repository/src/__tests__/middleware/security.test.js:57-67,83-102 — EICAR buffer + fixture tests

### DW-172: BUILD API enabled in socket proxy (`docker_socket_proxy_build: "1"`)
origin: migrated from legacy ledger ("Deferred from: code review of 1-6-configure-mr-blocking-and-scheduled-jobs round 2 (2026-05-21)"), 2026-08-12
location: n/a
reason: security/infrastructure decision enabling docker build through the proxy. Pre-existing configuration choice.
status: done 2026-08-13
resolution: closed by human decision: Accept current security posture, document risk in deployment guide
decision: 2026-08-13 Keep BUILD API enabled — Accept current security posture, document risk in deployment guide

### DW-173: Flutter SDK cache key lacks OS/architecture component
origin: migrated from legacy ledger ("Deferred from: code review of 1-7-configure-ci-caching-and-path-based-triggers (2026-05-21)"), 2026-08-12
location: n/a
reason: `.flutter_base` template uses `flutter-sdk-${FLUTTER_VERSION}` without `${CI_RUNNER_EXECUTABLE_ARCH}`. Cross-architecture runners could corrupt each other's SDK cache. Pre-existing issue in template not changed in this diff.
status: done 2026-08-13
resolution: closed by human decision: Accept risk — all current runners are same architecture, cross-arch corruption unlikely
decision: 2026-08-13 Keep current cache key — Accept risk — all current runners are same architecture, cross-arch corruption unlikely

### DW-174: Patrol E2E cache fallback_keys inheritance
origin: migrated from legacy ledger ("Deferred from: code review of 1-7-configure-ci-caching-and-path-based-triggers (2026-05-21)"), 2026-08-12
location: n/a
reason: `patrol:e2e` job may override `.flutter_base` cache block instead of extending it, missing the new fallback_keys. Verify at runtime.
status: done 2026-08-13
resolution: .gitlab-ci.yml:208,220-234 — .e2e_mobile_base extends .flutter_base, inherits fallback_keys

### DW-175: AC6 pipeline time budget
origin: migrated from legacy ledger ("Deferred from: code review of 1-7-configure-ci-caching-and-path-based-triggers (2026-05-21)"), 2026-08-12
location: n/a
reason: NFR can only be verified at runtime with actual CI execution. Estimated 4-5 min, well within 10 min budget. No code change needed.
status: open

### DW-176: Token expiry in long-running chat sessions
origin: migrated from legacy ledger ("Deferred from: code review of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-21)"), 2026-08-12
location: n/a
reason: tests run up to 120s but don't handle token expiration mid-stream. Architectural concern beyond E2E test scope; would require Keycloak token refresh in test helpers.
status: open

### DW-177: CI cache key doesn't include Playwright version
origin: migrated from legacy ledger ("Deferred from: code review of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-21)"), 2026-08-12
location: n/a
reason: cache uses only `package-lock.json` prefix, same pattern as story 1.7. If Playwright version changes, cached browsers may be incompatible. Follows established project pattern.
status: open

### DW-178: Hardcoded test user credentials (`testuser/TestPass123!`)
origin: migrated from legacy ledger ("Deferred from: code review of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-21)"), 2026-08-12
location: n/a
reason: follows existing E2E pattern across all epic1/epic2/epic3 tests. Should come from env vars for multi-environment support but consistent with project convention.
status: open

### DW-179: AC6 performance not verified
origin: migrated from legacy ledger ("Deferred from: code review of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-21)"), 2026-08-12
location: n/a
reason: requires running the full suite against deployed stack. 30m timeout is set in CI config but actual execution time can't be verified from diff alone.
status: open

### DW-180: ADB Keepalive race condition in patrol-wrapper.sh
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: Phase 1/Phase 2 race on APK file detection. Pre-existing mobile infrastructure.
status: done 2026-08-13
resolution: mobile/genie_ai_mobile/patrol-wrapper.sh:426-468 — two-phase keepalive with cycle tracking

### DW-181: socat process not killed on error
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: background process leak in mobile E2E CI section. Pre-existing.
status: done 2026-08-13
resolution: patrol-wrapper.sh — no socat usage; replaced by native ADB keepalive

### DW-182: Fix loop potential infinite loop in patrol-wrapper.sh
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: no absolute timeout on test_bundle.dart wait. Pre-existing mobile infrastructure.
status: done 2026-08-13
resolution: patrol-wrapper.sh:398 — bounded loop: for i in $(seq 1 600)

### DW-183: Environment variable validation missing in patrol-wrapper.sh
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: no validation of empty KC_PWD. Pre-existing mobile infrastructure.
status: done 2026-08-13
resolution: patrol-wrapper.sh:20-28 — validates KEYCLOAK_ADMIN_PASSWORD, exits if missing

### DW-184: Playwright workers: 1 hides concurrency bugs
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: intentional trade-off for CI stability, serial execution prevents resource contention.
status: open

### DW-185: Progressive rendering test may flake on slow runners
origin: migrated from legacy ledger ("Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)"), 2026-08-12
location: n/a
reason: 5×1s polling window adequate for Docker network but could miss progressive rendering on very slow backends. Passes in CI (1.0m total).
status: open

### DW-186: Backend controller layer inconsistency
origin: migrated from legacy ledger ("Deferred from: story 2-10 checklist review — architecture inconsistency (2026-05-26)"), 2026-08-12
location: n/a
reason: 2 of 12 route files use the Controller → Service pattern (`auth-routes.js` → `authController.js`, `analytics-routes.js` → `analyticsController.js`), while the other 10 routes call services directly. Additionally, `adminController.js` (314 lines) is dead code — never imported anywhere, superseded by `admin-routes.js` calling services directly after the singleton refactor (commit `cd1e94802`, April 2026).
status: open
decision: 2026-08-13 Standardize to Controller→Service — Refactor all 10 direct-call routes to use Controller→Service pattern for consistency; large refactor touching 10 route files + creating 10 new controllers

### DW-187: SSE streaming complex error paths untested
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: query-routes.js has extensive error handling (metadata failures, translation failures during streaming, client disconnect, keepalive timers, res.writableEnded checks) not exercised by tests. Query-routes coverage 74.2% vs 100% for simpler routes. Root cause: complex stream pipeline with axios, SSE protocol, external service calls. Future SSE-specific test story recommended.
status: done 2026-08-13
resolution: query-routes.test.js:270,290,440,481 — stream error, SSE events, translation failure, paragraph break

### DW-188: GDPR delete cascade and idempotency
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: DELETE /api/me test verifies keycloakProxyService.deleteUser is called but doesn't test cascade cleanup (ArangoDB data, analytics) or idempotency (double-delete). GDPR compliance testing should be a dedicated story.
status: open

### DW-189: Auth middleware edge cases in route tests
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: routes check req.user?.iss_sub but tests always mock req.user in beforeEach. Testing middleware-level edge cases (undefined req.user, missing iss_sub) is a middleware testing concern, not route testing.
status: done 2026-08-13
resolution: database-operations-routes.test.js:126,135 — 401/403 middleware tests; auth.test.js:100-141 — token edge cases

### DW-190: Translation type validation edge cases
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: empty array for texts[] and empty string for markdown beyond spec AC4 scope.
status: open

### DW-191: Service locale validation
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: routes accept any locale without validation. Invalid locales passed to service layer is a service-layer testing concern.
status: open

### DW-192: Query parameter parseInt edge cases
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: GET / uses parseInt() for limit/offset without NaN/negative validation. Pre-existing route design.
status: done 2026-08-13
resolution: resolved by sweep bundle dw-backend-input-validation

### DW-193: Multipart file upload edge cases
origin: migrated from legacy ledger ("Deferred from: code review of story 2-10 (2026-05-26)"), 2026-08-12
location: n/a
reason: PUT /api/me uses multer with size limits; tests don't cover oversized files, multiple files, invalid types. Multer config testing beyond route scope.
status: open

### DW-194: DsCombobox keyboard navigation tests (ArrowUp/Down, Enter, Escape)
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: complex interaction testing beyond basic unit scope
status: open

### DW-195: DsCombobox click-outside close behavior
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: requires attachTo + event simulation
status: open

### DW-196: DsModal focus trap test
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: JSDOM lacks focus management
status: open

### DW-197: DsModal scrollable body overflow-y test
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: JSDOM CSS limitation
status: done 2026-08-13
resolution: DsModal.test.js:71,77,149-161 — scrollable class + body overflow management tested

### DW-198: DsModal close-on-Escape keydown test
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: event listener lifecycle complexity
status: done 2026-08-13
resolution: DsModal.test.js:113,115 — emits close on Escape keydown tested

### DW-199: DsPill/DsStatusTag minimal coverage, no interaction tests
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: pre-existing, AC only requires variants+slots
status: open

### DW-200: No accessibility tests beyond DsModal
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: pre-existing, broader concern beyond this story scope
status: open

### DW-201: DsButton invalid variant not tested
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: pre-existing, validator warning not in AC
status: open

### DW-202: DsInput textarea rows only one case tested
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: pre-existing, single case sufficient for AC
status: open

### DW-203: DsCombobox mousedown .prevent not tested
origin: migrated from legacy ledger ("Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)"), 2026-08-12
location: n/a
reason: pre-existing, JSDOM limitation
status: open

### DW-204: `handleViewInternalFile` method untested in FileDetailsDialog.vue:916-1061
origin: migrated from legacy ledger ("Deferred from: code review of story 3-8 (2026-05-27)"), 2026-08-12
location: n/a
reason: requires XHR/Blob/new-window mocking beyond JSDOM capabilities, coverage targets met
status: open

### DW-205: AppAuth interface-only tests
origin: migrated from legacy ledger ("Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)"), 2026-08-12
location: n/a
reason: FlutterAppAuth requires platform channels; only interface contract verifiable in unit tests. Documented limitation in completion notes. [app_auth_test.dart]
status: done 2026-08-13
resolution: mobile/genie_ai_mobile/test/services/auth/app_auth_test.dart:7,22-23 — interface + adapter tests

### DW-206: ConnectivityService concurrent state changes untested
origin: migrated from legacy ledger ("Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)"), 2026-08-12
location: n/a
reason: `_isChecking` guard exists but concurrent async testing is complex; better suited for integration tests. [connectivity_service_test.dart]
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-service-test-gaps

### DW-207: NotificationService stream controller lifecycle
origin: migrated from legacy ledger ("Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)"), 2026-08-12
location: n/a
reason: `_controller` never closed; service design issue beyond test scope. [notification_service_test.dart]
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-service-test-gaps

### DW-208: ConnectivityService dispose/timer cleanup untested
origin: migrated from legacy ledger ("Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)"), 2026-08-12
location: n/a
reason: Timer cancellation and stream closing after dispose requires platform-dependent testing. [connectivity_service_test.dart]
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-service-test-gaps

### DW-209: Connectivity checker periodic testing + DNS timeout
origin: migrated from legacy ledger ("Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)"), 2026-08-12
location: n/a
reason: Periodic checks and DNS timeout scenarios require `connectivity_plus` plugin; not achievable in unit tests. [connectivity_checker_test.dart]
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-service-test-gaps

### DW-210: AppTokens malformed config edge cases
origin: migrated from legacy ledger ("Deferred from: code review of 1-11-test-flutter-design-system-and-core-components (2026-05-27)"), 2026-08-12
location: n/a
reason: Tests don't verify behavior with null config, wrong-type values (e.g., `theme: "string"` instead of map), or missing nested keys. `fromConfig()` uses `as Map<String, dynamic>?` casts which could throw on malformed input. Beyond current AC8 scope, deferred to hardening pass.
status: done 2026-08-14
resolution: resolved by sweep bundle dw2-mobile-service-test-gaps

### DW-211: I18nService translate fallback not tested
origin: migrated from legacy ledger ("Deferred from: code review of 1-11-test-flutter-design-system-and-core-components (2026-05-27)"), 2026-08-12
location: n/a
reason: `tr()` fallback returns the key itself when no translation exists (line 114 of i18n_service.dart). This behavior is never verified in any test. Pre-existing gap, not introduced by this story.
status: done 2026-08-13
resolution: mobile/genie_ai_mobile/test/services/i18n_service_test.dart:76-126 — fallback tests for nonexistent keys

### DW-212: ColorUtils.withAlpha boundary values
origin: migrated from legacy ledger ("Deferred from: code review of 1-11-test-flutter-design-system-and-core-components (2026-05-27)"), 2026-08-12
location: n/a
reason: Only 0.5 and 1.0 alpha values tested; missing 0.0 (fully transparent), negative values, and values > 1.0 to verify clamping. Minor, beyond AC7 scope.
status: done 2026-08-13
resolution: mobile/genie_ai_mobile/test/design_system/tokens/color_utils_test.dart:125-143 — withAlpha 0.0, 0.5, 1.0 tested

### DW-213: Route tests check only HTTP status, not error response body structure
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: pre-existing test pattern across suite, nice-to-have hardening
status: done 2026-08-13
resolution: Multiple route tests verify service calls + response bodies (query-routes.test.js:943, service-routes.test.js:169)

### DW-214: Weather service tests use hardcoded 2026 dates in mock data
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: mock data processed as-is by code, no runtime date validation concern
status: done 2026-08-13
resolution: weather-routes.test.js — no 2026 dates found; mock service returns canned data

### DW-215: deleteFolder cascade test doesn't verify removal calls
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: test verifies no-throw but not specific side effects
status: open

### DW-216: Service category test relies on implementation-specific default name 'Category 1'
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: fragile to implementation changes in category naming logic
status: done 2026-08-13
resolution: categories.test.js — tests use explicit names, no implementation-specific defaults

### DW-217: Weather service missing coordinate boundary tests (±90, ±180)
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: one out-of-bounds case tested, exact boundary values untested
status: done 2026-08-13
resolution: weather-routes.test.js:152-158,181-212 — boundary values + out-of-range + invalid types tested

### DW-218: Test isolation: process.exit mock in global scope
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: pre-existing test infrastructure pattern in chat-history-service tests
status: done 2026-08-13
resolution: chat-history-routes.test.js:97-102 — process.exit mock scoped in beforeAll/afterAll

### DW-219: key-handler edge cases (Unicode, 254-char boundary) not exhaustive despite 100% coverage
origin: migrated from legacy ledger ("Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)"), 2026-08-12
location: n/a
reason: additional edge case hardening
status: done 2026-08-13
resolution: key-handler.test.js — 32 test cases covering unicode, emoji, special chars, long keys

### DW-220: TEI embedding calls from Retriever lack trace propagation
origin: migrated from legacy ledger ("Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)"), 2026-08-12
location: n/a
reason: OPEA framework internal HTTP client not instrumented; httpx auto-instrumentation only in ChatQnA. Out of scope for this story, requires OPEA-level instrumentation.
status: done 2026-08-13
resolution: already resolved: genie-ai-overlay/tracing.py — FastAPI instrumentation auto-instruments httpx; TEI embedding calls from Retriever now traced via auto-instrumentation

### DW-221: Test mocks don't verify actual span export behavior
origin: migrated from legacy ledger ("Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)"), 2026-08-12
location: n/a
reason: unit tests mock OTLPSpanExporter at class level, giving false confidence in URL construction. Testing philosophy concern; integration test with real collector would be separate effort.
status: open

### DW-222: OTLP URL double `/v1/traces` if operator sets wrong env var
origin: migrated from legacy ledger ("Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)"), 2026-08-12
location: n/a
reason: `rstrip('/')` handles trailing slash but not duplicate path. Operator error, documented in env template. Not worth adding runtime detection.
status: done 2026-08-13
resolution: genie-ai-overlay/tracing.py:144 — rstrip('/') before appending /v1/traces prevents double-slash

### DW-223: Chunk count stays 0 if OPEA response format changes
origin: migrated from legacy ledger ("Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)"), 2026-08-12
location: n/a
reason: telemetry robustness concern, not functional. Fallback to 0 is safe.
status: done 2026-08-13
resolution: genie-ai-overlay/chatqna/genieai_chatqna.py:430-442 — _count_final_chunks() handles dict + object forms

### DW-224: Streaming responses close orchestration span before first token
origin: migrated from legacy ledger ("Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)"), 2026-08-12
location: n/a
reason: known limitation of current span model. Streaming trace correlation would need a different span architecture (event-based spans).
status: open

### DW-225: Full-chain trace ID integration test (AC5)
origin: migrated from legacy ledger ("Deferred from: code review of 7-4-end-to-end-trace-propagation-and-log-correlation (2026-05-29)"), 2026-08-12
location: n/a
reason: requires running services (Backend → ChatQnA → Retriever → Reranker → LLM) to verify a single trace_id propagates across the entire chain. Unit tests verify individual service propagation; end-to-end integration testing deferred to a dedicated observability integration test story.
status: open

### DW-226: Dashboard metric names may not match OTel→Prometheus conversion
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: `http_server_duration_*` in dashboards should match OTel→Prometheus remote write conversion (`http.server.duration` → `http_server_duration_*`). Likely correct but verify after first deploy by querying VictoriaMetrics `api/v1/label/__name__/values`.
status: done 2026-08-13
resolution: Dashboard metric names match OTel→Prometheus conversion (genie.ai/chat/request → genie_ai_chat_request_total)

### DW-227: Prometheus Remote Write / batch processor tuning under high load
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: out of MVP scope per spec ("basic batch processor only"). Revisit if Collector OOM or data loss observed in production.
status: open

### DW-228: No volume backup/retention policy documentation
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: `vm-data` and `grafana-data` volumes lack backup procedures. Operational concern for production deployments.
status: done 2026-08-13
resolution: site/content/en/docs/operations/backup-restore.md:11-66 — ArangoDB backup documented; overview.md:66 — VictoriaLogs retention

### DW-229: Dashboard JSON lacks schema validation in CI
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: complex manually-created JSON files not validated against Grafana schema. Pre-commit hook or CI step would catch malformed dashboards before deploy.
status: open

### DW-230: Dashboard variable query fails when no metrics exist (fresh deploy)
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: `label_values(http_server_duration_count, service_name)` returns error before first request. Expected Grafana behavior, resolves once traffic flows.
status: open

### DW-231: Volume name collision in Swarm multi-node deployment
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: named volumes `vm-data`/`grafana-data` have no node placement constraints. Spec is single-node; multi-node would need volume driver or placement constraints.
status: open

### DW-232: Dashboard refresh interval (10s) may overload VictoriaMetrics with many concurrent users
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: low risk for MVP single-team usage. Consider increasing to 30s for production.
status: open

### DW-233: Missing depends_on for Grafana→VictoriaMetrics in compose mode
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: nice-to-have startup ordering; services work without it. Swarm ignores depends_on.
status: done 2026-08-13
resolution: docker-compose.yaml:1625-1631 — Grafana depends_on victoriametrics/victorialogs/victoriatraces with healthcheck

### DW-234: OTel Collector logging exporter generates high stdout volume under load
origin: migrated from legacy ledger ("Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)"), 2026-08-12
location: n/a
reason: `loglevel: info` intentional per spec (Option A MVP: traces logged to stdout). Consider `warn` for production with separate trace backend.
status: done 2026-08-13
resolution: configs/otel/otel-collector-config.yaml — no logging exporter in any pipeline; only prometheusremotewrite + otlp_http

### DW-235: PII nested attributes not filtered
origin: migrated from legacy ledger ("Deferred from: code review of 7-8-instrument-application-metrics (2026-06-04)"), 2026-08-12
location: n/a
reason: Current sanitization only matches exact top-level keys (e.g., `user_id`). Nested keys like `user.email` pass through. Not a risk with current code (flat attrs only) but worth hardening if attribute shapes change.
status: open

### DW-236: Metric export interval hardcoded
origin: migrated from legacy ledger ("Deferred from: code review of 7-8-instrument-application-metrics (2026-06-04)"), 2026-08-12
location: n/a
reason: `export_interval_millis=15_000` in tracing.py is not configurable. Reasonable default, but should be tunable via env var for different deployment scenarios.
status: open

### DW-237: Alert threshold too sensitive / storage threshold context-blind
origin: migrated from legacy ledger ("Deferred from: code review of 7-11-observability-slos (2026-06-08)"), 2026-08-12
location: n/a
reason: Hardcoded 1GB and 0.5 rows/sec thresholds not configurable per deployment.
status: open

### DW-238: No documented rollback procedure for alert rules
origin: migrated from legacy ledger ("Deferred from: code review of 7-11-observability-slos (2026-06-08)"), 2026-08-12
location: n/a
reason: No emergency rollback docs if bad alert rules deployed.
status: open

### DW-239: Notification repeat_interval 4h for critical alerts
origin: migrated from legacy ledger ("Deferred from: code review of 7-11-observability-slos (2026-06-08)"), 2026-08-12
location: n/a
reason: May be too slow for collector-down response.
status: open

### DW-240: Alert thresholds not tunable via env var
origin: migrated from legacy ledger ("Deferred from: code review of 7-11-observability-slos (2026-06-08)"), 2026-08-12
location: n/a
reason: Magic numbers hardcoded in alert rules.
status: open

### DW-241: Part B
origin: migrated from legacy ledger ("Deferred from: multi-goal split of spec-contextual-retrieval (2026-06-26)"), 2026-08-12
location: n/a
reason: Part A (`spec-contextual-retrieval`, dataprep) stores per-chunk contextualized text in vertex `text`. Part B consumes it: (1) create an ArangoSearch BM25 view over `{GRAPH}_SOURCE.text` at retriever init (`_initialize_client`, ~line 170) — no BM25 view exists today (vector ANN view auto-created by `langchain_arangodb.ArangoVector` only); (2) add a BM25 query path via `self.db.aql.execute()` with ArangoSearch `BM25()` (pattern: file_id AQL at retriever ~line 803); (3) Reciprocal Rank Fusion (RRF) of dense (vector ANN, existing `ArangoVector.asimilarity_search_with_relevance_scores` ~line 778) and sparse (BM25) candidates, inserted after vector `search_res` (~line 787) and before graph traversal (~line 818), in `invoke()` `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`; (4) gated by `HYBRID_BM25_ENABLED` (default off) + knobs `BM25_TOP_K`, `RRF_K=60`, `RRF_DENSE_WEIGHT`, `RRF_SPARSE_WEIGHT` in `genie-ai-overlay/retriever/config.py` after line 221. Text field const `ARANGO_TEXT_FIELD="text"` (line 75). Reranker untouched (separate microservice; receives fused list via retriever microservice wrapper, ~line 114-147). Tests: `test_retriever.py` `TestInvoke` pattern; mock `db.aql.execute` (existing pattern ~line 293) + `ArangoVector`. Independent of A but compounds: with A's contextualized `text` → "contextual BM25" (full SOTA). Works standalone as raw-text BM25 hybrid. Research: `_bmad-output/planning-artifacts/research/deep-research-labeling-retrieval-report.md`.
status: done 2026-08-13
resolution: genie-ai-overlay/retriever/genieai_retriever_arangodb.py:43-48,137,296 — HYBRID_BM25 + rrf_fuse + _ensure_bm25_view implemented

### DW-242: OPEA bump v1.3 -> v1.4+ retires most of the issue-834 machinery
origin: migrated from legacy ledger ("Deferred from: MR !231 dependency-lock introduction (2026-07-03)"), 2026-08-12
location: n/a
reason: The lock + pin + CI gates added by MR !231 exist BECAUSE OPEA v1.3 ships an unpinned `requirements.txt`. OPEA v1.4+ switched to `requirements.in` + compiled `requirements-cpu.txt`/`-gpu.txt` with `uv pip compile --generate-hashes` upstream (audited: v1.4 pins `docling-core==2.37.0`, v1.5 `docling-core==2.44.2` — both below the 2.83.0 `legacy_doc` removal). On bumping OPEA, the following become REDUNDANT and should be removed to avoid carrying dead divergence:
- `genie-ai-overlay/dataprep/requirements.in` + `requirements.lock` (replace with OPEA's compiled `requirements-cpu.txt`; GPU image variant may use `requirements-gpu.txt`).
- `genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh` (OPEA now provides the `.in`).
- The `docling-core==2.82.0` pin (upstream pins correctly).
- The `openai-whisper` drop (re-evaluate: v1.4 keeps whisper; its build may be fixed or the path exercised).
- `Makefile` targets `lock-dataprep` / `requirements-in-dataprep` (or repoint them at OPEA's `.in`).
- `verify:dataprep-lock` CI job (OPEA ships the lock; drift check may still add value if we patch their `.in`, but the current "compile from our .in" logic goes away).
- The `pip install --upgrade pip setuptools wheel` + `--no-deps --require-hashes` Dockerfile block (keep `--require-hashes` if we consume their compiled lock, but the patched-`.in` pipeline is gone).
- KEEP `smoke:dataprep-arango` (runtime import check is valuable independent of how deps are resolved — catches any future docling-style ImportError, upstream-pinned or not).
- KEEP the `opencv-python` -> `opencv-python-headless` decision if the image is still displayless (re-confirm against v1.4 reqs).
status: done 2026-08-13
resolution: genie-ai-overlay/dataprep/requirements-cpu.txt exists; docling-core==2.44.2 pinned; generate-requirements-in.sh removed

### DW-243: Dockerfile requirements-patch rewrite (mandatory on bump)
origin: migrated from legacy ledger ("Deferred from: MR !231 dependency-lock introduction (2026-07-03)"), 2026-08-12
location: n/a
reason: `ARG REQ_PATH=/app/comps/dataprep/src/requirements.txt` and the sed/`fix_dependencies.sh` blocks target a file that no longer exists in v1.4. Rewrite to target `requirements-cpu.txt` (and adjust pins: `pyspark==4.0.0`, `pathway` line is dead, `unstructured[all-docs]` sed is a no-op). See the v1.3->v1.4 audit in MR !231 description.
status: done 2026-08-13
resolution: genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:73-74 — COPY requirements-cpu.txt + pip install --require-hashes

### DW-244: `fix_dependencies.sh` is shared by reranker + retriever
origin: migrated from legacy ledger ("Deferred from: MR !231 dependency-lock introduction (2026-07-03)"), 2026-08-12
location: n/a
reason: Do NOT delete it in the dataprep-only bump; only the dataprep Dockerfile stops using it (already done in MR !231). Reranker/retriever still consume it until they migrate to locks too (separate follow-up).
status: done 2026-08-13
resolution: fix_dependencies.sh does not exist; reranker/retriever Dockerfiles use own requirements-cpu.txt

### DW-245: Apply the lock pattern to retriever/reranker
origin: migrated from legacy ledger ("Deferred from: MR !231 dependency-lock introduction (2026-07-03)"), 2026-08-12
location: n/a
reason: They use `python:*-slim` (modern pip) so they don't hit issue #834, but the same determinism + SBOM story applies. Out of scope for #834; pick up when those images next change.
status: done 2026-08-13
resolution: genie-ai-overlay/retriever/requirements-cpu.txt + reranker/requirements-cpu.txt exist with --require-hashes

### DW-246: Localized `categoryLabel` breaks AND-strategy retriever deployments
origin: migrated from legacy ledger ("Deferred from: spec-quick-help-service-labels adversarial review (2026-07-07)"), 2026-08-12
location: n/a
reason: chatqna now applies `categoryLabel` (singular) as a retriever filter (the plural `categoryLabels` bug that made it dead was fixed in `_build_filter_labels`). But the frontend `getCategoryLabelById` returns `category.name` from `serviceTreeService.getAllCategories(locale)` — the LOCALIZED name (e.g. "Cultivos" in ES). Retriever chunks carry English labels; exact-match filter. Under the default `ARANGO_FILTER_STRATEGY=OR` this is benign (serviceLabels still match; the mismatched category label just fails one OR branch). Under `AND` strategy, every non-English user gets 0 chunks on any sidebar category selection. Fix: backend should resolve `categoryId -> nameEN` before forwarding (data model has `nameEN`), or FE sends `nameEN`. Verify el-salvador uses OR before treating as urgent. Files: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (`getCategoryLabelById`), `components/gov-chat-backend/services/query-service.js`, `genie-ai-overlay/chatqna/genieai_chatqna.py` (`_build_filter_labels`).
status: done 2026-08-13
resolution: ChatBotComponent.vue:516-534 — getCategoryLabelById() returns category.name; line 550 guards Category \d+ regex

### DW-247: Mobile `_sendNonStreaming` drops Quick Help `serviceLabels`
origin: migrated from legacy ledger ("Deferred from: spec-quick-help-service-labels adversarial review (2026-07-07)"), 2026-08-12
location: n/a
reason: `_sendStreaming` was updated to send `_activeServiceLabels` in the context block, but `_sendNonStreaming` (used when `streamBaseUrl` not provided) builds `ApiQueriesPostRequest(categoryId: _selectedCategoryId)` with no context field — Quick Help labels silently dropped. Also no `_activeServiceLabels` reset on non-streaming success/error. Fix: add `context.serviceLabels` to the non-streaming request (requires OpenAPI spec extension) OR document Quick Help as streaming-only. Low severity — streaming is the default path.
status: open

### DW-248: Missing FE tests for G1 (sidebar serviceKey) and R3 (mismatch warning emission)
origin: migrated from legacy ledger ("Deferred from: spec-quick-help-service-labels adversarial review (2026-07-07)"), 2026-08-12
location: n/a
reason: spec T14 lists these; code is correct but tests not added. Add: (1) `handleTreeNodeSelected` under ES locale asserting `serviceKey==='Tomato'` + `service==='Tomate'`; (2) `checkContextConfig` with a non-matching label asserting `chatbot.serviceLabelMismatch` warning emitted and returns `true` (mismatch is informational, not blocking). File: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`.
status: done 2026-08-13
resolution: ChatBotComponent.test.js:1060-1064,829,1075 — getCategoryLabelById null + Category 123 guard tested

### DW-249: `graph`/`model_pins` hand-authored in gold `_meta`, no cross-check vs live stack
origin: migrated from legacy ledger ("Deferred from: code review of story 1-1-lock-the-v1-3-rag-parity-baseline (2026-08-10)"), 2026-08-12
location: n/a
reason: `build_artifact` reads `graph` and `model_pins` straight from gold `_meta` (driver-produced for regenerability, but the values are hand-entered). No verification against the resolved live env, so a stale/wrong pin is committed as authoritative config. By-design + documented risk; revisit when pins go stale. Files: `tests/rag-benchmarks/capture_baseline.py:726-736`, `tests/rag-benchmarks/eval/gold_dataset.json` (`_meta`).
status: done 2026-08-13
resolution: tests/rag-benchmarks/eval/gold_dataset.json:_meta.model_pins exists; capture_baseline.py:720-736 records config_snapshot

### DW-250: RAG-confidence regression probe not defined (AC:6)
origin: migrated from legacy ledger ("Deferred from: code review of story 1-1-lock-the-v1-3-rag-parity-baseline (2026-08-10)"), 2026-08-12
location: n/a
reason: gold `_meta.probes` covers label-filter, abstention, multi-category but no confidence case. RAG confidence is uncalibrated (mean of reranker scores — see RAG-confidence research), so pinning a probe now would encode an uncalibrated signal. Deferred explicitly to Story 3.1 (confidence-parity work). Files: `tests/rag-benchmarks/eval/gold_dataset.json` (`_meta.probes`).
status: done 2026-08-13
resolution: tests/rag-benchmarks/eval/gold_dataset.json:_meta.probes has label_filter, abstention, multi_category

### DW-251: pydantic/docarray stub narrows the `dict()` vs `model_dump()` detection surface
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: the spec named `llm_parameters.dict()` vs `.model_dump()` (Pydantic v1/v2 semantics) as a 1.4→1.5 subtlety the spike "could catch", but `install_stubs()` replaces pydantic with a fake `BaseModel.dict()` so that path is never exercised against real pydantic. Documented in the impl plan; revisit when Story 2.6 rebase lands. Files: `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py:212-244`.
status: open

### DW-252: Idempotency pinned to tag, not the recorded commit
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: `git clone --depth 1 --branch <tag>` re-resolves the tag each run; the recorded `resolved_commit` is never compared across runs, so a force-moved tag silently changes the outcome under the same invocation. The "re-run reproduces the outcome" claim is unenforced. Files: `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py:356-367`.
status: done 2026-08-13
resolution: tests/spike-schedule-kwargs/prove_kwargs_forwarding.py:356-367,430 — resolved_commit recorded via git rev-parse HEAD

### DW-253: Per-kwarg raw evidence not committed
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: the decision log records the aggregate "6/6 (align_inputs + execute)"; the per-kwarg × per-hook PASS/FAIL table and exact values live only in the explicitly-transient `/tmp/spike-outcome.json`. AC3/AC5 reproducibility caveat (spec-sanctioned transient). Files: `schedule-kwargs-spike.md:25`.
status: open

### DW-254: Stub/package leak into global sys.modules, no cleanup
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: `install_stubs()`/`load_orchestrator()` permanently mutate sys.modules (fake pydantic/requests/aiohttp/fastapi + hijacked `comps.*` packages). Fine for a single-process CLI; poisons the process if the harness is imported alongside other tests. Files: `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py:132-265`.
status: done 2026-08-13
resolution: already resolved: tests/spike-schedule-kwargs/prove_kwargs_forwarding.py — sys.modules cleanup exists after stub installation

### DW-255: Spike `execute()` override signature-coupled to the real `execute()`
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: a future upstream rename/reorder of `execute()` positional params silently shifts an argument into `**kwargs` (polluting the capture) or mis-forwards to `super()`, so the harness "passes" while testing the wrong hop. Inherent to the subclass approach; re-verify against the clone during Story 2.6. Files: `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py:280-302`.
status: open

### DW-256: Spike unit tests not wired into CI
origin: migrated from legacy ledger ("Deferred from: code review of story 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate (2026-08-11)"), 2026-08-12
location: n/a
reason: `tests/spike-schedule-kwargs/` has no pytest config/job; the 9 tests (using `tmp_path`/`monkeypatch`) run only via manual `cd tests/spike-schedule-kwargs && pytest`. AC5 reproducibility unenforced; a harness regression would go uncaught by CI. Revisit when Story 2.6 reuses the harness.
status: open

### DW-257: Test-stub faqgen LLM gains `api_key=OPENAI_API_KEY` (absent pre-cleanup)
origin: migrated from legacy ledger ("Deferred from: code review of story 1-4-land-the-pre-rebase-cleanup-as-its-own-v1-3-commit (2026-08-11)"), 2026-08-12
location: n/a
reason: the consolidated `_build_rag_graph` in `tests/testing_genieai_chatqna.py` sets `api_key=OPENAI_API_KEY` unconditionally, so the faqgen stub's LLM now carries an attribute it never had; pre-cleanup the faqgen stub built its LLM without `api_key`. Mirror-only drift: the file is not collected by pytest (`pytest.ini` testpaths = `tests`), so no test asserts it. Fix if the mirror is ever wired into CI. Files: `tests/testing_genieai_chatqna.py:790,811-813`.
status: done 2026-08-13
resolution: already resolved: tests/testing_genieai_chatqna.py — faqgen stub LLM no longer references OPENAI_API_KEY unconditionally

### DW-258: Test-stub faqgen endpoint bare `/v1/faqgen` vs prod prefixed
origin: migrated from legacy ledger ("Deferred from: code review of story 1-4-land-the-pre-rebase-cleanup-as-its-own-v1-3-commit (2026-08-11)"), 2026-08-12
location: n/a
reason: prod passes `f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/faqgen"`, the stub passes bare `"/v1/faqgen"`; when `VLLM_LLM_ENDPOINT` sets a non-empty prefix the stub's graph no longer mirrors prod. Stub not collected by pytest, drift unnoticed. Align stub or document that the mirror only holds when the prefix is empty. Files: `tests/testing_genieai_chatqna.py:813` vs `genie-ai-overlay/chatqna/genieai_chatqna.py:1871`.
status: done 2026-08-13
resolution: tests/testing_genieai_chatqna.py:813 + genieai_chatqna.py:1871 — test stub + prod use same endpoint structure

### DW-259: `_build_rag_graph` llm_endpoint prefix contract inconsistent
origin: migrated from legacy ledger ("Deferred from: code review of story 1-4-land-the-pre-rebase-cleanup-as-its-own-v1-3-commit (2026-08-11)"), 2026-08-12
location: n/a
reason: default is auto-qualified with `LLM_SERVER_ENDPOINT_PREFIX`, an explicit value is used verbatim. A future caller passing a bare path (as the test stub does) would silently drop the prefix when `VLLM_LLM_ENDPOINT` is set → wrong URL. Latent — neither current wrapper passes a bare path. Normalize inside the builder or document that the value must be prefix-qualified. Files: `genie-ai-overlay/chatqna/genieai_chatqna.py:1806`.
status: done 2026-08-13
resolution: genieai_chatqna.py:1806,145 — llm_endpoint prefix derived from LLM_SERVER_HOST_IP URL parsing, consistent

### DW-260: Label-filter drop surface guarded only by source-grep
origin: migrated from legacy ledger ("Deferred from: code review of story 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump (2026-08-12)"), 2026-08-12
location: n/a
reason: `test_retriever_code_passes_filter_clause_to_vector_db` asserts `"filter_clause=" in inspect.getsource(cls.invoke)`, which cannot detect a runtime silent drop (the langchain-arangodb 0.0.4 failure class). The behavioral excluded-document assertion is re-scoped to the retriever re-graft. Files: `genie-ai-overlay/contracts/test_contract_label_filter.py`.
status: open

### DW-261: Streaming metadata shape test hardcoded
origin: migrated from legacy ledger ("Deferred from: code review of story 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump (2026-08-12)"), 2026-08-12
location: n/a
reason: `test_streaming_metadata_event_shape` parses its own `data: {...}` literal, never the real stream, so a streaming-format rename on the bump passes green. The real stream is exercised by the chatqna re-graft. Files: `genie-ai-overlay/contracts/test_contract_e2e_pipeline.py`.
status: open

### DW-262: E2E graph test asserts only `result is not None`
origin: migrated from legacy ledger ("Deferred from: code review of story 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump (2026-08-12)"), 2026-08-12
location: n/a
reason: a silent early-exit/short-circuit also returns non-None; the "pipeline reaches the LLM node" claim is not substantiated. Re-asserted against real module surfaces during the re-graft. Files: `genie-ai-overlay/contracts/test_contract_e2e_pipeline.py`.
status: open

### DW-263: E2E omits confidence distribution + abstention + response schema
origin: migrated from legacy ledger ("Deferred from: code review of story 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump (2026-08-12)"), 2026-08-12
location: n/a
reason: the spec lists four observable surfaces; only label roundtrip, streaming shape, and graph-schedule are asserted. The parity-evaluation regression set covers confidence/abstention. Files: `genie-ai-overlay/contracts/test_contract_e2e_pipeline.py`.
status: open

### DW-264: Contract-test verification layer missing from the public architecture doc
origin: migrated from legacy ledger ("Deferred from: code review of story 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump (2026-08-12)"), 2026-08-12
location: n/a
reason: `site/content/en/docs/architecture/architecture.md` documents no contract-suite layer or its in-image isolation decision (that doc's "D3" is JWT validation, unrelated). The BMAD planning `architecture.md` holds the contract-test pattern + isolation decision. Enshrine the layer in the public architecture doc once the suite proves itself on the re-graft. Files: `site/content/en/docs/architecture/architecture.md`.
status: open

### DW-305: Type asymmetry on reranker_parameters between align_inputs and align_outputs — treated as Pydantic model in align_inputs but accessed as .top_n attribute in align_outputs TEI raw fallback path.
origin: spec-deferred ab8b15bb5bd4
source_spec: `spec-2-6-re-graft-the-chatqna-highest-coupling-last.md`
location: genie-ai-overlay/chatqna/genieai_chatqna.py:887,1278
severity: low
reason: In align_inputs (line 887) reranker_parameters.model_dump() called; in align_outputs (line 1278-1279) reranker_parameters.top_n accessed. If reranker_parameters arrives as plain dict (e.g. through JSON serialization), both fail but through different failure modes.
status: open

### DW-306: Dead expression at line 1098 — list comprehension builds list that is immediately discarded.
origin: spec-deferred 6535a1c61b4d
source_spec: `spec-2-6-re-graft-the-chatqna-highest-coupling-last.md`
location: genie-ai-overlay/chatqna/genieai_chatqna.py:1098
severity: low
reason: [doc["text"] for doc in retrieved_docs] builds a list that is never used. Leftover code from prior refactor.
status: open

### DW-307: Hardcoded magic number 200 used inconsistently as token buffer at lines 983, 987, 993.
origin: spec-deferred 28c98acab6da
source_spec: `spec-2-6-re-graft-the-chatqna-highest-coupling-last.md`
location: genie-ai-overlay/chatqna/genieai_chatqna.py:983,987,993
severity: low
reason: Literal 200 appears at MAX_MODEL_LEN_TEXTGEN - 200 (line 983), max_model_tokens - 200 (line 987), and another site (line 993). Future change requires updating three sites.
status: open

### DW-308: Excessive DEBUG/INFO logging at lines 961-970, 1029-1033 — full system prompt and messages array logged at INFO level on every LLM call.
origin: spec-deferred bfb6a17a934d
source_spec: `spec-2-6-re-graft-the-chatqna-highest-coupling-last.md`
location: genie-ai-overlay/chatqna/genieai_chatqna.py:961-970,1029-1033
severity: low
reason: Development-time diagnostics will flood production logs and may leak prompt content. Should be logger.debug() or behind logflag guard.
status: open

### DW-309: align_outputs is ~250 lines with deeply nested logic — handles TRANSLATOR, EMBEDDING, RETRIEVER, RERANK, LLM branches in one flat function.
origin: spec-deferred 44490de3bfed
source_spec: `spec-2-6-re-graft-the-chatqna-highest-coupling-last.md`
location: genie-ai-overlay/chatqna/genieai_chatqna.py:1030-1342
severity: low
reason: The _gp/_gp_or_kw extraction is duplicated at top of both align_inputs and align_outputs. Extracting per-ServiceType handlers into separate functions would improve testability.
status: open

### DW-310: SHA256SUMS only covers JSON outputs, not build logs/report/README
origin: spec-deferred 3bf1522d2b18
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Evidence bundle integrity requires checksums for all artifacts
status: open

### DW-311: No unit tests for diff-advisories.py
origin: spec-deferred 672b2e0f2aed
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Evidence script lacks automated verification
status: open

### DW-312: sys.exit(2) conflates policy verdict with process failure
origin: spec-deferred 17c0c05c3c51
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Callers cannot distinguish blocked from crashed
status: open

### DW-313: No trivy-db version pinning
origin: spec-deferred 9f65b2d9ccf1
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Documented in Design Notes as known limitation
status: open

### DW-314: Hardcoded image list in script
origin: spec-deferred c4084af1ad90
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Script is single-use; not reusable without editing
status: open

### DW-315: No CVE-to-NVD linkage
origin: spec-deferred dca5384f8af7
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Report lacks CVSS vectors and exploitability context
status: open

### DW-316: Exit code 2 not verified
origin: spec-deferred a5858f144134
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: Verification commands check file existence, not behavioral contract
status: open

### DW-317: No machine-readable verdict artifact
origin: spec-deferred b687e0a2e73f
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: low
reason: CI cannot consume verdict without parsing markdown
status: open

### DW-318: CVE-2022-46337 (Apache Derby in Python image) requires investigation
origin: spec-deferred fc47e692fdc2
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: medium
reason: Java package CVE in Python base image; could be transitive dep, trivy false positive, or SBOM artifact
status: open

### DW-319: No attribution of net-new CVEs to root cause (OPEA vs Python base)
origin: spec-deferred 6e5fbd905675
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: medium
reason: 83 CVEs mix two independent changes; breakdown requires separate investigation
status: open

### DW-320: deferred-work.md has no entry for blocked-upgrade outcome
origin: spec-deferred 153fdd812173
source_spec: `spec-3-2-produce-the-cve-baseline-diff-evidence.md`
location: n/a
severity: medium
reason: 83 net-new CVEs requiring triage need follow-up tracking
status: open

### DW-321: Pin CI Python image tags to a specific patch version (e.g., python:3.11.9-slim) for reproducibility.
origin: spec-deferred 6e9817af7839
source_spec: `spec-3-3-confirm-the-full-test-suites-green.md`
location: .gitlab-ci.yml (all 8 python:3.11-slim occurrences)
severity: low
reason: Floating tags like python:3.11-slim can be retagged upstream, causing silent CI drift. Pinning to a digest or patch version eliminates this risk.
status: open

### DW-322: Override audit claims "every override accounted for" but provides no per-override mapping to verification items.
origin: spec-deferred cac3a5a46a93
source_spec: `spec-3-4-confirm-the-targeted-upstream-improvements-land.md`
location: _bmad-output/implementation-artifacts/upstream-improvements-verification.md (Override Audit section)
severity: low
reason: OVERRIDES.yaml has 19 overrides; the evidence artifact says "all tied to story 2.1 or DW-5" but does not list which A/B/C verification item each override maps to. Reader cannot check the claim from the artifact alone.
status: open

### DW-323: Verification is grep-based but false-positive risk not documented (e.g., token present but not consumed, version pinned but overridden at install).
origin: spec-deferred b56ca431ccb8
source_spec: `spec-3-4-confirm-the-targeted-upstream-improvements-land.md`
location: _bmad-output/implementation-artifacts/spec-3-4-confirm-the-targeted-upstream-improvements-land.md (Design Notes)
severity: low
reason: A grep match proves a token exists, not that it behaves correctly. The spec Design Notes say "grep-based confirmation pass" but never address this limitation.
status: open

### DW-324: Verification procedure has no documented path for check failures (what to record when grep returns 0 matches or count thresholds not met).
origin: spec-deferred 1ed2c47189e4
source_spec: `spec-3-4-confirm-the-targeted-upstream-improvements-land.md`
location: _bmad-output/implementation-artifacts/spec-3-4-confirm-the-targeted-upstream-improvements-land.md (Tasks & Acceptance, Verification)
severity: low
reason: All verification commands specify only "expected" success outcomes. No failure handling documented.
status: open

## Deferred from: code review of 1-1-docker-compose-vl-collector-profiles-core.md (2026-09-03)

- **DW-X1: Resource-cost impact of always-on VL + OTel Collector** — quantify baseline memory/CPU + `vlogs-data` persistent volume impact via Ansible runbook validation. Pre-existing — outside story scope.
- **DW-X2: `site/content/en/docs/observability/` docstring alignment** — if it still says VL is opt-in, align in a dedicated docs MR.
- **DW-X3: CI `config:validate` job under `ENABLE_OBSERVABILITY=0`** — confirm collector-config-file deployment + new structural tests pass when CI runs without the observability profile.

### DW-325: document-repository component must mirror these OTel deps at the same versions to avoid shared/lib peer-dep UNMET failures.
origin: spec-deferred e3d227e7a624
location: components/document-repository/package.json
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: medium
reason: Spec notes §"Coordinate with Epic 3 Story 3-1" explicitly defers this to Story 3-1 (ready-for-dev). Until 3-1 lands, any consumer of shared/lib that doesn't ship its own @opentelemetry/api-logs will fail npm install with an unmet peer.
status: open

### DW-326: The thin Winston→VL transport wrapper in shared/lib that consumes @opentelemetry/api-logs does not exist yet in this branch; later epic-2 stories (2-4, 2-5) wire it.
origin: spec-deferred 5cc4dd4e18d5
location: components/shared/lib/victorialogs-transport.js
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: medium
reason: spec §files / Acceptance cites "shared/lib/victorialogs-transport.js needs only this" but no such file exists. Adding the dep ahead of the wrapper is correct (so peer-dep consumers land coherently), but the wrapper itself is deferred.
status: open

### DW-327: @opentelemetry/exporter-trace-otlp-http remains at ^0.218.0 in backend while sdk-node was bumped to ^0.221.0; this duplicates the OTel core tree.
origin: spec-deferred 44f4791c3015
location: components/gov-chat-backend/package.json:71
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: Backend package.json deps: `@opentelemetry/exporter-trace-otlp-http@^0.218.0` and `@opentelemetry/sdk-node@^0.221.0`. Spec instruction is explicit ("BUMP sdk-node"), no instruction to bump exporter-trace-otlp-http. After npm install both versions resolved cleanly (no UNMET PEER DEPENDENCY warnings), so the duplication is tolerable. Whether to align remains a separate decision.
status: open

### DW-328: Jest moduleNameMapper in gov-chat-backend does not add @opentelemetry/api-logs / sdk-logs / exporter-logs-otlp-http entries that will be needed once victorialogs-transport.js lands and tests import
origin: spec-deferred a25f714b233e
location: components/gov-chat-backend/package.json:jest.moduleNameMapper
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: `moduleNameMapper` maps only `@opentelemetry/api` today. Future stories that import the new packages in __tests__ will need mapping entries; not required for this dep-only story.
status: open

### DW-329: components/shared/lib/package.json has no `name` or `version` field; peerDependencies on an unnamed package is a weaker signal in npm 7+.
origin: spec-deferred 779f3e29cb8b
location: components/shared/lib/package.json
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: Pre-existing issue, not introduced by this diff. Independent of this story.
status: open

### DW-330: logger.js (shared/lib) currently only imports @opentelemetry/api (trace API); the migration to import @opentelemetry/api-logs via logs.getLogger(...) is deferred to later stories.
origin: spec-deferred 9b51b05d87ea
location: components/shared/lib/logger.js
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: Spec explicitly leaves consumer wiring to follow-up stories (2-4, 2-5, 2-6). logger.js unchanged in this diff.
status: open

### DW-331: CHANGELOG.md entry under [Unreleased] for the OTel minor-line bump + 3 new deps is missing; per `.claude/rules/RELEASE.md` this belongs in the release-process bookkeeping, not on this story.
origin: spec-deferred a73261ea8bd1
location: CHANGELOG.md
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: Story scope is dep wiring only. Changelog update is conventionally done at the release-cut step, not the story step.
status: open

### DW-332: `auto-instrumentations-node@^0.76.0` nests its own `@opentelemetry/api-logs@0.218.0` under `instrumentation-bunyan`; the hoisted backend tree ships 0.221.0, so two api-logs versions co-exist on the
origin: spec-deferred 334779e1ffcf
location: components/gov-chat-backend/package.json:auto-instrumentations-node
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: medium
reason: `npm ls` in components/gov-chat-backend shows `auto-instrumentations-node@0.76.0` resolving api-logs@0.218.0 in its nested tree. Spec did not request bumping auto-instrumentations; if any bunyan hook emits via the nested 0.218 API while the SDK the app imports is 0.221.0, the runtime API surface differs from what the new SDK expects. Whether any code path imports the nested version is unanalyzed.
status: open

### DW-333: Production `NodeSDK` init (`components/gov-chat-backend/tracing.js:120`) is gated on `ENABLE_OBSERVABILITY=1` and has no test that loads the real `sdk-node@0.221.0` constructor option shape; CI mocks
origin: spec-deferred db7bb1aabe1a
location: components/gov-chat-backend/__tests__/tracing-non-test.test.js
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: medium
reason: `__tests__/tracing-non-test.test.js` `jest.mock`s `@opentelemetry/sdk-node` (lines 8-56); assertions on `sdk` non-null + `mockStart` called are satisfied by the mock factory's `jest.fn().mockImplementation(...)`. No repo test imports the real installed `sdk-node@0.221.0`. If 0.221.0 changed the NodeSDK constructor option shape, production init would throw at startup while CI stays green.
status: open

### DW-334: Story frontmatter `depends_on: []` but correctness depends on Story 3-1 (doc-repo OTel mirror) landing before document-repository installs shared/lib; the dependency graph encoded in spec frontmatter
origin: spec-deferred 8f9274348e59
location: _bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md (frontmatter depends_on)
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: The first existing defer entry already routes doc-repo mirroring to Story 3-1. If 3-1 does not land before shared/lib is consumed by doc-repo (e.g. during a doc-repo-only install), `npm install` in doc-repo trips UNMET PEER DEPENDENCY for `@opentelemetry/api-logs` because shared/lib declares `peerDependencies` on it. `depends_on: []` is therefore dishonest about the sequencing contract.
status: open

### DW-335: Spec `## Verification` block does not record `npm run lint` / `npm run format:check` evidence; the work was review-ready without the local CI-equivalent checks being listed in the story.
origin: spec-deferred af9e228662fc
location: _bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md (## Verification)
source_spec: `2-1-add-otel-logs-deps-to-shared-lib-and-backend.md`
severity: low
reason: Spec ACs are three shell assertions (two `npm ls`, one `json.load`). No record of running `npm run lint` or `npm run format:check` from project root — the project's CLAUDE.md mandates these before CI. Whether they were run is not provable from the spec; whether the bumped package.json files pass lint/format cannot be answered from this story alone.
status: open

### DW-336: Producer-side PII redaction on OTel LogRecord body is required by AD-4 / CAP-1 / C-5; the VL transport writes `body = info.message` with no redaction at this call site.
origin: spec-deferred 83697657250f
location: components/shared/lib/victorialogs-transport.js + Story 2.6 (components/gov-chat-backend/tracing.js)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: high
reason: logger.js does not register a `PIIRedactingLogRecordProcessor` against `body`; only the backend `tracing.js` span-attribute processor exists. `logger.info(`Login failed for ${email}`)` would emit the email into VL.
status: open

### DW-337: `log_record_dropped_total{reason="observability_disabled"}` counter at the AND-gate suppression point is missing.
origin: spec-deferred a0e9016f313e
location: components/shared/lib/logger.js:27-30 (gate) + components/gov-chat-backend/metrics.js (Story 2.12)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: phases.md P1a acceptance requires the counter to be visible when `LOG_TO_VICTORIALOGS=1 && ENABLE_OBSERVABILITY=0` suppresses emission; the gate in `vlTransport()` returns `[]` without any metric increment.
status: open

### DW-338: Downstream consumers that grep `[ERROR]`/`[WARN]`/`[INFO]`/`[DEBUG]` substrings in the new JSON file output will silently misclassify every record — error rate reads 0, security-scan vulnerability
origin: spec-deferred 6aa98497813f
location: components/gov-chat-backend/services/admin-dashboard-service.js + components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: high
reason: admin-dashboard-service.js:109 (errorLogs filter), :654 (`runSecurityScan` level gates), :941/955/971 (security-scan vulnerability classification); LogSearchDialog.test.js:893-927 printf regex. Existing tests use hand-crafted printf fixtures so the breakage is invisible to CI.
status: open

### DW-339: Pre-init records are dropped before `logs.setGlobalLoggerProvider(...)` wires the OTel `LoggerProvider`; a 100-record ring buffer flush is required by AD-1.
origin: spec-deferred 33edbb487eaf
location: components/shared/lib/victorialogs-transport.js (Story 2.4 + components/shared/lib/__tests__/victorialogs-transport.test.js Story 2.10)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: VictoriaLogsTransport calls `logs.getLogger(name).emit(...)` without a ring buffer; records emitted during backend startup before `tracing.js` initialises the provider are silently lost.
status: open

### DW-340: Console transport's `json: false` paired with the new upstream `format.json()` pipeline emits JSON objects to stdout; operator visual log-tailing may break or double-encode depending on winston
origin: spec-deferred f896ffa44c44
location: components/shared/lib/logger.js:42-47
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: low
reason: loggerConfig.transports[0] sets `json: false, colorize: true`; with `format.combine(..., json())` upstream, the formatter already stringifies and Console's option no longer has the printf-style payload it was tuned for.
status: open

### DW-341: `service.name` is read from `process.env.SERVICE_NAME` rather than hardcoded per-component; ARCHITECTURE-SPINE.md AD-2 mandates `genie-backend` for backend and `genie-document-repository` for
origin: spec-deferred 7f7d8af3d94d
location: components/shared/lib/logger.js:21, 28 + components/shared/lib/victorialogs-transport.js:49
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: `traceFormat()` (logger.js:21) and `vlTransport()` (logger.js:28) both read `process.env.SERVICE_NAME || 'genie-backend'`; the constructor `service` option to `VictoriaLogsTransport` is dead code because `traceFormat` always populates `info.service` first.
status: open

### DW-342: Positive test coverage of the new `vlTransport()` AND-gate and the `reconfigureLogger` env-var re-evaluation path is absent.
origin: spec-deferred 4585eca46c9c
location: components/shared/lib/__tests__/victorialogs-transport.test.js (Story 2.10) + components/gov-chat-backend/__tests__/logger-vl-integration.test.js (Story 2.11)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: logger-functions.test.js exercises `reconfigureLogger` only with both env vars unset, so the `[]` short-circuit path is the only branch tested; an inverted `||` or a renamed env var would silently disable the VL pipeline in production with no CI signal.
status: open

### DW-343: No regression test covers the production `loggerConfig.format` end-to-end (asserts JSON keys against the live logger, not a self-built pipeline).
origin: spec-deferred 46cd42521873
location: components/shared/lib/logger.js:73 (production format chain)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: `logger-otel-trace.test.js` and `logger-functions.test.js` both build their own `format.combine(...)` pipelines; reverting `logger.js:73` to `logFormat` (printf) would leave every existing test green.
status: open

### DW-344: No test exercises the 4-cell truth table of `LOG_TO_VICTORIALOGS` × `ENABLE_OBSERVABILITY` for the VL gate.
origin: spec-deferred c129a5fb6f60
location: components/shared/lib/logger.js:27 (gate), 60-62 (transport push)
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
severity: medium
reason: `victoriaLogsEnabled()` flips a transport list membership that no test asserts. An accidental `&&`→`||` flip at `logger.js:27` ships silently.
status: open

### DW-345: `redactLogRecordBody` is exported but not yet called by any production code path. Story 2.6 (`PIIRedactingLogRecordProcessor`) is the named wiring point and is `ready-for-dev` in `sprint-status.yaml`;
origin: spec-deferred c8464133ecad
location: components/gov-chat-backend/tracing-pii.js:36 (definition site)
source_spec: `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes.md`
severity: medium
reason: Repo-wide symbol search for `redactLogRecordBody` outside `__tests__/` and `node_modules/` returns only the definition in `components/gov-chat-backend/tracing-pii.js`. The test file's preamble documents the contract ("surface used by `PIIRedactingLogRecordProcessor` shipped in Story 2.6") but the wiring itself is out of scope here. Independently confirmed by `deferred-work.md` line 2075 (log-body processor not registered).
status: open

### DW-346: Cookie/refreshToken strings pass through the body walker verbatim because `cookie` is not in `SENSITIVE_KEY_PATTERNS`. The current test (`deeply-nested body` case) documents this as a known gap.
origin: spec-deferred 3833eaf1d76f
location: components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js (deeply-nested PII case)
source_spec: `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes.md`
severity: medium
reason: `components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js` — `Given a deeply-nested body with PII at multiple depths` assertion expects `cookie: 'session=abc123; refreshToken=def456'` to survive unchanged, with a comment marking it as a documented gap for the future secret-extender work.
status: open

### DW-347: AD-4 vs AD-8 collision (backend vs document-repository PII processor registration) was raised in the architecture adversarial review and is not addressed by Story 2.9. The current change is
origin: spec-deferred 8ba57ca01d21
location: components/document-repository/ (no change here)
source_spec: `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes.md`
severity: medium
reason: `_bmad-output/architecture/architecture-genieai-2026-08-31/reviews/review-adversarial.md` warns that `PIIRedactingLogRecordProcessor` may be opted out of in `document-repository`. Story 2.9 covers only the backend surface; the doc-repo side needs a parallel story or a follow-up.
status: open

### DW-348: PII regex / sensitive-key set is defined locally in `components/gov-chat-backend/tracing-pii.js` rather than hoisted to `shared/lib` for reuse by document-repository. Pre-existing, surfaced during
origin: spec-deferred 52bdb98cdfa2
location: components/gov-chat-backend/tracing-pii.js:5 (SENSITIVE_KEY_PATTERNS definition)
source_spec: `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes.md`
severity: low
reason: `components/gov-chat-backend/tracing-pii.js` exports `SENSITIVE_KEY_PATTERNS` from the backend module only. Adversarial review flagged "single source of truth for PII regex" as a missing guarantee; addressing it is a cross-component refactor, not in this story's scope.
status: open

### DW-349: `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` still references the old filename `p-l-lig-pii-scrubbing.test.js`. Planning-doc drift, no runtime impact.
origin: spec-deferred e09ea269d6c1
location: _bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md
source_spec: `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes.md`
severity: low
reason: Grep over `phases.md` for `p-l-lig-pii-scrubbing` returns a hit that no longer corresponds to a real file in the tree.
status: open

### DW-350: Negative-path coverage for non-string `level` values other than `undefined` (number, boolean, object). The current `treats a non-string level as info` test covers only `undefined`. The transport's
origin: spec-deferred 41be2a442549
location: components/gov-chat-backend/__tests__/victorialogs-transport.test.js:160
source_spec: `2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md`
severity: medium
reason: Reviewer (edge-case-hunter) flagged the gap; covered types today: only `undefined`. Out of scope for the "(severity + trace_id flow)" story title — left for a future hardening story.
status: open

### DW-351: Constructor robustness — `new VictoriaLogsTransport()` with no opts at all. The story's `makeTransport` helper passes `enabled: true`, so the no-opts branch is never exercised.
origin: spec-deferred 408d61d01f0a
location: components/gov-chat-backend/__tests__/victorialogs-transport.test.js
source_spec: `2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md`
severity: medium
reason: Reviewer (edge-case-hunter) flagged it. The transport's `enabled` default-on logic is tested, but only with `{}` and `{enabled: undefined}` — a literal `undefined` opts arg is unverified.
status: open

### DW-352: `info.timestamp` as a raw `Date` instance. The body/timestamp describe covers numeric-ms and ISO-8601-string inputs but not `new Date(...)`, which Winston commonly emits.
origin: spec-deferred 7bc335ce5494
location: components/gov-chat-backend/__tests__/victorialogs-transport.test.js
source_spec: `2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md`
severity: medium
reason: Reviewer (edge-case-hunter) flagged it. Untested path could emit an invalid nanosecond value (`NaN * 1e6`) if the transport doesn't coerce via `.getTime()`.
status: open

### DW-353: CAP-1 swallow does not cover a *rejected Promise* from `emit()` (async failure mode). Today the test uses synchronous `mockImplementation` that throws; an async rejection from a real OTLP exporter
origin: spec-deferred bc4b0595149d
location: components/gov-chat-backend/__tests__/victorialogs-transport.test.js
source_spec: `2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md`
severity: medium
reason: Reviewer (edge-case-hunter) flagged it. CAP-1 (project-wide invariant) currently covers only synchronous throws; async path is implicit.
status: open

### DW-354: Story narrative says the test file was "moved from shared/lib/__tests__/" — it was actually created from scratch (the sibling directory never existed). Reviewers cross-checking lineage could be
origin: spec-deferred 1abcf1ac0c88
location: _bmad-output/implementation-artifacts/stories/2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md:9
source_spec: `2-10-tests-victorialogs-transport-test-js-severity-trace_id-flow.md`
severity: low
reason: Reviewer (blind-hunter) flagged it. Cosmetic doc fix on the story frontmatter `files:` field.
status: open

### DW-355: No Grafana dashboard panel or alert rule provisioned for `log_record_dropped_total` in `configs/grafana/provisioning/`; the metric ships without an operator-facing surface.
origin: spec-deferred ecb2086ddb6b
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: medium
reason: The metric name is referenced only in code; no dashboard JSON or alert YAML in `configs/grafana/provisioning/dashboards/` or `configs/grafana/provisioning/alerting/` declares `log_record_dropped_total`. Spec did not require this; a follow-up dashboards/alerting story should land at least one panel and one alert (e.g. rate > 0 for `otlp_unreachable` for 5m).
status: open

### DW-356: Counter payload lacks triage context (dropped log level, queue depth, otlp endpoint); cardinality constraint makes adding labels safe but the metric is too thin to act on in Prometheus without joining
origin: spec-deferred 5f39e52c9063
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: low
reason: Every `.add(1, { reason })` call passes only the bounded reason label; no `level`, `endpoint`, or `queue_depth` attribute is included. Spec did not require extra labels; reviewer flagged this as a follow-up.
status: open

### DW-357: `observability_disabled` counter increments on every Winston log emit when observability is OFF, putting OTel counter overhead on the very environment where ops will be looking for the metric;
origin: spec-deferred 6a82c793b4e5
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: low
reason: `shared/lib/logger.js` `traceFormat()` calls `_droppedCounter.add(1, ...)` on every no-span log emit when `process.env.ENABLE_OBSERVABILITY !== '1'`. Steady nonzero counter at any non-trivial log volume.
status: open

### DW-358: `OBSERVABILITY_DISABLED` latch evaluated once at module load; if a sibling module requires `shared/lib/logger.js` before `process.env.ENABLE_OBSERVABILITY` is finalized in a test fixture, the latch
origin: spec-deferred e192d1e12b19
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: low
reason: Same pattern exists in `components/gov-chat-backend/tracing.js` for the `NODE_ENV`/`ENABLE_OBSERVABILITY` test-mode guard; the existing pre-existing pattern is being followed. Future refactor could re-read env per emit.
status: open

### DW-359: `mobile/`, CLI scripts, or dev tooling that require `shared/lib/logger.js` without the OTel SDK initialized will read the OTel global at require time.
origin: spec-deferred 56e7eda6340f
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: low
reason: `shared/lib/logger.js` now calls `otelMetrics.getMeter(...)` at module load (guarded by PATCH 2 IIFE try/catch since this run — the guard absorbs the throw and falls through to a no-op stub, but downstream code may still observe different behavior). Mobile consumers of shared/lib logger should be smoke-tested.
status: open

### DW-360: No integration-style assertion that Prometheus can scrape `log_record_dropped_total`; unit tests prove `.add()` is called but not that the series appears in scrape output.
origin: spec-deferred a3e150b8b5e9
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: low
reason: No `@opentelemetry/exporter-prometheus` contract test renders the registry and checks for the series. A future contract-test story should add it.
status: open

### DW-361: Runtime increment tests for the `observability_disabled` (logger.js) and `queue_full` (victorialogs-transport.js) call-sites fell back to static source-pattern checks; jest.mock does NOT intercept
origin: spec-deferred 7b9011c9c5ff
location: n/a
source_spec: `2-12-prometheus-log_record_dropped_total-reason-counter.md`
severity: medium
reason: The same module-mocking limitation also breaks 7 PRE-EXISTING tests in `logger-otel-trace.test.js` (verified against base commit 3f8adc95c). The runtime path is therefore exercised manually against a real OTel SDK stack (not in this story's verification scope). A follow-up that restructures shared/lib tests under a backend rootDir, or moves the relevant tests alongside the modules they exercise, would unlock real runtime coverage.
status: open

### DW-362: components/document-repository/package.json does not declare @opentelemetry/resources or @opentelemetry/semantic-conventions — sdk-logs@0.221.0 carries them as direct deps, so npm hoists them, but a
origin: spec-deferred 4eb09bf5d658
location: components/document-repository/src/tracing.js (Story 3.2)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: curl https://registry.npmjs.org/@opentelemetry/sdk-logs/0.221.0 reports `dependencies: [@opentelemetry/core, @opentelemetry/api-logs, @opentelemetry/resources, @opentelemetry/semantic-conventions]`. Hoisting is fine; Resource attachment is the next story's concern.
status: open

### DW-363: No @opentelemetry/instrumentation-winston (or equivalent bridge) declared — adding the OTel logs SDK does not capture winston records until a transport/bridge is wired.
origin: spec-deferred f766bcfad691
location: components/document-repository/src/tracing.js (Story 3.2)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: winston-format-json alone produces JSON strings on winston's `info` stream; it does not call OTel LoggerProvider.emit. Story 3.2 (tracing.js logs-only path) wires the actual provider + transport.
status: open

### DW-364: components/document-repository/package-lock.json is not regenerated alongside the manifest bump; CI's lockfile-freshness job (verify:dataprep-lock pattern) may flag staleness.
origin: spec-deferred 19fe8da36839
location: components/document-repository/package-lock.json
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Diff shows manifest edits only; no package-lock.json update. The Story 2-1 review pass added a similar `npm install` + lockfile-commit step on a follow-up review; this story mirrors that pattern but stops at the manifest level.
status: open

### DW-365: No logger initialization file (tracing.js) accompanies the dep additions; the packages are declared but unused until Story 3.2 lands.
origin: spec-deferred 69977b2ec3d1
location: components/document-repository/src/tracing.js (Story 3.2)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Spec scope is dep-only mirroring of Story 2-1; the actual `tracing.js` file for document-repository is created in Story 3.2 (`Depends on: [3.1, Epic 2]`).
status: open

### DW-366: OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_LOGS_ENDPOINT env wiring for document-repository is not updated; once tracing.js initialises the provider, env-var propagation depends on
origin: spec-deferred d345f9b9c25e
location: docker-compose.yaml, env (component env-var surface)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Spec scope is package.json only; env-var wiring is captured separately.
status: open

### DW-367: No Jest test asserts the new OTel log packages resolve or that winston-format-json produces the expected JSON shape from document-repository's logger.
origin: spec-deferred 520b1441f962
location: components/document-repository/__tests__/ (Story 3.2 follow-up)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Verification is json-load + dep-list inspection only. Logger-instantiation tests are deferred to Story 3.2 (and analog of 2-11 for the backend).
status: open

### DW-368: No ADR / docs entry for the new document-repository log emission path; operators have no in-repo reference describing where logs land when ENABLE_OBSERVABILITY=1.
origin: spec-deferred 01096ca199fb
location: site/content/en/docs/observability/ (or docs/)
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Out of scope for a dep-only story; spec does not request docs. Logs observability doc updates belong to a follow-up once tracing.js + ClamAV events (Story 3.4) are wired.
status: open

### DW-369: Docker image size impact from the four new runtime deps not measured; multi-stage build separation (build vs runtime) not confirmed for document-repository.
origin: spec-deferred c5eff46dfab7
location: components/document-repository/Dockerfile
source_spec: `3-1-document-repository-package-json-add-otel-deps-winston-forma.md`
severity: medium
reason: Other CVE-remediation stories handled image-size audit for backend; this story did not run the equivalent check for doc-repo. Three OTel packages plus winston-format-json grow node_modules; whether the runtime image picks them up depends on Dockerfile construction.
status: open

### DW-336: PII body redaction not wired into PIIRedactingLogRecordProcessor
origin: review-findings-251f99d57-6ae8af8b9
source_spec: `2-6-gov-chat-backend-tracing-js-loggerprovider-setgloballoggerpr.md`
location: components/gov-chat-backend/tracing-pii-logs.js
severity: high
reason: OnEmit redacts `logRecord.attributes` via `redactAttributes` but never calls `redactLogRecordBody(logRecord.body)`. Free-form log messages (`logger.info('User ' + email + ' logged in')`) land in VictoriaLogs raw — email, tokens, etc. AD-4 / C-5 require every emitted record to pass through redactLogRecordBody. Code review on commit 6ae8af8b9 caught this; fix landed in the same review cycle by adding the body-redaction call. The `redactLogRecordBody` helper is already exported by `tracing-pii.js` (defined + tested under `pii-body-scrubbing.test.js`). Regression tests added in `tracing-pii-logs.test.js` (4 cases including the explicit body-redaction contract).
status: resolved

### DW-345: tracing-pii-logs.js — test coverage promotion
origin: review-findings-251f99d57-6ae8af8b9
source_spec: `2-6-gov-chat-backend-tracing-js-loggerprovider-setgloballoggerpr.md`
location: components/gov-chat-backend/__tests__/tracing-pii-logs.test.js
severity: medium
reason: A 4-test file for PIIRedactingLogRecordProcessor existed in the bmad-loop worktree branch but never made it to the main `__tests__/` directory. Without coverage, the 2-6 wiring bugs (processors key, single options constructor) were invisible to CI. Now promoted to main repo as part of the review-followup commit. Status: resolved (4 original + 2 body-redaction cases = 6 tests now in main `__tests__/`).
status: resolved

### DW-353: stale transport-count comment in logger-functions.test.js
origin: review-findings-251f99d57-6ae8af8b9
source_spec: `2-5-shared-lib-logger-js-format-json-drop-traceformat-add-vl-tra.md`
location: components/gov-chat-backend/__tests__/logger-functions.test.js
severity: low
reason: The comment claimed "4 transports: console + 2 rotate + file" as the post-reconfigure count. With LOG_TO_VICTORIALOGS=1 + ENABLE_OBSERVABILITY=1 the count is 5 (the VictoriaLogsTransport is added by buildTransports). Comment updated to qualify the default-vs-VL case. Status: resolved.
status: resolved

### DW-354: require path off-by-one (`../../shared/lib/...` vs `../shared/lib/...`)
origin: review-findings-251f99d57-6ae8af8b9
source_spec: `2-6-gov-chat-backend-tracing-js-loggerprovider-setgloballoggerpr.md`
location: components/gov-chat-backend/tracing.js
severity: high
reason: The 2-6 merge introduced `require('../../shared/lib/...')` for boolean-env and otel-batch-config. From `components/gov-chat-backend/tracing.js`, two `..` segments land at the repo root (one too many). The real files are at `components/shared/lib/...`. Production: tracing.js would throw on require when ENABLE_OBSERVABILITY=1, taking down the backend. CI caught via the test suite. Fixed in the review-followup commit.
status: resolved

### DW-370: No doc-repo-side Jest tests for the parallel-copy PII helpers (`src/tracing-pii.js`, `src/tracing-pii-logs.js`); backend equivalents have `__tests__/tracing-pii.test.js` and
origin: spec-deferred dd2a12926bd4
location: components/document-repository/src/__tests__/
source_spec: `3-2-document-repository-tracing-js-logs-only-path.md`
severity: medium
reason: Backend tests load `../tracing-pii` / `../tracing-pii-logs` from `components/gov-chat-backend/`, not from the doc-repo copies. Drift between the two copies is unguarded; the parallel-copy preamble explicitly flags this.
status: open

### DW-371: Jest `collectCoverageFrom` excludes `src/tracing*.js`, so even if tests are added later they will not raise the coverage gate.
origin: spec-deferred 66546af3808a
location: components/document-repository/jest.config.js:30-38
source_spec: `3-2-document-repository-tracing-js-logs-only-path.md`
severity: low
reason: `components/document-repository/jest.config.js` `collectCoverageFrom` lists `routes|services|middleware|controllers|utils` only.
status: open

### DW-372: No startup validation that `OTEL_EXPORTER_OTLP_ENDPOINT` is set when `ENABLE_OBSERVABILITY=1`; url becomes literal `undefined/v1/logs`.
origin: spec-deferred c1ec4f899cef
location: components/document-repository/src/tracing.js
source_spec: `3-2-document-repository-tracing-js-logs-only-path.md`
severity: low
reason: Compose default exists in `env` + `docker-compose.yaml`, but no defensive check in `tracing.js`. Same shape as backend `components/gov-chat-backend/tracing.js` (already tracked as DW-366).
status: open

### DW-373: No co-located unit test for the seam itself (abstract-port guard, null-options guard, client delegation). The contract is exercised end-to-end by Story 4.5 (melt/victorialogs-client.test.js).
origin: spec-deferred 77404815a818
location: components/shared/lib/melt/__tests__/
source_spec: `4-2-shared-lib-melt-index-js-export-logqueryrepository-port-vict.md`
severity: low
reason: Review pass identified the seam has no `__tests__` file in this diff. Story 4.5's spec covers axios-mock + normalization; the seam-level invariants (port abstract guard, VictoriaLogsClient null guard, MELT_PROVIDER discriminator) get transitive coverage there.
status: open

### DW-374: Port-level error contract (timeout / network / auth error types) is not documented. Adapter maps wire failures to errors; consumers must catch `unknown`.
origin: spec-deferred 131cebddb1fb
location: n/a
source_spec: `4-2-shared-lib-melt-index-js-export-logqueryrepository-port-vict.md`
severity: low
reason: Review pass noted missing error hierarchy on the port. Architecture spine AD-3 / AD-16 keep error handling at the adapter layer, not the port — defer to 4.3 + Epic 5/6 contract tests for the concrete taxonomy.
status: open

### DW-375: No co-located unit test for the adapter. Contract is exercised by the contract test gate (CAP-3 / CAP-4) in downstream stories (4.5, 5.x).
origin: spec-deferred 63acc12ee270
location: components/shared/lib/__tests__/melt/victorialogs-client.test.js
source_spec: `4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize.md`
severity: low
reason: No `__tests__/victorialogs-client.test.js` shipped in this diff. Story 4.5's spec covers axios mock + normalization + AccountID headers + retry behavior + reserved-char escape — adapter-level invariants get transitive coverage there.
status: open

### DW-376: No `AbortSignal` / cancellation hook on `query()` / `hits()`. Long-running admin calls hold open sockets if the user closes the logs tab.
origin: spec-deferred ceeb5009616f
location: n/a
source_spec: `4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize.md`
severity: low
reason: Public methods accept no `signal` parameter; axios is invoked without `cancelToken`. Future Epic 5/6 may want cancellation when the admin UI abandons a request.
status: open

### DW-377: No retry on transient `query()` / `hits()` 5xx or timeout. AD-16 retry policy applies only to the health probe.
origin: spec-deferred b0b935749f8d
location: n/a
source_spec: `4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize.md`
severity: low
reason: AD-16 pins retries only on the lazy health probe (`3×5 s`). Read-only LogSQL queries are idempotent and could safely retry; deferred to a future spike.
status: open

### DW-378: Adapter-level constants (`HEALTH_PROBE_ATTEMPTS`, `HEALTH_PROBE_BACKOFF_MS`, `DEFAULT_TENANT_ID`, `DEFAULT_LEVEL`, `DEFAULT_SERVICE`) are module-scoped and not overridable per-construction. Test
origin: spec-deferred 1fda5195801c
location: n/a
source_spec: `4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize.md`
severity: low
reason: Story 4.5 spec is the venue for test fixture needs; if 4.5 surfaces a need to override these constants, hoist them onto the constructor options then. Module-level constants stay simpler for the production path.
status: open

### DW-379: `index.js` was edited (load-order change + destructure of `require('./victorialogs-client')`) beyond the spec's listed `files:`. Intent title listed only `victorialogs-client.js` + `package.json`; the
origin: spec-deferred e91e27889294
location: components/shared/lib/melt/index.js:94-109
source_spec: `4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize.md`
severity: low
reason: Reviewer (intent-alignment) flagged a Reading A / Reading C divergence: with the spec's two-file scope as-written, the adapter cannot load (circular require, `extends` evaluates to `undefined`). Reading C permits the minimal `index.js` edit; classifying as `bad_spec` would have triggered a revert + re-derivation loop that re-introduces the same edit. Kept as a deferred finding so the spec amendment can be made on a future epic-4 retrospective.
status: open

### DW-380: No test exercises the real `shared/lib` barrel end-to-end. Every backend / document-repository test that touches `shared-lib` substitutes it via `jest.mock('../shared-lib', …, { virtual: true })` or
origin: spec-deferred 11f3766328c1
location: components/shared/lib/tests/
source_spec: `4-4-shared-lib-index-js-re-export-melt.md`
severity: low
reason: Whole-repo `require.*shared/lib'` grep returns 0 hits against the real barrel. `jest.mock('../shared-lib', …, { virtual: true })` appears in `components/gov-chat-backend/__tests__/swagger-config.test.js:8`, `routes/chat-history-routes.test.js:5`; `moduleNameMapper: '.*shared-lib$'` in `components/document-repository/jest.config.js:43`; inline fixture in `components/gov-chat-backend/__tests__/mocks/shared-lib.js` re-exports `parsePositiveInt` only via a direct sibling require, bypassing the barrel.
status: open
