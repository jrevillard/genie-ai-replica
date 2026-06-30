# Hugo + Docsy Documentation Site — Design Spec

- **Date:** 2026-06-29
- **Branch:** `feat/hugo-docs-site` (worktree `../genie-ai-hugo-site`)
- **Status:** Approved (brainstorming complete) → ready for implementation plan
- **Target:** GitLab Pages on `https://genie-ai-7e342b.opensource.unicc.org/`

> Note: this spec lives under `docs/superpowers/` and is **excluded** from the site
> content mounts (curated mounts only, see §3). It is a design artifact, not a
> published doc page.

## 1. Purpose & Audience

Build a single static site that serves two roles:

- **Public landing** — showcase GENIE.AI (sovereign, DPG-compliant RAG framework for
  the public sector, OPEA-integrated, multilingual) for external evaluators and
  adopters.
- **Curated docs portal** — consolidated reference for implementers and the internal
  team (architecture, setup, integration, deployment).

Source of truth for doc content = existing markdown in the main repository. The site
**renders** those docs; it does not become a second copy.

## 2. Stack Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Generator | **Hugo** (extended) | Fast, single binary, GitLab Pages first-class support |
| Theme | **Docsy** (Google) | Landing + docs in one, built-in nav/search/i18n/versioning hooks |
| Theme install | **Hugo Module** (`hugo mod`), **pinned to a tag** (e.g. `github.com/google/docsy@v0.11.0`) | Canonical; reproducible via `go.mod`/`go.sum`; no submodule init pitfalls; built-in asset mounts. Pin at init — Docsy has had breaking SCSS/JS changes between minors (Bootstrap 5 migration) |
| Hosting | **GitLab Pages** (self-hosted `opensource.unicc.org`) | Already enabled on project; unique domain provisioned |
| baseURL | `https://genie-ai-7e342b.opensource.unicc.org/` | Root domain (no subpath) → simpler relative URLs |
| Languages | **English only** at launch, i18n scaffolded | Per project rule: English is source of truth |
| Versioning | **Git-tracked** (latest = `main`) | Zero effort; Docsy version dropdown deferred to tagged-release era |

## 3. Repository Layout

New `site/` directory at repo root. Main repo structure is **untouched** except for
the new directory and one CI job.

```
site/
├── hugo.toml              # baseURL, module, mounts, menus, params, [languages]
├── go.mod                 # module: gitlab.com/un/itu/genie-ai/site
├── go.sum
├── content/
│   └── en/                # defaultContentLanguage = "en"
│       ├── _index.md      # landing (Docsy blocks: hero, features, CTA)
│       ├── about.md       # project overview (curated, hand-written)
│       └── docs/          # POPULATED BY COPY SCRIPT (see below); gitignored
├── layouts/
│   └── partials/          # brand overrides (logo, navbar, footer) — shadow Docsy
├── assets/
│   ├── scss/
│   │   └── _variables_project.scss   # brand colors, shadows Docsy defaults
│   └── images/            # logo, og-image
├── i18n/
│   └── en.toml            # Docsy ships this; UI strings
└── static/
    └── favicon.ico
```

### Doc integration — build-time copy script (single source of truth)

Doc bodies are **copied into the site at build time**, not committed and not Hugo
module-mounted. Rationale: Hugo module mounts do **not** reliably support `../`
paths escaping the module directory (the `site/` root) — that traversal is
undocumented and breaks unpredictably across Hugo versions and CI filesystems.
The robust, standard pattern is an explicit copy step.

`site/scripts/sync-docs.sh` (run before `hugo`):
```bash
#!/usr/bin/env sh
# Curated doc allowlist. Add a line to publish a doc; remove to unpublish.
# Missing source file = cp error = loud CI failure (no silent empty pages).
set -eu
DEST="content/en/docs"
mkdir -p "$DEST"

cp ../site/content/en/docs/architecture/architecture.md           "$DEST/architecture.md"
cp ../site/content/en/docs/deployment/docker-compose-setup.md   "$DEST/deploy.md"
cp ../site/content/en/docs/deployment/docker-swarm-setup.md     "$DEST/deploy-swarm.md"
cp ../site/content/en/docs/core/integration-architecture.md "$DEST/integration.md"
cp ../docs/database-migrations.md    "$DEST/database-migrations.md"
# ... explicit list, refined iteratively
```

