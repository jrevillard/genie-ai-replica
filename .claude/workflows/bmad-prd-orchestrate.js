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
// hitlEvery: optional periodic checkpoint. 0 = no limit (default = fully autonomous).
// Error halts (convergence_escalation, ci_hardfail, launch_failure, merge_conflict, merge_blocked) are INDEPENDENT of this — they always trigger.
const hitlEvery = args_.hitlEvery === undefined ? 0 : args_.hitlEvery;
const hitlFinalOnly = args_.hitlFinalOnly || false;
const inferDeps = args_.inferDeps !== false;  // default true
const noInfer = args_.noInfer || false;
const retro = args_.retro || false;
const retryPolicy = args_.retryPolicy || 'once';
const resume = args_.resume || null;
const userChoice = args_.userChoice || null;
const confirmedDeps = args_.confirmedDeps || null;
const maxIterations = args_.maxIterations || 5;
const cleanup = args_.cleanup || false;
const timestamp = args_.timestamp || 'unknown';
const projectRoot = '/home/jerome/git_projects/ITU/genie-ai';
// runDir + convergeScriptPath are derived AFTER Setup (so the discovery step
// can fail fast without leaving stale run-dir references in code).

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
1. Discover BARE repo (not the worktree):
   a. \`git rev-parse --git-dir\` returns the path to .git (e.g. '.git' from inside a worktree, or '/path/to/bare/.git' from the bare repo).
   b. The BARE repo root = parent of --git-dir. Use this script to derive it:
      \`GIT_DIR=$(git rev-parse --git-dir); if [ "$GIT_DIR" = ".git" ]; then REPO_ROOT=$(cd .. && pwd); else REPO_ROOT=$(dirname "$GIT_DIR"); fi; echo "$REPO_ROOT"\`
   c. SETUP.repoRoot = the bare repo root (NOT the worktree path). \`git rev-parse --show-toplevel\` is WRONG — it returns the worktree path, not the bare repo. The converge sub-workflow's scriptPath is computed as \`repoRoot + '/.claude/workflows/bmad-build-converge.js'\` — if repoRoot is the worktree, the file isn't there.
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

// Derive runDir + convergeScriptPath from the setup agent's discovery output
// rather than hardcoding any specific PRD worktree path. The optional prdKey
// arg is only honored if it matches the discovered value (else we log a
// warning and use discovery).
const runDir = setup.prdWorktreePath + '/_bmad-output/implementation-artifacts/orchestrate-runs/' + timestamp;
const convergeScriptPath = setup.repoRoot + '/.claude/workflows/bmad-build-converge.js';
if (prdKey && prdKey !== setup.prdKey) {
  log(`WARNING: args.prdKey (${prdKey}) != discovered prdKey (${setup.prdKey}); using discovered value`)
} else if (prdKey) {
  log(`prdKey arg matches discovered: ${setup.prdKey}`)
}

log(`Discovered: prdKey=${setup.prdKey}, prdBranch=${setup.prdBranch}`)
log(`runDir=${runDir} | convergeScriptPath=${convergeScriptPath}`)

// On resume, load the previously persisted inference graph BEFORE Phase 2 so
// the plan agent can compare its fresh inference against the prior one and
// surface any delta to the operator. Without this, every resume recomputes
// from scratch and silently overwrites the operator's earlier confirmation.
let previousInference = null;
if (resume) {
  const prevState = await agent(
    `Read ${runDir}/state.json and return its parsed JSON object.
