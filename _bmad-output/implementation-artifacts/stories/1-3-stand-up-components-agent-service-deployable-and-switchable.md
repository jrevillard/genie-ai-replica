---
title: 'Story 1.3 — Stand up components/agent-service, deployable and switchable'
type: 'feature'
created: '2026-11-19'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '017e9f2a02ab03eed660e4f1f09c46fc883c0529'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 needs an agentic service, and none exists: no service skeleton, no deployment wiring, no switch. Every later story (capability tools, query path, wiring into the BFF) needs a service that is already deployable, observable and switchable — and that ships DARK, so nothing agentic is reachable before the flag is turned on.

**Approach:** Stand up `components/agent-service` (Python 3.11, FastAPI, internal-only) on the `pii-service` precedent — a single-file app, a comps-free port of the OTel tracing module, pinned requirements, a non-root Dockerfile — and wire it into Compose, the GitLab CI build/scan/promote triplet (+ lint + test lanes), the Ansible `genieai_images` list, the `env` template and the config-validator. One deployment flag, `AGENT_ENABLED` (default `0`), gates the service through the Compose `deploy.replicas` gate.

## Boundaries & Constraints

**Always:**
- Internal-only: no host port, no Kong route, no BFF wiring in this story.
- Ships dark: `AGENT_ENABLED` defaults to `0` → zero replicas, no host port, no route → nothing agentic reachable.
- `#1227` no-root contract: `cap_drop: ALL` + `no-new-privileges` + a non-root `user:` pinned in Compose.
- The ported tracing module imports nothing from the `comps` package (FR-20).
- Every dependency this story introduces (the FastAPI tree) passes the pre-adoption checklist — exact-version license verification (V07a) + defaults audit (NFR-2) — before acceptance. `NOASSERTION` counts as unverified and blocks. The checklist is a reusable artifact for every later dependency-introducing story.
- All artefacts (code, comments, docs, changelog) in English.

**Never:**
- No agent capability code (tools, planner, query path, RAG/LLM calls) — later stories.
- No Helm chart change: chart adoption is operator-owned (AR-10). The Compose service is declared `unpaired` in the parity allowlist with that reason.
- No CI execution of the e2e suite or the venue-capture suite (operator ruling) — a static repository check is allowed and required here.
- No change to the existing `pii-service`, `ragas-service` or `okf-server` behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SERVICE_LIVE | `AGENT_ENABLED=1` | container runs non-root; `GET /health` → 200 `{"status":"ok"}`; `GET /ready` → 200 | uvicorn cannot bind → container exits non-zero; Swarm restarts (max_attempts 10) |
| SERVICE_PARKED | `AGENT_ENABLED` unset/`0` | Compose block declares no host port; `deploy.replicas` resolves to 0 → no task, nothing reachable | n/a |
| TRACE_ON | `ENABLE_OBSERVABILITY=1`, collector reachable | a span is exported per served request; PII-keyed attributes redacted | collector unreachable → spans dropped, the app keeps serving |
| TRACE_OFF | `ENABLE_OBSERVABILITY` unset/`0` | `setup_tracing` is a no-op — no exporter, no outbound call | n/a |
| DEP_AUDIT | `components/agent-service/requirements.txt` pins | every pinned `name==version` has a non-`NOASSERTION` license with its source + a defaults-audit row | any missing/`NOASSERTION` row → checklist fails, acceptance blocked |

</frozen-after-approval>

## Code Map

