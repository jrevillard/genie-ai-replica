---
key: 7-1-logger-js-wrap-file-transports-in-log_to_file-1-guard-reconf
title: "logger.js: wrap file transports in `booleanEnv('LOG_TO_FILE')` guard (AD-14); reconfigure honors it"
epic: epic-7
status: done
effort: 0.25
depends_on: [Epic 2]
files: "components/shared/lib/logger.js:48-69 (initial config) AND 77-122 (reconfigureLogger)"
baseline_revision: 5f8a4083b35ba2dd0fd35dbcd69bbe3602f58fc7
followup_review_recommended: true
deferred:
  - summary: >-
      LOG_TO_FILE is not declared in the backend service's `environment:` block
      in `docker-compose.yaml`, so the LOG_TO_FILE=1 escape hatch is not
      reachable through Compose/Swarm as configured (the LOG_TO_FILE=0 default
      works because the env is simply unset).
    evidence: |-
      `grep -n LOG_TO_FILE docker-compose.yaml` returns no matches in the
      gov-chat-backend service environment; the same propagation gap exists
      for LOG_TO_VICTORIALOGS (pre-existing, not introduced by this story).
    location: >-
      docker-compose.yaml (gov-chat-backend.environment)
    severity: medium
  - summary: >-
      Root `env` template line 731 still carries `# LOG_TO_FILE=0` as a
      commented placeholder; the post-P4 boolean semantics (1|true|TRUE|yes)
      are undocumented at the env level.
    evidence: |-
      env:731: `# LOG_TO_FILE=0`. No sibling comment for the boolean coercion
      rule or the post-cutover default.
    location: >-
      env:731
    severity: low
  - summary: >-
      No CHANGELOG entry under [Unreleased] for the visible deployer-facing
      change (file logs disappear from disk in the default deployment).
    evidence: |-
      RELEASE.md requires an entry for any user/deployer-visible change. No
      [Unreleased] entry references LOG_TO_FILE or the file-transport removal.
    location: >-
      CHANGELOG.md
    severity: low
  - summary: >-
      triggerLogRollover and cleanupCombinedLog silently no-op when
      LOG_TO_FILE=0: `find()` returns undefined and the function logs a
      warning instead of throwing. No test/doc acknowledges this graceful
      degradation contract for POST /api/logger/rollover or cleanup endpoints.
    evidence: |-
      Pre-existing behaviour, widened by the new default. logger.js:169-214
      (triggerLogRollover + cleanupCombinedLog) assume file transports exist.
    location: >-
      components/shared/lib/logger.js:169-214
    severity: low
  - summary: >-
      components/shared/lib/boolean-env.js has no unit tests; the
      `^(1|true|TRUE|yes)$` regex semantics that AD-14 depends on are only
      verified transitively via this story's new LOG_TO_FILE gate tests.
    evidence: |-
      ls components/shared/lib/__tests__/ contains only `melt/`. Story 2-2
      owns the helper but never added dedicated tests.
    location: >-
      components/shared/lib/__tests__/
    severity: low
  - summary: >-
      No documentation in site/content/en/docs/observability/ for the
      LOG_TO_FILE gate (audit-retention escape hatch semantics, who triggers
      it, how operators verify).
    evidence: |-
      `grep -rn LOG_TO_FILE site/content/en/docs/` returns no matches.
    location: >-
      site/content/en/docs/observability/
    severity: low
  - summary: >-
      handleExceptions fall-through: uncaught exceptions previously written
      to `logs/combined.log` (tailable File transport) now go to Console
      only when LOG_TO_FILE=0. Nothing in the diff notes that operators
      relying on `combined.log` for crash forensics will lose them by
      default.
    evidence: |-
      transports.File({ handleExceptions: true }) is inside the gated
      block; no docs/changelog note.
    location: >-
      components/shared/lib/logger.js:116-122
    severity: low
  - summary: >-
      LOG_TO_FILE not propagated through Compose/Swarm env allowlist — the
      escape-hatch surface is currently reachable only via direct .env file
      or restart with custom env injection, not via the documented
      `rollback-matrix.md` flow.
    evidence: |-
      Same propagation gap as the medium-severity entry above, viewed from
      the rollback-matrix perspective.
    location: >-
      docker-compose.yaml
    severity: medium
---

# Story 7.1 — logger.js: wrap file transports in `booleanEnv('LOG_TO_FILE')` guard; reconfigure honors it