If the file does not exist (first-run / wiped state), return { "missing": true }.
Use the Read tool, parse JSON, return the parsed object as-is.`,
    { label: `state-load-plan`, phase: 'Plan', schema: {
      type: 'object', additionalProperties: true,
    }, agentType: 'general-purpose' }
  );
  if (prevState && typeof prevState === 'object' && !prevState.missing && Array.isArray(prevState.inferred)) {
    previousInference = prevState.inferred;
    log(`Loaded previous inference graph (${previousInference.length} edges) for resume comparison`)
  }
}

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
PREVIOUS_INFERENCE: ${previousInference ? JSON.stringify(previousInference) : 'null'}

STEPS:
1. Read ${setup.sprintStatusPath}.
2. Build numeric → canonical story key lookup:
   a. The sprint-status has TWO different ID forms:
      - epics[N].stories[] uses NUMERIC ids like "<epic-num>.<story-num>"
      - development_status keys are CANONICAL like "<epic-num>-<story-num><suffix>-..."
   b. Walk development_status keys; for each canonical key extract the leading "<epic-num>-<story-num>[a-z]?" prefix. A numeric id matches the canonical form by that prefix.
   c. The canonical key is the storyQueue / completed / blocked / etc. entry. The numeric id is only used to walk epics[N].stories[] in epic order.
3. Compute storyQueue:
   a. Iterate sprint-status.epics in order. For each epic:
      - Skip if epicFilter set and epic.id != epicFilter.
      - Epic dep check: if epic.depends_on contains epic IDs, that dep is satisfied ONLY when EVERY story in the dep epic has development_status[canonicalKey] === 'done'. DERIVE this — do NOT read epic.status (stays "backlog" forever even when all stories done).
      - If unsatisfied, mark epic as blocked (skip its stories, add to skipped[] with reason: 'epic_blocked').
      - Otherwise, iterate epic.stories (numeric ids) in order. For each numeric id:
        - Resolve canonical key via the lookup from step 2.
        - Skip if storyFilter set and canonical != storyFilter.
        - Read status from development_status[canonicalKey].
        - If status == 'done': add canonicalKey to completed[].
        - If status in ('backlog', 'in-progress', 'review', 'blocked', 'ready-for-dev'): add canonicalKey to storyQueue.
        - If status == 'awaiting-operator': add canonicalKey to awaitingOperator[] (skip in queue).
4. Seed intra-epic sequential dependencies BEFORE inference:
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
   e. PREVIOUS_INFERENCE comparison (only when PREVIOUS_INFERENCE is non-null):
      - Build a {story -> sorted depends_on} map from PREVIOUS_INFERENCE and from your fresh inference.
      - For each story present in BOTH maps where depends_on differs, list the story + old deps + new deps in a "delta" note in your reply text (not in the JSON schema).
      - If the user wants to keep the previous graph despite the delta, the orchestrator passes confirmedDeps on resume; your fresh inference is only used when no previous exists.
6. Write ${runDir}/deps.json with { "inferred": <graph> }.
7. Append to ${runDir}/journal.jsonl: {"ts":"${timestamp}","event":"plan_complete","storyQueueSize":<n>,"inferredEdges":<m>}
8. Return JSON matching the schema: { storyQueue, completed, blocked, skipped, awaitingOperator, inferred: [{story, depends_on}, ...] }

CONSTRAINTS:
- Read-only on sprint-status. Do NOT modify.
- Do NOT modify any spec file.
- All storyQueue / completed / blocked / skipped / awaitingOperator entries MUST be CANONICAL keys.
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
// STATE PERSIST + RESUME HANDLING
// The persisted state.json is the single source of truth for resuming a
// halted run; the operator's userChoice on resume mutates that state before
// Phase 3 begins iteration.
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

// Resume handling: when an operator resumes a halted run with a userChoice
// (e.g. confirm_deps, proceed_without_inference, abort_prd), apply that
// choice BEFORE the fresh-run halt block below so a resumed run never
// re-prompts the dep-inference confirmation that was already given.
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
  } else if (userChoice === 'proceed_without_inference') {
    log(`Resuming with proceed_without_inference (clearing inferred graph)`)
    planResult.inferred = []
    await writeStateAgent()
  } else if (userChoice === 'abort_prd') {
    log(`Aborting per userChoice=abort_prd`)
    return { aborted: true, haltReason: 'aborted', timestamp, runDir }
  } else {
    log(`WARNING: unrecognized userChoice=${userChoice}; falling through to Phase 3`)
    await writeStateAgent()
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
}

// ============================================================================
// PHASE 3: EXECUTE — per-story loop with dep-check + converge dispatch
// ============================================================================
phase('Execute')
log('Starting execute loop...')

// State init (snapshot of planResult; will be overwritten by loadState on resume)
let state = {
  runId: timestamp,
  ts: timestamp,
  prdKey: setup.prdKey,
  storyQueue: planResult.storyQueue,
  completed: planResult.completed,
  blocked: planResult.blocked,
  skipped: planResult.skipped,
  awaitingOperator: planResult.awaitingOperator,
  halts: [],
  iterationCount: 0,
  inferred: planResult.inferred,  // keep graph available across resumes
}

// State persistence helpers (Phase 3 owns these; Task 2 inlined a parallel helper for plan-time)
const writeState = async (stateObj) => {
  return await agent(
    `You are the writeState helper for bmad-prd-orchestrate (Phase 3 loop).

Persist the current orchestrator LOOP state to disk so a halted run can resume from any iteration.

WRITE TO: ${runDir}/state.json

CONTENT (overwrite the file with this exact JSON):
${JSON.stringify(stateObj, null, 2)}

