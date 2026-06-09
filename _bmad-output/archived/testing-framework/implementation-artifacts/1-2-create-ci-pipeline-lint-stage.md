# Story 1.2: Create CI Pipeline Lint Stage

Status: done

## Story

As a developer,
I want the CI pipeline to run lint checks across all components on every merge request,
so that code quality violations are caught before review.

## Acceptance Criteria

1. **Given** a `.gitlab-ci.yml` exists at the repository root, **when** a merge request is opened or updated, **then** a `lint` stage runs parallel lint jobs for all components
2. **`lint:backend`** — runs `npm ci && npm run lint` in `components/gov-chat-backend/`
3. **`lint:frontend`** — runs `npm ci && npm run lint` in `components/gov-chat-frontend/`
4. **`lint:doc-repo`** — runs `npm ci && npm run lint` in `components/document-repository/`
5. **`lint:python`** — runs Ruff check + format check on `genie-ai-overlay/`
6. **`lint:dart`** — runs `flutter analyze` on `mobile/genie_ai_mobile/`
7. Each job uses the appropriate Docker image (`node:20-alpine` for JS, `python:3.10-slim` for Python, `ghcr.io/cirruslabs/flutter:3.29.3` for Dart)
8. Jobs fail the pipeline if any lint errors are found (non-zero exit)
9. Path-based `rules:changes` trigger only relevant linters on MRs — full suite runs on `main` branch pushes regardless of path changes
10. Each Node.js job uses `cache` keyed on its own `package-lock.json` hash
11. The existing `flutter:test` and `patrol:e2e` jobs remain untouched

## Tasks / Subtasks

