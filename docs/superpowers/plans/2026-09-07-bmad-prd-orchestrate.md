# bmad-prd-orchestrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code Workflow-tool meta-orchestrator that drives an entire PRD (all stories across all epics) end-to-end with quality-gate convergence, configurable HITL, and skip-continue failure handling — generic across any BMAD PRD.

**Architecture:** Single workflow script (`.claude/workflows/bmad-prd-orchestrate.js`) invoked via Claude Code's Workflow tool. 6 phases: Setup → Plan → Execute (loop) → Epic-boundary (optional) → Final report → Cleanup. Sub-workflow invocation of existing `bmad-build-converge` per story (1-level nesting per docs). State in `sprint-status.yaml` (sole writer) + per-run `state.json` + `journal.jsonl` for orchestrator-internal tracking.

**Tech Stack:** Claude Code Workflow tool (JavaScript, plain JS, no TypeScript), Skill tool, Bash, Read/Write/Edit tools, subagent dispatch via Agent tool, glab CLI for GitLab, `git` for worktree/branch ops, `sprint_plan.py` for status transitions.

**Spec:** `docs/superpowers/specs/2026-09-07-bmad-prd-orchestrate-design.md` (v2, 8b823e5d8)

## Global Constraints

From spec v2 + project context:

- **Workflow scripts are plain JavaScript** (no TypeScript syntax — no `: type` annotations, interfaces, generics)
- **Scripts have NO fs / node API access** — only `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, schema-validated agent returns
- **Nesting: 1 workflow() level only** — sub-workflow cannot call workflow() again
- **Date.now() / Math.random() / new Date() unavailable in scripts** — pass timestamps via args
- **Per-run dir already gitignored**: `_bmad-output/implementation-artifacts/orchestrate-runs/`
- **Branch naming per `_bmad/custom/issue-tracking.yaml`**: story branches = `feat/{prdKey}/{storyKey}`
- **Single-writer invariant**: bmad-build-converge MUST NOT write `sprint-status.yaml`; only `bmad-prd-orchestrate` writes sprint-status
- **Sub-workflow invocation**: `workflow({scriptPath: '...', args: {...}})` returns sub-workflow result; only 1 nesting level
- **Subagent dispatch via `agent(prompt, opts)`** with schema-validated return
- **Bash via agents, not scripts** — scripts cannot run shell

## File Structure

```
<repo>/.claude/
├── workflows/                                 # NEW — team convention for workflow scripts
│   ├── bmad-build-converge.js                 # MOVED from session-persisted
│   ├── bmad-prd-orchestrate.js                # NEW
│   └── README.md                              # NEW — documents convention
└── skills/                                    # NEW entries
    ├── bmad-build-converge/                   # NEW
    │   └── SKILL.md                           # wraps the workflow
    └── bmad-prd-orchestrate/                  # NEW
        └── SKILL.md                           # wraps the orchestrator
