---
title: "Add a new doc to this site"
weight: 4
description: "Docsy frontmatter, Diataxis mode, weights, related links, and the cross-link audit."
mode: how-to
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

Add a new page to this site **without breaking the sidebar order or the
cross-link audit**, and have it picked up by the next Hugo build.

## Where docs live

User-facing docs go under `site/content/en/docs/<section>/<slug>.md`. The
15 sections are listed on the [root landing](/docs/):

| Section | When to add here |
|---|---|
| `get-started/` | Quickstarts, concepts, glossary, FAQ |
| `architecture/` | System design, trust boundaries, OPEA contract |
| `core/` | Foundational concepts shared across components |
| `deploy/` | Install recipes (Compose, Swarm, GPU, A40) |
| `operate/` | Day-to-day ops (backup, scaling, updates, troubleshooting) |
| `observe/` | Metrics, logs, traces, dashboards, alerting |
| `configure/` | Realm, IdP, banners, CORS / CSP, locale whitelist |
| `rag-pipeline/` | RAG stages: embedding, retrieval, reranking, generation, translation |
| `knowledge-base/` | Ingestion, taxonomy, document lifecycle, content quality |
| `backend/` | HTTP API contracts |
| `frontend/` | Vue SPA: auth, chat, sidebar, admin, theming |
| `mobile/` | Flutter app |
| `reference/` | Canonical tables (env-vars, API, OPEA extensions, glossary) |
| `contribute/` | Repo, workflow, MR, i18n, security triage, style |
| `audit/` | Internal docs-audit artifacts (weight 999, last section in nav) |

Dev-internal docs go under `docs/` — they are **not published**.

## Frontmatter

Every doc uses the extended Docsy frontmatter:

```yaml
---
title: "Human-readable title"
weight: <int>           # render order within section (1, 2, 3, …)
description: "≤160 chars, SEO + landing card"
mode: how-to  # one of: tutorial | how-to | reference | explanation
persona: user|deployer|developer|contributor|mixed
owner: "<team or doc-lead>"
last_reviewed: 2026-09-18   # quarterly review stamp
aliases:                    # optional, for renames
  - /docs/old/path/
---
```

- **Mode** is mandatory. Pick the Diataxis quadrant:
  - `tutorial` — sequenced lesson with a single end goal.
  - `how-to` — numbered procedure to achieve a specific goal.
  - `reference` — exhaustive lookup.
  - `explanation` — design rationale and trade-offs.
- **Persona** picks the section's primary audience. Use `mixed` when the
  page genuinely serves several.
- **Owner** is a handle, not a person's name (rotates). Pages without an
  owner are surfaced in the next retrospective as "needs steward".
- **`last_reviewed`** is the quarterly stamp; the footer renders it.
- **`weight`** orders pages in the sidebar within a section. Lower = higher.

## Sidebar weight order

Section weights (`_index.md` `weight:`) follow the IA spec:

| Section | weight |
|---|---|
| `get-started/` | 1 |
| `deploy/` | 10 |
| `operate/` | 20 |
| `observe/` | 30 |
| `configure/` | 40 |
| `architecture/` | 50 |
| `core/` | 55 |
| `rag-pipeline/` | 60 |
| `knowledge-base/` | 70 |
| `backend/` | 80 |
| `frontend/` | 90 |
| `mobile/` | 100 |
| `contribute/` | 110 |
| `reference/` | 120 |
| `audit/` | 999 (last in nav) |

## Required components per page

Every page MUST include, in order:

1. **Frontmatter** (above).
2. **Lead paragraph** — 1–2 sentences stating the goal / task / scope /
   question. Avoid encyclopedic openers.
3. **Prerequisites** callout — `{{</* callout type="info" */>}}` with accounts,
   env vars, secrets, hardware.
4. **Auto-TOC** — Docsy default, truncated at `h3` in `_config.toml` /
   shortcode config.
5. **Content blocks** — prefer Docsy shortcodes (`{{</* callout */>}}`,
   `{{</* tabs */>}}`, `{{</* cards */>}}`).
6. **Code blocks** — always include the language tag; show expected output
   on the next line in a comment.
7. **Verify step** — at least one runnable check (`curl`, `docker compose ps`,
   an admin endpoint).
8. **Troubleshooting mini-section** — 2–5 "If X, then Y" lines.
9. **Related links** — `{{</* related */>}}` shortcode at the bottom with 3–5
   sibling docs using absolute paths (`/docs/<section>/<slug>/`).
10. **Last-updated stamp** — auto-rendered from `last_reviewed`.
11. **Contributing link** — every page links to
    `/docs/contribute/how-to-mr/`.

## Related sections

The cross-link audit checks every rewritten doc for 2–5 Related entries.
Pattern:

```markdown
## Related

- [Sibling in same section](/docs/<section>/<slug>/) — one-line why
- [Sibling in adjacent section](/docs/<other-section>/<slug>/) — one-line why
- [Reference → Glossary](/docs/reference/glossary/) — when in doubt, link to the glossary
```

## Validate locally

```bash
cd site
hugo server -D                       # http://127.0.0.1:1313
hugo --gc --minify --destination /tmp/genie-build
```

Then check:

- The sidebar shows your page in the right slot.
- All internal links resolve (no 404).
- The mode badge renders in the header.
- The `Related` block shows 3–5 entries.

## Submit

```bash
git checkout -b docs/<handle>/<section>-<slug>
git add site/content/en/docs/<section>/<slug>.md
git commit -m "docs(<section>): add <slug> — <one-line why>"
git push -u origin docs/<handle>/<section>-<slug>
glab mr create --target-branch main
```

## Related

- [How to open a MR](/docs/contribute/how-to-mr/)
- [Style guide](/docs/contribute/style-guide/)
- [Site local dev](/.claude/rules/SITE-LOCAL-DEV.md) (internal)