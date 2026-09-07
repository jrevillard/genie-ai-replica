export const meta = {
  name: 'bmad-prd-orchestrate',
  description: 'PRD-level meta-orchestrator: drives all stories across all epics with quality-gate convergence + CI + auto-merge. Generic across any BMAD PRD.',
  phases: [
    { title: 'Setup' },
    { title: 'Plan' },
    { title: 'Execute' },
    { title: 'Epic boundary' },
    { title: 'Final report' },
    { title: 'Cleanup' },
  ],
};

const args_ = args || {};
const storyKey = args_.storyKey || null;
const epicKey = args_.epicKey || null;
const prdKey = args_.prdKey || null;
const hitlEvery = args_.hitlEvery === undefined ? 5 : args_.hitlEvery;
const hitlFinalOnly = args_.hitlFinalOnly || false;
const inferDeps = args_.inferDeps !== false;  // default true
const noInfer = args_.noInfer || false;
const retro = args_.retro || false;
const retryPolicy = args_.retryPolicy || 'once';
const resume = args_.resume || null;
const userChoice = args_.userChoice || null;
const confirmedDeps = args_.confirmedDeps || null;
const maxIterations = args_.maxIterations || 5;
const timestamp = args_.timestamp || 'unknown';
const projectRoot = '/home/jerome/git_projects/ITU/genie-ai';
const convergeScriptPath = projectRoot + '/.claude/workflows/bmad-build-converge.js';
const runDir = projectRoot + '/.claude/worktrees/admin-logs-prd/_bmad-output/implementation-artifacts/orchestrate-runs/' + timestamp;

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    repoRoot: { type: 'string' },
    prdWorktreePath: { type: 'string' },
    prdKey: { type: 'string' },
    baseBranch: { type: 'string' },
    prdBranch: { type: 'string' },
    sprintStatusPath: { type: 'string' },
    issueTrackingConfig: { type: 'object' },
    gitlabHost: { type: 'string' },
    gitlabProjectId: { type: 'integer' },
  },
  required: ['repoRoot', 'prdWorktreePath', 'prdKey', 'baseBranch', 'prdBranch', 'sprintStatusPath', 'issueTrackingConfig', 'gitlabHost', 'gitlabProjectId'],
};

const DEPS_SCHEMA = {
  type: 'object',
  properties: {
    inferred: { type: 'array', items: { type: 'object', properties: { story: { type: 'string' }, depends_on: { type: 'array', items: { type: 'string' } } } } },
  },
  required: ['inferred'],
};

phase('Setup')
log('Discovering repo + PRD worktree + config...')
const setup = await agent(
  `You are the setup agent for bmad-prd-orchestrate.

TIMESTAMP: ${timestamp}
RUN_DIR: ${runDir}

STEPS:
1. Discover repo:
   a. Run \`git rev-parse --show-toplevel\` → repoRoot
2. Find PRD worktree (worktree on a 'feat/*/prd' branch):
   a. Run \`git worktree list --porcelain\`
   b. Parse output: each entry starts with 'worktree <path>', followed by 'branch refs/heads/<name>'.
   c. Find the entry whose branch matches pattern 'refs/heads/feat/*/prd'. Extract prdKey (the * in feat/*/prd).
3. Read _bmad/custom/issue-tracking.yaml from prdWorktreePath. Required fields: git_platform, host, project, worktree_base, branch_patterns.prd, branch_patterns.story.
4. Resolve gitlabProjectId:
   a. \`GITLAB_HOST=<host> glab api "projects?search=<project>&simple=true"\` → first match's id.
5. baseBranch = 'feat/<prdKey>/prd'. prdBranch = baseBranch.
6. sprintStatusPath = prdWorktreePath + '/_bmad-output/implementation-artifacts/sprint-status.yaml'.
7. Initialize run dir:
   a. mkdir -p ${runDir}
   b. Write ${runDir}/state.json with initial state: { runId: '${timestamp}', ts: '${timestamp}', prdKey, storyQueue: [], completed: [], blocked: [], skipped: [], awaitingOperator: [], halts: [] }
   c. Append to ${runDir}/journal.jsonl: {"ts":"${timestamp}","event":"setup_complete","prdKey":"<prdKey>"}
8. Return SETUP_SCHEMA JSON with ALL fields filled.

DO NOT modify prdWorktreePath or any existing files.`,
  { label: `setup-${timestamp}`, phase: 'Setup', schema: SETUP_SCHEMA, agentType: 'general-purpose' }
)
if (!setup || !setup.prdWorktreePath) {
  return { aborted: true, stage: 'setup', error: 'setup agent failed' }
}
log(`Discovered: prdKey=${setup.prdKey}, prdBranch=${setup.prdBranch}`)

