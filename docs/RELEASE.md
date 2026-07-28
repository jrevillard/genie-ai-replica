# Release Process

This document describes how to release a new version of GENIE.AI.

- [1. Versioning](#1-versioning)
- [2. Branching Model](#2-branching-model)
- [3. Changelog](#3-changelog)
- [4. Release Workflow](#4-release-workflow)
- [5. Pre-releases](#5-pre-releases)
- [6. PATCH Releases](#6-patch-releases)
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
main (trunk)         ← all development, always deployable
  │
  ├── feature/foo    ← short-lived, merged via MR
  ├── fix/bar        ← short-lived, merged via MR
  │
  └── release/2.1    ← one branch per MAJOR/MINOR series
       │
       ├── v2.1.0    ← initial tag
       ├── v2.1.1    ← PATCH via cherry-pick from main
       └── v2.1.2    ← next PATCH, same branch
```

### `main` — The Trunk

- Single source of truth. All development merges here through Merge Requests.
- Always in a deployable state — CI runs on every commit: lint → test → config → build → scan → promote.
- Tags are **never** created on `main` once a `release/X.Y` branch exists for that series.

### `release/*` — Release Branches

- **One branch per MAJOR/MINOR version.** Example: `release/2.1` for the entire 2.1.x series.
- Created from `main` at the start of the release process. The initial tag (`v2.1.0`) is the first commit on the branch.
- **Never commit directly to a release branch.** All fixes land on `main` first, then are cherry-picked to the release branch.
- Tags for every release in the series live on this branch: `v2.1.0`, `v2.1.1`, `v2.1.2`... all on `release/2.1`.
- CI runs on release branches: builds and promotes images as `vX.Y-{sha}` and `vX.Y` (moving tags for the branch).
- Abandoned when the next MINOR release replaces it (no merge back to `main`).

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
- Describe changes from the **user's or deployer's perspective** — what do they
  need to know or do? Omit internal refactoring, CI pipeline changes, linting,
  test additions, and tooling tweaks. "Added Mailpit for CI testing" is noise;
  "File size limit reduced to 50 MB" matters.
- **Curate aggressively.** 684 commits since the last release ≠ 684 changelog
  entries. Merge related changes, drop internal-only items.
- Group changes under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  or `Security`.
- Write for non-native English speakers: clear, short sentences.
- Do **not** include branch names, issue tracker IDs in section headers, or
  internal implementation details in the changelog text.

## 4. Release Workflow

A release requires a few manual actions — everything else is automated by CI:

1. **Gather and write changelog** (review MRs/commits, write Keep a Changelog entries)
2. **Create the release branch** (`release/X.Y`)
3. **Tag and push** (`git tag vX.Y.Z && git push`) ← triggers full CI pipeline

### 4.1 Create the Release Branch

**Prerequisite (one-time setup):** The `release:create` CI job uses `CI_JOB_TOKEN`
to call the GitLab Releases API. If your project has
**"Limit access to this project"** enabled (default on GitLab ≥16.1), ensure the
`api` scope is granted to `CI_JOB_TOKEN` in
**Settings → CI/CD → Token Access → Allow access to this project with a job token**,
or the job will fail with 403.

1. **Ensure CI is green on `main`.** Check the
   [latest pipeline](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines?ref=main).

2. **Gather changes since the last release.** Do not rely on `[Unreleased]`
   alone — it may be empty or incomplete. Review merged MRs and commits since
   the last tag:

   The source depends on the release type:

   **MAJOR/MINOR (from `main`):** all changes on `main` since the last release
   branch was created. Tags live on `release/*` branches, not on `main`, so use
   the merge-base between `main` and the most recent release branch:
   ```bash
   LAST_REL=$(git for-each-ref --sort=-creatordate --format='%(refname:short)' refs/remotes/origin/release/ | head -1)
   BASE=$(git merge-base main "${LAST_REL:-main}")
   git log ${BASE}..main --oneline --no-merges
   ```

   **PATCH (from `release/X.Y`):** only changes on that branch since its last tag:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 release/X.Y 2>/dev/null)
   git log ${LAST_TAG}..release/X.Y --oneline --no-merges
   ```

   For MR-level context on GitLab:
   ```bash
   glab api "projects/:id/merge_requests?state=merged&updated_after=$(git log -1 --format=%aI $BASE)&per_page=50"
   ```

3. **Write the changelog entries.** Keep a Changelog format: describe what
   changed, for whom, and why — not a list of commit messages. Group under
   `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Mark
   breaking changes with `**Breaking:**`.
   See `CHANGELOG.md` for the current format and recent examples.

4. **Decide the version number.** Use the rules in [Section 1](#1-versioning).
   Breaking changes → MAJOR, new features → MINOR, only fixes → PATCH.

5. **Update the changelog on `main`.** Rename `[Unreleased]` to the new version,
   add the date, and update the reference links at the bottom:

   ```markdown
   ## [2.1.0] - 2026-07-28
   ```

   Then add a fresh `[Unreleased]` section at the top. Merge this via MR.

6. **Create the release branch from `main`:**

   ```bash
   git checkout main
   git pull origin main
   git checkout -b release/2.1
   git push origin release/2.1
   ```

   This branch will hold the entire 2.1.x series. All PATCH releases
   (`v2.1.1`, `v2.1.2`, ...) will be tagged from this branch.

### 4.2 Tag and Push

**This is the only manual step.** Creating and pushing the Git tag triggers
everything else — CI builds, scans, promotes Docker images, and creates the
GitLab Release. You do not need to touch Docker, the Container Registry, or
the GitLab Releases UI.

From the release branch:

```bash
git checkout release/2.1
git pull origin release/2.1
git tag v2.1.0
git push origin v2.1.0
```

Pushing the tag triggers the full CI pipeline:

```
git tag push
  → lint + test + config (includes changelog validation)
  → build (16 images, tmp/ namespace)
  → scan (Trivy + Syft SBOM)
  → e2e (skipped for tag pipelines)
  → promote (tmp/ → stable namespace, tags: v2.1.0 + latest)
  → release (GitLab Release created from changelog)
```

Docker tag summary:

| Git tag | Docker tags |
|---------|-------------|
| `v2.1.0` | `v2.1.0`, `latest` |
| `v2.1.1` | `v2.1.1`, `latest` (updated) |
| `v2.1.0-rc.1` | `v2.1.0-rc.1` only (pre-release, no `latest` update) |
| Branch push (`release/2.1`) | `v2.1-{sha}`, `v2.1` (moving) |

### 4.3 Verify the Release

1. **Check the pipeline** at
   [CI/CD → Pipelines](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines).

2. **Verify Docker images** in the
   [Container Registry](https://opensource.unicc.org/un/itu/genie-ai/container_registry).
   All 16 images should have the `v2.1.0` tag.

3. **Verify the GitLab Release** at
   [Deploy → Releases](https://opensource.unicc.org/un/itu/genie-ai/-/releases).

4. **Verify `latest` tag** (stable releases only):
   ```bash
   docker pull registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-frontend:latest
   docker inspect registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-frontend:latest | jq '.[0].RepoDigests'
   ```
   The `latest` digest should match the `v2.1.0` digest.

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
# Tag the same commit as the last pre-release
git checkout v2.0.0-rc.1
# Verify you are on the right commit:
git log -1 --format="%H %s" v2.0.0-rc.1
git tag v2.0.0
git push origin v2.0.0
```

The stable tag triggers a new promote that updates `latest`.

## 6. PATCH Releases

A PATCH release (`v2.1.0` → `v2.1.1`) ships bug fixes to the current release
without pulling in new features from `main`.

### Cherry-Pick Flow

Development always happens on `main`. The release branch only receives cherry-picks.

```
main (trunk)                     release/2.1
    │                                 │
    ├── feature/new-stuff             ├── v2.1.0 (initial tag)
    ├── fix/bug-123 (MR)              │
    │   └── cherry-pick ──────────→   ├── v2.1.1 (PATCH)
    ├── feature/other                 │
    ├── fix/bug-456 (MR)              │
    │   └── cherry-pick ──────────→   ├── v2.1.2 (PATCH)
    └── ...                           └── ...
```

### Step-by-Step

1. **Create a fix branch from `main`:**

   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/<description>
   ```

2. **Implement the fix.** Write code + tests. Add a changelog entry under `[Unreleased]`
   on `main` (the permanent record).

3. **Merge to `main`** via Merge Request. Wait for CI to pass.

4. **Cherry-pick to the release branch:**

   ```bash
   git checkout release/2.1
   git pull origin release/2.1
   git cherry-pick <commit-sha-from-main>
   ```

   If the cherry-pick conflicts on `CHANGELOG.md` (e.g., `main` has new `[Unreleased]`
   entries not present on the release branch), resolve manually: keep the release
   branch's changelog intact and re-apply only the fix's changelog line.

5. **Move the changelog entry on the release branch.** The cherry-pick added
   the fix under `[Unreleased]` on the release branch. Move it to a new PATCH
   version section:

   ```markdown
   ## [2.1.1] - 2026-07-28

   ### Fixed

   - Fix description cherry-picked from main.
   ```

   Remove the same entry from the `[Unreleased]` section on the release branch
   to avoid duplication. Update the reference links at the bottom.

6. **Tag from the release branch:**

   ```bash
   git tag v2.1.1
   git push origin release/2.1 v2.1.1
   ```

   Note: `git push origin <branch> <tag>` pushes both the cherry-pick commit and
   the tag. Section 4.2 only pushes the tag because the branch commit already existed
   on the remote from step 4.1.

7. **Deploy** with the new PATCH tag.

   The tag triggers the same CI pipeline as the initial release: build → scan → promote.
   The promote job tags Docker images as `v2.1.1` and updates the `latest` Docker tag
   to point to this release (it's a stable tag, not a pre-release).

### Urgent Hotfixes

Follow the same flow. The only difference is speed: skip non-essential CI steps
if the pipeline allows it, and coordinate with deployers to fast-track the rollout.

### Why Cherry-Pick From Main?

Cherry-picking from `main` (instead of branching from the tag) keeps `main` as
the single source of truth. The fix lives on `main` forever — the cherry-pick
on the release branch is a deployment artifact, not the canonical change.
This avoids merge conflicts and divergence when the release branch is eventually
abandoned.

## 7. Checklist

Copy this checklist into the release MR or issue.

### Preparation

- [ ] CI pipeline green on `main` before creating the release branch
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

- [ ] CI pipeline passed (lint → test → config → build → scan → promote → release)
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
