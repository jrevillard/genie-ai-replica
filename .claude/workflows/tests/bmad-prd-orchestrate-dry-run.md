# bmad-prd-orchestrate — End-to-end Dry-Run Test Plan

**Purpose:** Exercise every observable behavior of the `bmad-prd-orchestrate` workflow against a synthetic 3-story epic, verifying state persistence, halt-resume protocol, dep inference, per-story dispatch, and final report generation — **without touching the production repo, real GitLab MRs, or real CI**.

**Scope:** Phases 1 (Setup) + 2 (Plan + dep inference) + 3 (Execute loop, mocked converge) + 4 (sprint-status sync, idempotent) + 5 (Final report). Phase 6 (Cleanup) is exercised by passing `--cleanup` and verifying the run dir is removed.

**Out of scope:** Real CI runs, real MR creation, real `bmad-build-converge` Build/MR/Merge phases. These are mocked.

---

## 1. Prerequisites

| Tool | Required | Why |
|---|---|---|
| `git` | yes | Worktree creation, branch listing |
| `node` | yes | `node --check` syntax validation |
| `python3` | yes | `sprint_plan.py generate --set` (Phase 4.1) |
| `glab` | **only if you want Phase 1 to fully resolve `gitlabProjectId`** | Setup agent calls `glab api projects?simple=true` |
| `WORKFLOW_TOOL` | yes | The Claude Code Workflow tool — drives `bmad-prd-orchestrate.js` |

**Without glab auth:** Phase 1 setup agent will fail to resolve `gitlabProjectId` and return an error → the workflow aborts with `{ aborted: true, stage: 'setup', error: 'setup agent failed' }`. This is itself a useful test signal (verifies the abort path), but for a complete dry-run through Phase 3 you need glab auth.

**Recommended glab setup** (skip if you only want to test the abort path):

```bash
# Authenticate against the test GitLab (any GitLab instance with API access works)
glab auth login --hostname <host>
# Verify
GITLAB_HOST=<host> glab api "projects?search=<any-existing-project>&simple=true" | head
```

---

## 2. Synthetic Test Data Layout

All test data lives under `/tmp/bmad-orchestrate-test/` — **never** inside the repo. The workflow discovers everything via `git worktree list` + path resolution, so the layout must mirror a real PRD worktree.

```
/tmp/bmad-orchestrate-test/
├── fake-repo/                          # synthetic repo root (repoRoot in setup)
│   ├── .git/                           # git init
│   ├── .claude/
│   │   └── workflows/
│   │       ├── bmad-prd-orchestrate.js # COPY of <repo>/.claude/workflows/bmad-prd-orchestrate.js
│   │       └── bmad-build-converge.js  # MOCK (see §2.4)
│   └── .git/worktrees/fake-worktree/   # registered worktree metadata
│
└── fake-worktree/                      # prdWorktreePath — on branch feat/test-prd/prd
    ├── _bmad/
    │   └── custom/
    │       └── issue-tracking.yaml     # synthetic (see §2.2)
    └── _bmad-output/
        ├── planning-artifacts/
        │   └── epics.md                # synthetic (see §2.3)
        └── implementation-artifacts/
            ├── sprint-status.yaml      # synthetic with 3 stories (see §2.1)
            ├── stories/                # minimal per-story spec stubs (see §2.3)
            │   ├── test-1-foo.md
            │   ├── test-2-bar.md
            │   └── test-3-baz.md
            └── orchestrate-runs/dry-run/  # OUTPUT — state.json + journal.jsonl land here
```

### 2.1 sprint-status.yaml

3 stories in a single epic, all `ready-for-dev` (the trigger state). No `depends_on` frontmatter in specs → dep inference produces **zero edges** → clean test of the empty-graph halt path.

```yaml
# /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/sprint-status.yaml
project_key: test-prd
branch: feat/test-prd/prd
spec: _bmad-output/specs/test-prd/SPEC.md
spine: _bmad-output/specs/test-prd/SPINE.md
tracking_started: 2026-09-07
tracking_format_version: 1

epics:
  - id: epic-1
    title: Synthetic dry-run epic
    spec: _bmad-output/planning-artifacts/epics.md#epic-1
    status: backlog
    stories: [1.1, 1.2, 1.3]

development_status:
  epic-1: backlog
  test-1-foo: ready-for-dev
  test-2-bar: ready-for-dev
  test-3-baz: ready-for-dev
```