- `components/pii-service/{app.py,Dockerfile,requirements.txt,pyproject.toml,.dockerignore}` — the precedent shape (non-root uid 10001, bustable `ARG CACHE_BUST` apt layer, `HEALTHCHECK` on `/ready`, ruff config). Copy the shape; do not import from it.
- `genie-ai-overlay/tracing.py` — the porting source for the tracing module. Keep the public API (`setup_tracing`, `get_tracer`, `with_span`, `background_span`, `RedactingSpanProcessor`, `shutdown`); DROP the two `comps` hooks (`MicroService` init, `HTTPService` access-log installer).
- `docker-compose.yaml` — the `pii-service` block (l. 1279-1325) is the block template; the `x-logging` fluentd anchor is l. 89-97.
- `.gitlab-ci.yml` — `.build_template` / `.scan_template` / `.promote_template`; the `pii-service` lanes (l. 2157-2250) are the lane template; `lint:okf-server` (l. 3731) is the component-lint template (`extends: .lint_component`).
- `deploy/ansible/tasks/deploy-shared-facts.yml` l. 39-59 — `genieai_images` (18 entries) → add `genie-ai-agent-server` (19).
- `deploy/ansible/templates/env.j2` l. 795-814 — the `{% for img in genieai_images %}` loop renders `GENIE_AI_<NAME>_IMAGE` / `_IMAGE_TAG` automatically; SECTION 12C (l. 525-560) renders `OKF_ENABLED` → add `AGENT_ENABLED` next to it.
- `deploy/ansible/group_vars/all.yml` l. 79 — `okf_enabled: "0"` → add `agent_enabled: "0"`.
- `env` — the root env template; the OKF flag block (l. 1389-1413) is the documentation pattern for a parked stack.
- `tests/config-validator/__tests__/compose-non-root.test.js` — the always-on service set is EXACT (24 names, l. 44-67). `agent-service` carries no Compose profile → it joins that set (a deliberate, loud contract checkpoint) and must pin a non-root `user:`.
- `scripts/ci/config-parity-allowlist.json` — `unpaired` (l. 375) declares Compose services with no chart counterpart.
- `THIRD_PARTY.md` — the per-component third-party disclosure; add the new dependencies.
- `_bmad-output/implementation-artifacts/epic-1-context.md` — Epic 1 decisions (one flag, no `comps`, dependency checklist).

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/app.py` — FastAPI app; `GET /health` and `GET /ready`; tracing initialised at startup; no capability routes.
- [x] `components/agent-service/tracing.py` — port of `genie-ai-overlay/tracing.py` without the OPEA overlay hooks; `ENABLE_OBSERVABILITY` gate; OTLP/HTTP exporter; PII redaction preserved.
- [x] `components/agent-service/requirements.txt` — fully pinned tree (fastapi, uvicorn, opentelemetry api/sdk/exporter-otlp-proto-http/instrumentation-fastapi + transitives).
- [x] `components/agent-service/pyproject.toml` — ruff config (as `pii-service`) + a `test` extra (pytest, httpx).
- [x] `components/agent-service/Dockerfile` — `python:3.11-slim`, non-root uid 10001, bustable apt layer, `HEALTHCHECK`, uvicorn CMD.
- [x] `components/agent-service/.dockerignore` — as `pii-service`.
- [x] `components/agent-service/tests/` — health/ready behaviour; tracing off = no exporter, on = spans exported and PII-redacted.
- [x] `docker-compose.yaml` — the `agent-service` block: `cap_drop: ALL`, `no-new-privileges`, `logging: *fluent-logging`, healthcheck, no `ports:`, `build` context, `image:` from `GENIE_AI_AGENT_SERVER_IMAGE(_TAG)`, non-root `user:`, `deploy.replicas: ${AGENT_ENABLED:-0}`, `node.labels.genieai` placement, `restart_policy`.
- [x] `.gitlab-ci.yml` — `build:agent-service`, `scan:agent-service`, `promote:agent-service`, `lint:agent-service`, `test:agent-service` (ruff + pytest), each with the `components/agent-service/**` path rules.
- [x] `deploy/ansible/tasks/deploy-shared-facts.yml` — add `genie-ai-agent-server` to `genieai_images` (18 → 19).
- [x] `deploy/ansible/templates/env.j2` + `deploy/ansible/group_vars/all.yml` — render `AGENT_ENABLED` (default `0`).
- [x] `env` — document `AGENT_ENABLED` (default `0`, how to turn it on).
- [x] `scripts/ci/config-parity-allowlist.json` — declare `agent-service` `unpaired` with the AR-10 reason.
- [x] `scripts/dependencies/verify-dependency-licenses.py` — the reusable V07a verifier (fetch mode + offline verify mode).
- [x] `docs/dependencies/pre-adoption-checklist.md` — the reusable checklist (procedure, rules, how a later story reuses it).
- [x] `docs/dependencies/agent-service-dependency-evidence.json` — this story's evidence: every pinned package, exact version, license + source, defaults audit.
- [x] `tests/config-validator/__tests__/agent-service.test.js` — the coverage: Compose block shape, `env` documented + wired, Ansible image entry, CI lanes present, the no-OPEA-package import rule, dependency-evidence completeness (the V07a gate).
- [x] `tests/config-validator/__tests__/compose-non-root.test.js` — add `agent-service` to the always-on set.
- [x] `THIRD_PARTY.md` — disclose the new dependencies.
- [x] `CHANGELOG.md` — an `[Unreleased] / Added` entry for the service and the `AGENT_ENABLED` knob.

**Acceptance Criteria:**
- Given a fresh checkout, when the config-validator suite runs, then it passes — including the new agent-service coverage — and the always-on no-root set carries `agent-service` with a non-root user.
- Given the Compose file, when the `agent-service` block is parsed, then it declares no host port and `deploy.replicas` resolves to `0` when `AGENT_ENABLED` is unset.
- Given `agent_enabled: "1"` in the Ansible group vars, when `env.j2` renders, then the `.env` carries `AGENT_ENABLED=1`, `GENIE_AI_AGENT_SERVER_IMAGE` and `GENIE_AI_AGENT_SERVER_IMAGE_TAG`.
- Given the image built from `components/agent-service`, when the container starts, then it serves `GET /health` with 200 and runs no process as root.
- Given `ENABLE_OBSERVABILITY=1`, when a request is served, then a span is exported for it and no span attribute carries a PII-key value.
- Given the pinned requirements of `components/agent-service`, when the pre-adoption checklist runs, then every `name==version` has a non-`NOASSERTION` license with its source and a defaults-audit row; a `NOASSERTION` row fails the check.
- Given the ported tracing module, when it is scanned for `comps` imports, then none is found.
- Given `.gitlab-ci.yml`, when the agent-service lanes are inspected, then build, scan, promote, lint and test jobs exist and the test lane runs ruff and pytest.

## Implementation Notes

- **Naming.** Service directory `components/agent-service`, image `genie-ai-agent-server` (the architecture spine's name), Compose service `agent-service`, env prefix `AGENT_*`. The Ansible entry drives the image variables: `GENIE_AI_AGENT_SERVER_IMAGE` / `GENIE_AI_AGENT_SERVER_IMAGE_TAG`.
- **The flag.** `AGENT_ENABLED` is the single activation knob: `deploy.replicas: ${AGENT_ENABLED:-0}` (Swarm honours it; plain Compose honours it through the same gate), no host port, no gateway route, no capability routes yet. No Compose profile: AR-10 asks for ONE deployment-level flag, and a profile would be a second switch an operator has to pair.
- **Always-on set.** Because the service carries no profile, it joins the always-on no-root contract — `user: "10001:10001"` in Compose plus the exact service list in `compose-non-root.test.js`. That list is a loud checkpoint by design: adding a service there is a decision, not a drift.
- **Chart.** No chart change: the adoption of the service on k3s is operator-owned (AR-10), so the Compose service is declared `unpaired` in `scripts/ci/config-parity-allowlist.json` with that reason. `config-parity-check.py` still passes (`every variable Compose sets is configured the same way by the chart`).
- **The tracing port.** Ported from `genie-ai-overlay/tracing.py`: the span API, the metrics, the `ENABLE_OBSERVABILITY` gate and the PII redacting processor are kept. Dropped: the overlay's package-bound hooks (the micro-service bootstrap, the HTTP-service access-log installer) and the log-envelope machinery that existed to serve them. The component directory contains NO occurrence of the overlay package name — not even in a comment — so the repository-wide grep of the gate story (1.4) cannot trip on the port's own documentation.
- **Where the no-overlay-import rule is asserted.** In `tests/config-validator/__tests__/agent-service.test.js` (a static repository check), not inside the component's own suite: the check has to spell the forbidden package name, and the component must not contain it.
- **Pins.** The tree is pinned in full (35 packages) so the licence audit covers exactly what the image installs. The pins are the ones the repository already ships: `fastapi==0.141.1` (as `pii-service`), `uvicorn==0.52.1` (as the OPEA overlay) and the OpenTelemetry `1.27.0` / `0.48b0` set the overlay ships.
- **Verification run locally** (never in CI, per the operator ruling on test execution): the component suite (8 tests) under a throwaway venv, ruff check + format, the config-validator suite (567 tests, 14 suites), the chart parity gate against a real render, and the licence gate (`OK 35 pinned package(s)`).

- Service directory `components/agent-service`; image `genie-ai-agent-server` (architecture spine naming); env prefix `AGENT_*`; Compose service name `agent-service`.
- The service carries NO Compose profile: `AGENT_ENABLED` is the single activation flag (AR-10 — one deployment-level flag), so `deploy.replicas` is the gate and the service joins the always-on no-root set.
- Port `8010` (internal only, no host port).
- Reuse the repo's existing pins wherever the same dependency already ships (`fastapi==0.141.1` as in `pii-service`; the OpenTelemetry `1.27.0` / `0.48b0` set the OPEA overlay already ships) — a new pin is a new licence question.

## Spec Change Log

## Review Triage Log

## Design Notes

- Why the tracing port is a port and not a shared import: the agent path must not depend on the `comps` package (FR-20), and `genie-ai-overlay/tracing.py` imports it in exactly two places (`MicroService` init, `HTTPService` access-log installer). Both hooks are dropped; the exported span API, the PII redaction processor and the `ENABLE_OBSERVABILITY` gate are kept as they are.

## Verification

**Commands:**
- `cd tests/config-validator && npm test` — expected: the whole suite passes, including the new agent-service coverage.
- `cd components/agent-service && ruff check app.py tracing.py tests/` — expected: no findings.
- `cd components/agent-service && python -m pytest tests/ -q` — expected: all tests pass.
- `python3 scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt docs/dependencies/agent-service-dependency-evidence.json` — expected: every pinned package verified, no `NOASSERTION`.
