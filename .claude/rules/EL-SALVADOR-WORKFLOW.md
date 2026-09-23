# El Salvador Branch Workflow

El Salvador runs on a long-lived release branch (`release/el-salvador`)
with frequent deploys and tuning cycles. This document defines the
**staging branch pattern** used to keep dev work, validation, and main
synchronisation clean.

## Hard rules (2026-09-23)

1. **Nothing lands on `main` without a passing test.**
   - Test venue is either local `docker compose` OR the live `.102`
     deployment.
   - **Exception**: explicit user override, recorded in the MR
     description.

2. **el-salvador-specific work NEVER lands on `main`.** It lives on
   `release/el-salvador` only (via Path 3 below).

3. **One branch per worktree.** Never `git checkout` inside a worktree
   — operations run in the worktree whose branch matches the operation
   (see the worktree table below). See
   `feedback_worktree_branch_isolation.md`.

## Branch topology

```
main (canonical for generic work; validated via Path 1 or Path 2)
  │
  (no direct link to release/el-salvador)
  │
release/el-salvador (long-lived, deployed to .102; validated via Path 3
                      or via cherry-picks from main after Path 2)
  │
  │  Path 2 rebase: release/el-salvador rebase onto main AFTER
  │  Path-2 cherry-picks merge into main
  │
  └── dev/el-salvador (per-cycle staging for live validation; reset from
                        release/el-salvador at each cycle start)
```

`dev/el-salvador` is **per-cycle**, not permanent. It exists only during
the validation cycle (Path 2 or Path 3). At cycle end, after the
validated commits have flowed to `main` (Path 2) or to `release/el-salvador`
(Path 3), dev/el-salvador is reset for the next cycle.

## The three paths

The distinction is the **validation venue** and the **destination branch**,
not whether the work is generic or el-salvador-specific. Pick the path
based on:

- Where can the change be validated? (local docker compose vs live .102)
- Where should the merged commit live? (`main` vs `release/el-salvador`)

### Path 1 — local validation, merge to `main`

For generic work where local `docker compose` is sufficient.

```
feature branch off main (in a worktree)
    │
    ▼
open MR to main (UNMERGED)         # work in the feature branch's worktree
    │
    ▼
docker compose --env-file .env up -d <affected-services>
# smoke-test the affected services, tear down
    │
    ▼
✅ green → glab mr merge
```

**Worktree**: the feature branch's worktree (or create one if missing).

### Path 2 — generic work, validate on el-salvador

For generic work that needs el-salvador's real infra to validate
(agrogenio data, live retrieval, deployment-specific behaviour). The
cherry-pick goes TO `main`.

```
# In worktree .claude/worktrees/el-salvador-dev/ (branch = dev/el-salvador)
git reset --hard origin/release/el-salvador
git push --force-with-lease origin dev/el-salvador

    │
    ▼
develop + commit on dev/el-salvador
    │
    ▼
ansible-playbook -i inventory/test.ini deploy.yml \
  --extra-vars "repo_branch=dev/el-salvador genie_ai_global_tag=<sha>"
# validate on .102 (RAG eval, smoke tests, manual queries, ingestion test)
    │
    ▼
✅ green → cherry-pick validated commits to fix/<name> off main
```

The cherry-pick step (in the `main` checkout):

```
git checkout main
# Verify the fix branch does NOT already exist
git branch --list fix/<name>
git ls-remote origin fix/<name>
# If it exists: reuse it (this batch) or pick fix/<name>-v2 — NEVER overwrite.
git checkout -b fix/<name>
git cherry-pick -x <sha>...    # -x adds "(cherry picked from commit ...)" suffix
# Verify the fix branch is clean before push
git status
git log origin/fix/<name>..HEAD   # should show ONLY the cherry-picked commits
git push origin fix/<name>       # NO --force — surface divergence to the user
# Open MR via glab, merge via glab
```

Then return to the release/el-salvador worktree for the rebase:

```
# In worktree .claude/worktrees/el-salvador-release/ (branch = release/el-salvador)
git rebase origin/main
git push --force-with-lease origin release/el-salvador
```

**Path 2 safety constraints**:

- **Never overwrite an existing `fix/<name>` branch.** Check local + remote
  before creating. If it exists, reuse it (intended for this batch) or
  pick `fix/<name>-v2` — surface the conflict to the user.
- **Use `git cherry-pick -x <sha>...`** for traceability.
- **Verify the fix branch is clean before push** (only the cherry-picked
  commits + nothing else).