**Why these canonical keys?** The orchestrator's plan agent (Step 2b) walks `development_status` keys and builds the numeric → canonical lookup by extracting the `X-Y[a-z]?` prefix. Using `test-1-foo`, `test-2-bar`, `test-3-baz` (matching the `X-Y-...` pattern) lets the canonical keys double as the queue entries directly.

### 2.2 issue-tracking.yaml

Must mirror the project's real format (see `_bmad/custom/issue-tracking.yaml`):

```yaml
# /tmp/bmad-orchestrate-test/fake-worktree/_bmad/custom/issue-tracking.yaml
issue_tracking:
  enabled: true
  platform: gitlab
  git_platform: gitlab
  host: opensource.unicc.org          # any GitLab host — glab must be authed against it
  project: un/itu/genie-ai             # any existing project; glab search must return ≥1 match
  worktree_base: .claude/worktrees
  branch_patterns:
    prd: "feat/{prd_key}/prd"
    story: "feat/{prd_key}/{story_key}"
```

**Test-mode shortcut:** if you don't have glab auth and only want to test the abort path, set `host:` to a value that makes `glab api projects?simple=true` fail fast (e.g., `localhost:9999` with no service). Setup agent fails → orchestrator returns `aborted: true`.

### 2.3 epics.md + story stubs

**epics.md** — minimal, one epic with three stories:

```markdown
# /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/planning-artifacts/epics.md

## Epic 1 — Synthetic dry-run epic

### Story 1.1 — test-1-foo
Placeholder story for dry-run.

### Story 1.2 — test-2-bar
Placeholder story for dry-run.

### Story 1.3 — test-3-baz
Placeholder story for dry-run.
```

**Story stubs** — minimal frontmatter, no `depends_on` (so dep inference finds nothing), no body content needed since `inferDeps` is overridden:

```markdown
# /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/stories/test-1-foo.md
---
status: ready-for-dev
story_key: test-1-foo
files: "fake-file-1.txt"
baseline_commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
---
# Story 1.1 — test-1-foo (dry-run stub)
```

Repeat for `test-2-bar.md` and `test-3-baz.md` (vary `files` + `baseline_commit` per story).

**Note:** the orchestrator reads spec files only when `inferDeps=true`. Pass `--no-infer` (or `inferDeps: false`) to skip reading entirely — recommended for the dry-run since we're testing the empty-graph halt path.

### 2.4 Mock bmad-build-converge.js

Phase 3 dispatches `bmad-build-converge` per story. To avoid real CI/MR work, **replace** the file at `<fake-repo>/.claude/workflows/bmad-build-converge.js` with a mock that returns a fixed-shape success response:

```javascript
// /tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-build-converge.js
// MOCK for dry-run only — DO NOT commit this file.
export const meta = {
  name: 'bmad-build-converge-mock',
  description: 'Dry-run mock: returns success without real CI/MR',
  phases: [{ title: 'Mock' }],
};

const storyKey = args.storyKey || 'unknown';
const timestamp = args.timestamp || 'unknown';

// Simulate 1-iteration "converged" outcome. No side effects, no writes.
return {
  converged: true,
  iterations: 1,
  finalSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  mrIid: 0,
  score: 1.0,
  storyKey,
  timestamp,
  _mock: true,
};
```

**Important:** the orchestrator's Phase 3 reads `convergeResult.converged`, `convergeResult.iterations`, `convergeResult.finalSha`, and `convergeResult.aborted`. The mock must populate these. Missing fields → orchestrator marks the story `blocked` with reason `not_converged` (verified behavior, line 503 of `bmad-prd-orchestrate.js`).

---

## 3. Setup Steps (one-time per test machine)

```bash
# 1. Create the directory tree
mkdir -p /tmp/bmad-orchestrate-test/fake-repo/.claude/workflows
mkdir -p /tmp/bmad-orchestrate-test/fake-worktree/_bmad/custom
mkdir -p /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/planning-artifacts
mkdir -p /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/stories
mkdir -p /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs

# 2. Init the fake repo
cd /tmp/bmad-orchestrate-test/fake-repo
git init -b main
git config user.email "dry-run@test.local"
git config user.name "dry-run"
echo "# Fake repo for bmad-prd-orchestrate dry-run" > README.md
git add README.md
git commit -m "initial commit"

# 3. Copy the orchestrator workflow into the fake repo
cp /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/admin-logs-prd/.claude/workflows/bmad-prd-orchestrate.js \
   /tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/

# 4. Write the mock converge (see §2.4 for contents)
#    ... write /tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-build-converge.js

# 5. Create the fake worktree on the test branch
git worktree add -b feat/test-prd/prd /tmp/bmad-orchestrate-test/fake-worktree main

# 6. Write sprint-status.yaml + issue-tracking.yaml + epics.md + 3 spec stubs
#    (paste contents from §2.1 / §2.2 / §2.3)

# 7. Verify discovery path: the setup agent will run `git worktree list --porcelain`
#    from /tmp/bmad-orchestrate-test/fake-repo and must find the worktree on feat/test-prd/prd
cd /tmp/bmad-orchestrate-test/fake-repo
git worktree list --porcelain
# Expected output contains:
#   worktree /tmp/bmad-orchestrate-test/fake-worktree
#   branch refs/heads/feat/test-prd/prd
```

