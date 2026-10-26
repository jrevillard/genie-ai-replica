# GENIE.AI documentation site (Hugo + Docsy)

Published to GitLab Pages: <https://genie-ai-7e342b.opensource.unicc.org/>

## Prerequisites

- **Hugo extended** (≥ 0.146.0; CI runs 0.154.5 via `hugomods/hugo:exts`) — Docsy needs
  the extended SCSS pipeline. Check: `hugo version` must contain `+extended`.
- **Go** ≥ 1.21 — resolves the Docsy Hugo Module.
- **Node.js** ≥ 18 + npm — Docsy PostCSS/PurgeCSS asset pipeline.

> **Note:** CI uses the `hugomods/hugo:exts` image. That image currently ships Hugo
> 0.154.5 (the maintainer lags upstream Hugo releases), so Docsy is pinned to a `/theme`
> commit compatible with 0.154.5 rather than the latest HEAD (which needs Hugo ≥ 0.158).

## Local preview

```bash
cd site
npm install               # Docsy PostCSS/PurgeCSS deps (first run only)
hugo server -D               # http://127.0.0.1:1313  (-D includes drafts)
```

## Link check

Internal links are checked by a dependency-free script that runs in CI
(`config:docs-links`, stage `config`):

```bash
cd site
node scripts/check-links.mjs            # report broken / redirect-only links
node scripts/check-links.mjs --fix      # rewrite the links that can be repaired
node --test scripts/check-links.test.mjs
```

It fails on a link whose target does not exist, on a link that only resolves
through a redirect, on a raw-HTML `href` that Hugo cannot rewrite, and on a
section that declares a `slug:` — a section slug makes the published URL
family depend on the Hugo version, and CI builds from a floating Hugo image.

Hugo shortcodes (`{{< relref >}}`) are resolved by Hugo itself: a target that
no longer exists fails the `pages` build, so they need no checker rule.

## How docs are sourced

The published doc content is curated and committed directly under
`content/en/docs/`, grouped by section (`core/`, `frontend/`, `backend/`,
`mobile/`, `architecture/`, `deployment/`, `configuration/`, …).

- **To publish a new doc:** create `content/en/docs/<section>/<name>.md` with
  the front matter Docsy needs (`title`, `weight`, `description`).
- The repo-root `docs/` directory holds the developer-internal references
  (E2E procedures, release process, triage records). It is not published.

## i18n

English only at launch (`defaultContentLanguage = "en"`). To add a language:
add a `[languages.<code>]` block in `hugo.toml`, mirror `content/en/` to
`content/<code>/`, and translate. The English tree is untouched.
