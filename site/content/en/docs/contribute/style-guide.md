---
title: "Style guide"
weight: 8
description: "Language policy, voice, code blocks, headings, and the doc-audit checklist."
mode: reference
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Language policy

**English only** for all documentation, comments, code, variable names, and
user-facing text. Exceptions:

- i18n translation files under `components/gov-chat-frontend/src/i18n/locales/*.js`
  and `mobile/genie_ai_mobile/lib/src/localization/app_*.arb` are intentionally multilingual.
- Translators' commit messages may use any language.
- Conversation with the user may be in their preferred language — this is
  meta-documentation, not site content.

## Voice

- **Imperative** for steps ("Run `npm test`", not "You should run the
  tests").
- **Active** voice preferred ("the operator scales the service", not "the
  service is scaled by the operator").
- **Second person** sparingly ("you" only when the reader is the subject of
  the action).
- **Avoid hype** ("blazing fast", "next-gen") — describe what it does and
  what it enables.
- **No emoji** in technical docs.

## Headings

- **Title case** for H1–H2. Sentence case for H3+.
- **One H1 per page** (Docsy auto-derives from `title:`).
- **Avoid** "Introduction", "Overview", "Conclusion" — describe what the
  section *does*.

## Code blocks

- Always include the language tag (`bash`, `python`, `yaml`, `json`,
  `typescript`, `vue`, `dart`, `sql`).
- For shell blocks, **always show expected output** on the next line in a
  comment:
  ```bash
  docker compose ps
  # NAME                SERVICE             STATUS              PORTS
  # genieai-nginx-1     nginx               running (healthy)   0.0.0.0:443->443/tcp
  ```
- Use Docsy shortcodes (`{{</* callout */>}}`, `{{</* tabs */>}}`, `{{</* cards */>}}`)
  instead of hand-rolled HTML where possible.

## Callouts

- `type="info"` — prerequisites, neutral context.
- `type="tip"` — non-obvious shortcut.
- `type="warning"` — operationally dangerous trap (do not ignore).

## Tables

- Use tables for **parallel data** (env vars, error codes, model names).
- Avoid tables for narrative content — use a list.
- Always include a header row.

## Links

- **Internal links**: absolute path (`/docs/<section>/<slug>/`).
- **Cross-section links**: prefer the most specific page.
- **External links**: full URL with scheme; HTTPS only.
- Never link to a heading anchor in another doc — those drift.

## Frontmatter

See [Add a new doc](/docs/contribute/add-a-doc/). Mandatory fields:

```yaml
title: "..."
weight: <int>
description: "..."
mode: tutorial|how-to|reference|explanation
persona: user|deployer|developer|contributor|mixed
owner: "<team>"
last_reviewed: YYYY-MM-DD
```

## Anti-patterns to avoid

- **Encyclopedic openers** — lead with the goal / task / scope.
- **Section drift** — reference numbers ("Section 17") that don't exist
  anymore. Reference by *name* and link to the canonical page.
- **Hand-typed env-var tables** — use the
  [reference/env-vars/](/docs/reference/env-vars/) page; if a value differs
  there, fix the source rather than the doc.
- **Invented endpoints** — only document endpoints that exist in
  `components/gov-chat-backend/routes/*.js`.
- **Per-file path tables** without a "verified by" stamp — they rot fast.
- **"Now it should work"** — every procedure ends with a runnable check.
- **Component inventory ≠ component guide** — a flat list is not docs;
  write a per-component narrative with code, props, and example.

## Review checklist

Before merging a doc MR:

- [ ] Lead paragraph states the goal or scope.
- [ ] Prerequisites callout is present when relevant.
- [ ] Every code block has a language tag.
- [ ] Every procedure has at least one verify step.
- [ ] Every procedure has a troubleshooting mini-section (2–5 entries).
- [ ] Related links block at the bottom (3–5 entries, absolute paths).
- [ ] `mode`, `persona`, `owner`, `last_reviewed` set in frontmatter.
- [ ] No dead links (`hugo` build prints broken-link warnings; fix or
      add an alias).
- [ ] No invented endpoints or paths (grep the source if in doubt).
- [ ] No emoji.
- [ ] No "Section N" references that don't exist.

## Related

- [Add a new doc](/docs/contribute/add-a-doc/)
- [How to open a MR](/docs/contribute/how-to-mr/)
- [Diataxis framework](https://diataxis.fr/) — the quadrant taxonomy
- [Docsy shortcodes](https://www.docsy.dev/docs/adding-content/shortcodes/) — the visual primitives