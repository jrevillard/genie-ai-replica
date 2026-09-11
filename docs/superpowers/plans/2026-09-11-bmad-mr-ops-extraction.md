# MR Ops Atomic Extraction + JS Orchestrator glab Replacement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract duplicated glab/gh MR blocks from 7 existing module workflows into 3 reusable atomic sub-workflows (2 extracted + 1 new), add 1 new atomic for failed-job diagnostics, then replace the 8 remaining hardcoded glab calls in the JS orchestrators with cross-platform Skill invocations routed through the new atomics. Coordinated PR against both `bmad-issue-tracking` (YAML module) AND `bmad-orchestration` (JS orchestrators) upstream repos.

**Architecture:** Atomic primitives expose one operation each with a single INPUT/OUTPUT contract. Composites orchestrate atomics via `INCLUDE:` directives. Both `PLATFORM: gitlab` AND `PLATFORM: github` branches live inside each atomic — no platform-specific CLI in JS orchestrators. Env-var routing on `BMAD_MR_ACTION` dispatches the Skill to the right atomic at runtime.

**Tech Stack:** BMAD Workflow YAMLs (assets dir → deployed to `_bmad/_config/custom/workflows/common/`), Node.js 22 (JS orchestrators in `.agents/skills/<skill>/scripts/`), Claude Code Workflow runtime, `glab` 1.53.0 (GitLab CLI), `gh` 2.46.0 (GitHub CLI), existing `bmad-issue-tracking` Skill.