- `site/content/en/docs/` is in `site/.gitignore` → copied output is never committed;
  the canonical source remains `docs/*.md` in the repo root. Zero drift.
- A missing source = `cp` fails loudly (unlike a missing Hugo mount source, which
  silently renders an empty page).
- Hugo module mounts are used **only** for the Docsy theme, not for content files.
- To add a language later, add a second target dir (`content/es/docs/`) and ES
  source files (see §5).

**Excluded by design** (never copied): `docs/superpowers/`, `docs/e2e-tests/`
internals, `_bmad-output/`, `_bmad/`, `tests/`, `.claude/`, mobile SDK docs (curated
subset deferred).

## 4. Landing Page

Docsy `blocks/hero` + `blocks/feature` + `blocks/cta` shortcodes in
`content/en/_index.md`:

- **Hero** — title, sovereign-RAG pitch, two buttons (Get Started → `/docs/deploy`,
  Learn More → `/about`).
- **Features** (3–4 cards) — DPG-compliant, Multilingual, OPEA-integrated, Sovereign
  deployment.
- **CTA** — contribution / adoption call to action.

Brand identity via `assets/scss/_variables_project.scss` overriding Docsy's
`$primary` etc. Logo in `assets/images/`. Footer override in
`layouts/partials/footer.html`.

## 5. Internationalization (scaffold only)

```toml
defaultContentLanguage = "en"
[languages.en]
  languageName = "English"
  weight = 1
# [languages.es] added later; switcher auto-appears when >=2 langs
```

Two layers (per Docsy):

| Layer | Files | Launch |
|---|---|---|
| Content | `content/<lang>/*.md` | EN only |
| UI strings | `i18n/<lang>.toml` | EN (Docsy `en.toml`) |

**Adding ES later is additive** — no EN rework:
1. Add `i18n/es.toml` (Docsy may ship it; ~20 UI strings).
2. Mirror `content/en/` → `content/es/`; translate per-doc, or mount translated
   copies from a new `docs/es/` source dir.
3. Language switcher auto-appears in nav.

No English mounts change when ES is added.

> **Caveat:** the i18n *scaffolding* is structural and cheap. An actual ES launch
> also requires **translated content** for every published doc (the repo is
> English-only today) — that is the expensive part and is explicitly out of scope
> for this initiative (§9).

## 6. CI — `pages:` job

Add a `pages` job to the existing `.gitlab-ci.yml`. GitLab Pages requires a job named
exactly `pages` whose artifact `paths` includes `public/` at the **job root** (a
`site/public` path is NOT picked up by Pages on older GitLab versions). Hugo writes
into the site dir, so the build targets `$CI_PROJECT_DIR/public` (absolute, survives
any `cd` refactors). Newer GitLab (≥16.1) also supports `publish:` as an alternative —
avoided here for version portability.

