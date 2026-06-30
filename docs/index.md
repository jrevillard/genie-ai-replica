# GENIE.AI documentation

## User documentation (published)

User-facing documentation lives in [`site/content/en/docs/`](../site/content/en/docs/) and is
published to the GENIE.AI docs site:

**→ https://genie-ai-7e342b.opensource.unicc.org/docs/**

Sections: Core · Frontend · Backend · Mobile · Architecture · Deployment · Configuration.

To edit user docs, change files under `site/content/en/docs/` — the GitLab Web IDE works fine
(no local build needed to fix content; run `hugo server` locally to preview layout).

## Developer-internal documentation (this directory)

These docs stay in the repo (not published on the site) — referenced by code and developers:

- [database-migrations.md](./database-migrations.md) — ArangoDB migration runbook
- [roadmap-sprint-20-to-25.md](./roadmap-sprint-20-to-25.md) — sprint roadmap
- [adr/](./adr/) — architecture decision records
- [e2e-tests/](./e2e-tests/) — end-to-end test procedures
- [superpowers/](./superpowers/) — workflow / design specs

## Rule

- **User-facing docs** → `site/content/en/docs/` (canonical, published, GitLab-UI-editable).
- **Dev-internal docs** → `docs/` (canonical, repo-resident).
- A document lives in exactly one place. No duplication, no build-time copy.
