# El Salvador Branch Workflow (stub)

Full workflow: `docs/el-salvador-workflow.md` — branch topology, the
three validation paths, the five pre-reset safety checks, worktree
table, image-tag scopes (`genie_ai_image_tag` global +
`image_tag_overrides` per service, always JSON single-object).

Read it before ANY el-salvador work or `.102` deploy. Hard rules:
nothing lands on `main` without a passing test; el-salvador-specific
work NEVER lands on `main` (Path 3, target `release/el-salvador`);
one branch per worktree; never overwrite an existing `fix/<name>`
branch; conflicts are surfaced, not auto-resolved.

Status (2026-11-20): dormant-but-alive — last `release/el-salvador`
activity 2026-11-05, both worktrees still exist. K8s local testing
does NOT replace `.102` validation for el-salvador-specific features.
