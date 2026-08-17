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