STEPS:
1. mkdir -p ${runDir}
2. Write the JSON above to ${runDir}/state.json (use Write tool).
3. Verify the file exists with: \`ls -la ${runDir}/state.json\`
4. Return JSON: { "written": true, "path": "${runDir}/state.json" }

CONSTRAINTS:
- ONLY write to ${runDir}/. DO NOT touch any file outside.
- DO NOT modify ${setup.sprintStatusPath}. The orchestrator is the sole writer; transitions happen in Phase 4 (Task 4).`,
    { label: `state-write-${stateObj.iterationCount || 0}`, phase: 'Execute', schema: WRITE_STATE_SCHEMA, agentType: 'general-purpose' }
  );
};

const appendJournal = async (event) => {
  const entry = { ts: timestamp, ...event };
  return await agent(
    `Append one JSONL line to ${runDir}/journal.jsonl.

LINE TO APPEND (single line, no trailing newline added):
${JSON.stringify(entry)}

STEPS:
1. Use bash: \`echo '${JSON.stringify(entry)}' >> ${runDir}/journal.jsonl\`
   (single-quoted echo is safe because the JSON string itself does not contain single quotes — agent must verify).
2. Return JSON: { "appended": true }`,
    { label: `journal-${event.event || 'unknown'}`, phase: 'Execute', schema: {
      type: 'object', properties: { appended: { type: 'boolean' } }, required: ['appended'],
    }, agentType: 'general-purpose' }
  );
};

const loadState = async () => {
  return await agent(
    `Read ${runDir}/state.json and return its parsed JSON object.

If the file does not exist (first-run / wiped state), return { "missing": true }.

STEPS:
1. Read ${runDir}/state.json with the Read tool.
2. Parse JSON.
3. Return the parsed object as-is.`,
    { label: `state-load`, phase: 'Execute', schema: {
      type: 'object', additionalProperties: true,
    }, agentType: 'general-purpose' }
  );
};

// Cross-run CI retry helper (retryPolicy semantics: once | always | never).
// Re-queues stories whose previous attempt halted with reason='ci_hardfail'.
// 'once' marks each halt entry with retried=true so subsequent resumes skip
// it; 'always' re-queues every resume without marking; 'never' is a no-op.
// Stories already present in the queue or completed list are skipped to avoid
// double-dispatch.
const requeueCIHardfails = () => {
  if (retryPolicy === 'never') return 0;
  const queueSet = new Set(state.storyQueue);
  const completedSet = new Set(state.completed);
  const seen = new Set(); // de-dupe across multiple halt entries for the same story
  let count = 0;
  for (const h of (state.halts || [])) {
    if (!h || h.reason !== 'ci_hardfail' || !h.story) continue;
    if (retryPolicy === 'once' && h.retried === true) continue;
    if (seen.has(h.story)) continue;
    if (queueSet.has(h.story) || completedSet.has(h.story)) continue;
    state.storyQueue.unshift(h.story);
    queueSet.add(h.story);
    seen.add(h.story);
    if (retryPolicy === 'once') h.retried = true;
    count++;
  }
  if (count > 0) {
    // Drop these stories from state.blocked so retry_blocked doesn't re-add them too
    state.blocked = state.blocked.filter(b => !seen.has(typeof b === 'string' ? b : (b && b.story) || null));
    log(`retryPolicy=${retryPolicy}: re-queued ${count} ci_hardfail stor(y/ies) at front of queue`)
  }
  return count;
};

