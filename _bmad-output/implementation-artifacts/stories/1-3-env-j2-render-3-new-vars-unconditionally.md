---
key: 1-3-env-j2-and-env-commented-templates-render-new-vars
title: "env.j2 + env (root): render new vars unconditionally (P0 substrate)"
epic: epic-1
status: done
followup_review_recommended: false
effort: 0.35
baseline_revision: 664c55d66c8e772fdf8c9f9d03f483ff99572be2
depends_on: []
files: "deploy/ansible/templates/env.j2` (after `:239`); env (Section 12D after SECTION 12C)"
notes: "Merged from Stories 1-3 (env.j2) + 1-4 (env commented templates). Same MR, same phase boundary."
---

# Story 1.3 — env.j2 + env (root): render new vars unconditionally (P0 substrate)

**Epic**: epic-1 (0.35 SP) — MERGED from Stories 1-3 (env.j2 unconditional render) + 1-4 (env commented templates). One MR, one phase boundary.
**Files**: `deploy/ansible/templates/env.j2` (after `:239`); `env` (Section 12D after SECTION 12C).

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

**env.j2 (from 1-3):** insert 3 new vars unconditionally after line 239 (outside the `{% if enable_observability == "1" %}` guard that closes on line 239):
- `VICTORIALOGS_URL={{ victorialogs_url | default('http://victorialogs:9428') }}`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT={{ otel_exporter_otlp_logs_endpoint | default('http://otel-collector:4318/v1/logs') }}`
- `LOG_TO_VICTORIALOGS={{ log_to_victorialogs | default('1') }}`

**env (root) commented templates (from 1-4):** add 43 commented lines in SECTION 12D introducing the 10 new env vars per `env-vars.md` New vars table:
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `VICTORIALOGS_URL`, `VICTORIALOGS_TENANT_ID` (`0:0`), `VL_QUERY_TIMEOUT_MS` (`30000`), `LOG_TO_VICTORIALOGS` (`1`), `MELT_PROVIDER` (`victorialogs`), `VL_FAIL_OPEN` (`false`), `ADMIN_LOGS_SOURCE` (`victorialogs`), `SECURITY_SCAN_BACKEND` (`victorialogs`), `LOG_TO_FILE` (`0`).
- All `#`-prefixed so `set -a; source env` stays inert.
- Default values mirror env.j2 + docker-compose.yaml.

**Verification:**
- `python3 -c "from jinja2 import Environment; Environment().parse(open('deploy/ansible/templates/env.j2').read())"` → exits 0 (syntax OK).
- `grep -nE 'VICTORIALOGS_URL|OTEL_EXPORTER_OTLP_LOGS_ENDPOINT|LOG_TO_VICTORIALOGS' deploy/ansible/templates/env.j2` → exactly 3 matches, all on lines **after 239**.
- `grep -nE '^(# )?(VICTORIALOGS_URL|...LOG_TO_FILE)=' env | head -20` → 10 commented lines in SECTION 12D.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` (P0 line 12)
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
