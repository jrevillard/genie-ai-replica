# Workflow — admin-logs-victorialogs migration

**Last updated:** 2026-09-03
**Initiative start:** 2026-08-31
**Purpose:** Durable procedure that survives context clears. Any future session opening this file can resume the migration without external context.

---

## Branch topology

```
main  (protected; never direct commit)
  ↑
  feat/admin-logs-victorialogs  ← UMBRELLA branch (MR !335)
    ↑
    ├─ feat/admin-logs-victorialogs-epic-1  (P0 pipeline enablement)
    ├─ feat/admin-logs-victorialogs-epic-2  (Producer + JSON + OTel)
    ├─ feat/admin-logs-victorialogs-epic-3  (Document-repository producer)
    ├─ feat/admin-logs-victorialogs-epic-4  (MELT seam hexa/onion)
    ├─ feat/admin-logs-victorialogs-epic-5  (Logs facility rewire + F4 fix)
    ├─ feat/admin-logs-victorialogs-epic-6  (Security scanner rewire)
    └─ feat/admin-logs-victorialogs-epic-7  (Cleanup)
```

Each sub-branch is a **worktree** at `.claude/worktrees/admin-logs-vl-epic-N/`.

## MR topology

| MR | Branch | Target | Scope | Status |
|---|---|---|---|---|
| !335 (umbrella) | `feat/admin-logs-victorialogs` | `main` | Planning + all 7 epics merged into the umbrella branch | open |
| epic-1 MR | `feat/admin-logs-victorialogs-epic-1` | `feat/admin-logs-victorialogs` | P0 pipeline enablement | when ready |
| epic-2 MR | `feat/admin-logs-victorialogs-epic-2` | `feat/admin-logs-victorialogs` | Producer + JSON + OTel | when ready |
| epic-3 MR | `feat/admin-logs-victorialogs-epic-3` | `feat/admin-logs-victorialogs` | Document-repository producer | when ready |
| epic-4 MR | `feat/admin-logs-victorialogs-epic-4` | `feat/admin-logs-victorialogs` | MELT seam | when ready |
| epic-5 MR | `feat/admin-logs-victorialogs-epic-5` | `feat/admin-logs-victorialogs` | Logs facility rewire + F4 fix | when ready |
| epic-6 MR | `feat/admin-logs-victorialogs-epic-6` | `feat/admin-logs-victorialogs` | Security scanner rewire | when ready |
| epic-7 MR | `feat/admin-logs-victorialogs-epic-7` | `feat/admin-logs-victorialogs` | Cleanup | when ready |

## Lifecycle per sub-MR

1. Create worktree + sub-branch from umbrella (`origin/feat/admin-logs-victorialogs`).
2. Implement epic scope per `_bmad-output/planning-artifacts/epics.md` + spine ADs.
3. Run local lint + format + tests per CLAUDE.md (do NOT skip).
4. `git push --set-upstream origin feat/admin-logs-victorialogs-epic-N` (NOT main).
5. Open MR targeting `feat/admin-logs-victorialogs`. CI gates per epic-spec acceptance.
6. **Merge order gate per AD-13**: epic-(N+1) MR blocks until epic-N MR pipeline green on umbrella branch.
7. After merge to umbrella branch, delete sub-branch + sub-worktree (`git worktree remove .claude/worktrees/admin-logs-vl-epic-N && git branch -d feat/admin-logs-victorialogs-epic-N`).

## Umbrella MR merge (final step)

1. After all 7 sub-MRs merged into `feat/admin-logs-victorialogs` AND smoke-tested on the release branch stack (`govstack@10.0.0.102`, `release/el-salvador` per `feedback_validate_before_promote`).
2. Per CLAUDE.md "never commit to main directly" — the umbrella MR IS the gate to main.
3. Verify CI pipeline green on umbrella branch.
4. Per `feedback_never_merge_without_ci`: wait for pipeline green.
5. Merge umbrella MR !335 → main. Sub-branches already deleted by step 7 above.

## Branch protection rules

- `main` and `release/*` direct commits/pushes forbidden (CLAUDE.md). Enforced via GitLab branch protection.
- Umbrella branch `feat/admin-logs-victorialogs` accepts merges from sub-branches only; no direct commits except initial planning commits already on it.
- Sub-branches ephemeral (deleted after merge).

## Resume checklist (fresh context)

1. Read this file: `_bmad-output/implementation-artifacts/workflow.md`
2. Check current state:
   - `git -C .claude/worktrees/admin-logs-vl log origin/main..HEAD --oneline` (umbrella progress)
   - `gitlab api projects/90/merge_requests?state=opened&source_branch=feat/admin-logs-victorialogs-epic-N` per epic
3. Find next epic with no `epic-N` MR yet: `_bmad-output/implementation-artifacts/sprint-status.yaml` `development_status` entries where `status: backlog` AND no sub-MR exists.
4. Follow the "Lifecycle per sub-MR" section above for that epic.

## Sources of truth

| Concern | Source |
|---|---|
| What to build | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` (kernel) + companion files |
| How to build it | `_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md` (20 ADs + hexa/onion) |
| What's left | `_bmad-output/implementation-artifacts/sprint-status.yaml` (`development_status`) |
| Scope per epic | `_bmad-output/planning-artifacts/epics.md` |
| How to merge | `_bmad-output/implementation-artifacts/workflow.md` (this file) |
| Rollback | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/rollback-matrix.md` |
| Audit trail | `_bmad-output/specs/spec-admin-logs-victorialogs-migration/.memlog.md` + `_bmad-output/architecture/architecture-genie-ai-2026-08-31/.memlog.md` |

## Why this pattern

- Survives context clears: every decision is in files, not chat.
- Sub-MR scope matches epic scope (7 sub-MRs vs 7 epics = 1:1).
- Umbrella MR gives reviewers the full picture.
- Merge-order gate prevents half-rewired code on main (AD-13).
- Git workflow rule respected: no direct commits to main.
