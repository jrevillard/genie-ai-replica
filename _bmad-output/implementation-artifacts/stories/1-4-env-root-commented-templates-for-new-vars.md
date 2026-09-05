---
key: 1-4-env-root-commented-templates-for-new-vars
title: "env (root): commented templates for new vars"
epic: epic-1
status: done
effort: 0.1
depends_on: []
files: env (Section 12C)
baseline_revision: 10e9fdf12
followup_review_recommended: false
context:
  - _bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md
  - _bmad-output/planning-artifacts/epics.md
---

# Story 1.4 — env (root): commented templates for new vars

**Epic**: epic-1 (0.1 SP)
**Files**: `env` (Section 12C)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-04 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 31
- addressed_findings:
  - none

Reviewers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) raised 31 candidate findings total. All were documentation/style concerns about the `env` file's per-var comment block (boolean-truthy enumeration, value-whitelist spelling, format constraint, priority ordering, cross-var dependency map, opaque CAP-7 reference, etc.), plus one observation that `tests/config-validator/` lacks coverage for the new vars. None were code defects:

- 17 blind-hunter findings: all rejected — the project's existing commented env entries (`# ENABLE_OBSERVABILITY=0`, `# OTEL_TRACES_SAMPLER_RATE=100.0`, etc.) follow the same concise one-line pattern; the diff matches that style.
- 10 edge-case findings: all rejected — runtime value-coercion and tenant-format behaviour is owned by the consuming code (logger.js / VictoriaLogsClient / config-validator), not by `env` comments.
- 0 verification-gap findings: clean.
- 4 intent-alignment findings: rejected — the diff implements Reading B (full 10-var set per `env-vars.md` "New vars" table). Test coverage for `MELT_PROVIDER` is owned by Story 4-6 (`tests-config-validator-whitelist-melt_provider-victorialogs`); not this story's scope.

## Auto Run Result

Status: done
Follow-up review recommended: false (no patched findings; severity score = 0)

### Summary of implemented change

Added 43 commented template lines in `env` (Section 12C, after line 686, before line 690 secret) introducing the 10 new env vars from the admin-logs migration per `env-vars.md` "New vars" table: `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `VICTORIALOGS_URL`, `VICTORIALOGS_TENANT_ID`, `VL_QUERY_TIMEOUT_MS`, `LOG_TO_VICTORIALOGS`, `MELT_PROVIDER`, `VL_FAIL_OPEN`, `ADMIN_LOGS_SOURCE`, `SECURITY_SCAN_BACKEND`, `LOG_TO_FILE`. Each line is `#`-prefixed so `set -a; source env` stays inert; defaults mirror the values declared in `deploy/ansible/templates/env.j2` and `docker-compose.yaml`. Pre-existing commented entries (`ENABLE_OBSERVABILITY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, retentions, KONG_TRACING_*, GRAFANA_*) are untouched.

### Files changed

- `env` — +43 commented lines (Section 12C), no removals/reorderings of pre-existing entries.
- `_bmad-output/implementation-artifacts/stories/1-4-env-root-commented-templates-for-new-vars.md` — frontmatter bookkeeping (`status`, `baseline_revision`, `context`, this Auto Run Result, Review Triage Log).

### Review findings breakdown

- Patches applied: 0
- Items deferred: 0
- Items rejected: 31

### Verification performed

- `grep -nE '^(# )?(VICTORIALOGS_URL|OTEL_EXPORTER_OTLP_LOGS_ENDPOINT|VICTORIALOGS_TENANT_ID|VL_QUERY_TIMEOUT_MS|LOG_TO_VICTORIALOGS|MELT_PROVIDER|VL_FAIL_OPEN|ADMIN_LOGS_SOURCE|SECURITY_SCAN_BACKEND|LOG_TO_FILE)=' env` returns 10 matches, all `#`-prefixed.
- `git diff env` confirms +43 lines only (no removals, no reordering of pre-existing entries).
- `git status --short` pre-commit confirmed only `env` + spec file modified.
- Story spec acceptance criteria reference `SPEC.md` and `epics.md#1` (epic-level), satisfied by the var-list match above.

### Residual risks

None for the immediate change. Forward-looking concern noted by intent-alignment auditor (not actionable here): test-side coverage of the new var set is owned by Story 4-6 (`tests-config-validator-whitelist-melt_provider-victorialogs`).
