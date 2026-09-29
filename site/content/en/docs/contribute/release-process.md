---
title: "Release process"
weight: 5
description: "Tag, changelog, publish — the MAJOR / MINOR / PATCH / pre-release flow."
mode: how-to
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

Cut a release of GENIE.AI — **tag, changelog, publish** — without breaking
the deploy pipeline or the version-gated docs.

## Versioning

GENIE.AI follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (`vX.0.0`) — breaking changes (API contract change, env-var rename
  with no fallback, schema migration).
- **MINOR** (`v0.X.0`) — new features (new microservice, new admin endpoint,
  new language). Backwards-compatible.
- **PATCH** (`v0.0.X`) — bug fixes, security patches, doc improvements.
- **Pre-release** (`v0.0.0-alpha.N`, `v0.0.0-rc.N`) — opt-in builds.

## Standard release (MAJOR / MINOR)

1. **Gather changes since last release.**
   ```bash
   LAST_REL=$(git for-each-ref --sort=-creatordate --format='%(refname:short)' \
     refs/remotes/origin/release/ | head -1)
   BASE=$(git merge-base main "$LAST_REL")
   git log ${BASE}..main --oneline --no-merges
   ```

2. **Write CHANGELOG entries** under `Added` / `Changed` /
   `Deprecated` / `Removed` / `Fixed` / `Security`. Mark breaking changes
   with `**Breaking:**`. MR numbers only in `Fixed` and `Security` sections.

   Drop CI-only / lint / refactor / dead-code changes — readers don't need them.

3. **Move `CHANGELOG.md` from `[Unreleased]` → `[X.Y.Z]`** with today's
   date. Add a fresh empty `[Unreleased]` section above. Update the
   reference links at the bottom.

4. **Create the release branch**:
   ```bash
   git checkout main && git pull origin main
   git checkout -b release/X.Y && git push origin release/X.Y
   ```

5. **Tag and push**:
   ```bash
   git checkout release/X.Y && git pull origin release/X.Y
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   CI publishes 16 Docker images tagged `vX.Y.Z` and `latest`.

## PATCH release

Fix on `main` first, cherry-pick to `release/X.Y`:

```bash
# 1. Fix on main
git checkout -b fix/<desc>
# ... fix, add changelog under [Unreleased] ...
# Merge MR

# 2. Cherry-pick to release branch
git checkout release/X.Y && git pull origin release/X.Y
git cherry-pick <sha-from-main>

# 3. Move changelog entry from [Unreleased] to [X.Y.Z+1] on release branch

# 4. Tag
git tag vX.Y.Z+1 && git push origin release/X.Y vX.Y.Z+1
```

## Pre-release

```bash
git tag vX.Y.Z-alpha.1 && git push origin vX.Y.Z-alpha.1
# later, promote to rc:
git tag vX.Y.Z-rc.1 && git push origin vX.Y.Z-rc.1
# promote to stable:
git tag vX.Y.Z && git push origin vX.Y.Z
```

Pre-release tags **do not** update `latest`.

## CI gates for a tag

- **`config:changelog`** — validates that every tag has a matching
  `[X.Y.Z]` entry in `CHANGELOG.md`. Tags without a changelog entry fail.
- **Build → scan → promote** — the same pipeline as a normal MR, plus the
  promote job that retags tested digests to deployable tags (`main`, the
  release branch, `latest`).

## Rules

- **Never commit directly to `main` or `release/*`** — use MRs.
- **Never develop on release branches** — fix on `main`, cherry-pick.
- **Tags always use the `v` prefix** — `v2.1.0`, not `2.1.0`.
- **One `release/X.Y` per MINOR series** — all PATCH tags on the same branch.
- **Changelog entry required for every tag** — the `config:changelog` job
  enforces it.

## Related

- [How to open a MR](/docs/contribute/how-to-mr/)
- [Dev workflow](/docs/contribute/dev-workflow/)
- [Internal → RELEASE.md](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/docs/RELEASE.md)