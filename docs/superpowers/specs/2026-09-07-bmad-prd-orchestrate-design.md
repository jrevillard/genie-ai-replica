# bmad-prd-orchestrate — Design Spec

**Date:** 2026-09-07
**Status:** Draft v2 (brainstorming party review — 8 gaps applied, 1 spike confirmed)
**Author:** Brainstorming session (party: John, Winston, Amelia, Mary)

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
| Dependency graph | Epic-level + smart intra-epic inference (default ON with halt-to-confirm at start of Phase 3); per-story `depends_on` override; `--no-infer` to disable inference | Default ON for first run (smart), `--no-infer` for repeatability |
| State persistence | sprint-status.yaml = single source of truth | Mirrors bmad-loop pattern; orchestrator = sole writer |
| Per-run dir | `_bmad-output/implementation-artifacts/orchestrate-runs/<ts>/` containing `state.json` + `journal.jsonl` | Already gitignored pattern; co-located with sprint-status |
| Epic retrospective | Optional via `--retro=true` flag | User-controlled; faster runs by default |
| Re-entry | Resume token + scan-on-resume | Halt output prints token; user invokes with token; orchestrator skips done, retries blocked |
| Single-writer invariant | bmad-build-converge MUST NOT write sprint-status; orchestrator reads → invokes → re-reads → applies transitions | Per bmad-loop design — dev primitive is sprint-status-blind |
| Concurrency | Orchestrator is sole writer of sprint-status; sub-workflow returns outcome; orchestrator applies state changes | Prevents race conditions across nested contexts |
| `awaiting-operator` status | Parked: leave status as-is, skip in loop, surface in final report. NOT done, NOT blocked. | Matches bmad-loop lifecycle semantics |
| Sub-workflow launch failure | Caught, story marked `blocked` with `error: 'launch_failed'`, loop continues | Resilience: one bad story doesn't crash the orchestrator |
| Cross-run CI retry | `--retry-policy=once|always|never` (default `once`) | User-controlled |
| MR conflicts (cross-session) | Halts with `merge_conflict`; future work for parallel mode | v1 = sequential, no in-flight conflicts expected |
| epicKey filter | `epicKey?: string` in interface | Run only one epic per invocation |

## Architecture

```
bmad-prd-orchestrate (workflow)
├── PHASE 1: Setup
│   ├── Discover repo + PRD worktree (git worktree list --porcelain, match feat/*/prd)
│   ├── Read `_bmad/custom/issue-tracking.yaml` for branch patterns + glab config
│   ├── Read sprint-status.yaml for project_key + story statuses
│   ├── Initialize run dir (`_bmad-output/implementation-artifacts/orchestrate-runs/<ts>/`)
│   └── Write state.json: {runId, ts, prdKey, storyQueue, completed, blocked, skipped, awaitingOperator, halts}
│   └── Write journal.jsonl: {"ts":..., "event":"setup_complete", ...}
│
├── PHASE 2: Plan
│   ├── Read all story specs in implementation-artifacts/stories/
│   ├── Build dependency graph:
│   │   - Epic-level: sprint-status.epics[N].depends_on → must be done first
│   │   - Intra-epic default: stories in sprint-status.epics[N].stories order (sequential)
│   │   - Per-story override: spec frontmatter `depends_on: [story-key, ...]`
│   │   - Smart inference (if --no-infer NOT set): agent reads each spec body, extracts mentioned story keys, scans for "depends on story X" phrasing
│   ├── Compute storyQueue: ordered list, deduped, all epics
│   ├── Write deps.json: inferred graph (for audit + user review)
│   └── Halt-to-confirm: present inferred graph to user via halt return. Wait for user choice: "proceed" | "edit_deps" | "skip_inferred"
│
├── PHASE 3: Execute loop (while storyQueue not empty AND haltReason==null)
│   ├── Peek next story from storyQueue
│   ├── Check deps: all `depends_on` entries must be 'done' OR in completed[]
│   ├── If deps unsatisfied: skip (mark in state.skipped[]) + continue
│   ├── If status == 'awaiting-operator': mark in state.awaitingOperator[] + continue (do NOT execute)
│   ├── If deps satisfied:
│   │   ├── TRY: invoke bmad-build-converge sub-workflow via workflow({scriptPath, args}) wrapped in try/catch
│   │   ├── On launch failure: state.blocked.push({storyKey, error: 'launch_failed', details}), continue
│   │   ├── On success: receive {converged, iterations, mrIid, status, ...}
│   │   ├── Apply result:
│   │   │   - converged=true → state.completed.push(storyKey), sprint-status → done (via sprint_plan.py advance)
│   │   │   - converged=false (escalation) → state.blocked.push({storyKey, reason}), sprint-status → blocked
│   │   │   - CI hard-fail → state.halts.push({reason:'ci_hardfail', ...})
│   │   ├── Increment iteration counter
│   │   ├── HITL check: if iterationCount % hitlEvery === 0 → halt for review (return current state)
│   │   ├── Cross-run CI retry: if policy=='never' OR already retried → skip; else retry on next run
│   │   └── Pop story from storyQueue
│   └── Write journal.jsonl: per-story event (start, complete, block, skip, halt)
│
├── PHASE 4: Epic boundary (optional, only if --retro=true)
│   ├── If all stories in current epic are done/blocked/skipped/awaitingOperator:
│   │   ├── Invoke bmad-retrospective sub-workflow on this epic
│   │   └── Halt for user approval before next epic (if --hitl-final-only or hitlEvery boundary)
│
├── PHASE 5: Final report
│   ├── Summarize: completed[], blocked[], skipped[], awaitingOperator[], halts[]
│   ├── MRs created (list of MR iids + statuses)
│   ├── sprint-status state
│   └── Resume token (if halted)
│
└── PHASE 6: Cleanup (only if --cleanup flag)
    └── Remove run dir (state.json + journal.jsonl + deps.json)
```

