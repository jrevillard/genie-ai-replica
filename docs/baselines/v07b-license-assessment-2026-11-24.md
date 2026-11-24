# V07b — License and redistribution assessment (the delivered agentic-path artifacts)

- **Artifact:** `v07b-license-assessment-2026-11-24`
- **Gate:** release-gate investigation V07b (PRD agentic-foundations, FR-19): the FULL license and redistribution assessment — transitive/optional dependencies, images, binaries, models; notices preserved; disclosures updated — completed **before any pilot/release use** of the delivered artifacts. V07a (the per-adoption tier) ran at every dependency adoption; this is the release-gate tier over the whole delivered surface.
- **Form:** the sibling of `docs/baselines/s4-exit-checklist.md` — every verdict below names its source (the publisher's SPDX expression for the exact version, or the artifact licence file + its sha256, per `docs/dependencies/pre-adoption-checklist.md` gate 1). FR-19's rule is applied to every verdict: a licence whose text could not be read (`NOASSERTION` / `UNKNOWN` / empty) is recorded as **unverified**, never as an incompatibility finding; an unpinned tree is recorded at the pin level it actually has, never as "assessed" beyond it. Models inherit the strictest reading: a model whose terms restrict redistribution is recorded as restricted, whatever the permissive stack around it.
- **Baseline:** branch `feat/agentic-foundations/4-6-release-readiness-evidence-v09-v07b` at `3c27caf97`; every executable check below was run on this tree, 2026-11-24.
- **Scope:** the artifacts this initiative DELIVERED — the agent-service and its compiled dependency tree, the rag-benchmarks harness/eval tree, the `genie-ai-agent-server` image and its base, the vendored data it carries, and the models on the agent path. The pre-existing legacy stack (OPEA overlay, the BFF/frontend/mobile) keeps its own disclosures in `THIRD_PARTY.md`, and the legacy model legs keep their licence records in `site/content/en/docs/rag-pipeline/choosing-models.md` — neither is re-audited here. The rejected D03 runtime candidates (pydantic-ai, DSH SDK — ADR `agentic-002`) were never adopted: they carry no licence verdict in this assessment by construction, and their absence from the shipped tree is the verdict.

## Method — the four gates, applied at full scale

The procedure is `docs/dependencies/pre-adoption-checklist.md`; the tooling is
`scripts/dependencies/verify-dependency-licenses.py` (`--fetch` writes the
evidence file; `--verify` is the offline gate). NO evidence row in either
evidence file is hand-authored: the licence, its source and the sha256 are
verifier output; the human verdicts are confined to the fields the checklist
assigns to a human (defaults audit, release channel, risk acceptance).

## Surface 1 — the agent-service compiled runtime tree

| Check | Evidence | Verdict / State |
|---|---|---|
| Exact-version licence verification (gate 1) | Executed 2026-11-24: `python3 scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt components/agent-service/requirements-test.txt --evidence docs/dependencies/agent-service-dependency-evidence.json` → **`OK 49 pinned package(s): licence verified, defaults audit recorded.`**, exit **0**. The tree is FULLY pinned (transitives included — `components/agent-service/requirements.txt:6-8`, `uv pip compile` output), so the audit covers exactly what ships. 49 evidence rows = 1:1 with the union pins of the runtime tree + the test tree. | **PASS — exit 0, pins==evidence 1:1 (49 rows)** |
| Verdict families | `docs/dependencies/agent-service-dependency-evidence.json` (verifier-produced): MIT 17, Apache-2.0 17, BSD-3-Clause 8, BSD-2-Clause 4, PSF-2.0 1, MPL-2.0 1, `Apache-2.0 OR BSD-2-Clause` 1 (dual-licensed, either term accepted). Every row names its source: a PyPI `license_expression`, a classifier, or the licence file read out of the exact artifact **with its sha256**. Zero `NOASSERTION` / `UNKNOWN` rows. | **all permissive-family; no copyleft in the compiled tree; notices preserved (sha256-bearing sources)** |
| Product-licence compatibility (gate 4) | The image header carries `SPDX-License-Identifier: Apache-2.0` (`components/agent-service/Dockerfile:2`); every dependency is Apache-2.0 / MIT / BSD / PSF / MPL-2.0. MPL-2.0 (file-level copyleft, 1 package) is compatible with an Apache-2.0 product claim — the file-level obligation does not reach the product. | **compatible** |
| Release channel (gate 3) | 42/49 rows `status: stable`. The 7 packages on the `0.48b0` OpenTelemetry instrumentation line (`opentelemetry-instrumentation`, `opentelemetry-instrumentation-asgi`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-httpx`, `opentelemetry-instrumentation-requests`, `opentelemetry-semantic-conventions`, `opentelemetry-util-http`) carry `status: beta (0.48b0)` + explicit risk acceptances dated 2026-11-19 (story 1.3) and 2026-11-22 (story 2.11): the exact version the OPEA overlay already ships, accepted for the tracing surface. | **non-stable rows carry their recorded acceptances (7 rows)** |
| Defaults audit (gate 2) | All 49 rows carry telemetry + cloud_export verdicts in the evidence file. | **recorded** |
| Recompile drift | There is no `uv.lock` for agent-service: the compiled `requirements.txt` is the artifact, and a regeneration (`uv pip compile`) against newer transitives can drift from the audited pins between audits. Recorded as a LIMITATION, not fixed here: the audit is only as current as the last `--verify` run against the committed file. | **limitation recorded** |
| Prior verdict on record | ADR `agentic-002` (`docs/adr/agentic-002-first-agent-runtime-d03.md:63`): "V07a passes: 47 exact pins verified with defaults verdicts; exit 0." The evidence file grew to 49 rows after story 2.11 (httpx promoted + its instrumentation rides); today's re-run keeps the verdict at exit 0 over 49. | **consistent** |

## Surface 2 — the rag-benchmarks eval tree (the V07a gap this story closes)

The harness's judge-stack pins (`tests/rag-benchmarks/eval/requirements.txt`)
were NOT covered by the V07a evidence file — the top-level gap this story
closes. The file pins SEVEN top-level packages; its transitives
(the langchain/openai/ragas trees) are NOT pinned.

| Check | Evidence | Verdict / State |
|---|---|---|
| Top-level pins, exact-version verification (gate 1) | Executed 2026-11-24: `python3 scripts/dependencies/verify-dependency-licenses.py --fetch tests/rag-benchmarks/eval/requirements.txt --out docs/dependencies/rag-benchmarks-eval-dependency-evidence.json` → 7 rows resolved, then `--verify tests/rag-benchmarks/eval/requirements.txt --evidence docs/dependencies/rag-benchmarks-eval-dependency-evidence.json` → **`OK 7 pinned package(s): licence verified, defaults audit recorded.`**, exit **0**. The pins (verified 2026-10-06 live per the requirements header): `ragas==0.4.3` (Apache-2.0, artifact sha256), `langchain-openai==1.6.7` (MIT, artifact sha256), `langchain-community==0.4.2` (MIT, pypi:info.license), `langchain-core==1.6.6` (MIT, artifact sha256), `openai==3.3.0` (Apache-2.0, artifact sha256), `httpx==0.28.1` (BSD-3-Clause, artifact sha256 — the same exact pin the runtime evidence already carries), `openpyxl==3.1.5` (MIT, artifact sha256). All 7 `status: stable`. | **PASS — 7/7 pins verified, evidence file committed, no hand-authored rows** |
| Defaults audit of the 7 pins (gate 2) | Verdicts in the new evidence file, sourced from greps over the published sdists of the exact versions (2026-11-24): **ragas 0.4.3 sends anonymous usage events to `https://t.explodinggradients.com` BY DEFAULT** (`src/ragas/_analytics.py`, `USAGE_TRACKING_URL`); the knob is `RAGAS_DO_NOT_TRACK=true` — named, not silently accepted (blocker B-3). langchain-core: LangSmith tracing/export only when `LANGCHAIN_TRACING_V2` is set (default off). langchain-community, langchain-openai, openai, openpyxl, httpx: no telemetry surface / no external contact of their own. | **recorded — one default-ON finding (ragas), knob named** |
| The floating transitives (langchain/openai/ragas trees) | The requirements file pins only the 7 top-level names; no `uv pip compile` was run for this tree (no compiled file exists under `tests/rag-benchmarks/eval/`). The transitive trees are therefore NOT assessed at pin level — FR-19 forbids recording them as "assessed". | **OPEN — blocker B-2 (supply-chain gap), owner: licensing reviewer** |
| Licence compatibility (gate 4) | 4×MIT + 2×Apache-2.0 + 1×BSD-3-Clause — compatible with the Apache-2.0 product claim. The tree is EVAL-ONLY (never installed into a runtime image; the harness runs it in a venv), so the redistribution surface is the repository itself, and notices ride `THIRD_PARTY.md`. | **compatible** |

## Surface 3 — the agent-server image and its base

| Check | Evidence | Verdict / State |
|---|---|---|
| Base image | `FROM python:3.11-slim AS runtime` (`components/agent-service/Dockerfile:7`) — the Debian slim base with CPython 3.11. Licence posture: Debian's OS layer (mostly GPL-2.0-family / permissive system libraries, distributed in binary form inside the image) + Python (PSF-2.0). The redistributable inventory of the OS layer is what the scan lane's SBOM covers, not a hand list. | **permitted redistribution under the respective licences; the binary inventory rides the scan SBOM (ADR 0001 §4: CycloneDX per image, retained 1 year)** |
| Base digest | The base is pinned by TAG only — **no digest pin** (`Dockerfile:7`); the tag moves upstream and the image content changes without a repo change (the monthly CACHE_BUST layer already formalizes OS-package refreshes). | **OPEN — blocker B-4 (release determinism: pin base by digest for pilot/release), owner: CI owner** |
| What rides in the image (binaries) | `pip install --no-cache-dir -r requirements.txt` (audited, Surface 1) + the repo modules (`app.py tracing.py capabilities/ preparation/ noagent/ agent/` — Dockerfile :35-39, the `preparation/` COPY at :37). No vendored binary, no model weights, no GPU stack. | **no unaudited binary payload** |
| Image distribution surface | `genie-ai-agent-server` in the GitLab Container Registry (built/scan­ned/promoted by the CI lanes — pipeline 19349, see the V09 artifact); compose/Swarm only, NO chart (grep over `charts/` for `agent-service`: zero hits), service block `docker-compose.yaml:1471` under profile `[agent]`, default tag `latest`, no digest pin on the compose side either. | **recorded; compose-side tag pinning is part of blocker B-4's scope** |

## Surface 4 — vendored data

| Check | Evidence | Verdict / State |
|---|---|---|
| `components/agent-service/preparation/language-registry.json` | Repo-authored data (introduced by story 1.8, commit `c96289806`; one canonical registry shared with the backend maps since `b6f131843`): ISO 639 codes, language names and ISO 15924 scripts — factual identifier data authored in this repository, no third-party licence text involved. Carried into the image beside the preparation module (Dockerfile :37). | **repo-authored; no third-party terms; no attribution owed** |
| Other vendored content | None: the Dockerfile copies only repo modules + the registry file; no font, no binary blob, no third-party data file rides the image. | **none** |

## Surface 5 — the models on the agent path

Model records cite the repo's own licence records
(`site/content/en/docs/rag-pipeline/choosing-models.md`) plus the upstream
model cards; this assessment does not re-derive them.

| Model | Role on the agent path | Licence (source) | Verdict |
|---|---|---|---|
| `ibm-granite/granite-4.1-8b` | the loop LLM (served: vLLM 0.29.0, `--tool-call-parser granite4` — served values in `docs/baselines/v06-runtime-verification-2026-11-24.md:27-33`) | Apache 2.0 — the upstream model card declares Apache 2.0 for granite-4.1-8b (https://huggingface.co/ibm-granite/granite-4.1-8b); the repo's model table records the licence for the Granite 3.3 rows only (`choosing-models.md:114-115` — no granite-4.1 licence row exists there; the family verdict is consistent with it) | **redistributable, permissive — no restriction** |
| `BAAI/bge-large-en-v1.5` | embedding (TEI default, `docker-compose.yaml:2220,2264`; vLLM variant :2356) | MIT (`choosing-models.md:374`) | **redistributable, permissive** |
| `BAAI/bge-reranker-v2-m3` | reranker (TEI default, `docker-compose.yaml:2300`) | MIT (`choosing-models.md:376` for the bge family; :437 the reranker row) | **redistributable, permissive** |
| `google/gemma-3-4b-it` | the translation leg — the model `VLLM_TRANSLATION_MODEL_ID` defaults to (compose :831/:1566/:2105, `env:152`); the agent loop's query preparation reads the same variable (`components/agent-service/preparation/config.py:121`) and its translation leg is the orchestrator's budgeted auxiliary call (`components/agent-service/agent/orchestrator.py:286-288`) | **Gemma Terms of Use** (`choosing-models.md:113` for the model row; :31 the licence table: "Yes / Yes / Yes — **>700M monthly users must request permission**") | **RESTRICTED — blocker B-1** (owner: licensing reviewer; the terms, the consequence and the acceptance decision live in the blockers table below) |

No other model rides the agent path (the legacy model legs keep their own
records).

## Disclosures updated (notices preserved)

`THIRD_PARTY.md` gains, in its existing section style:

- a new **AI Models** section — `ibm-granite/granite-4.1-8b` (Apache 2.0),
  the BAAI bge family defaults (MIT), and `google/gemma-3-4b-it` with its
  Gemma Terms of Use and the restricted-terms consequence — plus its
  Table-of-Contents entry;
- Python Libraries entries the file lacked: `kneed` 0.9.0 (BSD-3-Clause),
  `python-arango` 8.3.7 (MIT), `setuptools` 81.0.0 (MIT), `numpy` 1.26.4 and
  `scipy` 1.17.1 (BSD-2-Clause) — each citing the evidence file;
- the stale `langdetect` entry corrected to the pinned `1.0.9` (the file
  said `^0.2.1`);
- the eval-tree disclosure (the rag-benchmarks judge-stack pins + their new
  evidence file).

Licence Summary updated: the models' licences join the permissive list, and
Gemma is called out under non-open-source/custom terms.

The notices-preserved evidence chain: every third-party licence this story
assesses is preserved by pointer + hash — the per-package SPDX/artifact
sources with sha256 live in the two committed evidence files
(`docs/dependencies/agent-service-dependency-evidence.json`,
`docs/dependencies/rag-benchmarks-eval-dependency-evidence.json`), and the
user-facing attribution lives in `THIRD_PARTY.md`.

## Gaps and blockers — nothing absorbed

| # | Gap | Consequence | Evidence | Owner | Reference |
|---|---|---|---|---|---|
| B-1 | `google/gemma-3-4b-it` (the translation leg) ships under the Gemma Terms of Use — a restricted-terms model | any pilot/release serving the translation leg must carry the terms acceptance, and any >700M-MAU rollout needs a direct Google licence; redistribution of the model itself is subject to Google's conditions | `choosing-models.md:31,113`; compose :2105; `preparation/config.py:121`; `agent/orchestrator.py:286-288` | **licensing reviewer** (owns the acceptance) | disclosure added to `THIRD_PARTY.md` §AI Models |
| B-2 | The eval tree's transitive trees (langchain / openai / ragas) are unpinned | the assessment covers the 7 top-level pins ONLY; the floating transitives are an unassessed supply-chain surface — a transitive bump can change the licence/telemetry posture without a gate noticing | `tests/rag-benchmarks/eval/requirements.txt` (7 pins, no compiled lock); the new evidence file covers exactly those 7 | **licensing reviewer** (with the QA owner executing the `uv pip compile`) | FR-19: recorded as unassessed, never as "assessed" |
| B-3 | ragas 0.4.3 exports usage events off-host by default (`https://t.explodinggradients.com`) | on a sovereign/offline venue the export must be OFF by config (`RAGAS_DO_NOT_TRACK=true`), named per the pre-adoption checklist gate 2 — adopting the default silently is what this row prevents | `src/ragas/_analytics.py` (USAGE_TRACKING_URL, the `RAGAS_DO_NOT_TRACK` read); the verdict in the new evidence file | QA owner (+ operator where a venue decision is needed) | knob named in the evidence row and here |
| B-4 | The image base `python:3.11-slim` and the compose image tag carry no digest pin | the deployed bytes can move without any repo change — release-gate determinism for a pilot needs digest pinning on `Dockerfile:7` and the compose service | `components/agent-service/Dockerfile:7`; `docker-compose.yaml:1471` (profile `[agent]`, default tag `latest`) | CI owner | ADR 0001's build/scan/promote lanes are the place the digest lands |
| B-5 | The eval-tree evidence file rides NO repository gate: nothing reads `docs/dependencies/rag-benchmarks-eval-dependency-evidence.json` (`agent-service.test.js:23` reads only the agent-service file) and `config:validate`'s changes list has no `tests/rag-benchmarks/**/*` glob | a pin bump in `tests/rag-benchmarks/eval/requirements.txt` triggers `test:rag-benchmarks` but never the only job that could host a licence gate — the checklist's step 5 ("wire the check into the repository gate, so a later bump cannot skip it") is unmet for the file this story created; the eval tree's licence guarantee silently decays | `tests/config-validator/__tests__/agent-service.test.js:23`; `.gitlab-ci.yml:6105` (the changes list); `docs/dependencies/pre-adoption-checklist.md` step 5 | **CI owner** | fix: extend the gate to the eval evidence file + one changes glob |
| — | agent-service has no `uv.lock` (recompile drift between audits) | recorded as a LIMITATION, not a blocker — and a CONTAINED one: the drift is not silent. `config:validate` fires on `components/agent-service/**/*` and `agent-service.test.js` asserts every pin in the requirements trees carries a matching evidence row, so a regeneration that drifts turns the pipeline red until the evidence is re-fetched — the audit cannot silently go stale | `components/agent-service/requirements.txt:6-8`; `tests/config-validator/__tests__/agent-service.test.js:230-240` (the pins-union check) | — | limitation noted, not fixed in this story |

## What this assessment does NOT do

- No re-audit or re-run of the gated E01/E02 legs — their refusals are the
  recorded operator decisions in `docs/baselines/s4-exit-checklist.md`.
- No legacy-stack re-audit — `THIRD_PARTY.md`'s existing sections stand.
- No fix for any blocker above — this story records evidence; the fixes are
  follow-up work with named owners.
