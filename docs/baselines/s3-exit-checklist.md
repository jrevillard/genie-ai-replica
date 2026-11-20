# S3 Exit Checklist — the OPEA-free capability layer (Epic 1)

- **Artifact:** `s3-exit-checklist`
- **Gate:** stage S3 exit (PRD agentic-foundations) — evidence check, not a status report: every check below names the artifact that evidences it, and walking the checklist never leaves the epic's artifacts.
- **Rule (epic):** "S3 exit needs V02/V04/V05 evidence recorded"; V05 precedes the S3 compatibility gate. A check without its evidence recorded is an OPEN check — the stage does not exit.

## Check 1 — Contract (the port's declared behavior)

| Evidence | Artifact | State |
|---|---|---|
| The behavioral record (V02): the deployed query-path semantics, as measured on the venue | `docs/baselines/v02-opea-query-path-contract.md` + `v02-opea-query-path-contract.fixtures.json` (14 behavior blocks + the preparation block, knobs, discrepancies, known gaps) | Recorded (story 1.1) |
| The contract declaration: operations, outcome taxonomy, provenance, limits, versioning rules | `components/agent-service/capabilities/contract.py` (`CONTRACT_VERSION = "1.0"`, `OPERATION_SPECS`, `COMPATIBILITY`) | Accepted (story 1.5) |
| The contract suite: the declaration's own tests | `components/agent-service/tests/test_contract.py`, `test_identifiers.py` | Green (`pytest tests/`) |
| **Continuously-proven equivalence** (story 1.9): every recorded behavior asserted against the implementation, the fixture structure integrity-checked, the four deliberate deviations pinned | `components/agent-service/tests/test_equivalence_v02.py` (the data-driven suite over the V02 fixtures) | Green — runs in CI (`test:agent-service`), no live venue |
| Per-stage implemented behavior: retrieval semantics, reranking strategies + failure modes, query instruction, preparation pipeline | `tests/test_retrieval_semantics.py`, `test_reranking_strategies.py`, `test_query_instruction.py`, `test_preparation_*.py`, `test_search_knowledge.py`, `test_adapters_*.py` | Green |
| Config-B equivalence runway (the E01 driver exists and is behavior-frozen to the deployed prompt surface) | `components/agent-service/noagent/` (pipeline, generation, prompt, lane, config) + `tests/test_noagent_*.py`; the prompt strings byte-identical to the deployed module (pinned in `test_noagent_prompt.py` + re-derived from the deployed source) | Recorded (story 1.9) |

## Check 2 — Authorization (enforcement and ownership)

| Evidence | Artifact | State |
|---|---|---|
| The authorization / provenance / ownership map (V04) | `docs/baselines/v04-authorization-provenance-ownership-map.md` | Recorded, reviewed at contract acceptance (story 1.5) — a divergence reopens the placement (AD-3) and enforcement (AD-4) decisions, not just the stories |
| The executor: enforcement by construction (fail-closed resolution, re-validation of every target, per-request identity, the legacy-corpus AD-4 mapping) | `components/agent-service/capabilities/executor.py` + `tests/test_executor.py` | Green |
| The capability's own guard (empty authorized set refused, graph names charset-validated) | `capabilities/search_knowledge.py` + `tests/test_search_knowledge.py` | Green |
| Trusted caller context: structured fields only, no search-expression compression, the mapping stays inside the authorized set | `capabilities/contract.py` (`CallerContext` validator) + `tests/test_contract.py` | Green |
| Stable-id conventions (legacy `file_id` without marker; OKF trio + `okf-concept` marker) | `capabilities/contract.py` provenance types + `tests/test_equivalence_v02.py::test_provenance_attach_ported_layer_carries_the_contract_identity` | Green |

## Check 3 — Compatibility (the client contract inventory)

| Evidence | Artifact | State |
|---|---|---|
| The live API/SSE/error contract inventory (V05): routes, frame types, metadata payload, envelope, error shapes — read from code with file:line references | `docs/baselines/v05-client-contract-inventory.md` | Recorded (story 1.9) — PRECEDES this gate |
| The five-type SSE list reconciled against the inventory (AD-8) | `v05-client-contract-inventory.md` §8 | Reconciled: exactly `chunk`/`metadata`/`translation`/`done`/`error` on the wire today |
| The inventory's uncovered surfaces, each a numbered work item | `v05-client-contract-inventory.md` §9 (5 items) | OPEN — each must be dispositioned (fixed or accepted with a named owner) before the S3 exit is signed |
| BFF regression coverage of the recorded surface | the coverage map, `v05-client-contract-inventory.md` §7 (`query-routes.test.js`, `query-service.test.js`, `query-service-fanout.test.js`, frontend `chatbotService.test.js`, `tests/e2e/chatbot/*.spec.js`) | Green in CI (jest suites); e2e set runs locally (`tests/e2e/run/run-local-e2e.sh` — no CI door, operator decision 2026-11-10) |
| No BFF/frontend behavior change in the epic | the epic's diff scope — `git diff origin/feat/agentic-foundations/prd --stat` names only `components/agent-service/**`, `.gitlab-ci.yml`, `docs/baselines/**`, the story artifacts | Verified per story |

## Check 4 — Deployed-stack evidence (context for E01)

| Evidence | Artifact | State |
|---|---|---|
| The deployed baseline (V03): versions, digests, models, topology | `docs/baselines/v03-deployed-baseline-2026-11-19.md` | Recorded (story 1.2) |
| The service exists, deployable and switchable | `components/agent-service/` (app, Dockerfile, compose wiring) + `tests/test_app.py` | Green |

## The CI gates that keep the checks continuously green

| Gate | Job | What it proves |
|---|---|---|
| agent-service pytest suite | `test:agent-service` (`.gitlab-ci.yml`) | the contract, port, preparation and noagent suites — including the V02 equivalence suite |
| agent-service ruff | `lint:agent-service` — covers `noagent/` since story 1.9 | style/lint on the whole component |
| OPEA-free structural gate | `config:validate` (the `tests/config-validator` tree-walking gate) | no `comps` import, no OPEA build-time download in any agent-path package (proven red once on a scratch branch, story 1.4) |
| BFF + frontend jest suites | `test:*` lanes | the V05 §7 coverage map stays green |

## Exit condition

S3 exits when checks 1–3 are fully green with their evidence recorded (V02 ✓, V04 ✓, V05 ✓, suites green, CI lanes green) AND the V05 §9 work items each carry a disposition. Check 4 is context, not a blocker.