- **No force-push to the fix branch** without explicit user OK. If push is
  rejected (non-fast-forward), surface the divergence.
- **If conflicts arise** (main has diverged since dev/el-salvador was
  branched): surface, do NOT auto-resolve. User reviews and resolves.
- **Multiple MRs from one validation cycle**: prefer one MR per logical
  batch (cycle-end checkpoint), not one MR per individual commit.

### Path 3 — el-salvador-specific work

For agrogenio-specific UI, El-Salvador deployment wiring, or anything
that only makes sense for el-salvador. The merge target is
`release/el-salvador`, never `main`.

```
# In worktree .claude/worktrees/el-salvador-dev/ (branch = dev/el-salvador)
git reset --hard origin/release/el-salvador
git push --force-with-lease origin dev/el-salvador
    │
    ▼
develop + commit on dev/el-salvador
    │
    ▼
ansible-playbook ... --extra-vars "repo_branch=dev/el-salvador genie_ai_global_tag=<sha>"
# validate on .102
    │
    ▼
✅ green → cherry-pick validated commits to a branch off release/el-salvador
```

The cherry-pick step (in the `release/el-salvador` worktree):

```
# In worktree .claude/worktrees/el-salvador-release/ (branch = release/el-salvador)
# Verify the source branch does NOT already exist (avoid overwrite)
git ls-remote origin release/el-salvador-foo
git checkout -b release/el-salvador-foo     # OR: feat/<name>
git cherry-pick -x <sha>...
git push origin release/el-salvador-foo    # NO --force
# Open MR via glab: source = release/el-salvador-foo, target = release/el-salvador
# Merge via glab. NEVER main.
```

**Path 3 critical constraints**:

- All el-salvador-specific commits go through `dev/el-salvador` first for
  live validation on `.102` (same cycle-start as Path 2).
- Source branch for the MR must come from `release/el-salvador` (or a
  branch off it), NOT from `dev/el-salvador` directly. Cherry-pick the
  validated commits from dev/el-salvador onto a fresh branch off
  release/el-salvador, then MR.
- Same source-branch safety constraints as Path 2 (no overwrite, `-x`
  for traceability, clean branch before push, no force-push).
- Target is `release/el-salvador`. **NEVER main.**

If a generic-looking fix turns el-salvador-specific mid-flight, branch
it off `release/el-salvador` and stop merging to `main`.

### Cross-pollination (one-way only)

When a generic fix on `main` is also useful for el-salvador:

```
main MR merged (Path 1 or Path 2)
    │
    ▼
cherry-pick to release/el-salvador
    │
    ▼
deploy + validate on .102
    │
    ▼
✅ keep / ❌ revert
```

Never the reverse. `release/el-salvador` does not feed into `main`.

## Worktree usage

| Operation | Worktree to use | Branch |
|---|---|---|
| Cycle-start reset, develop, validate on `.102` (Paths 2 + 3) | `.claude/worktrees/el-salvador-dev/` | `dev/el-salvador` |
| Cherry-pick validated commits to release/el-salvador, force-push rebase (Path 2 end, Path 3 MR target) | `.claude/worktrees/el-salvador-release/` | `release/el-salvador` |
| Cherry-pick to `fix/<name>` off main, MR to main (Path 2 tail) | main checkout (top-level `~/git_projects/ITU/genie-ai/`) | `main` |
| Local docker-compose test (Path 1) | feature branch's worktree (create one if missing) | the feature branch |

**Existing worktrees** to reuse (verify via `git worktree list` before
creating any new one):

- `.claude/worktrees/el-salvador-dev/` → `dev/el-salvador`
- `.claude/worktrees/el-salvador-release/` → `release/el-salvador`
- Top-level `~/git_projects/ITU/genie-ai/` → `main`

**Cleanup after MR merges**: per `feedback_worktree_branch_isolation.md`,
remove the worktree + delete the local branch once the MR is merged. Use
the monitor script pattern (see MR !441 cleanup).

## Image tags and deploy traceability

Every deploy on `.102` (validation or production) MUST use an explicit
`genie_ai_global_tag` via `--extra-vars`. This ensures the deployed
artifact can be traced back to a specific commit SHA, regardless of which
branch was used.

Never modify `deploy/ansible/group_vars/itu_rtx_el_salvador/vars.yml` to
track a feature branch — that breaks the MR-clean principle (per
`feedback_no_feature_branch_vars_yml.md`).


### Image tag scopes

There are **two scopes** of tag control when deploying via `--extra-vars`.

#### Global tag (`genie_ai_global_tag`)

