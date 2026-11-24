---
title: 'Story 4.6 — Release-readiness evidence (V09 + V07b)'
type: 'feature'
created: '2026-11-24'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3c27caf970443c990f6a7610fbfd6fe22240ac44'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1982 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 4's stories delivered the machinery (the harness, the E01/E02 layers, the coexistence criterion, the threshold registry) and Epics 1–3 delivered the agent path itself, but the two release-gate investigations the PRD names — **V09** (executable CI/integration coverage and runner availability confirmed, checks needing a separate environment identified, including the new CI surface) and **V07b** (the full license and redistribution assessment before any pilot/release use) — have no artifacts. Today a release-gate reader has no single record of which checks are CI-executable on the shared runner, which ones need an environment CI does not have, and whether every dependency, image, binary and model the delivered artifacts carry is licensed for redistribution with notices preserved and disclosures current. NFR-6 and FR-19 (two-tier licensing) are unproven sentences; and the PRD's honesty rule says a gap between a gate and the available evidence must surface as a blocker, never be absorbed silently.

**Approach:** Produce the two evidence artifacts in the established baseline-doc form (`docs/baselines/`), every state read off executed evidence or committed artifacts — never asserted. V09: confirm each check on the new CI surface (agent pytest suite, OPEA-free gate, e2e pins, harness/protocol suite, lint/scan lanes) by running locally what is locally executable, by recording the CI job definitions and a pipeline where each lane actually ran, and by naming every check that needs a separate environment with the config that proves it. V07b: assess the delivered artifacts' full redistribution surface — the agent-service compiled dependency tree (re-running the V07a verifier as the executable check), the harness eval tree (its pins are NOT covered by the existing V07a evidence — a gap this story closes at top level and surfaces for the floating transitives), the container image and its base, the vendored binaries/data, and the models on the agent path (granite, bge family, and the gemma translation leg whose terms are restricted) — then update the disclosure surfaces (`THIRD_PARTY.md`) so notices and attributions are current. Every gap found becomes a blocker row with an owner; nothing is massaged into a pass.

