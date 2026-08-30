# Docs site — local development

The GENIE.AI docs site is a Hugo + Docsy project in `site/`, published to GitLab
Pages by the `pages:` job (`.gitlab-ci.yml`). The `pages` job runs **on `main`
only** — there is no MR build-check, so **verify locally before pushing**.

## Prerequisites

```bash
hugo version    # must be +extended (Docsy SCSS pipeline). Local: ~/.local/bin/hugo (0.163.3).
go version      # ≥ 1.21 — resolves the Docsy Hugo Module.
node --version  # ≥ 18 — Docsy PostCSS asset pipeline.
```

One-time, in `site/`: `npm install` (PostCSS deps) + ensure `package.json`
exists locally (`cp package.hugo.json package.json` if missing — it's gitignored).

## Run locally

```bash
cd site
hugo server -D                       # http://127.0.0.1:1313  (-D includes drafts)
```

Production-equivalent build:

```bash
cd site
hugo --gc --minify --destination /tmp/genie-build
```

## Where docs live

Docs are **curated and committed directly** under `site/content/en/docs/`,
grouped by section (`core/`, `frontend/`, `backend/`, `mobile/`, `architecture/`,
`deployment/`, `configuration/`). There is **no build-time copy script** —
`site/content/en/docs/` is the source for the site. (The repo-root `docs/`
remains the developer reference.)

### Add a doc

1. Create `site/content/en/docs/<section>/<name>.md`.
2. Front matter (required — Docsy needs it):
   ```yaml
   ---
   title: "Human Title"
   weight: 5          # order in the sidebar, within the section
   description: "One-line summary."
   ---
   ```
3. Internal links use the site path, not repo relative paths:
   `](/docs/<section>/<name>/)` — e.g. `](/docs/deployment/docker-compose-setup/)`.
4. Each section has an `_index.md` landing (weight sets section order:
   core=1 … configuration=7). The portal landing is `content/en/docs/_index.md`.

## Theming

- Design tokens (OKLch, light + dark): `site/assets/scss/_tokens.scss`.
- Bootstrap SCSS overrides (hex, BS-color-safe): `site/assets/scss/_variables_project.scss`.
- Component restyle + landing: `site/assets/scss/_custom.scss`.
- Dark mode uses Bootstrap 5.3 color modes (`data-bs-theme`), bridged to the DS
  tokens via `--bs-body-*` mappings in `_tokens.scss`.
- Self-hosted fonts: `site/static/fonts/` (Inter, JetBrains Mono).

## Publish

Push to `main` → the `pages:` job builds + publishes to the GitLab Pages URL.
MRs do **not** trigger a build-check — run `hugo` locally before merge.
