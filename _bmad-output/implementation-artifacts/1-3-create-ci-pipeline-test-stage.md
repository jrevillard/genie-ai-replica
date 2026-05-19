# Story 1.3: Create CI Pipeline Test Stage

Status: review

## Story

As a developer,
I want the CI pipeline to run unit tests for all 5 components in parallel on every merge request,
so that I get fast feedback on whether my changes break anything.

## Acceptance Criteria

1. **Given** the lint stage passes, **when** the test stage runs, **then** parallel test jobs execute for all 5 components
2. **`test:backend`** — runs `npm ci && npm test` in `components/gov-chat-backend/`
3. **`test:frontend`** — runs `npm ci && npm test` in `components/gov-chat-frontend/`
4. **`test:doc-repo`** — runs `npm ci && npm test` in `components/document-repository/`
5. **`test:python`** — runs `pip install && pytest` in `genie-ai-overlay/`
6. **`test:mobile`** — runs `flutter test` with JUnit XML output in `mobile/genie_ai_mobile/`
7. Each job produces JUnit XML as `artifacts:reports:junit`
8. Each job uses `cache:` for `node_modules` (Node.js) and `.venv` (Python)
9. `NODE_ENV=test` is set for all Node.js jobs
10. Path-based `rules:changes` trigger only affected component tests on MRs
11. All 5 jobs run on `main` branch pushes regardless of path changes

## Tasks / Subtasks

