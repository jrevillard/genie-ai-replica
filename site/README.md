# GENIE.AI documentation site (Hugo + Docsy)

Published to GitLab Pages: <https://genie-ai-7e342b.opensource.unicc.org/>

## Prerequisites

- **Hugo extended** (≥ 0.158.0) — Docsy (pinned to `/theme` HEAD) requires a recent
  Hugo and needs the extended SCSS pipeline.
  Check: `hugo version` must contain `+extended`.
- **Go** ≥ 1.21 — resolves the Docsy Hugo Module.
- **Node.js** ≥ 18 + npm — Docsy PostCSS/PurgeCSS asset pipeline.

> **Note:** CI uses the `hugomods/hugo:exts` image (latest stable) which always
> satisfies the floors above.

## Local preview

```bash
cd site
npm install               # Docsy PostCSS/PurgeCSS deps (first run only)
sh scripts/sync-docs.sh      # copy curated docs/*.md -> content/en/docs/
hugo server -D               # http://127.0.0.1:1313  (-D includes drafts)
```

## How docs are sourced

Doc content is **copied, not committed**, into `content/en/docs/` by
`scripts/sync-docs.sh`. The source of truth is the repo-root `docs/` directory.

- **To publish a new doc:** add a `cp` line to `scripts/sync-docs.sh`.
- **To edit a doc:** edit the file under the repo-root `docs/`, not under `site/`.
- `content/en/docs/` is gitignored — never commit files there.

## i18n

English only at launch (`defaultContentLanguage = "en"`). To add a language:
add a `[languages.<code>]` block in `hugo.toml`, mirror `content/en/` to
`content/<code>/`, and translate. The English tree is untouched.