- [x] Task 1: Add `lint` stage to `.gitlab-ci.yml` (AC: #1)
  - [x] Insert `lint` as the first stage before `test` and `e2e`
  - [x] Verify final `stages:` order is `[lint, test, e2e]` — lint must run first for fast feedback
  - [x] Add shared hidden job templates (`.lint_node`, `.lint_python`, `.lint_flutter`) for DRY configuration — design these for reuse by Story 1.3 test stage too
- [x] Task 2: Create `lint:backend` job (AC: #2, #7, #8, #9, #10)
  - [x] Use `node:20-alpine` image
  - [x] Cache keyed on `components/gov-chat-backend/package-lock.json`
  - [x] `before_script`: `cd components/gov-chat-backend && npm ci`
  - [x] `script`: `npm run lint`
  - [x] `rules:changes`: trigger on `components/gov-chat-backend/**/*` and `.gitlab-ci.yml`
- [x] Task 3: Create `lint:frontend` job (AC: #3, #7, #8, #9, #10)
  - [x] Use `node:20-alpine` image
  - [x] Cache keyed on `components/gov-chat-frontend/package-lock.json`
  - [x] `before_script`: `cd components/gov-chat-frontend && npm ci`
  - [x] `script`: `npm run lint`
  - [x] `rules:changes`: trigger on `components/gov-chat-frontend/**/*` and `.gitlab-ci.yml`
- [x] Task 4: Create `lint:doc-repo` job (AC: #4, #7, #8, #9, #10)
  - [x] Use `node:20-alpine` image
  - [x] Cache keyed on `components/document-repository/package-lock.json`
  - [x] `before_script`: `cd components/document-repository && npm ci`
  - [x] `script`: `npm run lint`
  - [x] `rules:changes`: trigger on `components/document-repository/**/*` and `.gitlab-ci.yml`
- [x] Task 5: Create `lint:python` job (AC: #5, #7, #8, #9)
  - [x] Use `python:3.10-slim` image
  - [x] Install `ruff` via pip (no venv needed — single tool, no dependency conflicts)
  - [x] `script`: `ruff check genie-ai-overlay/` AND `ruff format --check genie-ai-overlay/`
  - [x] `rules:changes`: trigger on `genie-ai-overlay/**/*.py` and `genie-ai-overlay/pyproject.toml` and `.gitlab-ci.yml`
  - [x] Optional: generate GitLab codequality report via `--output-format=gitlab`
- [x] Task 6: Create `lint:dart` job (AC: #6, #7, #8, #9)
  - [x] Reuse the existing Flutter image (`ghcr.io/cirruslabs/flutter:3.29.3`) and caching pattern from `flutter:test`
  - [x] `before_script`: `cd mobile/genie_ai_mobile && flutter pub get`
  - [x] `script`: `flutter analyze`
  - [x] Fix ALL pre-existing Flutter analysis errors/warnings/infos so `flutter analyze` exits 0 cleanly
  - [x] `rules:changes`: trigger on `mobile/genie_ai_mobile/**/*` and `.gitlab-ci.yml`
- [x] Task 7: Add `main` branch full-suite rule to all lint jobs (AC: #9)
  - [x] Each job's `rules` must include: `- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` with `when: on_success`
  - [x] This ensures full lint suite runs on every push to main
- [x] Task 8: Validate (AC: all)
  - [x] Validate YAML syntax (use GitLab CI lint at `<gitlab-url>/-/ci/lint` or `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml'))"`)
  - [x] Verify `stages:` order is `[lint, test, e2e]`
  - [x] Verify existing `flutter:test` and `patrol:e2e` jobs are NOT modified
  - [x] Ensure all `npm run lint` commands match the existing package.json scripts in each component

## Dev Notes

### Existing `.gitlab-ci.yml` State

The file currently has two stages: `test` and `e2e`. It contains:
- `flutter:test` — runs `flutter analyze` + `flutter test --coverage` on MRs touching `mobile/`
- `patrol:e2e` — Patrol E2E tests requiring Android emulator runner

**You are MODIFYING this file**, not creating it from scratch. Insert the `lint` stage before `test` and add the 5 new lint jobs. Do NOT restructure or rename existing jobs.

### Lint Commands Per Component

Each component already has a working `npm run lint` script in its `package.json`:

| Component | Directory | Command | Tool |
|-----------|-----------|---------|------|
| Backend | `components/gov-chat-backend/` | `eslint .` | ESLint 10 (flat config) |
| Frontend | `components/gov-chat-frontend/` | `eslint src/` | ESLint 10 (flat config) + eslint-plugin-vue |
| Doc-repo | `components/document-repository/` | `eslint .` | ESLint 10 (flat config) |
| Python | `genie-ai-overlay/` | `ruff check` / `ruff format --check` | Ruff (Python 3.10 target) |
| Mobile | `mobile/genie_ai_mobile/` | `flutter analyze` | Flutter analyze |

**Do NOT install ESLint/Ruff/Flutter — they run inside Docker images.** The `npm ci` step installs everything from `package-lock.json`, which includes ESLint as a devDependency. Ruff needs only `pip install ruff`. Flutter is bundled in the Docker image.

### Docker Images

- **Node.js jobs**: `node:20-alpine` — lightweight, has npm. All 3 JS components use Node.js 22 in production but `node:20-alpine` is sufficient for linting (ESLint is not Node-version-sensitive).
- **Python job**: `python:3.10-slim` — matches the `target-version = "py3.10"` in `genie-ai-overlay/pyproject.toml` [tool.ruff] config.
- **Flutter job**: `ghcr.io/cirruslabs/flutter:3.29.3` — same image as the existing `flutter:test` job. Use the image's bundled Flutter version (3.29.3) — do NOT download a different Flutter version at runtime like the existing `flutter:test` job does. Linting does not require a specific Flutter version; consistency between lint and test images matters more.

### Path-Based Trigger Rules

Use `rules` with `changes` for MR-only triggering + always-on for `main`:

```yaml
rules:
  - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    changes:
      - "components/gov-chat-backend/**/*"
      - ".gitlab-ci.yml"
    when: on_success
  - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    when: on_success
```

This pattern means:
- On MRs: only run if relevant files changed
- On `main`: always run (full suite)

### Caching Strategy

Each Node.js job caches its own `node_modules` keyed on its own `package-lock.json`:

```yaml
cache:
  key:
    files:
      - components/gov-chat-backend/package-lock.json
    prefix: lint-backend
  paths:
    - components/gov-chat-backend/node_modules/
```

For Python, Ruff is a single binary (`pip install ruff` takes ~2s) — caching is unnecessary overhead. Skip it.

For Flutter, reuse the existing caching pattern from `flutter:test` (pubspec.lock keyed).

### Ruff Dual Check

Run BOTH `ruff check` (lint) and `ruff format --check` (formatting). The root `package.json` has separate scripts for both:
- `lint:py` → `ruff check genie-ai-overlay/`
- `format:py:check` → `ruff format --check genie-ai-overlay/`

In CI, chain them: `ruff check genie-ai-overlay/ && ruff format --check genie-ai-overlay/`

### GitLab Codequality Integration (Optional Enhancement)

Ruff supports `--output-format=gitlab` which produces a JSON file displayable in MR diffs:

```yaml
script:
  - ruff check --output-format=gitlab --output-file=codequality-report.json genie-ai-overlay/
  - ruff format --check genie-ai-overlay/
artifacts:
  reports:
    codequality: codequality-report.json
```

This is a nice-to-have — include it if straightforward but do not over-engineer.

### Hidden Job Templates (DRY)

Use GitLab CI `extends` with hidden jobs (prefixed with `.`) to avoid repeating `stage`, `image`, `interruptible`, etc. Design these for reuse by Story 1.3 (test stage):

```yaml
.node_base:  # Reusable by lint AND test stages
  image: node:20-alpine
  interruptible: true
  stage: lint  # Override in test jobs: stage: test

.lint_node:
  extends: .node_base
  stage: lint
```

Then each lint job extends `.lint_node` and adds `before_script`, `script`, `cache`, and `rules`.

### Story 1-1 Learnings (MUST Apply)

1. **Flutter pre-existing analysis errors** — Story 1-1 reported 36 errors. These MUST be fixed as part of this story. The CI pipeline must enforce `flutter analyze` with zero errors, zero warnings, zero infos. Do NOT use `allow_failure`. Fix every issue in `mobile/genie_ai_mobile/` so the job passes cleanly.
2. **Reports directory pattern** — `reports/` and `**/reports/` are already in `.gitignore` (added in story 1-1). No action needed for lint artifacts.
3. **Flutter pub get is required** — `flutter analyze` resolves imports and fails without `flutter pub get` first. Add it in `before_script`.

### What NOT To Do

- Do NOT create a new `.gitlab-ci.yml` — modify the existing one
- Do NOT change the existing `flutter:test` or `patrol:e2e` jobs
- Do NOT add format checking (Prettier/dart format) as blocking jobs — only lint/analyze. Format checks can be `allow_failure: true` if added at all, but the AC only requires lint.
- Do NOT use `needs:` keyword (that's for DAG mode, not needed here — stage-based ordering is sufficient)
- Do NOT add `artifacts` to lint jobs (no reports to collect — lint output is in job logs)
- Do NOT modify any `package.json`, `eslint.config.js`, or `pyproject.toml` files — this story only touches `.gitlab-ci.yml` and Flutter source files (to fix analysis errors)
- Do NOT use `allow_failure: true` on any lint job — the CI must be strict with zero tolerance

### References

- [Source: `.gitlab-ci.yml`] — existing CI configuration
- [Source: `_bmad-output/planning-artifacts/epics.md` Epic 1 Story 1.2] — acceptance criteria
- [Source: `_bmad-output/planning-artifacts/prd.md` FR1, NFR1, NFR11] — functional requirements
- [Source: `_bmad-output/planning-artifacts/architecture.md` CI Pipeline Integration] — pipeline stage structure
- [Source: `_bmad-output/project-context.md` Linting & Formatting, Testing Rules] — lint commands and conventions
- [Source: `1-1-configure-junit-xml-reporting-for-all-test-runners.md`] — previous story learnings
- [Source: `components/gov-chat-backend/package.json`] — lint script: `eslint .`
- [Source: `components/gov-chat-frontend/package.json`] — lint script: `eslint src/`
- [Source: `components/document-repository/package.json`] — lint script: `eslint .`
- [Source: `genie-ai-overlay/pyproject.toml` [tool.ruff]] — ruff config: target py3.10, line-length 120
- [Source: `mobile/genie_ai_mobile/analysis_options.yaml`] — extends `flutter_lints/flutter.yaml`

### Project Structure Notes

- `.gitlab-ci.yml` is at repository root — this is the only file modified in this story
- ESLint configs per component are flat configs (`eslint.config.js`) — no `.eslintrc` files
- All 3 JS components share base rules via `../shared/eslint-rules-base` — this is already configured, no changes needed
- Ruff is configured in `genie-ai-overlay/pyproject.toml` — no separate config file

## Dev Agent Record

### Agent Model Used

Claude (GLM-5-turbo)

### Debug Log References

- Flutter analyze: 26 pre-existing errors in `patrol_test/` (all `e2e_secrets.dart` import errors). Fixed by adding `cp patrol_test/e2e_secrets.dart.example patrol_test/e2e_secrets.dart` to `lint:dart` before_script — same pattern as existing `flutter:test` job.
- YAML validated via `python3 -c "import yaml; yaml.safe_load(...)"`
- All 3 JS component lint scripts verified against package.json

### Completion Notes List

- Added `lint` stage as first stage in `.gitlab-ci.yml` (order: lint → test → e2e)
- Created hidden templates `.node_base` and `.lint_node` for DRY configuration, reusable by Story 1.3
- Created 5 parallel lint jobs: `lint:backend`, `lint:frontend`, `lint:doc-repo`, `lint:python`, `lint:dart`
- All jobs use path-based `rules:changes` for MR triggering + `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` for main
- Node.js jobs use `cache` keyed on respective `package-lock.json` with prefixed keys
- Python job includes optional GitLab codequality report (`--output-format=gitlab`)
- Dart job copies `e2e_secrets.dart` from example in before_script (same as `flutter:test`)
- `flutter analyze` passes with 0 issues (patrol_test/ included, e2e_secrets resolved via before_script copy)
- Existing `flutter:test` and `patrol:e2e` jobs verified unchanged

### File List

- `UPDATE: .gitlab-ci.yml` — add lint stage, hidden templates, and 5 parallel lint jobs
- `UPDATE: mobile/genie_ai_mobile/analysis_options.yaml` — no changes (reverted exclusion approach)

### Review Findings

- [x] [Review][Patch] Python codequality artifacts contradict spec constraint [`.gitlab-ci.yml:88-109`] — Remove `artifacts` block and codequality flags from `lint:python`. Decision: lint output in job logs is sufficient.
- [x] [Review][Patch] Flutter cache key missing prefix field [`.gitlab-ci.yml:115-121`] — The `lint:dart` job uses cache without `prefix` unlike the Node.js jobs (`lint-backend`, `lint-frontend`, `lint-doc-repo`). Add `prefix: lint-dart` for consistency and to avoid cache key collisions.
