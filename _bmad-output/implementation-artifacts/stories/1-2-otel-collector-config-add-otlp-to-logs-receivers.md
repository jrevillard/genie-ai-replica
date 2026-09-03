---
key: 1-2-otel-collector-config-add-otlp-to-logs-receivers
title: otel-collector-config: add `otlp` to logs receivers
epic: epic-1
status: done
effort: 0.25
depends_on: []
files: configs/otel/otel-collector-config.yaml:183-189
baseline_commit: ffdab9c93
---

# Story 1.2 — otel-collector-config: add `otlp` to logs receivers

**Epic**: epic-1 (0.25 SP)
**Files**: `configs/otel/otel-collector-config.yaml:183-189`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Dev Agent Record

### Completion Notes

- Added `- otlp` as the first receiver in the `logs:` pipeline (line 185), keeping `fluent_forward` second so existing docker-fluentd log driver traffic keeps flowing.
- Ordering matches the `metrics:` pipeline (otlp leads) for visual consistency.
- No new receiver block: `otlp:` already declared at file top, bound to `:4318` (gRPC) and `:4318` HTTP via the standard OTel Collector defaults — same endpoint Node services use per `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`.
- YAML syntax validated via `yaml.safe_load`.
- Diff: +1 line (`configs/otel/otel-collector-config.yaml`).
- Branch: `feat/admin-logs-victorialogs/1-2-otel-collector-config-add-otlp-to-logs-receivers` (worktree `.claude/worktrees/admin-logs-1-2`), commit `013af06e9`.

### File List

- `configs/otel/otel-collector-config.yaml` (modified)

### Change Log

- 2026-09-03 — feat(otel-collector): add `otlp` receiver to logs pipeline (commit `402b774ab`, rebased; merged via MR !341 → PRD `51156328b`)
