# V09 — CI coverage and runner availability (the agentic path's new CI surface)

- **Artifact:** `v09-ci-coverage-runner-availability-2026-11-24`
- **Gate:** release-gate investigation V09 (PRD agentic-foundations, NFR-6): "executable CI/integration coverage and runner availability confirmed, checks needing a separate environment identified — including the new CI surface (agent pytest suite, OPEA-free gate, e2e pins)". Recorded before any pilot/release use of the delivered artifacts.
- **Form:** the sibling of `docs/baselines/s4-exit-checklist.md` — the same evidence table (check → evidence artifact → state). Every state below is read off executed evidence (a local run record with command + counts, or a CI job with its pipeline and trace) or a committed artifact (the job definition at file:line). A state that names no evidence is an OPEN check, and an OPEN check is written down as one.
- **Baseline:** branch `feat/agentic-foundations/4-6-release-readiness-evidence-v09-v07b` at `3c27caf97` (the tip of `feat/agentic-foundations/prd` this story starts from). Local runs executed 2026-11-24.
- **Scope:** the CI surface this initiative ADDED (Epic 1–4: the agent-service lanes, the OPEA-free gate inside `config:validate`, the harness/protocol suite, the pinned e2e specs) plus the runner-availability facts that gate them. The pre-existing legacy lanes (backend/frontend jest, the OPEA overlay suites, the chart gates) are not re-audited here.

## The executed record (local confirmation, 2026-11-24)

Every locally-executable check below was RUN on this tree before its state was
written. Environment: the worktree at `3c27caf97`, Python 3.11.18 (a `uv`
venv per component, matching the CI images' 3.11 line), ruff 0.16.3 (the
exact CI pin, `.gitlab-ci.yml:19`), Node v24.22.3.

| # | Command (the CI job's own script) | Result |
|---|---|---|
| R1 | `cd components/agent-service && uv venv --python 3.11 .venv && uv pip install -r requirements-test.txt && .venv/bin/python -m pytest tests/ -q` | **883 passed**, 2 warnings, 6.63s |
| R2 | `cd components/agent-service && ruff check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/ && ruff format --check <same scope>` | **No issues found**; **87 files already formatted** |
| R3 | `cd tests/config-validator && npm ci && npm test` | **20 suites passed** (1 skipped), **679 passed / 36 skipped** — see the state row for what the local skip delta means |
| R3a | `cd tests/config-validator && npx jest __tests__/opea-free-gate.test.js` | **15 passed** (the OPEA-free gate alone) |
| R4 | `cd tests/rag-benchmarks && .venv/bin/python -m pytest eval -q` | **215 passed**, 1.54s |
| R4a | `cd tests/rag-benchmarks && .venv/bin/python -m pytest test_capture_baseline.py test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py test_protocol_reuse.py test_protocol_drivers.py test_protocol_security.py test_protocol_e01.py test_protocol_thresholds.py test_protocol_counter_metrics.py test_protocol_e02.py test_protocol_coexistence.py test_assessment_grade_set.py -q` | **437 passed** (capture 24 + protocol 413), 5.23s |

The historical CI confirmation is **pipeline 19349** (the MR !938 pipeline at
exactly this commit `3c27caf9`, 2026-11-24, status **success**): every lane
this story covers ran green in it — `test:agent-service` (job 389337, trace
`883 passed`), `lint:agent-service` (job 389319, trace `87 files already
formatted`), `config:validate` (job 389356, trace `Tests: 715 passed, 715
total`), `test:rag-benchmarks` (job 389346, traces `215 passed` / `24 passed`
/ `413 passed`), `build:agent-service` / `scan:agent-service` /
`promote:agent-service` (jobs 389364 / 389383 / 389414, all success). The
local and CI counts agree where both exist: R1 883 = CI 883; R4/R4a
215+24+413 = CI 215+24+413; R2 "87 files already formatted" = CI verbatim.
R3 differs by environment, not by verdict — see the `config:validate` row.

## Evidence table — the new CI surface

