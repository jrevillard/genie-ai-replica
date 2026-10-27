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

It fails on:

- a link whose target does not exist — Markdown link, raw-HTML `href`, or
  reference-style definition;
- a link that only resolves through a redirect: the reader lands on a
  redirect hop and the URL bar shows a path that is not the page's address;
- a link whose anchor does not exist on the target page (the heading was
  renamed) — the checker reproduces Hugo's own anchor algorithm;
- a `relref` shortcode that points at a page that does not exist;
- a section that declares a `slug:` — a section slug makes the published URL
  family depend on the Hugo version, and CI builds from a floating Hugo image;
- a site configuration the checker cannot model (`permalinks`, `uglyURLs`, a
  non-default anchor style, more than one language).

Hugo rewrites a Markdown link that points at a content path, but never
rewrites a raw-HTML `href` — that is why both forms are checked.

The scripts are formatted with Prettier by `lint:site-scripts` (stage
`lint`), using the Prettier version pinned in `components/shared/lib`.

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
