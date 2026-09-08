// Note: the meta is static at script-load time, so 'storyKey' can't be
// inlined. The 'name' field is fixed ('bmad-build-converge'); the
// 'description' shows the generic flow. To make the running story
// visible, check args.storyKey after the workflow starts.
//
// IMPORTANT: Workflow tool requires `export const meta = {...}` as the
// FIRST statement. No static imports allowed above it.
export const meta = {
  name: 'bmad-build-converge',
  description: 'Single-story bmad-build with quality-gate convergence loop + CI gate + auto-merge. Generic across any BMAD PRD: discovers repo, PRD worktree, issue-tracking config, and project_key from sprint-status.yaml. The story being processed is passed via args.storyKey (logged at Setup).',
  phases: [
    { title: 'Setup' },
    { title: 'Create MR' },
    { title: 'Build with convergence' },
    { title: 'Auto-merge' },
    { title: 'Cleanup' },
  ],
};

const storyKey = args.storyKey;
if (!storyKey) throw new Error('args.storyKey required');
const maxIterations = args.maxIterations || 5;
const timestamp = args.timestamp || 'unknown';
// On resume (e.g., after CI failure halted the workflow), the orchestrator re-invokes
// the sub-workflow with args.ciFailure describing the previous CI failure. The build
// agent passes this to bmad-build-auto's reviewers so the next iteration targets
// the actual CI failure rather than guessing.
let ciFailure = args.ciFailure || null;
// lastCIStatus is set inside the convergence loop and read after the loop
// to drive the auto-merge decision + the final log line. Must be declared
// at the same scope as the loop (not inside it) so it survives loop exit.
let lastCIStatus = null;

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

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    storyKey: { type: 'string' },
    mrIid: { type: 'integer' },
    merged: { type: 'boolean' },
    sprintStatusDone: { type: 'boolean' },
    error: { type: 'string' },
  },
  required: ['storyKey', 'mrIid', 'merged', 'sprintStatusDone'],
};