| Check | Evidence (definition + executed record) | State |
|---|---|---|
| Agent pytest suite | Definition: `test:agent-service`, `.gitlab-ci.yml:2347` — `python:3.11-slim`, installs the **audited test tree** (`components/agent-service/requirements-test.txt`, whose union the evidence file covers), runs `python -m pytest tests/ -q --junitxml=…`; MR changes-gated on `components/agent-service/**/*` + `.gitlab-ci.yml`. Executed: R1 (local, 883 passed) + CI job 389337 / pipeline 19349 (trace `883 passed`). | **executable-confirmed** (local + CI green on the same commit) |
| Agent lint lane | Definition: `lint:agent-service`, `.gitlab-ci.yml:3864` — `ruff==${RUFF_VERSION}` with `RUFF_VERSION: "0.16.3"` (`.gitlab-ci.yml:19`), `ruff check` + `ruff format --check` over `app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/`. Executed: R2 (local, clean) + CI job 389319 / pipeline 19349 (trace `87 files already formatted`). | **executable-confirmed** (local + CI green on the same commit) |
| OPEA-free gate (AD-1 structural gate) | Definition: rides the `config:validate` job (`.gitlab-ci.yml:5965`, `npm test` over `tests/config-validator`); the gate is `tests/config-validator/__tests__/opea-free-gate.test.js` over the manifest `scripts/ci/agent-path-packages.json` (every package under `components/` classified; `comps`/OPEA-import and build-time-source scan; the gate also asserts the job fires when an agent-path package changes). Executed: R3a (local, 15 passed) + R3 + CI job 389356 / pipeline 19349 (`Tests: 715 passed, 715 total`). The local-vs-CI delta is environment, not verdict: CI installs bash/git/docker-cli + compose + py3-jinja2/py3-yaml (the job's `before_script`), so the ROCm render suites that SKIP on a bare dev checkout (36 locally) run in CI. | **executable-confirmed** (local green over the gate's own suite; CI green over the full suite including the locally-skipped renders) |
| Harness/protocol suite (Epic 4) | Definition: `test:rag-benchmarks`, `.gitlab-ci.yml:4491` — offline, three pytest invocations (`tests/rag-benchmarks/eval`, `test_capture_baseline.py`, the twelve protocol files `test_protocol_evalset.py … test_assessment_grade_set.py`); MR changes-gated on `tests/rag-benchmarks/**/*`, the two graded-set artifact trees, the e2e fixture, `genie-ai-overlay/core/label_contract.py`, `.gitlab-ci.yml`. Executed: R4 + R4a (local, 215 + 437 passed) + CI job 389346 / pipeline 19349 (215 / 24 / 413). **One red flag on the lane itself, not the tests:** its `before_script` installs `pytest openpyxl pydantic requests pyyaml` as FLOATING pins (`.gitlab-ci.yml:4501`) — `docs/dependencies/pre-adoption-checklist.md` ("The CI lanes must install the audited tree, not a floating pin list") is violated by the lane's own install line; the test code is green, the packages it runs under are unaudited. Blocker B-1 below. | **executable-confirmed for the suites; the lane's install line is a recorded blocker** |
| Build / scan / promote lanes | Definitions: `build:agent-service` (`.gitlab-ci.yml:2274`), `scan:agent-service` (:2297, `needs: build`), `promote:agent-service` (:2321, `needs: scan`), all `tags: [docker]`, changes-gated on `components/agent-service/**/*` + `.gitlab-ci.yml` — no local equivalent exists (registry build + Trivy scan + digest promotion). Executed: CI-only — jobs 389364 / 389383 / 389414, pipeline 19349, all **success** (the pipeline also carries the SBOM artifact per ADR 0001 §4). | **executable-confirmed (CI record; no local run exists by design)** |
| The pinned e2e specs (SSE envelope + stream-route helper) | The pins: `tests/e2e/chatbot/sse-contract.spec.js` (stories 2.9 + 2.7: the agentic `agent_activity`/`agent_verdict` frames, the verdict truth table) and `tests/e2e/helpers/stream-route.spec.js` (the single-sourced envelope pinned frame by frame) — suite map `docs/e2e-tests/suite-map.md:75,139`. CI: **none**. The e2e stage has no CI door (ADR 0001): the train e2e jobs additionally require `E2E_ENABLED == "1"`, unset since 2026-11-03 — "today code can reach `main` without any e2e signal". The local run defines the executed set (`docs/e2e-tests/local-run.md`: "The Playwright suite has **no CI door** … the suite runs locally, regularly"). Not executed for this record: a local run needs a reachable venue + booked slot (the two locks + the orchestrator booking per `local-run.md`) — this evidence artifact does not fabricate one. | **needs-separate-environment** (venue + runner + booking; owner QA for run cadence, operator for the runner-lane decision) |

## The environment-separated checks (NFR-6's identification duty)

Each row names the config that PROVES the separation. A check recorded here is
not "confirmed" in CI — that is the point of the row.

