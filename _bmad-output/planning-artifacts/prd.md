---
prd_key: admin-logs-victorialogs
created: 2026-08-31
updated: 2026-09-03
status: active
initiative: admin-logs + security-scan migration to VictoriaLogs
umbrella_branch: feat/admin-logs-victorialogs
umbrella_mr: "!335"
owner: jrevillard (ITU)
sources_of_truth:
  spec: _bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md
  architecture: _bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md
  epics: _bmad-output/planning-artifacts/epics.md
  sprint_status: _bmad-output/implementation-artifacts/sprint-status.yaml
  workflow: _bmad-output/implementation-artifacts/workflow.md
---

# PRD — Admin Logs + Security-Scan → VictoriaLogs

> **Routing artifact only.** Source-of-truth for capability contract is the spec kernel (`_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`) and the architecture spine (`ARCHITECTURE-SPINE.md`). This PRD exists so the BMad activation scripts (`find-prd`, `bmad-sprint-planning`, `bmad-correct-course`, `bmad-retrospective`, etc.) can resolve `prd_key` and dispatch to the right artifacts.
>
> The umbrella branch (`feat/admin-logs-victorialogs`) is intentionally NOT named `feat/admin-logs-victorialogs/prd` because Git refuses nested branches when a parent of the same name exists. The pattern `feat/{prd_key}/prd` from `issue-tracking.yaml:branch_patterns.prd` is incompatible with our existing umbrella MR !335. We accept the activation-script friction; manual skills (reading the frontmatter below) work.

## Why

D. Forden (2026-08-15) mandated the Winston logger write directly to VictoriaLogs. Today admin endpoints read Winston log files; security scanner reads them via worker threads. Both need to query VL directly. The F4 regex bug (live `GET /api/admin/logs` returns empty array) blocks the admin UI's daily-debug workflow.

## Scope

- Admin dashboard *Logs* facility (`GET /api/admin/logs`, `/summary`, `/search`, `/debug-yesterday`)
- Admin *Security scanning* facility (`POST /api/admin/security-scan`, `GET /security-metrics`, `/security/last-scan`)
- Winston → OTel LoggerProvider → VictoriaLogs producer path
- Document-repository producer-side (ClamAV observability, no admin endpoints)
- One-time rollout: 7 sub-MRs (one per epic) into umbrella branch; final umbrella MR to main

## Non-goals (full list in spec)

- okf-server migration (service doesn't exist in repo)
- Frontend AdminDashboard.vue / LogSearchDialog.vue contract changes
- Grafana service-logs dashboard rewrites
- Full `tests/melt-correlation/` implementation (stub-only this rollout, DW-325)
- Document-repository admin endpoints (none exist)

## Decisions resolved

- **D1 (a)** VL + OTel Collector split out of `observability` profile into `profiles: [core]` (always-on). Admin endpoints functional regardless of `ENABLE_OBSERVABILITY`.
- **D2** `ADMIN_LOGS_SOURCE=file|victorialogs` escape hatch — permanent, no-restart.
- **D3** Default admin filter = all services (`service:*`).
- **D4** Producer-first sequencing (Winston → VL before any consumer rewires).
- **D6** Apps POST OTLP logs via OTel Collector `:4318/v1/logs` (not direct to VL).

## Open questions

All resolved (Q-1..Q-4 closed; see spec `.memlog.md` entries 34–36 + workflow.md "Resolved decisions").

## Success criteria (full AC in spec)

- Admin `GET /api/admin/logs` returns schema-identical JSON via VL
- `POST /api/admin/security-scan` completes in < 2 s with same `vulnerabilities.{critical,medium,low}[]` shape
- Winston emits JSON via VL transport; `trace_id`/`span_id` are fields, not printf substrings
- F4 regex at `admin-dashboard-service.js:525` removed
- VL + OTel Collector always run (D1, no Compose profile gating)
- All 5 rollback switches (ADMIN_LOGS_SOURCE, LOG_TO_VICTORIALOGS, VL_FAIL_OPEN, LOG_TO_FILE, SECURITY_SCAN_BACKEND) tested pre-merge

## Resolved questions (key decisions)

- **Q-1** OTel deps split per option C — `shared/lib` requires only `@opentelemetry/api-logs`; heavy SDK per-component (backend, document-repository).
- **Q-2** `VL_FAIL_OPEN` rate-limit cadence = 1 per minute.
- **Q-3** Multi-tenant out-of-scope; `VICTORIALOGS_TENANT_ID` env kept as port seam (default `0:0`).
- **Q-4** `log_record_dropped_total` carries 3 reason labels (queue_full, otlp_unreachable, observability_disabled), no per-service label.

## Rollout plan

7 sub-branches × 7 sub-MRs targeting umbrella branch (`feat/admin-logs-victorialogs`). Final umbrella MR merges to main after all 7 verified + smoke-tested on release stack.

Procedure: `_bmad-output/implementation-artifacts/workflow.md` (stacked MRs, merge-order gate per AD-13, branch lifecycle).

## Epics (high-level)

- **Epic 1**: Pipeline enablement (P0 — D1 profile split + otlp receiver + env.j2 + CI stub)
- **Epic 2**: Producer — Winston → VL transport + JSON format + OTel (P1a)
- **Epic 3**: Document-repository producer-side init (logs-only path, ClamAV observability)
- **Epic 4**: MELT seam (hexa/onion: domain / port / adapter / application)
- **Epic 5**: Logs facility rewire + F4 fix (admin endpoints query VL)
- **Epic 6**: Security scanner rewire (worker_threads → VL bulk queries + dedupe)
- **Epic 7**: Cleanup (LOG_TO_FILE guard + rollover/configure deprecation)

Full story breakdown: `_bmad-output/planning-artifacts/epics.md`

## Tracking

- Sprint status: `_bmad-output/implementation-artifacts/sprint-status.yaml`
- 41 stories across 7 epics; status transitions: backlog → in-progress → review → done
- Merge-order gate per AD-13: epic-(N+1) blocks until epic-N green

## Deferred (sibling items)

- `DW-325`: `tests/melt-correlation/` full suite — separate epic. Stub exits 0 in P0.
- Story 7-6 closure note (2026-05-29 AC3 "preserve printf format" overridden by P1a JSON switch) appended to archived story file.
- Volume backup/cleanup strategy for VictoriaLogs (DW-65) — operational concern, separate epic.