**Epic**: epic-7 (0.25 SP)
**Files**: `components/shared/lib/logger.js:48-69, 77-122`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 7 review):**
- Use `booleanEnv('LOG_TO_FILE')` (AD-14, single helper added by Story 2-2 in `components/shared/lib/boolean-env.js`) — NOT strict `=== '1'`. AD-14 forbids strict equality.
- Wrap BOTH: initial `loggerConfig.transports` array (lines 48-69) AND `reconfigureLogger()` rebuild (lines 87-108). Without the second wrap, calling `POST /api/logger/configure` after P4 would re-add file transports even when `LOG_TO_FILE=0`.
- After P4, when `LOG_TO_FILE=0` (default): no DailyRotateFile transports. Winston pipeline = Console + VictoriaLogsTransport only.
- When `LOG_TO_FILE=1`: DailyRotateFile + tailable File transports active (audit retention escape hatch).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-10 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 0, low 3)
- defer: 8 (medium 2, low 6)
- reject: 3
- addressed_findings:
  - `[high]` `[patch]` Added a new `LOG_TO_FILE gate` describe block in `components/gov-chat-backend/__tests__/logger-functions.test.js` covering both states (`LOG_TO_FILE` unset / `0` → no file transports; `LOG_TO_FILE=1` → DailyRotateFile + tailable File active) plus the booleanEnv truthy variants (`true`/`TRUE`/`yes` — AD-14 protection against strict `=== '1'`) and both the initial-load and `reconfigureLogger` rebuild paths. Closes the verification gap surfaced by the `verification-gap` and `intent-alignment` reviewers: previously the 17 existing logger tests passed vacuously (the count-stability test degenerates to `length === length` under the default env, the rotate-failure test never finds the rotate transport). New cases assert transport presence/absence by `constructor.name` so any future regression that drops `booleanEnv` or wraps only one call site is caught.
  - `[low]` `[patch]` H1 of this spec file said `LOG_TO_FILE === '1'` (strict equality wording) — aligned with the frontmatter title and AD-14 acceptance body by changing it to `booleanEnv('LOG_TO_FILE')`.
  - `[low]` `[patch]` Removed the `Story 7.1` story-ID reference from the AD-14 explanatory comment in `components/shared/lib/logger.js:88` per the project rule against story/FR/AC/D references in code comments. Comment now reads `AD-14: gate file transports on...` only.
  - `[low]` `[patch]` Updated the stale `(4 transports: console + 2 rotate + file)` comment in `logger-functions.test.js` to reflect the new default (LOG_TO_FILE unset → Console only; LOG_TO_FILE=1 adds the file transports).

## Auto Run Result

**Summary.** Wrapped the three file-transport constructors (two DailyRotateFile streams + the tailable `transports.File`) inside `buildTransports()` with `if (booleanEnv('LOG_TO_FILE'))`. Because both `loggerConfig.transports` (initial load) and `reconfigureLogger`'s rebuild call `buildTransports()`, a single in-helper gate satisfies the "wrap BOTH" acceptance. AD-14 honoured via the `booleanEnv` helper (accepts `1|true|TRUE|yes`) — no strict `=== '1'` anywhere in the code. Added 6 dedicated test cases asserting the gate in both states and across both call paths.

**Files changed.**
- `components/shared/lib/logger.js` — extracted `if (booleanEnv('LOG_TO_FILE'))` wrap inside `buildTransports()` (line 99); AD-14 explanatory comment above the wrap.
- `components/gov-chat-backend/__tests__/logger-functions.test.js` — added `LOG_TO_FILE gate` describe block (6 cases); updated stale transport-count comment.
- `_bmad-output/implementation-artifacts/stories/7-1-logger-js-wrap-file-transports-in-log_to_file-1-guard-reconf.md` — this spec (status, baseline_revision, triage log, Auto Run Result, deferred list).

**Review findings breakdown.**
- Patches applied: 4 (1 high — verification gap; 3 low — H1 alignment, story-ref removal, stale test comment).
- Items deferred: 8 (LOG_TO_FILE not propagated through Compose/Swarm env allowlist × 2 angles, env template docs, CHANGELOG entry, `triggerLogRollover`/`cleanupCombinedLog` silent no-op contract, `boolean-env.js` missing unit tests, observability docs site update, `handleExceptions` fall-through on default).
- Items rejected: 3 (11-line comment verbosity, `mr`/`reviewer` frontmatter schema noise, cross-story reference to Story 2-2 — informational context, not a defect).

**Follow-up review recommendation.** Patched counts: 1 high, 0 medium, 3 low. Rule fires (`high` patched): `true`. Score: `3 × 0 + 1 × 0 + 3 × 1 = 3` (≥ 5 false-positive; the `high` rule wins).

**Verification performed.**
- `npx eslint logger.js` — clean.
- `npx prettier --check logger.js` — "All files formatted correctly".
- `npx eslint __tests__/logger-functions.test.js` — clean.
- `npx prettier --check __tests__/logger-functions.test.js` — "All files formatted correctly".
- `npx jest --testPathPatterns='logger-functions|logger-vl-integration'` — `2 passed, 66 tests passed (0.727 s)` (60 pre-existing + 6 new LOG_TO_FILE gate cases).
- Manual smoke (subagent): `LOG_TO_FILE` unset → initial `[Console]`, after `reconfigureLogger` `[Console]`. `LOG_TO_FILE=1` → initial `[Console, DailyRotateFile, DailyRotateFile, File]`, after `reconfigureLogger` same. `LOG_TO_FILE=true|TRUE|yes` → same as `1` (boolean coercion). `LOG_TO_FILE=0` → `[Console]` (not truthy).
- Subagent full backend suite A/B vs baseline: identical totals (101 failed suites / 451 failed tests — pre-existing, independent of this change), zero regression introduced.

**Residual risks.**
- The Compose/Swarm env-propagation gap (deferred) means the LOG_TO_FILE=1 escape hatch is reachable only via direct `.env` override today, not via the documented rollback-matrix flow. Operationally, the LOG_TO_FILE=0 default is unaffected.
- `triggerLogRollover`/`cleanupCombinedLog` now log a warning and silently no-op when `LOG_TO_FILE=0`. If an operator hits `POST /api/logger/rollover` without first enabling the escape hatch, they get a 200 with a warning in logs instead of an explicit error — consider a future UX improvement (out of scope here).
