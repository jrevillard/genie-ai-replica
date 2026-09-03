# Admin Logs → VictoriaLogs Migration — Agent Workflow

**Active initiative.** Read this on session start when working in `feat/admin-logs-victorialogs`.

## Branch topology (stacked MRs)

```
main  (protected; never direct commit)
  ↑
  feat/admin-logs-victorialogs  ← UMBRELLA (MR !335, scope final)
    ↑
    ├─ feat/admin-logs-victorialogs-epic-1  worktree: admin-logs-vl-epic-1
    ├─ feat/admin-logs-victorialogs-epic-2  worktree: admin-logs-vl-epic-2
    ├─ feat/admin-logs-victorialogs-epic-3  worktree: admin-logs-vl-epic-3
    ├─ feat/admin-logs-victorialogs-epic-4  worktree: admin-logs-vl-epic-4
    ├─ feat/admin-logs-victorialogs-epic-5  worktree: admin-logs-vl-epic-5
    ├─ feat/admin-logs-victorialogs-epic-6  worktree: admin-logs-vl-epic-6
    └─ feat/admin-logs-victorialogs-epic-7  worktree: admin-logs-vl-epic-7
```

Sub-branches created from `origin/feat/admin-logs-victorialogs` (NOT from main). Each sub-MR targets `feat/admin-logs-victorialogs` (NOT main).

## Resume procedure (fresh context)

1. **Read in this order:**
   - `_bmad-output/implementation-artifacts/workflow.md` (master procedure — full detail)
   - `_bmad-output/implementation-artifacts/sprint-status.yaml` (`development_status` — find next `backlog` story)
   - `_bmad-output/planning-artifacts/epics.md` (story scope + acceptance)
   - `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` (what to build)
   - `_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md` (how to build — 20 ADs)
   - `_bmad-output/specs/spec-admin-logs-victorialogs-migration/rollback-matrix.md` (escape hatches)

2. **Find next epic to work on:** check `sprint-status.yaml` `development_status` for the lowest epic-id still `backlog` with no open sub-MR against `feat/admin-logs-victorialogs-epic-N`. Respects AD-13 merge-order gate.

3. **Check GitLab MRs:** `glab api projects/90/merge_requests?state=opened&target_branch=feat/admin-logs-victorialogs` to see which sub-MRs already exist.

4. **Create worktree if needed:**
   ```
   git worktree add .claude/worktrees/admin-logs-vl-epic-N -b feat/admin-logs-victorialogs-epic-N origin/feat/admin-logs-victorialogs
   ```

5. **Implement epic-N scope** per `epics.md` + spine ADs.

## Per-MR lifecycle

1. Implement + local lint/format/test per CLAUDE.md (don't skip — `feedback_ci_local_checks`).
2. Push: `git push --set-upstream origin feat/admin-logs-victorialogs-epic-N`.
3. Open MR targeting `feat/admin-logs-victorialogs` (NOT main).
4. CI green + smoke on release branch stack (`govstack@10.0.0.102`, `release/el-salvador`) per `feedback_release_validate_before_promote`.
5. Merge to umbrella. Delete sub-branch: `git worktree remove .claude/worktrees/admin-logs-vl-epic-N && git branch -d feat/admin-logs-victorialogs-epic-N`.

## Per-epic sources-of-truth

| Concern | File |
|---|---|
| What to build | `_bmad-output/planning-artifacts/epics.md#epic-N` |
| Spec | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` |
| Architecture | `_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md` (ADs) |
| Phases detail | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` |
| Env vars | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md` |
| Tracking | `_bmad-output/implementation-artifacts/sprint-status.yaml` |
| Procedure | `_bmad-output/implementation-artifacts/workflow.md` |
| Audit trail | `_bmad-output/specs/.../.memlog.md` + `_bmad-output/architecture/.../.memlog.md` |
| Rollback | `_bmad-output/specs/.../rollback-matrix.md` |

## Critical rules (DO NOT VIOLATE)

1. **Never commit to `main` directly.** Always via MR.
2. **Never commit to `release/*` directly.** Same.
3. **One sub-MR per epic.** 7 epics = 7 sub-MRs.
4. **Merge-order gate** per AD-13: epic-(N+1) MR blocks until epic-N green.
5. **CLI merge / GitLab merge** is the only path to main.
6. **CI green before merge** per `feedback_never_merge_without_ci`.
7. **Smoke on release stack before merge** per `feedback_release_validate_before_promote`.
8. **Rollback switches** (AD-6 + AD-14) tested pre-merge per `rollback-matrix.md`.

## Resolved decisions (Q-1..Q-4)

- **Q-1**: OTel deps split per option C — `shared/lib/transport` needs only `@opentelemetry/api-logs`; heavy SDK per-component.
- **Q-2**: `VL_FAIL_OPEN` rate-limit = 1/min.
- **Q-3**: Multi-tenant out-of-scope; `VICTORIALOGS_TENANT_ID` env kept as port seam (default `0:0`, single-tenant hardcoded).
- **Q-4**: `log_record_dropped_total` carries 3 reason labels (queue_full, otlp_unreachable, observability_disabled). NO per-service label.

## Deferred (sibling items)

- **DW-325**: `tests/melt-correlation/` full chaos + correlation suite. Separate epic. Stub-only in Epic 1.
- **Story 7-6 closure note**: AC3 (printf format preserved) overridden by Epic 2 JSON switch. Closure note already appended.

## MR !335 (umbrella, currently open)

- **URL**: https://opensource.unicc.org/un/itu/genie-ai/-/merge_requests/335
- **Scope**: planning + all 7 epics merged into umbrella branch.
- **Merges last** to main after all sub-MRs landed + smoke-tested.

## Why this rule exists

The workflow is complex enough that chat-only context will lose information across sessions. This rule + the files it points to are the durable record. Read them, follow them.
