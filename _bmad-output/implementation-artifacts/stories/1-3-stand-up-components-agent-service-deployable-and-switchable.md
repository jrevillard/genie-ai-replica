---
title: 'Story 1.3 — Stand up components/agent-service, deployable and switchable'
type: 'feature'
created: '2026-11-19'
status: 'in-review'
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
- **Verification run locally** (never in CI, per the operator ruling on test execution): the component suite (9 tests) under a throwaway venv built from the pinned trees, ruff check + format, the config-validator suite (568 tests, 14 suites), the chart parity gate against a real render, and the licence gate (`OK 37 pinned package(s)`).
- **The test tree is a pinned file too.** `components/agent-service/requirements-test.txt` carries the runtime tree plus the two test-only pins; the CI lane installs that file, so no dependency enters the lane outside the audited set. The audit covers both trees in one evidence file.
- **The setuptools pin is load-bearing.** `opentelemetry-instrumentation` 0.48b0 resolves its entry points through `pkg_resources`; setuptools 82 dropped that module, so the pin stops at 81.0.0. With a newer setuptools the instrumentation import fails, the failure is swallowed by the instrumentation's own `except`, and the request spans silently never appear — the defect the global review caught.
- **The app is built from the module attribute.** `fastapi.FastAPI(...)`, not a name bound at import time: the global instrumentation replaces `fastapi.FastAPI` when `setup_tracing()` runs, and only an app created afterwards carries the OTel middleware.
- **Nothing is excluded from tracing.** The overlay's port excludes the health endpoints because its services answer real traffic; this service's only traffic IS the health traffic, so excluding them would leave the tracing criterion with no request to trace.
- **Not exercised locally** (no docker daemon on this host): the image build and the container runtime. The CI `build:agent-service` lane covers the build.

- Service directory `components/agent-service`; image `genie-ai-agent-server` (architecture spine naming); env prefix `AGENT_*`; Compose service name `agent-service`.
- The service carries NO Compose profile: `AGENT_ENABLED` is the single activation flag (AR-10 — one deployment-level flag), so `deploy.replicas` is the gate and the service joins the always-on no-root set.
- Port `8010` (internal only, no host port).
- Reuse the repo's existing pins wherever the same dependency already ships (`fastapi==0.141.1` as in `pii-service`; the OpenTelemetry `1.27.0` / `0.48b0` set the OPEA overlay already ships) — a new pin is a new licence question.

## Spec Change Log

## Review Triage Log

### Global review (bare `Global code-review` agent, fresh context, 6 findings, verified against the code and a venv built from the exact pins)

Every finding is dispositioned below; "fixed" means the correction is in the diff.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | `setuptools==84.2.1` ships no `pkg_resources`, so `opentelemetry.instrumentation.fastapi` fails to import (reproduced in a venv built from the exact pins: `ModuleNotFoundError`) and the request spans silently never appear — the failure is swallowed by the instrumentation's own `except` | high | **fixed** — `setuptools==81.0.0`, the last release that still ships `pkg_resources` (82 dropped it; verified against the published wheels). The reason is written in `requirements.txt` and in the evidence row |
| 2 | `from fastapi import FastAPI` binds the class at import time, BEFORE `setup_tracing()` replaces `fastapi.FastAPI` — the app is built from the stale binding, so it carries no OTel middleware and emits no server span | high | **fixed** — the app is built from the module attribute (`fastapi.FastAPI(...)`), which resolves the instrumented class; the reason is written at the construction site |
| 3 | `excluded_urls="health,ready,alive"` excludes the only two routes the service serves, so with 1 and 2 fixed no request would still be traced | medium | **fixed** — `excluded_urls=""` (the explicit "exclude nothing" value; `None` would fall back to the `OTEL_PYTHON_FASTAPI_EXCLUDED_URLS` environment). The port's deviation from the overlay's default is written at the call site |
| 4 | The export test opened a span by hand and never drove a request through the app — the observability gate was vacuous and would have passed with 1, 2 and 3 present | medium | **fixed** — a module-scoped fixture (exporter + provider + an app reloaded AFTER the instrumentation patched `fastapi.FastAPI`) and a test that serves `GET /health` and asserts the server span in the exporter |
| 5 | The `build:agent-service` lane carries no `FORCE_IMAGE_REBUILD` rule and no default-branch rule, so a deployment would resolve an image tag that was never built | false | The premise does not hold: the lane carries the same default-branch and release-branch rules as the `pii-service` precedent, and the monthly rebuild is handled inside the inherited `.build_template` (the `CACHE_BUST` build arg). The promote job of pipeline 18621 published `genie-ai-agent-server:feat-agentic-foundations-1-3-agent-service` and `...-1f9de8b9` to the registry (job trace) |
| 6 | The CI test lane installs `httpx` and `pytest` outside the audited pin set, so the "every introduced dependency is audited" property did not hold for the test surface | medium | **fixed** — a `requirements-test.txt` (the runtime tree plus the two test pins) is what the lane installs, the evidence file covers both trees, and the config-validator gate checks their union and refuses a lane that names its own versions |

