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
| Theme install | **Hugo Module** (`hugo mod`) | Canonical; reproducible via `go.mod`; no submodule init pitfalls; built-in asset mounts |
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
│       └── docs/          # POPULATED BY MOUNTS (see below), not real files
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

### Doc integration — curated module mounts (single source of truth)

Doc bodies are **mounted**, never copied. Editing `docs/architecture.md` updates the
site. The mount list is explicit so internal scratch never leaks onto the public site.

`site/hugo.toml`:
```toml
[[module.mounts]]
  source = "../docs/architecture.md"
  target = "content/en/docs/architecture.md"
[[module.mounts]]
  source = "../docs/docker-compose-setup.md"
  target = "content/en/docs/deploy.md"
[[module.mounts]]
  source = "../docs/docker-swarm-setup.md"
  target = "content/en/docs/deploy-swarm.md"
[[module.mounts]]
  source = "../docs/integration-architecture.md"
  target = "content/en/docs/integration.md"
[[module.mounts]]
  source = "../docs/database-migrations.md"
  target = "content/en/docs/database-migrations.md"
# ... explicit list, refined iteratively
```

**Excluded by design** (never mounted): `docs/superpowers/`, `docs/e2e-tests/`
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

## 6. CI — `pages:` job

Add a `pages` job to the existing `.gitlab-ci.yml`. GitLab Pages requires a job named
exactly `pages` whose artifact `paths` includes `public/` at the **job root** (a
`site/public` path is NOT picked up by Pages on older GitLab versions). Hugo writes to
`site/public`, so the script moves it to the job root before artifacting. Newer GitLab
(≥16.1) also supports `publish: site/public` as an alternative — avoided here for
version portability.

```yaml
pages:
  stage: deploy
  image: docker.io/hugomods/hugo:exts-0.139   # Hugo extended + Go (module support)
  variables:
    GIT_SUBMODULE_STRATEGY: none
  script:
    - cd site
    - hugo mod tidy
    - hugo --gc --minify --baseURL "$CI_PAGES_URL/" --destination ../public
    # --destination ../public writes to job-root /public (parent of site/)
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - site/**/*
        - docs/**/*
```

Notes:
- `$CI_PAGES_URL` is GitLab-injected (matches the provisioned unique domain).
- `hugomods/hugo:exts-*` bundles Hugo **extended** (SCSS) + Go (modules). Pinned to a
  specific tag for reproducibility; bump deliberately.
- Runs only on `main`, only when `site/` or `docs/` change — keeps the existing
  lint/test/build/scan pipeline unaffected.
- The `deploy` stage already exists in the pipeline; reuse it. If staging is desired
  before production, add a `pages:preview` MR-triggered job later (out of scope).

## 7. Local Preview

```bash
cd site
hugo server -D    # -D includes draft content
```
Requires local install of `hugo_extended` + Go. Document in `site/README.md`.

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
| Hugo module fetch fails in air-gapped CI | `go.sum` checked in; mirror module proxy if needed (verify runner egress to `proxy.golang.org`) |
| Curated mount list drifts from real `docs/` | Mount list is explicit + reviewed each time a doc is added; a future CI check can assert every mounted source exists |
| Docsy SCSS build needs `hugo_extended` | `hugomods/hugo:exts-*` image includes it |
| Large docs (89K install guide) render slowly | Hugo is fast; minify on; split oversized docs later if needed |
| `_bmad-output` or internal docs leak | Curated mounts only — whole-`docs/` blanket mount explicitly avoided |

## 11. Acceptance Criteria

1. `site/` directory exists with `hugo.toml`, `go.mod`, Docsy module, landing page.
2. `cd site && hugo server` serves landing + mounted docs locally.
3. At least 5 curated doc pages render under `/docs/` from mounted `docs/*.md`.
4. `pages:` job in `.gitlab-ci.yml` builds successfully and produces `public/`.
5. After merge to `main`, site is live at
   `https://genie-ai-7e342b.opensource.unicc.org/` with landing + docs reachable.
6. No existing CI stage regresses (lint/test/build/scan still green).