// Resume handling — load persisted state if resume token present.
// IMPORTANT: loadState is only useful when Phase 3 halted mid-loop (so
// completed/blocked/skipped/iterationCount carry over). For the
// dep_inference_confirm → confirm_deps resume path, the state.json has
// the post-Plan-2 snapshot which is identical to the freshly-built local
// state. Skipping the load there avoids the spread-merge overwriting
// array fields with undefined / stale values (the bug that crashed run 1).
const isResumingFromInferConfirm = (resume && userChoice === 'confirm_deps' && Array.isArray(confirmedDeps) && confirmedDeps.length > 0)
if (resume) {
  if (!isResumingFromInferConfirm) {
    const loaded = await loadState();
    if (loaded && typeof loaded === 'object' && !loaded.missing) {
      state = { ...state, ...loaded };
      // Defensive: ensure all collection fields stay arrays (disk state may be missing fields)
      for (const k of ['storyQueue', 'completed', 'blocked', 'skipped', 'awaitingOperator', 'halts']) {
        if (!Array.isArray(state[k])) state[k] = []
      }
      log(`Resumed from ${resume}: queueSize=${state.storyQueue.length} completed=${state.completed.length} blocked=${state.blocked.length} iterationCount=${state.iterationCount}`)
    } else {
      log(`WARNING: resume=${resume} but loadState returned no usable data; proceeding with fresh state`)
    }
  } else {
    log(`Resume from dep_inference_confirm — skipping loadState (state is fresh from Plan agent)`)
  }

  // Auto-requeue CI hard-fail halts per retryPolicy, BEFORE userChoice processing
  // so the operator's userChoice can still override (e.g. abort_prd still wins).
  requeueCIHardfails();

  // Apply userChoice (periodic HITL options)
  if (userChoice === 'continue') {
    // no-op: keep storyQueue as-is
  } else if (userChoice === 'retry_blocked') {
    // Re-add blocked stories to front of queue
    const blockedStories = state.blocked
      .map(b => typeof b === 'string' ? b : (b && b.story) ? b.story : null)
      .filter(Boolean);
    state.storyQueue = [...blockedStories, ...state.storyQueue];
    state.blocked = [];
    log(`retry_blocked: re-queued ${blockedStories.length} blocked stories at front of queue`)
  } else if (userChoice === 'skip_blocked') {
    log(`skip_blocked: leaving blocked as-is, continuing with remaining queue`)
  } else if (userChoice === 'abort_prd') {
    log('User aborted PRD; returning final report')
    await writeState(state);
    await appendJournal({ event: 'abort_prd', queueSize: state.storyQueue.length });
    return { haltReason: 'final_complete', aborted: true, context: state, runDir };
  } else if (userChoice === 'fix_then_resume') {
    log('Resuming with fix_then_resume; user should have pushed fix commits externally')
  } else {
    log(`Unknown userChoice=${userChoice}; defaulting to continue`)
  }
  await appendJournal({ event: 'resume', userChoice, queueSize: state.storyQueue.length });
}

// Persist loop state before starting iteration (resume safety)
await writeState(state);

