---
key: 1-3-env-j2-render-3-new-vars-unconditionally
title: "env.j2: render 3 new vars unconditionally
epic: epic-1
status: done
followup_review_recommended: false
effort: 0.25
baseline_revision: 664c55d66c8e772fdf8c9f9d03f483ff99572be2
depends_on: []
files: deploy/ansible/templates/env.j2` (after `:239`)
---

## Implementation Handoff

### Scope

Modify `deploy/ansible/templates/env.j2`: insert **3 new vars unconditionally** after line 239 (i.e. **outside** the `{% if enable_observability == "1" %}` guard that closes on line 239). The 3 vars come from the P0 phase per `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` P0 line 12.

### Exact insertion (after current line 239, before line 241)

Append these lines verbatim, in order, after the existing `{% endif %}` at line 239, separated from the next `SECTION 13` block by exactly one blank line:

```jinja
VICTORIALOGS_URL={{ victorialogs_url | default('http://victorialogs:9428') }}
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT={{ otel_exporter_otlp_logs_endpoint | default('http://otel-collector:4318/v1/logs') }}
LOG_TO_VICTORIALOGS={{ log_to_victorialogs | default('1') }}
```

### Why these 3 (and not the other 2 from env-vars.md)

- `VICTORIALOGS_TENANT_ID` and `VL_QUERY_TIMEOUT_MS` are P1b per `env-vars.md` (table at line 11-12); they belong to a later story, not P0.
- The 3 above are the canonical P0 trio per `phases.md` P0 line 12. Do not add extras.

### Why "unconditional"

VL + Collector are now always-on (D1, story 1.1 done). The `{% if enable_observability == "1" %}` guard at line 225 only gates the observability dashboard stack (Grafana, Metrics, Traces). The 3 new vars are core-stack dependencies and must render regardless of `enable_observability`.

### Verification

- `python3 -c "from jinja2 import Environment; Environment().parse(open('deploy/ansible/templates/env.j2').read())"` → exits 0 (syntax OK).
- `grep -nE 'VICTORIALOGS_URL|OTEL_EXPORTER_OTLP_LOGS_ENDPOINT|LOG_TO_VICTORIALOGS' deploy/ansible/templates/env.j2` → exactly 3 matches, all on lines **after 239**.
- `grep -n 'VICTORIALOGS_URL' deploy/ansible/templates/env.j2 | awk -F: '{print $1}' | awk '$1 > 239'` → non-empty (sanity check: lines after 239).
- `awk 'NR<=240 || /^# SECTION 13/' deploy/ansible/templates/env.j2 | grep -c '^VICTORIALOGS_URL' ` → 0 (sanity: not inside the still-12C section).
- Visual check: lines 240-243 (or wherever the insertion lands) are the 3 vars, then one blank line, then `# ===...===` start of SECTION 13.

### References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` (CAP-7 D1)
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` P0 line 12
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md` (Ansible render block, vars table)
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` (D1)

## Auto Run Result

Status: done

### Summary

Story 1.3 — env.j2: render 3 new vars unconditionally — implemented: appended 3 vars + 1 explanatory comment to `deploy/ansible/templates/env.j2` immediately after the `{% if enable_observability == "1" %}` guard (line 239), so all 3 vars render in the Ansible-generated `env` file regardless of `enable_observability`. This unblocks CAP-7 D1 (VL + OTel Collector are always-on core; admin-logs ship even when observability stack is off).

### Files changed

- `deploy/ansible/templates/env.j2` — inserted 1 comment + 3 vars (4 new lines total, all after line 239 / before SECTION 13).

### Review findings breakdown

- Patches applied: 1 (low severity — added `# Rendered unconditionally: ...` comment to prevent future regression).
- Deferred: 4 (spec inconsistency phases.md vs env-vars.md var count; missing behavioral test for unconditional render; SECTION 12C header ambiguity; absent group_vars/README documentation for new vars).
- Rejected: 11 (cosmetic / consistent-with-existing-pattern / out-of-scope).

### Follow-up review recommendation

- Patched counts by severity: `high=0, medium=0, low=1`
- Score: `3×0 + 1×1 = 1`
- Recommendation: **false** (no high patches, score < 5).

### Verification performed

- `python3 -c "from jinja2 import Environment; Environment().parse(open('deploy/ansible/templates/env.j2').read())"` → exits 0 (Jinja2 syntax OK after comment insertion).
- `grep -nE 'VICTORIALOGS_URL|OTEL_EXPORTER_OTLP_LOGS_ENDPOINT|LOG_TO_VICTORIALOGS|unconditionally' deploy/ansible/templates/env.j2` → 4 matches on lines 240-243 (1 comment + 3 vars), all after line 239 (outside the guard).
- All 3 vars match the canonical P0 trio per `phases.md` P0 line 12 (no P1b vars added — VICTORIALOGS_TENANT_ID and VL_QUERY_TIMEOUT_MS belong to later stories).

### Residual risks

- None at this story's surface. The 4 deferred findings are real but tracked for sibling stories / spec alignment work.
- Branch lifecycle (commit/push/MR) is owned by the orchestrator.

## Review Triage Log

### 2026-09-03 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 4
- reject: 11
- addressed_findings:
  - `[low]` `[patch]` No code comment explaining "render unconditionally" intent — future maintainer might re-guard the 3 vars under `{% if enable_observability == "1" %}` undoing the fix. Added a one-line `# Rendered unconditionally: ...` comment on line 240.

### Deferred findings (collected for later focused attention)
- **Spec inconsistency — phases.md vs env-vars.md var count.** `phases.md` P0 line 12 lists 3 vars (VICTORIALOGS_URL, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, LOG_TO_VICTORIALOGS); `env-vars.md` "Ansible render (P0)" block lists 5 (adds VICTORIALOGS_TENANT_ID, VL_QUERY_TIMEOUT_MS — both P1b). This story follows phases.md (the authoritative P0 source). The two docs should be reconciled (env-vars.md should mark the 2 P1b vars as deferred).
- **No behavioral test pins unconditional render.** `tests/config-validator` validates the root `env` (compose), not `env.j2`. CI `docs:validate` runs `ansible-playbook --syntax-check` and `yamllint` only — no Jinja2 render test. A future refactor could re-guard these 3 vars with no CI signal. Story 1-5 or a sibling story should add a `docs:validate` Jinja2 render check covering both `enable_observability=0` and `enable_observability=1`.
- **Section 12C header misleading.** Header still reads `OBSERVABILITY STACK (OPTIONAL — requires enable_observability=1)` after these 3 vars were intentionally rendered outside the guard. Header should be split or a sibling SECTION 12D added. Cosmetic but worth fixing in a docs-alignment pass.
- **No group_vars defaults for the new vars.** `victorialogs_url`, `otel_exporter_otlp_logs_endpoint`, `log_to_victorialogs` are not declared in `deploy/ansible/group_vars/all.yml` or per-env `vars.yml`. Operators have no central place to discover/override them. Jinja `default(...)` covers undefined-vars, but a doc pass in `deploy/ansible/README.md` + group_vars entries would make these knobs discoverable.

# Story 1.3 — env.j2: render 3 new vars unconditionally

**Epic**: epic-1 (0.25 SP)
**Files**: `deploy/ansible/templates/env.j2` (after `:239`)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