- [x] Task 1: Add `.test_node` hidden template and `NODE_ENV` variable (AC: #9)
  - [x] Create `.test_node` hidden job extending `.node_base` with `stage: test` and `NODE_ENV: test`
  - [x] Ensure the template is designed for reuse by all 3 Node.js test jobs
- [x] Task 2: Create `test:backend` job (AC: #2, #7, #8, #9, #10, #11)
  - [x] Extend `.test_node`
  - [x] `before_script`: `cd components/gov-chat-backend && npm ci`
  - [x] `script`: `npm test` (Jest runs with jest-junit reporter if configured from Story 1-1)
  - [x] `cache`: keyed on `components/gov-chat-backend/package-lock.json` with prefix `test-backend`
  - [x] `artifacts:reports:junit`: collect `components/gov-chat-backend/reports/jest-backend.xml`
  - [x] `artifacts:when: always` and `expire_in: 7 days`
  - [x] `rules:changes`: trigger on `components/gov-chat-backend/**/*` and `.gitlab-ci.yml` + main branch rule
- [x] Task 3: Create `test:frontend` job (AC: #3, #7, #8, #9, #10, #11)
  - [x] Extend `.test_node`
  - [x] `before_script`: `cd components/gov-chat-frontend && npm ci`
  - [x] `script`: `npm test` (Jest with jest-junit reporter)
  - [x] `cache`: keyed on `components/gov-chat-frontend/package-lock.json` with prefix `test-frontend`
  - [x] `artifacts:reports:junit`: collect `components/gov-chat-frontend/reports/jest-frontend.xml`
  - [x] `artifacts:when: always` and `expire_in: 7 days`
  - [x] `rules:changes`: trigger on `components/gov-chat-frontend/**/*` and `.gitlab-ci.yml` + main branch rule
- [x] Task 4: Create `test:doc-repo` job (AC: #4, #7, #8, #9, #10, #11)
  - [x] Extend `.test_node`
  - [x] `before_script`: `cd components/document-repository && npm ci`
  - [x] `script`: `npm test` (Jest with jest-junit reporter)
  - [x] `cache`: keyed on `components/document-repository/package-lock.json` with prefix `test-doc-repo`
  - [x] `artifacts:reports:junit`: collect `components/document-repository/reports/jest-docrepo.xml`
  - [x] `artifacts:when: always` and `expire_in: 7 days`
  - [x] `rules:changes`: trigger on `components/document-repository/**/*` and `.gitlab-ci.yml` + main branch rule
- [x] Task 5: Create `test:python` job (AC: #5, #7, #8, #10, #11)
  - [x] Use `python:3.10-slim` image
  - [x] `before_script`: create venv, install test deps via `pip install -e ".[test]"` from `genie-ai-overlay/`
  - [x] `script`: `pytest --junitxml=reports/pytest-report.xml` from `genie-ai-overlay/`
  - [x] `cache`: keyed on `genie-ai-overlay/pyproject.toml` with prefix `test-python` for `.venv/`
  - [x] `artifacts:reports:junit`: collect `genie-ai-overlay/reports/pytest-report.xml`
  - [x] `artifacts:when: always` and `expire_in: 7 days`
  - [x] `rules:changes`: trigger on `genie-ai-overlay/**/*.py`, `genie-ai-overlay/pyproject.toml`, and `.gitlab-ci.yml` + main branch rule
- [x] Task 6: Update `flutter:test` job for JUnit XML and main branch rule (AC: #6, #7, #10, #11)
  - [x] Replace `flutter analyze` in script (redundant with `lint:dart`)
  - [x] Update script to produce JUnit XML: `flutter test --machine | tojunit --output reports/flutter-report.xml` (if `junitreport` package available), OR keep `flutter test --coverage` and add a JUnit-compatible output step
  - [x] Add `artifacts:reports:junit` for the JUnit XML report
  - [x] Add main branch rule: `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`
  - [x] Keep existing coverage artifacts collection
- [x] Task 7: Validate (AC: all)
  - [x] Validate YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml'))"`
  - [x] Verify `stages:` order is `[lint, test, e2e]` — unchanged
  - [x] Verify lint jobs are NOT modified
  - [x] Verify `patrol:e2e` is NOT modified
  - [x] Verify all 5 test jobs run in parallel within the `test` stage
  - [x] Verify all Node.js jobs have `NODE_ENV: test`
  - [x] Verify all jobs have `artifacts:reports:junit` entries
  - [x] Verify all jobs have `cache` entries
  - [x] Verify all jobs have path-based `rules:changes` for MR + main branch rule

## Dev Notes

### Existing `.gitlab-ci.yml` State

The file currently has 210 lines with stages `[lint, test, e2e]`. The `test` stage contains only `flutter:test`. You are **ADDING** 4 new test jobs and **UPDATING** the existing `flutter:test` job. Do NOT modify lint jobs or `patrol:e2e`.

**Hidden templates already defined (reusable):**
```yaml
.node_base:
  image: node:20-alpine
  interruptible: true
```

Create a new `.test_node` template that extends `.node_base`:
```yaml
.test_node:
  extends: .node_base
  stage: test
  variables:
    NODE_ENV: test
```

### Story 1-1 Dependency (JUnit XML Reporting)

Story 1-1 (`1-1-configure-junit-xml-reporting-for-all-test-runners`) is in **review** status. It adds:
- `jest-junit: ^17.0.0` to all 3 JS component devDependencies
- JUnit reporter config in each component's jest config
- `reports/` directories gitignored

**Check if story 1-1 is merged** before starting: look for `jest-junit` in `components/gov-chat-backend/package.json`. If present, JUnit XML reporting is already configured. If NOT present, you must add the jest-junit reporter config as part of this story's test jobs — either by modifying package.json files or by passing `--reporters=jest-junit` via CLI args.

Similarly, check if `junitreport` is in `mobile/genie_ai_mobile/pubspec.yaml` for Flutter JUnit output.

**Key JUnit XML output paths** (from story 1-1):
| Component | Report Path |
|-----------|------------|
| Backend | `components/gov-chat-backend/reports/jest-backend.xml` |
| Frontend | `components/gov-chat-frontend/reports/jest-frontend.xml` |
| Doc-repo | `components/document-repository/reports/jest-docrepo.xml` |
| Python | `genie-ai-overlay/reports/pytest-report.xml` (via `--junitxml` flag) |
| Flutter | `mobile/genie_ai_mobile/reports/flutter-report.xml` (via `tojunit`) |

### Test Commands Per Component

| Component | Directory | Command | Config Location |
|-----------|-----------|---------|-----------------|
| Backend | `components/gov-chat-backend/` | `npm test` → `jest` | `package.json` jest block |
| Frontend | `components/gov-chat-frontend/` | `npm test` → `jest --verbose` | `jest.config.js` |
| Doc-repo | `components/document-repository/` | `npm test` → `jest` | `jest.config.js` |
| Python | `genie-ai-overlay/` | `pytest` | `pytest.ini` |
| Mobile | `mobile/genie_ai_mobile/` | `flutter test --coverage` | `.gitlab-ci.yml` (existing) |

### Node.js Test Job Pattern

Follow the established lint job pattern from story 1-2. Each Node.js test job:

```yaml
test:backend:
  extends: .test_node
  before_script:
    - cd components/gov-chat-backend && npm ci
  script:
    - npm test
  cache:
    key:
      files:
        - components/gov-chat-backend/package-lock.json
      prefix: test-backend
    paths:
      - components/gov-chat-backend/node_modules/
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit: components/gov-chat-backend/reports/jest-backend.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - "components/gov-chat-backend/**/*"
        - ".gitlab-ci.yml"
      when: on_success
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: on_success
```

**Important:** The `cache` prefix MUST differ from the lint job prefix (`test-backend` vs `lint-backend`) because test jobs install test-only deps that lint doesn't need. This avoids cache pollution between stages.

### Python Test Job

Python test deps are declared in `genie-ai-overlay/pyproject.toml` under `[project.optional-dependencies] test`:
```toml
test = [
    "fastapi>=0.115",
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-cov>=6.0",
    "httpx>=0.28",
    "asgi-lifespan>=2.0",
]
```

Install via `pip install -e ".[test]"` from `genie-ai-overlay/`. Use a venv for isolation:

```yaml
test:python:
  image: python:3.10-slim
  stage: test
  interruptible: true
  before_script:
    - cd genie-ai-overlay
    - python -m venv .venv
    - . .venv/bin/activate
    - pip install -e ".[test]"
  script:
    - . .venv/bin/activate
    - mkdir -p reports
    - pytest --junitxml=reports/pytest-report.xml
  cache:
    key:
      files:
        - genie-ai-overlay/pyproject.toml
      prefix: test-python
    paths:
      - genie-ai-overlay/.venv/
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit: genie-ai-overlay/reports/pytest-report.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - "genie-ai-overlay/**/*.py"
        - "genie-ai-overlay/pyproject.toml"
        - ".gitlab-ci.yml"
      when: on_success
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: on_success
```

### Flutter Test Job Update

The existing `flutter:test` job needs two changes:
1. **Add JUnit XML output** — if `junitreport` package is available in `pubspec.yaml`, use `flutter test --machine | tojunit --output reports/flutter-report.xml`. Otherwise, keep `flutter test --coverage` and note that JUnit XML will be added when story 1-1 merges.
2. **Add main branch rule** — currently only triggers on MR changes, missing the `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` rule.
3. **Remove duplicate `flutter analyze`** — the `lint:dart` job already runs analysis. The test job should only run tests.

Updated pattern:
```yaml
flutter:test:
  extends: .flutter_base
  stage: test
  script:
    - export PATH="$PWD/../../flutter-sdk/bin:$PATH"
    - mkdir -p reports
    - flutter test --machine | tojunit --output reports/flutter-report.xml
    - flutter test --coverage
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - mobile/genie_ai_mobile/coverage/
    reports:
      junit: mobile/genie_ai_mobile/reports/flutter-report.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - mobile/genie_ai_mobile/**
        - ".gitlab-ci.yml"
      when: on_success
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: on_success
```

**If `junitreport` is NOT installed** (check `pubspec.yaml`), fall back to running `flutter test --coverage` only and omit the JUnit XML artifact. Add a comment noting this is pending story 1-1 merge.

### Cache Key Collision Prevention

Test jobs MUST use `test-*` prefixes (not `lint-*`) because:
- Test jobs install full dependencies (including test frameworks)
- Lint jobs only need linting tools
- Sharing cache would bloat lint jobs with unnecessary test deps

### Path-Based Trigger Rules

Follow the exact same pattern as lint jobs for `rules:changes`:
```yaml
rules:
  - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    changes:
      - "components/gov-chat-backend/**/*"
      - ".gitlab-ci.yml"
    when: on_success
  - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    when: on_success
```

### What NOT To Do

- Do NOT create a new `.gitlab-ci.yml` — modify the existing one
- Do NOT modify any lint jobs or `patrol:e2e`
- Do NOT use `needs:` keyword — stage-based ordering is sufficient
- Do NOT use `allow_failure: true` on any test job — tests MUST pass
- Do NOT add `artifacts:paths` for node_modules — only JUnit XML reports and coverage
- Do NOT remove the existing `flutter:test` coverage artifacts — keep `coverage/` path collection
- Do NOT add format checking or lint commands to test jobs — those belong in the lint stage
- Do NOT install Python system-wide — always use a venv

### Story 1-2 Learnings (MUST Apply)

1. **Hidden templates work** — `.node_base` and `.lint_node` were successfully reused. Create `.test_node` following the same pattern.
2. **Flutter before_script** — the `.flutter_base` template already handles SDK install, pub get, and e2e_secrets copy. The `flutter:test` job inherits this correctly.
3. **Cache prefix is required** — lint jobs use `lint-backend`, `lint-frontend`, etc. Test jobs must use `test-backend`, `test-frontend`, etc.
4. **Path `$PWD/../../flutter-sdk/bin`** — Flutter test jobs navigate into `mobile/genie_ai_mobile/` via `.flutter_base` before_script, so the SDK path needs `../../` to go back to the worktree root.

### References

- [Source: `.gitlab-ci.yml`] — existing CI configuration with lint stage and hidden templates
- [Source: `_bmad-output/planning-artifacts/epics.md` Epic 1 Story 1.3] — acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md` CI/CD Pipeline Architecture, Test Execution Tiers] — pipeline structure
- [Source: `_bmad-output/planning-artifacts/architecture.md` JUnit XML Reporting] — reporting configuration per runner
- [Source: `_bmad-output/project-context.md` Testing Rules] — test framework details per component
- [Source: `1-2-create-ci-pipeline-lint-stage.md`] — previous story patterns, hidden templates, cache strategy
- [Source: `components/gov-chat-backend/package.json`] — test script: `jest`, jest config embedded
- [Source: `components/gov-chat-frontend/package.json`] — test script: `jest --verbose`, jest.config.js
- [Source: `components/document-repository/package.json`] — test script: `jest`, jest.config.js
- [Source: `genie-ai-overlay/pyproject.toml` optional-dependencies.test] — pytest, pytest-asyncio, httpx, etc.
- [Source: `genie-ai-overlay/pytest.ini`] — testpaths=tests, asyncio_mode=auto
- [Source: `mobile/genie_ai_mobile/pubspec.yaml`] — flutter_test SDK, check for junitreport

### Project Structure Notes

- `.gitlab-ci.yml` is at repository root — this is the primary file modified in this story
- Reports directories (`reports/`, `**/reports/`) are already in `.gitignore` (from story 1-1)
- `genie-ai-overlay/` uses `venv` for Python isolation — never `--break-system-packages`
- Backend jest config is embedded in `package.json` under the `"jest"` key — no separate `jest.config.js`
- Frontend and doc-repo have separate `jest.config.js` files
- The `.flutter_base` template handles the full Flutter SDK setup, pub get, and e2e_secrets copy

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Story 1-1 merged into PRD — jest-junit configured in each component's jest config, Node.js jobs simply run `npm test`
- junitreport not in Flutter pubspec.yaml — flutter:test keeps `flutter test --coverage` only, JUnit XML pending story 1-1 adding junitreport
- `.test_node` template mutualizes: `NODE_ENV: test` and artifacts defaults (`when: always`, `expire_in: 7 days`)
- Each Node.js job only overrides: `before_script` (cd + npm ci), `script` (npm test), `cache`, `artifacts.reports.junit`, `rules`
- `flutter:test`: removed duplicate `flutter analyze` (already in `lint:dart`), added main branch rule, added `.gitlab-ci.yml` to changes
- Cache prefixes use `test-*` (not `lint-*`) to avoid cache pollution between stages

### File List

- `.gitlab-ci.yml` — modified: added `.test_node` template, 4 new test jobs (backend, frontend, doc-repo, python), updated `flutter:test`