If `git worktree list --porcelain` does NOT show the test branch, Phase 1 will halt at setup. Verify the branch pattern matches `feat/*/prd` exactly.

---

## 4. Invocation

### 4.1 First invocation (no resume, no userChoice) — expected halt at `dep_inference_confirm`

The orchestrator must halt at the dep-inference confirm gate. With `--no-infer`, no graph is built → halt returns empty `inferred`. Without `--no-infer`, the plan agent scans spec bodies for story-key mentions and produces an empty graph for our stubs (no mentions).

```javascript
Workflow({
  scriptPath: '/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-prd-orchestrate.js',
  args: {
    storyKey: 'test-1-foo',   // filtered; should not affect Plan behavior since epic-1 has multiple stories
    prdKey: 'test-prd',        // advisory only — Phase 1 re-derives from worktree branch
    timestamp: 'dry-run',      // run dir suffix + state key
    inferDeps: false,          // SKIP dep scanning → empty graph guaranteed
    hitlEvery: 0,              // DISABLE periodic HITL (test only one halt point)
    hitlFinalOnly: false,
    retro: false,
    retryPolicy: 'once',
    maxIterations: 1,
    cleanup: false,
  },
})
```

**Expected return (workflow tool result):**

```javascript
{
  haltReason: 'dep_inference_confirm',
  context: {
    inferred: [],          // empty — no deps inferred
    storyQueue: ['test-1-foo', 'test-2-bar', 'test-3-baz']
  },
  resumeToken: 'dry-run',
  runDir: '/tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run',
  userOptions: ['confirm_deps', 'proceed_without_inference', 'abort_prd']
}
```

**Verify:** the workflow halted **before** Phase 3 (no `bmad-build-converge` dispatch attempted). The `runDir` exists and contains:

```bash
ls /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run/
# Expected:
#   state.json
#   journal.jsonl

cat /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run/journal.jsonl
# Expected (3 events, in order):
#   {"ts":"dry-run","event":"setup_complete","prdKey":"test-prd"}
#   {"ts":"dry-run","event":"plan_complete","storyQueueSize":3,"inferredEdges":0}
#   {"ts":"dry-run","event":"state_persisted","storyQueueSize":3}

cat /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run/state.json
# Expected: prdKey=test-prd, storyQueue=[3 stories], completed=[], inferred=[]
```

### 4.2 Second invocation (resume with `userChoice='continue'`) — executes all 3 stories

Resume the workflow. `userChoice='continue'` is **not** in the `userOptions` for `dep_inference_confirm`, so the orchestrator hits the "WARNING: unrecognized userChoice" branch (line 254) — this persists state, then falls through to Phase 3.

```javascript
Workflow({
  scriptPath: '/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-prd-orchestrate.js',
  args: {
    storyKey: 'test-1-foo',
    prdKey: 'test-prd',
    timestamp: 'dry-run',
    resume: 'dry-run',        // tells Phase 3 to loadState from disk
    userChoice: 'continue',   // falls through (not in confirm_deps options) → Phase 3
    inferDeps: false,
    hitlEvery: 0,             // keep disabled so Phase 3 doesn't re-halt mid-loop
    hitlFinalOnly: false,
    retro: false,
    retryPolicy: 'once',
    maxIterations: 1,
    cleanup: false,
  },
})
```

**Expected behavior (Phase 3 mock loop):**

The loop iterates 3 times. For each story:
1. Reads sprint-status — finds `ready-for-dev` (not `awaiting-operator`, not `done`).
2. Dep check — empty (no deps in graph) → no skip.
3. Dispatches `bmad-build-converge.js` (the **mock**) — returns `{ converged: true, iterations: 1, finalSha: 'deadbeef...', ... }`.
4. Pushes story key onto `state.completed`.
5. `state.iterationCount % hitlEvery === 0` is never true (hitlEvery=0 disables; check line 511: `hitlEvery > 0 && state.iterationCount % hitlEvery === 0`). With hitlEvery=0, condition is false → no periodic halt.

