# Testing

## Test Frameworks by Component

| Component | Framework | Config | Test Directory |
|-----------|-----------|--------|----------------|
| Backend (`gov-chat-backend`) | Jest | `jest.config.js` | `__tests__/` |
| Frontend (`gov-chat-frontend`) | Jest | `jest.config.js` | `src/__tests__/` |
| Document Repository | Jest | `jest.config.js` | `__tests__/` |
| OPEA Services (`genie-ai-overlay`) | pytest | `pytest.ini` | `tests/` (mocked), `contracts/` (real `comps`) |
| Mobile (`genie_ai_mobile`) | flutter_test | `pubspec.yaml` | `test/` |
| E2E | Playwright | `playwright.config.js` | `tests/e2e/` |
| Config Validation | Jest | `tests/config-validator/jest.config.js` | `tests/config-validator/` |

## Local install prerequisites

Tests load production modules via Node resolution. Some components require
their shared-library sibling's `node_modules` to be installed first so the
resolver can walk up into it. Skip this and several suites fail at load time
with `Cannot find module '<dep>' from '../shared/lib/...'` — a confusing
failure that looks like a code regression.

Always replicate the CI install order before running tests locally:

```bash
# Backend (gov-chat-backend) — CI does shared/lib FIRST, then backend
cd components/shared/lib && npm ci
cd ../gov-chat-backend && npm ci

# Frontend (gov-chat-frontend)
cd components/gov-chat-frontend && npm ci

# Document repository
cd components/document-repository && npm ci

# OPEA overlay (Python venv recommended — uv per project convention)
cd genie-ai-overlay && uv venv .venv && source .venv/bin/activate && uv pip install -e .[test]

# Mobile
cd mobile/genie_ai_mobile && flutter pub get
```

CI does the same sequencing (`.gitlab-ci.yml` test jobs). Match it locally.

## Running Tests

```bash
# Per-component (run from component directory)
cd components/gov-chat-backend && npm test                # All backend tests
cd components/gov-chat-backend && npm run test:contract   # Route handler tests only
cd components/gov-chat-backend && npm run test:coverage   # With coverage report

cd components/gov-chat-frontend && npm test                # All frontend tests
cd components/gov-chat-frontend && npm run test:contract  # Controller/middleware tests only

cd components/document-repository && npm test              # Document repository tests

cd genie-ai-overlay && pytest                              # All OPEA tests
cd genie-ai-overlay && pytest tests/test_retriever.py      # Specific test file
cd genie-ai-overlay && pytest contracts/                   # Contract tests vs REAL comps (dev venv; in-image tests skip)
# In-image contract run (real vendored comps, per module image):
docker run --rm -v "$PWD/genie-ai-overlay/contracts":/contracts:ro \
  --entrypoint sh <module-image> -c "cd /contracts && python -m pytest -p no:cacheprovider"

# E2E tests (from project root)
npm run test:e2e                                          # Playwright E2E suite
npm run test:e2e:list                                     # List available E2E tests

# Config validation (from project root)
cd tests/config-validator && npm test                     # Environment variable validation

# Mobile (from mobile directory)
cd mobile/genie_ai_mobile && flutter test                 # Flutter unit tests
```

## Manual Gates (no CI job — run these yourself)

The repo has no pipeline job that can exercise these paths, so they are
**not** covered by `npm test` / `pytest` / lint. Treat them as required
before you claim a change is safe.

### PII redactor smoke test

```bash
./tests/otel-collector/run-pii-smoke.sh
```

Brings up VictoriaLogs + a collector on the **unmodified production
config**, pushes a PII envelope through OTLP/HTTP, and asserts the row
comes back redacted. Takes ~30 s. No CI job exists for it.

**Run it whenever you touch:**

- `configs/otel/otel-collector-config.yaml` (any transform, not just `pii_redact`)
- `configs/otel/pii-key-list.md`
- the shape of log bodies arriving at the collector
  (`stamp_log_metadata_from_msg`, the fluentd driver config)

Two failure modes it catches that nothing else does:

1. **OTTL parse error** → the collector exits 1 and the entire log
   pipeline dies. Caught in seconds by the config gate at the top of the
   runner. Note the two-unescape trap: the regexes are double-escaped
   (`\\s`, `\\.`) because YAML single-quoted scalars are literal **and**
   OTTL's own string literal then unescapes them. Single-escaping looks
   correct and is catastrophic.
2. **Redaction that silently stopped matching** → PII reaches
   VictoriaLogs unredacted while the collector reports healthy.