| Check | Separating config (quoted) | What is missing | State |
|---|---|---|---|
| `e2e:integration` (compose stack from candidate images) | `.gitlab-ci.yml:5749`–:5756: every rule requires `'$E2E_ENABLED == "1" && $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"'`; `resource_group: e2e-runner` (:5752); `allow_failure: true`. Gate comment :4723–4729: "there is no runner capacity for the compose stack + Playwright on the shared docker runner … Unset (the default) keeps the e2e stage empty in every pipeline … re-enabling is a variable flip, not a YAML change." | the runner lane (compose-capable runner) + the `E2E_ENABLED=1` variable flip | **needs-separate-environment** — owner: operator (runner capacity decision; ADR 0001 §3 records the suspension) |
| `e2e:playwright` (web suite on merge trains) | `.gitlab-ci.yml:5764`, `needs: [e2e:integration]`, rules :5767–:5770 with the same `E2E_ENABLED == "1"` + merge-train condition, `resource_group: e2e-runner` (:5767). | same as above (inherits the unrun `e2e:integration`) | **needs-separate-environment** — same owner |
| `scheduled:integration` / `scheduled:e2e-web` | `.gitlab-ci.yml:6327` / :6337: rules are a single `if: $CI_PIPELINE_SOURCE == "schedule"`; both serialize on `resource_group: e2e-runner` (:6330, :6341); `scheduled:e2e-web` has `needs: [scheduled:integration]` (:6340). They are unaffected by the E2E_ENABLED gate (comment :4728–4729) — whether any schedule EXISTS on this instance is a project CI/CD setting, not a repo artifact; no schedule-defined record is cited here. | a defined schedule + the same runner capacity | **needs-separate-environment** — owner: operator |
| `manual:rag-quality` (GPU pytest marker) | `.gitlab-ci.yml:6370`: `tags: [gpu]` (:6377), `when: manual` on web pipelines, `allow_failure: true`, and the script **self-skips without the variable**: `if [ -z "$GPU_AVAILABLE" ]; then echo "No GPU detected — skipping RAG quality tests"; exit 0; fi` (:6387–6390). | a GPU runner + `GPU_AVAILABLE`; note the job is on the LEGACY overlay path (`genie-ai-overlay`, `pytest -m rag-quality`) — it is not an agentic-path check, it is named here because it is the only `tags: [gpu]` lane | **needs-separate-environment** (legacy-side; owner: operator / GPU-node owner) |
| Local e2e run (the executed e2e set) | `docs/e2e-tests/local-run.md`: the suite has no CI stage by operator decision (2026-11-10); the executed set is whatever `tests/e2e/run/run-local-e2e.sh` runs against a venue; the pinned agentic specs (`sse-contract.spec.js`, `helpers/stream-route.spec.js`) live in that set. | a reachable venue + the slot booking (the two locks + the orchestrator booking) | **the executed baseline** for the e2e surface — cadence owned by QA |

## Runner availability — what the shared runner serves

- The shared docker runner serves every lane in the evidence table above:
  availability for the new surface is CONFIRMED by pipeline 19349 (the
  executed record above), not asserted.
- What the runner does NOT have: compose-stack capacity for the e2e stage
  (the E2E_ENABLED suspension, quoted above) and a GPU lane for the
  agentic path (the only `tags: [gpu]` job is the legacy `manual:rag-quality`,
  which self-skips without `GPU_AVAILABLE`). Both are named, not absorbed:
  they are the "checks needing a separate environment" NFR-6 asks for.
- Chart lanes (`chart:lint` et al.) exist on this pipeline, but the
  agent-service is NOT in `charts/` (grep over `charts/` for `agent-service`:
  zero hits — the deploy surface of the delivered artifacts is
  compose/Swarm only, `docker-compose.yaml:1471`), so no chart check covers
  the agentic path and none is claimed here.

## Relation to the S4 exit state

The S4 gate state (M-1 signed, M-2..M-5 absent, the gated E01/E02 legs
refusing with `missing_thresholds`, #2145 gold annotations) is recorded in
`docs/baselines/s4-exit-checklist.md` and is referenced here, not duplicated:
V09 confirms the MACHINERY's CI coverage (the suites and lanes that carry
that machinery run green on the shared runner); the S4 exit itself stays
blocked on the operator decisions that document records. Nothing in this
artifact reopens or re-measures a gated leg.

## Gaps and blockers — nothing absorbed

| # | Gap | Consequence | Evidence | Owner | Where a decision lands |
|---|---|---|---|---|---|
| B-1 | `test:rag-benchmarks` installs its dependencies as floating pins (`pip install … pytest openpyxl pydantic requests pyyaml`, `.gitlab-ci.yml:4501`) instead of an audited, pinned requirements file | the lane runs its 800+ assertions on packages whose exact versions and licences the evidence files do not cover — a supply-driven change (a new pytest/pydantic release) alters the suite's runtime without any gate noticing; violates the pre-adoption checklist's lane rule | the job definition `.gitlab-ci.yml:4501` vs `docs/dependencies/pre-adoption-checklist.md` §"The CI lanes must install the audited tree" | CI owner | follow-up fix: a pinned `requirements.txt` for the lane + the evidence rows; the suites themselves stay green (R4/R4a + CI job 389346) |
| B-2 | The e2e stage (incl. the agentic SSE pins) has no CI execution: `E2E_ENABLED` unset, no runner capacity for the compose + Playwright stack | the agentic SSE contract's only executed proof is the local run; code can reach `main` with no e2e signal (ADR 0001 §3, quoted above) | `.gitlab-ci.yml:4723-4729`, :5752–:5770; ADR 0001 §3; `docs/e2e-tests/local-run.md` | operator (runner-lane decision, restore = the variable flip) + QA (local-run cadence) | the runner-capacity decision; restore per ADR 0001 |
| B-3 | The schedule lanes (`scheduled:integration` / `scheduled:e2e-web`) are schedule-only and no schedule definition is recorded in the repo | the "scheduled e2e keeps running" half of the E2E suspension depends on a project CI/CD setting this repo cannot evidence | `.gitlab-ci.yml:6327-6343` (the rules quote above) | operator | verify/define the schedule in project CI/CD settings |

No check in the tables above is recorded as green without its evidence; no
environment-separated check is recorded as "confirmed".
