---
name: bmad-build-converge
description: Run a single story through bmad-build with quality-gate convergence loop + CI gate + auto-merge. Generic across any BMAD PRD.
---

# bmad-build-converge

A Claude Code Workflow-tool wrapper around `bmad-build-auto` (per-story dev primitive). Adds:
- Quality-gate convergence loop (max iterations)
- CI monitor with transient retry
- Auto-merge on green
- Cleanup of worktree + branch

## Usage

The user invokes this when they want to implement + merge ONE story autonomously. For multi-story orchestration, use `bmad-prd-orchestrate` instead.

## Activation

On activation, this skill:
1. Reads the canonical workflow script at `.claude/workflows/bmad-build-converge.js`
2. Invokes the Workflow tool with `scriptPath: <path>` and args from the user
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
