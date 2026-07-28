# Release Process — Agent Instructions

For the release process reference, see `docs/RELEASE.md`. This file provides
the step-by-step commands an AI agent needs to execute a release.

## Standard Release (MAJOR/MINOR)

1. **Determine version** from `[Unreleased]` in `CHANGELOG.md`.
   Breaking → MAJOR, features → MINOR, fixes → PATCH. Confirm with user.

2. **Update changelog on `main`:**
   - Rename `[Unreleased]` → `[X.Y.Z]` with today's date
   - Add fresh `[Unreleased]` section
   - Update reference links at bottom
   - Commit + push (via MR if required)

3. **Create release branch:**
   ```bash
   git checkout main && git pull origin main
   git checkout -b release/X.Y && git push origin release/X.Y
   ```

4. **Tag and push** (triggers CI):
   ```bash
   git checkout release/X.Y && git pull origin release/X.Y
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

5. **Verify:** pipeline green, 16 Docker images tagged `vX.Y.Z`, GitLab Release
   created, `latest` Docker tag updated.

## PATCH Release

Fix on `main` first, then cherry-pick to `release/X.Y`. See `docs/RELEASE.md` §6
for the full flow.

```bash
# 1. Fix on main (MR)
git checkout -b fix/<desc>
# ... implement, add changelog under [Unreleased] ...
# Merge MR

# 2. Cherry-pick to release branch
git checkout release/X.Y && git pull origin release/X.Y
git cherry-pick <sha-from-main>

# 3. Move changelog entry from [Unreleased] to new [X.Y.Z+1] section on release branch
# 4. Tag
git tag vX.Y.Z+1 && git push origin release/X.Y vX.Y.Z+1
```

## Pre-release

```bash
# Add changelog entry first, then:
git tag vX.Y.Z-alpha.1 && git push origin vX.Y.Z-alpha.1

# Promote to stable:
git checkout vX.Y.Z-rc.1 && git log -1 --format="%H %s" vX.Y.Z-rc.1
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Key Rules

- **Never commit to `main` or `release/*` directly** — use MRs
- **Never develop on release branches** — fix on `main`, cherry-pick to `release/*`
- **Tags always `v` prefix** — `v2.1.0` not `2.1.0`
- **One `release/X.Y` per MINOR series** — all PATCH tags on same branch
- **Changelog entry required for every tag** — CI validates (`config:changelog` job)
- **Pre-release tags skip `latest`** — `v2.1.0-alpha.1` does not update `latest`

## Reference

Full documentation with rationale, diagrams, and CI details: `docs/RELEASE.md`.