// Per-story loop
while (state.storyQueue.length > 0) {
  const sk = state.storyQueue[0];
  state.iterationCount++;

  log(`--- Iteration ${state.iterationCount}: story ${sk} (queue remaining: ${state.storyQueue.length}) ---`)

  // Read current sprint-status (status may have moved between plan and now)
  const currentStatus = await agent(
    `Read ${setup.sprintStatusPath}. Find development_status['${sk}'].

Return JSON: { "status": <value> }

If the key is missing, return { "status": "missing" }.`,
    { label: `read-status-${sk}`, phase: 'Execute', schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    }, agentType: 'general-purpose' }
  );

  // awaiting-operator parking (do NOT execute — park in awaitingOperator[], continue)
  if (currentStatus && currentStatus.status === 'awaiting-operator') {
    log(`Story ${sk} in awaiting-operator; parking (not executing)`)
    state.awaitingOperator.push(sk);
    state.storyQueue.shift();
    continue;
  }

  // already done: skip re-execution (defensive — covers races with external status writes)
  if (currentStatus && currentStatus.status === 'done') {
    log(`Story ${sk} already done per sprint-status; marking completed`)
    state.completed.push(sk);
    state.storyQueue.shift();
    continue;
  }

  // Dep check: if any depends_on entry in inferred graph is not in state.completed
  const inferredEdge = planResult.inferred.find(e => e.story === sk);
  const deps = inferredEdge ? inferredEdge.depends_on : [];
  const unmetDeps = deps.filter(d => !state.completed.includes(d));
  if (unmetDeps.length > 0) {
    log(`Story ${sk} has unmet deps: ${unmetDeps.join(', ')}; skipping`)
    state.skipped.push({ story: sk, reason: 'unmet_deps', deps: unmetDeps });
    state.storyQueue.shift();
    await appendJournal({ event: 'skip', storyKey: sk, reason: 'unmet_deps', deps: unmetDeps });
    continue;
  }

  // Dispatch bmad-build-converge sub-workflow (1 level nesting)
  log(`Dispatching bmad-build-converge for ${sk}...`)
  await appendJournal({ event: 'dispatch', storyKey: sk, iteration: state.iterationCount });
  let convergeResult = null;
  let launchError = null;
  try {
    convergeResult = await workflow({ scriptPath: convergeScriptPath, args: {
      storyKey: sk,
      maxIterations,
      timestamp: timestamp + '-' + sk,
    }});
  } catch (e) {
    launchError = String(e);
  }

  // Handle launch failure (workflow() threw)
  if (launchError || !convergeResult) {
    log(`Sub-workflow launch failed for ${sk}: ${launchError}`)
    state.blocked.push({ story: sk, reason: 'launch_failed', details: launchError });
    state.storyQueue.shift();
    await appendJournal({ event: 'launch_failed', storyKey: sk, iteration: state.iterationCount });
    continue;
  }

  // MR-creation failure: the converge sub-workflow returns converged:true with
  // an aborted field populated when MR creation itself fails (no pipeline was
  // ever launched). Treat as merge_conflict — the story needs operator review.
  if (convergeResult.aborted) {
    log(`Sub-workflow halted for ${sk}: ${convergeResult.aborted}`)
    // Also push to state.blocked so retry_blocked re-queues this story on resume
    // (the story is left at storyQueue[0] so the natural shift below would lose it).
    state.blocked.push({ story: sk, reason: 'merge_conflict', details: String(convergeResult.aborted) });
    state.halts.push({ reason: 'merge_conflict', story: sk, iteration: state.iterationCount, details: String(convergeResult.aborted) });
    state.storyQueue.shift();
    await writeState(state);
    await appendJournal({ event: 'halt_merge_conflict', storyKey: sk, iteration: state.iterationCount, details: String(convergeResult.aborted) });
    return {
      haltReason: 'merge_conflict',
      context: { story: sk, completed: state.completed, blocked: state.blocked, skipped: state.skipped, awaitingOperator: state.awaitingOperator, details: String(convergeResult.aborted) },
      resumeToken: timestamp,
      runDir,
      userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'],
    };
  }

  // CI hard-fail: converge returns converged:true even when CI failed (its
  // internal retry loop already exhausted transient retries). Treat any non-
  // success monitor.status as a hard fail — halt instead of silently marking
  // completed. Also catches merge blocked by a CI rule such as the merge-train
  // gate (status: 'success' but merge.merged: false).
  const ciStatus = convergeResult.monitor && convergeResult.monitor.status;
  const mergeBlocked = convergeResult.merge && convergeResult.merge.merged === false;
  if (ciStatus && ciStatus !== 'success') {
    log(`CI hard-fail for ${sk}: monitor.status=${ciStatus}`)
    state.blocked.push({ story: sk, reason: 'ci_hardfail', details: { ciStatus, failedJobs: convergeResult.monitor.failedJobs, retries: convergeResult.monitor.retries, transient: convergeResult.monitor.transient } });
    state.halts.push({ reason: 'ci_hardfail', story: sk, iteration: state.iterationCount, details: { ciStatus, failedJobs: convergeResult.monitor.failedJobs } });
    state.storyQueue.shift();
    await writeState(state);
    await appendJournal({ event: 'halt_ci_hardfail', storyKey: sk, iteration: state.iterationCount, ciStatus });
    return {
      haltReason: 'ci_hardfail',
      context: { story: sk, ciStatus, failedJobs: convergeResult.monitor.failedJobs, completed: state.completed, blocked: state.blocked, skipped: state.skipped, awaitingOperator: state.awaitingOperator },
      resumeToken: timestamp,
      runDir,
      userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'],
    };
  }
  if (mergeBlocked) {
    log(`Merge blocked for ${sk}: ${convergeResult.merge.error || 'unknown'}`)
    state.blocked.push({ story: sk, reason: 'merge_blocked', details: convergeResult.merge.error || null });
    state.halts.push({ reason: 'merge_blocked', story: sk, iteration: state.iterationCount, details: convergeResult.merge.error || null });
    state.storyQueue.shift();
    await writeState(state);
    await appendJournal({ event: 'halt_merge_blocked', storyKey: sk, iteration: state.iterationCount, error: convergeResult.merge.error });
    return {
      haltReason: 'merge_blocked',
      context: { story: sk, error: convergeResult.merge.error, completed: state.completed, blocked: state.blocked, skipped: state.skipped, awaitingOperator: state.awaitingOperator },
      resumeToken: timestamp,
      runDir,
      userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'],
    };
  }

  // Apply result
  if (convergeResult.converged) {
    state.completed.push(sk);
    log(`Story ${sk} converged (iter ${convergeResult.iterations}, finalSha=${(convergeResult.finalSha || '').substring(0, 7)})`)
    await appendJournal({ event: 'converged', storyKey: sk, iteration: state.iterationCount, iterations: convergeResult.iterations });
  } else {
    state.blocked.push({ story: sk, reason: convergeResult.escalateReason || 'not_converged' });
    log(`Story ${sk} blocked: ${convergeResult.escalateReason || 'not_converged'}`)
    await appendJournal({ event: 'blocked', storyKey: sk, iteration: state.iterationCount, reason: convergeResult.escalateReason || 'not_converged' });
  }

  state.storyQueue.shift();

  // Periodic HITL halt
  if (!hitlFinalOnly && hitlEvery > 0 && state.iterationCount % hitlEvery === 0) {
    log(`Periodic HITL checkpoint at iteration ${state.iterationCount}`)
    state.halts.push({ reason: 'periodic_review', iteration: state.iterationCount });
    await writeState(state);
    await appendJournal({ event: 'halt_periodic', iteration: state.iterationCount });
    return {
      haltReason: 'periodic_review',
      context: { completed: state.completed, blocked: state.blocked, skipped: state.skipped, awaitingOperator: state.awaitingOperator },
      resumeToken: timestamp,
      runDir,
      userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'],
    };
  }
}