After all 3 stories:

```javascript
{
  runId: 'dry-run',
  prdKey: 'test-prd',
  completed: ['test-1-foo', 'test-2-bar', 'test-3-baz'],
  blocked: [],
  skipped: [],
  awaitingOperator: [],
  halts: [],
  iterations: 3,
  haltReason: 'final_complete'
}
```

**Verify journal.jsonl now contains 3 dispatch events + 3 converged events + phase transitions:**

```bash
cat /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run/journal.jsonl
# Expected (cumulative — second invocation appends to the same file):
#   {"ts":"dry-run","event":"setup_complete","prdKey":"test-prd"}
#   {"ts":"dry-run","event":"plan_complete","storyQueueSize":3,"inferredEdges":0}
#   {"ts":"dry-run","event":"state_persisted","storyQueueSize":3}
#   {"ts":"dry-run","event":"resume","userChoice":"continue","queueSize":3}
#   {"ts":"dry-run","event":"dispatch","storyKey":"test-1-foo","iteration":1}
#   {"ts":"dry-run","event":"converged","storyKey":"test-1-foo","iteration":1,"iterations":1}
#   {"ts":"dry-run","event":"dispatch","storyKey":"test-2-bar","iteration":2}
#   {"ts":"dry-run","event":"converged","storyKey":"test-2-bar","iteration":2,"iterations":1}
#   {"ts":"dry-run","event":"dispatch","storyKey":"test-3-baz","iteration":3}
#   {"ts":"dry-run","event":"converged","storyKey":"test-3-baz","iteration":3,"iterations":1}
#   {"ts":"dry-run","event":"execute_complete","completed":3,"blocked":0,"skipped":0,"awaitingOperator":0,"halts":0}
#   {"ts":"dry-run","event":"phase4_sprint_status_sync","advanced":3,"advancedEpics":["epic-1"],"committed":true,"pushed":true}
#   {"ts":"dry-run","event":"final_complete","completed":3,"blocked":0,"skipped":0,"awaitingOperator":0,"iterations":3}
```

**Phase 4 note:** `phase4_sprint_status_sync` invokes `sprint_plan.py generate --set <key>=done` which **modifies the real sprint-status.yaml inside the fake-worktree** and commits + pushes to the test branch. The fake-repo is local-only (no remote), so `git push` will fail — this is acceptable for the dry-run. To suppress the push failure, either:
- Add a fake remote: `git -C fake-repo remote add origin file:///tmp/bmad-orchestrate-test/fake-remote && git push origin feat/test-prd/prd`
- Or accept the `pushed=false` in the journal event (the sync still commits locally; only the push fails).

The `committed` flag should be `true` even when `pushed=false`.

### 4.3 Third invocation (`--cleanup`) — removes run dir

```javascript
Workflow({
  scriptPath: '/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-prd-orchestrate.js',
  args: {
    storyKey: 'test-1-foo',
    prdKey: 'test-prd',
    timestamp: 'dry-run',
    cleanup: true,           // Phase 6 — rm -rf runDir
    inferDeps: false,
    retro: false,
  },
})
```

Phase 1 aborts (no resume token, no fresh run), but Phase 6 only runs in a successful full execution path. **A true Phase 6 test requires a fresh timestamp** (e.g., `timestamp: 'dry-run-cleanup'`) — see §4.4 below for the alternative.

### 4.4 Full lifecycle test (alternative) — fresh timestamp, no halt, single invocation

For a single-invocation test of the full happy path:

```javascript
Workflow({
  scriptPath: '/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-prd-orchestrate.js',
  args: {
    storyKey: 'test-1-foo',
    prdKey: 'test-prd',
    timestamp: 'dry-run-full',
    inferDeps: false,
    hitlEvery: 0,
    retro: false,
    maxIterations: 1,
    cleanup: true,            // exercise Phase 6 in the same invocation
  },
})
```

**Expected:** halt at `dep_inference_confirm` (same as §4.1). The cleanup flag does NOT bypass halts — it's only invoked after Phase 5. Use the two-invocation flow (§4.1 + §4.2) to exercise the full lifecycle.

For a single-invocation full lifecycle, use `userChoice='proceed_without_inference'` as the **initial** userChoice (it skips the halt and clears `inferred`):

