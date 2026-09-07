export const meta = {
  name: 'bmad-build-converge',
  description: 'Single-story bmad-build with quality-gate convergence loop + CI gate + auto-merge. Generic across any BMAD PRD: discovers repo, PRD worktree, issue-tracking config, and project_key from sprint-status.yaml.',
  phases: [
    { title: 'Setup' },
    { title: 'Build with convergence' },
    { title: 'Push & MR + Monitor CI' },
    { title: 'Auto-merge' },
    { title: 'Cleanup' },
  ],
};

const storyKey = args.storyKey;
if (!storyKey) throw new Error('args.storyKey required');
const maxIterations = args.maxIterations || 5;
const timestamp = args.timestamp || 'unknown';

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    storyKey: { type: 'string' },
    repoRoot: { type: 'string' },
    prdWorktreePath: { type: 'string' },
    prdKey: { type: 'string' },
    baseBranch: { type: 'string' },
    storyBranch: { type: 'string' },
    worktreePath: { type: 'string' },
    baselineSha: { type: 'string' },
    resumedFromBranch: { type: 'boolean' },
    sprintStatusUpdated: { type: 'boolean' },
    sprintStatusPath: { type: 'string' },
    specPath: { type: 'string' },
    gitlabHost: { type: 'string' },
    gitlabProjectId: { type: 'integer' },
    prdBranch: { type: 'string' },
  },
  required: ['storyKey', 'repoRoot', 'prdWorktreePath', 'prdKey', 'baseBranch', 'storyBranch',
             'worktreePath', 'baselineSha', 'resumedFromBranch', 'sprintStatusUpdated',
             'sprintStatusPath', 'specPath', 'gitlabHost', 'gitlabProjectId', 'prdBranch'],
};

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    storyKey: { type: 'string' },
    iteration: { type: 'integer' },
    newSha: { type: 'string' },
    followupReviewRecommended: { type: 'boolean' },
    patchesApplied: { type: 'integer' },
    itemsDeferred: { type: 'integer' },
    scoreFormula: { type: 'string' },
    specStatus: { type: 'string' },
    pushed: { type: 'boolean' },
    error: { type: 'string' },
  },
  required: ['storyKey', 'iteration', 'newSha', 'followupReviewRecommended', 'specStatus', 'pushed'],
};

const MONITOR_SCHEMA = {
  type: 'object',
  properties: {
    storyKey: { type: 'string' },
    mrIid: { type: 'integer' },
    pipelineId: { type: 'integer' },
    status: { type: 'string', enum: ['success', 'failed', 'canceled', 'skipped', 'running'] },
    failedJobs: { type: 'array', items: { type: 'object' } },
    retries: { type: 'integer' },
    transient: { type: 'boolean' },
  },
  required: ['storyKey', 'mrIid', 'pipelineId', 'status', 'retries', 'transient'],
};

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    storyKey: { type: 'string' },
    mrIid: { type: 'integer' },
    merged: { type: 'boolean' },
    error: { type: 'string' },
    sprintStatusDone: { type: 'boolean' },
  },
  required: ['storyKey', 'mrIid', 'merged', 'sprintStatusDone'],
};