phase('Plan')
log('Building story queue + inferring deps...')
const planResult = await agent(
  `You are the plan agent for bmad-prd-orchestrate.

SETUP: ${JSON.stringify(setup)}
RUN_DIR: ${runDir}
INFER_DEPS: ${inferDeps}, NO_INFER: ${noInfer}
EPIC_FILTER: ${epicKey || 'all'}, STORY_FILTER: ${storyKey || 'all'}

STEPS:
1. Read ${setup.sprintStatusPath}.
2. Compute storyQueue:
   a. Iterate sprint-status.epics in order. For each epic:
      - Skip if epicFilter set and epic.id != epicFilter.
      - If epic.depends_on contains epic IDs not in 'done' status, mark epic as blocked (skip its stories, add to skipped[] with reason: 'epic_blocked').
      - Otherwise, iterate epic.stories in order. For each story:
        - Skip if storyFilter set and story != storyFilter.
        - If status == 'done': add to completed[] (already done from prior runs).
        - If status == 'backlog' or 'in-progress' or 'review' or 'blocked': add to storyQueue.
        - If status == 'awaiting-operator': add to awaitingOperator[] (skip in queue).
3. If inferDeps AND NOT noInfer:
   a. For each story in storyQueue, read spec at <prdWorktreePath>/_bmad-output/implementation-artifacts/stories/<storyKey>.md
   b. Extract depends_on from frontmatter if present.
   c. If absent, scan spec body for story key mentions (regex: /\\b\\d+-\\d+[a-z]?\\b/g) and "depends on story X" phrasing.
   d. Build inferred graph as list of {story, depends_on} entries.
4. Write ${runDir}/deps.json with { inferred: <graph> }.
5. Append to ${runDir}/journal.jsonl: {"ts":"${timestamp}","event":"plan_complete","storyQueueSize":<n>,"inferredEdges":<m>}
6. Return JSON: { storyQueue: [...], completed: [...], blocked: [...], skipped: [...], awaitingOperator: [...], inferred: [...] }

CONSTRAINTS:
- Read-only on sprint-status. Do NOT modify.
- Do NOT modify any spec file.`,
  { label: `plan-${timestamp}`, phase: 'Plan', schema: {
    type: 'object',
    properties: {
      storyQueue: { type: 'array', items: { type: 'string' } },
      completed: { type: 'array', items: { type: 'string' } },
      blocked: { type: 'array', items: { type: 'string' } },
      skipped: { type: 'array', items: { type: 'string' } },
      awaitingOperator: { type: 'array', items: { type: 'string' } },
      inferred: { type: 'array', items: { type: 'object' } },
    },
    required: ['storyQueue', 'completed', 'blocked', 'skipped', 'awaitingOperator', 'inferred'],
  }, agentType: 'general-purpose' }
)
if (!planResult) {
  return { aborted: true, stage: 'plan', error: 'plan agent failed' }
}
log(`Queue: ${planResult.storyQueue.length} stories, ${planResult.inferred.length} inferred edges`)

if (inferDeps && !noInfer && planResult.inferred.length > 0) {
  log('Halting to confirm inferred dependency graph...')
  return {
    haltReason: 'dep_inference_confirm',
    context: { inferred: planResult.inferred, storyQueue: planResult.storyQueue },
    resumeToken: timestamp,
    userOptions: ['confirm_deps', 'proceed_without_inference', 'abort_prd'],
  }
}
