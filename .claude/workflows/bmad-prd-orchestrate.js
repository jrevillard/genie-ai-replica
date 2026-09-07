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
// runDir + convergeScriptPath are derived AFTER Setup (HIGH 5 fix).

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

const DEP_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    story: { type: 'string' },
    depends_on: { type: 'array', items: { type: 'string' } },
  },
  required: ['story', 'depends_on'],
};

const DEPS_SCHEMA = {
  type: 'object',
  properties: { inferred: { type: 'array', items: DEP_ENTRY_SCHEMA } },
  required: ['inferred'],
};

const WRITE_STATE_SCHEMA = {
  type: 'object',
  properties: { written: { type: 'boolean' }, path: { type: 'string' } },
  required: ['written', 'path'],
};

// ============================================================================
// PHASE 1: SETUP — discover repo, PRD worktree, config, project_key
// ============================================================================
phase('Setup')
log('Discovering repo + PRD worktree + config...')
const setup = await agent(
  `You are the setup agent for bmad-prd-orchestrate.

TIMESTAMP: ${timestamp}

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
7. Initialize run dir (THE RUN DIR IS THE ONLY PERMITTED WRITE LOCATION):
   a. Compute runDir = prdWorktreePath + '/_bmad-output/implementation-artifacts/orchestrate-runs/${timestamp}'
   b. mkdir -p <runDir>
   c. Write <runDir>/state.json with the JSON object below. Replace the placeholder <discovered-prd-key> with the actual prdKey from step 2c:
      { "runId": "${timestamp}", "ts": "${timestamp}", "prdKey": "<discovered-prd-key>", "storyQueue": [], "completed": [], "blocked": [], "skipped": [], "awaitingOperator": [], "halts": [] }
   d. Append to <runDir>/journal.jsonl: {"ts":"${timestamp}","event":"setup_complete","prdKey":"<discovered-prd-key>"}
8. Return SETUP_SCHEMA JSON with ALL fields filled.

CONSTRAINTS:
- DO NOT modify prdWorktreePath or any other tracked file outside the run dir.
- The run dir is the SOLE permitted write location.
- DO NOT modify any tracked file in prdWorktreePath or elsewhere in the repo.`,
  { label: `setup-${timestamp}`, phase: 'Setup', schema: SETUP_SCHEMA, agentType: 'general-purpose' }
)
if (!setup || !setup.prdWorktreePath) {
  return { aborted: true, stage: 'setup', error: 'setup agent failed' }
}

// HIGH 5: derive runDir + convergeScriptPath from setup; honor prdKey arg
const runDir = setup.prdWorktreePath + '/_bmad-output/implementation-artifacts/orchestrate-runs/' + timestamp;
const convergeScriptPath = setup.repoRoot + '/.claude/workflows/bmad-build-converge.js';
if (prdKey && prdKey !== setup.prdKey) {
  log(`WARNING: args.prdKey (${prdKey}) != discovered prdKey (${setup.prdKey}); using discovered value`)
} else if (prdKey) {
  log(`prdKey arg matches discovered: ${setup.prdKey}`)
}

log(`Discovered: prdKey=${setup.prdKey}, prdBranch=${setup.prdBranch}`)
log(`runDir=${runDir} | convergeScriptPath=${convergeScriptPath}`)

// ============================================================================
// PHASE 2: PLAN — story queue + dep inference
// ============================================================================
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
2. Build numeric → canonical story key lookup (HIGH 1):
   a. The sprint-status has TWO different ID forms:
      - epics[N].stories[] uses NUMERIC ids like "5.7"
      - development_status keys are CANONICAL like "5-7-frontend-..."
   b. Walk development_status keys; for each canonical key extract the leading "X-Y[a-z]?" prefix. A numeric id "X.Y" matches canonical "X-Y-..." by that prefix.
   c. The canonical key is the storyQueue / completed / blocked / etc. entry. The numeric id is only used to walk epics[N].stories[] in epic order.