// Loop exited cleanly: queue empty
log(`Execute loop complete: completed=${state.completed.length} blocked=${state.blocked.length} skipped=${state.skipped.length} awaitingOperator=${state.awaitingOperator.length}`)
await writeState(state);
await appendJournal({ event: 'execute_complete', completed: state.completed.length, blocked: state.blocked.length, skipped: state.skipped.length, awaitingOperator: state.awaitingOperator.length, halts: state.halts.length });

// ============================================================================
// PHASE 4: EPIC BOUNDARY — sprint-status sync + optional retrospective
// ============================================================================
phase('Epic boundary')
log('Syncing sprint-status: completed stories → done (orchestrator is sole writer of done transitions)...')

// 4.1 Sprint-status sync (ALWAYS — the orchestrator is the sole writer of the
// done transition). After each story MR merges into the PRD branch,
// sprint-status.yaml holds `in-progress` (committed by the converge setup
// agent onto the story branch, propagated via MR merge). The orchestrator
// advances to `done` here so the file's terminal state is correct.
//
// Implementation note: sprint_plan.py has no `advance` subcommand. The brief
// references an `advance` subcommand, but the script's actual subcommands are
// generate/status/validate (see .claude/skills/bmad-sprint-planning/SKILL.md).
// `generate --set <key>=<status>` is the documented equivalent: re-parses the
// epics, merges with existing statuses (preserving in-progress, etc.), and the
// `--set` flag forces the targeted keys to the desired status.
const sprintStatusSync = await agent(
  `You are the sprint-status sync agent for bmad-prd-orchestrate (Phase 4).

PRD_WORKTREE_PATH: ${setup.prdWorktreePath}
SPRINT_STATUS_PATH: ${setup.sprintStatusPath}
COMPLETED_STORIES: ${JSON.stringify(state.completed)}
TIMESTAMP: ${timestamp}

GOAL: Advance sprint-status.yaml on the PRD branch so every converged story
      is 'done' and every epic whose stories are all done is 'done' too.
      Then commit + push so the remote reflects the final state.

STEPS:
1. cd ${setup.prdWorktreePath}
2. Discover an epic file under ${setup.prdWorktreePath}/_bmad-output/planning-artifacts/:
   - Prefer 'epics.md' or any 'epics*.md' / 'epic-*.md' file in that dir.
   - If multiple match, use the first one (the script tolerates any valid epics file).
3. Read ${setup.sprintStatusPath} to extract 'project' and 'generated' fields (preserve them).
4. Build the --set flags:
   - For each <key> in COMPLETED_STORIES: add --set <key>=done
   - For each epic-N in the file: if EVERY story belonging to epic-N has status 'done', add --set epic-N=done
   (Numeric → canonical mapping: a story canonical key begins with the epic number prefix; epic-N's stories are those whose canonical key starts with that prefix.)
5. Run ONE batched invocation (avoids partial-write races):
   python3 ${setup.repoRoot}/.claude/skills/bmad-sprint-planning/scripts/sprint_plan.py generate \\
     --epic-file <EPIC_FILE> \\
     --status-file ${setup.sprintStatusPath} \\
     --stories-dir ${setup.prdWorktreePath}/_bmad-output/implementation-artifacts/stories \\
     --project "<project_name>" \\
     --date "${timestamp}" \\
     <all --set flags>
   The script emits a JSON report — verify it returned {"ok": true, ...}.
6. If the status file was modified (advanced > 0):
   - git -C ${setup.prdWorktreePath} add _bmad-output/implementation-artifacts/sprint-status.yaml
   - git -C ${setup.prdWorktreePath} commit -m "chore(sprint-status): Phase 4 sync — <N> stories + <M> epics to done"
   - git -C ${setup.prdWorktreePath} push origin ${setup.prdBranch}
7. If advanced == 0 (everything already done — rare idempotent rerun):
   - Skip commit + push. Return committed=false, pushed=false.
8. Return JSON: { advanced: <int>, advancedEpics: [<epicKey>], committed: <bool>, pushed: <bool>, projectName: <string> }

CONSTRAINTS:
- ONLY write to ${setup.prdWorktreePath}/_bmad-output/implementation-artifacts/sprint-status.yaml.
- DO NOT modify any other tracked file.
- DO NOT skip commit + push when advanced > 0 — without it the remote stays stale.
- The orchestrator is the SOLE writer of the done transition; the converge setup
  agent only writes 'in-progress' on the story branch.`,
  { label: `sprint-status-sync-${timestamp}`, phase: 'Epic boundary', schema: {
    type: 'object',
    properties: {
      advanced: { type: 'integer' },
      advancedEpics: { type: 'array', items: { type: 'string' } },
      committed: { type: 'boolean' },
      pushed: { type: 'boolean' },
      projectName: { type: 'string' },
    },
    required: ['advanced', 'advancedEpics', 'committed', 'pushed'],
  }, agentType: 'general-purpose' }
);