All 16 images share this tag. Use when validating a full dev branch
end-to-end:

```bash
ansible-playbook -i inventory/test.ini deploy.yml \
  --extra-vars "repo_branch=dev/el-salvador genie_ai_global_tag=dev-el-salvador"
```

#### Per-service tag overrides (`image_tag_overrides`)

Pin **specific images** to a different tag while keeping others on
the global tag. Used when only one or two services need the dev
build (saves CI time, avoids cross-service regressions).

The override dict keys are the image names defined in
`deploy/ansible/tasks/deploy-shared-facts.yml`. Example: deploy
from `release/el-salvador` everywhere but only pin the reranker to
the dev branch build:

```bash
ansible-playbook -i inventory/test.ini deploy.yml \
  --vault-id test@prompt \
  --extra-vars '{"repo_branch":"release/el-salvador","genie_ai_global_tag":"release-el-salvador","image_tag_overrides":{"genie-ai-reranker":"dev-el-salvador"}}'
```

**IMPORTANT**: ansible-core 2.20 silently drops nested dicts in mixed
`key=value` CLI strings. Always pass `--extra-vars` as a **single JSON
object** (as above), not as a mix of `key=value` and JSON values.
Symptom of the bug: the `Validate image_tag_overrides keys against known
image names` task is missing from the deploy output (skipped because the
dict is empty).

**Use the branch name as the tag**, not the commit SHA. The
`.gitlab-ci.yml` `promote` step tags each build with both the SHA and
the branch name (line ~800:
`FINAL_TAGS="${BRANCH_TAG}-${CI_COMMIT_SHORT_SHA} ${BRANCH_TAG}"`),
so the branch-name tag is mutable and always points to the latest
build of the branch. Redeploy with the same `--extra-vars` after each
push — the registry tag updates on its own.

When you want to lock a specific validated build, switch to the
SHA-pinned tag:
`image_tag_overrides={'genie-ai-reranker':'dev-el-salvador-<sha>'}`.
The SHA-pinned tag is immutable; it will not move if you push new
commits.

The Ansible template (`templates/env.j2`) renders per-service
`GENIE_AI_<NAME>_IMAGE_TAG` vars, so docker-compose pulls the overridden
tag for that image only.

#### Image name reference

| Service | `img.name` key |
|---|---|
| reranker | `genie-ai-reranker` |
| chatqna-server | `genie-ai-chatqna-server` |

Full list in `deploy/ansible/tasks/deploy-shared-facts.yml`
(`genieai_images` set_fact).

## Permanent Draft MR — no longer required

Unlike the previous version of this doc, no permanent Draft MR is needed:
Path 3 MRs target `release/el-salvador` directly via glab, and the CI
exposure on `dev/el-salvador` is incidental (cherry-picks trigger pipelines
on `release/el-salvador` after merge).

If a CI-exposure gap emerges (dev/el-salvador pushes don't trigger
pipelines), open a temporary Draft MR and recreate if it gets closed.

## Anti-patterns

- **Do not** land anything on `main` without a passing test (local or
  el-salvador). The user's 2026-09-23 rule.
- **Do not** commit el-salvador-specific work to `main`. Path 3 only.
- **Do not** reuse an existing `fix/<name>` branch without verifying it
  was intended for this batch. Cherry-pick collision risk.
- **Do not** force-push to `fix/<name>` or `release/el-salvador-foo`
  branches without explicit user OK.
- **Do not** auto-resolve cherry-pick conflicts — surface to user.
- **Do not** rebase `release/el-salvador` onto `main` BEFORE the
  Path-2 cherry-picks have merged into `main`. Reverse causes conflicts
  and parasite commits.
- **Do not** let `dev/el-salvador` accumulate cycles. Reset it at cycle
  end.
- **Do not** `git checkout` inside a worktree to switch branches — use a
  different worktree.

## Relation to other rules

- `feedback_worktree_branch_isolation.md` — one branch per worktree
- `feedback_no_feature_branch_vars_yml.md` — vars.yml stays clean; deploy
  params via CLI
- `feedback_el_salvador_direct_rebase.md` — release/el-salvador force-push
  OK AFTER rebase onto main (Path 2 end). No MR for the rebase itself.
- `feedback_release_validate_before_promote.md` — validate-before-promote;
  the gate is at the merge-to-main step (Path 1/2) or merge-to-release
  step (Path 3), not at a release-commit step.
- `feedback_never_merge_without_ci.md` — CI must pass on the source branch
  before any merge.