3. Compute storyQueue:
   a. Iterate sprint-status.epics in order. For each epic:
      - Skip if epicFilter set and epic.id != epicFilter.
      - Epic dep check (HIGH 2): if epic.depends_on contains epic IDs, that dep is satisfied ONLY when EVERY story in the dep epic has development_status[canonicalKey] === 'done'. DERIVE this — do NOT read epic.status (stays "backlog" forever even when all stories done).
      - If unsatisfied, mark epic as blocked (skip its stories, add to skipped[] with reason: 'epic_blocked').
      - Otherwise, iterate epic.stories (numeric ids) in order. For each numeric id:
        - Resolve canonical key via the lookup from step 2.
        - Skip if storyFilter set and canonical != storyFilter.
        - Read status from development_status[canonicalKey].
        - If status == 'done': add canonicalKey to completed[].
        - If status in ('backlog', 'in-progress', 'review', 'blocked', 'ready-for-dev'): add canonicalKey to storyQueue.
        - If status == 'awaiting-operator': add canonicalKey to awaitingOperator[] (skip in queue).
4. Seed intra-epic sequential dependencies (HIGH 3) BEFORE inference:
   For each epic that contributes stories to storyQueue:
     - Walk storyQueue entries from this epic in their epic-order (epics[N].stories[] order).
     - For each story at index > 0: seed inferred entry {story, depends_on: [previousStoryCanonical]}.
     - First story (index 0) seeds as {story, depends_on: []}.
   This default chain ensures stories execute in order unless overridden.
5. If inferDeps AND NOT noInfer:
   a. For each story in storyQueue, read spec at <prdWorktreePath>/_bmad-output/implementation-artifacts/stories/<canonicalKey>.md
   b. Extract depends_on from spec frontmatter if present.
   c. If absent, scan spec body for story key mentions (regex: /\\b\\d+-\\d+[a-z]?\\b/g) and "depends on story X" phrasing.
   d. Apply overrides: for each story, merge frontmatter depends_on over the seed (override = union, seed entries stay if not overridden). Use CANONICAL keys throughout (both story and depends_on fields).
6. Write ${runDir}/deps.json with { "inferred": <graph> }.
7. Append to ${runDir}/journal.jsonl: {"ts":"${timestamp}","event":"plan_complete","storyQueueSize":<n>,"inferredEdges":<m>}
8. Return JSON matching the schema: { storyQueue, completed, blocked, skipped, awaitingOperator, inferred: [{story, depends_on}, ...] }

CONSTRAINTS:
- Read-only on sprint-status. Do NOT modify.
- Do NOT modify any spec file.
- All storyQueue / completed / blocked / skipped / awaitingOperator entries MUST be CANONICAL keys (X-Y-...).
- inferred entries MUST use CANONICAL keys in BOTH story and depends_on fields.`,
  { label: `plan-${timestamp}`, phase: 'Plan', schema: {
    type: 'object',
    properties: {
      storyQueue: { type: 'array', items: { type: 'string' } },
      completed: { type: 'array', items: { type: 'string' } },
      blocked: { type: 'array', items: { type: 'string' } },
      skipped: { type: 'array', items: { type: 'string' } },
      awaitingOperator: { type: 'array', items: { type: 'string' } },
      inferred: { type: 'array', items: DEP_ENTRY_SCHEMA },
    },
    required: ['storyQueue', 'completed', 'blocked', 'skipped', 'awaitingOperator', 'inferred'],
  }, agentType: 'general-purpose' }
)
if (!planResult) {
  return { aborted: true, stage: 'plan', error: 'plan agent failed' }
}
log(`Queue: ${planResult.storyQueue.length} stories, ${planResult.inferred.length} inferred edges`)

// ============================================================================
// STATE PERSIST + RESUME HANDLING (CRITICAL 1 + HIGH 4)
// ============================================================================
const writeStateAgent = async () => {
  const stateContent = {
    runId: timestamp,
    ts: timestamp,
    prdKey: setup.prdKey,
    storyQueue: planResult.storyQueue,
    completed: planResult.completed,
    blocked: planResult.blocked,
    skipped: planResult.skipped,
    awaitingOperator: planResult.awaitingOperator,
    halts: [],
    inferred: planResult.inferred,
  };
  return await agent(
    `You are the writeState helper for bmad-prd-orchestrate.

