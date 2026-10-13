---
key: 2-6-gov-chat-backend-tracing-js-loggerprovider-setgloballoggerpr
title: "gov-chat-backend: tracing.js → LoggerProvider + setGlobalLoggerProvider + PII processor"
epic: epic-2
status: ready-for-dev
effort: 0.5
depends_on: [2.3]
files: "components/gov-chat-backend/tracing.js` (after `:117`); components/gov-chat-backend/tracing-pii-logs.js` (new — exports `PIIRedactingLogRecordProcessor` extending `BatchLogRecordProcessor`)"
---

# Story 2.6 — gov-chat-backend: tracing.js → LoggerProvider + setGlobalLoggerProvider + PII processor

**Epic**: epic-2 (0.5 SP)
**Files**: `components/gov-chat-backend/tracing.js` (after `:117`)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 2 review):**
- Define `droppedCounter = getMeter().createCounter('log_record_dropped_total', { description: 'Otel log records dropped before export' })` at module load; call `droppedCounter.add(1, { reason: 'otlp_unreachable' })` when `LoggerProvider`/`OTLPLogExporter` initialization throws (e.g. unreachable Collector).
- Story 2-12 owns the counter name + reason enum; this story owns the otlp_unreachable call-site only.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
