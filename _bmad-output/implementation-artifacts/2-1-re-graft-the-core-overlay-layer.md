---
title: 'Re-graft the core overlay layer'
type: 'feature'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      embedding/textgen wrapper images still pin OPEA 1.3 base images.
    evidence: |-
      ARG UPSTREAM_IMAGE=opea/embedding:1.3 / opea/llm-textgen:1.3 unchanged while core/constants.py now exposes a v1.5-shaped enum; the retag to 1.5-based bases is story 2.2's OPEA_VERSION bump.
    location: >-
      genie-ai-overlay/embedding/Dockerfile-embedding_genie-ai:4
    severity: low
  - summary: >-
      pydantic v2 in the module images is not verified at build/runtime.
    evidence: |-
      PositiveInt/NonNegativeFloat require pydantic v2; the images build from python:3.10-slim / opea:1.3 bases and no runtime pydantic-major check exists; covered by story 2.2's base-image migration + in-image contract runs.
    location: >-
      genie-ai-overlay/core/genieai_api_protocol.py:13
    severity: low
  - summary: >-
      override-audit lint is not enforced in CI and is one-directional.
    evidence: |-
      lint_overrides.py runs only via the local pytest test_overrides_lint.py; no CI job wires it, the marker-to-manifest direction is unenforced, and .pth runtime-load failures are silent; CI enforcement belongs to story 2.7 (verify:evidence + coherence lint).
    location: >-
      genie-ai-overlay/build-patches/lint_overrides.py
    severity: medium
baseline_commit: '597801e1'
baseline_revision: '9233ebd2bb8a014a56a9ef8d13341871bc5a2d5e'
---

# Story 2.1: Re-graft the core overlay layer

<intent-contract>

## Intent

**Problem:** The core overlay layer (`genie-ai-overlay/core/`) is still grafted to OPEA v1.3. v1.5 changed `comps/cores/mega/constants.py` (ServiceType grew to 29 members, added `MCPFuncType`) and `proto/api_protocol.py` (Pydantic v2 constrained types `PositiveInt`/`NonNegativeFloat`). Every later module re-graft (stories 2.3–2.6) assumes the shared layer is current.

**Approach:** Regenerate `core/constants.py` from v1.5's enum verbatim + re-append `TRANSLATOR` at the new tail slot (29); re-graft `core/genieai_api_protocol.py` to v1.5 Pydantic; create the `OVERRIDES.yaml` override-audit manifest for the core layer; replace the hardcoded `python3.10` sitecustomize copy with a `.pth`-based, build-derived site-packages install; replace the docarray `mv`+`sed` rename hack with a `sys.modules` alias shim.

## Boundaries & Constraints

**Always:** Delta philosophy — regenerated files byte-identical to upstream v1.5 except the `TRANSLATOR` line (constants) and the changed-type lines carrying override records (protocol). No vendored-source mutation: the docarray fix is a shim, never a file rename/`sed`. All core-layer overrides recorded in `OVERRIDES.yaml` with a disposition. SSL-bypass semantics preserved exactly (`OPEA_SSL_SKIP_VERIFY=1` no-op unless set).

