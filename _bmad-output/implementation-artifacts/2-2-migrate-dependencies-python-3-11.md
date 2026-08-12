---
title: 'Migrate dependencies + Python 3.11'
type: 'chore'
created: '2026-08-12'
status: 'done'
baseline_commit: 'f7402eecf'
baseline_revision: 'f7402eecf5a9db4a9791e116b84c6759fdb46085'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      langchain-arangodb drops back to 0.0.6 in the v1.5 lock; the >=1.2.0 filter_clause fix-pin is gone until story 2.3 bumps it.
    evidence: |-
      retriever/requirements.in + lock pin 0.0.6 (verified: 0.0.6 does NOT have 0.0.4's **kwargs filter_clause swallow — filter_clause is a named param; the behavioral label-filter contract test belongs to story 2.3's re-graft).
    location: >-
      genie-ai-overlay/retriever/requirements-cpu.txt
    severity: medium
  - summary: >-
      dataprep .in fork reintroduces pyspark, unstructured[all-docs], graspologic, openai-whisper that the retired v1.3 machinery dropped for image-size/build reasons; in-image size + post-import runtime unverified here.
    evidence: |-
      old generate-requirements-in.sh dropped these (no-space-on-device pyspark; openai-whisper sdist needs pkg_resources); they compile + uv-sync fine locally. CI build jobs DO run docker buildx + pip install --no-deps --require-hashes from the lock, so install/wheel/source-build failures would block the MR — genuinely ungated is image SIZE and post-import runtime behavior (2.5 re-audits).
    location: >-
      genie-ai-overlay/dataprep/requirements.in
    severity: medium
  - summary: >-
      sitecustomize/SSL-patch auto-load in the built embedding/textgen/retriever images is unverified (hardcoded site-packages path asserted manually, not by a CI job).
    evidence: |-
      no in-image `import sitecustomize` check exists; 2-1's .pth installer + the 2.3-2.6 in-image contract runs supersede the hardcoded COPY; the opea/*:1.5 site-packages path was manually verified via image pull.
    location: >-
      genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:11
    severity: medium
  - summary: >-
      no CI job runs the reranker image entry point on the v1.5 bump; local import verified clean, the in-image behavioral gate is story 2.4's contract test.
    evidence: |-
      reranker module imports all v1.5 comps symbols (telemetry, api_protocol, opea_docarray rename, integrations.tei) — only a host port-8000 collision blocked a full clean pass locally; build/scan jobs never run the image.
    location: >-
      genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai:4
    severity: low
  - summary: >-
      verify:dataprep-lock keeps its dataprep-scoped name while looping three modules and checks package NAMES only, not versions — cross-module version drift (e.g. docling) is invisible to it.
    evidence: |-
      dataprep pins docling==2.45.0/docling-core==2.44.2 while retriever resolves docling==2.55.1/docling-core==2.48.4 (matching v1.5's own per-module locks); a coherence/version lint belongs to story 2.7.
    location: >-
      .gitlab-ci.yml
    severity: low
  - summary: >-
      base images use moving tags (python:3.11-slim, opea/*:1.5), so byte-identical digests across time are bounded by base-tag stability; dependency layers are deterministic via the hashed lock.
    evidence: >-
      AC4's "identical digest" holds for immediate clean re-runs but not across a base-tag move; digest-pinning the image set is story 4-2.
    location: >-
      genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:19
    severity: low
  - summary: >-
      GPU locks (requirements-gpu.txt) are not compiled in 2.2 — the fleet is CPU-only (compose grants no GPU to these services); they can be compiled from the same .in when a GPU deployment needs them.
    evidence: >-
      upstream ships both cpu+gpu locks; our compose consumes CPU only; compiling CUDA-torch locks with no consumer is waste. NB: the compiled CPU locks already pin torch==2.13.0 (CUDA-bundled PyPI wheel) in all three modules (dataprep/retriever/reranker, via sentence-transformers) — the "CPU-only" framing means no GPU device, not no CUDA torch; the GPU-lock delta is the torch index + CUDA-specific pins.
    location: >-
      genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:66
    severity: low
  - summary: >-
      .in pin-policy is a fork-plus-selective-pins hybrid; unpinned entries (e.g. retriever's bare docling) can drift on a later `make lock-<module>` regen.
    evidence: >-
      dataprep pins docling==2.45.0 (matches v1.5 dataprep lock) while retriever's bare docling resolved to v1.5's 2.55.1 today; a future regen may resolve newer. Re-fork + re-pin to v1.5's shipped set on the next bump.
    location: >-
      genie-ai-overlay/retriever/requirements.in
    severity: low
  - summary: >-
      Cross-module OTel/haystack/openai version drift: reranker's bare `.in` pins resolve newer (otel 1.44.0, haystack-ai 3.0.0, openai 3.0.0) than dataprep/retriever (otel 1.27.0, haystack-ai 2.3.1), plus a fastapi split (0.116.1 vs 0.118.2).
    evidence: |-
      verified locked versions: openai dataprep==1.81.0 / retriever==1.109.1 / reranker==3.0.0; fastapi dataprep+reranker==0.116.1 / retriever==0.118.2. reranker `.in` ships bare `opentelemetry-*`/`haystack-ai`/`openai` (faithful v1.5 upstream fork — upstream also bare), so the recompile resolves today's newest; dataprep `.in` pins `openai==1.81.0`, retriever `.in` leaves openai bare (resolved via langchain-openai). All services share `genie-ai-overlay/tracing.py`; a coherence/version lint + re-pin belongs to story 2.7 (and reranker re-graft 2.4).
    location: >-
      genie-ai-overlay/reranker/requirements.in
    severity: medium
  - summary: >-
      verify:dataprep-lock trigger paths watch `requirements.*` only, so an OPEA_VERSION bump in a module Dockerfile (the canonical lock-regen trigger) does not run the drift guard.
    evidence: >-
      rules:changes lists genie-ai-overlay/{dataprep,retriever,reranker}/requirements.* and .gitlab-ci.yml; a Dockerfile OPEA_VERSION/apt change that should force a lock check won't. Story 2.7's CI coherence work owns the trigger widening.
    location: >-
      .gitlab-ci.yml
    severity: low
  - summary: >-
      the compiled CPU locks pin torch 2.13.0 (via sentence-transformers) into plain python:3.11-slim CPU images — all three modules, not just reranker; image-size surface unverified.
    evidence: >-
      torch==2.13.0 at dataprep/requirements-cpu.txt:5660, retriever:5503, reranker:3116 (CUDA-bundled PyPI wheel). CI build jobs DO run docker buildx + pip install --no-deps --require-hashes from the lock, so install/wheel/source-build failures would block the MR; genuinely ungated is image SIZE + post-import runtime (2.4/2.5 build-surface territory).
    location: >-
      genie-ai-overlay/reranker/requirements-cpu.txt
    severity: low
  - summary: >-
      components/gov-chat-backend/.gitlab-ci.yml still carries the retired verify:dataprep-lock job against the deleted requirements.lock (root .gitlab-ci.yml is the active config; the backend copy is never included).
    evidence: >-
      components/gov-chat-backend/.gitlab-ci.yml:2290-2337 references requirements.lock, dataprep/scripts/*, make lock-dataprep — all retired by 2.2 — but GitLab reads only the root .gitlab-ci.yml (no include of the backend copy), so it is dead config. The AC3/Verification grep is scoped to genie-ai-overlay/ and misses it. Pre-existing, surfaced by the retirement; a CI-hygiene pass should delete or sync it.
    location: >-
      components/gov-chat-backend/.gitlab-ci.yml:2290
    severity: low
  - summary: >-
      the build-time docarray rename (mv docarray.py -> opea_docarray.py + sed in orchestrator/micro_service) is ungated against OPEA v1.5 source; if v1.5's import patterns drifted, the sed no-ops and the circular-import fix silently stops applying.
    evidence: >-
      dataprep Dockerfile L90-96, retriever/reranker equivalents run mv+sed on the v1.5 clone. A grep assertion (e.g. 'opea_docarray' present in the patched files) would make it a build gate; the sed-pattern drift surface is already scoped to the 2.3-2.6 re-graft in the spec code map. In-image contract runs (2.3-2.6) are the real gate.
    location: >-
      genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai:93
    severity: low
  - summary: >-
      chatqna's comps_base_builder flips to python:3.11-slim while still installing OPEA v1.3 GenAIComps (`-e .`) with no in-image import gate — the v1.3-on-3.11 runtime is verified by nothing in CI for this MR.
    evidence: |-
      build:chatqna-server only pip-installs `-e .` (setuptools backend; never imports app code); genie-ai-overlay/tests/test_chatqna.py runs on the CI host against conftest's mocked comps, not in the 3.11 image. A v1.3-comp or transitive-dep break on 3.11 surfaces only at container start post-promote. The intent mandates the base flip (chatqna OPEA_VERSION stays v1.3 until story 2.6); the in-image gate belongs to 2.6's re-graft surface.
    location: >-
      genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai:17
    severity: medium
  - summary: >-
      verify:dataprep-lock now loops three modules, so its tag-pipeline run (`if: $CI_COMMIT_TAG`) triples the blast radius of a transient PyPI/yank failure on an unrelated tag.
    evidence: |-
      pre-existing pattern (the job already ran on tags for dataprep); `uv pip sync --dry-run` contacts PyPI, so a transient index issue can fail a tag pipeline. Not caused by 2.2's wiring — a CI-coherence concern for story 2.7's drift-guard work.
    location: >-
      .gitlab-ci.yml
    severity: low
  - summary: >-
      retriever/reranker images lack system libraries their own v1.5 locks install (pytesseract->tesseract-ocr, easyocr/pymupdf; reranker pydub->ffmpeg) — a runtime-only gap the build gate cannot see.
    evidence: |-
      retriever/requirements-cpu.txt pins pytesseract==0.3.13 / easyocr==1.7.2 / pymupdf==1.28.2, but Dockerfile-retriever apt installs only build-essential libcairo2 libglib2.0-0 libjemalloc-dev libmariadb-dev curl (no tesseract-ocr / poppler-utils / ffmpeg); reranker lock pins pydub==0.25.1 with no ffmpeg in its apt list. pytesseract shells out to the tesseract binary -> FileNotFoundError if an OCR path is exercised. Upstream v1.5's own apt lists are the reference; whether retriever/reranker actually exercise these deps is decided by the 2.3/2.4 re-grafts. Unverified whether upstream ships the binaries — runtime re-audit.
    location: >-
      genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai:14
    severity: low
  - summary: >-
      dataprep requirements.in openai==1.81.0 pin carries a bare llama_index issue link with no rationale, unlike the v1.5-lock rationale used for every other pin.
    evidence: |-
      genie-ai-overlay/dataprep/requirements.in:65-66 — `# https://github.com/run-llama/llama_index/issues/18823` directly above `openai==1.81.0`; no comment body explains the version choice or the issue's relevance. Doc cleanup; the 2.7 coherence/version lint can re-pin with rationale.
    location: >-
      genie-ai-overlay/dataprep/requirements.in:65
    severity: low
  - summary: >-
      dataprep lock ships BOTH opencv-python==4.11.0.86 and opencv-python-headless==4.11.0.86; with pip install --no-deps --require-hashes both wheels land and overwrite each other's cv2, so the .in "headless swap" comment is aspirational, not protective.
    evidence: |-
      dataprep/requirements-cpu.txt:3058 (opencv-python) + 3067 (opencv-python-headless); the .in comment (lines 7-9) documents the headless intent but a faithful v1.5 fork keeps opencv-python as a transitive dep. cv2 files come from whichever installs last. Genuinely ungated is image content + post-import behavior — dataprep build-surface re-audit (2.5).
    location: >-
      genie-ai-overlay/dataprep/requirements-cpu.txt:3058
    severity: medium
  - summary: >-
      the mocked OPEA unit suite (test:python job) runs on python:3.10 with pyproject test extras, not the 3.11 lock stack the images now ship — a 3.11-only or lock-version-only regression in overlay logic passes the whole suite.
    evidence: |-
      .gitlab-ci.yml test:python uses image python:3.10-slim + pip install -e ".[test]"; conftest stubs comps so the real vendored v1.5 comps and the compiled locks are never imported. A 3.11-removed stdlib path or a lock-pinned dep whose 3.11 behavior differs ships green. Re-baseline the mocked suite to python:3.11 + the lock stack belongs to story 2.8 (mock-reality parity).
    location: >-
      .gitlab-ci.yml:2285
    severity: medium
---

<intent-contract>

## Intent

**Problem:** All six overlay images still build from OPEA v1.3 — retriever/reranker from an unpinned `requirements.txt`, dataprep from a hand-scraped local lock (`requirements.in`/`requirements.lock` + `docling-core==2.82.0` pin), on `python:3.10` bases — so builds are non-deterministic and split across the fleet. v1.5 ships compiled `requirements-cpu/gpu.txt` (docling 2.44.2, langchain 0.3.27) targeting `python:3.11`.

**Approach:** Adopt v1.5's compiled-lock layout fleet-wide: fork each module's `requirements.in` from v1.5, add the GENIE.AI overlay deltas, recompile with `uv pip compile --generate-hashes` for Python 3.11, and consume the hashed locks in the Dockerfiles. Move every image base to Python 3.11, retire the v1.3 lock machinery, retag embedding/textgen wrappers to 1.5-based bases, and keep the build deterministic.

## Boundaries & Constraints

**Always:**
- Fork each module's `requirements.in` from the verified v1.5 `.in` and recompile with `uv pip compile --generate-hashes --python-version 3.11` (v1.5's upstream locks carry NO hashes — verified: `uv pip compile ... --universal` without `--generate-hashes`; per PRD FR-4's assumption, hashes are generated before adoption).
- Dockerfiles install from the committed hashed `requirements-cpu.txt` with `pip install --require-hashes -r <lock>`.
- `OPEA_VERSION` → `v1.5` in the dataprep/retriever/reranker Dockerfiles (the compiled locks pair with v1.5 source); embedding/textgen `ARG UPSTREAM_IMAGE` → `opea/embedding:1.5` / `opea/llm-textgen:1.5` (both tags verified on Docker Hub).
- Base images → Python 3.11 for all six; no `python3.10` path remains; dataprep's `update-alternatives` python3.10 machinery removed.
- Retire: dataprep `requirements.lock`, `dataprep/scripts/generate-requirements-in.sh`, the `docling-core==2.82.0` pin, `fix_dependencies.sh` invocations in the three module Dockerfiles, Makefile `requirements-in-dataprep`.
- Record the `verify:dataprep-lock` re-pointing decision in `prds/prd-genie-ai-2026-08-07/.decision-log.md`.

**Block If:** None — every decision above is determined by verified upstream evidence (locks fetched from `raw.githubusercontent.com/opea-project/GenAIComps/v1.5`, upstream Dockerfiles, Docker Hub tag listings).

**Never:**
- Do NOT re-graft module code (`genieai_*.py` against v1.5 `comps` — stories 2.3–2.6 own that; the import-time sweep is 2.8). 2.2's green bar is BUILD-level.
- Do NOT bump chatqna's `OPEA_VERSION` (story 2.6 owns it) — only its base → `python:3.11-slim`.
- Do NOT re-create 2-1's `.pth` sitecustomize installer or `docarray_alias_shim` — 2-1 owns those mechanisms. If 2-1's files are absent from the tree, update the hardcoded sitecustomize COPY paths to the python:3.11 equivalent; 2-1's merge supersedes them.
- Do NOT weaken `smoke:dataprep-arango`. If the overlay module import breaks under the v1.5 lock, record the expected red (the 2-5 in-image contract run is the fix surface), do not delete or empty the assertion.
- Do NOT touch `sprint-status.yaml` (orchestrator-owned).

## I/O & Edge-Case Matrix

_Deleted._ Build/dependency migration with no data-flow surface.

</intent-contract>

## Code Map

- `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` -- base `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` + apt `python3.10` + `update-alternatives` (L24-49); local lock `COPY requirements.lock` + `pip install --no-deps --require-hashes` (L64-80); sitecustomize COPY `/usr/local/lib/python3.10/dist-packages` + `rm /usr/lib/python3.10/sitecustomize.py` (L136-139); docarray mv+sed (L104-110). Change: base → `python:3.11-slim` + v1.5 apt list, drop update-alternatives, install from committed `requirements-cpu.txt` with `--require-hashes`, OPEA_VERSION → v1.5, sitecustomize path → `/usr/local/lib/python3.11/site-packages`.
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- base `python:3.10-slim` (L14); `ARG REQ_PATH=/app/comps/retrievers/src/requirements.txt` (L28); `fix_dependencies.sh` (L31-33); `pip install -r ${REQ_PATH}` (L37); upgrade pins langchain-huggingface + langchain-arangodb>=1.2.0 (L48-57); docarray mv+sed (L59-66); sitecustomize `/usr/local/lib/python3.10/site-packages` + `rm` (L91-97). Change: base → `python:3.11-slim`, REQ_PATH → committed `requirements-cpu.txt` + `--require-hashes`, drop fix_dependencies.sh + upgrade pins, OPEA_VERSION → v1.5, sitecustomize → 3.11 path.
- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` -- base already `python:3.11-slim` (L15); `REQ_PATH=/app/comps/rerankings/src/requirements.txt` (L36); `fix_dependencies.sh` (L39-40); `pip install -r` + `kneed` (L44-46); docarray mv+sed (L48-53); sitecustomize `/usr/local/lib/python3.11/site-packages` (L77-78). Change: REQ_PATH → committed `requirements-cpu.txt` + `--require-hashes`, drop fix_dependencies.sh (kneed moves into the lock), OPEA_VERSION → v1.5, sitecustomize path already correct.
- `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai` -- `comps_base_builder FROM python:3.10-slim` (L17); sitecustomize `/usr/local/lib/python3.10/site-packages` + `rm` (L103-109). Change: base → `python:3.11-slim`, sitecustomize → 3.11 path. OPEA_VERSION stays v1.3 (2.6).
- `genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai` + `textgen/Dockerfile-textgen_genie-ai` -- `ARG UPSTREAM_IMAGE=opea/embedding:1.3` / `opea/llm-textgen:1.3` (DW-1); sitecustomize `/usr/local/lib/python3.11/dist-packages`. Change: retag → `:1.5`, verify the 1.5 base's site-packages path (keep 3.11 or update to match).
- `genie-ai-overlay/dataprep/requirements.in` -- REPLACE with v1.5 `.in` fork (`raw.githubusercontent.com/opea-project/GenAIComps/v1.5/comps/dataprep/src/requirements.in`) + deltas (see Tasks).
- `genie-ai-overlay/dataprep/requirements.lock` -- DELETE (superseded by `requirements-cpu.txt`).
- `genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh` -- DELETE (v1.3 scraping machinery; upstream now ships the `.in`).
- `genie-ai-overlay/dataprep/requirements-cpu.txt` -- NEW, recompiled with hashes.
- `genie-ai-overlay/retriever/requirements.in` + `requirements-cpu.txt` -- NEW, fork of v1.5 `comps/retrievers/src/requirements.in` + deltas; hashed lock.
- `genie-ai-overlay/reranker/requirements.in` + `requirements-cpu.txt` -- NEW, fork of v1.5 `comps/rerankings/src/requirements.in` + deltas (`kneed`); hashed lock.
- `genie-ai-overlay/build-patches/fix_dependencies.sh` -- invocations removed from dataprep/retriever/reranker Dockerfiles; script deleted (its v1.3-format seds are no-ops on compiled locks — dead divergence).
- `Makefile` -- re-point `lock-dataprep` to `uv pip compile --generate-hashes --python-version 3.11` writing `requirements-cpu.txt`; add `lock-retriever` / `lock-reranker`; drop `requirements-in-dataprep`.
- `.gitlab-ci.yml` -- re-point `verify:dataprep-lock` (L2448-2492) to validate dataprep/retriever/reranker `requirements-cpu.txt` vs their `.in`; keep `smoke:dataprep-arango` (L1374+) unchanged.
- `_bmad-output/planning-artifacts/prds/prd-genie-ai-2026-08-07/.decision-log.md` -- append the `verify:dataprep-lock` re-pointing decision (FR-4).
- Verified v1.5 upstream: `comps/{dataprep/src,retrievers/src,rerankings/src}/requirements.in` + `requirements-cpu/gpu.txt`; upstream Dockerfiles all `FROM python:3.11-slim`; `comps/cores/proto/docarray.py` + `comps/cores/mega/{orchestrator,micro_service}.py` still exist in v1.5 (the build-time mv+sed still runs; sed-pattern drift is 2.3–2.6 re-graft surface). v1.5 dataprep lock pins: `docling==2.45.0`, `docling-core==2.44.2`, `docarray==0.41.0`, `langchain==0.3.27`, `langchain-arangodb==0.0.6`, `fastapi==0.116.1`.

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/dataprep/requirements.in` -- fork v1.5 `.in`; swap `opencv-python`→`opencv-python-headless`, `psycopg2`→`psycopg2-binary`; keep `openai-whisper` (v1.5 pins it; verify it builds — D8); add overlay extras `rank_bm25`, `hf_xet`, `python-jose[cryptography]`, `aiohttp`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-aiohttp-client`, `opentelemetry-instrumentation-requests`, `opentelemetry-exporter-otlp-proto-http` -- compiled-lock source (FR-4).
- `genie-ai-overlay/dataprep/requirements-cpu.txt` -- NEW via `uv pip compile --generate-hashes --python-version 3.11` -- hashed lock (AC1).
- `genie-ai-overlay/retriever/requirements.in` + `requirements-cpu.txt` -- NEW; v1.5 `.in` fork (has `psycopg2-binary`, `pathway` marked) + opentelemetry-instrumentation extras -- D7 (AC1).
- `genie-ai-overlay/reranker/requirements.in` + `requirements-cpu.txt` -- NEW; v1.5 `.in` fork + `kneed` + opentelemetry-instrumentation extras -- D7 (AC1).
- `genie-ai-overlay/dataprep/requirements.lock` + `dataprep/scripts/generate-requirements-in.sh` -- DELETE -- retire v1.3 machinery (AC3).
- `genie-ai-overlay/build-patches/fix_dependencies.sh` -- DELETE + drop its `COPY`/`RUN` from dataprep/retriever/reranker Dockerfiles -- no dead seds on compiled locks (AC3).
- dataprep/retriever/reranker/chatqna Dockerfiles -- base → `python:3.11-slim`; `REQ_PATH` → `COPY genie-ai-overlay/<module>/requirements-cpu.txt /app/requirements-cpu.txt` + `pip install --no-deps --require-hashes -r /app/requirements-cpu.txt` (`--no-deps` restores the v1.3 deterministic-install pattern — the compiled lock lists the full closure, so pip installs purely from the lock with no re-resolution); `OPEA_VERSION` → `v1.5` (dataprep/retriever/reranker only); sitecustomize COPY paths → `/usr/local/lib/python3.11/site-packages`; drop dataprep update-alternatives + the `rm -f /usr/lib/python3.10/sitecustomize.py` -- Python 3.11 (AC2/AC4).
- retriever/reranker Dockerfiles -- REMOVE the separate non-hashed `pip install "opentelemetry-*>=..."` blocks (the recompiled locks pin opentelemetry exactly; a post-lock unhashed install would break the fully-hashed build) -- deterministic fleet (AC4).
- embedding/textgen Dockerfiles -- `UPSTREAM_IMAGE` → `:1.5`; verify site-packages path matches the 1.5 base -- retag (AC6).
- `Makefile` -- re-point `lock-dataprep` (3.11, `--generate-hashes`, output `requirements-cpu.txt`), add `lock-retriever`/`lock-reranker`, drop `requirements-in-dataprep` -- regeneration tooling (AC5).
- `.gitlab-ci.yml` -- re-point `verify:dataprep-lock` to the three modules' `.in`→`requirements-cpu.txt` cross-check (`uv pip sync --dry-run` + per-package grep) -- drift guard (AC5).
- `.decision-log.md` -- append `verify:dataprep-lock` re-pointing decision (FR-4) -- recorded decision (AC5).
- Verification-only task: in a venv, `import comps.dataprep.src.integrations.genieai_dataprep_arangodb` against the recompiled v1.5 lock; if it breaks, record the expected red (2-5's in-image contract run is the fix surface); do not change `smoke:dataprep-arango` -- documented evidence (AC4).

**Acceptance Criteria:**
- Given v1.5's compiled-lock layout, when dataprep/retriever/reranker each commit a `requirements.in` (v1.5 fork + overlay deltas) and a `requirements-cpu.txt` recompiled with `uv pip compile --generate-hashes --python-version 3.11`, then every package line in each lock carries `--hash=sha256:...`, dataprep pins `docling-core==2.44.2`, and `uv pip sync requirements-cpu.txt --dry-run` passes for all three.
- Given all six Dockerfiles, when every base is Python 3.11 (`python:3.11-slim` or `opea/*:1.5`), then `grep -rn "python3.10" genie-ai-overlay/*/Dockerfile*` finds no hardcoded `python3.10` path and no dataprep `update-alternatives` python3.10 machinery remains.
- Given the migration, when dataprep `requirements.lock`, `generate-requirements-in.sh`, the `docling-core==2.82.0` pin, and `fix_dependencies.sh` are removed, then `grep -rn "requirements.lock\|generate-requirements-in\|docling-core==2.82.0\|fix_dependencies" genie-ai-overlay/` finds nothing, and the three module Dockerfiles install from their committed `requirements-cpu.txt` with `--require-hashes`.
- Given the deterministic install, when the dataprep/retriever/reranker images build with `OPEA_VERSION=v1.5` (cache-busting ARG) from the hashed locks, then `pip install --require-hashes -r requirements-cpu.txt` installs purely from the lock (no re-resolution), and a clean `docker build --no-cache` re-run yields an identical image digest.
- Given the new lock layout, when `verify:dataprep-lock` is re-pointed to validate all three modules' `requirements-cpu.txt` vs their `.in` and `Makefile` lock targets are re-pointed to `--generate-hashes --python-version 3.11`, then the CI job fails on lock drift and the re-pointing decision is recorded in `.decision-log.md`.
- Given DW-1, when embedding/textgen `ARG UPSTREAM_IMAGE` moves to `opea/embedding:1.5` / `opea/llm-textgen:1.5`, then `grep` confirms `:1.5` and each wrapper's sitecustomize path matches its 1.5 base's site-packages location.

## Spec Change Log

_None yet._

## Review Triage Log

### 2026-08-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 3, medium 1, low 2)
- defer: 8: (medium 3, low 5)
- reject: 5: (low 5)
- addressed_findings:
  - `[high]` `[patch]` Makefile lock targets restored `--python-platform x86_64-manylinux_2_31` — a host-platform lock would break `pip install --require-hashes` in the Debian `python:3.11-slim` image.
  - `[high]` `[patch]` retriever Dockerfile apt gained the v1.5 retriever libs (`build-essential libcairo2 libglib2.0-0 libjemalloc-dev libmariadb-dev`) — the lock installs `mariadb==1.1.14` (source build, no manylinux wheel).
  - `[high]` `[patch]` reranker module import verified against v1.5 comps locally — all comps symbol imports resolve (telemetry, api_protocol, opea_docarray rename, integrations.tei); only a host port-8000 collision blocked a full clean pass; in-image behavioral gate stays story 2.4.
  - `[medium]` `[patch]` `verify:dataprep-lock` gained `set -e` — a failed module lock check now fails the job instead of passing green.
  - `[low]` `[patch]` reranker `.in` duplicate bare `Pillow` removed; lock recompiled (hash-identical, 3411 hashes).
  - `[low]` `[patch]` spec Verification grep excludes comment lines (comment text mentions the retired python3.10 machinery).

### 2026-08-12 — Follow-up review pass (salvage + baseline fix)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 1, low 4)
- defer: 5: (medium 1, low 4)
- reject: 4: (low 4)
- addressed_findings:
  - `[high]` `[patch]` dataprep/retriever locks were compiled host-platform (no `--python-platform`) — only reranker carried the flag, while the Makefile prescribed it for all three. Host (glibc 2.43) wheels could break `pip install --require-hashes` in Debian bookworm (glibc 2.36). RECOMPILED both locks with `--python-platform x86_64-manylinux_2_31`; header now documents it; no version changed, only wheel-hash selection (149 lines swapped); `uv pip sync --dry-run` green.
  - `[medium]` `[patch]` dataprep's deterministic install dropped `--no-deps` (`pip install --no-cache-dir --require-hashes`); restored `--no-deps --require-hashes` in dataprep/retriever/reranker — the compiled lock lists the full closure, so pip installs purely from the lock with no re-resolution (AC4 "no re-resolution" now literal).
  - `[low]` `[patch]` retriever Dockerfile comment implied the 0.0.6 langchain-arangodb drop preserved the `>=1.2.0` filter_clause fix; reworded to state 0.0.6 lacks the fix-pin and story 2.3 restores it.
  - `[low]` `[patch]` spec Verification command lacked `--python-platform x86_64-manylinux_2_31`; updated to match Makefile + committed locks.
  - `[low]` `[patch]` spec Design Note claimed "pathway is now correctly marker-pinned"; false — pathway is bare in the fork and lock (`pathway==0.32.1`), matching upstream v1.5's own bare `pathway`. Corrected.
  - `[low]` `[patch]` dataprep `.in` opencv comment claimed the two cv2 providers "cannot coexist in a lock" while the lock ships both; annotated that the dual install is a 2.5 re-audit item.

### 2026-08-12 — Follow-up review pass (done-spec fresh review, 4 parallel layers)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 1, low 2)
- defer: 15: (medium 4, low 11)
- reject: 2: (low 2)
- addressed_findings:
  - `[high]` `[patch]` dataprep Dockerfile apt gained `libglib2.0-0` — the v1.5 lock installs non-headless `opencv-python` (transitive via unstructured-inference) alongside headless; cv2 links `libgthread-2.0.so.0`/`libglib-2.0.so.0`, which `python:3.11-slim` lacks (the old CUDA base supplied them) and retriever's v1.5 apt list already carries. Without it `import cv2` (genieai_dataprep_utils.py:10) fails → smoke:dataprep-arango (in-image module import) breaks the build gate.
  - `[low]` `[patch]` dataprep `requirements.in` opencv comment corrected — "cannot coexist in a lock" contradicted the committed lock shipping both providers; reworded (dual install stays a 2.5 re-audit item).
  - `[low]` `[patch]` spec Design Note "so nothing is lost" corrected — dataprep loses the CUDA *runtime* (not just GPU device access); `DOCLING_DEVICE` defaults to `cuda` and the CUDA-less image cannot honor it; substantive fix deferred to 2.5.
- Deferred evidence corrections (existing items kept, evidence made accurate): #2/#11 "build unverified" → CI build jobs DO run `docker buildx` + `pip install --no-deps --require-hashes` from the lock, so install/wheel/source-build failures block the MR; genuinely ungated is image SIZE + post-import runtime. #7 → `torch==2.13.0` (CUDA-bundled PyPI wheel) is in ALL THREE CPU locks, not GPU-only. #9 → locked openai spread corrected (dataprep 1.81.0 / retriever 1.109.1 / reranker 3.0.0) + fastapi split 0.116.1/0.118.2.
- New deferred items: backend stale CI copy (low), dataprep DOCLING_DEVICE=cuda default vs CUDA-less image (medium), docarray mv+sed unguarded on v1.5 (low).

### 2026-08-12 — Follow-up review pass #2 (done-spec fresh review, 4 parallel layers)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (low 1)
- defer: 15: (medium 6, low 9) — 13 confirmations of existing deferred items + 2 new
- reject: 5: (low 5)
- addressed_findings:
  - `[low]` `[patch]` all three `requirements.in` regen comments now carry `--python-platform x86_64-manylinux_2_31`, byte-matching the Makefile `lock-<module>` target — a developer following the in-file comment would otherwise regenerate a host-platform lock (the defect class the prior follow-up pass fixed in the Makefile/locks).

### 2026-08-12 — Follow-up review pass #3 (done-spec fresh review, resumed run 20260812-135642-0fc1)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 15: (medium 6, low 9) — 12 confirmations of existing deferred items + 3 new
- reject: 4: (low 4)
- addressed_findings:
  - none

### 2026-08-12 — Review pass (reuse adoption of 8ca0649e6 + fix pass)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 2, low 2)
- defer: 9: (medium 4, low 5) — 2 new items appended (dataprep dual opencv wheel; test:python on 3.10), 7 re-confirmed existing
- reject: 3: (low 3)
- addressed_findings:
  - `[high]` `[patch]` AC3 retirement was NOT executed in the adopted tree — `dataprep/requirements.lock`, `dataprep/scripts/generate-requirements-in.sh`, `build-patches/fix_dependencies.sh` were still tracked (the `git checkout 8ca0649e6 -- .` reuse step did not apply the deletions). `git rm`'d all three; the spec's retirement grep now exits clean.
  - `[medium]` `[patch]` ci-wait.sh platform block was triplicated — removed the two GNU-`\s` buggy copies (no YAML comment strip), kept the POSIX block; previously deferred (DW-21), now fixed.
  - `[medium]` `[patch]` DOCLING_DEVICE default `cuda`→`cpu` in `genieai_dataprep_utils.py:45` + `docker-compose.yaml:991` — the CUDA-less `python:3.11-slim` base cannot honor cuda; previously deferred (DW-26), now fixed so a default-config ingest works.
  - `[low]` `[patch]` reranker Dockerfile stray `# OPEA's reranker uses 3.11 <<< (ROMAN)` editor marker removed.
  - `[low]` `[patch]` Makefile `UV` pinned to CI's uv==0.10.6 (`UV ?= uvx --from uv==0.10.6 uv`); previously deferred, now fixed.

## Design Notes

- **Hashes are generated before adoption (PRD FR-4 assumption, now verified).** v1.5's upstream `requirements-cpu.txt` files are compiled with `uv pip compile ... --universal` and carry no `--hash` markers (verified from the fetched dataprep/retriever/reranker locks). To satisfy AC1's "hashed requirements", each module's lock is recompiled from a forked `.in` with `--generate-hashes --python-version 3.11`. The `.in` stays a thin fork of upstream's (upstream maintains it; future bumps re-fork + recompile), which is how "adopt OPEA's compiled lock" and "retire the local machinery" coexist: the old `generate-requirements-in.sh` (which scraped v1.3's unpinned `requirements.txt`) is the retired machinery, not the `.in`-fork + compile loop.
- **Why the clone tag must bump with the lock.** The v1.5 locks pin `docling==2.45.0`/`docling-core==2.44.2`/`langchain==0.3.27` — versions that pair with v1.5 `comps` source, not v1.3. Keeping the v1.3 clone while installing v1.5 deps would be a worse, inconsistent state, so dataprep/retriever/reranker move `OPEA_VERSION` → v1.5 together with the lock. The overlay `genieai_*.py` files may not import against v1.5 `comps` yet — that is the 2.3–2.6 re-graft surface (and 2-1's docarray shim); 2.2's green bar is the build.
- **Base-image decisions.** dataprep moves from the CUDA/Ubuntu base to `python:3.11-slim`, matching upstream v1.5's dataprep Dockerfile; the compose file grants no GPU to dataprep/retriever/reranker (only `gpu-models` profile services do), so no GPU *hardware access* is lost. What IS lost: the CUDA runtime itself (CUDA/cudnn libs). The module default is `DOCLING_DEVICE=cuda` (compose passes `${DOCLING_DEVICE:-cuda}`, env template unset) — the CUDA-less image cannot honor a cuda device at docling init, so a default-config ingest on the new image needs `DOCLING_DEVICE=cpu` set (deferred; the coherent fix spans compose + module default and is a 2.5 re-audit item). This base move removes the `update-alternatives` python3.10 machinery in one stroke (FR-3). chatqna keeps v1.3 comps but its base moves to `python:3.11-slim` (v1.3 comps already installs on 3.11 — the v1.3 reranker image proves it).
- **`verify:dataprep-lock` re-pointing.** The old job validated dataprep `requirements.lock` vs `requirements.in` via `uv pip sync --dry-run` + a per-package grep. The re-pointed job keeps the same mechanics against the three modules' `requirements-cpu.txt` (the decision is recorded in `.decision-log.md` per FR-4). The `uv pip sync --dry-run` check catches removed packages; the grep catches a dep added to `.in` without a lock regen.
- **GPU-lock scoping.** Upstream also ships `requirements-gpu.txt` per module, but 2.2 compiles and commits the CPU locks only: `docker-compose.yaml` grants no GPU to dataprep/retriever/reranker (GPU services live under the `gpu-models` profile), so the fleet consumes the CPU locks. The GPU locks differ only by the torch/`--index-url` install; they can be compiled from the same `.in` (`uv pip compile --generate-hashes`) if a GPU deployment later needs them.
- **`fix_dependencies.sh` disposition = obsolete-remove.** Its seds target v1.3-format lines (`pathway==0.3.3`, `graspologic==3.4.1`, `psycopg2==2.9.10`) that do not exist in the compiled locks (pathway resolves to `pathway==0.32.1` unpinned-bare from the v1.5 fork, matching upstream v1.5's own bare `pathway` in `comps/retrievers/src/requirements.in`; retriever's `.in` already uses `psycopg2-binary`). Running it against a lock would be a silent no-op — the failure class the architecture forbids — so it is deleted, not kept. Story 2.4's "REQ_PATH re-pointed to the compiled lock" is satisfied by the Dockerfile pointing at `requirements-cpu.txt`.
- **Merge-compatibility with story 2-1.** 2-2's branch does not carry 2-1's code. The sitecustomize/docarray mechanisms belong to 2-1 (`.pth` installer + shim); 2-2 only updates the hardcoded COPY paths to the 3.11 equivalent so the branch is standalone-correct. When 2-1 merges, its installer replaces those COPY lines (the installer is Python-version-stable, so it is 3.11-correct) and its shim replaces the docarray mv+sed — 2-2 must not reintroduce a competing mechanism.

## Verification

**Commands:**
- `cd genie-ai-overlay/<module> && uv pip compile requirements.in --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31 --output-file requirements-cpu.txt` (module = dataprep/retriever/reranker) -- expected: exit 0; lock carries `--hash=sha256:` on every package; header documents the `--python-platform x86_64-manylinux_2_31` flag (bookworm glibc 2.36 compatibility)
- `cd genie-ai-overlay/dataprep && uv pip sync requirements-cpu.txt --dry-run` (same for retriever/reranker) -- expected: exit 0 (lock consistent)
- `grep -rEn "python3.10" genie-ai-overlay/*/Dockerfile* | grep -vE ':[0-9]+:#'` -- expected: no non-comment matches (no hardcoded python3.10 COPY/install path; comment text may mention the retired machinery)
- `grep -rn "requirements.lock\|generate-requirements-in\|docling-core==2.82.0\|fix_dependencies" genie-ai-overlay/` -- expected: no matches
- `grep -n "OPEA_VERSION\|UPSTREAM_IMAGE\|python:3.11\|require-hashes" genie-ai-overlay/*/Dockerfile*` -- expected: v1.5 / :1.5 / python:3.11 / --require-hashes present
- `cd genie-ai-overlay && ruff check tests/` + `ruff format --check` -- expected: clean (no Python source changed except new .in files, which ruff ignores; run anyway)

**Manual checks (if no CLI):**
- Dockerfile review: all six bases Python 3.11; dataprep/retriever/reranker install `COPY genie-ai-overlay/<module>/requirements-cpu.txt` with `pip install --require-hashes`; no `update-alternatives` python3.10; no `fix_dependencies.sh`.
- CI: `verify:dataprep-lock` covers the three modules; `smoke:dataprep-arango` unchanged.
- In a venv: `import comps.dataprep.src.integrations.genieai_dataprep_arangodb` against the recompiled lock — record pass or expected-red (2-5 fix surface) in the Auto Run Result.

## Auto Run Result

Status: done

**Summary (this follow-up review pass #2):** Fresh review of the `done` spec with 4 parallel layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment auditor). All ACs and Never-constraints verified intact against the committed tree; reviewers independently re-checked the lock dry-runs, the CI grep loop, and the drift-guard cross-check against the working tree. One documentation patch applied (`.in` regen comments), two new deferred items appended, no intent_gap / no bad_spec.

**Files changed (this pass):**
- `genie-ai-overlay/{dataprep,retriever,reranker}/requirements.in` — regen comment in each header now includes `--python-platform x86_64-manylinux_2_31`, byte-matching the Makefile `lock-<module>` target (a developer following the in-file comment would otherwise regenerate a host-platform lock).
- `_bmad-output/implementation-artifacts/2-2-migrate-dependencies-python-3-11.md` — `followup_review_recommended: false`; 2 new deferred items (chatqna 3.11 runtime gap, tag-pipeline drift-guard blast radius); this triage-log entry + Auto Run Result.

**Review findings breakdown (this pass):** 1 patch applied (low — `.in` header comments). 15 deferred (6 medium, 9 low): 13 confirmations of existing items (drift guard name-only + trigger paths, cross-module docling/otel/haystack/openai drift, reranker bare pins, heavy deps + size, cv2 collision, pin-policy hybrid, embedding/textgen sitecustomize auto-load, langchain-arangodb 0.0.6 fix-pin, docarray mv+sed unguarded, `DOCLING_DEVICE=cuda` vs CUDA-less image, backend stale CI copy, ci-wait platform-sed) + 2 new (chatqna 3.11 + v1.3 comps runtime unverified in-image — medium; `verify:dataprep-lock` tag-pipeline blast radius tripled — low). 5 rejected (low): deferred-work.md DW-16/17/18 duplicates vs DW-14/12 (orchestrator-owned ledger — surfaced, not modified), non-x86_64 runner false-fail (speculative; runners fixed x86_64), locks excluded from review diff (generated artifacts, spot-checked on tree), story-track `git_platform` fallback (orchestrator infra), ci-wait trailing-comment mechanism refinement (DW-15 family).

**Follow-up review recommendation:** false — 1 low-severity patch this pass (score = 3×0 medium + 1×1 low = 1 < 5; no high).

**Verification performed (this pass):**
- All three `requirements-cpu.txt`: `uv pip sync --dry-run` exit 0 in a temp python:3.11 venv (dataprep/retriever/reranker); hash + version lines unchanged by this pass's comment-only `.in` patch.
- `grep -rEn "python3.10" genie-ai-overlay/*/Dockerfile* | grep -vE ':[0-9]+:#'` — no non-comment matches (exit 1).
- `grep -rn "requirements.lock\|generate-requirements-in\|docling-core==2.82.0\|fix_dependencies" genie-ai-overlay/` — no matches (exit 1).
- `OPEA_VERSION` present in dataprep/retriever/reranker Dockerfiles; embedding/textgen `UPSTREAM_IMAGE=opea/embedding:1.5` / `opea/llm-textgen:1.5`.
- Spec frontmatter parses as YAML; `deferred` is one list of 17 items, all with `summary` + `evidence`; existing 15 preserved verbatim.

**Residual risks (unchanged; carried on the deferred list):**
- No `docker build` executed in this environment — Dockerfile wiring verified by grep + uv dry-runs; in-image installs/`.pth`/shim behavior covered by stories 2.3–2.6 in-image contract runs and 2-1's merge. CI build jobs are the live gate for install/wheel/source-build failures; image SIZE + post-import runtime remain unverified.
- chatqna 3.11 base with v1.3 comps has no in-image import gate until story 2.6 (new deferred item).
- dataprep/retriever heavy deps (pyspark, `unstructured[all-docs]`, mariadb source build, openai-whisper, torch 2.13.0 CUDA-bundled in all three CPU locks) raise image size/build time — 2.5 re-audits.
- dataprep default `DOCLING_DEVICE=cuda` unsupported by the CUDA-less image — deployers must set `DOCLING_DEVICE=cpu` until 2.5 reconciles compose/module defaults.
- 2-1's `.pth` installer + docarray shim are not on this branch; when 2-1 merges, it supersedes the hardcoded sitecustomize COPYs.

---

### 2026-08-12 — Follow-up review pass #3 (resumed run 20260812-135642-0fc1; fresh review of the done spec)

**Summary:** Story implementation was already complete and reviewed on the prior bmad-loop run (`20260812-101604-d1d5`); this run resumed it by cherry-picking that run's squashed story commit (a0d469195 → 1bf4b148d) onto the current branch from the same base (f7402eecf). This pass ran a fresh 4-layer review (blind-hunter, edge-case-hunter, verification-gap, intent-alignment auditor) over the implementation diff (`_bmad-output/implementation-artifacts/review/part-a-code-diff.patch`, 531 lines; generated `requirements-cpu.txt` locks excluded). All ACs and Never-constraints verified intact against the committed tree. Reviewers' findings were almost entirely confirmations of the existing deferred list; 3 new low-severity deferred items appended, 4 rejected. No code changes — spec-only pass.

**Files changed (this pass):** none (code already committed at 1bf4b148d). Spec-only: triage-log entry, 3 new deferred items, this result.

**Review findings breakdown (this pass):** 0 patch. 15 deferred (6 medium, 9 low): 12 confirmations of existing items (langchain-arangodb 0.0.6 filter_clause fix-pin incl. contract-suite blindness, dataprep heavy deps pyspark/unstructured[all-docs]/graspologic/openai-whisper + torch-in-CPU-locks, sitecustomize auto-load, reranker in-image gate, drift-guard name-only + trigger paths, cross-module otel/openai drift, ci-wait platform-sed, backend stale CI copy, DOCLING_DEVICE=cuda vs CUDA-less image, chatqna 3.11 + v1.3 comps) + 3 new (retriever/reranker missing system libs for their locks — pytesseract/tesseract-ocr, pydub/ffmpeg; Makefile lock-* targets unpinned uv vs CI uv==0.10.6; dataprep .in openai pin bare llama_index-issue-link rationale). 4 rejected (low): lock-platform/glibc mismatch speculation (uv dry-runs green, no concrete failing package), pathway/graspologic "reintroduction" (intentional — matches upstream v1.5 fork, documented in spec Design Notes), OPEA-bump procedure "missing" (documented in Makefile targets + .in headers + spec Design Notes), sprint-status.yaml touch (orchestrator story-track auto-stamp, not story action).

**Follow-up review recommendation:** false — 0 patches this pass (score = 0 < 5).

**Verification performed (this pass):**
- All three `requirements-cpu.txt`: `uv pip sync --dry-run --python <py3.11 venv>` exit 0 (dataprep/retriever/reranker).
- `grep -rEn "python3.10" genie-ai-overlay/*/Dockerfile* | grep -vE ':[0-9]+:#'` — no non-comment matches.
- `grep -rn "requirements.lock\|generate-requirements-in\|docling-core==2.82.0\|fix_dependencies" genie-ai-overlay/` — no matches.
- Base/retag checks: dataprep/retriever/reranker `OPEA_VERSION=v1.5`, chatqna stays `v1.3` (Never constraint), embedding/textgen `UPSTREAM_IMAGE=opea/*:1.5`, all bases `python:3.11-slim`, `--require-hashes` present.
- Spec frontmatter reparsed as YAML after appends; `deferred` is one list of 20 items, prior 17 preserved verbatim, 3 new appended.

**Residual risks (unchanged; carried on the deferred list):**
- retriever `langchain-arangodb==0.0.6` filter_clause fix-pin gone until story 2.3 bumps it; in-repo label-filter contract tests cannot observe a library-level regression.
- chatqna v1.3 comps on the 3.11 builder has no in-image gate until story 2.6; reranker/embedding/textgen v1.5 runtime unverified in-image (2.4/2.5 re-audit).
- dataprep default `DOCLING_DEVICE=cuda` unsupported by the CUDA-less image — deployers must set `DOCLING_DEVICE=cpu` until 2.5.
- Heavy deps (pyspark, `unstructured[all-docs]`, openai-whisper, torch 2.13.0 in all three CPU locks) raise image size/build time — 2.5 re-audits.
- No `docker build` executed in this environment; CI build jobs are the live gate for install/wheel/source-build failures.


### 2026-08-12 — Review pass (reuse adoption + fixes)

**Summary:** This pass reviewed the reused implementation (prior attempt `8ca0649e6` adopted onto this branch). Fresh 4-layer review (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) over `review/part-b-code-diff.patch` (generated `requirements-cpu.txt` locks excluded). One high defect: the AC3 retirement was NOT actually applied by the reuse step — three v1.3 lock-machinery files were still tracked. All 5 actionable findings fixed; 2 new deferred items appended; 3 rejected.

**Files changed (this pass):**
- `genie-ai-overlay/dataprep/requirements.lock`, `genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh`, `genie-ai-overlay/build-patches/fix_dependencies.sh` — DELETED (AC3 retirement; left tracked by the reuse checkout).
- `.bmad-loop/ci-wait.sh` — removed 2 duplicate GNU-`\s` platform-resolution blocks, kept the POSIX comment-stripping one.
- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` — removed stray `<<< (ROMAN)` editor marker comment.
- `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` + `docker-compose.yaml` — `DOCLING_DEVICE` default `cuda`→`cpu` (CUDA-less base cannot honor cuda).
- `Makefile` — `UV` pinned to CI's uv==0.10.6 (`UV ?= uvx --from uv==0.10.6 uv`).

**Review findings breakdown (this pass):** 5 patch (1 high, 2 medium, 2 low). 9 defer (2 new — dataprep dual opencv wheel, test:python on 3.10 — plus 7 re-confirmed existing). 3 reject (uv-vs-pip resolver — CI build jobs gate pip install; truncated review diff — rtk compaction artifact, reviewers reconstructed from the tree; deferred-work ledger dupes — append-only ledger hygiene).

**Follow-up review recommendation:** true — 1 high patch; score = 3×2(medium) + 1×2(low) = 8 ≥ 5.

**Verification performed (this pass):**
- `uv pip sync requirements-cpu.txt --dry-run --python <py3.11>` exit 0 for dataprep/retriever/reranker.
- `python -m pytest tests/` — 680 passed on Python 3.11 venv (test extras).
- `ruff check genie-ai-overlay/` clean; `ruff format --check` on the changed module clean.
- `grep -rn "requirements.lock\|generate-requirements-in\|docling-core==2.82.0\|fix_dependencies" genie-ai-overlay/` — no matches (exit 1).
- `bash -n .bmad-loop/ci-wait.sh` OK; `make -n lock-dataprep` shows the pinned uvx command.
- Spec frontmatter reparsed; `deferred` is one list (3 fixed items removed, 2 new appended).

**Residual risks (unchanged; carried on the deferred list):**
- retriever `langchain-arangodb==0.0.6` fix-pin gone until 2.3; label-filter library-level regression unobservable by in-repo tests.
- chatqna v1.3 comps on the 3.11 builder, reranker/embedding/textgen v1.5 runtime — no in-image gate until 2.4/2.6.
- dataprep dual `opencv-python`/`opencv-python-headless` wheels + heavy deps + torch 2.13.0 in all three CPU locks raise image size — 2.5 re-audits.
- No `docker build` executed here; CI build jobs are the live gate for install/wheel/source-build failures.
