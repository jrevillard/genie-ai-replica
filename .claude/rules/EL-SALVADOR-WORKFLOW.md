# El Salvador Branch Workflow

El Salvador runs on a long-lived release branch (`release/el-salvador`)
with frequent deploys and tuning cycles. This document defines the
**staging branch pattern** used to keep dev work, validation, and main
synchronisation clean.

## Branch topology

```
main
  │
  ├── release/el-salvador          (long-lived, deployed to .102 via Ansible)
  │     │
  │     └── dev/el-salvador        (staging, all el-salvador dev happens here)
  │
  └── (fix branches off main for generic fixes — separate workflow)
```

| Branch | Lifetime | Direct pushes | Rebase | Deploy target |
|---|---|---|---|---|
| `main` | permanent | via MR | — | other stacks |
| `release/el-salvador` | long-lived | force-push after rebase | rebase onto main periodically | `.102` (prod) |
| `dev/el-salvador` | per dev cycle | force-push OK | reset from `release/el-salvador` at cycle start | `.102` (validation only) |

## Per-cycle workflow

### 1. Start a new dev cycle

Reset `dev/el-salvador` to current `release/el-salvador`:

```bash
git fetch origin
git checkout dev/el-salvador
git reset --hard origin/release/el-salvador
git push --force-with-lease origin dev/el-salvador
```

This keeps `dev/el-salvador` as a clean fork with only the new dev
commits on top. Old dev commits are discarded (already validated
upstream or abandoned).

### 2. Develop on `dev/el-salvador`

```bash
git checkout dev/el-salvador
# ... edit, commit, push freely (force-push OK while iterating)
```

### 3. Deploy from `dev/el-salvador` for live validation

The image tag is passed explicitly via `--extra-vars`, **not** by
branch-tracking in `vars.yml` (see `feedback_no_feature_branch_vars_yml.md`).

There are **two scopes** of tag control:

#### Global tag (`genie_ai_global_tag`)

All 16 images share this tag. Use when validating a full dev branch
end-to-end.

```bash
ansible-playbook -i inventory/test.ini deploy.yml \
  --extra-vars "repo_branch=dev/el-salvador genie_ai_global_tag=dev/el-salvador"
```

#### Per-service tag overrides (`image_tag_overrides`)

Pin **specific images** to a different tag while keeping others on
the global tag. Used when only one or two services need the dev
build (saves CI time, avoids cross-service regressions).

The override dict keys are the image names defined in
`deploy/ansible/tasks/deploy-shared-facts.yml`. Example: deploy
from `release/el-salvador` everywhere but only pin the reranker
to the dev branch build:

```bash
ansible-playbook -i inventory/test.ini deploy.yml \
  --extra-vars "repo_branch=release/el-salvador \
                genie_ai_global_tag=release-el-salvador \
                image_tag_overrides={'genie-ai-reranker': 'dev/el-salvador'}"
```

**Use the branch name as the tag**, not the commit SHA. The
`.gitlab-ci.yml` `promote` step tags each build with both the
SHA and the branch name (line ~800:
`FINAL_TAGS="${BRANCH_TAG}-${CI_COMMIT_SHORT_SHA} ${BRANCH_TAG}"`),
so the branch-name tag is mutable and always points to the latest
build of the branch. Redeploy with the same `--extra-vars` after
each push — the registry tag updates on its own.

When you want to lock a specific validated build, switch to the
SHA-pinned tag: `image_tag_overrides={'genie-ai-reranker':
'dev-el-salvador-<sha>'}`. The SHA-pinned tag is immutable; it
will not move if you push new commits.

The Ansible template (`templates/env.j2`) renders per-service
`GENIE_AI_<NAME>_IMAGE_TAG` vars, so docker-compose pulls the
overridden tag for that image only.

#### Image name reference

| Service | `img.name` key |
|---|---|
| reranker | `genie-ai-reranker` |
| chatqna-server | `genie-ai-chatqna-server` |

Full list in `deploy/ansible/tasks/deploy-shared-facts.yml`
(`genieai_images` set_fact).

Validate on `.102` (RAG eval, smoke tests, etc.) until satisfied.

### 4. Forward-port validated commits to main

Create a fix branch off `main`, cherry-pick the validated commits:

```bash
git checkout main
git checkout -b fix/<descriptive-name>
git cherry-pick <sha-from-dev-el-salvador>
git push origin fix/<descriptive-name>
```

Open MR to `main`. The MR target is `main` (generic fix); the
cherry-pick keeps only the relevant commits without dragging in
other el-salvador-specific noise.

### 5. Merge to main, then rebase `release/el-salvador` onto main

Once the MR merges:

```bash
git checkout release/el-salvador
git rebase origin/main
git push --force-with-lease origin release/el-salvador
```

This brings `release/el-salvador` in sync with `main` (including the
cherry-picked fix). **Critical order**: main first, then rebase.
Reversing this order causes conflicts and parasite commits.

### 6. Loop back to step 1 for the next cycle

## Permanent Draft MR — required for CI exposure

`dev/el-salvador` MUST have a permanent Draft MR targeting
`release/el-salvador`. Without an MR, pushes to the branch do NOT
trigger pipelines (GitLab CI only runs on branches with an open MR
matching the pipeline rules).

The Draft MR must:
- Be in **draft** state (not mergeable)
- Have **`title` prefixed with `⚠️ DRAFT NEVER MERGE`** so reviewers
  understand the intent
- Set **`remove_source_branch=false`** (the branch must survive)
- Have **`squash=false`** (each commit is a logical step; squashing
  loses the per-cycle audit trail)

**Never merge this MR** — it exists solely to keep CI alive for the
branch. Closing it silences the pipeline.

```bash
# Create via glab:
glab mr create \
  --source-branch dev/el-salvador \
  --target-branch release/el-salvador \
  --title "⚠️ DRAFT NEVER MERGE — dev/el-salvador staging branch" \
  --description "See .claude/rules/EL-SALVADOR-WORKFLOW.md" \
  --draft \
  --no-squash \
  --remove-source-branch=false \
  --repo un/itu/genie-ai
```

If the MR is ever closed by accident, recreate it — pipelines
resume on the next push once the MR is back in Draft state.

## Image tags and deploy traceability

Every deploy on `.102` (validation or production) MUST use an explicit
`genie_ai_global_tag` via `--extra-vars`. This ensures the deployed
artifact can be traced back to a specific commit SHA, regardless of
which branch was used.

Never modify `deploy/ansible/group_vars/itu_rtx_el_salvador/vars.yml`
to track a feature branch — that breaks the MR-clean principle.

## Anti-patterns

- **Do not** commit directly to `release/el-salvador` from a feature
  branch without going through `dev/el-salvador` validation. The
  staging branch exists to catch validation failures before they
  hit prod.
- **Do not** rebase `release/el-salvador` onto `main` BEFORE the
  cherry-picked MR has merged into `main`. This causes conflicts
  (commit content duplicated with different SHAs) and parasite
  commits.
- **Do not** let `dev/el-salvador` accumulate cycles. Reset it at
  the start of each cycle; old work belongs in `main` (after
  merge) or in dedicated archive branches.

## Relation to other rules

- `feedback_no_feature_branch_vars_yml.md` — vars.yml stays clean;
  deploy params via CLI
- `feedback_el_salvador_direct_rebase.md` — superseded for
  el-salvador specifically; direct rebase + force-push still
  applies to `release/el-salvador` ITSELF (not via MR), but the
  dev work happens on `dev/el-salvador`
- `feedback_validate_before_promote.md` — live validation on
  `.102` is mandatory before forward-porting to main
