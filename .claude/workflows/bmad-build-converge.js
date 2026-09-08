import { writeFileSync, unlinkSync } from 'node:fs';

// Note: the meta is static at script-load time, so 'storyKey' can't be
// inlined. The 'name' field is fixed ('bmad-build-converge'); the
// 'description' shows the generic flow. To make the running story
// visible, check args.storyKey after the workflow starts.
export const meta = {
  name: 'bmad-build-converge',
  description: 'Single-story bmad-build with quality-gate convergence loop + CI gate + auto-merge. Generic across any BMAD PRD: discovers repo, PRD worktree, issue-tracking config, and project_key from sprint-status.yaml. The story being processed is passed via args.storyKey (logged at Setup).',
  phases: [
    { title: 'Setup' },
    { title: 'Build with convergence' },
    { title: 'Create MR' },
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
    prunedRefs: { type: 'integer' },
    removedLogs: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['removedWorktrees', 'deletedBranches', 'prunedRefs', 'removedLogs', 'errors'],
};

// ============================================================================
// dispatchViaClaudeP: replace agent() with `claude -p` subprocess.
//
// `claude -p` runs in a primary Claude Code session, which has full Skill
// tool access AND can dispatch its own subagents. The Workflow tool's nested
// agent() context blocks subagent dispatch (step-03 of bmad-build-auto bails
// with "no subagents"). Spawning claude -p unblocks that.
//
// Only the Build phase uses this helper (it invokes Skill: bmad-build-auto).
// Other phases keep using agent() — they don't dispatch subagents.
//
// Transport: prompt written to a temp file, then `cat file | claude -p -`.
// Avoids shell quoting hell (apostrophes, backticks, $vars in prompts).
//
// cwd: optional. When omitted, the bash-agent wrapping claude -p uses its
// own CWD. Build always passes cwd=setup.worktreePath.
//
// Temp file cleanup is wrapped in try/finally so leaks don't accumulate
// when the wrapper agent throws mid-dispatch.
// ============================================================================
async function dispatchViaClaudeP(opts) {
  const { label, phase, prompt, schema, cwd, allowedTools, maxBudgetUsd } = opts;
  const promptFile = `/tmp/bmad-bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  writeFileSync(promptFile, prompt);
  try {
    const cwdPrefix = cwd ? `cd '${cwd}' && ` : '';
    const jsonSchemaArg = schema ? ` --json-schema '${JSON.stringify(schema)}'` : '';
    const cmd = `${cwdPrefix}cat '${promptFile}' | claude -p - --output-format json --bare --permission-mode bypassPermissions --allowedTools '${allowedTools}'${jsonSchemaArg} --max-budget-usd ${maxBudgetUsd || '2'}`;
    const wrapperResult = await agent(
      `Run this bash command. Return stdout parsed as JSON. No commentary, no extra steps.

COMMAND:
${cmd}

PARSE RULES:
- claude -p's JSON envelope: {"type":"result","subtype":"...","result":"<text>","json":<parsed schema>,"usage":{...}}.
- If --json-schema was used, the parsed object lives in the envelope's \`json\` field — return it WRAPPED: { "json": <envelope.json> }.
- If exit != 0, return { error: <stderr last 500 chars> }.
- DO NOT modify any files. DO NOT add goal restatements.`,
      { label, phase, schema: {
        type: 'object',
        properties: {
          json: {},
          error: { type: 'string' },
        },
      }, agentType: 'general-purpose' }
    );
    if (wrapperResult?.error) return { error: wrapperResult.error };
    return wrapperResult?.json ?? wrapperResult;
  } finally {
    try { unlinkSync(promptFile); } catch {}
  }
}

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

  // 'buildResult' (not 'buildResult') to avoid shadowing the outer let
  // binding — JS TDZ on the inner const would throw on the template
  // evaluation that precedes the const assignment.
  const buildResult = await dispatchViaClaudeP({
    label: `build-iter-${iteration}`,
    phase: 'Build with convergence',
    cwd: setup.worktreePath,
    prompt: `/bmad-build-auto ${setup.storyKey}

${ciFailure ? `CI FAILED LAST ITER — fix it: ${JSON.stringify(ciFailure).substring(0, 1500)}` : ''}

sprint-status.yaml is owned by the orchestrator: never write it, and never revert a change to it. A row at done or awaiting-operator is the orchestrator's own bookkeeping — not a defect to fix, and not proof that the work is verified.

If Skill HALTs (terminal status != done), return { skillCompleted: false, error: <halt reason> }. Otherwise { skillCompleted: true }.`,
    schema: {
      type: 'object',
      properties: {
        skillCompleted: { type: 'boolean' },
        error: { type: 'string' },
      },
      required: ['skillCompleted'],
    },
    allowedTools: 'Read,Write,Edit,Bash,Skill,Agent,Bash(git *),Bash(cd *),Bash(rtk *),Bash(npx *),Bash(ls *)',
    maxBudgetUsd: 5,
  })

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
- DO NOT create MR (Phase 3 does that)
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
      `Check the CI pipeline for branch ${setup.storyBranch} (story ${setup.storyKey}, iter ${iteration}).

STEPS:
1. Get latest pipeline id: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests?source_branch=${setup.storyBranch}&state=opened"\` → first entry. If no MR exists yet, run:
   \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/pipelines?ref=${setup.storyBranch}&per_page=1"\` → first entry.
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
// PHASE 3: CREATE MR (CI was already checked inside the loop)
// ============================================================================
phase('Create MR')
log(`Creating MR for ${setup.storyBranch}...`)
const mrResult = await agent(
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

The CI was already checked inside the convergence loop (Phase 2). If we got here, the LAST ci-check returned 'success'. The branch has been pushed at least once. Just create or fetch the MR.

1. Check existing MR: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests?source_branch=${setup.storyBranch}&state=opened"\` — if found, use existing mrIid.
2. If no MR: create via:
   \`GITLAB_HOST=${setup.gitlabHost} glab mr create --yes --repo <config-project> --source-branch "${setup.storyBranch}" --target-branch "${setup.baseBranch}" --title "Story ${setup.storyKey} — bmad-build-converge" --description "Auto-generated by bmad-build-converge. Converged after ${iteration} iteration(s) with CI green. See spec file for review order." --remove-source-branch\`
   (config-project is read from _bmad/custom/issue-tracking.yaml: project field.)
3. Parse mrIid from URL pattern /merge_requests/<NID>.
4. Fetch pipeline id: \`GITLAB_HOST=${setup.gitlabHost} glab api "projects/${setup.gitlabProjectId}/merge_requests/<NID>/pipelines"\` → first id.

RETURN JSON: { storyKey: ${setup.storyKey}, mrIid, mrUrl, pipelineId, branch: ${setup.storyBranch}, error? }`,
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
    converged: true,
    iterations: iteration,
    finalSha: convergedSha,
    iterationsLog,
    mrResult,
    worktreePath: setup.worktreePath,
    branch: setup.storyBranch,
    aborted: mrResult?.error || 'no MR created',
  }
}

log(`MR !${mrResult.mrIid} created (pipeline ${mrResult.pipelineId}; CI was already checked green in the loop)`)

// ============================================================================
// PHASE 4: AUTO-MERGE
// ============================================================================
phase('Auto-merge')
let mergeResult = null;
// lastCIStatus was set inside the convergence loop (Phase 2). The merged
// Push&MR+Monitor agent is gone — the loop's CI check is the SOLE source
// of CI verdict now. If lastCIStatus is null, the loop never reached the
// CI check (push failed, build was treated as converged without CI).
if (lastCIStatus === 'success') {
  log(`Auto-merging MR !${mrResult.mrIid}...`)
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
  log(`CI ${lastCIStatus || 'NOT CHECKED'} — NOT auto-merging. Manual review needed.`)
  mergeResult = { storyKey: setup.storyKey, mrIid: mrResult.mrIid, merged: false, sprintStatusDone: false, error: `CI ${lastCIStatus || 'unknown'}` }
}

log(`Merge: ${mergeResult.merged ? 'OK' : 'SKIPPED'} | Sprint-status: ${mergeResult.sprintStatusDone ? 'done' : 'pending'}`)

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
  mr: { mrIid: mrResult.mrIid, mrUrl: mrResult.mrUrl, pipelineId: mrResult.pipelineId },
  monitor: { status: lastCIStatus, retries: iteration > 1 ? iteration - 1 : 0, transient: false, failedJobs: ciFailure?.failedJobs || [] },
  merge: { merged: mergeResult.merged, sprintStatusDone: mergeResult.sprintStatusDone, error: mergeResult.error },
  cleanup: { worktrees: cleanup.removedWorktrees, branches: cleanup.deletedBranches, errors: cleanup.errors },
}
