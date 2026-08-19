---
title: 'Update docs, env, and the upgrade matrix'
type: 'feature'
created: '2026-08-19'
status: 'ready-for-dev'
epic: 4
story_id: 4.5
story_key: 4-5-update-docs-env-and-the-upgrade-matrix
---

# Story 4.5: Update docs, env, and the upgrade matrix

## User Story

**As a** deployer,
**I want** the docs and config facts current,
**So that** no one reads stale version/behavior guidance.

## Acceptance Criteria

**Given** the reconciled env (`RETRIEVER_ARANGO_GRAPH_NAME`, `RERANKER_TOP_N` three-home pinning) + the upgrade matrix + `CHANGELOG`,
**When** they are updated in the same MR that moved `OPEA_VERSION`,
**Then** the matrix shows the v1.3→v1.5 entry and CI asserts no `NEXT` placeholder remains,
**And** CLAUDE.md/env reflect the post-bump facts.

---

## Developer Context

### What This Story Does

This is the **documentation and config reconciliation** story for the OPEA v1.3 → v1.5 upgrade. It ensures that all user-facing and deployer-facing artifacts reflect the new reality after the upgrade:

1. **docs/UPGRADE.md** — Add v1.3→v1.5 upgrade entry (what changed, migration steps if any)
2. **CHANGELOG.md** — Ensure [Unreleased] section captures all user-visible changes from the upgrade
3. **CLAUDE.md** — Update post-bump facts (Python version, OPEA version, image tag policy, etc.)
4. **env** — Reconcile commented defaults with actual code/docker-compose defaults for `RETRIEVER_ARANGO_GRAPH_NAME` and `RERANKER_TOP_N`
5. **CI check** — Add a job that asserts no `NEXT` placeholder remains in version-related files

### Three-Home Pinning

"Three-home pinning" means a configuration variable is defined in **three places** and must be consistent:

1. **env file** — User-facing template with commented defaults
2. **docker-compose.yaml** — Service environment variables (may override env)
3. **Code defaults** — Python/Node.js `os.getenv('VAR', 'default')` or `process.env.VAR || 'default'`

For this story, the vars are:
- `RETRIEVER_ARANGO_GRAPH_NAME` — ArangoDB graph name for retriever
- `RERANKER_TOP_N` — Number of top chunks kept by reranker

### Current State (from code review)

**RETRIEVER_ARANGO_GRAPH_NAME:**
- `env` line 164: `# RETRIEVER_ARANGO_GRAPH_NAME=GRAPH` (commented, default unclear)
- Code (story 4-1 fix): unified to use `ARANGO_GRAPH_NAME` (not `RETRIEVER_ARANGO_GRAPH_NAME`)
- **Action:** Update env comment to clarify the var name changed, or remove if no longer user-configurable

**RERANKER_TOP_N:**
- `env`: `# RERANKER_TOP_N=3` (commented)
- `docker-compose.yaml`: may set default via service env
- Code: `os.getenv('RERANKER_TOP_N', '3')` or similar
- **Action:** Verify all three homes agree on default = 3

### Upgrade Facts (from CHANGELOG [Unreleased])

- OPEA v1.3 → v1.5 (7.5 months of upstream fixes)
- Python 3.10 → 3.11 (all OPEA images)
- Dataprep image: CUDA/Ubuntu → `python:3.11-slim` (no GPU assignment)
- Image tags pinned (no `:latest` in AI stack)
- Rollback: redeploy previous v1.3-based image tags

### Files to Update

| File | What to Update |
|------|---------------|
| `docs/UPGRADE.md` | Add section "v2.0.1 → v2.1.0" (or next version) with OPEA v1.3→v1.5 changes |
| `CHANGELOG.md` | Verify [Unreleased] section is complete (already has OPEA upgrade entry) |
| `CLAUDE.md` | Update "Technology Stack" table (Backend: Node.js 22, AI/ML: OPEA v1.5 + Python 3.11) |
| `env` | Reconcile `RETRIEVER_ARANGO_GRAPH_NAME` and `RERANKER_TOP_N` comments/defaults |
| `.gitlab-ci.yml` | Add job: `verify:no-next-placeholders` — greps for `NEXT` in version-related files |

### CI Job: verify:no-next-placeholders

Add to `.gitlab-ci.yml` in the `config` stage (runs before build):

```yaml
verify:no-next-placeholders:
  stage: config
  image: python:3.11-slim
  script:
    - |
      # Check for NEXT placeholders in version-related files
      if grep -rn "NEXT" \
        --include="*.py" --include="*.yaml" --include="*.yml" --include="Dockerfile*" --include="env*" \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=_bmad \
        . | grep -iE "version|opea|vllm|python"; then
        echo "ERROR: Found NEXT placeholder in version-related files"
        exit 1
      fi
      echo "No NEXT placeholders found"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

### Testing

- **Manual verification:** After changes, run the CI job locally or in MR to confirm it passes
- **Spot-check:** Open `docs/UPGRADE.md`, `CHANGELOG.md`, `CLAUDE.md`, `env` — verify facts match code

---

## Technical Requirements

### Architecture Compliance

- Follow existing docs structure (docs/UPGRADE.md for deployer-facing, CLAUDE.md for agent-facing)
- Use Keep a Changelog format for CHANGELOG.md
- CI job must be idempotent (no false positives on legitimate uses of "NEXT" like "next_data" variable)

### File Structure

- `docs/UPGRADE.md` — Append new version section at top (after header)
- `CHANGELOG.md` — Update [Unreleased] section only
- `CLAUDE.md` — Update relevant sections (Technology Stack, Environment Configuration)
- `env` — Update comments, do NOT uncomment defaults (user must explicitly set)
- `.gitlab-ci.yml` — Add job in `config` stage

### Testing Requirements

- No unit tests needed (documentation + CI config)
- CI job must be tested in MR (will run automatically)

---

## Previous Story Intelligence

**Story 4-1** (done): Fixed latent dataprep/retriever bugs
- Unified graph name default (`ARANGO_GRAPH_NAME`, not `RETRIEVER_ARANGO_GRAPH_NAME`)
- Files modified: `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py`
- **Learning:** The env var name changed in code; this story must update env comment to match

**Story 4-2** (done): Pinned AI-stack image tags
- Removed all `:latest` tags, pinned to specific versions
- Added CI validation for `:latest` tags
- Files modified: `.gitlab-ci.yml`, `deploy/ansible/group_vars/all.yml`, `tests/config-validator/__tests__/config-validation.test.js`, `tests/config-validator/validators/parse-compose.js`
- **Learning:** CI validation pattern established — this story adds a similar check for NEXT placeholders

---

## Project Context Reference

**Critical rules from `_bmad-output/project-context.md`:**
- All documentation MUST be in English
- CLAUDE.md is for AI agents; docs/ is for human developers
- env file = committed template; .env = local secrets (never commit)
- CI jobs run on every MR; config stage runs before build

**Technology stack (post-upgrade):**
- Backend: Node.js 22, Express 4.18
- AI/ML: OPEA v1.5, Python 3.11, vLLM v0.10.0
- Database: ArangoDB 3.12+
- Cache: Redis 7
- API Gateway: Kong 3.9.3

---

## Status

**ready-for-dev** — Ultimate context engine analysis completed.