log(`Sprint-status sync: ${sprintStatusSync.advanced} stories → done, ${sprintStatusSync.advancedEpics.length} epics → done (committed=${sprintStatusSync.committed}, pushed=${sprintStatusSync.pushed})`)
await appendJournal({
  event: 'phase4_sprint_status_sync',
  advanced: sprintStatusSync.advanced,
  advancedEpics: sprintStatusSync.advancedEpics,
  committed: sprintStatusSync.committed,
  pushed: sprintStatusSync.pushed,
});

// 4.2 Optional retrospective at epic boundaries (--retro flag).
// Only fires when (a) --retro=true AND (b) at least one epic advanced to done.
if (retro && sprintStatusSync.advancedEpics.length > 0) {
  // Determine which retros still need to run (skip epics whose retro is already 'done').
  const retroCheck = await agent(
    `Read ${setup.sprintStatusPath}.

For each of these epic keys: ${JSON.stringify(sprintStatusSync.advancedEpics)}
Find the corresponding retro key 'epic-N-retrospective'.

Return JSON: { retrosNeeded: [<epicKey>] }
where <epicKey> entries are the epics whose retro key is NOT 'done' (i.e., the retro still needs to run).`,
    { label: `retro-check-${timestamp}`, phase: 'Epic boundary', schema: {
      type: 'object',
      properties: { retrosNeeded: { type: 'array', items: { type: 'string' } } },
      required: ['retrosNeeded'],
    }, agentType: 'general-purpose' }
  );

  const retrosNeeded = retroCheck.retrosNeeded || [];

  if (retrosNeeded.length === 0) {
    log('All epics already have done retros; skipping retro dispatch')
    await appendJournal({ event: 'phase4_retro_skip', reason: 'all_done' });
  } else if (userChoice !== 'proceed_retro' && userChoice !== 'skip_retro') {
    // Halt for user approval before invoking retros (the brief mandates a manual gate here).
    log(`Halting for retro approval: ${retrosNeeded.length} epic(s) ready for retrospective...`)
    await writeState(state);
    await appendJournal({ event: 'halt_epic_retro', epics: retrosNeeded });
    return {
      haltReason: 'epic_retro',
      context: { retrosNeeded, completed: state.completed, blocked: state.blocked, runDir },
      resumeToken: timestamp,
      runDir,
      userOptions: ['proceed_retro', 'skip_retro', 'abort_prd'],
    };
  } else if (userChoice === 'skip_retro') {
    log('Retro skipped per userChoice')
    await appendJournal({ event: 'phase4_retro_skip', reason: 'user_choice', epics: retrosNeeded });
  } else {
    // userChoice === 'proceed_retro': invoke one retro per epic. The skill is the
    // SOLE writer of the retro key status and action_items — the agent only verifies.
    log(`Invoking bmad-retrospective for ${retrosNeeded.length} epic(s)...`)
    const retrosCompleted = [];
    for (const epicKey of retrosNeeded) {
      // Extract numeric N from 'epic-N' so we can pass -H <N> to the skill.
      const epicNumMatch = /^epic-(\d+)$/.exec(epicKey);
      if (!epicNumMatch) {
        log(`WARNING: skipping malformed epicKey ${epicKey} (expected 'epic-N')`)
        continue;
      }
      const epicNum = epicNumMatch[1];

      const retroResult = await agent(
        `You are the retro dispatch agent for bmad-prd-orchestrate (Phase 4).

EPIC_KEY: ${epicKey}
EPIC_NUM: ${epicNum}
PRD_WORKTREE_PATH: ${setup.prdWorktreePath}
TIMESTAMP: ${timestamp}

GOAL: Invoke bmad-retrospective in headless mode for epic ${epicNum}.

STEPS:
1. cd ${setup.prdWorktreePath}
2. Invoke the bmad-retrospective skill in headless mode (the stable orchestrator-facing interface per SKILL.md):
   \`Skill: bmad-retrospective -H ${epicNum}\`
   Pass the numeric epic id; the skill handles discovery + sprint-status update + action items.
3. After the skill returns, re-read ${setup.sprintStatusPath}.
4. Verify development_status['epic-${epicNum}-retrospective'] === 'done'.
   - If not done: HALT — return retroDone=false with the failing field.
5. If the status file was modified during the retro (or to record an assumption),
   commit + push:
   - git -C ${setup.prdWorktreePath} add _bmad-output/implementation-artifacts/sprint-status.yaml
   - git -C ${setup.prdWorktreePath} commit -m "chore(sprint-status): retro for ${epicKey} done"
   - git -C ${setup.prdWorktreePath} push origin ${setup.prdBranch}
6. Return JSON: { epicKey: '${epicKey}', retroDone: <bool>, committed: <bool>, pushed: <bool>, actionItemsCount: <int> }

CONSTRAINTS:
- ONLY write to ${setup.prdWorktreePath}/_bmad-output/implementation-artifacts/sprint-status.yaml.
- The bmad-retrospective skill is the SOLE writer of the retro key status and action_items.
- DO NOT manually edit action_items.`,
        { label: `retro-${epicKey}-${timestamp}`, phase: 'Epic boundary', schema: {
          type: 'object',
          properties: {
            epicKey: { type: 'string' },
            retroDone: { type: 'boolean' },
            committed: { type: 'boolean' },
            pushed: { type: 'boolean' },
            actionItemsCount: { type: 'integer' },
          },
          required: ['epicKey', 'retroDone', 'committed'],
        }, agentType: 'general-purpose' }
      );

      log(`Retro for ${epicKey}: done=${retroResult.retroDone} committed=${retroResult.committed}`)
      if (retroResult.retroDone) {
        retrosCompleted.push(epicKey);
      }
    }
    await appendJournal({
      event: 'phase4_retro_complete',
      epics: retrosCompleted,
      attempted: retrosNeeded.length,
    });
  }
} else if (retro) {
  log('Retro requested but no completed epics found; skipping retro')
  await appendJournal({ event: 'phase4_retro_skip', reason: 'no_completed_epics' });
} else {
  log('Retro not requested (--retro not set)')
}