**Block If:** None — all design decisions are determined by the evidence (TRANSLATOR slot = 29, next free int after v1.5's 0–28; shim = `sys.modules` pin; sitecustomize = `.pth` import at `site.getsitepackages()[0]`).

**Never:** Do NOT bump `OPEA_VERSION` (story 2.2 owns the tag change). Do NOT re-graft module code (retriever/reranker/dataprep/chatqna are stories 2.3–2.6). Do NOT modify vendored `docarray.py` content. Do NOT drop the SSL bypass.

## I/O & Edge-Case Matrix

_None._ This story has no data-flow I/O surface; its observable surfaces are the import-time enum/protocol contract (asserted in tests) and build-time install mechanics (asserted via Dockerfile grep + in-image checks).

</intent-contract>

## Code Map

- `genie-ai-overlay/core/constants.py` -- REGENERATE from v1.5 `comps/cores/mega/constants.py`: `from enum import Enum, auto`; ServiceType GATEWAY=0…STRUCT2GRAPH=23, LANGUAGE_DETECTION=24, PROMPT_TEMPLATE=25, PROMPT_REGISTRY=26, TEXT2QUERY=27, ARB_POST_HEARING_ASSISTANT=28; append `TRANSLATOR = 29`. Include v1.5's new `MCPFuncType(Enum)` (auto). MegaServiceEndpoint/MicroServiceEndpoint unchanged (34 endpoints, identical).
- `genie-ai-overlay/core/genieai_api_protocol.py` -- RE-GRAFT: `from api_protocol import *` (no `__all__`); subclassed symbols (`RetrievalRequest`, `RetrievalResponse`, `RetrievalResponseData`, `RerankingResponseData`, `EmbeddingResponse`, `ResponseFormat`, `StreamOptions`, `ChatCompletionToolsParam`, `ChatCompletionNamedToolChoiceParam`, `ArangoDBDataprepRequest`, `UploadFile`) all present in v1.5 (none removed). v1.5 field-type changes to mirror: `k: PositiveInt`, `fetch_k: PositiveInt`, `lambda_mult: NonNegativeFloat`, `score_threshold: NonNegativeFloat` (pydantic v2).
- `genie-ai-overlay/tests/test_core.py` -- UPDATE the name→int mapping guard: `test_member_count` len(ServiceType) 25→30; `test_translator_is_last` TRANSLATOR.value 24→29. Sequential-ints + uniqueness tests hold as-is.
- `genie-ai-overlay/build-patches/docarray_alias_shim.py` -- NEW `sys.modules` pin: pop `*/cores/proto` from `sys.path`, `import docarray` (real package), pin `sys.modules["docarray"]`, restore path. Runs at site-init before comps. No vendored mutation; works under any vendor layout.
- `genie-ai-overlay/build-patches/install_site_startup.sh` -- NEW shared installer: compute `SITE_PKGS="$(python3 -c 'import site; print(site.getsitepackages()[0])')"`, copy `genie_ssl_patch.py` (+ `docarray_alias_shim.py` when present) into it, write `zz_genie_startup.pth` with `import genie_ssl_patch` [+ `import docarray_alias_shim`].
- `configs/ssl/genie_ssl_patch.py` -- UNCHANGED source (SSL bypass + `VLLM_API_KEY` Bearer injection); now installed via `.pth` import instead of `sitecustomize.py` overwrite. `model_cache.py:53` comment references it descriptively — leave or reword.
- `genie-ai-overlay/OVERRIDES.yaml` -- NEW override-audit manifest (architecture pattern 1): entries for constants regeneration, protocol re-graft, docarray shim, sitecustomize mechanism; schema `override → disposition → owner → ticket` + `# OVERRIDE <module>.<name> | disposition: … | reason: … | test: …` records.
- `genie-ai-overlay/build-patches/lint_overrides.py` -- NEW lint: parse OVERRIDES.yaml, validate schema + disposition enum, require a matching `# OVERRIDE` record per entry; exit 0/1.
- Dockerfiles (6, hardcoded sitecustomize paths): `dataprep/Dockerfile-dataprep_genie-ai:136-139` (`/usr/local/lib/python3.10/dist-packages`), `retriever/Dockerfile-retriever_genie-ai:91-97` (`python3.10/site-packages`), `reranker/Dockerfile-reranker_genie-ai:77-78` (`python3.11`), `chatqna/Dockerfile-chatqna_genie-ai:103-109` (`python3.10`), `embedding/Dockerfile-embedding_genie-ai:5` + `textgen/Dockerfile-textgen_genie-ai:5` (`python3.11/dist-packages`) -- replace the `COPY … sitecustomize.py` + `rm` with `install_site_startup.sh` call.
- Dockerfiles (3, docarray mv+sed): `retriever:59-66`, `reranker:48-53`, `dataprep:104-110` -- replace `mv …docarray.py …opea_docarray.py` + 3 `sed` with `COPY` of `docarray_alias_shim.py` + `.pth` wiring. chatqna does NOT do the rename (no proto dir on its PYTHONPATH) -- leave it.
- Upstream diff source (pinned): `https://raw.githubusercontent.com/opea-project/GenAIComps/v1.5/comps/cores/mega/constants.py` and `…/proto/api_protocol.py`.
- `genie-ai-overlay/tests/conftest.py:35` -- already mocks `comps.cores.proto.docarray` (pre-rename name = shim-world name); no change needed.

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/core/constants.py` -- regenerate v1.5 verbatim + `TRANSLATOR = 29` + `MCPFuncType` -- core is current (AC1)
- `genie-ai-overlay/tests/test_core.py` -- bump count/value assertions to 30/29 -- name→int mapping guard (AC1)
- `genie-ai-overlay/core/genieai_api_protocol.py` -- re-graft field types to v1.5 Pydantic -- imports on v1.5 (AC1)
- `genie-ai-overlay/build-patches/docarray_alias_shim.py` -- sys.modules pin shim -- kill rename hack (AC3)
- `genie-ai-overlay/build-patches/install_site_startup.sh` -- .pth installer at build-derived path -- version-stable sitecustomize (AC2)
- `genie-ai-overlay/OVERRIDES.yaml` + `build-patches/lint_overrides.py` -- manifest + lint -- override audit (AC1)
- Dockerfiles (6 sitecustomize + 3 docarray) -- wire installer + shim -- no hardcoded paths / no vendored mutation (AC2, AC3)
- `tests/test_core_v15_compat.py` (or one-shot verify) -- import overlay core against v1.5 vendored api_protocol+constants -- imports on v1.5 (AC1)

**Acceptance Criteria:**
- Given the v1.5 constants enum, when `core/constants.py` is regenerated verbatim with `TRANSLATOR = 29` appended at the tail, then `test_core.py` asserts `TRANSLATOR.value == 29`, `len(ServiceType) == 30`, sequential ints 0–29, and every v1.5 member present.
- Given v1.5 `proto/api_protocol.py`, when `core/genieai_api_protocol.py` is imported against it, then all subclassed symbols resolve and the mirrored `k`/`fetch_k`/`lambda_mult`/`score_threshold` types align to v1.5 Pydantic.
- Given `OVERRIDES.yaml`, when `lint_overrides.py` runs, then it exits 0 (every core override carries override/disposition/owner/ticket; disposition ∈ {still-needed, re-graft-to-new-API, obsolete-remove}).
- Given the 6 Dockerfiles, when the sitecustomize hook is installed via a `.pth` entry at a build-derived `site.getsitepackages()[0]` path, then no hardcoded `python3.10`/`python3.11` path remains and `OPEA_SSL_SKIP_VERIFY=1` still bypasses SSL.
- Given the retriever/reranker/dataprep Dockerfiles, when the docarray `sys.modules` shim is installed instead of the `mv`+`sed` rename, then no `mv …opea_docarray.py` / `sed …opea_docarray` remains, the vendored `docarray.py` is unmutated, and `from docarray import BaseDoc` inside `comps.cores.proto.docarray` resolves to the real package.
- Given the re-grafted core, when imported against v1.5's vendored `api_protocol`+`constants`, then imports succeed and all core files are committed (no module rebase assumes an uncommitted core version).

## Spec Change Log

_None yet._

## Review Triage Log

### 2026-08-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10 (high 2, medium 4, low 4)
- defer: 3 (medium 1, low 2)
- reject: 8 (low 8)
- addressed_findings:
  - `[high]` `[patch]` reranker microservice imported the removed `comps.cores.proto.opea_docarray` (rename gone) → reranker image would not start; import re-pointed to vendored `comps.cores.proto.docarray` under the shim.
  - `[high]` `[patch]` contract harness `import_docarray` asserted the OLD rename artifact; re-grafted to assert the shim pin (`real is not mod`), preserving red-without-shim / green-with-shim sensitivity.
  - `[medium]` `[patch]` protocol field-type tightening (PositiveInt/NonNegativeFloat) was untested; added boundary tests (k=0, negative k, negative lambda_mult/score_threshold) + re-pointed the four `# OVERRIDE …ChatCompletionRequest.{k,fetch_k,lambda_mult,score_threshold}` test claims to them.
  - `[medium]` `[patch]` name→int mapping not pinned to v1.5 values; added explicit value assertions for LANGUAGE_DETECTION=24 … ARB_POST_HEARING_ASSISTANT=28.
  - `[medium]` `[patch]` all OVERRIDES dispositions said `still-needed` despite re-expression against v1.5; flipped the five re-grafted items to `re-graft-to-new-API` and fixed two inaccurate `test:` claims.
  - `[low]` `[patch]` dead `comps.cores.proto.opea_docarray` mock in conftest removed.
  - `[low]` `[patch]` "manifest lints clean" was manual-only; added `tests/test_overrides_lint.py` automating the lint.
  - `[low]` `[patch]` lint silently dropped malformed lines; added an unparseable-line failure.
  - `[low]` `[patch]` `.pth` import failures are silent at runtime; added empty-site-packages guard + build-time hook import verification to install_site_startup.sh.
  - `[low]` `[patch]` stale "Installed as sitecustomize.py" docstring in genie_ssl_patch.py reworded to the .pth site-init hook.

Deferred: image tags stay v1.3 (story 2.2 owns OPEA_VERSION bump); pydantic-v2-in-image runtime (story 2.2 base migration); lint directionality / .pth runtime-load detection (story 2.7 verify:evidence).

## Design Notes

- **TRANSLATOR slot drift.** v1.3 slot 24 (`TRANSLATOR`) became `LANGUAGE_DETECTION` in v1.5. Enum ints serialize into traces/messages, so `test_core.py` (count + tail-value) is the regression guard against silent renumbering. Appending at the tail (29) is stable across future upstream additions.
- **Why the docarray shim works.** The 3 affected images put `comps/cores/proto` on PYTHONPATH (needed for `from api_protocol import *`), so the vendored `docarray.py` shadows the real `docarray` PyPI package → `from docarray import BaseDoc` inside it self-imports. The shim temporarily removes `*/cores/proto` from `sys.path`, imports the real package, pins `sys.modules["docarray"]`, and restores the path. Later `from docarray import …` finds the pinned real module — no circular import, no file mutation. chatqna lacks the proto dir on path, so it never had the collision and needs no shim.
- **`.pth`-based sitecustomize.** `.pth` `import` lines execute during `site` initialization — before the main script and before any `sitecustomize.py`. The installer derives the path from the running interpreter (`site.getsitepackages()[0]`), which is stable across Python 3.10/3.11/3.12 and across Ubuntu's dist-packages vs Debian's site-packages layout. The old `rm /usr/lib/python3.10/sitecustomize.py` (Ubuntu apport) becomes unnecessary because we no longer overwrite `sitecustomize.py`.
- **OVERRIDES.yaml schema.** Per architecture pattern 1: `override → disposition → owner → ticket`, plus a `# OVERRIDE <module>.<name> | disposition: … | reason: … | test: …` comment record for each entry. Disposition is one of the three challenged states; `obsolete-remove` is reserved for overrides deleted because v1.5 fixed them (none in this story).

## Verification

**Commands:**
- `cd genie-ai-overlay && python -m pytest tests/test_core.py -v` -- expected: green (count 30, TRANSLATOR 29)
- `python -m pytest tests/ -v` -- expected: full mocked suite green (no regressions)
- `python build-patches/lint_overrides.py` -- expected: exit 0
- One-shot v1.5 import compat: fetch v1.5 `constants.py` + `api_protocol.py` into a temp dir, import `core.constants` + `core.genieai_api_protocol` against them -- expected: imports succeed
- `grep -rn "python3.10\|python3.11" genie-ai-overlay/*/Dockerfile*` -- expected: no hardcoded sitecustomize paths remain
- `grep -rn "opea_docarray\|mv .*docarray.py" genie-ai-overlay/*/Dockerfile*` -- expected: no mv+sed remains
- `ruff check` + `ruff format --check` on changed files -- expected: clean

**Manual checks (if no CLI):**
- Dockerfile review: `install_site_startup.sh` wired in all 6; `docarray_alias_shim.py` wired in retriever/reranker/dataprep.
- `OVERRIDES.yaml` records every core-layer override (constants, protocol, docarray shim, sitecustomize mechanism).

## Auto Run Result

Status: done

**Summary:** Re-grafted the core overlay layer to OPEA v1.5 surfaces: regenerated `core/constants.py` from v1.5's enum (ServiceType 0–28 + `TRANSLATOR=29` re-appended, `MCPFuncType` added); re-grafted `core/genieai_api_protocol.py` field types to v1.5 Pydantic (`PositiveInt`/`NonNegativeFloat`); created `OVERRIDES.yaml` + `lint_overrides.py` (override-audit manifest); replaced the hardcoded `sitecustomize.py` installs with a `.pth`-based, build-derived site-packages hook (`install_site_startup.sh`); replaced the docarray `mv`+`sed` rename with a `sys.modules` pin (`docarray_alias_shim.py`) and re-grafted the reranker import + contract harness to the shim surface.

**Files changed:** `core/constants.py` (regenerated), `core/genieai_api_protocol.py` (re-grafted types), `core/model_cache.py` (comment), `tests/test_core.py` (30/29 assertions, v1.5 member values, MCPFuncType, protocol boundary tests), `tests/test_overrides_lint.py` (new), `tests/conftest.py` (dead mock removed), `build-patches/docarray_alias_shim.py` (new), `build-patches/install_site_startup.sh` (new), `build-patches/lint_overrides.py` (new), `OVERRIDES.yaml` (new, 7 entries), `reranker/genieai_reranking_microservice.py` (import fix), `contracts/_harness.py` (shim re-graft), `configs/ssl/genie_ssl_patch.py` (docstring), 6 Dockerfiles (installer + shim wiring).

**Review findings breakdown:** 10 patches applied (2 high, 4 medium, 4 low); 3 deferred (image tag bump / pydantic-in-image / lint+enforcement → stories 2.2, 2.7); 8 rejected (noise or out-of-scope).

**Follow-up review recommendation:** true — 2 high-severity patches this pass (score: 2 high → threshold met).

**Verification performed:**
- `pytest tests/` — 670 passed, exit 0
- `python build-patches/lint_overrides.py` — exit 0 (7 entries, all matched by source records)
- One-shot v1.5 import compat — `core.constants` (30 members, TRANSLATOR=29, MCPFuncType) + `core.genieai_api_protocol` subclassed against v1.5 `api_protocol`; `PositiveInt`/`NonNegativeFloat` enforced (k=0 rejected)
- docarray shim — real `docarray` pinned in `sys.modules`, exact `sys.path` order preserved; shim-on green / shim-off red sensitivity simulated
- grep guards — no hardcoded `python3.x` sitecustomize paths, no `mv docarray.py`/`opea_docarray` in any Dockerfile
- `ruff check` + `ruff format --check` — clean

**Residual risks:**
- No `docker build` run — Dockerfile wiring verified via grep + a venv-mirrored installer test; in-image `.pth` loading and shim behavior remain the only untested surface (story 2.2's in-image contract runs cover them).
- `k`/`fetch_k` now reject ≤ 0 and `lambda_mult`/`score_threshold` reject negatives (v1.5 mirror); boundary tests added; any client relying on `k=0` semantics must adapt.
- `TRANSLATOR` enum value changed 24→29 (v1.5 took slot 24); no hardcoded `24` found in overlay code.
