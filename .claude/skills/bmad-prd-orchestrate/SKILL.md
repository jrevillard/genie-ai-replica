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

## Activation

On activation, this skill:

1. **Configuration Q&A** (see below) — collects all args from the user
2. Invokes the Workflow tool with `scriptPath: <repo>/.claude/workflows/bmad-prd-orchestrate.js` and the collected args
3. Handles the result:
   - On halt (resume token returned): asks the user which `userChoice` to apply, then re-invokes with `resume` + `userChoice`
   - On completion: reports the final state and stops

The user never touches the Workflow tool directly — the skill wraps it.

## Invocation Shape

```js
Workflow({
  scriptPath: "<repo>/.claude/workflows/bmad-prd-orchestrate.js",
  args: { /* collected from Q&A */ }
})
```

## Configuration Q&A

Ask these questions in order. Default values are sensible — user can just accept defaults.

### 1. Scope (REQUIRED)
What to orchestrate?
- **All remaining stories** in the PRD (default if no epic/story filter)
- **One epic only** — provide `epicKey` (e.g. "epic-6")
- **One story only** — provide `storyKey` (canonical key from sprint-status)

### 2. PRD override (ADVANCED, optional)
Usually auto-discovered from the worktree. Override only if:
- Multiple PRD worktrees exist and you want a specific one
- The default discovery picked the wrong PRD

Provide `prdKey` (e.g. "admin-logs-victorialogs"). Skip = auto-discover.

### 3. HITL cadence
When should the workflow halt for human review?
- **Never** (autonomous) — `hitlEvery: 0` (default)
- **Every N stories** — provide `hitlEvery: N` (e.g. 5)
- **Epic boundaries only** — `hitlFinalOnly: false` + `retro: true`
- **Final only** (halt at end of all stories) — `hitlFinalOnly: true`

### 4. Dependency inference
Should the workflow infer dependencies between stories?
- **On + confirm at start** (default, recommended) — workflow halts with inferred graph, you confirm
- **Off** — start immediately, no dep checks (`noInfer: true`)
- **On, proceed without confirming** — infer but don't halt (`inferDeps: true` + handle via resume)

### 5. Retrospectives at epic boundaries
Should the skill invoke `bmad-retrospective` after each epic completes?
- **No** (default) — `retro: false`
- **Yes** — `retro: true`

### 6. CI hard-fail retry policy
When a story hits `ci_hardfail`, should the workflow re-queue it?
- **Once per run** (default) — `retryPolicy: "once"`. Each halt entry marked `retried=true` after first retry.
- **Always** — `retryPolicy: "always"`. Re-queue on every resume until success.
- **Never** — `retryPolicy: "never"`. Story stays blocked.

### 7. Max iterations per story
How many build-review iterations before escalation?
- Default: **5** (`maxIterations: 5`)
- Override: provide `maxIterations: N`

### 8. Resume from prior halt?
- **Fresh run** — provide a unique `timestamp` (default: current ISO timestamp with random suffix)
- **Resume** — provide `resume: <token from prior halt>` + `userChoice: <see below>`

If resuming, ask:

#### 8a. Resume userChoice
Which action to take on the halted run?
- `continue` — proceed with current state
- `retry_blocked` — re-queue blocked stories at front of queue
- `skip_blocked` — leave blocked as-is
- `abort_prd` — terminate run
- `fix_then_resume` — operator pushed fix externally; workflow resets status to ready-for-dev
- `confirm_deps` — accept the inferred dep graph (requires `confirmedDeps`)
- `proceed_without_inference` — clear inferred graph, start fresh
- `proceed_retro` / `skip_retro` — epic retro decisions

## Halts the Workflow Returns

| haltReason | Meaning | userChoice options |
|------------|---------|-------------------|
| `dep_inference_confirm` | At start, inferred deps need confirmation | `confirm_deps`, `proceed_without_inference`, `abort_prd` |
| `convergence_escalation` | Story hit max iterations cap | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `ci_hardfail` | Non-transient CI failure | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `merge_blocked` | Merge step rejected | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `periodic_review` | Every N stories (configurable) | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `epic_retro` | Epic boundary, retro needs approval | `proceed_retro`, `skip_retro`, `abort_prd` |
| `merge_conflict` | MR conflict on rebase (rare) | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `launch_failure` | Sub-workflow threw | `continue`, `retry_blocked`, `skip_blocked`, `abort_prd`, `fix_then_resume` |
| `fix_then_resume_push_failed` | Status reset push failed | `continue`, `retry_blocked`, `abort_prd` |
| `fix_then_resume_sha_verify_failed` | SHA mismatch after push | `continue`, `retry_blocked`, `abort_prd` |
| `final_complete` | All stories done/blocked/skipped/awaitingOperator | (terminal — run is done) |

Each halt returns: `{ haltReason, context, resumeToken, userOptions }`. The skill re-prompts the user with these options automatically.

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

The skill surfaces this to the user when the workflow completes.

## Examples

### Run epic 6 autonomously
```
User: /bmad-prd-orchestrate epic-6
Skill asks: scope → epic-6; HITL → never; deps → confirm; retro → no
Workflow runs, halts at dep_inference_confirm
Skill asks: confirm_deps / proceed_without_inference / abort_prd
User: confirm_deps
Skill resumes with userChoice=confirm_deps + confirmedDeps
Workflow completes epic 6
```

### Resume a halted run
```
User: /bmad-prd-orchestrate resume 2026-09-09-epic-6
Skill asks: resume token (already given) → userChoice?
User: continue
Skill resumes with userChoice=continue
```

### Fresh run, fully autonomous
```
User: /bmad-prd-orchestrate
Skill asks: scope → all; HITL → never; deps → confirm; retro → no
User accepts all defaults
Workflow halts at dep_inference_confirm
Skill asks: confirm_deps / proceed_without_inference / abort_prd
...
```
