# Release Guide — Design Spec

## Scope

Create `docs/RELEASE.md`: comprehensive release process guide for GENIE.AI developers.
CI changes tracked separately (`.promote_template` pre-release fix, changelog validation job,
GitLab Release job).

## Deliverables

1. **`docs/RELEASE.md`** — release process guide
2. **`CHANGELOG.md`** — update to Keep a Changelog 2.0.0 format (was 1.1.0)

## Guide Structure

1. **Versioning** — SemVer 2.0.0, `v` prefix, pre-release tags (`-alpha.N`, `-beta.N`, `-rc.N`)
2. **Branching Model** — Trunk-Based Development (`main` = trunk, `release/*` = stabilization, short-lived feature branches)
3. **Changelog** — Keep a Changelog 2.0.0, `[Unreleased]` section, six change types, `**Breaking:**` marker
4. **Release Workflow** — step-by-step: prepare → tag → verify CI → deploy
5. **Pre-releases** — alpha/beta/rc cycle, CI skips `latest` tag for pre-releases
6. **Hotfix** — fix on `main`, cherry-pick to `release/*`, tag PATCH from `main`
7. **Checklist** — per-step checkbox table
8. **References** — SemVer, Keep a Changelog, Trunk-Based Development

## Key Decisions

- **Doc location**: `docs/RELEASE.md` (dev-internal). Not published to docs site.
- **Hotfix flow**: TBD-compliant — source of truth is `main`, not the tag.
- **Tag convention**: `vMAJOR.MINOR.PATCH` (e.g., `v2.0.0`, `v2.0.0-rc.1`). Matches registry cleanup `v.*`.
- **Docker images = only deliverables**. No npm/PyPI/pub.dev publishing. Component `package.json` versions are informational only.
- **CI changes described in guide, not implemented here**. Separate MR for `.gitlab-ci.yml`.

## Out of Scope

- CI modifications (`.gitlab-ci.yml` changes)
- Automated version bump scripts
- Git tag signing / GPG
- Deployment automation changes