**Acceptance criteria (issue #1982, the contract):**
- **Given** the delivered artifacts, **when** V09 runs, **then** executable coverage and runner availability are confirmed, with checks needing a separate environment identified — including the new CI surface (agent pytest suite, OPEA-free gate, e2e pins) (NFR-6).
- **And** V07b completes the full license and redistribution assessment (transitive/optional dependencies, images, binaries, models; notices preserved; disclosures updated) before any pilot/release use (FR-19).
- **And** gaps between gates and available evidence are surfaced as blockers, never absorbed silently.

## Boundaries & Constraints

**Always:**
- Every artifact state is read off executed evidence or a committed artifact: a local run record (command + counts), a CI job definition with file:line, a historical pipeline that ran the lane, or an existing committed evidence file. A state that names no evidence is an OPEN check, and an OPEN check is written down as one.
- V07b licensing follows FR-19's rule: NOASSERTION/unread license text counts as **unverified**, never as an incompatibility finding; every verdict names its source (publisher SPDX expression or artifact license file + sha256, per the V07a checklist's method).
- Models inherit the strictest reading: a model whose terms restrict redistribution (gemma's Terms of Use) is recorded as restricted even when the runtime license stack around it is permissive — the pilot/release consequence is a blocker row owned by the licensing reviewer, not a footnote.
- Gaps carry owners. Each blocker row names its owner per the PRD's verification-backlog roles (CI + QA owners for V09, licensing reviewer for V07b, operator where a decision is required), and references an existing issue where one exists (e.g. #2145).
- The assessment covers the artifacts this initiative DELIVERED (agent-service, the rag-benchmarks harness/protocol package, the agent-server image, the vendored data, the models on the agent path) — the pre-existing legacy stack keeps its own disclosures and is not re-audited here.
- Disclosures are updated in place: `THIRD_PARTY.md` gains sections in its existing style; the dependency-evidence JSON grows by the same verifier that produced the V07a file — no hand-authored evidence rows.

**Never:**
- No production code changes: no service code, no CI YAML edits, no chart changes, no dependency version changes. The story's product is evidence artifacts, disclosures, and the story/sprint-status bookkeeping. (A red check is recorded as a blocker; fixing it is follow-up work, not this story.)
- No new Python/Node runtime dependencies introduced by this story; the only new manifest is a verifier-produced evidence JSON for the eval tree.
- No re-audit or re-run of the gated legs (E01 config-B, E02 B/C) — their refusals are M-2..M-5 operator decisions already recorded in `s4-exit-checklist.md`; this story references that state, it does not duplicate or reopen it.
- No absorbing a gap into a pass: "runs locally" is never written where the AC asks for CI coverage confirmation, and an unpinned transitive tree is never recorded as "assessed" at pin level it does not have.
- No edits under `eval/`, `components/**`, `charts/**`, `.gitlab-ci.yml`, `genie-ai-overlay/**` — read-only for evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| V07a verifier re-run on the shipped pins | `scripts/dependencies/verify-dependency-licenses.py --verify` against `docs/dependencies/agent-service-dependency-evidence.json` | exit 0; pins==evidence stays 1:1 (49 rows) | any mismatch: FAIL recorded verbatim in the V07b artifact as a blocker row |
| Verifier over the eval-tree pins | `--fetch` the 7 top-level pins of `tests/rag-benchmarks/eval/requirements.txt` into a NEW evidence JSON | evidence file written; verdict per pin (license + defaults audit fields per the checklist's gates) | NOASSERTION/UNKNOWN → recorded as unverified (never as incompatibility, FR-19); PyPI unreachable → the fetch is recorded as not executed, the gap as OPEN with owner |
| Executable CI check, local confirmation | the CI job's own script run on this tree (agent pytest suite, ruff, OPEA-free gate via config-validator, harness protocol tests) | green run recorded with command + counts → check state = executable-confirmed | red run: the failure is the blocker row (never a "known flaky" absorption); fix owned as follow-up |
| CI-only lane | check whose evidence exists only in CI (build/scan/promote) | job definition (file:line) + a historical pipeline ID where the lane ran, recorded as the confirmation | no pipeline found → state = defined-but-unexercised, surfaced as a gap |
| Environment-separated check | `E2E_ENABLED` gate, `tags: [gpu]`, schedule-only rules, the local-run policy | named with the config quote that proves the separation + the owner of the missing environment | a check needing a separate environment recorded as "confirmed" without naming the environment = forbidden (NFR-6) |
| Restricted-terms model on the agent path | gemma-3-4b-it serving the translation leg | recorded with its terms and the redistribution consequence; blocker row, licensing reviewer owns the acceptance | absorption into the permissive model family = forbidden |
| Unpinned transitive tree | `tests/rag-benchmarks/eval` transitives (langchain/openai/ragas trees) | top-level pins assessed; the floating transitives recorded as an OPEN supply-chain gap with owner | recording the tree as "assessed" beyond its pins = forbidden |

</frozen-after-approval>

## Code Map

**Reuse (do not reinvent):**
- `docs/baselines/s4-exit-checklist.md` -- the evidence-table form (check → evidence artifact → state) this story's artifacts follow; also the recorded S4 gate state (M-1 signed, M-2..M-5 absent, gated legs refusing) that the V09 artifact references instead of duplicating.
- `docs/dependencies/pre-adoption-checklist.md` -- the four V07a gates (exact-version license verification with sha256, defaults audit, release channel, product-license compatibility) that the V07b assessment applies at full scale; its tooling row names the verifier.
- `scripts/dependencies/verify-dependency-licenses.py` -- the executable license verifier (`--fetch` / `--verify` against `docs/dependencies/<component>-dependency-evidence.json`); produces the evidence rows this story must never hand-author.
- `docs/dependencies/agent-service-dependency-evidence.json` -- the existing 49-row evidence file (1:1 with the 54-pin compiled tree's union pins); `--verify` re-runs against it.
- `docs/baselines/choosing-models.md` (site copy: `site/content/en/docs/rag-pipeline/choosing-models.md`) -- the repo's model-license records (license-category table, per-model rows incl. Gemma Terms of Use at :113, granite/bge rows); the V07b model assessment cites these + the upstream model cards, it does not re-derive.
- `docs/e2e-tests/local-run.md` + `docs/adr/0001-gitlab-registry-build-scan-pipeline.md` -- the E2E suspension facts (no CI door, local run defines the executed set) the V09 artifact quotes for the environment-separated checks.

**Facts (not to re-derive):**
- `.gitlab-ci.yml` lanes on the new surface: `test:agent-service` (:2347, python:3.11-slim, pytest over `components/agent-service/tests/`, MR changes-gated on `components/agent-service/**/*`); `lint:agent-service` (:3864, ruff==0.16.3 pin at :19); `config:validate` (:5965) runs `tests/config-validator` whose `opea-free-gate.test.js` scans `scripts/ci/agent-path-packages.json` packages for `comps`/OPEA imports; `test:rag-benchmarks` (:4491, offline stdlib+pytest, 12 protocol tests + capture baseline); `build:`/`scan:`/`promote:agent-service` (:2274/:2297/:2321, tags: [docker]).
- The e2e suspension: train e2e jobs additionally require CI/CD variable `E2E_ENABLED == "1"` (exact string), unset — "no runner capacity for the compose stack + Playwright on the shared docker runner" (`.gitlab-ci.yml:4723-4729`); ADR 0001 (:99-105): "today code can reach `main` without any e2e signal"; restore = variable flip once an e2e runner lane exists. Story 2.9's pinned specs live at `tests/e2e/chatbot/sse-contract.spec.js` + `tests/e2e/helpers/stream-route.spec.js` (suite map `docs/e2e-tests/suite-map.md:75,139`).
- Environment-separated checks: `manual:rag-quality` `tags: [gpu]`, self-skips without `GPU_AVAILABLE` (:6377, :6387-6390); `scheduled:integration`/`scheduled:e2e-web` run on schedule pipelines only (:6327-6343); all e2e lanes serialize on `resource_group: e2e-runner`.
- agent-service dependency tree: `components/agent-service/requirements.txt` = compiled tree (uv pip compile, header :6-8), 54 exact pins, transitives pinned; `requirements-test.txt` = `-r requirements.txt` + httpx==0.28.1 + pytest==9.1.1; no uv.lock for agent-service (recompile drift possible between audits — recorded as a limitation, not fixed here).
- Eval tree: `tests/rag-benchmarks/eval/requirements.txt` (7 top-level pins: ragas==0.4.3, langchain-openai==1.6.7, langchain-community==0.4.2, langchain-core==1.6.6, openai==3.0.3→verify exact, httpx==0.28.1, openpyxl==3.1.5) — NOT covered by the V07a evidence file; transitives unpinned.
- Image: `components/agent-service/Dockerfile:7` single base `python:3.11-slim` (no digest pin); header carries `SPDX-License-Identifier: Apache-2.0`; useradd uid 10001; `preparation/` carries a vendored language registry (Dockerfile :30-34, requirements header :27-29); compose service under profile `[agent]` (`docker-compose.yaml:1471-1472`), image `genie-ai-agent-server` (default tag `latest`, no digest pin); NO agent-service in `charts/` (grep zero hits) — deploy surface is compose/Swarm only.
- Models on the agent path (repo records): LLM `ibm-granite/granite-4.1-8b` (Apache 2.0; vLLM 0.29.0, `--tool-call-parser granite4` — `v06-runtime-verification-2026-11-24.md:33`); embedding `BAAI/bge-large-en-v1.5` via TEI (MIT, `choosing-models.md:374`); reranker bge family (MIT, :374-376); translation `google/gemma-3-4b-it` (Gemma Terms of Use, :113 — the restricted-terms item); agent translation call `agent/orchestrator.py:286-288`.
- `THIRD_PARTY.md` (34.4K, 13 sections, last touched by story 1.3): discloses OPEA/vLLM/TEI/Docling/Transformers/ArangoDB/Redis/Node/Express/Vue + "OpenTelemetry Python (agent service)" (:609); pydantic/kneed/langdetect/python-arango/setuptools coverage thin; NO model entries at all; pytest (test tree) unlisted.
- V07a verdicts on record: D03 ADR `agentic-002` :63 "V07a passes: 47 exact pins verified with defaults verdicts; exit 0" (evidence file now 49 rows after story 2.11); selected runtime = custom minimal tool-calling loop (`agent/` seam), pydantic-ai/DSH rejected candidates carry no license verdict (never adopted — out of V07b scope, recorded as such).
- 7 agent-service pins ride the 0.48b0 OTel instrumentation line (non-stable) — each already carries a recorded risk acceptance in the evidence file.

## Tasks & Acceptance

**Execution:**
- [x] `docs/baselines/v09-ci-coverage-runner-availability-2026-11-24.md` (NEW) — the V09 evidence artifact: evidence table over the new CI surface (agent pytest suite, OPEA-free gate, e2e pins, harness/protocol suite, lint/build/scan/promote lanes), each row check → evidence → state; the environment-separated section (E2E lanes, GPU job, schedule lanes, local-run policy) with the config quotes; the gaps-as-blockers table with owners (issue #1982 AC 1). Every locally-executable check RUN on this tree first, results recorded with commands + counts.
- [x] `docs/baselines/v07b-license-assessment-2026-11-24.md` (NEW) — the V07b artifact over the delivered artifacts' redistribution surface: runtime tree (verifier re-run, verdict families, non-stable acceptances), eval tree (new evidence file + the floating-transitives gap), image + base, vendored binaries/data, models (incl. the gemma restricted-terms blocker row), notices-preserved state, disclosure deltas; FR-19 rule applied to every verdict (issue #1982 AC 2).
- [x] `docs/dependencies/rag-benchmarks-eval-dependency-evidence.json` (NEW, verifier-produced) — `--fetch` the eval tree's top-level pins so the assessment never hand-authors license rows.
- [x] `THIRD_PARTY.md` — add the model entries (granite / bge family / gemma with terms) + the agent-service Python pins and pytest coverage its sections lack, in the file's existing section style (issue #1982 AC 2 "disclosures updated").
- [x] `CHANGELOG.md` — `[Unreleased]` Added line pointing at the two baseline artifacts (deployer-facing: the release gate now has its evidence).
- [x] `_bmad-output/implementation-artifacts/stories/4-6-release-readiness-evidence-v09-v07b.md` + `_bmad-output/implementation-artifacts/sprint-status.yaml` — story to `in-review` / row `review` per the sync rule — BMAD bookkeeping (dispatch contract).

**Acceptance Criteria:**
- Given the delivered artifacts and the CI configuration, when the V09 artifact is read, then every check on the new CI surface carries a state (executable-confirmed / defined-but-unexercised / needs-separate-environment) with its evidence named, the environment-separated checks carry the config that proves the separation, and no release gate is left silently assuming unavailable CI (issue #1982 AC 1, NFR-6).
- Given the delivered artifacts, when the V07b artifact is read, then every redistribution surface (runtime + eval dependency trees, image + base, vendored data, models) carries a license verdict naming its source, notices-preserved is evidenced (sha256-bearing evidence file + disclosure sections), the gemma restricted-terms consequence is a blocker row owned by the licensing reviewer, and `THIRD_PARTY.md` names the models and the previously undisclosed pins (issue #1982 AC 2, FR-19).
- Given any gap found during either assessment, when the artifacts are read, then the gap appears as a blocker row with an owner and (where one exists) an issue reference — and no gap is recorded as a pass, a footnote, or an assumption (issue #1982 AC 3).

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

### 2026-11-24 — execution record (implementer)

- Local runs executed on this tree (`3c27caf97`), Python 3.11.18 venvs, ruff 0.16.3 (exact CI pin), Node v24.22.3:
  - agent-service `pytest tests/ -q`: **883 passed** (== CI job 389337 trace);
  - `ruff check` + `ruff format --check` (CI scope): **clean**, "87 files already formatted" (== CI job 389319 trace);
  - `tests/config-validator` `npm test`: **679 passed / 36 skipped** (skips are the docker/compose/jinja2 render suites a bare checkout cannot run; CI job 389356 ran them: `Tests: 715 passed, 715 total`); `opea-free-gate.test.js` alone: **15 passed**;
  - rag-benchmarks: eval **215 passed**, capture+12 protocol files **437 passed** (== CI job 389346 traces 215/24/413);
  - verifier `--verify` (agent-service, 2 trees → 49-row evidence): **exit 0**; `--fetch` + `--verify` (eval tree): **exit 0**, 7 rows.
- Historical CI confirmation: **pipeline 19349** (MR !938 pipeline at `3c27caf9`, 2026-11-24, success) carried every lane this story covers — jobs 389337 (test:agent-service), 389319 (lint:agent-service), 389356 (config:validate), 389346 (test:rag-benchmarks), 389364/389383/389414 (build/scan/promote:agent-service).
- Facts checked against the tree, corrections vs the story's Code Map: `openai` eval pin is **3.3.0** (the story's "3.0.3→verify exact" resolved to 3.3.0 in the file); `choosing-models.md` lives ONLY at the site copy `site/content/en/docs/rag-pipeline/choosing-models.md` (no `docs/baselines/` copy — the site path is what the artifacts cite); `THIRD_PARTY.md` already carried pytest 9.1.1 + Pydantic + an "Agent service dependency tree" section (the story's "pytest unlisted" was stale — the remaining deltas were the models + kneed/python-arango/setuptools/numpy/scipy + the stale langdetect `^0.2.1` → corrected to the pinned 1.0.9).
- New blocker rows: ragas telemetry/cloud-export default-ON (knob `RAGAS_DO_NOT_TRACK=true`), eval-tree floating transitives, image base without digest pin, `test:rag-benchmarks` floating before_script install (`.gitlab-ci.yml:4501`), gemma restricted terms (licensing reviewer owns). No issue filed from here — the rows carry owners; filing is the orchestrator's call.
- `/tmp` scratch (sdist telemetry greps) cleaned up after the run.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: all green (the CI `test:agent-service` script, executed locally for the V09 record)
- `cd components/agent-service && ruff check . && ruff format --check .` (ruff==0.16.3) -- expected: clean
- `cd tests/config-validator && npm test` -- expected: OPEA-free gate green (the `config:validate` lane's own suite)
- `cd tests/rag-benchmarks && pytest eval -q` + the 12 protocol test files -- expected: green (the `test:rag-benchmarks` script)
- `python3 scripts/dependencies/verify-dependency-licenses.py --verify --evidence docs/dependencies/agent-service-dependency-evidence.json ...` (exact CLI per its `--help`) -- expected: exit 0, pins==evidence 1:1
- `python3 scripts/dependencies/verify-dependency-licenses.py --fetch ...` for the eval tree -- expected: evidence JSON written with a verdict per pin