```javascript
Workflow({
  scriptPath: '/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-prd-orchestrate.js',
  args: {
    storyKey: 'test-1-foo',
    prdKey: 'test-prd',
    timestamp: 'dry-run-single',
    inferDeps: false,          // skip inference anyway
    userChoice: 'proceed_without_inference',  // also skip the halt
    hitlEvery: 0,
    retro: false,
    maxIterations: 1,
    cleanup: true,
  },
})
```

This invokes Phases 1 → 2 → 3 (full loop) → 4 → 5 → 6 in one shot. Verify the run dir is removed at the end:

```bash
ls /tmp/bmad-orchestrate-test/fake-worktree/_bmad-output/implementation-artifacts/orchestrate-runs/dry-run-single/
# Expected: ENOENT (cleanup removed it)
```

---

## 5. Verification Checklist

After the dry-run completes, verify each item:

### Phase 1 (Setup)
- [ ] `<runDir>/state.json` exists and contains `prdKey: 'test-prd'`, empty `completed`, `blocked`, `skipped`, `awaitingOperator`, `halts` arrays.
- [ ] `<runDir>/journal.jsonl` starts with `{"event":"setup_complete","prdKey":"test-prd"}`.

### Phase 2 (Plan)
- [ ] `journal.jsonl` second event is `{"event":"plan_complete","storyQueueSize":3,"inferredEdges":0}`.
- [ ] First-invocation halt returned `haltReason: 'dep_inference_confirm'`.
- [ ] `userOptions` is exactly `['confirm_deps', 'proceed_without_inference', 'abort_prd']`.

### Phase 3 (Execute)
- [ ] Each story emits `dispatch` then `converged` journal events (mock returns converged=true).
- [ ] `state.completed` length = 3, in storyQueue order.
- [ ] No `launch_failed`, `blocked`, `skip`, or `halt_merge_conflict` events.
- [ ] No periodic `halt_periodic` events (hitlEvery=0 disables).

