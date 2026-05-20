# Story 1.5: Create CI Pipeline Configuration Validation Stage

Status: ready-for-dev

## Story

As a developer,
I want the CI pipeline to validate the environment configuration,
so that configuration drift and missing variables are caught automatically.

## Acceptance Criteria

1. **Given** the contract stage passes, **When** the config stage runs, **Then** the configuration validation suite executes in `tests/config-validator/`
2. The validation suite validates all env vars referenced in `docker-compose.yaml` are documented in the `env` template
3. The validation suite checks required secrets have no undefined defaults
4. The validation suite detects conflicting or orphaned configurations
5. The validation suite validates feature flag interdependencies (e.g., `DEPLOY_OPEA`)
6. JUnit XML reports are collected as CI artifacts
7. The stage completes in under 2 minutes (NFR2)

## Tasks / Subtasks

- [ ] Task 1: Create `tests/config-validator/` suite structure (AC: #1)
  - [ ] Create `tests/config-validator/package.json` with Jest and dependencies
  - [ ] Create `tests/config-validator/jest.config.js` with JUnit reporter (reuse pattern from story 1-1)
  - [ ] Ensure `reports/` output is covered by root `.gitignore` (added in story 1-1)

- [ ] Task 2: Create `tests/config-validator/validators/parse-env.js` — env template parser (AC: #2, #3)
  - [ ] Parse the `env` file (root, no extension) extracting all variable names, defaults, and sections
  - [ ] Distinguish required secrets (no default value, or empty default) from optional variables (with defaults)
  - [ ] Handle comment-based section headers (e.g., `# ========= Section 1 =========`)
  - [ ] Handle inline comments documenting variables
  - [ ] Export functions: `parseEnvTemplate(filePath)`, `getRequiredSecrets(parsed)`, `getOptionalVars(parsed)`

- [ ] Task 3: Create `tests/config-validator/validators/parse-compose.js` — docker-compose cross-reference (AC: #2, #4)
  - [ ] Parse `docker-compose.yaml` extracting all `${VAR}` and `${VAR:-default}` references
  - [ ] Extract variable name and default value (if any) from each reference
  - [ ] Cross-reference compose vars against env template: flag vars in compose but not in env (orphaned), vars in env but not in compose (undocumented usage)
  - [ ] Validate that defaults in docker-compose match defaults in env template
  - [ ] Export functions: `parseComposeEnvVars(filePath)`, `crossReference(composeVars, envVars)`

- [ ] Task 4: Create `tests/config-validator/validators/validate-features.js` — feature flag interdependency validator (AC: #5)
  - [ ] Define feature flag dependency map: `DEPLOY_OPEA` controls 13+ services (vllm, tei-embedding, embedding, retriever, reranker, chatqna, dataprep, translation, etc.)
  - [ ] Validate that when `DEPLOY_OPEA=0`, OPEA-related env vars are not required
  - [ ] Validate that when `DEPLOY_OPEA=1`, all OPEA service env vars are present
  - [ ] Check that GPU profile env files override correct variables
  - [ ] Export functions: `validateFeatureFlags(envVars, featureMap)`

- [ ] Task 5: Create `tests/config-validator/validators/validate-hardware.js` — GPU profile range checks (AC: #4)
  - [ ] Parse `env.t4` and `env.rtx6000` GPU profile files
  - [ ] Define valid ranges for GPU parameters:
    - `VLLM_GPU_UTILIZATION`: 0.1–0.95
    - `VLLM_MAX_MODEL_LEN`: 512–8192
    - `VLLM_MAX_NUM_SEQS`: 1–2048
    - `VLLM_DTYPE`: one of [half, auto, float16, bfloat16]
  - [ ] Validate GPU profile values fall within ranges
  - [ ] Validate T4 (16GB VRAM) uses conservative settings vs RTX6000 (24GB) uses aggressive settings
  - [ ] Export functions: `validateHardwareProfile(profilePath, profileName)`

- [ ] Task 6: Create `tests/config-validator/__tests__/config-validation.test.js` — Jest test suite (AC: #1–#6)
  - [ ] Test: all docker-compose env vars are documented in env template (AC #2)
  - [ ] Test: required secrets have no undefined defaults (AC #3)
  - [ ] Test: no orphaned or conflicting configurations (AC #4)
  - [ ] Test: DEPLOY_OPEA feature flag interdependencies (AC #5)
  - [ ] Test: GPU profile parameters within valid ranges (AC #4)
  - [ ] Test: GPU profile defaults in docker-compose match valid ranges
  - [ ] All tests produce JUnit XML via jest-junit reporter (AC #6)

- [ ] Task 7: Add `config` stage and CI job to `.gitlab-ci.yml` (AC: #1, #6, #7)
  - [ ] Add `contract` stage before `config` if not already present (depends on story 1-4)
  - [ ] Add `config` stage after `contract` in stages list
  - [ ] Create `config:validate` job extending `.node_base`
  - [ ] Set `stage: config`
  - [ ] `before_script`: `cd tests/config-validator && npm ci`
  - [ ] `script`: `npm test`
  - [ ] `cache`: keyed on `tests/config-validator/package-lock.json` with prefix `config-validate`
  - [ ] `artifacts:reports:junit`: collect `tests/config-validator/reports/jest-config.xml`
  - [ ] `artifacts:when: always` and `expire_in: 7 days`
  - [ ] `rules:changes`: trigger on `env`, `env.*`, `docker-compose.yaml`, `tests/config-validator/**/*`, `.gitlab-ci.yml` + main branch rule
  - [ ] Verify stage order: `lint → test → contract → config → e2e`

- [ ] Task 8: Validate end-to-end (AC: all)
  - [ ] Run `cd tests/config-validator && npm test` locally — all tests pass
  - [ ] Verify JUnit XML is produced at `tests/config-validator/reports/jest-config.xml`
  - [ ] Verify `.gitlab-ci.yml` stages order is correct
  - [ ] Run `npm run lint` from root — no lint errors
  - [ ] Verify execution time is under 2 minutes

## Dev Notes

### Dependency: Story 1-4 (Contract Test Stage)

Story 1-4 (`1-4-create-ci-pipeline-contract-test-stage`) is currently in **backlog** and has not been implemented. The `contract` stage does NOT yet exist in `.gitlab-ci.yml`. This story adds the `config` stage which runs AFTER `contract`.

**Action required:** Add both `contract` AND `config` stages to the stages list in `.gitlab-ci.yml`. If story 1-4 is implemented later, it will add its own contract jobs — the stage just needs to exist. The final stage order must be:

```
lint → test → contract → config → e2e
```

The current `.gitlab-ci.yml` has stages: `lint → test → e2e`. Insert `contract` and `config` between `test` and `e2e`.

### Architecture: Configuration Validation Approach

Per [Source: _bmad-output/planning-artifacts/architecture.md], the approach is a **hybrid programmatic validator in Node.js** that:
1. Parses the `env` template to extract all documented variables with types, defaults, sections
2. Cross-references `docker-compose.yaml` to find all `${VAR}` references
3. Validates every compose reference has a documented default or is a required secret
4. Checks hardware profile parameter ranges (GPU memory → valid model lengths)
5. Validates feature flag interdependencies (`DEPLOY_OPEA` controlling service topology)

### Existing CI Pipeline Patterns (from stories 1-1, 1-2, 1-3)

- **Hidden job templates** already defined: `.node_base` (image: node:20-alpine, interruptible: true), `.test_node` (extends .node_base, stage: test, NODE_ENV: test)
- **Cache pattern**: key per component keyed on lockfile, with prefixed keys (e.g., `config-validate`)
- **Artifacts pattern**: `when: always`, `expire_in: 7 days`, `reports.junit` for JUnit XML
- **Rules pattern**: `changes` for path-based MR triggering + `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` for main
- **JUnit XML paths** (from story 1-1):
  | Component | Report Path |
  |-----------|------------|
  | Backend | `components/gov-chat-backend/reports/jest-backend.xml` |
  | Frontend | `components/gov-chat-frontend/reports/jest-frontend.xml` |
  | Doc-repo | `components/document-repository/reports/jest-docrepo.xml` |
  | Python | `genie-ai-overlay/reports/pytest-report.xml` |
  | Flutter | `mobile/genie_ai_mobile/reports/flutter-report.xml` |
  | **Config** | `tests/config-validator/reports/jest-config.xml` (NEW) |

### Environment Variable Surface Area

**docker-compose.yaml** references ~100+ unique `${VAR}` substitutions:
- **16+ required secrets** (no defaults): `POSTGRES_PASSWORD`, `KONG_DB_PASSWORD`, `ARANGO_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `KC_DATAPREP_CLIENT_SECRET`, `KEYCLOAK_DB_PASSWORD`, `HUGGING_FACE_HUB_TOKEN`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `GENIE_ADMIN_PASSWORD`, `GENIE_ADMIN_EMAIL`, `TRANSLATION_CACHE_PASSWORD`
- **80+ optional variables** with defaults (e.g., `VLLM_GPU_UTILIZATION:-0.4`, `DEPLOY_OPEA:-1`)
- **Feature flag**: `DEPLOY_OPEA` (default: 1) controls 13+ OPEA service definitions

**env template** (597 lines, 13 sections) documents all variables with inline comments.

**GPU profiles**: `env.t4` (10 vars, T4 16GB VRAM conservative) and `env.rtx6000` (7 vars, RTX6000 ADA 24GB aggressive).

### Technology Constraints

- **CommonJS only** — use `require()`/`module.exports`, NEVER ES imports [Source: _bmad-output/project-context.md]
- **Jest** for test runner with `jest-junit` reporter (already configured in other components)
- **ESLint 10 + Prettier 3** — run `npm run lint` and `npm run format:check` before completing
- **No external YAML parser** — use a lightweight approach. Prefer `js-yaml` (common in Node.js ecosystem) or parse docker-compose YAML with minimal deps
- The `env` file uses `KEY=VALUE` format with comments — parse with a simple line-by-line parser (no dotenv needed, this is validation not loading)

### File Structure

```
tests/
├── config-validator/                  # NEW
│   ├── package.json                   # NEW: Jest + js-yaml + jest-junit
│   ├── jest.config.js                 # NEW: JUnit reporter config
│   ├── validators/                    # NEW
│   │   ├── parse-env.js               # NEW: env template parser
│   │   ├── parse-compose.js           # NEW: docker-compose cross-ref
│   │   ├── validate-features.js       # NEW: feature flag validator
│   │   └── validate-hardware.js       # NEW: GPU profile validator
│   └── __tests__/                     # NEW
│       └── config-validation.test.js  # NEW: Jest test suite
└── (existing files unchanged)
```

### Project Structure Notes

- All files go in `tests/config-validator/` at project root (per architecture spec)
- Validators are CommonJS modules in `validators/` subdirectory
- Jest tests in `__tests__/` following project convention
- The `config:validate` CI job is the only job in the `config` stage
- No changes to existing test files or CI jobs from stories 1-1, 1-2, 1-3

### Key Validation Rules

**AC #2 — Docker-compose ↔ env cross-reference:**
- Every `${VAR}` or `${VAR:-default}` in docker-compose.yaml must appear in the env template
- Defaults in docker-compose (`${VAR:-default}`) should match the env template's default value

**AC #3 — Required secrets check:**
- A variable is "required" if it has no default in docker-compose AND no default in env template
- Required secrets must be documented with a comment indicating they are required
- Empty-string defaults (e.g., `VLLM_API_KEY:-`) are acceptable (optional secrets)

**AC #4 — Orphaned/conflicting configs:**
- Orphaned: variable in env template but never referenced in docker-compose.yaml
- Conflicting: same variable with different defaults in docker-compose vs env template
- Variables only used in GPU profiles should be documented as GPU-specific

**AC #5 — Feature flag interdependencies:**
- When `DEPLOY_OPEA=0`: OPEA-related vars (`VLLM_*`, `TEI_*`, `EMBEDDING_*`, `RERANKER_*`, `RETRIEVER_*`, `CHATQNA_*`, etc.) are not required
- When `DEPLOY_OPEA=1`: all OPEA service vars must be present with valid defaults
- GPU profile files should only override GPU-specific vars, not service topology vars

**AC #7 — Performance (<2 minutes):**
- The validators run file I/O only (no network, no Docker)
- Parsing env + docker-compose + 2 GPU profiles should take <5 seconds
- Jest overhead adds ~10 seconds
- Total well under the 2-minute NFR2 budget

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — CI/CD Pipeline Architecture, Configuration Validation Architecture]
- [Source: _bmad-output/planning-artifacts/prd.md — FR27–FR31, FR39, NFR2]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1-5]
- [Source: _bmad-output/project-context.md — Technology constraints, testing rules]
- [Source: _bmad-output/implementation-artifacts/1-1-configure-junit-xml-reporting-for-all-test-runners.md — JUnit XML patterns]
- [Source: _bmad-output/implementation-artifacts/1-2-create-ci-pipeline-lint-stage.md — CI job patterns, hidden templates]
- [Source: _bmad-output/implementation-artifacts/1-3-create-ci-pipeline-test-stage.md — .test_node template, cache patterns]

## Dev Agent Record

### Agent Model Used

(incomplete)

### Debug Log References

- Story 1-4 (`1-4-create-ci-pipeline-contract-test-stage`) is in backlog — the `contract` stage does not yet exist in `.gitlab-ci.yml`
- Story 1-1 added `jest-junit` to all JS components and `reports/` to `.gitignore`
- Story 1-2 created hidden templates `.node_base` and `.lint_node` in `.gitlab-ci.yml`
- Story 1-3 created `.test_node` hidden template extending `.node_base`

### Completion Notes List

### File List