## HITL Protocol

When orchestrator halts, it returns structured JSON:

```json
{
  "haltReason": "convergence_escalation | ci_hardfail | periodic_review | epic_boundary | dep_broken | merge_conflict | dep_inference_confirm | launch_failure | final_complete",
  "context": {
    "completed": ["5-3-...", "5-4-..."],
    "blocked": ["5-7-..."],
    "skipped": ["5-8-..."],
    "awaitingOperator": ["5-11-..."],
    "currentStory": "5-9-...",
    "inferredDeps": [["5-7", "5-3"], ["5-8", "5-4"], ...]
  },
  "resumeToken": "2026-09-07T15:00:00Z",
  "userOptions": ["continue", "retry_blocked", "skip_blocked", "abort_prd", "fix_then_resume", "confirm_deps"]
}
```

**Resume command** (concrete interface):
```
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-prd-orchestrate.js",
  args: {
    resume: "<token-from-prior-halt>",
    userChoice: "continue" | "retry_blocked" | "skip_blocked" | "abort_prd" | "fix_then_resume" | "confirm_deps",
    confirmedDeps?: {"5-7": ["5-3"], "5-8": ["5-4"]}  // for confirm_deps choice
  }
})
```

## Smart Dep Inference

Within an epic, by default = sequential. But spec content may reveal true deps (e.g., story 5-8 = "contract test for file path vs VL path" — implicitly depends on 5-3 + 5-4). The plan-phase agent reads each spec and proposes explicit `depends_on` entries. User confirms at start of Phase 3 (or auto-accepted in `--no-halt-deps` mode).

Implementation:
1. Plan agent reads each spec in epic order
2. For each story, extracts `depends_on` from frontmatter if present
3. If absent: scans spec body for mentions of other story keys (regex: `\b(\d+-\d+(?:[a-z])?)\b`) and "depends on story X" phrasing
4. Builds graph, writes to deps.json, surfaces to user via halt return
5. User confirms → orchestrator proceeds with confirmed graph

**Default mode**: `--infer-deps` ON, halt at start of Phase 3 for confirmation
**Strict mode**: `--no-infer` — only explicit `depends_on` from spec frontmatter, no halt
**Hybrid**: `--infer-and-confirm` (alias for default) vs `--no-infer` (explicit only)

## Concurrency & Single-Writer Invariant

**Contract**: bmad-build-converge (and any sub-workflow it calls) MUST NOT write `sprint-status.yaml`. Only bmad-prd-orchestrate writes sprint-status.

