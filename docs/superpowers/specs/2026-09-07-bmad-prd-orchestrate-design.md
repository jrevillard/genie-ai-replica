# bmad-prd-orchestrate — Design Spec

**Date:** 2026-09-07
**Status:** Draft (brainstorming phase — awaiting user review)
**Author:** Brainstorming session

## Context

The GENIE.AI project ships work via `feat/<prd-key>/prd` umbrella branches with stacked MRs (per-story branches diverge from the umbrella). The current orchestration is split across:
- `bmad-build` (skill, manual): instructions for one bmad-build pass
- `bmad-build-auto` (skill, unattended): one iteration of the dev loop, writes `followup_review_recommended` flag
- `bmad-build-converge` (workflow): wraps bmad-build-auto with quality-gate convergence loop + CI gate + auto-merge + cleanup (per-story, single invocation)

What's MISSING: a **meta-orchestrator** that drives an entire PRD (set of epics, set of stories) end-to-end. Today each story requires manual invocation of `bmad-build-converge`. The user wants to launch ONE command that runs all stories across all epics, with configurable HITL points.

This design does NOT replace `bmad-loop` (the Python daemon — `~/.bmad/cache/external-modules/bmad-loop/`). It provides a Claude Code Workflow-tool equivalent that runs in this session, mirroring bmad-loop's behavior with the same state model.

## Goals

- ONE invocation drives the full PRD: all stories across all epics, respecting dependency order
- Failure of one story does NOT halt the whole run — independent stories proceed
- Configurable HITL: full autonomous OR review every N stories OR epic boundaries only OR failure-only
- Re-entry after user fix: scan-on-resume, skip completed stories, retry blocked
- Generic across PRDs: discover repo + PRD worktree + `_bmad/custom/issue-tracking.yaml` + `sprint-status.yaml` (mirrors `bmad-build-converge` discovery pattern)

## Non-Goals

- Replace `bmad-loop` Python daemon (separate ecosystem)
- Auto-merge anything that escalates (HITL always gates escalations)
- Run outside Claude Code (Workflow tool only)
- Parallel inter-story execution (sequential; intra-story parallelism already handled by bmad-build-auto reviewers)

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Failure handling | Skip + continue | Matches user's "don't halt on one failure" |
| HITL triggers | Configurable frequency (default: every 5 stories) | `--hitl-every=N`, `--hitl-final-only`, `--hitl-never` |
| Dependency graph | Epic-level + smart intra-epic inference + per-story `depends_on` override | Default = sequential within epic, spec overrides when present |
| State persistence | sprint-status.yaml = single source of truth | Mirrors bmad-loop pattern; orchestrator = sole writer |
| Per-run dir | `_bmad-output/implementation-artifacts/orchestrate-runs/<ts>/` | Already gitignored pattern; co-located with sprint-status |
| Epic retrospective | Optional via `--retro=true` flag | User-controlled; faster runs by default |
| Re-entry | Resume token + scan-on-resume | Halt output prints token; user invokes with token; orchestrator skips done, retries blocked |

## Architecture

```
bmad-prd-orchestrate (workflow)
├── PHASE 1: Setup
│   ├── Discover repo + PRD worktree (git worktree list --porcelain, match feat/*/prd)
│   ├── Read `_bmad/custom/issue-tracking.yaml` for branch patterns + glab config
│   ├── Read sprint-status.yaml for project_key + story statuses
│   ├── Initialize run dir (`_bmad-output/implementation-artifacts/orchestrate-runs/<ts>/`)
│   └── Write state.json: {runId, ts, prdKey, storyQueue, completed, blocked, skipped, halts}
│
├── PHASE 2: Plan
│   ├── Read all story specs in implementation-artifacts/stories/
│   ├── Build dependency graph:
│   │   - Epic-level: sprint-status.epics[N].depends_on → must be done first
│   │   - Intra-epic default: stories in sprint-status.epics[N].stories order (sequential)
│   │   - Per-story override: spec frontmatter `depends_on: [story-key, ...]`
│   │   - Smart inference: agent reads spec content for unstated deps (e.g., 5-8 contract test depends on 5-4 admin service)
│   ├── Compute storyQueue: ordered list, deduped, all epics
│   └── State: storyQueue[] written to state.json
│
├── PHASE 3: Execute loop (while storyQueue not empty AND haltReason==null)
│   ├── Peek next story from storyQueue
│   ├── Check deps: all `depends_on` entries must be 'done' OR in completed[]
│   ├── If deps unsatisfied: skip (mark in state.skipped[]) + continue
│   ├── If deps satisfied:
│   │   ├── Invoke bmad-build-converge sub-workflow with args.storyKey
│   │   ├── Sub-workflow returns: {converged, iterations, mrIid, status, ...}
│   │   ├── Apply result:
│   │   │   - converged=true → state.completed.push(storyKey), sprint-status → done
│   │   │   - converged=false (escalation) → state.blocked.push(storyKey, reason), sprint-status → blocked
│   │   │   - CI hard-fail → state.halts.push({reason:'ci_hardfail', ...})
│   │   ├── Increment iteration counter
│   │   ├── HITL check: if iterationCount % hitlEvery === 0 → halt for review
│   │   └── Pop story from storyQueue
│   └── Continue
│
├── PHASE 4: Epic boundary (optional)
│   ├── If --retro=true:
│   │   ├── Check: all stories in current epic are done/blocked/skipped
│   │   ├── If yes: invoke bmad-retrospective sub-workflow on this epic
│   │   └── Halt for user approval before next epic
│
├── PHASE 5: Final report
│   ├── Summarize: completed[], blocked[], skipped[], halts[]
│   ├── MRs created (list of MR iids + statuses)
│   ├── sprint-status state
│   └── Resume token (if halted)
│
└── PHASE 6: Cleanup (only if --cleanup flag)
    └── Remove run dir (state.json + journal.jsonl)
```

