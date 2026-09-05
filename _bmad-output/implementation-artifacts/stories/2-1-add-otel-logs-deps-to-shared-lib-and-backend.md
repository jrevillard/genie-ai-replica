---
key: 2-1-add-otel-logs-deps-to-shared-lib-and-backend
title: "shared/lib + gov-chat-backend: add OpenTelemetry logs deps (api-logs + sdk-logs + exporter-logs-otlp-http)"
epic: epic-2
status: ready-for-dev
effort: 0.2
depends_on: []
files: "components/shared/lib/package.json (ADD `@opentelemetry/api-logs@^0.221.0` peer-dep; backend `api-logs`/`sdk-logs`/`exporter-logs-otlp-http` are regular deps in shared/lib — see Q-1 RESOLVED option C); components/gov-chat-backend/package.json (ADD `@opentelemetry/api-logs@^0.221.0` + `@opentelemetry/sdk-logs@^0.221.0` + `@opentelemetry/exporter-logs-otlp-http@^0.221.0`; BUMP `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0`)"
notes: "Merged from Stories 2-1 (shared/lib api-logs peer-dep) + 2-7 (backend sdk-logs + exporter-logs-otlp-http). One MR + one npm install avoids peer-dep mismatches across components."
---

# Story 2.1 — shared/lib + gov-chat-backend: add OpenTelemetry logs deps (api-logs + sdk-logs + exporter-logs-otlp-http)

**Epic**: epic-2 (0.2 SP) — MERGED from Stories 2-1 (shared/lib api-logs peer-dep) + 2-7 (backend sdk-logs + exporter-logs-otlp-http). One MR + one `npm install` keeps peer-dep versions aligned across components.
**Files**: `components/shared/lib/package.json`; `components/gov-chat-backend/package.json`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Combined scope (2-1 + 2-7):**

**`components/shared/lib/package.json`:**
- ADD `@opentelemetry/api-logs@^0.221.0` to `peerDependencies` (peer of `sdk-logs` + `exporter-logs-otlp-http`; the thin wrapper in shared/lib/victorialogs-transport.js needs only this). Per architecture spine Stack table line 229.

**`components/gov-chat-backend/package.json`:**
- ADD `@opentelemetry/api-logs@^0.221.0` to `dependencies`.
- ADD `@opentelemetry/sdk-logs@^0.221.0` to `dependencies`.
- ADD `@opentelemetry/exporter-logs-otlp-http@^0.221.0` to `dependencies`.
- **BUMP `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0`** to avoid peer-dep warnings (sdk-logs + sdk-node must align).

**Coordinate with Epic 3 Story 3-1 (doc-repo mirror):** doc-repo gets the same OTel deps at the same version. Land in same MR or fast-follow.

**Verification:**
- `cd components/gov-chat-backend && npm ls @opentelemetry/*` → no UNMET PEER DEPENDENCY warnings.
- `cd components/shared/lib && npm ls @opentelemetry/api-logs` → resolves to `^0.221.0`.
- `python3 -c "import json; json.load(open('components/shared/lib/package.json'))"` → parse OK.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` (P1a deps)
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md` (npm dependency split, Q-1 RESOLVED option C)
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` (Stack table line 229, AD-18)