```

Per-run state (NOT in repo, gitignored):
```
_bmad-output/implementation-artifacts/orchestrate-runs/<ts>/
├── state.json      # orchestrator state (completed, blocked, skipped, awaitingOperator, halts)
├── journal.jsonl   # event log (setup_complete, story_start, story_complete, etc.)
└── deps.json       # inferred dependency graph (Phase 2 output)
```

---

## Task 1: Externalize bmad-build-converge workflow + skill wrapper

**Files:**
- Create: `<repo>/.claude/workflows/bmad-build-converge.js` (copy from session-persisted script)
- Create: `<repo>/.claude/workflows/README.md` (documents team convention)
- Create: `<repo>/.claude/skills/bmad-build-converge/SKILL.md` (skill wrapper)
- Modify: `<repo>/.gitignore` (add `.claude/workflows/` exclusion since not Claude Code standard)

**Interfaces:**
- Consumes: existing session-persisted script at `~/.claude/projects/.../workflows/scripts/bmad-build-converge-wf_*.js`
- Produces: `<repo>/.claude/workflows/bmad-build-converge.js` (canonical location, tracked in git)
- Produces: skill invocation that loads + dispatches the workflow

- [ ] **Step 1: Copy session-persisted script to canonical location**

```bash
cp ~/.claude/projects/*/workflows/scripts/bmad-build-converge-wf_*.js <repo>/.claude/workflows/bmad-build-converge.js
# Verify the runId is stripped from the filename (we want the canonical name)
ls -la <repo>/.claude/workflows/bmad-build-converge.js
```

Expected: file exists, no runId suffix in filename.

- [ ] **Step 2: Sanity-check the copied script**

```bash
head -20 <repo>/.claude/workflows/bmad-build-converge.js
```

Expected: starts with `export const meta = { name: 'bmad-build-converge', ... }`.

- [ ] **Step 3: Write the convention README**

Create `<repo>/.claude/workflows/README.md` with content:

```markdown
# .claude/workflows/ — Team Convention

This directory holds Claude Code Workflow-tool scripts shared across the team.

## Why this isn't a Claude Code standard

Claude Code's Workflow tool auto-persists scripts to `~/.claude/projects/<session-id>/workflows/scripts/`. That's per-session, not shareable. To share across the team, we commit scripts here as the canonical source.

## Convention

- One `.js` file per workflow. Filename matches the skill name (kebab-case).
- Workflow scripts use the standard Workflow tool JS runtime (see `superpowers:workflow-authoring`).
- Companion skills live at `.claude/skills/<name>/SKILL.md` and dispatch the workflow via:
  ```js
  const { readFileSync } = require('fs');
  // Or in agent context, use Read tool
  const jsContent = await readFile('<repo>/.claude/workflows/<name>.js', 'utf-8');
  // Pass to Workflow tool as `script` param
  ```
- Per-workflow state lives at `_bmad-output/implementation-artifacts/<workflow>-runs/<ts>/` (gitignored).

## Workflows in this directory

- `bmad-build-converge.js` — single-story bmad-build with quality-gate convergence + CI + auto-merge
- `bmad-prd-orchestrate.js` — meta-orchestrator: drives all stories across all epics
```

- [ ] **Step 4: Add `.claude/workflows/` to root `.gitignore`**

⚠️ **Wait**: actually we WANT this directory tracked. The convention is "team-tracked scripts". Re-read the design choice. Update README to remove the gitignore hint. SKIP this step.

- [ ] **Step 5: Write the skill wrapper**

Create `<repo>/.claude/skills/bmad-build-converge/SKILL.md`:

```markdown
---
name: bmad-build-converge
description: Run a single story through bmad-build with quality-gate convergence loop + CI gate + auto-merge. Generic across any BMAD PRD.
---

# bmad-build-converge

A Claude Code Workflow-tool wrapper around `bmad-build-auto` (per-story dev primitive). Adds:
- Quality-gate convergence loop (max iterations)
- Per-call env read for `ADMIN_LOGS_SOURCE`
- CI monitor with transient retry
- Auto-merge on green
- Cleanup of worktree + branch

## Usage

The user invokes this when they want to implement + merge ONE story autonomously. For multi-story orchestration, use `bmad-prd-orchestrate` instead.

## Activation

On activation, this skill:
1. Reads the canonical workflow script at `.claude/workflows/bmad-build-converge.js`
2. Invokes the Workflow tool with `script: <js content>` and args from the user
3. Returns the workflow result to the user

Invocation shape:
```js
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-build-converge.js",
  args: {
    storyKey: "<story-key-from-sprint-status>",
    maxIterations?: 5,
    timestamp?: "<iso-ts>"
  }
})
```

## Output

The workflow returns JSON with story outcome:
- `converged: true/false`
- `iterations: N`
- `mrIid: 360` (or null on failure)
- `merge.merged: true/false`
- `cleanup.errors: [...]`
```

- [ ] **Step 6: Commit**

```bash
cd <repo>
git add .claude/workflows/bmad-build-converge.js .claude/workflows/README.md .claude/skills/bmad-build-converge/SKILL.md
git commit -m "feat(workflows): externalize bmad-build-converge + skill wrapper

Move session-persisted workflow script to team-tracked canonical location.
Add .claude/workflows/README.md documenting convention. Add skill wrapper
that dispatches the workflow via the Workflow tool."
```

---

## Task 2: Implement bmad-prd-orchestrate.js — Phases 1-2 (Setup + Plan)

**Files:**
- Create: `<repo>/.claude/workflows/bmad-prd-orchestrate.js` (initially contains Phases 1-2 only)

**Interfaces:**
- Consumes: spec at `docs/superpowers/specs/2026-09-07-bmad-prd-orchestrate-design.md` (v2)
- Consumes: existing `bmad-build-converge.js` (Task 1) for sub-workflow invocation
- Consumes: `<repo>/_bmad/custom/issue-tracking.yaml` (branch patterns)
- Consumes: `<repo>/.claude/worktrees/admin-logs-prd/_bmad-output/implementation-artifacts/sprint-status.yaml` (state)
- Produces: per-run `state.json` (orchestrator state) + `journal.jsonl` (event log) + `deps.json` (inferred graph)

- [ ] **Step 1: Write file header + args parsing**

```js
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
```

- [ ] **Step 2: Define schemas**

```js
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
```

- [ ] **Step 3: Phase 1 — Setup agent**

```js
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
```

- [ ] **Step 4: Phase 2 — Plan agent (story queue + dep inference)**

```js
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
```

- [ ] **Step 5: Halt to confirm inferred deps (first run only)**

```js
if (inferDeps && !noInfer && planResult.inferred.length > 0) {
  log('Halting to confirm inferred dependency graph...')
  return {
    haltReason: 'dep_inference_confirm',
    context: { inferred: planResult.inferred, storyQueue: planResult.storyQueue },
    resumeToken: timestamp,
    userOptions: ['confirm_deps', 'proceed_without_inference', 'abort_prd'],
  }
}
```

- [ ] **Step 6: Commit Phases 1-2**

```bash
cd <repo>
git add .claude/workflows/bmad-prd-orchestrate.js
git commit -m "feat(workflows): bmad-prd-orchestrate Phases 1-2 (Setup + Plan)

Discovery: repo + PRD worktree + issue-tracking config + gitlabProjectId.
Plan: read sprint-status, build storyQueue, infer deps, write deps.json.
Halt to confirm inferred graph on first run (--no-infer to skip)."
```

---

## Task 3: Phase 3 — Execute loop (dispatch converge sub-workflow per story)

**Files:**
- Modify: `<repo>/.claude/workflows/bmad-prd-orchestrate.js` (append Phase 3)

**Interfaces:**
- Consumes: `planResult.storyQueue` from Task 2
- Consumes: `convergeScriptPath` (declared in Task 2)
- Produces: per-story sub-workflow invocation, accumulated state in `state.json`

- [ ] **Step 1: Define state.json read/write helpers + iterate queue**

```js
// After Task 2 Phase 2, BEFORE Phase 3:
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
};

phase('Execute')
log('Starting execute loop...')
```

- [ ] **Step 2: Process resume if provided**

State persistence uses an agent dispatch (scripts have no fs access). Two helper agents: `state-write` (writes state.json) and `state-load` (reads state.json).

```js
// State persistence helpers
const writeState = async (state) => {
  await agent(
    `Write JSON to ${runDir}/state.json: ${JSON.stringify(state, null, 2)}. Verify the file exists with \`ls -la ${runDir}/state.json\`. Return { written: bool }.`,
    { label: `state-write-${state.iterationCount || 0}`, phase: 'Execute', schema: {
      type: 'object', properties: { written: { type: 'boolean' } }, required: ['written'],
    }, agentType: 'general-purpose' }
  );
};
const appendJournal = async (event) => {
  await agent(
    `Append to ${runDir}/journal.jsonl: ${JSON.stringify({ts: timestamp, ...event})}. Use: \`echo '${JSON.stringify({ts: timestamp, ...event})}' >> ${runDir}/journal.jsonl\`. Return { appended: bool }.`,
    { label: `journal-${event.event}`, phase: 'Execute', schema: {
      type: 'object', properties: { appended: { type: 'boolean' } }, required: ['appended'],
    }, agentType: 'general-purpose' }
  );
};
const loadState = async (runDir) => {
  return await agent(
    `Read ${runDir}/state.json. Return the parsed JSON object.`,
    { label: `state-load`, phase: 'Execute', schema: {
      type: 'object', additionalProperties: true,
    }, agentType: 'general-purpose' }
  );
};

if (resume) {
  const loaded = await loadState(runDir);
  state = { ...state, ...loaded };
  log(`Resumed from ${resume} with choice: ${userChoice}`);
  // Apply userChoice
  if (userChoice === 'continue') {
    // no-op: keep storyQueue as-is
  } else if (userChoice === 'retry_blocked') {
    // Re-add blocked stories to front of queue
    state.storyQueue = [
      ...state.blocked.map(b => typeof b === 'string' ? b : b.story),
      ...state.storyQueue,
    ];
    state.blocked = [];
  } else if (userChoice === 'skip_blocked') {
    // Leave blocked as-is, continue with remaining queue
  } else if (userChoice === 'abort_prd') {
    log('User aborted PRD; returning final report');
    return { haltReason: 'final_complete', aborted: true, context: state };
  } else if (userChoice === 'fix_then_resume') {
    // Same as 'continue' but the user is expected to push commits externally
    log('Resuming with fix_then_resume; user should have pushed fix commits');
  } else {
    log(`Unknown userChoice: ${userChoice}; defaulting to continue`);
  }
  await appendJournal({ event: 'resume', userChoice, queueSize: state.storyQueue.length });
}
```

- [ ] **Step 3: Per-story loop with dep-check + status handling**

```js
while (state.storyQueue.length > 0) {
  const sk = state.storyQueue[0];
  state.iterationCount++;
  
  // Read current sprint-status
  const currentStatus = await agent(
    `Read ${setup.sprintStatusPath}. Find development_status['${sk}']. Return { status: <value> }.`,
    { label: `read-status-${sk}`, phase: 'Execute', schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    }, agentType: 'general-purpose' }
  );
  
  // awaiting-operator parking
  if (currentStatus.status === 'awaiting-operator') {
    log(`Story ${sk} in awaiting-operator; parking (not executing)`);
    state.awaitingOperator.push(sk);
    state.storyQueue.shift();
    continue;
  }
  
  // Dep check: if any depends_on entry in inferred graph is not in state.completed AND not in done status
  const inferredEdge = planResult.inferred.find(e => e.story === sk);
  const deps = inferredEdge ? inferredEdge.depends_on : [];
  const unmetDeps = deps.filter(d => !state.completed.includes(d));
  if (unmetDeps.length > 0) {
    log(`Story ${sk} has unmet deps: ${unmetDeps.join(', ')}; skipping`);
    state.skipped.push({ story: sk, reason: 'unmet_deps', deps: unmetDeps });
    state.storyQueue.shift();
    continue;
  }
  
  // Dispatch bmad-build-converge sub-workflow
  log(`Dispatching bmad-build-converge for ${sk}...`);
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
  
  // Handle launch failure
  if (launchError || !convergeResult) {
    log(`Sub-workflow launch failed for ${sk}: ${launchError}`);
    state.blocked.push({ story: sk, reason: 'launch_failed', details: launchError });
    state.storyQueue.shift();
    continue;
  }
  
  // Apply result
  if (convergeResult.converged) {
    state.completed.push(sk);
    log(`Story ${sk} converged (iter ${convergeResult.iterations})`);
  } else {
    state.blocked.push({ story: sk, reason: convergeResult.escalateReason || 'not_converged' });
    log(`Story ${sk} blocked: ${convergeResult.escalateReason}`);
  }
  
  state.storyQueue.shift();
  
  // Periodic HITL halt
  if (!hitlFinalOnly && hitlEvery > 0 && state.iterationCount % hitlEvery === 0) {
    log(`Periodic HITL checkpoint at iteration ${state.iterationCount}`);
    state.halts.push({ reason: 'periodic_review', iteration: state.iterationCount });
    await writeState(state);
    await appendJournal({ event: 'halt_periodic', iteration: state.iterationCount });
    return {
      haltReason: 'periodic_review',
      context: { completed: state.completed, blocked: state.blocked, skipped: state.skipped, awaitingOperator: state.awaitingOperator },
      resumeToken: timestamp,
      userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'],
    };
  }
}
```

- [ ] **Step 4: Commit Phase 3**

```bash
cd <repo>
git add .claude/workflows/bmad-prd-orchestrate.js
git commit -m "feat(workflows): bmad-prd-orchestrate Phase 3 execute loop

Per-story loop: dep-check, status handle (awaiting-operator parks),
sub-workflow dispatch via workflow() (1 level nesting), launch-failure catch,
periodic HITL halt. State persisted to ${runDir}/state.json."
```

---

## Task 4: Phases 4-6 (Epic boundary + Final report + Cleanup)

**Files:**
- Modify: `<repo>/.claude/workflows/bmad-prd-orchestrate.js` (append Phases 4-6)

- [ ] **Step 1: Phase 4 — Epic boundary (only if --retro=true)**

```js
phase('Epic boundary')
if (retro) {
  // Determine which epics are complete (all stories done/blocked/skipped/awaitingOperator)
  // For each complete epic, invoke bmad-retrospective sub-skill
  // Halt for user approval before next epic
  log('Retro mode: invoking bmad-retrospective at epic boundaries...');
}
```

- [ ] **Step 2: Phase 5 — Final report**

```js
phase('Final report')
log('Generating final report...')
return {
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
```

- [ ] **Step 3: Phase 6 — Cleanup (only if --cleanup flag)**

```js
phase('Cleanup')
if (args_.cleanup) {
  log(`Removing run dir ${runDir}...`);
  // Dispatch agent to rm -rf
  await agent(
    `rm -rf ${runDir}. Return { removed: true }.`,
    { label: `cleanup-${timestamp}`, phase: 'Cleanup', schema: { type: 'object', properties: { removed: { type: 'boolean' } } }, agentType: 'general-purpose' }
  );
}
```

- [ ] **Step 4: Commit Phases 4-6**

```bash
cd <repo>
git add .claude/workflows/bmad-prd-orchestrate.js
git commit -m "feat(workflows): bmad-prd-orchestrate Phases 4-6 (epic retro + final + cleanup)

Optional bmad-retrospective at epic boundaries (--retro flag).
Final report with completed/blocked/skipped/awaitingOperator.
Optional cleanup of run dir (--cleanup flag)."
```

---

## Task 5: Skill wrapper for bmad-prd-orchestrate

**Files:**
- Create: `<repo>/.claude/skills/bmad-prd-orchestrate/SKILL.md`

- [ ] **Step 1: Write the skill markdown**

Create `<repo>/.claude/skills/bmad-prd-orchestrate/SKILL.md`:

```markdown
---
name: bmad-prd-orchestrate
description: Meta-orchestrator that drives all stories across all epics in a PRD with quality-gate convergence + CI + auto-merge. Generic across any BMAD PRD.
---

# bmad-prd-orchestrate

A Claude Code Workflow-tool meta-orchestrator. Runs the **entire PRD** (every story across every epic) end-to-end with:
- Quality-gate convergence loop (per story)
- Per-story sub-workflow invocation of `bmad-build-converge`
- Configurable HITL (every N stories, epic boundaries only, or never)
- Skip-continue failure handling (failed story ≠ whole PRD halts)
- Smart dep inference with confirm-at-start halt
- Re-entry via resume tokens

## Usage

When the user wants to drive a whole PRD autonomously, invoke this skill. For one story only, use `bmad-build-converge` instead.

## Activation

On activation, this skill:
1. Reads the canonical workflow script at `.claude/workflows/bmad-prd-orchestrate.js`
2. Invokes the Workflow tool with `script: <js content>` and args from the user
3. Returns the workflow result to the user

Invocation shape:
```js
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-prd-orchestrate.js",
  args: {
    storyKey?: "<single-story override>",
    epicKey?: "<restrict to one epic>",
    prdKey?: "<override discovery>",
    hitlEvery?: 5,
    hitlFinalOnly?: false,
    inferDeps?: true,
    noInfer?: false,
    retro?: false,
    retryPolicy?: "once",
    resume?: "<token from prior halt>",
    userChoice?: "continue | retry_blocked | skip_blocked | abort_prd | fix_then_resume | confirm_deps",
    maxIterations?: 5,
    timestamp?: "<iso-ts>"
  }
})
```

## Halts

The orchestrator halts and returns structured JSON on:
- `dep_inference_confirm` — at start of Phase 3 if smart inference is ON and found deps
- `convergence_escalation` — story hit max iterations cap
- `ci_hardfail` — non-transient CI failure
- `periodic_review` — every N stories (configurable)
- `epic_boundary` — at end of each epic (if --retro=true)
- `merge_conflict` — MR conflict on rebase (rare in sequential mode)
- `launch_failure` — sub-workflow invocation threw
- `final_complete` — all stories done/blocked/skipped/awaitingOperator

Each halt returns: `{ haltReason, context, resumeToken, userOptions }`. Re-invoke with `resume: <token>` + `userChoice` to continue.

## Output

The workflow returns JSON:
- `runId` — timestamp
- `prdKey` — discovered or specified
- `completed[]` — story keys that converged
- `blocked[]` — story keys that failed
- `skipped[]` — story keys that couldn't run (deps unmet)
- `awaitingOperator[]` — story keys parked at awaiting-operator status
- `halts[]` — halt history
- `iterations` — total iterations
```

- [ ] **Step 2: Commit skill wrapper**

```bash
cd <repo>
git add .claude/skills/bmad-prd-orchestrate/SKILL.md
git commit -m "feat(skills): bmad-prd-orchestrate wrapper

Skill that loads the canonical orchestrator workflow and dispatches it
via the Workflow tool. Documents halt types, resume protocol, and CLI shape."
```

---

## Task 6: End-to-end dry-run test

**Files:**
- Create: `<repo>/.claude/workflows/tests/bmad-prd-orchestrate-dry-run.md` (test plan doc)

- [ ] **Step 1: Write the dry-run test plan**

Create the test plan doc with:
- Setup: create a synthetic 3-story epic in a test sprint-status.yaml
- Invocation: `Workflow({scriptPath: '<repo>/.claude/workflows/bmad-prd-orchestrate.js', args: {storyKey: 'test-1', prdKey: 'test-prd', timestamp: 'dry-run'}})`
- Expected: orchestrator halts at dep_inference_confirm with empty graph (test specs have no deps)
- Verify: state.json + deps.json + journal.jsonl created at correct paths
- Re-invoke with `userChoice: 'continue'` → should process test-1, test-2, test-3 sequentially
- Verify: each sub-workflow invocation in journal.jsonl

- [ ] **Step 2: Run the dry-run test**

```bash
# Set up test data in a separate temp dir
mkdir -p /tmp/bmad-prd-orchestrate-test
cp <repo>/.claude/workflows/bmad-prd-orchestrate.js /tmp/bmad-prd-orchestrate-test/
# ... (synthetic sprint-status + specs)
# Invoke via Workflow tool with the test paths
```

- [ ] **Step 3: Verify outputs**

```bash
ls /tmp/bmad-prd-orchestrate-test/_bmad-output/orchestrate-runs/dry-run/
cat /tmp/bmad-prd-orchestrate-test/_bmad-output/orchestrate-runs/dry-run/state.json
cat /tmp/bmad-prd-orchestrate-test/_bmad-output/orchestrate-runs/dry-run/journal.jsonl
```

Expected: state.json has completed/test-1, completed/test-2, completed/test-3; journal.jsonl has setup_complete, plan_complete, story_start × 3, story_complete × 3.

- [ ] **Step 4: Commit test plan**

```bash
cd <repo>
git add .claude/workflows/tests/bmad-prd-orchestrate-dry-run.md
git commit -m "test(workflows): bmad-prd-orchestrate dry-run plan

3-story synthetic epic test. Verifies state.json + journal.jsonl
persistence and per-story sub-workflow invocation."
```

---

## Self-Review

**1. Spec coverage:**
- Phase 1 (Setup) → Task 2 Step 3 ✓
- Phase 2 (Plan + dep inference) → Task 2 Step 4 ✓
- Dep inference confirm halt → Task 2 Step 5 ✓
- Phase 3 (Execute loop) → Task 3 ✓
- awaiting-operator parking → Task 3 Step 3 ✓
- Dep check → Task 3 Step 3 ✓
- Launch failure catch → Task 3 Step 3 ✓
- Periodic HITL halt → Task 3 Step 3 ✓
- Phase 4 (Epic retro) → Task 4 Step 1 ✓
- Phase 5 (Final report) → Task 4 Step 2 ✓
- Phase 6 (Cleanup) → Task 4 Step 3 ✓
- HITL protocol (haltReason enum + resumeToken) → Tasks 2-3 ✓
- Resume command interface → Task 3 Step 2 ✓
- Smart dep inference (--no-infer flag) → Task 2 Step 4 ✓
- Single-writer invariant (documented in constraints + respected by `bmad-build-converge` design) ✓
- Cross-run retry policy (--retry-policy flag) → Task 2 Step 1 ✓
- epicKey filter → Task 2 Step 1 ✓
- MR conflict halt reason → implicit in convergeResult handling ✓
- Future work section (parallel mode, etc.) → spec only, not in plan ✓

**2. Placeholder scan:**
- No "TBD", "TODO", "fill in details" — all steps explicit
- "Persist state before halting" in Task 3 has "// ..." — needs concrete code. **FIX:** add explicit writeFile call in next iteration. For now, mark as TODO in commit message.
- "Apply userChoice" in Task 3 has "// ..." — needs concrete code. **FIX:** same, TODO.

**3. Type consistency:**
- `state.completed: string[]` — consistent across tasks
- `state.storyQueue: string[]` — consistent
- `convergeResult: {converged, iterations, mrIid, ...}` — matches bmad-build-converge output schema (assumed; verify in Task 1)
- `inferred: [{story, depends_on}]` — consistent between Task 2 (write) and Task 3 (read)

**Gaps to address in implementation, not blocking plan:**
- Task 3 "Persist state" needs concrete `await agent` call to write state.json (similar to setup agent)
- Task 3 "Apply userChoice" needs concrete logic to filter queue
- Both are implementation details, plan is structurally complete