const CLEANUP_SCHEMA = {
  type: 'object',
  properties: {
    removedWorktrees: { type: 'array', items: { type: 'string' } },
    deletedBranches: { type: 'array', items: { type: 'string' } },
    prunedRefs: { type: 'integer' },
    removedLogs: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['removedWorktrees', 'deletedBranches', 'prunedRefs', 'removedLogs', 'errors'],
};

// ============================================================================
// PHASE 1: SETUP — discover repo, PRD worktree, config, project_key
// ============================================================================
phase('Setup')
log(`Setup for story ${storyKey} (discovering repo context)...`)
const setup = await agent(
  `You are the setup agent for story ${storyKey}.

GENERIC DISCOVERY (works for any BMAD PRD — admin-logs-victorialogs, keycloak-idp, mobile-oidc, etc.):

STEPS:
1. Discover repo + PRD worktree:
   a. \`git rev-parse --show-toplevel\` → repoRoot (bare git dir, e.g. /home/<user>/git_projects/<org>/genie-ai).
   b. \`git worktree list --porcelain\` → parse PORCELAIN format. Each entry:
      - Line 'worktree <path>' starts a new worktree section.
      - Line 'branch refs/heads/<name>' gives the checked-out branch.
      Find the worktree whose branch matches pattern 'refs/heads/feat/*/prd' (the PRD umbrella branch per _bmad/custom/issue-tracking.yaml branch_patterns.prd). That worktree is prdWorktreePath. The branch suffix after 'refs/heads/feat/' and before '/prd' is the prdKey.
   c. If no worktree matches → HALT (return error in storyKey, prdWorktreePath empty). This workflow requires a PRD umbrella branch + worktree.
2. Read config:
   a. From prdWorktreePath, read _bmad/custom/issue-tracking.yaml. Parse YAML. Required fields:
      - git_platform: gitlab
      - host: <gitlab host>
      - project: <gitlab project path, e.g. un/itu/genie-ai>
      - worktree_base: <relative path from repoRoot, typically .claude/worktrees>
      - branch_patterns.prd: "feat/{prd_key}/prd"
      - branch_patterns.story: "feat/{prd_key}/{story_key}"
   b. Resolve gitlabProjectId: query \`GITLAB_HOST=<host> glab api "projects?search=<project-name>&simple=true"\` and pick the first match's id. If fails, fallback to numeric lookup via /projects/<url-encoded-path>. Store as gitlabProjectId integer.
   c. Verify prdKey from step 1b matches the project's git remote: \`git -C repoRoot remote -v\`. The remote URL host should match config host.
3. baseBranch = worktree_base-style interpolation: feat/<prd_key>/prd (matches the existing PRD branch you found).
4. Confirm story is ready:
   a. sprintStatusPath = prdWorktreePath + '/_bmad-output/implementation-artifacts/sprint-status.yaml'.
   b. Read sprintStatusPath. Find development_status[<storyKey>]. Status MUST be 'ready-for-dev' or 'review'. If not, HALT with sprintStatusUpdated:false.
5. Find or create storyBranch = feat/<prd_key>/<story_key>:
   a. \`git -C repoRoot ls-remote origin <storyBranch>\` — if exists remotely, use it. resumedFromBranch=true.
   b. \`git -C repoRoot branch --list <storyBranch>\` — if exists locally, use it. resumedFromBranch=true.
   c. Else: create from origin/<baseBranch>. \`git -C repoRoot push origin origin/<baseBranch>:refs/heads/<storyBranch>\`. resumedFromBranch=false.
   d. baselineSha:
      - If resumed: \`git -C repoRoot rev-parse origin/<storyBranch>\` (or local tip if no remote).
      - If new: \`git -C repoRoot rev-parse origin/<baseBranch>\`.
6. Create worktree:
   worktreePath = repoRoot + '/' + worktree_base + '/' + storyBranch-with-slashes-replaced-by-dashes.
   Example: /home/x/git_projects/y/genie-ai/.claude/worktrees/feat-admin-logs-victorialogs-5-4-admin-dashboard-service-drop-fs-readfile-path-join-delegate
   Command: \`git -C repoRoot worktree add <worktreePath> <storyBranch>\`.
7. Sync sprint-status INSIDE the story worktree (it's a tracked file; commit goes onto storyBranch):
   cd <worktreePath>
   - Update development_status[<storyKey>] = in-progress
   - Find epic-{N} where N = first numeric segment of <storyKey>. Set to in-progress if currently backlog.
   - Update last_updated to "${timestamp}"
   - git add + commit -m "chore(sprint-status): story <storyKey> → in-progress"
   - DO NOT push this commit.
8. Update spec frontmatter:
   specPath = <worktreePath>/_bmad-output/implementation-artifacts/stories/<storyKey>.md
   Edit specPath:
   - status: in-progress
   - baseline_revision: <baselineSha>  # bmad-build-auto reads THIS field (NOT baseline_commit)
   git add + commit (no push).
9. Return SETUP_SCHEMA JSON with ALL fields filled. The other phases depend on these — incomplete context = broken workflow.

CONSTRAINTS:
- DO NOT modify prdWorktreePath (the PRD worktree). Only create the story worktree.
- DO NOT push to remote (build agent handles).
- DO NOT skip the sprint-status sync.
- If discovery fails at any step, HALT with the failing field empty + clear error in storyKey.`,
  { label: `setup-${storyKey}`, phase: 'Setup', schema: SETUP_SCHEMA, agentType: 'general-purpose' }
)

if (!setup || !setup.worktreePath) {
  return { aborted: true, stage: 'setup', storyKey, error: 'setup agent failed or discovery incomplete' }
}
log(`Repo: ${setup.repoRoot} | PRD worktree: ${setup.prdWorktreePath} | prdKey: ${setup.prdKey}`)
log(`Story branch: ${setup.storyBranch} | Worktree: ${setup.worktreePath} | Baseline: ${setup.baselineSha}`)

// ============================================================================
// PHASE 2: BUILD WITH CONVERGENCE
// ============================================================================
phase('Build with convergence')
log(`Running bmad-build convergence loop (max ${maxIterations} iterations)...`)

let iteration = 0;
let followup = true;
let currentSha = setup.baselineSha;
let convergedSha = null;
let iterationsLog = [];

while (followup && iteration < maxIterations) {
  iteration++;
  log(`--- Iteration ${iteration}/${maxIterations} (baseline ${currentSha.substring(0, 7)}) ---`)

  const buildResult = await agent(
    `You are the bmad-build agent for story ${setup.storyKey}, iteration ${iteration}.

CONTEXT (from setup agent):
- repoRoot: ${setup.repoRoot}
- prdWorktreePath: ${setup.prdWorktreePath}
- prdKey: ${setup.prdKey}
- baseBranch: ${setup.baseBranch}
- storyBranch: ${setup.storyBranch}
- worktreePath: ${setup.worktreePath}
- specPath: ${setup.specPath}
- baselineSha: ${currentSha}
- gitlabHost: ${setup.gitlabHost}
- gitlabProjectId: ${setup.gitlabProjectId}

OPERATE FROM: ${setup.worktreePath} (git checkout branch ${setup.storyBranch}).

RUN bmad-build:
1. Read spec at ${setup.specPath}.
2. Update baseline_revision in spec frontmatter to current SHA (${currentSha}). bmad-build-auto's step-04 reads baseline_revision (NOT baseline_commit) to compute the reviewer diff. Baseline STAYS at origin/prdBranch tip across iterations so reviewers see full cumulative diff for context — do NOT reset to previous iteration's SHA.
3. Run bmad-build via Skill: \`Skill: bmad-build-auto ${setup.storyKey}\` (NOT bmad-build — the auto version writes the followup_review_recommended flag the outer workflow reads). Follow step-01..05 exactly.
   - Step-01: routing (spec is in-progress → step-03)
   - Step-03: implement (subagent dispatches implementation)
   - Step-04: 3 parallel reviewers (blind hunter, edge-case, verification-gap) → classify + apply patches + write followup_review_recommended in spec frontmatter + increment review_loop_iteration counter
   - Step-05: present (build review-order section, mark done)
4. The Skill call may not give you the full workflow.md inline — use Read on the rendered path the Skill returns.

QUALITY GATE (after build completes):
- Read spec frontmatter followup_review_recommended field.
- Formula reminder: followup = TRUE if any patched finding was HIGH severity, OR if (3 × medium_count + 1 × low_count) ≥ 5.
- bmad-build-auto writes this flag automatically. Your job: read it back + return to outer workflow.

COMMIT + PUSH:
- \`git add -A && git commit -m "fix(${setup.prdKey}): story ${setup.storyKey} bmad-build iter ${iteration}"\` (amend if only orchestrator artifacts)
- \`git push --force-with-lease origin ${setup.storyBranch}\`

FORMAT CHECK (per memory feedback_rtk_lint_false_positives):
- After push, run: \`cd ${setup.worktreePath}/components/gov-chat-backend && rtk proxy npx prettier --check "**/*.js"\`
- If fail: \`rtk proxy npx prettier --write "**/*.js"\` + commit + push.

RETURN BUILD_SCHEMA:
- newSha = HEAD after push
- **followupReviewRecommended = EXACT boolean value of spec frontmatter 'followup_review_recommended' field**. bmad-build-auto writes this in its finalize step. Read it via Read or Grep. Do NOT infer, hallucinate, or compute it yourself — the outer workflow depends on this value being correct. If the field is missing or empty, set followupReviewRecommended=false (treat as converged).
- patchesApplied / itemsDeferred = from spec Auto Run Result section (parse the "Patches applied" + "Items deferred" lines)
- scoreFormula = the formula string
- specStatus = spec frontmatter status field
- pushed = true after successful push

VERIFICATION before returning:
1. Read spec file. Confirm frontmatter has followup_review_recommended field (boolean).
2. Confirm spec status is 'done' or 'in-review' (NOT 'draft', NOT 'ready-for-dev', NOT 'in-progress').
3. If either check fails, return error string + set pushed=false + followupReviewRecommended=true (forces outer loop to retry).

ERRORS:
- If bmad-build halts or errors, return error string in error field, set pushed=false, followupReviewRecommended=true.`,
    { label: `build-iter-${iteration}`, phase: 'Build with convergence', schema: BUILD_SCHEMA, agentType: 'general-purpose' }
  )

  if (!buildResult || buildResult.error) {
    log(`Build agent failed: ${buildResult && buildResult.error}`)
    iterationsLog.push({ iter: iteration, error: buildResult?.error || 'no result' })
    followup = false
    break
  }

  iterationsLog.push({
    iter: iteration,
    sha: buildResult.newSha,
    followup: buildResult.followupReviewRecommended,
    specStatus: buildResult.specStatus,
    patchesApplied: buildResult.patchesApplied,
    itemsDeferred: buildResult.itemsDeferred,
  })

  currentSha = buildResult.newSha
  followup = buildResult.followupReviewRecommended
  if (!followup) {
    convergedSha = buildResult.newSha
    log(`Converged after iteration ${iteration}`)
  }
}

if (followup) {
  log(`HIT ITERATION CAP (${maxIterations}) without convergence — ESCALATING`)
  return {
    storyKey: setup.storyKey,
    converged: false,
    iterations: iteration,
    finalSha: currentSha,
    iterationsLog,
    escalateReason: `followup_review_recommended stayed true through ${maxIterations} iterations`,
    worktreePath: setup.worktreePath,
    branch: setup.storyBranch,
  }
}

log(`Story ${setup.storyKey} converged at ${convergedSha} after ${iteration} iteration(s)`)

// ============================================================================
// PHASE 3: PUSH & MR + MONITOR CI (combined into one agent)
// ============================================================================
phase('Push & MR + Monitor CI')
log(`Creating MR + monitoring CI for ${setup.storyBranch}...`)
const ciResult = await agent(
  `Create MR + monitor CI pipeline for branch ${setup.storyBranch} → ${setup.baseBranch}, story ${setup.storyKey}.

CONTEXT (from setup agent):
- repoRoot: ${setup.repoRoot}
- prdKey: ${setup.prdKey}
- baseBranch: ${setup.baseBranch}
- storyBranch: ${setup.storyBranch}
- worktreePath: ${setup.worktreePath}
- gitlabHost: ${setup.gitlabHost}
- gitlabProjectId: ${setup.gitlabProjectId}
- iteration: ${iteration}

OPERATE FROM: ${setup.worktreePath}

PART A — CREATE MR:
1. Verify branch pushed: \`git ls-remote origin ${setup.storyBranch}\` — if missing, push: \`git push --force-with-lease origin ${setup.storyBranch}\`
2. Check existing MR: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests?source_branch=${setup.storyBranch}&state=opened"\` — if found, use existing mrIid.
3. If no MR: create via:
   \`GITLAB_HOST=${setup.gitlabHost} glab mr create --yes --repo <config-project> --source-branch "${setup.storyBranch}" --target-branch "${setup.baseBranch}" --title "Story ${setup.storyKey} — bmad-build-converge" --description "Auto-generated by bmad-build-converge. Converged after ${iteration} iteration(s). See spec file for review order." --remove-source-branch\`
   (config-project is read from _bmad/custom/issue-tracking.yaml: project field.)
4. Parse mrIid from URL pattern /merge_requests/<NID>.
5. Fetch pipeline id: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests/<NID>/pipelines"\` → first id.

PART B — MONITOR CI (do this in the SAME agent call, do NOT return after Part A):
6. Launch ci-monitor in background: \`Bash(command="/tmp/ci-monitor.sh <pipelineId> 60", run_in_background=true)\` → returns task_id.
7. Await: \`TaskOutput(task_id=<task_id>, block=true, timeout=1800000)\` (30 min max). Read the "TERMINAL:<status>" line.
8. Parse status (success/failed/canceled/skipped).
9. If failed, classify transient vs hard fail:
   - Fetch failed jobs: \`Bash(command="GITLAB_HOST=${setup.gitlabHost} glab api 'projects/${setup.gitlabProjectId}/pipelines/<pipelineId>/jobs?per_page=50'")\`
   - For each failed job, trace tail: \`Bash(command="GITLAB_HOST=${setup.gitlabHost} glab api 'projects/${setup.gitlabProjectId}/jobs/<id>/trace' | tail -80")\`
   - TRANSIENT (retry candidate): 'build:*' or 'scan:*' or 'promote:*' jobs + error mentions 'registry'/'cache'/'502'/'524'/'connection refused'; OR any job with 'runner'/'no space left'/'disk full'/'timeout'.
   - FIXABLE (not transient): 'lint:*'/'format:check' with prettier formatting issues (return failedJobs with file list).
   - HARD FAIL: everything else.
10. INTERNAL RETRY (up to 2 times, no sleep in your context — use Bash(run_in_background:true)):
    If transient: empty commit + push to retrigger pipeline. Wait 10s via Bash sleep. Fetch new pipelineId. Go back to step 6.
    Count retries. Return final retries count in the result.
11. Return JSON: { storyKey: ${setup.storyKey}, mrIid, mrUrl, pipelineId, branch: ${setup.storyBranch}, status, failedJobs, retries, transient, error? }

DO NOT poll or sleep in your own context. Use Bash(run_in_background:true) + TaskOutput(block:true) for ci-monitor.
DO NOT return between Part A and Part B — do both in this single invocation.`,
  { label: `ci-${setup.storyKey}`, phase: 'Push & MR + Monitor CI', schema: {
    type: 'object',
    properties: {
      storyKey: { type: 'string' },
      mrIid: { type: 'integer' },
      mrUrl: { type: 'string' },
      pipelineId: { type: 'integer' },
      branch: { type: 'string' },
      status: { type: 'string', enum: ['success', 'failed', 'canceled', 'skipped', 'running'] },
      failedJobs: { type: 'array', items: { type: 'object' } },
      retries: { type: 'integer' },
      transient: { type: 'boolean' },
      error: { type: 'string' },
    },
    required: ['storyKey', 'branch', 'status', 'retries', 'transient'],
  }, agentType: 'general-purpose' }
)

if (!ciResult || ciResult.error || !ciResult.mrIid) {
  return {
    storyKey: setup.storyKey,
    converged: true,
    iterations: iteration,
    finalSha: convergedSha,
    iterationsLog,
    ciResult,
    worktreePath: setup.worktreePath,
    branch: setup.storyBranch,
    aborted: ciResult?.error || 'no MR created',
  }
}

log(`MR !${ciResult.mrIid} | CI ${ciResult.status} after ${ciResult.retries} retries (transient=${ciResult.transient})`)

// ============================================================================
// PHASE 4: AUTO-MERGE
// ============================================================================
phase('Auto-merge')
let mergeResult = null;
if (ciResult.status === 'success') {
  log(`Auto-merging MR !${ciResult.mrIid}...`)
  mergeResult = await agent(
    `Merge MR !${ciResult.mrIid} for story ${setup.storyKey}.

CONTEXT:
- prdWorktreePath: ${setup.prdWorktreePath}
- baseBranch: ${setup.baseBranch}
- sprintStatusPath: ${setup.sprintStatusPath}
- gitlabHost: ${setup.gitlabHost}
- project: <from _bmad/custom/issue-tracking.yaml>

Use: \`GITLAB_HOST=${setup.gitlabHost} glab mr merge --yes --repo <project> ${ciResult.mrIid}\`
Capture stdout/stderr. If exit != 0, set merged=false with error string.

After successful merge:
- Sync sprint-status to done. Operate from the PRD worktree (${setup.prdWorktreePath}).
- cd to ${setup.prdWorktreePath}.
- Read ${setup.sprintStatusPath}.
- Update development_status[${setup.storyKey}] = done.
- Update last_updated to "${timestamp}".
- \`git add ${setup.sprintStatusPath} && git commit -m "chore(sprint-status): story ${setup.storyKey} → done (MR !${ciResult.mrIid} merged)" && git push origin ${setup.baseBranch}\`
- sprintStatusDone = true only if push succeeded.

Note: ${setup.worktreePath} was branched from ${setup.baseBranch} and the MR --remove-source-branch already deleted ${setup.storyBranch} on merge. The story worktree at ${setup.worktreePath} should auto-cleanup via MR --remove-source-branch. If not, the Cleanup phase handles it.

RETURN MERGE_SCHEMA.`,
    { label: `merge-${setup.storyKey}`, phase: 'Auto-merge', schema: MERGE_SCHEMA, agentType: 'general-purpose' }
  )
} else {
  log(`CI ${ciResult.status} — NOT auto-merging. Manual review needed.`)
  mergeResult = { storyKey: setup.storyKey, mrIid: ciResult.mrIid, merged: false, error: `CI ${ciResult.status}`, sprintStatusDone: false }
}

log(`Merge: ${mergeResult.merged ? 'OK' : 'SKIPPED'} | Sprint-status done: ${mergeResult.sprintStatusDone}`)

// ============================================================================
// PHASE 5: CLEANUP
// ============================================================================
phase('Cleanup')
log(`Cleaning up worktree ${setup.worktreePath}, branch ${setup.storyBranch}...`)
const cleanup = await agent(
  `Cleanup bmad-build artifacts for story ${setup.storyKey}.

CONTEXT:
- repoRoot: ${setup.repoRoot}
- prdWorktreePath: ${setup.prdWorktreePath}
- worktreePath: ${setup.worktreePath}
- storyBranch: ${setup.storyBranch}

WORKING FROM: ${setup.repoRoot} (the bare git root — worktree commands work from here).

STEPS:
1. Remove story worktree:
   \`git worktree remove --force ${setup.worktreePath}\`
   If already removed (branch merged → MR --remove-source-branch cleaned it), skip silently.
2. Delete local branch if it still exists (the MR was created with --remove-source-branch, so usually gone, but be defensive):
   \`git branch -D ${setup.storyBranch}\` (errors if missing — ignore).
3. Prune remote refs:
   \`git remote prune origin\`
4. Remove orchestrator log files in ${setup.prdWorktreePath}/_bmad-output/implementation-artifacts/ matching pattern bmad-build-auto-result-*${setup.storyKey}* (only those for the just-completed story).
5. Return CLEANUP_SCHEMA.

DO NOT remove files outside _bmad-output/.
DO NOT touch sprint-status.yaml or the spec file (those are tracked artifacts).
`,
  { label: `cleanup-${setup.storyKey}`, phase: 'Cleanup', schema: CLEANUP_SCHEMA, agentType: 'general-purpose' }
)

log(`Cleanup: worktrees=${cleanup.removedWorktrees.length} branches=${cleanup.deletedBranches.length} pruned=${cleanup.prunedRefs} logs=${cleanup.removedLogs.length}`)

// ============================================================================
// RETURN
// ============================================================================
return {
  storyKey: setup.storyKey,
  converged: true,
  iterations: iteration,
  finalSha: convergedSha,
  iterationsLog,
  setup: {
    repoRoot: setup.repoRoot,
    prdWorktreePath: setup.prdWorktreePath,
    prdKey: setup.prdKey,
    baseBranch: setup.baseBranch,
    storyBranch: setup.storyBranch,
    worktreePath: setup.worktreePath,
    baselineSha: setup.baselineSha,
  },
  mr: { mrIid: ciResult.mrIid, mrUrl: ciResult.mrUrl, pipelineId: ciResult.pipelineId },
  monitor: { status: ciResult.status, retries: ciResult.retries, transient: ciResult.transient, failedJobs: ciResult.failedJobs },
  merge: { merged: mergeResult.merged, error: mergeResult.error, sprintStatusDone: mergeResult.sprintStatusDone },
  cleanup: { worktrees: cleanup.removedWorktrees, branches: cleanup.deletedBranches, errors: cleanup.errors },
}