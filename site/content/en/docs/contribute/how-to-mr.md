---
title: "How to open a MR"
weight: 1
description: "The full contribution checklist — branch policy, MR template, CI gates, and merge rules."
mode: how-to
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

Open a merge request (MR) against the upstream `un/itu/genie-ai` project on
GitLab that **passes CI on the first push** and lands within a single review
cycle.

## Branch policy

| Rule | Reason |
|---|---|
| One MR per logical change | Easier to revert, easier to bisect |
| Branch name: `<type>/<scope>-<summary>` (e.g. `feat/admin-logs-tags`, `fix/mobile-i18n-crash`, `docs/clarify-rag-overrides`) | Consistent, greppable history |
| Base branch: `main` for features; `release/X.Y` for PATCHes | Trunk-based for features; cherry-pick for fixes |
| Rebase before review | No `Merge branch 'main' into ...` noise in the diff |
| Squash-merge at landing | One commit per MR in `main` |

**Never** push directly to `main` or `release/*`. Branch protection rejects
the push.

## MR template

GitLab auto-fills the template when you check the **Description** box. If it
doesn't, copy this:

```markdown
## What & why
<!-- One paragraph: what the change does and why it's needed. -->

## How to test
<!-- Steps a reviewer can run to validate the change. -->
<!-- Include expected output for the non-obvious steps. -->

## Related
<!-- Closes #<issue>, relates to !<MR>, ... -->

## Checklist
- [ ] Lint passes locally (`npm run lint`, `npm run lint:py`, `npm run lint:dart`)
- [ ] Tests added / updated for the change
- [ ] Docs updated if user-facing behaviour changes
- [ ] `CHANGELOG.md` updated under `[Unreleased]` (use `Added` / `Changed` / `Fixed` / etc.)
- [ ] No secrets committed
```

## CI gates (must pass before merge)

The pipeline stages run in this order. A merge is blocked if any mandatory
stage fails.

| # | Stage | What it runs | Block on fail? |
|---|---|---|---|
| 1 | **lint** | ESLint (JS), Ruff (Python), Prettier format checks | yes |
| 2 | **test** | Jest (backend, frontend, doc-repo), pytest (OPEA), flutter_test (mobile) | yes |
| 3 | **config** | `config:validate`, `config:changelog`, `verify:overlay-locks:*` | yes |
| 4 | **build** | Publish candidate images to GitLab Container Registry | yes |
| 5 | **scan** | Trivy container scanning | yes |
| 6 | **contract-in-image** | Contract tests vs REAL vendored comps (run inside the built image) | yes |
| 7 | **e2e** | Playwright suite against deployed infrastructure | merge_train + scheduled |
| 8 | **promote** | Retag tested digests to deployable tags | yes (main/tags) |
| 9 | **release** | Create GitLab Release from changelog | yes (tag pipelines only) |

## Merge rules

- **Squash-merge** to keep `main` history one-commit-per-MR.
- **Title** = conventional-commit subject (`feat: …`, `fix: …`, `docs: …`,
  `chore: …`, `ci: …`).
- **Delete the source branch** after merge (the template does this
  automatically).
- **Backports** to `release/X.Y` are cherry-picks — open a separate MR with
  the `[BACKPORT]` tag in the title.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| MR pipeline stuck on `pending` | Runner offline | Check `glab ci status`; ping a maintainer |
| `lint` fails on `prettier` | Unformatted code | `npm run format` then re-push |
| `test` fails on a single test you didn't touch | Flaky test (most often backend `supertest`) | Re-run the job; if persistent, fix the flake in a separate MR |
| `verify:overlay-locks:retriever` (or `:reranker`) fails | `genie-ai-overlay/<module>/requirements-cpu.txt` out of date | `cd genie-ai-overlay/<module> && make lock-<module>` (requires `uv`); commit the regenerated `requirements-cpu.txt` |
| Reviewer requests changes after 5 days | Normal cadence | Ping a maintainer or self-merge after rebase |

## Related

- [Dev workflow](/docs/contribute/dev-workflow/)
- [Style guide](/docs/contribute/style-guide/)
- [Release process](/docs/contribute/release-process/)
- [Report a problem with these docs](/docs/contribute/how-to-mr/)