const CLEANUP_SCHEMA = {
  type: 'object',
  properties: {
    removedWorktrees: { type: 'array', items: { type: 'string' } },
    deletedBranches: { type: 'array', items: { type: 'string' } },
    keptWorktrees: { type: 'array', items: { type: 'string' } },
    keptBranches: { type: 'array', items: { type: 'string' } },
    prunedRefs: { type: 'integer' },
    removedLogs: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['removedWorktrees', 'deletedBranches', 'keptWorktrees', 'keptBranches', 'prunedRefs', 'removedLogs', 'errors'],
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
   Example: <repoRoot>/<worktree_base>/<storyBranch-slashes-to-dashes>
   Command: \`git -C repoRoot worktree add <worktreePath> <storyBranch>\`.
7. Sync sprint-status INSIDE the story worktree (it's a tracked file; commit goes onto storyBranch):
   cd <worktreePath>
   - Update development_status[<storyKey>] = in-progress
   - Find epic-{N} where N = first numeric segment of <storyKey>. Set to in-progress if currently backlog.
   - Update last_updated to "${timestamp}"
   - git add + commit -m "chore(sprint-status): story <storyKey> → in-progress"
   - DO push this commit (so MR create phase has something to point at): \`git push origin \${storyBranch}\` (use --force-with-lease if local is ahead).
8. Update spec frontmatter:
   specPath = <worktreePath>/_bmad-output/implementation-artifacts/stories/<storyKey>.md
   Edit specPath:
   - status: in-progress
   - baseline_revision: <baselineSha>  # bmad-build-auto reads THIS field (NOT baseline_commit)
   git add + commit (push too — same branch).
9. Return SETUP_SCHEMA JSON with ALL fields filled. The other phases depend on these — incomplete context = broken workflow.

CONSTRAINTS:
- DO NOT modify prdWorktreePath (the PRD worktree). Only create the story worktree.
- DO push the sprint-status + spec commits to remote (MR create needs them).
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
// PHASE 2: CREATE MR (runs ONCE, before Build loop)
// ============================================================================
// MR exists when the Build loop's CI check runs — guarantees a single CI
// surface (MR pipeline), no branch/MR fallback path. Setup just pushed
// sprint-status + spec commits to remote, so MR creation now has a diff.
phase('Create MR')
log(`Creating MR for ${setup.storyBranch}...`)
const mrResult = await agent(
  `Create MR for branch ${setup.storyBranch} → ${setup.baseBranch}, story ${setup.storyKey}.

CONTEXT (from setup agent):
- repoRoot: ${setup.repoRoot}
- prdKey: ${setup.prdKey}
- baseBranch: ${setup.baseBranch}
- storyBranch: ${setup.storyBranch}
- worktreePath: ${setup.worktreePath}
- gitlabHost: ${setup.gitlabHost}
- gitlabProjectId: ${setup.gitlabProjectId}

OPERATE FROM: ${setup.worktreePath}

STEPS:
1. Check existing MR: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests?source_branch=${setup.storyBranch}&state=opened"\` — if found, use existing mrIid.
2. If no MR: create via:
   \`GITLAB_HOST=${setup.gitlabHost} glab mr create --yes --repo <config-project> --source-branch "${setup.storyBranch}" --target-branch "${setup.baseBranch}" --title "Story ${setup.storyKey} — bmad-build-converge" --description "Auto-generated by bmad-build-converge. See spec file at ${setup.specPath} for review order." --remove-source-branch\`
   (config-project is read from _bmad/custom/issue-tracking.yaml: project field.)
3. Parse mrIid from URL pattern /merge_requests/<NID>.
4. Fetch first pipeline id: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests/<NID>/pipelines?per_page=1"\` → first id.

RETURN JSON: { storyKey: ${setup.storyKey}, mrIid, mrUrl, pipelineId, branch: ${setup.storyBranch}, error? }

CONSTRAINTS:
- DO NOT run CI check (Build loop's CI agent does that per iteration)
- DO NOT run Skill: bmad-build-auto (Build agent does that)
- DO NOT modify any code or spec files`,
  { label: `mr-create-${setup.storyKey}`, phase: 'Create MR', schema: {
    type: 'object',
    properties: {
      storyKey: { type: 'string' },
      mrIid: { type: 'integer' },
      mrUrl: { type: 'string' },
      pipelineId: { type: 'integer' },
      branch: { type: 'string' },
      error: { type: 'string' },
    },
    required: ['storyKey', 'branch'],
  }, agentType: 'general-purpose' }
)

if (!mrResult || mrResult.error || !mrResult.mrIid) {
  return {
    storyKey: setup.storyKey,
    aborted: true,
    stage: 'create-mr',
    iterations: 0,
    mrResult,
    worktreePath: setup.worktreePath,
    branch: setup.storyBranch,
    error: mrResult?.error || 'no MR created',
  }
}
log(`MR !${mrResult.mrIid} created (CI will run on first push during Build loop)`)

// ============================================================================
// PHASE 3: BUILD WITH CONVERGENCE
// ============================================================================
phase('Build with convergence')
log(`Running bmad-build convergence loop (max ${maxIterations} iterations)...`)

let iteration = 0;
let followup = true;
let currentSha = setup.baselineSha;
let convergedSha = null;
let iterationsLog = [];
// lastSpecStatus captured across loop iterations — used by Auto-merge
// guard to skip merge for deferred/blocked stories (awaiting-operator,
// blocked). Skill may finalize spec status to one of these if human
// action is required or an unresolved issue blocked completion.
let lastSpecStatus = null;

while (followup && iteration < maxIterations) {
  iteration++;
  log(`--- Iteration ${iteration}/${maxIterations} (baseline ${currentSha.substring(0, 7)}) ---`)

  // 'buildResult' (not 'buildResult') to avoid shadowing the outer let
  // binding — JS TDZ on the inner const would throw on the template
  // evaluation that precedes the const assignment.
  //
  // Plain agent() dispatch. Skill: bmad-build-auto invocation happens
  // INSIDE the subagent via its Skill tool. Depth: workflow (0) → agent
  // subagent (1) → Skill's implementation subagent (2). Within depth-3
  // limit. No claude -p subprocess, no Skill-halt-on-workflow-tool, no
  // model/auth overhead.
  const buildResult = await agent(
    `/bmad-build-auto ${setup.storyKey}

${ciFailure ? `CI FAILED LAST ITER — fix it: ${JSON.stringify(ciFailure).substring(0, 1500)}` : ''}

sprint-status.yaml is owned by the orchestrator: never write it, and never revert a change to it. A row at done or awaiting-operator is the orchestrator's own bookkeeping — not a defect to fix, and not proof that the work is verified.

If Skill HALTs (terminal status != done), return { skillCompleted: false, error: <halt reason> }. Otherwise { skillCompleted: true }.`,
    { label: `build-iter-${iteration}`, phase: 'Build with convergence', schema: {
      type: 'object',
      properties: {
        skillCompleted: { type: 'boolean' },
        error: { type: 'string' },
      },
      required: ['skillCompleted'],
    }, agentType: 'general-purpose', allowedTools: 'Read,Write,Edit,Bash,Skill,Agent,Task' }
  )

  // 'buildResult'/'postBuildResult' are inner consts, but the NEXT iteration's
  // template eval (for the optional ciFailure injection) doesn't need them —
  // ciFailure is captured into the outer-scope `let` below.
  if (!buildResult || !buildResult.skillCompleted || buildResult.error) {
    log(`Build agent (Skill) failed: ${buildResult?.error || 'skill did not complete'}`)
    iterationsLog.push({ iter: iteration, error: `build: ${buildResult?.error || 'skill did not complete'}` })
    followup = false
    break
  }

  // POST-BUILD: file-existence check (5-8/5-9 guard) + push + emit BUILD_SCHEMA.
  // Build agent is a bare Skill invocation (bmad-loop pattern); all
  // post-skill scaffolding lives here. Format-check is delegated to CI
  // (lint job) to keep this workflow generic across BMAD PRDs.
  const postBuildResult = await agent(
    `Post-build for story ${setup.storyKey}, iter ${iteration}. Build agent already invoked Skill: bmad-build-auto and committed locally. Your job: verify deliverables + push + return BUILD_SCHEMA.

OPERATE FROM: ${setup.worktreePath} (git checkout branch ${setup.storyBranch}).

STEPS:
1. Read spec frontmatter 'files' field at ${setup.specPath}.
2. FILE-EXISTENCE CHECK (5-8/5-9 guard): for each path in 'files' field, run \`ls -1 <worktree>/<path> | head -1\`. If ANY missing → return BUILD_SCHEMA with error + pushed=false + followupReviewRecommended=true.
3. PUSH: \`git push --force-with-lease origin ${setup.storyBranch}\`.
4. Get final SHA: \`git rev-parse HEAD\`.
5. Read spec frontmatter fields: followup_review_recommended, status.

RETURN BUILD_SCHEMA:
- storyKey: ${setup.storyKey}
- iteration: ${iteration}
- newSha: <final SHA>
- followupReviewRecommended: <spec frontmatter followup_review_recommended>
- specStatus: <spec frontmatter status>
- pushed: true (after successful push)
- patchesApplied, itemsDeferred, scoreFormula: parsed from spec's '## Auto Run Result' section

CONSTRAINTS:
- DO NOT run Skill: bmad-build-auto (build agent did that)
- DO NOT create MR — Phase 2 (Create MR) already created it; you just push commits to its branch
- DO NOT modify spec file other than verifying frontmatter fields
- DO NOT run format-check / linters — CI lint job handles those (workflow stays generic)`,
    { label: `postbuild-iter-${iteration}`, phase: 'Build with convergence', schema: BUILD_SCHEMA, agentType: 'general-purpose' }
  )

  if (!postBuildResult || !postBuildResult.pushed) {
    log(`Post-build failed: ${postBuildResult?.error || 'no result'}`)
    iterationsLog.push({ iter: iteration, error: `post-build: ${postBuildResult?.error || 'unknown'}` })
    followup = false
    break
  }

  iterationsLog.push({
    iter: iteration,
    sha: postBuildResult.newSha,
    followup: postBuildResult.followupReviewRecommended,
    specStatus: postBuildResult.specStatus,
    patchesApplied: postBuildResult.patchesApplied,
    itemsDeferred: postBuildResult.itemsDeferred,
  })

  lastSpecStatus = postBuildResult.specStatus
  currentSha = postBuildResult.newSha
  followup = postBuildResult.followupReviewRecommended

  // CI check INSIDE the loop. Each iteration pushes a commit → GitLab runs
  // a pipeline. We poll the pipeline after the push and, if it failed, we
  // prepare a ciFailure payload for the next iteration's build agent. The
  // build agent passes ciFailure to bmad-build-auto's reviewers so the next
  // pass targets the actual CI failure rather than guessing.
  if (postBuildResult.pushed) {
    log(`Iteration ${iteration}: build ${followup ? 'still wants followup' : 'looks converged'} — checking CI...`)
    const ciCheck = await agent(
      `Check the CI pipeline for MR !${mrResult.mrIid} (story ${setup.storyKey}, iter ${iteration}).

MR was created in Phase 2 — guaranteed to exist. Use MR pipeline only (single CI surface).

STEPS:
1. Get latest MR pipeline: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests/${mrResult.mrIid}/pipelines?per_page=1"\` → first entry.
2. Poll status: \`Bash(command="/tmp/ci-monitor.sh <pipelineId> 30", run_in_background=true)\` + \`TaskOutput(block=true, timeout=1800000)\`. Read the "TERMINAL:<status>" line.
3. If status='success': return { pipelineId, status: 'success' }.
4. If status != 'success': classify the failure.
   - Get failed jobs: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/pipelines/<pipelineId>/jobs?per_page=50"\`
   - For each failed job, fetch trace tail: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/jobs/<id>/trace" | tail -80\`
   - Compose a CONCISE summary of each failed job (job name + 5-10 line excerpt of the relevant error).
5. Return JSON: { pipelineId, status, failedJobs: [{name, exitCode, excerpt}], traceTail: <concatenated excerpts> }`,
      { label: `ci-check-${iteration}`, phase: 'Build with convergence', schema: {
        type: 'object',
        properties: {
          pipelineId: { type: 'integer' },
          status: { type: 'string' },
          failedJobs: { type: 'array', items: {
            type: 'object', properties: { name: { type: 'string' }, exitCode: { type: 'integer' }, excerpt: { type: 'string' } }
          } },
          traceTail: { type: 'string' },
        },
        required: ['status'],
      }, agentType: 'general-purpose' }
    )

    if (ciCheck && ciCheck.status) {
      lastCIStatus = ciCheck.status
    }

    // OR logic: the loop iterates if EITHER the build agent wants another
    // pass (review found high-severity findings) OR CI failed. CI being
    // green does NOT override the build agent's followup signal.
    const buildWantsFollowup = postBuildResult.followupReviewRecommended === true
    const ciFailed = ciCheck && ciCheck.status !== 'success'
    if (buildWantsFollowup || ciFailed) {
      if (ciFailed) {
        log(`Iteration ${iteration}: CI FAILED — feeding back to next iteration`)
        ciFailure = {
          pipelineId: ciCheck.pipelineId,
          status: ciCheck.status,
          failedJobs: ciCheck.failedJobs || [],
          traceTail: (ciCheck.traceTail || '').substring(0, 3000),
        }
      } else {
        log(`Iteration ${iteration}: build agent requested followup (review found issues) — re-running with same args`)
      }
      followup = true
    } else {
      log(`Iteration ${iteration}: BOTH build converged + CI green — exiting loop ✓`)
      followup = false
    }
  } else if (followup) {
    log(`Iteration ${iteration}: followup recommended but post-build didn't push — relying on build agent's classification`)
  }

  if (!followup) {
    convergedSha = postBuildResult.newSha
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
    ciFailure,  // expose the last CI failure for the orchestrator to feed back
    escalateReason: `convergence did not complete within ${maxIterations} iterations (last failure: ${ciFailure ? `CI pipeline ${ciFailure.pipelineId} status=${ciFailure.status}` : 'followup_review_recommended=true'})`,
    worktreePath: setup.worktreePath,
    branch: setup.storyBranch,
  }
}

log(`Story ${setup.storyKey} converged at ${convergedSha} after ${iteration} iteration(s) — last CI was ${lastCIStatus ? lastCIStatus.toUpperCase() : 'NOT CHECKED'}`)

// ============================================================================
// PHASE 4: AUTO-MERGE
// ============================================================================
phase('Auto-merge')
let mergeResult = null;
// lastCIStatus was set inside the convergence loop (Phase 3). The merged
// Push&MR+Monitor agent is gone — the loop's CI check is the SOLE source
// of CI verdict now. If lastCIStatus is null, the loop never reached the
// CI check (push failed, build was treated as converged without CI).
//
// Auto-merge GUARD: skip merge when spec status indicates human action
// required or unresolved blocker. awaiting-operator = partial completion
// (buy domain, grant API key); blocked = skill flagged an issue.
const SPEC_STATUSES_BLOCKING_MERGE = new Set(['awaiting-operator', 'blocked']);
const canAutoMerge = lastCIStatus === 'success'
  && !SPEC_STATUSES_BLOCKING_MERGE.has(lastSpecStatus);
if (canAutoMerge) {
  log(`Auto-merging MR !${mrResult.mrIid} (CI green, spec status: ${lastSpecStatus})...`)
  mergeResult = await agent(
    `Merge MR !${mrResult.mrIid} for story ${setup.storyKey}, then sync sprint-status to done.

CONTEXT:
- prdWorktreePath: ${setup.prdWorktreePath}  (worktree on ${setup.baseBranch} — operate from here for sprint-status)
- sprintStatusPath: ${setup.sprintStatusPath}
- baseBranch: ${setup.baseBranch}
- gitlabHost: ${setup.gitlabHost}
- project: <from _bmad/custom/issue-tracking.yaml>
- storyKey: ${setup.storyKey}

STEPS:
1. Merge: \`GITLAB_HOST=${setup.gitlabHost} glab mr merge --yes --repo <project> ${mrResult.mrIid}\`
   Capture stdout/stderr. If exit != 0, set merged=false with error string.
2. After successful merge, sync sprint-status to done. Operate from the PRD worktree (${setup.prdWorktreePath}).
   - cd ${setup.prdWorktreePath}
   - Read ${setup.sprintStatusPath}.
   - Update development_status[${setup.storyKey}] = done.
   - Update last_updated to "${timestamp}".
   - \`git add ${setup.sprintStatusPath} && git commit -m "chore(sprint-status): story ${setup.storyKey} → done (MR !${mrResult.mrIid} merged)" && git push origin ${setup.baseBranch}\`
   - sprintStatusDone = true only if push succeeded.

Note: when invoked from bmad-prd-orchestrate, the orchestrator may re-apply the done transition in Phase 4. sprint_plan.py advance is idempotent (never-regress), so a redundant write is a no-op. The merge agent here is the SOLE WRITER for standalone (non-orchestrator) invocations.

RETURN MERGE_SCHEMA (storyKey, mrIid, merged, sprintStatusDone, error?).`,
    { label: `merge-${setup.storyKey}`, phase: 'Auto-merge', schema: MERGE_SCHEMA, agentType: 'general-purpose' }
  )
} else {
  const reason = !lastSpecStatus || !SPEC_STATUSES_BLOCKING_MERGE.has(lastSpecStatus)
    ? `CI ${lastCIStatus || 'NOT CHECKED'}`
    : `spec status "${lastSpecStatus}" (human action required or unresolved blocker)`;
  log(`${reason} — NOT auto-merging. Manual review needed.`)
  mergeResult = { storyKey: setup.storyKey, mrIid: mrResult.mrIid, merged: false, sprintStatusDone: false, error: reason }
}

log(`Merge: ${mergeResult.merged ? 'OK' : 'SKIPPED'} | Sprint-status: ${mergeResult.sprintStatusDone ? 'done' : 'pending'}`)

// ============================================================================
// PHASE 5: CLEANUP
// ============================================================================
phase('Cleanup')
log(`Cleaning up worktree ${setup.worktreePath}, branch ${setup.storyBranch} (merged=${mergeResult?.merged})...`)
const cleanup = await agent(
  `Cleanup bmad-build artifacts for story ${setup.storyKey}.

CONTEXT:
- repoRoot: ${setup.repoRoot}
- prdWorktreePath: ${setup.prdWorktreePath}
- worktreePath: ${setup.worktreePath}
- storyBranch: ${setup.storyBranch}
- mergeResult.merged: ${mergeResult?.merged === true}  ← CRITICAL: only delete worktree/branch if true

WORKING FROM: ${setup.repoRoot} (the bare git root — worktree commands work from here).

STEPS:
0. IF mergeResult.merged === true (MR successfully merged into prd branch):
   1a. Remove story worktree:
       \`git worktree remove --force ${setup.worktreePath}\`
       If already removed (MR --remove-source-branch cleaned it), skip silently.
   1b. Delete local branch if it still exists:
       \`git branch -D ${setup.storyBranch}\` (errors if missing — ignore).
   1c. Prune remote refs:
       \`git remote prune origin\`
   ELSE (merge failed, skipped, or story deferred):
   - DO NOT delete the worktree or branch — keep them for retry.
   - Report keptWorktrees=[worktreePath], keptBranches=[storyBranch] in the return.
1. ALWAYS (regardless of merge status):
   Remove orchestrator log files in ${setup.prdWorktreePath}/_bmad-output/implementation-artifacts/ matching pattern bmad-build-auto-result-*${setup.storyKey}* (only those for the just-completed story). These are always safe to remove because they're regenerated on retry.
2. Return CLEANUP_SCHEMA with:
   - removedWorktrees: [paths deleted, or empty]
   - deletedBranches: [names deleted, or empty]
   - keptWorktrees: [paths kept, or empty]
   - keptBranches: [names kept, or empty]
   - prunedRefs: count
   - removedLogs: [file paths deleted]
   - errors: [any error strings]

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
  mr: { mrIid: mrResult.mrIid, mrUrl: mrResult.mrUrl, pipelineId: mrResult.pipelineId },
  monitor: { status: lastCIStatus, retries: iteration > 1 ? iteration - 1 : 0, transient: false, failedJobs: ciFailure?.failedJobs || [] },
  merge: { merged: mergeResult.merged, sprintStatusDone: mergeResult.sprintStatusDone, error: mergeResult.error },
  cleanup: { worktrees: cleanup.removedWorktrees, branches: cleanup.deletedBranches, errors: cleanup.errors },
}