```yaml
pages:
  stage: deploy
  image: docker.io/hugomods/hugo:exts-0.139   # Hugo extended + Go + Node (Docsy PostCSS)
  variables:
    GIT_SUBMODULE_STRATEGY: none
  script:
    - cd site
    - sh scripts/sync-docs.sh                 # copy curated docs/*.md → content/en/docs/
    - hugo mod tidy
    - hugo --gc --minify --baseURL "$CI_PAGES_URL/" --destination "$CI_PROJECT_DIR/public"
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

Notes:
- `$CI_PAGES_URL` is GitLab-injected (matches the provisioned unique domain).
- `$CI_PROJECT_DIR/public` is absolute → unambiguous artifact root regardless of `cd`.
- `hugomods/hugo:exts-*` bundles Hugo **extended** (SCSS), **Go** (modules), and
  **Node.js + npm** (Docsy's PostCSS/PurgeCSS pipeline needs `postcss-cli` +
  `autoprefixer`). **Verify in implementation** that the chosen tag ships Node; if
  not, add `apk add nodejs npm` (or switch to the `exts-ci` variant) and run
  `npm install` for Docsy's `package.json`.
- **No `changes:` rule.** `changes:` on the default branch is unreliable for merge
  commits (squash merges can drop the diff → Pages never updates). The Hugo build is
  cheap (seconds); gating it risks stale publications. The job runs on every `main`
  push, after lint/test/build/scan. Existing pipeline is unaffected.
- **Egress prerequisite (Phase 0):** `hugo mod tidy` fetches Docsy from
  `proxy.golang.org`. Verify the self-hosted runner (`opensource.unicc.org`) has
  egress. If air-gapped, vendor modules (`GOFLAGS=-mod=vendor`, commit `site/vendor/`)
  or pre-populate the module cache — do not rely on `go.sum` alone (it locks hashes,
  not offline availability).
- Runs only on `main`, only when `site/` or `docs/` change — keeps the existing
  lint/test/build/scan pipeline unaffected.
- The `deploy` stage already exists in the pipeline; reuse it. If staging is desired
  before production, add a `pages:preview` MR-triggered job later (out of scope).

## 7. Local Preview

```bash
cd site
hugo server -D    # -D includes draft content
```
Requires local install of **`hugo_extended` ≥ 0.139.0** and **Go ≥ 1.22** (match the
CI image versions to avoid SCSS render differences — Docsy is sensitive to the Hugo
version for `resources.ToCSS`). Document in `site/README.md`.

## 8. Branch / Merge Strategy

- Work in worktree `../genie-ai-hugo-site` on branch `feat/hugo-docs-site`.
- MR to `main` when complete; never commit `main` directly (standing rule).
- CI must pass before merge (standing rule).
- Pages publishes automatically once the `pages` job lands on `main`.

## 9. Out of Scope (Future Work)

- Custom domain (DNS + cert) — flip `baseURL` + GitLab Pages config.
- Spanish (or other locale) translations.
- Docsy **version dropdown** — wire to `release/*` tags when versioned releases ship.
- Mobile SDK docs section (curated subset of `mobile/`).
- Search analytics / feedback widget.
- `pages:preview` per-MR preview deployments.

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hugo module fetch fails in air-gapped CI | `go.sum` locks hashes but is **not** offline availability. Phase 0: verify runner egress to `proxy.golang.org`; if air-gapped, vendor (`GOFLAGS=-mod=vendor`, commit `site/vendor/`) or pre-populate the module cache |
| Docsy version drift breaks SCSS/JS | Pin to a tag at init (`github.com/google/docsy@v0.11.0`); `go.sum` locks the hash; bump deliberately |
| Docsy PostCSS/PurgeCSS pipeline needs Node | Verify chosen `hugomods/hugo:exts-*` tag ships Node + npm; if not, add `apk add nodejs npm` + `npm install`, or use the `exts-ci` variant |
| Curated doc list drifts from real `docs/` | Single allowlist in `site/scripts/sync-docs.sh` (bash `cp` array); missing source = loud `cp` failure = red CI, not a silent empty page |
| Large docs (89K install guide) render slowly | Hugo is fast; minify on; split oversized docs later if needed |
| `_bmad-output` or internal docs leak | Curated copy list only — whole-`docs/` blanket copy explicitly avoided |
| Stale Pages publication | No `changes:` rule on `pages` job (merge-commit diff unreliability); runs on every `main` push |

## 11. Acceptance Criteria

1. `site/` directory exists with `hugo.toml`, `go.mod`, pinned Docsy module, landing page.
2. `cd site && sh scripts/sync-docs.sh && hugo server` serves landing + copied docs locally.
3. At least 5 curated doc pages render under `/docs/` from copied `docs/*.md`.
4. `pages:` job in `.gitlab-ci.yml` builds successfully and produces `public/` at the job root.
5. After merge to `main`, site is live at
   `https://genie-ai-7e342b.opensource.unicc.org/` with landing + docs reachable.
6. No existing CI stage regresses (lint/test/build/scan still green).
7. `robots.txt` + `sitemap.xml` generated by Hugo; verify no internal/scratch paths
   (`_bmad-output`, `superpowers`, `e2e-tests` internals) are reachable or crawlable.
