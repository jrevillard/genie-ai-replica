# Post-PRD Initiative Archival

When a PRD initiative is completed (all epics implemented, sprints closed) and a new PRD initiative begins in the same project, archive the completed initiative before starting the new one.

## When

- After all implementation artifacts (stories, sprints, retrospectives) for the current initiative are committed
- Before creating new PRD/architecture/epics files for the next initiative

## Where

Archive at `_bmad-output/archived/<initiative-key>/` to keep the active directories completely clean:

```
_bmad-output/
├── archived/
│   └── <initiative-key>/
│       ├── planning-artifacts/
│       └── implementation-artifacts/
├── planning-artifacts/      # active initiative only
└── implementation-artifacts/ # active initiative only
```

## Procedure

1. **Commit all work** on the completed initiative (both main and any worktree branches)
2. **On `main`** (not in a worktree):
   - Create `_bmad-output/archived/<initiative-key>/planning-artifacts/`
   - Create `_bmad-output/archived/<initiative-key>/implementation-artifacts/`
   - Move all completed initiative files from `planning-artifacts/` and `implementation-artifacts/` into the archive
   - Keep shared resources (e.g., `research/`) in place
   - Commit with message: `chore: archive <initiative-key> initiative artifacts`
3. **In the new initiative worktree**: name files with standard BMAD names (`prd.md`, `architecture.md`, `epics.md`) since the active directories are now clean

## Naming Convention

- `<initiative-key>`: lowercase kebab-case matching the PRD scope (e.g., `keycloak-idp`, `mobile-oidc`)
- Do NOT rename files inside the archive — the directory provides the context

## What NOT to Do

- Do NOT archive from a worktree — always archive on `main` to keep history linear
- Do NOT rename archived files — keep original names, the directory path provides context
- Do NOT delete `research/` or other shared resources that may span initiatives
