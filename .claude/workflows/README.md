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