Why it is a shell script and not Jest: it must start containers, inject a
curl sidecar into the collector's netns (the collector image is
distroless — no shell inside), `docker exec` into VictoriaLogs, and
discover the compose project at runtime.

### Compose no-root runtime gate

```bash
./tests/compose-non-root/check-runtime.sh <compose-project> [data_dir]
```

Asserts the #1227 no-root contract against a RUNNING stack: no uid-0
process in any container (compose or swarm labels), no root-owned file
under the data directory. Exit codes: 0 = contract holds, 1 = violation,
2 = vacuous run (no container matched the project name — fix the name,
never read a vacuous pass as OK), 3 = docker daemon unreachable (not a
project-name problem), 4 = usage error (missing argument). **Run it on a CONVERGED stack** — all
services healthy and the one-shot inits exited: right after an upgrade,
a container sitting between its restart attempts is
un-inspectable and an init mid-chown IS a root process by design, so a
run inside that window exits 1 on a system that is converging normally.
**Run it against the default-profile stack only**: the contract covers
the always-on services, and profile-gated ones (opea/gpu-models/
observability/okf — e.g. grafana, victoriametrics) intentionally run
their upstream images' root users, so a stack started with
`--profile observability` trips rule 1 by design.
**Run it ON EVERY NODE of a multi-node swarm** — rule 2 sweeps the
invoking host's data dir only, and bind sources materialize per node:
a manager-side run passes while a worker keeps a root-owned tree.
The static half runs in CI
(`tests/config-validator` jest suite); this runtime half has no CI job —
run it after any change to `docker-compose.yaml` service identities,
volumes or images.

**Run it whenever you touch:**

- `docker-compose.yaml` (a `user:`, a volume, a new service)
- any Dockerfile `USER`/chown wiring
- `tests/compose-non-root/check-runtime.sh` itself

Why it is a shell script and not Jest: it inspects the host's docker
daemon (container process tables) and the host filesystem of a running
stack — neither exists inside Jest.

> History: this test sat unwired and its assertions queried
> `_msg:REDACTED`, which excludes exactly the unredacted rows it was
> meant to catch. It passed against a completely broken redactor. It now
> reads the row back by a unique marker instead.

## CI Pipeline

GitLab CI pipeline (`.gitlab-ci.yml`) runs on every merge request with stages in this order:

1. **Lint** — ESLint (JS), Ruff (Python), Prettier format checks
2. **Test** — Jest (backend, frontend, doc-repo), pytest (OPEA), flutter_test (mobile)
3. **Config** — Environment-variable coverage (`config:validate`) and dependency-lock freshness (`verify:dataprep-lock`). Runs before build so cheap validation fails fast.
4. **Build** — publish candidate images to GitLab Container Registry (`tmp/` namespace)
5. **Scan** — Trivy container scanning of candidate images (advisory + dashboard)
6. **E2E** — Playwright tests against deployed infrastructure (scheduled only)
7. **Promote** — retag tested digests to deployable tags (main/tags only)

All test runners produce JUnit XML reports as CI artifacts. Pipeline blocks MR on any mandatory stage failure.

## Backend Test Patterns

- **`createApp()` pattern**: Backend `index.js` exports `createApp()` for testability — tests create isolated Express instances via `supertest` without starting the HTTP server
- **Module-level mocking**: `__tests__/mocks/shared-lib.js` mocks the frozen `db-connection-service` singleton via Jest `moduleNameMapper`
- **Fixtures**: `__tests__/fixtures/` contains reusable test data (users, tokens, requests)
- **Test structure**: `__tests__/routes/` (route handlers), `__tests__/controllers/`, `__tests__/services/`, `__tests__/middleware/`

## OPEA Test Patterns

- **Shared fixtures**: `genie-ai-overlay/tests/conftest.py` provides pytest fixtures for all OPEA services
- **Mock infrastructure**: Fixtures mock the `comps` library (vendored at build time), ArangoDB, and external model endpoints
- **Tracing tests**: `test_tracing_with_span.py`, `test_*_tracing.py` validate OTel span emission
- **Contract suite (`contracts/`, real `comps`)**: runs INSIDE the built image against the real vendored `comps` — deliberately a SIBLING of `tests/`, because `tests/conftest.py` stubs `comps` in `sys.modules` (a parent conftest would contaminate any nested dir, and `pytest.ini` `testpaths = tests` would collect it into the mocked run). See `genie-ai-overlay/contracts/README.md`.