## HITL Protocol

When orchestrator halts, it returns structured JSON:

```json
{
  "haltReason": "convergence_escalation | ci_hardfail | periodic_review | epic_boundary | dep_broken | merge_conflict | final_complete",
  "context": {
    "completed": ["5-3-...", "5-4-..."],
    "blocked": ["5-7-..."],
    "skipped": ["5-8-..."],
    "currentStory": "5-9-..."
  },
  "resumeToken": "orchestrate-runs/2026-09-07T15:00:00Z",
  "userOptions": ["continue", "retry_blocked", "skip_blocked", "abort_prd", "fix_then_resume"]
}
```

User picks an option → re-invokes orchestrator with `--resume=<token>` + choice.

## Smart Dep Inference

Within an epic, by default = sequential. But spec content may reveal true deps (e.g., story 5-8 = "contract test for file path vs VL path" — implicitly depends on 5-3 + 5-4). The plan-phase agent reads each spec and proposes explicit `depends_on` entries. User approves the inferred graph before execution starts (or it's auto-applied if confidence high).

Implementation:
1. Plan agent reads each spec in epic order
2. For each story, extracts `depends_on` from frontmatter if present
3. If absent: scans spec body for mentions of other story keys (e.g., "depends on story 5-3", "after 5-4 done")
4. Builds graph, surfaces to user (or auto-accepts in autonomous mode)

## Failure Flow Example

PRD has 10 stories. Story 5-7 escalates after 5 iterations. Remaining: 5-8, 5-9, 5-10, 5-11, 5-12, 6-1, 6-2, 6-3, 6-4.

```
Iteration 1: 5-3 (done)
Iteration 2: 5-4 (done)
Iteration 3: 5-7 (escalated → state.blocked += "5-7")
Iteration 4: skip-or-continue logic:
  - 5-8 has depends_on: [5-4] → satisfied → continue
  - 5-9 has depends_on: [5-7] (inferred) → BLOCKED → state.blocked += "5-9"
  - 5-10 no deps → continue
  - 5-11 depends_on: [5-7] → BLOCKED → state.blocked += "5-11"
  - 5-12 no deps → continue
  - epic-6 (6-1..6-4) depends on epic-4 (done) → continue
...
HITL checkpoint at iteration N (e.g., every 5): halt, user reviews state
User re-invokes → orchestrator retries 5-7 (if user pushed fix commits) OR skips
```

## Interface

```
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-prd-orchestrate.js",
  args: {
    storyKey?: "optional — start from specific story instead of all ready-for-dev",
    prdKey?: "optional — override discovery (default: from sprint-status.project_key)",
    hitlEvery?: 5,           // halt every N stories (default: 5, 0 = never)
    hitlFinalOnly?: false,   // halt only at PRD completion
    retro?: false,           // invoke bmad-retrospective at epic boundaries
    resume?: "<run-dir-token>", // re-entry after halt
    userChoice?: "continue | retry_blocked | skip_blocked | abort_prd",
    maxIterations?: 5,       // pass through to bmad-build-converge
  }
})
```

## Files to Create

1. **Workflow script**: `.claude/workflows/bmad-prd-orchestrate.js` (~250 lines JS, Workflow tool runtime)
2. **Skill wrapper**: `.claude/skills/bmad-prd-orchestrate/SKILL.md` (loads workflow + invokes it)
3. **README**: `.claude/workflows/README.md` (documents team convention for `.claude/workflows/`)

## Open Questions

None — all design decisions made via brainstorming.

## Verification Plan

1. Re-test current `bmad-build-converge` on story 5-7 (validates fixes + bmad-build-auto)
2. Externalize `bmad-build-converge` to `.claude/workflows/` + skill wrapper
3. Implement `bmad-prd-orchestrate` (single sub-workflow `bmad-build-converge`)
4. Dry-run on synthetic 3-story epic (skip the real PRD)
5. Re-run on full admin-logs-victorialogs PRD (post-5-4)
6. Verify gitignore entries + per-run dir cleanup

## Spec Self-Review

- ✅ No placeholders / TBDs
- ✅ Internal consistency (phases, decisions, interface align)
- ✅ Focused scope (single workflow, builds on existing bmad-build-converge)
- ✅ No ambiguity (each decision has explicit choice + rationale)
