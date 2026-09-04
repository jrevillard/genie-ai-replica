---
key: 1-1-docker-compose-vl-collector-profiles-core
title: "docker-compose: VL + Collector → always-on (no profile)"
epic: epic-1
status: done
effort: 0.5
depends_on: []
files: "docker-compose.yaml:1650,1671,1749  # line numbers pre-edit; see `git diff feat/admin-logs-victorialogs/prd..HEAD -- docker-compose.yaml` for current"
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
- `docker compose config -q` exits 0.
- Default `docker compose config --services` (18 services) includes
  `otel-collector-init`, `otel-collector`, `victorialogs` alongside the
  15 core services:

  ```
  arango-vector-db  frontend           postgres-init
  backend           keycloak           redis-cache
  clamav            keycloak-config    victorialogs
  db-migrations     kong               otel-collector
  document-repository kong-config      otel-collector-init
                    kong-migrations    nginx
  ```

- `--profile observability` adds 4 opt-in services:
  `victoriametrics`, `victoriatraces`, `grafana`, `tempo-proxy`.
- `tests/config-validator` — env-var coverage: 28/28 pass, no regressions.
- `tests/config-validator` — new `describe('admin-logs always-on substrate')`
  suite added per code-review D3 finding (5 tests pinning the contract via
  `parseComposeServiceContracts`).
- Diff (`feat/admin-logs-victorialogs/prd..HEAD`): `docker-compose.yaml` 29
  insertions / 12 deletions; story file +49/-1; sprint-status +5/-4.
- Doc alignment pass (D1): SPEC.md CAP-7/D1(a), phases.md P0,
  rollback-matrix.md P0, epics.md Story 1.1 title, ARCHITECTURE-SPINE.md AD-7
  all updated to describe the no-profile approach.
- Deploy alignment (D2): `deploy/ansible/deploy.yml:_deploy_files_obs` now
  copies `configs/otel/otel-collector-config.yaml` unconditionally so the
  always-on otel-collector bind-mount source is present regardless of
  `enable_observability`.

### File List

- `docker-compose.yaml` (modified — removed profiles from 3 services, pinned VL replicas, updated doc comments)

### Change Log

- 2026-09-03: implemented D1 always-on substrate (no-profile approach per design discussion); status → review
- 2026-09-03: code review pass — D1 (5 docs aligned), D2 (deploy.yml unconditional config copy), D3 (config-validator structural test added); story title updated to match implementation. See PR description for review output.

<!-- Change Log convention: see `_bmad-output/implementation-artifacts/sprint-status.yaml` §branch-top
     and `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` §CAP-1..CAP-8. -->
