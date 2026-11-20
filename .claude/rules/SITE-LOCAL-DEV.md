# Docs site — local development (stub)

Full procedure: `docs/site-local-dev.md` — prerequisites (extended
hugo, go ≥ 1.21, node ≥ 18), `hugo server -D`, adding a doc, the CI
link checker (`node scripts/check-links.mjs`), interactive
presentations, theming tokens, publish.

Hard rule: the `pages:` job runs on `main` only — there is NO MR
build-check, so run `hugo` locally before pushing any `site/` change.
Internal links use the site path `](/docs/<section>/<name>/)`, not
repo-relative paths.
