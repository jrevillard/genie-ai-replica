---
name: bmad-issue-tracking-sync
description: 'Sync sprint-status.yaml entries to GitLab/GitHub Issues. Use when the user says "sync issues" or wants to push sprint status to the issue tracker.'
---

# Sync Sprint Status to Issues (GitLab or GitHub)

## Prerequisites

- `glab` CLI (for GitLab) or `gh` CLI (for GitHub) installed and authenticated
- Repository has Issues enabled
- `sprint-status.yaml` exists at `{implementation_artifacts}/sprint-status.yaml`
- `prd_key` in `prd.md` frontmatter (required — the sync fails closed if absent; run `/bmad-issue-tracking-setup` if not set)
- Workflow files deployed by `/bmad-issue-tracking-setup` in `_bmad/_config/custom/workflows/`

## Optional env vars (for JS orchestrator call sites)

When invoked from `bmad-build-converge` or `bmad-prd-orchestrate`, these env vars scope the sync to a whitelist of sprint keys instead of re-walking the whole PRD. They take effect when set, fall back to full sweep when unset.

- `BMAD_ISSUE_SYNC_SCOPE` — comma-separated sprint keys (e.g. `1-1-…,epic-2`). When set, only those entries are processed.
- `BMAD_ISSUE_SYNC_COMMENT_FILE` — path to a tmp file containing the comment body to post on every synced issue. The JS orchestrator's sync agent generates the path (PID+nonce) and writes the body via a quoted-heredoc shell command before invoking the Skill (avoids shell interpolation of user-supplied prose — eliminates injection risk for comments with backticks / `$()` / quotes). The same agent does `rm -f` on the file after the Skill returns. Empty/unset = no comment.
- `BMAD_ISSUE_SYNC_POPULATE_DESC` — `true` (default when SCOPE set) to refresh issue description from spec file (story) or epic section (epic). Set to `false` to skip description updates.

## Instructions

1. Read `_bmad/_config/custom/bmad-workflow-lang.md` for the workflow language specification.
2. Detect scope mode: if `BMAD_ISSUE_SYNC_SCOPE` is set, run step 2a. Otherwise run step 2b.
3. **Step 2a — scoped sync (preferred for orchestrator hooks):**
   a. Execute the scoped sync workflow: `_bmad/_config/custom/workflows/issue-sync/sync-scoped.yaml`.
   b. The workflow reads `BMAD_ISSUE_SYNC_SCOPE` and `BMAD_ISSUE_SYNC_COMMENT_FILE` from env vars via python `os.environ.get(...)` — no shell interpolation, so user-supplied comment text can't trigger command substitution. Concurrent sync invocations from parallel stories each get their own env scope + their own comment file (PID+nonce), so no race.
   c. (No cleanup step in the Skill — the JS orchestrator's sync agent unlinks the file after the Skill returns.)
4. **Step 2b — full sync (manual / unattended):**
   a. Execute the prepare workflow: `_bmad/_config/custom/workflows/issue-sync/prepare.yaml`
   b. Execute the sync workflow: `_bmad/_config/custom/workflows/issue-sync/sync.yaml`
5. **Failure handling:** workflow failures are soft — log the error to the journal (when invoked from an orchestrator) and return `{error}` rather than halting. The orchestrator's final-report pass catches any drift.

## Unattended usage (after a bmad-loop run)

The sync is fully silent — no prompts, no PRD worktree required (`common/find-prd-key` resolves `prd_key` from `prd.md` on the current tree; `common/mark-mr-ready` is a no-op when no MR exists). Run it after a `bmad-loop run` to mirror the sprint status bmad-loop maintained, then `git push origin main` to publish the local merge-back. See "BMAD Loop integration" in the README.