// ============================================================================
// PHASE 5: FINAL REPORT
// ============================================================================
phase('Final report')
log('Generating final report...')
const finalReport = {
  runId: timestamp,
  prdKey: setup.prdKey,
  completed: state.completed,
  blocked: state.blocked,
  skipped: state.skipped,
  awaitingOperator: state.awaitingOperator,
  halts: state.halts,
  iterations: state.iterationCount,
  haltReason: 'final_complete',
}
await writeState(state);
await appendJournal({
  event: 'final_complete',
  completed: state.completed.length,
  blocked: state.blocked.length,
  skipped: state.skipped.length,
  awaitingOperator: state.awaitingOperator.length,
  iterations: state.iterationCount,
});

// ============================================================================
// PHASE 6: CLEANUP (--cleanup flag)
// ============================================================================
phase('Cleanup')
if (cleanup) {
  log(`Removing run dir ${runDir}...`)
  await agent(
    `rm -rf ${runDir}. Return { removed: true, path: "${runDir}" }.

CONSTRAINTS:
- ONLY remove ${runDir}. Verify it has no symlinks that could escape before removing.
- DO NOT touch any file outside ${runDir}.
- If ${runDir} does not exist, return removed=false, path="${runDir}".`,
    { label: `cleanup-${timestamp}`, phase: 'Cleanup', schema: {
      type: 'object',
      properties: {
        removed: { type: 'boolean' },
        path: { type: 'string' },
      },
      required: ['removed', 'path'],
    }, agentType: 'general-purpose' }
  );
} else {
  log('Cleanup not requested (--cleanup not set); run dir preserved at ' + runDir)
}

return finalReport;
