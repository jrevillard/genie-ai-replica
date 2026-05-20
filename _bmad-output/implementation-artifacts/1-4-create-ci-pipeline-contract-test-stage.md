# Story 1.4: Create CI Pipeline Contract Test Stage

Status: done

## Story

As a developer,
I want the CI pipeline to run contract tests as a dedicated stage,
so that breaking interface changes are caught before merge.

## Acceptance Criteria

1. **Given** the test stage passes and route handler tests exist from Epics 2 and 5, **when** the contract stage runs, **then** a `contract` CI stage executes `npm run test:contract` in backend and document-repository
2. The stage runs existing Supertest-based route handler tests that verify request/response schemas
3. The stage does NOT write new tests — it orchestrates execution of tests written in Epics 2 and 5
4. JUnit XML reports are collected as `artifacts:reports:junit`
5. The stage blocks the MR on failure
6. Path-based `rules:changes` trigger only relevant contract tests on MRs

## Tasks / Subtasks

- [x] Task 1: Add `contract` stage to `.gitlab-ci.yml` (AC: #1, #5)
  - [x] Update `stages:` from `[lint, test, e2e]` to `[lint, test, contract, e2e]`
  - [x] Verify lint and test jobs are NOT modified
  - [x] Verify `patrol:e2e` is NOT modified
- [x] Task 2: Add `test:contract` npm script to backend `package.json` (AC: #1, #2, #3)
  - [x] Add `"test:contract": "jest --testPathPattern='__tests__/routes/'"` to `components/gov-chat-backend/package.json` scripts
  - [x] This runs ONLY the 5 route handler test files (admin, analytics, auth, categories, chat) — NOT service/middleware/unit tests
- [x] Task 3: Add `test:contract` npm script to document-repository `package.json` (AC: #1, #2, #3)
  - [x] Add `"test:contract": "jest --testPathPattern='src/__tests__/unit/(controllers|middlewares)/'"` to `components/document-repository/package.json` scripts
  - [x] Currently runs fileController and fileUpload middleware tests — the only route/contract-level tests in doc-repo. Will expand as Epic 5 adds route tests.
- [x] Task 4: Create hidden `.contract_node` template (AC: #1)
  - [x] Create `.contract_node` extending `.node_base` with `stage: contract` and `NODE_ENV: test`
  - [x] Follow the same pattern as `.test_node` but for the contract stage
  - [x] Include `artifacts` defaults (`when: always`, `expire_in: 7 days`)
- [x] Task 5: Create `contract:backend` CI job (AC: #1, #4, #5, #6)
  - [x] Extend `.contract_node`
  - [x] `before_script`: `cd components/gov-chat-backend && npm ci`
  - [x] `script`: `npm run test:contract`
  - [x] `cache`: keyed on `components/gov-chat-backend/package-lock.json` with prefix `contract-backend`
  - [x] `artifacts:reports:junit`: collect `components/gov-chat-backend/reports/jest-contract-backend.xml`
  - [x] `rules:changes`: trigger on `components/gov-chat-backend/**/*` and `.gitlab-ci.yml` + main branch rule
- [x] Task 6: Create `contract:doc-repo` CI job (AC: #1, #4, #5, #6)
  - [x] Extend `.contract_node`
  - [x] `before_script`: `cd components/document-repository && npm ci`
  - [x] `script`: `npm run test:contract`
  - [x] `cache`: keyed on `components/document-repository/package-lock.json` with prefix `contract-doc-repo`
  - [x] `artifacts:reports:junit`: collect `components/document-repository/reports/jest-contract-docrepo.xml`
  - [x] `rules:changes`: trigger on `components/document-repository/**/*` and `.gitlab-ci.yml` + main branch rule
- [x] Task 7: Configure separate JUnit XML output for contract tests (AC: #4)
  - [x] Backend: override jest-junit output name via `JEST_JUNIT_OUTPUT_NAME` env var in CI job to `jest-contract-backend.xml`
  - [x] Doc-repo: override jest-junit output name via `JEST_JUNIT_OUTPUT_NAME` env var in CI job to `jest-contract-docrepo.xml`
  - [x] This prevents collision with test stage reports (`jest-backend.xml`, `jest-docrepo.xml`)
- [x] Task 8: Validate (AC: all)
  - [x] Validate YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml'))"`
  - [x] Verify `stages:` order is `[lint, test, contract, e2e]`
  - [x] Verify lint jobs and test jobs are NOT modified
  - [x] Verify `patrol:e2e` is NOT modified
  - [x] Verify both contract jobs run in parallel within the `contract` stage
  - [x] Verify both contract jobs have `artifacts:reports:junit` entries
  - [x] Verify both contract jobs have `cache` entries with `contract-*` prefixes
  - [x] Verify both contract jobs have path-based `rules:changes` for MR + main branch rule
  - [x] Run `npm run test:contract` locally in backend — verify it runs only `__tests__/routes/` tests (not all tests)
  - [x] Run `npm run test:contract` locally in doc-repo — verify it runs controller/middleware tests only

## Dev Notes

### Existing `.gitlab-ci.yml` State

The file currently has 342 lines with stages `[lint, test, e2e]`. You are **ADDING** a new `contract` stage between `test` and `e2e`, creating a hidden template, and adding 2 new jobs. Do NOT modify lint jobs, test jobs, or `patrol:e2e`.

**Hidden templates already defined (reusable):**
```yaml
.node_base:
  image: node:20-alpine
  interruptible: true

.test_node:
  extends: .node_base
  stage: test
  variables:
    NODE_ENV: test
  artifacts:
    when: always
    expire_in: 7 days
```

Create a new `.contract_node` template:
```yaml
.contract_node:
  extends: .node_base
  stage: contract
  variables:
    NODE_ENV: test
  artifacts:
    when: always
    expire_in: 7 days
```

### Backend Route Tests (What Contract Tests Run)

Backend has 5 route handler test files in `__tests__/routes/`:

| File | What it tests | Size |
|------|--------------|------|
| `auth.test.js` | POST `/api/auth/login`, `/logout`, `/refresh` with Supertest | 9.7 KB |
| `chat.test.js` | GET/POST `/api/chat/conversations`, `/messages` with Supertest | 17 KB |
| `analytics.test.js` | GET `/api/analytics/*` endpoints with Supertest | 20 KB |
| `categories.test.js` | GET `/api/categories/*` endpoints with Supertest | 22 KB |
| `admin.test.js` | GET/PUT `/api/admin/*` with role-based access, Supertest | 23 KB |

These are the **contract tests** — they verify request/response schemas via Supertest `request(app)`. The `test:contract` script runs ONLY these files, not the service/middleware/unit tests that `npm test` runs.

### Document-Repository Tests (What Contract Tests Run)

Doc-repo has controller and middleware tests in `src/__tests__/unit/`:

| File | What it tests |
|------|--------------|
| `controllers/fileController.test.js` | File upload/download/delete route handlers |
| `middlewares/fileUpload.test.js` | File upload middleware validation |
| `middlewares/keycloak-auth-middleware.test.js` | Auth middleware |
| `services/labelService.test.js` | Label service unit tests |
| `services/metadataService.test.js` | Metadata service unit tests |
| `services/securityService.test.js` | Security scanning service |
| `utils/fileUtils.test.js` | File utility helpers |
| `utils/mimeTypeValidator.test.js` | MIME type validation |

The contract test script for doc-repo runs ONLY `controllers/` and `middlewares/` — the route/contract-level tests. Epic 5 (backlog) will add dedicated route tests later; the `test:contract` pattern can be updated then.

### JUnit XML Output Collision Prevention

The test stage already produces:
- `components/gov-chat-backend/reports/jest-backend.xml` (from `npm test`)
- `components/document-repository/reports/jest-docrepo.xml` (from `npm test`)

Contract tests MUST write to DIFFERENT files:
- `components/gov-chat-backend/reports/jest-contract-backend.xml`
- `components/document-repository/reports/jest-contract-docrepo.xml`

**Approach**: Override the jest-junit output name via environment variable in the CI job:

```yaml
contract:backend:
  extends: .contract_node
  variables:
    JEST_JUNIT_OUTPUT_NAME: 'jest-contract-backend.xml'
  before_script:
    - cd components/gov-chat-backend && npm ci
  script:
    - npm run test:contract
  # ...
```

This works because `jest-junit` reads `JEST_JUNIT_OUTPUT_NAME` as an override for the `outputName` config option. The `outputDirectory` remains `reports/` from the package.json jest config.

### `test:contract` Script Design

**Backend** — run only route handler tests:
```json
"test:contract": "jest --testPathPattern='__tests__/routes/'"
```

**Doc-repo** — run only controller/middleware tests:
```json
"test:contract": "jest --testPathPattern='src/__tests__/unit/(controllers|middlewares)/'"
```

These scripts use `--testPathPattern` to filter which test files run. The pattern matches the file path, not the test name. This is the simplest approach — no need for a separate jest config file.

### Contract Job Pattern

Follow the exact same pattern as test jobs but with `contract` stage:

```yaml
contract:backend:
  extends: .contract_node
  variables:
    JEST_JUNIT_OUTPUT_NAME: 'jest-contract-backend.xml'
  before_script:
    - cd components/gov-chat-backend && npm ci
  script:
    - npm run test:contract
  cache:
    key:
      files:
        - components/gov-chat-backend/package-lock.json
      prefix: contract-backend
    paths:
      - components/gov-chat-backend/node_modules/
  artifacts:
    reports:
      junit: components/gov-chat-backend/reports/jest-contract-backend.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - "components/gov-chat-backend/**/*"
        - ".gitlab-ci.yml"
      when: on_success
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: on_success
```

### Cache Key Collision Prevention

Contract jobs MUST use `contract-*` prefixes (not `test-*` or `lint-*`) because:
- Contract jobs install the same deps as test jobs but may have different runtime needs
- Keeping separate caches prevents cross-stage cache pollution
- If performance becomes a concern, consider sharing cache with `test-*` prefix later

### What NOT To Do

- Do NOT create a new `.gitlab-ci.yml` — modify the existing one
- Do NOT modify any lint jobs, test jobs, or `patrol:e2e`
- Do NOT write new test files — this story only orchestrates existing tests
- Do NOT use `needs:` keyword — stage-based ordering is sufficient (contract runs after test)
- Do NOT use `allow_failure: true` on any contract job — contract tests MUST pass (AC #5)
- Do NOT reuse the `test` stage's JUnit XML report paths — contract must write to separate files
- Do NOT add format checking or lint commands to contract jobs — those belong in the lint stage
- Do NOT add Python or mobile contract jobs — only backend and doc-repo have Supertest route tests
- Do NOT modify any test files in `__tests__/routes/` or `src/__tests__/`
- Do NOT modify `backend/package.json` jest config — only add the `test:contract` script entry

### Story 1-3 Learnings (MUST Apply)

1. **Hidden templates work** — `.node_base`, `.lint_node`, `.test_node` all work. Create `.contract_node` following the same pattern.
2. **Cache prefix is required** — lint uses `lint-*`, test uses `test-*`. Contract must use `contract-*`.
3. **Artifacts defaults in template** — `.test_node` sets `artifacts: { when: always, expire_in: 7 days }`. Include the same in `.contract_node` so individual jobs only need `artifacts.reports.junit`.
4. **Flutter before_script** — the `.flutter_base` template handles SDK install. Not relevant here (no Flutter contract tests).
5. **Python venv** — not relevant here (no Python contract tests; OPEA tests are interface-level, not contract-level).
6. **JEST_JUNIT_OUTPUT_NAME** — this env var overrides the jest-junit `outputName` config. Use it to avoid report file collisions between `test` and `contract` stages.

### Stage Ordering Rationale

```
lint → test → contract → e2e
```

Contract comes AFTER test because:
- Contract tests run against the Supertest HTTP interface (full request/response cycle)
- Unit tests in the `test` stage validate individual services and middleware
- If unit tests fail, running contract tests is wasteful — they'll likely fail too
- This matches the architecture document's pipeline stage structure

### References

- [Source: `.gitlab-ci.yml`] — existing CI configuration with lint, test, e2e stages
- [Source: `_bmad-output/planning-artifacts/epics.md` Epic 1 Story 1.4] — acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md` CI/CD Pipeline Architecture, Test Execution Tiers] — pipeline stage structure
- [Source: `_bmad-output/planning-artifacts/architecture.md` Contract Test Mechanism] — Supertest route handler tests as primary contract mechanism
- [Source: `_bmad-output/project-context.md` Testing Rules] — test framework details per component
- [Source: `1-3-create-ci-pipeline-test-stage.md`] — previous story patterns, hidden templates, cache strategy
- [Source: `components/gov-chat-backend/__tests__/routes/`] — 5 existing route handler test files (admin, analytics, auth, categories, chat)
- [Source: `components/gov-chat-backend/package.json` jest config] — jest-junit reporter, outputName: jest-backend.xml
- [Source: `components/document-repository/package.json` scripts] — test: jest, test:watch, test:coverage
- [Source: `components/document-repository/jest.config.js`] — jest-junit reporter, outputName: jest-docrepo.xml
- [Source: `components/document-repository/src/__tests__/unit/`] — 8 existing unit test files

### Project Structure Notes

- `.gitlab-ci.yml` is at repository root — this is the primary file modified in this story
- `package.json` files in `components/gov-chat-backend/` and `components/document-repository/` get a new `test:contract` script
- Reports directories (`reports/`) are already in `.gitignore` (from story 1-1)
- Backend jest config is embedded in `package.json` under the `"jest"` key — no separate `jest.config.js`
- Doc-repo has a separate `jest.config.js` file
- Both components already have `jest-junit` configured with `outputDirectory: 'reports'`

## Dev Agent Record

### Agent Model Used

deepseek-v4-pro

### Debug Log References

### Completion Notes List

- Added `contract` stage between `test` and `e2e` in `.gitlab-ci.yml` stages array
- Created `.contract_node` hidden template extending `.node_base` with `stage: contract`, `NODE_ENV: test`, and `artifacts` defaults — follows the same pattern as `.test_node`
- Added `contract:backend` job: runs `npm run test:contract` for backend route handler tests, JUnit output to `jest-contract-backend.xml`, cache prefix `contract-backend`, path-based rules:changes on `components/gov-chat-backend/**/*` and `.gitlab-ci.yml`
- Added `contract:doc-repo` job: runs `npm run test:contract` for doc-repo controller/middleware tests, JUnit output to `jest-contract-docrepo.xml`, cache prefix `contract-doc-repo`, path-based rules:changes on `components/document-repository/**/*` and `.gitlab-ci.yml`
- Added `test:contract` npm script to backend `package.json`: `jest --testPathPattern='__tests__/routes/'` — runs only the 5 route handler test files (admin, analytics, auth, categories, chat)
- Added `test:contract` npm script to doc-repo `package.json`: `jest --testPathPattern='src/__tests__/unit/(controllers|middlewares)/'` — runs only controller and middleware tests
- JUnit XML collision prevention: both contract jobs set `JEST_JUNIT_OUTPUT_NAME` env var to write to separate report files from the test stage
- Validated: YAML syntax OK, stages order correct, lint/test/e2e jobs untouched, both contract jobs in same stage (parallel), all checkboxes pass
- Backend contract tests: 5 suites, 137 tests PASS. Doc-repo contract tests: 3 suites, 56 tests PASS. Full regression: backend 23 suites/550 tests, doc-repo 8 suites/117 tests — zero regressions

### File List

- `.gitlab-ci.yml` (modified — stages, `.contract_node`, `contract:backend`, `contract:doc-repo`)
- `components/gov-chat-backend/package.json` (modified — added `test:contract` script)
- `components/document-repository/package.json` (modified — added `test:contract` script)

## Change Log

- 2026-05-20: Implemented CI contract test stage — new `.contract_node` template, `contract:backend` and `contract:doc-repo` jobs, `test:contract` scripts in backend and doc-repo