**Mechanism**:
1. Orchestrator reads sprint-status → captures snapshot before invoking bmad-build-converge
2. bmad-build-converge runs (it can read sprint-status, must NOT write)
3. Orchestrator re-reads sprint-status after sub-workflow return
4. Orchestrator applies state transitions via `sprint_plan.py advance` (idempotent, never-regress, epic-lift)
5. Orchestrator writes run-dir state.json + journal.jsonl (separate from sprint-status)

**Why this matters**: sub-workflow + orchestrator run as separate processes/agents. Without the invariant, both could write to sprint-status simultaneously → race → state corruption. By restricting writes to the orchestrator, the no-races property holds.

## Failure Flow Example

PRD has 10 stories. Story 5-7 escalates after 5 iterations. Remaining: 5-8, 5-9, 5-10, 5-11, 5-12, 6-1, 6-2, 6-3, 6-4.

```
Iteration 1: 5-3 (done)
Iteration 2: 5-4 (done)
Iteration 3: 5-7 (escalated → state.blocked += {storyKey: "5-7", reason: "followup_rec_max_iters"})
Iteration 4: dep-check:
  - 5-8 has depends_on: [5-4] → satisfied → continue → done
  - 5-9 has depends_on: [5-7] (inferred) → BLOCKED → state.blocked += "5-9"
  - 5-10 no deps → continue → done
  - 5-11 depends_on: [5-7] → BLOCKED → state.blocked += "5-11"
  - 5-12 no deps → continue → done
  - epic-6 (6-1..6-4) depends on epic-4 (done) → continue → done
...
HITL checkpoint at iteration N (e.g., every 5): halt, user reviews state
User re-invokes with --resume=<token> --userChoice=retry_blocked → orchestrator retries 5-7 (if user pushed fix commits) OR skips
```

## Interface

```
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-prd-orchestrate.js",
  args: {
    // Scope
    storyKey?: "optional — start from specific story instead of all ready-for-dev",
    epicKey?: "optional — restrict to one epic (e.g., 'epic-5')",
    prdKey?: "optional — override discovery (default: from sprint-status.project_key)",

    // HITL
    hitlEvery?: 0,              // halt every N stories (default: 0 = fully autonomous, no periodic halt)
    hitlFinalOnly?: false,      // halt only at PRD completion

    // Deps
    inferDeps?: true,           // enable smart dep inference (default: true)
    noInfer?: false,            // disable inference, use explicit only (alias: --infer-deps=off)

    // Retro
    retro?: false,              // invoke bmad-retrospective at epic boundaries

    // CI
    retryPolicy?: "once" | "always" | "never",  // default: "once"

    // Re-entry
    resume?: "<run-dir-token>",  // re-entry after halt
    userChoice?: "continue | retry_blocked | skip_blocked | abort_prd | fix_then_resume | confirm_deps",
    confirmedDeps?: { [storyKey]: [depKeys] },  // for confirm_deps choice

    // Pass-through to bmad-build-converge
    maxIterations?: 5,          // per-story cap (default: 5)
  }
})
```

## Files to Create

1. **Workflow script**: `.claude/workflows/bmad-prd-orchestrate.js` (~300 lines JS, Workflow tool runtime)
2. **Skill wrapper**: `.claude/skills/bmad-prd-orchestrate/SKILL.md` (loads workflow + invokes it)
3. **README**: `.claude/workflows/README.md` (documents team convention for `.claude/workflows/`)

## Future Work

- **Parallel inter-story execution**: requires nested worktrees + dedicated merge queue. Not in v1.
- **Cross-PRD orchestration**: bmad-prd-orchestrate runs ONE PRD. Chained-PRD mode = future.
- **Dashboard integration**: live status from `_bmad-output/orchestrate-runs/<ts>/state.json` rendered in a web UI.
- **MR conflict resolution agent**: auto-detects conflicts + suggests rebase plan.

## Spec Self-Review (v2)

- ✅ No placeholders / TBDs
- ✅ Internal consistency (phases, decisions, interface align)
- ✅ Single-writer invariant explicit
- ✅ All 8 party-identified gaps addressed (#1-#9, with #7 deferred to future)
- ✅ Nesting depth spike confirmed (workflow → sub-workflow → agent → Skill chain works)
- ✅ No ambiguity on `awaiting-operator` parking
- ✅ Failure handling has catch block
- ✅ Cross-run retry policy explicit

## Open Questions

None — all design decisions made via brainstorming + party review.
