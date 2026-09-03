---
key: 1-1-docker-compose-vl-collector-profiles-core
title: docker-compose: VL + Collector → profiles:[core]
epic: epic-1
status: review
effort: 0.5
depends_on: []
files: docker-compose.yaml:1650,1671,1749
baseline_commit: ffdab9c938345584405dcb95bf3e77494c5549db
---

# Story 1.1 — docker-compose: VL + Collector → profiles:[core]

**Epic**: epic-1 (0.5 SP)
**Files**: `docker-compose.yaml:1650,1671,1749`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Dev Agent Record

### Implementation Plan

D1 (admin-logs VL migration): make the admin-logs substrate (VictoriaLogs + OTel
Collector + otel-collector-init) **always-on** — they start by default in
`docker compose up` (no `profiles:` label) and run unconditionally in Swarm via
pinned `deploy.replicas`. The remaining observability services (VictoriaMetrics,
VictoriaTraces, tempo-proxy, Grafana) stay gated behind `--profile observability`
in compose and `ENABLE_OBSERVABILITY=1` in Swarm.

### Completion Notes

- **Spec/impl divergence.** Spec text and epics.md describe this story as
  "split into `profiles: [core]`". After design discussion (Caveman ping during
  dev) we pivoted to **removing `profiles:` entirely** from the 3 services —
  same end state (VL + Collector always-on, admin endpoints functional regardless
  of `ENABLE_OBSERVABILITY`) without introducing a new profile label that would
  force users to learn a `--profile core` flag. The title of this story file
  retains the spec wording for traceability; the actual change is
  `profiles: [observability]` → *no profiles key at all*.
- `profiles: [observability]` removed from `otel-collector-init`, `otel-collector`,
  `victorialogs` (3 services).
- `victorialogs.deploy.replicas` pinned to `1` (was `${ENABLE_OBSERVABILITY:-0}`)
  so admin endpoints stay functional with `ENABLE_OBSERVABILITY=0`.
- Header doc comment + observability-section banner updated to document the
  always-on vs opt-in split.
- `docker compose config -q` exits 0; default `docker compose config --services`
  returns VL + Collector + init alongside the 15 default services;
  `--profile observability` adds vm + vtraces + tempo-proxy + grafana.
- `tests/config-validator`: 28/28 tests pass — no env-var coverage regressions.
- Diff: `docker-compose.yaml` only — 21 insertions, 11 deletions.
- **Follow-up:** `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`,
  `phases.md`, `rollback-matrix.md`, `epics.md` and `ARCHITECTURE-SPINE.md`
  still describe the change as `profiles: [observability]` → `profiles: [core]`.
  Recommend a `bmad-correct-course` pass to align wording with the chosen
  implementation (no-profile approach) before MR review.

### File List

- `docker-compose.yaml` (modified — removed profiles from 3 services, pinned VL replicas, updated doc comments)

### Change Log

- 2026-09-03: implemented D1 always-on substrate (no-profile approach per design discussion); status → review