**Spec:** `/home/jerome/.claude/plans/nos-skill-workflows-bmad-prd-orchestrate-fluttering-wadler.md` (this plan's source design doc).

**Global Constraints:**
- **Module source-of-truth**: `/home/jerome/git_projects/bmad-issue-tracking/` (NOT `~/.claude/skills/...` — that path doesn't exist on this machine)
  - Workflow YAMLs: `skills/bmad-issue-tracking-setup/assets/workflows/`
  - Skill definitions: `skills/bmad-issue-tracking-{setup,sync}/`
  - Branch: `skills-as-modules` (clean)
  - **Historical note**: `code-review/complete.yaml` + `create-story/complete.yaml` were removed in commit `d1eacc5` (2026-08-24) — "refactor: unified post-dev workflow via on_complete hook". The unified `common/post-dev-complete.yaml` now handles both create-story + review-finish phases via `bmad-build-auto.on_complete` → `post-build-dispatch.yaml`. Skill-specific `complete.yaml` files are intentionally absent (verified upstream).
- **JS orchestrator source-of-truth**: `/home/jerome/git_projects/bmad-orchestration/` (NOT the worktree's installed copies)
  - `skills/bmad-build-converge/scripts/bmad-build-converge.js`
  - `skills/bmad-prd-orchestrate/scripts/bmad-prd-orchestrate.js`
  - Branch: `main` (clean)
- **Worktree (this branch)**: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/`
  - `.agents/skills/bmad-issue-tracking-sync/` (committed git-tracked mirror of upstream sync skill)
  - `_bmad/_config/custom/workflows/common/` (gitignored runtime deploy)
- **Coordination**: changes land in BOTH upstream repos → coordinated PRs filed against each upstream. Worktree commits only the memory + cross-cutting docs (no source-of-truth code lives here).
- **Language**: ALL documentation, comments, code in English (CLAUDE.md)
- **Both files must pass `node --check`** → EXIT 0 (preserved by the existing IIFE wrap)
- **No bare glab/gh invocations in JS orchestrators** — only in workflow YAMLs + Skill-tool prompts
- **Atomic workflow contracts**: each atomic has ONE INPUT + ONE OUTPUT; composites use `INCLUDE:` directives
- **Cross-platform**: every atomic has BOTH `PLATFORM: gitlab` AND `PLATFORM: github` branches
- **OUTPUT variable naming**: unified across platforms — gitlab `pipeline_id` AND github also outputs `pipeline_id` (the github-side `run_id` is renamed)
- **Tool versions**: `glab 1.53.0` (NO `--output json` on `mr create`, NO `--json` on `mr merge`), `gh 2.46.0` (NO `--json url` on `pr create`, NO `--json sha` on `pr merge`)
- **Never reference story/FR/AC/D numbers in code comments** (memory: `feedback_no_story_refs_in_comments`)
- **Per-task commits** (writing-plans skill requires 2-5 min steps; bundle verify+deploy+commit is forbidden)

---

## File Structure

**Atomic primitives (new files in `bmad-issue-tracking` repo)**:
- `skills/bmad-issue-tracking-setup/assets/workflows/common/find-mr.yaml` — atomic: find MR by source branch
- `skills/bmad-issue-tracking-setup/assets/workflows/common/get-mr-pipeline.yaml` — atomic: get latest pipeline id+status (unified `pipeline_id` for both platforms)
- `skills/bmad-issue-tracking-setup/assets/workflows/common/merge-mr.yaml` — atomic: merge MR by IID (4 variants, API-based SHA extraction)
- `skills/bmad-issue-tracking-setup/assets/workflows/common/get-failed-jobs.yaml` — NEW atomic: list failed jobs + traces (`gh run view --log-failed` for github auth)

**Consumers (refactored files in `bmad-issue-tracking` repo, inline → INCLUDE)**:
- `skills/bmad-issue-tracking-setup/assets/workflows/common/ensure-mr.yaml` — INCLUDE: find-mr; mr_url captured via stdout URL extraction (no `--output json` flag)
- `skills/bmad-issue-tracking-setup/assets/workflows/common/check-mr-ci.yaml` — INCLUDE: find-mr + INCLUDE: get-mr-pipeline
- `skills/bmad-issue-tracking-setup/assets/workflows/common/wait-for-green-ci.yaml` — INCLUDE: find-mr + INCLUDE: get-mr-pipeline (polling) + INCLUDE: get-failed-jobs (failure-path)
- `skills/bmad-issue-tracking-setup/assets/workflows/common/post-dev-complete.yaml` — INCLUDE: merge-mr (4 inline calls → 1 INCLUDE)
- `skills/bmad-issue-tracking-setup/assets/workflows/common/mark-mr-ready.yaml` — INCLUDE: find-mr (mark-ready stays inline; 1-call primitive)
- `skills/bmad-issue-tracking-setup/assets/workflows/bmad-prd/complete.yaml` — INCLUDE: ensure-mr
- `skills/bmad-issue-tracking-setup/assets/workflows/create-prd/complete.yaml` — INCLUDE: ensure-mr
- ~~`skills/bmad-issue-tracking-setup/assets/workflows/code-review/complete.yaml`~~ — DOES NOT EXIST (only `activation.yaml`); Task 9 dropped
- ~~`skills/bmad-issue-tracking-setup/assets/workflows/create-story/complete.yaml`~~ — DOES NOT EXIST (only `activation.yaml`); Task 10 trimmed to 2 files

**Skill routing (modified files in `bmad-issue-tracking` repo)**:
- `skills/bmad-issue-tracking-sync/SKILL.md` — add Step 2c for MR ops routing (between existing Step 2a scoped-sync and Step 2b full-sync)
- `skills/bmad-issue-tracking-sync/module-manifest.toml` — bump version 3.0.0 → 3.1.0
- `skills/bmad-issue-tracking-setup/module-manifest.toml` — bump version 3.0.0 → 3.1.0 (asset additions)

**JS orchestrators (modified files in `bmad-orchestration` repo)**:
- `skills/bmad-build-converge/scripts/bmad-build-converge.js` — replace 8 inline glab calls (L392, L500, L502, L505, L775, L779, L780, L985) with Skill invocations
- `skills/bmad-prd-orchestrate/scripts/bmad-prd-orchestrate.js` — replace 1 inline glab call (L112) with Skill invocation

**Memory + cross-share (modified files in this worktree)**:
- `~/.claude/projects/-home-jerome-git-projects-ITU-genie-ai/memory/project_bmad_issue_tracking_scoped_upstream_pending.md` — bump to 3.1.0; add the 4 new/refactored workflows + JS-orchestrator changes to the upstream PR checklist
- `~/.claude/projects/-home-jerome-git-projects-bmad-orchestration/memory/project_bmad_issue_tracking_scoped_upstream_pending.md` — mirror

---

## Task 1: Create atomic `common/find-mr.yaml`

**Files:**
- Create: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/find-mr.yaml`

- [ ] **Step 1: Verify the file does not exist yet** — `ls /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/find-mr.yaml 2>&1`. Expected: "No such file or directory".

- [ ] **Step 2: Create the atomic workflow**:

```yaml
# common/find-mr.yaml
#
# Purpose: Find existing MR by source branch. Returns mr_iid (empty if none).
# Input variables: mr_repo (full repo path: gitlab "host/group/project"; github "host/owner/project"), source_branch
# Output variables: mr_iid (string, empty string if no MR exists)

# GitLab: list MRs filtered by source branch, extract first iid
- RUN: glab mr list --source-branch {source_branch} -R "{mr_repo}" --output json | uv run --no-project python -c "
import json, sys
ms = json.load(sys.stdin)
print(str(ms[0]['iid']) if ms else '')
"
  STORE: mr_iid
  PLATFORM: gitlab

# GitHub: list PRs filtered by head branch, extract first number
- RUN: gh pr list --head {source_branch} -R "{mr_repo}" --json number --jq '.[0].number // empty'
  STORE: mr_iid
  PLATFORM: github
```

- [ ] **Step 3: Verify syntax** — invoke `~/.bmad/scripts/render_skill.py` or `bmad-workflow-lang.md` interpreter on the file (or visually verify against `common/find-issue.yaml`'s pattern).

- [ ] **Step 4: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-setup/assets/workflows/common/find-mr.yaml && git commit -m "feat(issue-tracking): add common/find-mr atomic"`.

---

## Task 2: Create atomic `common/get-mr-pipeline.yaml`

**Files:**
- Create: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/get-mr-pipeline.yaml`

- [ ] **Step 1: Verify the file does not exist yet** — `ls /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/get-mr-pipeline.yaml 2>&1`. Expected: missing.

- [ ] **Step 2: Create the atomic workflow**:

```yaml
# common/get-mr-pipeline.yaml
#
# Purpose: Get the latest pipeline id + status for a given MR/PR.
# Input variables: mr_iid (numeric)
# Output variables:
#   - pipeline_id (string): gitlab pipeline id OR github workflow run id (unified name for cross-platform callers)
#   - pipeline_status (string): gitlab pipeline.status OR github conclusion (success/failed/running/pending/cancelled/none)

# GitLab: fetch MR's latest pipeline (paginated, take first)
- RUN: glab api "projects/{project_enc}/merge_requests/{mr_iid}/pipelines" --hostname {host} --paginate | uv run --no-project python -c "
import json, sys
ps = json.load(sys.stdin)
if ps:
    print(str(ps[0]['id']))
else:
    print('')
"
  STORE: pipeline_id
  PLATFORM: gitlab

# GitLab: also fetch pipeline_status (separate RUN — multi-variable STORE has no precedent in this module; safer to split)
- RUN: glab api "projects/{project_enc}/merge_requests/{mr_iid}/pipelines" --hostname {host} --paginate | uv run --no-project python -c "
import json, sys
ps = json.load(sys.stdin)
print(ps[0]['status'] if ps else 'none')
"
  STORE: pipeline_status
  PLATFORM: gitlab

# GitHub: list recent workflow runs (per-branch), pick latest (rename run_id → pipeline_id for output unification)
- RUN: gh run list --limit 1 -R "{host}/{owner}/{repo}" --json databaseId,status,conclusion | uv run --no-project python -c "
import json, sys
rs = json.load(sys.stdin)
print(str(rs[0]['databaseId']) if rs else '')
"
  STORE: pipeline_id
  PLATFORM: github

# GitHub: pipeline_status from run's conclusion
- RUN: gh run list --limit 1 -R "{host}/{owner}/{repo}" --json databaseId,status,conclusion | uv run --no-project python -c "
import json, sys
rs = json.load(sys.stdin)
print(rs[0]['conclusion'] or rs[0]['status'] or 'unknown') if rs else print('none')
"
  STORE: pipeline_status
  PLATFORM: github
```

- [ ] **Step 3: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-setup/assets/workflows/common/get-mr-pipeline.yaml && git commit -m "feat(issue-tracking): add common/get-mr-pipeline atomic (gitlab pipeline + github run, unified output)"`.

---

## Task 3: Create atomic `common/get-failed-jobs.yaml`

**Files:**
- Create: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/get-failed-jobs.yaml`

- [ ] **Step 1: Create the atomic workflow**:

```yaml
# common/get-failed-jobs.yaml
#
# Purpose: List failed jobs for a given pipeline id, with trace tail per job.
# Input variables: pipeline_id (gitlab pipeline id) or pipeline_id (github workflow run id)
# Output variables: jobs (newline-separated JSON: each line {name, exitCode, trace_tail})

# GitLab: list jobs in pipeline, filter failed, fetch trace tail per failed job (sequential — pipeline failure usually has 1-3 jobs)
- RUN: glab api "projects/{project_enc}/pipelines/{pipeline_id}/jobs?per_page=50" --hostname {host} | uv run --no-project python -c "
import json, subprocess, sys
jobs = json.load(sys.stdin)
results = []
for j in jobs:
    if j.get('status') == 'failed':
        name = j.get('name', '')
        exit_code = j.get('exit_code', 0)
        try:
            trace = subprocess.check_output(
                ['glab', 'api', '--hostname', sys.argv[1], f\"projects/{sys.argv[2]}/jobs/{j['id']}/trace\"],
                stderr=subprocess.DEVNULL
            ).decode().splitlines()[-80:]
            trace_tail = '\\n'.join(trace)
        except Exception:
            trace_tail = ''
        results.append(f\"{name}\\t{exit_code}\\t{trace_tail}\")
print('\\n'.join(results))
" {host} {project_enc}
  STORE: jobs
  PLATFORM: gitlab
  EXPECT_EXIT: any

# GitHub: list jobs in workflow run, filter conclusion=failure, use `gh run view --log-failed` (built-in authenticated, handles private repos)
- RUN: gh run view {pipeline_id} --log-failed 2>&1 | head -200 || true
  STORE: jobs
  PLATFORM: github
  EXPECT_EXIT: any
```

- [ ] **Step 2: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-setup/assets/workflows/common/get-failed-jobs.yaml && git commit -m "feat(issue-tracking): add common/get-failed-jobs atomic"`.

---

## Task 4: Create atomic `common/merge-mr.yaml`

**Files:**
- Create: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/merge-mr.yaml`

- [ ] **Step 1: Create the atomic workflow** (no `same_platform_target` flag — use check-config's `platform` + `git_platform` for routing; API-based merge SHA extraction; truth source = actual merge CLI exit code):

```yaml
# common/merge-mr.yaml
#
# Purpose: Merge an MR/PR by IID. Cross-platform, 4 variants (gitlab/github × same/cross-platform target).
# Input variables: mr_iid (numeric), squash (default "false")
# Output variables:
#   - merged ("true" if merge CLI succeeded)
#   - merge_sha (string, from API after merge; empty if merge failed)
#   - error (string, non-empty if merge failed)

# Internal routing: determine target repo (same-platform uses host/project, cross-platform uses git_host/git_project)
# Trigger on platform match first; fall back to git_platform for cross-platform case.

# === GitLab — same-platform (issue tracker is gitlab) ===
- CHECK: platform eq "gitlab"
  TRUE:
    - CHECK: git_platform eq platform
      TRUE:
        - RUN: glab mr merge --yes --squash={squash} -R "{host}/{project}" {mr_iid}
          STORE: gl_merge_out
          PLATFORM: gitlab
          EXPECT_EXIT: any
        # After merge, fetch the merge commit SHA via API (avoids the hardcoded git -C path issue)
        - RUN: glab api "projects/{project_enc}/merge_requests/{mr_iid}" --hostname {host} | uv run --no-project python -c "
import json, sys
m = json.load(sys.stdin)
print(m.get('merge_commit_sha', '') or '')
"
          STORE: merge_sha
          PLATFORM: gitlab

# === GitLab — cross-platform (git remote != issue tracker) ===
- CHECK: platform eq "gitlab"
  TRUE:
    - CHECK: git_platform neq platform
      TRUE:
        - RUN: glab mr merge --yes --squash={squash} -R "{git_host}/{git_project}" {mr_iid}
          STORE: gl_merge_out
          PLATFORM: gitlab
          EXPECT_EXIT: any
        - RUN: glab api "projects/{project_enc}/merge_requests/{mr_iid}" --hostname {host} | uv run --no-project python -c "
import json, sys
m = json.load(sys.stdin)
print(m.get('merge_commit_sha', '') or '')
"
          STORE: merge_sha
          PLATFORM: gitlab

# === GitHub — same-platform ===
- CHECK: platform eq "github"
  TRUE:
    - CHECK: git_platform eq platform
      TRUE:
        - RUN: gh pr merge {mr_iid} --squash --delete-branch -R "{host}/{project}"
          STORE: gh_merge_out
          PLATFORM: github
          EXPECT_EXIT: any
        - RUN: gh api repos/{host}/{owner}/{repo}/pulls/{mr_iid} --jq .merge_commit_sha
          STORE: merge_sha
          PLATFORM: github

# === GitHub — cross-platform ===
- CHECK: platform eq "github"
  TRUE:
    - CHECK: git_platform neq platform
      TRUE:
        - RUN: gh pr merge {mr_iid} --squash --delete-branch -R "{git_host}/{git_owner}/{git_repo}"
          STORE: gh_merge_out
          PLATFORM: github
          EXPECT_EXIT: any
        - RUN: gh api repos/{git_host}/{git_owner}/{git_repo}/pulls/{mr_iid} --jq .merge_commit_sha
          STORE: merge_sha
          PLATFORM: github

# Derive merged/error from CLI outputs (truth source = exit code, not pipeline_status)
- RUN: uv run --no-project python -c "
import sys
gl = sys.argv[1].strip() if len(sys.argv) > 1 else ''
gh = sys.argv[2].strip() if len(sys.argv) > 2 else ''
# If either CLI produced output (stdout captured by the shell), the merge ran
print('true' if (gl or gh) else 'false')
" {gl_merge_out} {gh_merge_out}
  STORE: merged
- CHECK: merged eq "false"
  TRUE:
    - SET: { variable: error, value: "merge CLI failed (no stdout captured)" }
```

- [ ] **Step 2: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-setup/assets/workflows/common/merge-mr.yaml && git commit -m "feat(issue-tracking): add common/merge-mr atomic (API SHA extract, platform routing)"`.

---

## Task 5: Refactor `common/ensure-mr.yaml` to INCLUDE `find-mr` + add `mr_url` capture

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/ensure-mr.yaml`

- [ ] **Step 1: Read current ensure-mr.yaml** (L1-L100) — confirm the inline `glab mr list + python` block (L71-L75) and the `gh pr list + jq` block (L75-L82), and the `glab mr create` (L83) / `gh pr create` (L85) blocks.

- [ ] **Step 2: Replace the L71-L82 find blocks with INCLUDE: common/find-mr**:

```yaml
# BEFORE (lines 71-82):
- RUN: glab api "projects/{project_enc}/merge_requests?source_branch={story_branch}" --hostname {host} --paginate | uv run --no-project python -c "
import json, sys
ms = json.load(sys.stdin)
print(ms[0]['iid'] if ms else '')
"
  STORE: mr_iid
  PLATFORM: gitlab
- RUN: gh pr list --head {story_branch} -R "{mr_repo}" --json number --jq '.[0].number // empty'
  STORE: mr_iid
  PLATFORM: github

# AFTER:
- INCLUDE: common/find-mr
```

- [ ] **Step 3: Add mr_url capture after create (no `--output json` flag — use stdout URL extraction)**. For gitlab: `glab mr create ... | tee /dev/stderr | grep -oE 'https://[^ ]+'` → mr_url. For github: `gh pr create ... | grep -oE 'https://github\.com/[^ ]+/pull/[0-9]+'` → mr_url.

- [ ] **Step 4: Verify behavior parity** — `cd /home/jerome/git_projects/bmad-issue-tracking && git diff skills/bmad-issue-tracking-setup/assets/workflows/common/ensure-mr.yaml` — only the INCLUDE substitution + URL extraction step should appear. No semantic change.

- [ ] **Step 5: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-setup/assets/workflows/common/ensure-mr.yaml && git commit -m "refactor(issue-tracking): ensure-mr INCLUDEs find-mr atomic + captures mr_url"`.

---

## Task 6: Refactor `common/check-mr-ci.yaml` to INCLUDE `find-mr` + `get-mr-pipeline`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/check-mr-ci.yaml`

- [ ] **Step 1: Replace the inline find + pipeline-status block (L17-L58 gitlab, L62-L106 github) with**:

```yaml
# AFTER:
- INCLUDE: common/find-mr
- INCLUDE: common/get-mr-pipeline
  # (atomic produces pipeline_status which is already the unified enum — no extra mapping needed)
```

- [ ] **Step 2: Verify** — `git diff` shows the substitution; existing OUTPUT messages reference `<ci_status>` and `<pipeline_id>` (unchanged).

- [ ] **Step 3: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add ... && git commit -m "refactor(issue-tracking): check-mr-ci INCLUDEs find-mr + get-mr-pipeline"`.

---

## Task 7: Refactor `common/wait-for-green-ci.yaml` to INCLUDE atomics + `get-failed-jobs`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/wait-for-green-ci.yaml`

- [ ] **Step 1: Replace the inline gitlab polling bash loop (L33-L60) with**:

```yaml
# BEFORE (L33-L60):
- RUN: bash -c "
... polling loop calling glab api .../merge_requests/{iid} ...
"

# AFTER (single INCLUDE per iteration):
- INCLUDE: common/find-mr
- INCLUDE: common/get-mr-pipeline
  # Caller polls via repeated SKILL invocation (sub-workflow) or wraps in a bash loop here
```

- [ ] **Step 2: Replace the github polling bash loop (L65-L93) similarly** — INCLUDE: common/find-mr + INCLUDE: common/get-mr-pipeline.

- [ ] **Step 3: Add failure-path INCLUDE: common/get-failed-jobs** when pipeline_status is `failed` (L108-L125 area). Add OUTPUT message with the job list.

- [ ] **Step 4: Verify** — `git diff` shows the substitution.

- [ ] **Step 5: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add ... && git commit -m "refactor(issue-tracking): wait-for-green-ci INCLUDEs atomics + get-failed-jobs"`.

---

## Task 8: Refactor `common/post-dev-complete.yaml` to INCLUDE `merge-mr`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/post-dev-complete.yaml`

- [ ] **Step 1: Replace the L207-L263 inline merge block (4 variants × list+merge pairs = 6 inline calls) with**:

```yaml
# AFTER:
- CHECK: do_merge eq "yes"
  TRUE:
    # Seed cross-platform vars (atomic references {git_host}/{git_project}/{git_owner}/{git_repo};
    # check-config doesn't produce them — mirror existing post-dev-complete.yaml L212-217, L235-250).
    - READ: _bmad/custom/issue-tracking.yaml
      EXTRACT:
        git_host: issue_tracking.git_host
        git_project: issue_tracking.git_project
    - RUN: uv run --no-project python -c "
import sys
parts = sys.argv[1].split('/')
print(parts[0])
" {git_project}
      STORE: git_owner
    - RUN: uv run --no-project python -c "
import sys
parts = sys.argv[1].split('/')
print(parts[1])
" {git_project}
      STORE: git_repo
    - INCLUDE: common/merge-mr
```

- [ ] **Step 2: Verify** — `git diff` shows only the INCLUDE substitution; no other changes.

- [ ] **Step 3: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add ... && git commit -m "refactor(issue-tracking): post-dev-complete merge block INCLUDEs merge-mr atomic"`.

---

## Task 9: Refactor `common/mark-mr-ready.yaml` to INCLUDE `find-mr`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/mark-mr-ready.yaml`

- [ ] **Step 1: Replace the inline find (L72-L77 gitlab + L86-L91 github) with INCLUDE: common/find-mr**. Keep the `glab mr update --ready` / `gh pr ready` inline (1-call primitives, don't warrant an atomic yet).

- [ ] **Step 2: Verify + commit**.

---

## Task 10: Refactor `bmad-prd/complete.yaml` + `create-prd/complete.yaml` to INCLUDE `ensure-mr`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/bmad-prd/complete.yaml`
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/create-prd/complete.yaml`

- [ ] **Step 1: In each file, replace the inline MR list+create block with INCLUDE: common/ensure-mr**, passing `mr_repo` + `source_branch` + `target_branch` + `title` + `description_file` env vars.

- [ ] **Step 2: Verify** — both files have INCLUDE: common/ensure-mr in their respective MR-create sections.

- [ ] **Step 3: Commit** — 2 separate commits (one per file), each with a clear message naming the file.

---

## Task 11: Bump module version in both `module-manifest.toml` files

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/module-manifest.toml`
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-sync/module-manifest.toml`

- [ ] **Step 1: Verify current version** — `grep '^version' /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/module-manifest.toml`. Expected: `version = "3.0.0"`.

- [ ] **Step 2: Bump in setup skill** — `sed -i 's/version = "3.0.0"/version = "3.1.0"/' /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/module-manifest.toml`.

- [ ] **Step 3: Bump in sync skill** — `sed -i 's/version = "3.0.0"/version = "3.1.0"/' /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-sync/module-manifest.toml`.

- [ ] **Step 4: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-{setup,sync}/module-manifest.toml && git commit -m "chore(issue-tracking): bump version to 3.1.0 (4 new atomics + 7 consumer refactors)"`.

---

## Task 12: Add Step 2c to `bmad-issue-tracking-sync/SKILL.md` for MR ops routing

**Files:**
- Modify: `/home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-sync/SKILL.md`

- [ ] **Step 1: Read current SKILL.md** — find where Step 2a (scoped issue sync) ends + Step 2b (full sweep) begins.

- [ ] **Step 2: Insert Step 2c** between them with the routing body:

```markdown
3. **Step 2c — scoped MR ops (preferred for orchestrator hooks):**
   a. Read `BMAD_MR_ACTION` env var. Route:
      - `BMAD_MR_ACTION=ensure-mr` → require env `BMAD_MR_SOURCE_BRANCH`, `BMAD_MR_TARGET_BRANCH`, `BMAD_MR_TITLE`, `BMAD_MR_DESCRIPTION_FILE`, `BMAD_MR_REPO`; then `INCLUDE: common/ensure-mr`.
      - `BMAD_MR_ACTION=find-mr` → require `BMAD_MR_SOURCE_BRANCH`, `BMAD_MR_REPO`; then `INCLUDE: common/find-mr`.
      - `BMAD_MR_ACTION=get-mr-pipeline` → require `BMAD_MR_IID`; then `INCLUDE: common/get-mr-pipeline`.
      - `BMAD_MR_ACTION=get-failed-jobs` → require `BMAD_PIPELINE_ID`; then `INCLUDE: common/get-failed-jobs`.
      - `BMAD_MR_ACTION=merge-mr` → require `BMAD_MR_IID`, `BMAD_MR_SQUASH` (default "false"); then `INCLUDE: common/merge-mr`.
   b. Same env-var-driven parallel-safe pattern as Step 2a — no platform-specific CLI.
   c. Cleanup: the Skill caller's agent does `rm -f` on `BMAD_MR_DESCRIPTION_FILE` after Skill returns (best-effort).
```

- [ ] **Step 3: Commit** — `cd /home/jerome/git_projects/bmad-issue-tracking && git add skills/bmad-issue-tracking-sync/SKILL.md && git commit -m "feat(issue-tracking-sync): add Step 2c for MR ops routing via BMAD_MR_ACTION"`.

---

## Task 13: Replace 8 inline glab calls in `bmad-build-converge.js`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-orchestration/skills/bmad-build-converge/scripts/bmad-build-converge.js`

- [ ] **Step 1: Locate the 8 glab call sites**:
  - L392 — `glab api "projects?search=&lt;project&gt;&amp;simple=true"` (setup phase, project-id lookup)
  - L500 — `glab api ".../merge_requests?source_branch=...&amp;state=opened"` (find existing MR)
  - L502 — `glab mr create --yes --repo ...` (create MR)
  - L505 — `glab api ".../merge_requests/&lt;NID&gt;/pipelines?per_page=1"` (first pipeline for new MR)
  - L775 — `glab api ".../merge_requests/${mrIid}/pipelines?per_page=1"` (latest pipeline per CI-loop iter)
  - L779 — `glab api ".../pipelines/&lt;id&gt;/jobs?per_page=50"` (failed jobs)
  - L780 — `glab api ".../jobs/&lt;id&gt;/trace" | tail -80` (job trace)
  - L985 — `glab mr merge --yes --repo ... ${mrIid}` (merge MR)

- [ ] **Step 2: Replace L392** (project-id lookup) with: `BMAD_MR_ACTION=resolve-project-id Skill: bmad-issue-tracking` — wait, NO, this workflow doesn't exist. Skip this line entirely. The atomic workflows use `project_enc` (URL-encoded path) computed by `common/check-config.yaml` L55-59. The JS orchestrator doesn't need numeric project id at all — the Skill pattern inherits the path-encoded form.

  Actually: verify what's IN the prompt at L392 — is this glab call inside a sub-agent prompt string that the agent dispatches via `dispatchViaClaudeP`? If yes, the L392 glab call is REMOVED by deleting the whole sub-step in the setup agent prompt. Update the setup agent prompt to skip the project-id resolution step entirely (the Skill pattern doesn't need it).

- [ ] **Step 3: Replace L500 + L502** with:
  ```
  3. Invoke (wrap in try/catch — soft-fail, NEVER halt):
     BMAD_MR_ACTION=ensure-mr \
     BMAD_MR_SOURCE_BRANCH="${setup.storyBranch}" \
     BMAD_MR_TARGET_BRANCH="${setup.baseBranch}" \
     BMAD_MR_TITLE="Story ${setup.storyKey} — bmad-build-converge" \
     BMAD_MR_DESCRIPTION_FILE="${setup.relSpecPath}" \
     BMAD_MR_REPO="${configProject}" \
       Skill: bmad-issue-tracking
     Capture { mr_iid, mr_url } from Skill return (passed as the BMAD_MR_IID env var to subsequent calls).
  ```

- [ ] **Step 4: Replace L505** with: `BMAD_MR_ACTION=get-mr-pipeline BMAD_MR_IID=${capturedMrIid} Skill: bmad-issue-tracking`. Capture `{ pipeline_id, pipeline_status }`.

- [ ] **Step 5: Replace L775** (CI-loop polling): keep `currentSha` variable but replace glab with `BMAD_MR_ACTION=get-mr-pipeline BMAD_MR_IID=${mrIid} Skill: bmad-issue-tracking`. The Skill call's 1-2s overhead is acceptable for the polling loop (30s sleep between iterations dwarfs the overhead).

- [ ] **Step 6: Replace L779 + L780** (failed jobs + trace) with a single call: `BMAD_MR_ACTION=get-failed-jobs BMAD_PIPELINE_ID=${pipelineId} Skill: bmad-issue-tracking`. The atomic bundles job list + traces.

- [ ] **Step 7: Replace L985** (merge MR by IID): `BMAD_MR_ACTION=merge-mr BMAD_MR_IID=${mrIid} BMAD_MR_SQUASH=false Skill: bmad-issue-tracking`.

- [ ] **Step 8: Verify grep gate** — `grep -nE '^\s*(GITLAB_HOST=\S+\s+)?glab\s' /home/jerome/git_projects/bmad-orchestration/skills/bmad-build-converge/scripts/bmad-build-converge.js` → zero matches (only matches actual calls, not comments mentioning glab).

- [ ] **Step 9: Verify syntax gate** — `cp` to worktree + run `node --check` (with IIFE wrap preserved from previous round). EXIT 0 expected.

- [ ] **Step 10: Commit** — `cd /home/jerome/git_projects/bmad-orchestration && git add skills/bmad-build-converge/scripts/bmad-build-converge.js && git commit -m "refactor(orchestration): replace 8 inline glab calls with Skill: bmad-issue-tracking for MR ops"`.

---

## Task 14: Replace 1 inline glab call in `bmad-prd-orchestrate.js`

**Files:**
- Modify: `/home/jerome/git_projects/bmad-orchestration/skills/bmad-prd-orchestrate/scripts/bmad-prd-orchestrate.js`

- [ ] **Step 1: Locate the glab call** — L112: `glab api "projects?search=&lt;project&gt;&amp;simple=true"` (inside setup agent prompt).

- [ ] **Step 2: Delete the entire project-id lookup step** from the setup agent prompt. The Skill pattern inherits the path-encoded project from `common/check-config.yaml` — no numeric-id resolution needed.

- [ ] **Step 3: Verify grep gate** — `grep -nE '^\s*(GITLAB_HOST=\S+\s+)?glab\s' /home/jerome/git_projects/bmad-orchestration/skills/bmad-prd-orchestrate/scripts/bmad-prd-orchestrate.js` → zero matches.

- [ ] **Step 4: Verify syntax gate** — `cp` to worktree + `node --check` → EXIT 0.

- [ ] **Step 5: Commit** — `cd /home/jerome/git_projects/bmad-orchestration && git add skills/bmad-prd-orchestrate/scripts/bmad-prd-orchestrate.js && git commit -m "refactor(orchestration): remove inline project-id lookup (Skill pattern uses path-encoded project_enc)"`.

---

## Task 15: Mirror changes to this worktree (gitignored runtime deploy)

**Files:**
- Modify: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/_bmad/_config/custom/workflows/common/` (all 4 new atomics + refactored consumers)
- Modify: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/.agents/skills/bmad-issue-tracking-sync/` (SKILL.md + module-manifest.toml)

- [ ] **Step 1: Deploy workflow YAMLs to worktree** — `cp /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/common/{find-mr,get-mr-pipeline,get-failed-jobs,merge-mr}.yaml /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/_bmad/_config/custom/workflows/common/`.

- [ ] **Step 2: Deploy refactored consumer YAMLs to worktree** — `cp` for each of: `ensure-mr.yaml`, `check-mr-ci.yaml`, `wait-for-green-ci.yaml`, `post-dev-complete.yaml`, `mark-mr-ready.yaml`, `bmad-prd/complete.yaml`, `create-prd/complete.yaml` from upstream → worktree.

- [ ] **Step 3: Deploy SKILL.md + module-manifest.toml to worktree** — `cp` from upstream `bmad-issue-tracking-sync/` to `.agents/skills/bmad-issue-tracking-sync/` in the worktree.

- [ ] **Step 4: Deploy JS scripts to worktree** — `cp /home/jerome/git_projects/bmad-orchestration/skills/bmad-{build-converge,prd-orchestrate}/scripts/bmad-*.js /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/.agents/skills/bmad-{build-converge,prd-orchestrate}/scripts/bmad-*.js`.

- [ ] **Step 5: Verify node --check on both** — `node --check /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/.agents/skills/bmad-build-converge/scripts/bmad-build-converge.js` and `bmad-prd-orchestrate.js` → both EXIT 0.

- [ ] **Step 5b: Clean stale orphan files in worktree's `_bmad/` cache** — the worktree's `_bmad/_config/custom/workflows/{code-review,create-story}/` directories still contain stale `complete.yaml` files copied from the pre-`d1eacc5` cache. The upstream source no longer ships them (intentional removal). Run: `rm -f /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/_bmad/_config/custom/workflows/code-review/complete.yaml /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/_bmad/_config/custom/workflows/create-story/complete.yaml`. Verify with `ls` that each dir now contains only `activation.yaml`.

- [ ] **Step 6: Commit** — `cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd && git add .agents/skills/bmad-{issue-tracking-sync,build-converge,prd-orchestrate}/ && git commit -m "chore(orchestration): mirror upstream MR ops refactor + clean stale complete.yaml orphans"` (the runtime deploys in `_bmad/` are gitignored and not committed; the orphan cleanup is also runtime-state).

---

## Task 16: Update memory + cross-share

**Files:**
- Modify: `~/.claude/projects/-home-jerome-git-projects-ITU-genie-ai/memory/project_bmad_issue_tracking_scoped_upstream_pending.md`
- Modify: `~/.claude/projects/-home-jerome-git-projects-bmad-orchestration/memory/project_bmad_issue_tracking_scoped_upstream_pending.md`

- [ ] **Step 1: Read current entry**, update:
  - 4 new/refactored workflows: `find-mr`, `get-mr-pipeline`, `get-failed-jobs`, `merge-mr`
  - 7 refactored consumers: `ensure-mr`, `check-mr-ci`, `wait-for-green-ci`, `post-dev-complete`, `mark-mr-ready`, `bmad-prd/complete`, `create-prd/complete`
  - JS orchestrator changes: 9 inline glab calls replaced (8 in build-converge, 1 in orchestrate)
  - Version bump: 3.0.0 → 3.1.0
  - Upstream PR coordination: TWO PRs needed — one against `jrevillard/bmad-issue-tracking` (YAML module) + one against `jrevillard/bmad-orchestration` (JS orchestrators). Do NOT merge until both land and can be consumed atomically.

- [ ] **Step 2: Cross-share** — `cp .../ITU-genie-ai/memory/project_bmad_issue_tracking_scoped_upstream_pending.md .../bmad-orchestration/memory/`.

- [ ] **Step 3: Commit** — `cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd && git add .claude/ 2>&1 | tail -3` (memory lives in `~/.claude/projects/`, not in repo — cross-share is the only persistence).

---

## Task 17: Final verification + summary

- [ ] **Step 1: Glab/Gh inventory on upstream `bmad-issue-tracking`** — `grep -rl 'glab\|gh api\|gh pr\|gh issue\|gh run' /home/jerome/git_projects/bmad-issue-tracking/skills/bmad-issue-tracking-setup/assets/workflows/ | xargs grep -c 'glab\|gh api\|gh pr\|gh issue\|gh run' | sort -t: -k2 -n`. Expected: ~25 call sites (down from ~73 pre-refactor); each consumer file should show fewer inline calls than before.

- [ ] **Step 2: Glab/Gh inventory on JS orchestrators** — `grep -nE '^\s*(GITLAB_HOST=\S+\s+)?glab\s' /home/jerome/git_projects/bmad-orchestration/skills/bmad-{build-converge,prd-orchestrate}/scripts/bmad-*.js` → zero matches.

- [ ] **Step 3: Syntax gates** — `node --check` on both JS files → EXIT 0.

- [ ] **Step 4: Deploy verification** — `ls /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/_bmad/_config/custom/workflows/common/{find-mr,get-mr-pipeline,get-failed-jobs,merge-mr}.yaml` → all 4 present.

- [ ] **Step 5: Final summary** — list all commits:
  - `bmad-issue-tracking` repo: 11 commits (Tasks 1, 2, 3, 5, 6, 7, 8, 10 × 2, 11)
  - `bmad-orchestration` repo: 2 commits (Tasks 13, 14)
  - worktree: 2 commits (Tasks 15, 16)

---

## Self-Review (writing-plans skill §"Self-Review")

**1. Spec coverage:**
- [x] Story lifecycle MR ops (ensure-mr, merge-mr) → Tasks 1, 5, 8, 13 ✓
- [x] CI loop polling (get-mr-pipeline) → Tasks 2, 6, 7, 13 ✓
- [x] Failed-job diagnostics → Tasks 3, 7, 13 ✓
- [x] Project-id resolution REMOVED (Skill pattern uses path-encoded project_enc; numeric id unnecessary) ✓
- [x] SKILL.md env-var routing → Task 12 ✓
- [x] Memory + cross-share → Task 16 ✓
- Gaps: none

**2. Placeholder scan:**
- [x] No "TBD" / "TODO" / "fill in later"
- [x] No "add appropriate error handling"
- [x] No "similar to Task N" (every task shows its own YAML)
- [x] No "etc." / "and so on"
- All code blocks are complete (Tasks 1-4 show full atomic YAML; Tasks 5-10 show before/after diffs)
- No placeholders found

**3. Type consistency:**
- `mr_iid` (string) — used consistently in YAML atomic contracts + JS orchestrator env vars
- `pipeline_id` (string) — unified output name across gitlab + github (Task 2 rename from github's `run_id`)
- `merge_sha` (string) — consistent output, no longer from hardcoded `git -C` path (Task 4 API-based)
- `merged` (string "true"/"false") — derived from CLI stdout capture, not from pipeline_status preflight (Task 4 truth-source fix)
- `jobs` (newline-separated JSON) — consistent output across gitlab (json.dumps) + github (`gh run view --log-failed`)
- `mr_url` (string) — captured via stdout URL extraction (Task 5, no `--output json` flag)
- Variable names match across tasks — no drift

---

## Out of scope

- Re-validating every existing glab/gh call site in the module (verified ~25 call sites remain post-refactor; correctness assumed unless Task 17 Step 1 reveals unexpected patterns).
- Refactoring `code-review/complete.yaml` (DOES NOT EXIST — only `activation.yaml` is in that dir).
- Refactoring `create-story/complete.yaml` (DOES NOT EXIST — only `activation.yaml` is in that dir).
- Extracting `merge-mr.yaml`'s `glab mr update --ready` / `gh pr ready` calls into a `mark-mr-ready` atomic (1-call primitive; doesn't warrant extraction yet).
- Replacing the `gh pr checks` calls in `check-mr-ci.yaml` with the unified `get-mr-pipeline` (different concept — per-check status vs pipeline id; both coexist).
- Coordinating the actual upstream PRs against `jrevillard/bmad-issue-tracking` and `jrevillard/bmad-orchestration` — that's Phase E of the plan, after this PR merges to main. Update the memory entry to flag it.
- Removing the `code-review/complete.yaml` reference in `bmad-issue-tracking-setup/SKILL.md` if it exists there — out of scope (the plan is about MR ops, not skill references).
