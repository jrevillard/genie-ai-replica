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
2. Invokes the Workflow tool with `scriptPath: <path>` and args from the user
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
- `merge_blocked` — merge step rejected (CI rule such as merge-train gate)
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