# Release Process

This document describes how to release a new version of GENIE.AI.

- [1. Versioning](#1-versioning)
- [2. Branching Model](#2-branching-model)
- [3. Changelog](#3-changelog)
- [4. Release Workflow](#4-release-workflow)
- [5. Pre-releases](#5-pre-releases)
- [6. Hotfix](#6-hotfix)
- [7. Checklist](#7-checklist)
- [8. References](#8-references)

## 1. Versioning

GENIE.AI follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

### Tag Format

All releases are created by pushing a Git tag. Tags use a `v` prefix:

```
v<MAJOR>.<MINOR>.<PATCH>
```

Examples: `v2.0.0`, `v2.1.0`, `v2.1.1`

The `v` prefix is **mandatory** — the GitLab Container Registry cleanup policy preserves
tags matching `v.*`. Tags without the prefix may be deleted.

### When to Bump Each Number

| Bump | When |
|------|------|
| **MAJOR** | Breaking changes: API incompatibility, removed endpoints, schema changes requiring re-ingestion |
| **MINOR** | New features, new services, new configuration options — fully backward-compatible |
| **PATCH** | Bug fixes, security patches, dependency bumps — no new features, no breaking changes |

### Pre-release Tags

Pre-release versions use a hyphenated suffix:

```
v<MAJOR>.<MINOR>.<PATCH>-<label>.<N>
```

Labels: `alpha`, `beta`, `rc` (release candidate).

Examples: `v2.0.0-alpha.1`, `v2.0.0-beta.2`, `v2.0.0-rc.1`

The CI pipeline detects pre-release tags and does **not** update the `latest` Docker tag.
See [Section 5 — Pre-releases](#5-pre-releases).

### What Gets Versioned

The **only deliverable** is the set of Docker images. Each Git tag produces
16 Docker images tagged with the version number in the
[GitLab Container Registry](https://opensource.unicc.org/un/itu/genie-ai/container_registry).

Component-level versions in `package.json`, `pyproject.toml`, and `pubspec.yaml` are
**informational only** — nothing is published to npm, PyPI, or pub.dev.

## 2. Branching Model

GENIE.AI uses [Trunk-Based Development](https://trunkbaseddevelopment.com/).

```
main (trunk)         ← always deployable
  │
  ├── feature/foo    ← short-lived, merged via MR
  ├── fix/bar        ← short-lived, merged via MR
  │
  └── release/X.Y    ← stabilization branch (created when needed)
```

### `main` — The Trunk

- Single source of truth. Always in a deployable state.
- All development merges here through Merge Requests.
- CI runs on every commit: lint → test → config → build → scan → promote.

### `release/*` — Stabilization Branches

- Created **only when stabilization is needed** before a release.
- Example: `release/2.0` for the 2.0.x release series.
- CI runs on release branches: builds and promotes images as `release-X.Y-{sha}` and `release-X.Y`.
- Bug fixes for a release are made on `main`, then **cherry-picked** to the release branch.
- Tags are created from the release branch when it is ready.

### Feature Branches

- Named `feature/<description>` or `fix/<description>`.
- Short-lived: merged to `main` within a few days, never linger.
- Use [git worktrees](https://git-scm.com/docs/git-worktree) for isolation.

### Never Commit Directly to `main`

All changes go through Merge Requests. Direct pushes to `main` and `release/*` are
blocked by branch protection rules.

## 3. Changelog

GENIE.AI maintains a `CHANGELOG.md` at the repository root, following
[Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/).

### Format

Every release has a version entry with the release date in ISO 8601 format:

```markdown
## [2.0.0] - 2026-07-27
```

Changes are grouped under one of six types:

| Section | Purpose |
|---------|---------|
| `### Added` | New features |
| `### Changed` | Changes in existing functionality |
| `### Deprecated` | Features that will be removed in a future version |
| `### Removed` | Features removed in this version |
| `### Fixed` | Bug fixes |
| `### Security` | Vulnerability fixes |

### Breaking Changes

Mark breaking changes with a `**Breaking:**` prefix inside the entry:

```markdown
### Changed

- **Breaking:** The `/api/chat` endpoint now requires an `Accept-Language` header.
```

Do not collect breaking changes in a separate section — keep them with their type.

### The `[Unreleased]` Section

Keep an `[Unreleased]` section at the top of the changelog. All changes merged to
`main` go here. When cutting a release, rename `[Unreleased]` to the new version,
then add a fresh empty `[Unreleased]` section.

### Reference Links

At the bottom of the file, resolve each version heading as a reference link:

```markdown
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...main
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v1.0.0...v2.0.0
[1.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/v1.0.0
```

### Guiding Principles

- Changelogs are for **humans**, not machines.
- Every version gets an entry. No exceptions.
- List the latest version first.
- Record **notable** changes — not every commit.
- Write for non-native English speakers: clear, short sentences.

## 4. Release Workflow

### 4.1 Prepare the Release

1. **Ensure CI is green on `main`.** Check the
   [latest pipeline](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines?ref=main).

2. **Decide the version number.** Use the rules in [Section 1](#1-versioning).
   If unsure, review the `[Unreleased]` changelog section: breaking changes → MAJOR,
   new features → MINOR, only fixes → PATCH.

3. **Update the changelog.** Rename `[Unreleased]` to the new version, add the date,
   and update the reference links at the bottom:

   ```markdown
   ## [2.0.0] - 2026-07-27
   ```

   Then add a fresh `[Unreleased]` section at the top.

4. **Create a stabilization branch if needed** (optional):

   ```bash
   git checkout main
   git pull origin main
   git checkout -b release/2.0
   git push origin release/2.0
   ```

   Skip this step for PATCH releases — tag directly from `main`.

### 4.2 Tag and Push

From the branch you are releasing (usually `main` or `release/X.Y`):

```bash
git checkout release/2.0          # or main
git pull origin release/2.0       # or main
git tag v2.0.0
git push origin v2.0.0
```

Pushing the tag triggers the full CI pipeline:

```
git tag push
  → lint + test + config (includes changelog validation)
  → build (16 images, tmp/ namespace)
  → scan (Trivy + Syft SBOM)
  → e2e (skipped for tag pipelines)
  → promote (tmp/ → stable namespace, tags: v2.0.0 + latest)
  → GitLab Release created
```

### 4.3 Verify the Release

1. **Check the pipeline** at
   [CI/CD → Pipelines](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines).

2. **Verify Docker images** in the
   [Container Registry](https://opensource.unicc.org/un/itu/genie-ai/container_registry).
   All 16 images should have the `v2.0.0` tag.

3. **Verify the GitLab Release** at
   [Deploy → Releases](https://opensource.unicc.org/un/itu/genie-ai/-/releases).

4. **Verify `latest` tag** (stable releases only):
   ```bash
   docker pull registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-frontend:latest
   docker inspect registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-frontend:latest | jq '.[0].RepoDigests'
   ```
   The `latest` digest should match the `v2.0.0` digest.

### 4.4 Deploy

Deployment is handled separately via Ansible. See `deploy/ansible/README.md` for
the full deployment documentation.

To deploy a specific version:

```yaml
# In group_vars/<environment>/vars.yml
genie_ai_global_tag: "v2.0.0"
```

Or override per-service images as needed.

## 5. Pre-releases

Pre-releases let you test a version before declaring it stable. Use them for
major releases with significant changes, new infrastructure, or when multiple
teams need to coordinate testing.

### Pre-release Lifecycle

```
alpha → beta → rc → stable
```

| Stage | Purpose | Example |
|-------|---------|---------|
| **alpha** | Internal testing, known issues expected | `v2.0.0-alpha.1` |
| **beta** | Broader testing, feature-complete | `v2.0.0-beta.1` |
| **rc** | Release candidate, production validation | `v2.0.0-rc.1` |

### Tagging a Pre-release

```bash
git tag v2.0.0-alpha.1
git push origin v2.0.0-alpha.1
```

### CI Behavior for Pre-releases

The CI promote job detects the `-alpha`, `-beta`, or `-rc` suffix and:

- Tags the images with the exact version: `v2.0.0-alpha.1`
- Does **NOT** update the `latest` Docker tag

This ensures `latest` always points to the most recent **stable** release.

Add a `## [X.Y.Z-alpha.N]` entry in `CHANGELOG.md` before tagging. The CI pipeline
(`config:changelog` job) validates its presence for every version tag including
pre-releases.

### Deploying a Pre-release

Never use `latest` for pre-releases. Pin the exact tag:

```yaml
genie_ai_global_tag: "v2.0.0-rc.1"
```

### Promoting to Stable

When the pre-release cycle is complete and the version is ready:

```bash
# Tag the same commit as stable
git checkout <the-same-commit>
git tag v2.0.0
git push origin v2.0.0
```

The stable tag triggers a new promote that updates `latest`.

## 6. Hotfix

A hotfix is a critical bug fix that must be deployed to production immediately,
bypassing the normal release cycle.

### Trunk-Based Hotfix Flow

In Trunk-Based Development, `main` is always the source of truth. A hotfix is
developed on `main`, then cherry-picked to the active release branch.

```
1. Fix on main
2. Cherry-pick to release/X.Y (if a release branch exists)
3. Tag PATCH from the release branch (or from main if no release branch)
```

### Step-by-Step

1. **Create a fix branch from `main`:**

   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/critical-bug
   ```

2. **Implement the fix.** Write code + tests. Update `CHANGELOG.md` under `[Unreleased]`.

3. **Merge to `main`** via Merge Request. Wait for CI to pass.

4. **Cherry-pick to the release branch** (if one exists):

   ```bash
   git checkout release/2.0
   git pull origin release/2.0
   git cherry-pick <commit-sha-from-main>
   git push origin release/2.0
   ```

   If the cherry-pick conflicts on `CHANGELOG.md` (e.g., `main` has new `[Unreleased]`
   entries not present on the release branch), resolve manually: keep the release
   branch's `[Unreleased]` section intact and re-apply only the fix's changelog line.

5. **Move the changelog entry** from `[Unreleased]` to a new PATCH version section
   on the release branch.

6. **Tag from the release branch** (or from `main` if no release branch):

   ```bash
   git checkout release/2.0          # or main
   git tag v2.0.1
   git push origin v2.0.1
   ```

7. **Deploy** with the new PATCH tag.

### Why Not Branch From the Tag?

Branching from a tag creates a dead-end branch that must be merged back to `main`,
causing merge conflicts and divergence. Trunk-Based Development keeps `main` as the
single source of truth: fix it there first, propagate to release branches with
cherry-pick.

## 7. Checklist

Copy this checklist into the release MR or issue.

### Preparation

- [ ] CI pipeline green on the source branch
- [ ] `CHANGELOG.md` updated: `[Unreleased]` renamed to `[X.Y.Z]` with date
- [ ] Breaking changes marked with `**Breaking:**` in changelog
- [ ] Fresh `[Unreleased]` section added
- [ ] Reference links at bottom of changelog updated
- [ ] Version number follows SemVer rules

### Tagging

- [ ] Git tag created with `v` prefix: `vX.Y.Z`
- [ ] Tag pushed: `git push origin vX.Y.Z`
- [ ] For pre-release: tag includes `-alpha.N`, `-beta.N`, or `-rc.N`

### Verification

- [ ] CI pipeline passed (lint → test → config → build → scan → promote)
- [ ] All 16 Docker images tagged with the new version in Container Registry
- [ ] GitLab Release created with changelog content
- [ ] `latest` Docker tag updated (stable releases only — skip for pre-releases)
- [ ] Dry-run deployment with the new tag succeeds

### Communication

- [ ] Release announced in the project channel
- [ ] Release notes shared with deployers (if separate from changelog)
- [ ] Documentation site updated if release includes user-facing changes

## 8. References

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/)
- [Trunk-Based Development](https://trunkbaseddevelopment.com/)
- [GitLab Container Registry](https://opensource.unicc.org/un/itu/genie-ai/container_registry)
- [GitLab CI Pipeline](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines)
- [Ansible Deployment](../deploy/ansible/README.md)
- [CI Build/Scan/Promote ADR](adr/0001-gitlab-registry-build-scan-pipeline.md)