Persist the current orchestrator state to disk so a halted run can resume.

WRITE TO: ${runDir}/state.json

CONTENT (overwrite the file with this exact JSON):
${JSON.stringify(stateContent, null, 2)}

STEPS:
1. mkdir -p ${runDir}
2. Write the JSON above to ${runDir}/state.json (use Write tool or python -m json.tool for validation).
3. Append to ${runDir}/journal.jsonl: {"ts":"${timestamp}","event":"state_persisted","storyQueueSize":${planResult.storyQueue.length}}
4. Return JSON: { "written": true, "path": "${runDir}/state.json" }

CONSTRAINTS:
- ONLY write to ${runDir}/. DO NOT touch any file outside.`,
    { label: `writeState-${timestamp}`, phase: 'Plan', schema: WRITE_STATE_SCHEMA, agentType: 'general-purpose' }
  );
};

// CRITICAL 1: handle resume before fresh-run halt
if (userChoice) {
  if (userChoice === 'confirm_deps' && confirmedDeps) {
    log(`Resuming with confirm_deps (confirmedDeps entries: ${Array.isArray(confirmedDeps) ? confirmedDeps.length : Object.keys(confirmedDeps).length})`)
    if (Array.isArray(confirmedDeps)) {
      planResult.inferred = confirmedDeps
    } else if (typeof confirmedDeps === 'object') {
      planResult.inferred = Object.entries(confirmedDeps).map(([story, deps]) => ({
        story,
        depends_on: Array.isArray(deps) ? deps : [],
      }))
    }
    log(`Updated inferred to ${planResult.inferred.length} confirmed entries`)
    await writeStateAgent()
    // FALL THROUGH — Phase 3 (future) appends here
  } else if (userChoice === 'proceed_without_inference') {
    log(`Resuming with proceed_without_inference (clearing inferred graph)`)
    planResult.inferred = []
    await writeStateAgent()
    // FALL THROUGH — Phase 3 (future) appends here
  } else if (userChoice === 'abort_prd') {
    log(`Aborting per userChoice=abort_prd`)
    return { aborted: true, haltReason: 'aborted', timestamp, runDir }
  } else {
    log(`WARNING: unrecognized userChoice=${userChoice}; falling through to Phase 3`)
    await writeStateAgent()
    // FALL THROUGH — Phase 3 (future) appends here
  }
} else if (resume) {
  // Resume token without userChoice → re-halt with current state
  log(`Resume token provided but no userChoice; re-halting`)
  await writeStateAgent()
  return {
    haltReason: 'dep_inference_confirm',
    context: { inferred: planResult.inferred, storyQueue: planResult.storyQueue },
    resumeToken: timestamp,
    runDir,
    userOptions: ['confirm_deps', 'proceed_without_inference', 'abort_prd'],
  }
} else if (inferDeps && !noInfer && planResult.inferred.length > 0) {
  // First-run halt to confirm inferred graph
  log('Halting to confirm inferred dependency graph...')
  await writeStateAgent()
  return {
    haltReason: 'dep_inference_confirm',
    context: { inferred: planResult.inferred, storyQueue: planResult.storyQueue },
    resumeToken: timestamp,
    runDir,
    userOptions: ['confirm_deps', 'proceed_without_inference', 'abort_prd'],
  }
} else {
  // No inferred deps — persist and fall through to Phase 3
  log('No inferred deps — persisting state and falling through to Phase 3')
  await writeStateAgent()
  // FALL THROUGH — Phase 3 (future) appends here
}