### Phase 4 (Epic boundary)
- [ ] `phase4_sprint_status_sync` journal event present.
- [ ] `advanced=3`, `advancedEpics=['epic-1']`, `committed=true`.
- [ ] `sprint-status.yaml` inside the fake-worktree now shows `epic-1: done`, `test-1-foo: done`, `test-2-bar: done`, `test-3-baz: done` (the orchestrator's single-writer commit).
- [ ] `git -C /tmp/bmad-orchestrate-test/fake-worktree log -1` shows the `chore(sprint-status): Phase 4 sync` commit.

### Phase 5 (Final report)
- [ ] `journal.jsonl` ends with `{"event":"final_complete","completed":3,...,"iterations":3}`.
- [ ] `state.json` reflects `completed` array of 3 canonical keys.

### Phase 6 (Cleanup, only with `cleanup: true`)
- [ ] `<runDir>` does not exist after the invocation returns.

### State persistence invariants (across resumes)
- [ ] `state.json` is **the** durable state — after Phase 1 halt, deleting `journal.jsonl` and re-invoking with `resume: 'dry-run'` still loads the plan.
- [ ] `journal.jsonl` is append-only — every event has a monotonically increasing (or stable) timestamp; no event is rewritten.

---

## 6. Failure-Mode Tests (optional but recommended)

Each failure mode is verified by introducing one fault and confirming the orchestrator responds as expected.

### 6.1 No glab auth → Phase 1 aborts

```bash
# Unauth glab (or set GITLAB_HOST to a dead server)
unset GITLAB_HOST
# or: GITLAB_HOST=127.0.0.1:9999  glab api ...
```

Expected: workflow returns `{ aborted: true, stage: 'setup', error: 'setup agent failed' }`. No `state.json` written (the setup agent aborts before `writeState`).

### 6.2 Mock converge throws → Phase 3 marks story blocked

Replace the mock at `/tmp/bmad-orchestrate-test/fake-repo/.claude/workflows/bmad-build-converge.js` with:

```javascript
throw new Error('intentional mock failure');
```

Expected: journal contains `{"event":"launch_failed","storyKey":"test-1-foo",...}`. `state.blocked` contains `{story: 'test-1-foo', reason: 'launch_failed', details: '...'}`. Subsequent stories (`test-2-bar`, `test-3-baz`) still dispatch — the loop is fault-tolerant per design.

### 6.3 Mock returns `converged: false` → story blocked with reason

Modify the mock to return `{ converged: false, escalateReason: 'mock_blocked', iterations: 5, ... }`.

Expected: journal contains `{"event":"blocked","storyKey":"...","reason":"mock_blocked"}`. `state.blocked` contains the entry.

### 6.4 Mock returns `aborted: true` → orchestrator halts with `merge_conflict`

Modify the mock to return `{ converged: true, aborted: 'mock_merge_failed', iterations: 1, ... }`.

Expected: workflow returns `{ haltReason: 'merge_conflict', context: {...}, resumeToken, runDir, userOptions: ['continue', 'retry_blocked', 'skip_blocked', 'abort_prd', 'fix_then_resume'] }`. Journal contains `{"event":"halt_merge_conflict",...}`.

### 6.5 Resume after `merge_conflict` halt with `userChoice: 'retry_blocked'`

Same mock as 6.4. After halt, re-invoke with `resume: 'dry-run'` + `userChoice: 'retry_blocked'`. Expected: blocked story is re-queued at the front of `storyQueue`, blocked array is cleared.

### 6.6 Story already `done` at loop start → skipped (defensive race protection)

Edit `sprint-status.yaml` mid-test: set `test-2-bar: done` before the second invocation. Expected: Phase 3 loop reads `currentStatus.status === 'done'` and pushes the story to `state.completed` **without** dispatching converge.

### 6.7 Story at `awaiting-operator` → parked (not dispatched)

Set `test-2-bar: awaiting-operator` before the second invocation. Expected: story moves from `storyQueue` to `awaitingOperator[]`; loop continues with next story.

### 6.8 `inferDeps: true` + no spec frontmatter → still halts with empty graph

Set `inferDeps: true` (default) and verify the orchestrator scans spec bodies for story-key mentions. With our stubs containing no such mentions, `inferredEdges` is still 0 → same halt.

### 6.9 Dep inference discovers a story-key mention → halts with one edge

Edit `test-2-bar.md` body to contain: "depends on test-1-foo". Expected: `inferredEdges` is 1, halt includes `{story: 'test-2-bar', depends_on: ['test-1-foo']}`. After confirming with `confirm_deps` + matching `confirmedDeps`, Phase 3 dispatches in topological order (`test-1-foo` first, `test-2-bar` waits for it, `test-3-baz` last).

### 6.10 `epicKey` filter

Pass `epicKey: 'epic-2'` (does not exist in our synthetic setup) → expected: empty `storyQueue`, immediate loop exit, no dispatches. Journal records `execute_complete` with `completed=0, blocked=0, ...`.

---

## 7. Cleanup

```bash
rm -rf /tmp/bmad-orchestrate-test
git -C /home/jerome/git_projects/ITU/genie-ai worktree list --porcelain | grep fake-worktree
# (empty — no fake-worktree registered in the repo)
```

No production data is touched.

---

## 8. Known Caveats

1. **Phase 4 commits to a local branch with no remote.** The fake-worktree is a worktree of the local fake-repo. `git push` fails → `pushed=false` in journal. The local commit still lands. To exercise `pushed=true`, add a file:// remote or accept the soft failure.

2. **Setup agent is a `general-purpose` sub-agent.** It uses the Claude API to interpret the prompt. The exact shape of the SETUP_SCHEMA return may vary slightly across model versions — schema validation is enforced by the orchestrator (`if (!setup.prdWorktreePath)`). All required fields are documented in `bmad-prd-orchestrate.js` lines 33-47.

3. **Workflow tool is the Claude Code Workflow primitive.** The invocation shapes above are the canonical form. Actual host syntax may be `Workflow({scriptPath, args})` or `workflow({scriptPath, args})` depending on the harness — both forms are documented in the orchestrator's source.

4. **`hitlEvery` semantics.** `hitlEvery=0` disables periodic halts (line 511: `hitlEvery > 0 && state.iterationCount % hitlEvery === 0`). To test a periodic halt, set `hitlEvery=1` (halts after every story).

5. **Resume token is just the `timestamp` string.** The orchestrator does not implement true cryptographic resume tokens; `timestamp` doubles as both run-dir suffix and resume handle. Picking a unique timestamp per run is essential — colliding timestamps cause state-file races.

6. **The test exercises Phases 1-3 + Phase 4 + Phase 5.** Phase 6 only runs when `cleanup: true` and after a full successful lifecycle (§4.4 alternative). A standalone Phase 6 invocation is not supported by design.

7. **Production `bmad-build-converge` is NOT exercised.** Phase 3 dispatches the mock, not the real converge. To exercise the real converge (and its Build/CI/MR phases), use the project's existing `bmad-build-converge` test plan or a real PRD.