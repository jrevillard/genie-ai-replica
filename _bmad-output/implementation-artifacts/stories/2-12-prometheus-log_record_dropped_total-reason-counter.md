---
key: 2-12-prometheus-log_record_dropped_total-reason-counter
title: "Prometheus: `log_record_dropped_total{reason=...}` counter"
epic: epic-2
status: ready-for-dev
effort: 0.25
depends_on: [2.4, 2.5, 2.6]
files: components/gov-chat-backend/metrics.js (counter definition); components/shared/lib/victorialogs-transport.js (Story 2-4 — queue_full call-site); components/shared/lib/logger.js (Story 2-5 — observability_disabled call-site); components/gov-chat-backend/tracing.js (Story 2-6 — otlp_unreachable call-site)
---

# Story 2.12 — Prometheus: `log_record_dropped_total{reason=...}` counter

**Epic**: epic-2 (0.25 SP)
**Files**: `components/gov-chat-backend/metrics.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 2 review):**
- Define counter NAME + REASON ENUM in this story: `log_record_dropped_total` with reasons `{ queue_full, otlp_unreachable, observability_disabled }` (per `phases.md:29`, AD-7, Q-4 RESOLVED).
- **NO shared `recordLogDropped(reason)` helper** — AD-18 forbids `shared/lib → backend` require. Each call-site file (Story 2-4 transport, Story 2-5 logger, Story 2-6 tracing.js) creates its own counter instance at module load: `const droppedCounter = getMeter().createCounter('log_record_dropped_total', { description: 'Otel log records dropped before export' })`. Increment with `.add(1, { reason: 'queue_full' })` (or the appropriate enum).
- Reasons as enum consts prevent cardinality leaks; reject string literals outside the enum.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
