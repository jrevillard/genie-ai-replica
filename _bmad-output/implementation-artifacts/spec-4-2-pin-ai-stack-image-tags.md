---
title: 'Pin AI-stack image tags (no :latest, no split-brain)'
type: 'chore'
created: '2026-08-19'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'ad7c7c592d0eeace4aa34546ab02a5e4f1a9fc59'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The AI stack has two critical `:latest` tags that diverge from pinned versions: Ansible deployment uses `vllm/vllm-openai:latest` while docker-compose pins `:v0.10.0`, and GitLab CI uses `release-cli:latest`. This creates split-brain risk where different deployment paths use different image versions, breaking reproducibility and making root-cause analysis impossible when issues arise.

**Approach:** Eliminate all `:latest` tags by fixing the two occurrences and extending the existing config-validator test suite (which already checks `docker-compose.gpu.yaml` for `:latest`) to also validate the main `docker-compose.yaml` and Ansible deployment files. No centralized version manifest — grep-and-update is the process.

## Boundaries & Constraints

**Always:**
- All image tags must be explicit version pins (no `:latest`, no mutable tags)
- Extend existing config-validator to check all deployment files for `:latest`
- CI must fail if any `:latest` tag is introduced
- Changes land as independent commits (separate from OPEA version bump) for clean root-cause

**Ask First:**
- Whether to pin GitLab release-cli to a digest vs version tag (trade-off: stability vs maintenance)
- Whether internal overlay images (`${IMAGE_TAG:-latest}`) need enforcement or if the fallback is acceptable for local dev

**Never:**
- Do not create a centralized version manifest (versions.env) — grep-and-update is the process
- Do not bump OPEA version in this story (that's a separate story)
- Do not change image functionality or behavior — only pin versions

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ansible deploy with versions.env | `versions.env` present, all versions pinned | Deploy uses exact versions from manifest | N/A |
| Coherence lint detects `:latest` | Any image tag contains `:latest` | CI fails with clear error message listing violations | Exit 1, list all violations |
| Coherence lint detects divergence | Same image has different tags in compose vs ansible | CI fails with divergence details | Exit 1, list divergent images |
| Local dev without versions.env | Developer runs docker-compose without sourcing versions.env | Falls back to IMAGE_TAG env var or `latest` (acceptable for dev) | Document in README |

</frozen-after-approval>

## Code Map

- `deploy/ansible/group_vars/all.yml:143` -- CRITICAL FIX: change `vllm_llm_image: vllm/vllm-openai:latest` → `:v0.10.0`
- `.gitlab-ci.yml:1879` -- CRITICAL FIX: pin `registry.gitlab.com/gitlab-org/release-cli:latest` → specific version
- `tests/config-validator/__tests__/config-validation.test.js` -- EXTEND: add `:latest` checks for main docker-compose.yaml (already exists for gpu compose)
- `tests/config-validator/validators/parse-compose.js` -- EXTEND: add function to extract all image tags from main compose file
- `tests/config-validator/validators/validate-gpu-node.js` -- REFERENCE: existing parseGpuCompose() pattern to follow

## Tasks & Acceptance

**Execution:**
- [ ] `deploy/ansible/group_vars/all.yml` -- UPDATE -- Replace `:latest` with `:v0.10.0` for vllm_llm_image
- [ ] `.gitlab-ci.yml` -- UPDATE -- Pin release-cli image to specific version tag (not `:latest`)
- [ ] `tests/config-validator/validators/parse-compose.js` -- ADD FUNCTION -- parseComposeImages() to extract all image tags from main docker-compose.yaml (follow parseGpuCompose pattern)
- [ ] `tests/config-validator/__tests__/config-validation.test.js` -- ADD TEST -- 'all main compose image tags are pinned (no :latest)' (follow GPU test pattern)
- [ ] `tests/config-validator/__tests__/config-validation.test.js` -- ADD TEST -- 'Ansible image tags are pinned (no :latest)' (parse deploy/ansible/group_vars/all.yml for image: tags)

**Acceptance Criteria:**
- Given all deployment configs, when config-validator runs, then no `:latest` tags are found in docker-compose.yaml, docker-compose.gpu.yaml, or Ansible files
- Given Ansible deployment, when deploying to GPU node, then vLLM uses v0.10.0 (not `:latest`)
- Given GitLab CI pipeline, when release job runs, then release-cli uses pinned version (not `:latest`)
- Given config-validator detects violation, when image tag is `:latest`, then CI fails with clear error listing the violating image

## Spec Change Log

## Design Notes

**Why extend config-validator instead of creating a new lint job?**
The config-validator already has infrastructure for parsing docker-compose files and validating image tags (for GPU compose). Extending it reuses existing patterns (parseGpuCompose, test structure) and keeps all deployment validation in one place. A separate lint job would duplicate infrastructure.

**Why no centralized version manifest?**
The team has no process for maintaining such a file. Grep-and-update is the current process (such as it is). Adding versions.env adds maintenance overhead without clear benefit. The config-validator extension catches `:latest` violations, which is the actual problem. Version divergence (same image, different tags) is a secondary concern that can be addressed later if it becomes a real issue.

## Verification

**Commands:**
- `cd tests/config-validator && npm test` -- expected: all tests pass, including new `:latest` checks
- `grep -r ":latest" docker-compose.yaml docker-compose.gpu.yaml deploy/ansible/group_vars/all.yml .gitlab-ci.yml` -- expected: no matches (or only in comments)
- `ansible-inventory -i deploy/ansible/inventory/test.ini --host gpu-node | grep vllm` -- expected: shows `:v0.10.0` not `:latest`

**Manual checks:**
- Verify Ansible group_vars has explicit version for vllm_llm_image
- Verify .gitlab-ci.yml release-cli image has explicit version
- Verify config-validator test fails when a `:latest` tag is intentionally introduced (test the gate)
