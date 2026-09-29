---
title: "Quickstart: Contributor — open your first MR in 10 minutes"
weight: 5
description: "Open a merge request against GENIE.AI — fork, branch, write a test, push, and request review."
mode: tutorial
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

In 10 minutes you will have **forked the repo, opened a merge request that
passes CI on a one-line change, and assigned it to a maintainer**.

## Prerequisites

- A **GitLab account** (sign up at
  [opensource.unicc.org](https://opensource.unicc.org)).
- **git 2.40+** locally.
- **glab CLI** authenticated (`glab auth login --hostname opensource.unicc.org`).
- The repository cloned (see the deployer quickstart, step 1).

> {{< callout type="tip" >}}
> The contributor workflow is **trunk-based with feature branches**: every
> change lands through a merge request on the upstream
> `un/itu/genie-ai` project. Direct pushes to `main` or `release/*` are
> rejected by branch protection. See
> [Contribute → How to open a MR](/docs/contribute/how-to-mr/).
> {{< /callout >}}

## Step 1 — Fork and clone

If you don't already have a fork:

```bash
glab repo fork un/itu/genie-ai --remote
git remote -v
# origin  git@opensource.unicc.org:<you>/genie-ai.git
# upstream    opensource.unicc.org:un/itu/genie-ai.git (fetch)
```

`upstream` is configured by `--remote`. If you forked via the web UI, add it
manually:

```bash
git remote add upstream https://opensource.unicc.org/un/itu/genie-ai.git
```

## Step 2 — Create a feature branch and a tiny change

```bash
git checkout main
git pull upstream main
git checkout -b docs/<your-handle>/one-typo-fix
```

Make a one-line typo fix in any `.md` file under `docs/` or `site/content/`.
Save it. Stage and commit:

```bash
git add site/content/en/docs/<file>.md
git commit -m "docs: fix typo in <page>"
git push -u origin docs/<your-handle>/one-typo-fix
```

**Verify** — the push succeeds and the URL `https://opensource.unicc.org/<you>/genie-ai/-/tree/docs/<your-handle>/one-typo-fix`
shows your change.

## Step 3 — Open the MR and watch CI

```bash
glab mr create --target-branch main \
  --title "docs: fix typo in <page>" \
  --description "Resolves #<issue>." \
  --remove-source-branch --squash-before-merge
```

CI will run lint → test → config → build → scan. The MR is **mergeable**
once the pipeline is green and a maintainer approves.

**Verify** — the MR shows `Pipeline: passed` and `Merge: ready`. If CI fails,
read the failed job's log; the most common cause on a docs-only MR is a
formatting nit (Prettier / Ruff).

## What's next

- **Read the contribution checklist** —
  [Contribute → How to open a MR](/docs/contribute/how-to-mr/).
- **Set up your dev environment** —
  [Contribute → Dev workflow](/docs/contribute/dev-workflow/).
- **Add a translation** —
  [Contribute → i18n contribution](/docs/contribute/i18n/).
- **Triage a CVE finding** —
  [Contribute → Security triage](/docs/contribute/security-triage/).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `glab mr create` asks for an SSH password | glab not authenticated | `glab auth login --hostname opensource.unicc.org` |
| CI fails on `lint` | Prettier / Ruff found a style nit | `npm run format && npm run format:py` then re-push |
| CI fails on `verify:overlay-locks:retriever` or `verify:overlay-locks:reranker` | `genie-ai-overlay/{retriever,reranker}/requirements-cpu.txt` out of date | Run `make lock-retriever` or `make lock-reranker`, commit the updated `requirements-cpu.txt`, and re-push. See [Contribute → Dev workflow](/docs/contribute/dev-workflow/#dependencies) |
| MR shows `Draft` | Template didn't auto-fill | Add the **What & why** + **How to test** sections manually |
| Branch protection blocked your push to `main` | Expected — never push to protected branches | Open a MR instead |

## Related

- [Contribute → How to open a MR](/docs/contribute/how-to-mr/)
- [Contribute → Repo layout](/docs/contribute/repo-layout/)
- [Contribute → Dev workflow](/docs/contribute/dev-workflow/)
- [Contribute → Style guide](/docs/contribute/style-guide/)
- [Report a problem with these docs](/docs/contribute/how-to-mr/)