### Quality phase (simplify + test-audit, run in the seat; the four cleanup lanes of the first attempt wedged and were stopped)

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 7 | The ported tracing module carried two helpers nothing calls — `_PII_KEYS` (a back-compat constant with no consumer) and `sanitize_attributes` (the processor uses `redact_attributes`) | low | **fixed** — both removed; the module keeps the span API, the meter accessor and the redacting processor |
| 8 | The `[test]` extra in `pyproject.toml` pinned nothing (`pytest>=8.0`, `httpx>=0.28`) and could drift from the audited pins the CI lane installs | medium | **fixed** — the extra carries the audited versions, with the pairing written next to it |
| 9 | `pytest` was an introduced dependency with no entry in `THIRD_PARTY.md` | medium | **fixed** — disclosed in the Python Libraries section |
| 10 | Two readiness tests asserted one contract twice (the activation flag, on and off) | low | **fixed** — merged into one test that exercises both states, which also proves the flag is read per request |
| 11 | The CI-lane assertions matched across the whole file, so another job's `IMAGE_NAME` could have satisfied them | medium | **fixed** — the assertions are scoped to the job's own block |
| 12 | The reachability criterion had no gate on the gateway half: nothing asserted that the gateway routes nothing to the agent service | medium | **fixed** — a gate reads the gateway's declarative config and its restore script |

### Scoped FIX-REVIEW over the quality corrections (`9f51a18eb..394cc083f`, bounded, no subagent)

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 13 | The tracing module's docstring still claimed "Public API (unchanged from the source module)" after the two helpers were dropped | low | **fixed** — the claim now reads "Public API of this port" |

The decisions of the phase are recorded in the orchestrator's log (`~/.claude/state/review/issue-1949.jsonl`).

## Design Notes

- Why the tracing port is a port and not a shared import: the agent path must not depend on the `comps` package (FR-20), and `genie-ai-overlay/tracing.py` imports it in exactly two places (`MicroService` init, `HTTPService` access-log installer). Both hooks are dropped; the exported span API, the PII redaction processor and the `ENABLE_OBSERVABILITY` gate are kept as they are.

## Verification

**Commands:**
- `cd tests/config-validator && npm test` — expected: the whole suite passes, including the new agent-service coverage.
- `cd components/agent-service && ruff check app.py tracing.py tests/` — expected: no findings.
- `cd components/agent-service && ruff format --check app.py tracing.py tests/` — expected: every file already formatted.
- `cd components/agent-service && python -m pytest tests/ -q` — expected: all tests pass (the venv carries the pinned trees, `requirements.txt` and `requirements-test.txt`).
- `python3 scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt components/agent-service/requirements-test.txt --evidence docs/dependencies/agent-service-dependency-evidence.json` — expected: every pinned package verified, no `NOASSERTION`.
- `python3 scripts/ci/config-parity-check.py /tmp/rendered.yaml --min-compared=327` — expected: every variable Compose sets is configured the same way by the chart.
