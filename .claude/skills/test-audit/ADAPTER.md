# Adapter — OpenClaw → GENIE.AI mapping

Reference for humans reading this skill. The skill itself (`SKILL.md`) is
self-contained for Claude Code; this file documents the translation choices
made when adapting from the upstream `openclaw/openclaw` SKILL.md (September
2026). Upstream principles (authoring gate, junk patterns, retention bar,
candidate evidence, validation) are framework-agnostic and kept verbatim;
in-repo specifics replace only the tooling refs.

## Tooling mapping

| OpenClaw upstream                  | GENIE.AI adaptation                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `vitest`                           | Jest (Node/Vue) / pytest (OPEA) / Playwright (E2E) / flutter_test (Dart)                                     |
| `node scripts/run-vitest.mjs`      | `npm test` per component / `pytest` / `npx playwright test` / `flutter test`                                |
| `scripts/check-changed.mjs`        | `npm run lint` + `ruff check genie-ai-overlay/` + `flutter analyze` (root `package.json` scripts)            |
| `$openclaw-testing`                | per-component test runner via root `package.json` scripts                                                    |
| `$autoreview`                      | `pr-review-toolkit:code-reviewer` (preferred) or `bmad-code-review`                                          |
| `$openclaw-pr-maintainer`          | `glab mr create --fill-yes` + `glab mr merge`                                                                 |
| `scripts/pr` flow                  | MR via `glab`, validation per `.claude/rules/EL-SALVADOR-WORKFLOW.md` (3 paths)                              |
| `AGENTS.md` (generic upstream)     | `CLAUDE.md` (this repo's actual file); `AGENTS.md` is a symlink to it at repo root                          |
| `extensions/` (plugins)            | `components/`, `genie-ai-overlay/`, `mobile/genie_ai_mobile/`, `tests/e2e/`, `tests/config-validator/`        |

## Component ↔ test framework

| Path                                | Framework                         | Test command                                                                  |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `components/gov-chat-backend/`      | Jest (Node, CommonJS)             | `cd components/gov-chat-backend && npm test`                                  |
| `components/gov-chat-frontend/`     | Jest (Vue 3, jsdom)               | `cd components/gov-chat-frontend && npm test`                                 |
| `components/document-repository/`   | Jest (Node, CommonJS)             | `cd components/document-repository && npm test`                               |
| `components/shared/lib/`            | Jest (Node, CommonJS)             | `cd components/shared/lib && npm test`                                        |
| `genie-ai-overlay/tests/`           | pytest (mocked `comps`)           | `cd genie-ai-overlay && pytest`                                               |
| `genie-ai-overlay/contracts/`       | pytest (real vendored `comps`)    | in-image run, see `.claude/rules/TESTING.md` (deliberate sibling, not child)  |
| `tests/e2e/`                        | Playwright                        | `npm run test:e2e` (single worker, no parallel)                                |
| `mobile/genie_ai_mobile/test/`      | flutter_test                      | `cd mobile/genie_ai_mobile && flutter test`                                   |
| `tests/config-validator/`           | Jest (Node)                       | `cd tests/config-validator && npm test`                                       |

## Test-only support seams to watch

- `__mocks__/` and `__tests__/mocks/` — Jest module-level mocks; check for
  exports used only by removed specs. The `moduleNameMapper` pattern in
  `jest.config.js` (used in both backend and frontend) makes these subtle:
  verify the alias target still has a consumer before deleting the export.
- `__tests__/fixtures/` — data only consumed by retired tests.
- `moduleNameMapper` entries in `jest.config.js` — aliases that exist solely
  to support deleted specs (`@/` → `<rootDir>/src/` in the frontend is a
  legitimate mapper and must NOT be removed even if no current spec
  exercises it; treat mappers with care).
- `genie-ai-overlay/tests/conftest.py` — pytest fixtures mocking `comps`,
  ArangoDB, and model endpoints. The mock-the-asserted-behavior junk pattern
  is the most common failure mode here (see `.claude/rules/TESTING.md` and
  the in-image contract suite pattern).
- Production tracing seams (`tracing.js`, `tracing.py`) — exported span
  helpers may be used only by tests; verify by grep before deleting.

## Repository conventions that constrain edits

- `feedback_never_merge_without_ci.md` — CI pipeline must pass on the source
  branch before any merge.
- `feedback_worktree_branch_isolation.md` — one branch per worktree; never
  `git checkout` inside a worktree.
- `feedback_local_checks_full_suite.md` — run `npm run lint` +
  `npm run format:check` (root scripts cover all 4 JS components) before
  pushing. `ast.parse` is not verification; only the actual lint/format
  scripts are.
- `feedback_no_dead_code.md` — delete dead mocks/branches/imports/comments;
  never defer with "harmless".
- `feedback_check_branch_before_analysis.md` — diagnose against the actually
  deployed branch; release branches often already contain the fix.
- `feedback_verify_reviewer_subagent_claims.md` — parallel reviewers
  over-correct; verify findings against code before applying.

## Manual gates (no CI job)

These are not covered by `npm test` / `pytest` / lint. Run them when
relevant:

- `./tests/otel-collector/run-pii-smoke.sh` — PII redactor smoke test for
  any change touching `configs/otel/otel-collector-config.yaml` or
  `configs/otel/pii-key-list.md`. Two failure modes it catches: OTTL parse
  errors that crash the collector, and redaction that silently stopped
  matching (PII reaches VictoriaLogs unredacted).

## Attribution

Adapted from
[`openclaw/openclaw`](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/),
September 2026. Upstream principles (authoring gate, junk patterns, retention
bar, candidate evidence, validation) are framework-agnostic and kept verbatim.
Tooling-specific sections (validation, discovery, edit shape) reworked for
this repo's Jest/pytest/Playwright/flutter_test split and to reference
in-repo memory + rules instead of generic OpenClaw placeholders.