---
key: 2-7-gov-chat-backend-package-json-add-sdk-logs-exporter-logs-otl
title: "gov-chat-backend: package.json add sdk-logs + exporter-logs-otlp-http"
epic: epic-2
status: ready-for-dev
effort: 0.1
depends_on: [2.6]
files: components/gov-chat-backend/package.json
---

# Story 2.7 — gov-chat-backend: package.json add sdk-logs + exporter-logs-otlp-http

**Epic**: epic-2 (0.1 SP)
**Files**: `components/gov-chat-backend/package.json`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 2 review):**
- Add `@opentelemetry/sdk-logs@0.221.0` and `@opentelemetry/exporter-logs-otlp-http@0.221.0` to `dependencies`.
- **Bump `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0`** in the same MR (avoid peer-dep warnings). Coordinate with Epic 3 Story 3-1 (doc-repo mirror) so the doc-repo OTel deps land at the same version.
- Run `npm ls @opentelemetry/*` post-install; no UNMET PEER DEPENDENCY warnings.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
