# Hugo + Docsy Documentation Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Hugo + Docsy documentation site for GENIE.AI, published to GitLab Pages at `https://genie-ai-7e342b.opensource.unicc.org/`, with a public landing page and curated docs copied from the repo's `docs/` directory.

**Architecture:** A self-contained `site/` directory holds a Hugo project. Docsy is installed as a Hugo Module (`github.com/google/docsy/theme`). Curated doc markdown is copied into `site/content/en/docs/` at build time by `site/scripts/sync-docs.sh` (source of truth stays `docs/*.md` in the repo root). A `pages:` job in `.gitlab-ci.yml` builds the site and publishes. English-only at launch; i18n scaffolding in place.

**Tech Stack:** Hugo (extended), Docsy theme (Hugo Module), Go (module resolution), Node.js (Docsy PostCSS/PurgeCSS asset pipeline), GitLab Pages.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-hugo-docs-site-design.md` — read before starting; this plan implements it.
- **All output in English** (repo language policy): commit messages, comments, content.
- **Never commit to `main`** — all work on branch `feat/hugo-docs-site` in worktree `../genie-ai-hugo-site`. Push only when the user asks; MR after CI green.
- **Docsy module import path is `github.com/google/docsy/theme`** (the `/theme` subpath — the modern single-import form confirmed from the canonical `docsy-example/hugo.yaml`; NOT the bare `github.com/google/docsy`).
- **CI image: `hugomods/hugo:exts`** — ships Hugo **extended** + **Go** + **Node/npm** (needed for Docsy's PostCSS pipeline). Pin to a specific tag in production once a known-good one is validated.
- **Pages URL (baseURL):** `https://genie-ai-7e342b.opensource.unicc.org/` (root domain, no subpath).
- **Source of truth:** edit `docs/*.md` in the repo root; the site copies them. Never hand-edit files under `site/content/en/docs/` — they are gitignored and regenerated.
- **Hugo static site has no unit-test framework.** The "test cycle" for each task is: run `hugo` (build must exit 0) + assert expected output files/content exist (grep on generated HTML). This is the legitimate verification for a static-site task.

## Phase 0 — Prerequisites (verify before Task 1)

Local tooling (install if missing):

```bash
hugo version    # must contain "extended"; Docsy needs Hugo extended
go version      # any recent Go (≥ 1.21) for module resolution
node --version  # ≥ 18, for Docsy PostCSS assets
npm --version
```

- If `hugo version` does NOT show `+extended`, install **Hugo extended** (e.g. `snap install hugo --channel=extended`, or download the `hugo_extended` release from https://github.com/gohugoio/hugo/releases).
- **Runner egress check (ops):** the self-hosted GitLab runner at `opensource.unicc.org` must reach `proxy.golang.org` (for `hugo mod get`) and the npm registry (for Docsy assets). Verify with:
  ```bash
  # from a host that mirrors runner egress
  curl -sI --max-time 10 https://proxy.golang.org/ | head -1   # expect HTTP/2 200 or 404 (reachable)
  ```
  If the runner is air-gapped, do NOT proceed to Task 6 — vendor modules first (`cd site && go mod vendor`, set `GOFLAGS=-mod=vendor`, commit `site/vendor/`) and pre-install Docsy's npm deps into the image. Flag this to the user.

---

## File Structure

| File | Responsibility | Created by |
|---|---|---|
| `site/hugo.toml` | Hugo config: baseURL, module imports (Docsy), `[languages.en]`, `[params]`, `[params.ui]`, `[[menus.main]]` | Task 1 + Task 2 |
| `site/go.mod`, `site/go.sum` | Hugo module manifest; pins Docsy version | Task 1 |
| `site/.gitignore` | Ignores `content/en/docs/` (copied output), `public/`, `node_modules/`, `resources/_gen/` | Task 3 |
| `site/scripts/sync-docs.sh` | Copies curated `../docs/*.md` → `content/en/docs/` | Task 3 |
| `site/content/en/_index.md` | Landing page (Docsy blocks: hero, features, CTA) | Task 4 |
| `site/content/en/about.md` | Project overview page | Task 4 |
| `site/content/en/docs/_index.md` | Docs section index (authored, not copied) | Task 3 |
| `site/assets/scss/_variables_project.scss` | Brand color override (shadows Docsy defaults) | Task 5 |
| `site/assets/images/logo.svg` | Site logo | Task 5 |
| `site/i18n/en.toml` | UI string overrides (Docsy ships defaults; optional) | (optional) |
| `site/README.md` | Local dev instructions | Task 7 |
| `.gitlab-ci.yml` (modify) | Add `pages:` job | Task 6 |

---

### Task 1: Scaffold Hugo site + Docsy module

**Files:**
- Create: `site/hugo.toml` (minimal), `site/go.mod`, `site/go.sum`
- Create: `site/.gitignore`

**Interfaces:**
- Produces: a buildable Hugo site whose `site/hugo.toml` declares the Docsy module import `github.com/google/docsy/theme`. Later tasks extend `hugo.toml` and add content.

- [ ] **Step 1: Initialize the Hugo module**

```bash
cd site
# Create the hugo module (go.mod). Module path = repo path + /site.
hugo mod init gitlab.com/un/itu/genie-ai/site
```
Expected: a `go.mod` is created in `site/`.

- [ ] **Step 2: Add Docsy as a module dependency (pinned)**

```bash
cd site
hugo mod get github.com/google/docsy/theme@v0.11.0
```
Expected: `go.mod` and `go.sum` now reference `github.com/google/docsy/theme v0.11.0`. (If `v0.11.0` is unavailable, run `hugo mod get github.com/google/docsy/theme@latest` and note the resolved version in `go.mod` — keep it pinned, do not float.)

- [ ] **Step 3: Write minimal `site/hugo.toml`**

```toml
# GENIE.AI documentation site — Hugo + Docsy
# Full config is built up in Task 2; this is the minimal buildable form.
baseURL = "https://genie-ai-7e342b.opensource.unicc.org/"
languageCode = "en-us"
title = "GENIE.AI"

[module]
  hugoVersion = { extended = true, min = "0.110.0" }
  [[module.imports]]
    path = "github.com/google/docsy/theme"
    disable = false
```

- [ ] **Step 4: Write `site/.gitignore`**

```gitignore
# Copied doc output (regenerated by scripts/sync-docs.sh) — source of truth is ../docs/
/content/en/docs/
# Hugo build output
/public/
/resources/_gen/
# Node (Docsy PostCSS assets)
/node_modules/
package-lock.json
# Hugo module cache
_cache/
```

- [ ] **Step 5: Verify the empty site builds**

```bash
cd site
hugo --gc --destination /tmp/genie-hugo-test
```
Expected: exits 0, prints summary like `Built in Xs` and a list of 0–1 pages. No "module not found" errors. (First run fetches Docsy from the module proxy — requires egress from Phase 0.)

- [ ] **Step 6: Commit**

```bash
git add site/hugo.toml site/go.mod site/go.sum site/.gitignore
git commit -m "feat(site): scaffold Hugo site with Docsy module"
```

---

### Task 2: Full Hugo config (languages, params, UI, menus)

**Files:**
- Modify: `site/hugo.toml` (expand the minimal config from Task 1)

**Interfaces:**
- Consumes: Docsy module from Task 1.
- Produces: a Hugo site that builds with Docsy's chrome (navbar, sidebar, footer) and a main menu (`Docs`, `About`, repo link). Landing content from Task 4 populates it.

- [ ] **Step 1: Replace `site/hugo.toml` with the full config**

```toml
# GENIE.AI documentation site — Hugo + Docsy
baseURL = "https://genie-ai-7e342b.opensource.unicc.org/"
languageCode = "en-us"
defaultContentLanguage = "en"
defaultContentLanguageInSubdir = false
title = "GENIE.AI"
enableRobotsTXT = true
enableGitInfo = true

# Hugo Modules — Docsy theme (extended Hugo required for SCSS pipeline)
[module]
  hugoVersion = { extended = true, min = "0.110.0" }
  [[module.imports]]
    path = "github.com/google/docsy/theme"
    disable = false

# English (source of truth per project i18n policy). Add [languages.es] later.
[languages.en]
  languageName = "English"
  title = "GENIE.AI"
  weight = 1

[params]
  copyright = "GENIE.AI — ITU"
  description = "Sovereign, DPG-compliant generative AI / RAG framework for the public sector."
  github_repo = "https://opensource.unicc.org/un/itu/genie-ai"
  github_subdir = "site"
  version = ""

  # Docsy UI behavior
  [params.ui]
    navbar_logo = true
    sidebar_menu_compact = true
    sidebar_search_disable = false
    feedback_disable = true
    breadcrumb_disable = false
    showLightDarkModeMenu = true

  # Client-side search (no server needed)
  [params.search]
    offlineSearch = true

# Top navbar menu
[[menus.main]]
  name = "Docs"
  weight = 10
  url = "/docs/"

[[menus.main]]
  name = "About"
  weight = 20
  url = "/about/"

[[menus.main]]
  name = "Repository"
  weight = 30
  url = "https://opensource.unicc.org/un/itu/genie-ai"
```

- [ ] **Step 2: Verify build still passes**

```bash
cd site
hugo --gc --destination /tmp/genie-hugo-test
```
Expected: exits 0. (No content yet beyond Docsy defaults; that is fine.)

- [ ] **Step 3: Verify local server serves Docsy chrome**

```bash
cd site
hugo server -D --bind 127.0.0.1 --port 1313 &
sleep 3
curl -s http://127.0.0.1:1313/ | grep -o "GENIE.AI" | head -1
kill %1
```
Expected: prints `GENIE.AI` (the title renders). Navbar/footer come from Docsy.

- [ ] **Step 4: Commit**

```bash
git add site/hugo.toml
git commit -m "feat(site): full Hugo config (languages, params.ui, menus)"
```

---

### Task 3: Doc sync script + docs section index

**Files:**
- Create: `site/scripts/sync-docs.sh`
- Create: `site/content/en/docs/_index.md` (authored section landing — NOT gitignored)

**Interfaces:**
- Consumes: `../docs/*.md` (repo-root docs).
- Produces: `site/content/en/docs/<name>.md` (gitignored, regenerated) for each curated doc. Task 6's CI runs this script before `hugo`.

- [ ] **Step 1: Write `site/scripts/sync-docs.sh`**

```bash
#!/usr/bin/env sh
# Sync curated repo-root docs/ into the Hugo site content.
# Source of truth: <repo>/docs/*.md  ->  site/content/en/docs/<name>.md
#
# This is an allowlist, not a blanket copy: only listed docs are published.
# A missing source file makes `cp` fail loudly (red CI), never a silent empty page.
# Add a line to publish a new doc; remove a line to unpublish.
set -eu

# Resolve repo root (parent of site/), independent of caller cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DOCS="$(cd "$SITE_DIR/../docs" && pwd)"
DEST="$SITE_DIR/content/en/docs"

mkdir -p "$DEST"

# <source>             <target-name>
cp "$REPO_DOCS/architecture.md"             "$DEST/architecture.md"
cp "$REPO_DOCS/docker-compose-setup.md"     "$DEST/deploy.md"
cp "$REPO_DOCS/docker-swarm-setup.md"       "$DEST/deploy-swarm.md"
cp "$REPO_DOCS/integration-architecture.md" "$DEST/integration.md"
cp "$REPO_DOCS/database-migrations.md"      "$DEST/database-migrations.md"

echo "Synced docs -> $DEST"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x site/scripts/sync-docs.sh
```

- [ ] **Step 3: Write `site/content/en/docs/_index.md` (docs section landing)**

```markdown
---
title: "Documentation"
weight: 1
description: "GENIE.AI architecture, deployment, and integration guides."
---

# GENIE.AI Documentation

Sovereign, DPG-compliant generative AI / RAG framework for the public sector.

Browse the guides in the sidebar.
```

- [ ] **Step 4: Verify the script copies exactly the curated docs**

```bash
cd site
sh scripts/sync-docs.sh
ls -1 content/en/docs/
```
Expected output lists exactly:
```
_index.md            ← authored (committed)
architecture.md
database-migrations.md
deploy-swarm.md
deploy.md
integration.md
```
(`_index.md` is the committed section landing; the other five are copied.)

- [ ] **Step 5: Verify a missing source fails loudly**

Temporarily break one entry, confirm `cp` errors, then revert:
```bash
cd site
cp scripts/sync-docs.sh /tmp/sync.bak
sed -i 's#architecture.md#NONEXISTENT.md#' scripts/sync-docs.sh
sh scripts/sync-docs.sh; echo "exit=$?"
cp /tmp/sync.bak scripts/sync-docs.sh   # restore
```
Expected: a non-zero `exit=` and a `No such file or directory` message (proves drift surfaces as a red build, not a silent gap).

- [ ] **Step 6: Verify the copied docs build into pages**

```bash
cd site
hugo --gc --destination /tmp/genie-hugo-test
ls /tmp/genie-hugo-test/docs/
```
Expected: `architecture`, `deploy`, `deploy-swarm`, `integration`, `database-migrations` directories (each with `index.html`) exist.

- [ ] **Step 7: Commit**

```bash
git add site/scripts/sync-docs.sh site/content/en/docs/_index.md
git commit -m "feat(site): curated doc sync script + docs section index"
```
(The copied `content/en/docs/*.md` are gitignored — not staged.)

---

### Task 4: Landing page + About page

**Files:**
- Create: `site/content/en/_index.md` (landing)
- Create: `site/content/en/about.md`

**Interfaces:**
- Consumes: Docsy `blocks/*` shortcodes (hero, section, feature) provided by the theme.
- Produces: the public landing page at `/` and an `/about/` page reachable from the navbar.

- [ ] **Step 1: Write `site/content/en/_index.md` (landing)**

```markdown
---
title: "GENIE.AI"
linkTitle: "Home"
description: "Sovereign, DPG-compliant generative AI / RAG framework for the public sector."
---

{{< blocks/cover title="GENIE.AI" image_anchor="bottom" height="min" >}}
  <p class="lead mt-4">
    A sovereign, open-source Retrieval-Augmented Generation framework for the public sector.
    Integrates with <a href="https://opea.dev">OPEA</a>, multilingual, DPG-compliant.
  </p>
  <a class="btn btn-lg btn-primary me-3" href="/docs/deploy/">Get Started</a>
  <a class="btn btn-lg btn-outline-secondary" href="/about/">Learn More</a>
{{< /blocks/cover >}}

{{< blocks/section >}}
  {{% blocks/feature title="DPG-compliant" icon="fa-globe" %}}
    Open-source Digital Public Good — sovereign, auditable, deployable on your infrastructure.
  {{% /blocks/feature %}}

  {{% blocks/feature title="Multilingual RAG" icon="fa-language" %}}
    Retrieval-Augmented Generation with first-class multilingual support (English source of truth).
  {{% /blocks/feature %}}

  {{% blocks/feature title="OPEA-integrated" icon="fa-cubes" %}}
    Built on the Open Platform for Enterprise AI for embeddings, retrieval, reranking, and LLMs.
  {{% /blocks/feature %}}

  {{% blocks/feature title="Observable" icon="fa-chart-line" %}}
    OpenTelemetry-native: traces, metrics, and logs across the whole RAG pipeline.
  {{% /blocks/feature %}}
{{< /blocks/section >}}

{{< blocks/section type="secondary" >}}
  <div class="col-12 text-center">
    <h2>Ready to deploy?</h2>
    <a class="btn btn-lg btn-primary" href="/docs/deploy/">Read the deployment guide</a>
  </div>
{{< /blocks/section >}}
```

- [ ] **Step 2: Write `site/content/en/about.md`**

```markdown
---
title: "About GENIE.AI"
weight: 20
description: "What GENIE.AI is and who it is for."
---

# About GENIE.AI

GENIE.AI is an open-source generative AI framework for the public sector, providing a
sovereign, DPG-compliant Retrieval-Augmented Generation (RAG) system with multilingual
support. It integrates with [OPEA (Open Platform for Enterprise AI)](https://opea.dev)
for AI/ML services.

## Audience

This site serves two roles:

- **Implementers and adopters** evaluating or deploying GENIE.AI.
- **The internal team** maintaining the platform.

See the [Documentation](/docs/) for architecture, deployment, and integration guides.
```

- [ ] **Step 3: Verify landing + about render with content**

```bash
cd site
hugo --gc --destination /tmp/genie-hugo-test
grep -o "Sovereign, DPG-compliant generative AI" /tmp/genie-hugo-test/index.html | head -1
grep -o "About GENIE.AI" /tmp/genie-hugo-test/about/index.html | head -1
```
Expected: both print their search string (hero text on landing, title on about).

- [ ] **Step 4: Commit**

```bash
git add site/content/en/_index.md site/content/en/about.md
git commit -m "feat(site): landing page (Docsy blocks) + about page"
```

---

### Task 5: Brand overrides (colors + logo)

**Files:**
- Create: `site/assets/scss/_variables_project.scss`
- Create: `site/assets/images/logo.svg`

**Interfaces:**
- Consumes: Docsy's SCSS pipeline (auto-includes `_variables_project.scss` from the project `assets/scss/`).
- Produces: branded primary color + site logo in the navbar.

- [ ] **Step 1: Write `site/assets/scss/_variables_project.scss`**

```scss
// GENIE.AI brand overrides — Docsy auto-imports this file.
// Override Bootstrap/Docsy SCSS variables here.
// Replace with the official GENIE.AI brand color when known.

$primary: #1a73e8;     // brand blue (placeholder)
$secondary: #34a853;   // accent (placeholder)
$body-bg: #ffffff;
```

- [ ] **Step 2: Write a placeholder `site/assets/images/logo.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="GENIE.AI">
  <rect width="32" height="32" rx="6" fill="#1a73e8"/>
  <text x="16" y="21" font-family="Arial, sans-serif" font-size="14" font-weight="700"
        fill="#ffffff" text-anchor="middle">G</text>
</svg>
```

- [ ] **Step 3: Reference the logo in params (Task 2 `hugo.toml` already sets `navbar_logo = true`; Docsy picks up `assets/images/logo.svg` by convention). Confirm no extra config needed by building.**

- [ ] **Step 4: Verify build picks up SCSS (extended Hugo required)**

```bash
cd site
hugo --gc --destination /tmp/genie-hugo-test
# Docsy compiles SCSS to a single CSS bundle; confirm a stylesheet is emitted.
ls /tmp/genie-hugo-test/css/ 2>/dev/null || ls /tmp/genie-hugo-test/scss/ 2>/dev/null
grep -rl "#1a73e8\|rgb(26,115,232)" /tmp/genie-hugo-test/css/ 2>/dev/null | head -1
```
Expected: a CSS file exists, and the brand color `#1a73e8` appears in the compiled CSS. (Exact CSS path may vary by Docsy version — the grep is the real assertion.)

- [ ] **Step 5: Commit**

```bash
git add site/assets/scss/_variables_project.scss site/assets/images/logo.svg
git commit -m "feat(site): brand SCSS overrides + placeholder logo"
```

---

### Task 6: GitLab Pages CI job

**Files:**
- Modify: `.gitlab-ci.yml` (add a `pages:` job; do not disturb existing stages/jobs)

**Interfaces:**
- Consumes: `site/` (from Tasks 1–5), `docs/*.md` (copied by `sync-docs.sh`).
- Produces: a `public/` artifact on every `main` push → published to GitLab Pages.

- [ ] **Step 1: Read the existing stages to pick the right one**

```bash
grep -nE "^stages:|^  - " .gitlab-ci.yml | head -20
```
Identify the stage to attach the Pages job to. The spec uses `deploy`. If `deploy` is not a defined stage, use the last stage in the list (so the site builds after lint/test/build/scan). Record the chosen stage name for Step 2.

- [ ] **Step 2: Add the `pages:` job to `.gitlab-ci.yml`**

Append this job (adjust `stage:` to the name chosen in Step 1 if `deploy` is wrong):

```yaml
# --- Documentation site -> GitLab Pages ---
# Builds the Hugo + Docsy site in site/ and publishes to GitLab Pages.
# Docsy is a Hugo Module (needs Go); assets need Node. hugomods/hugo:exts provides all three.
pages:
  stage: deploy
  image: docker.io/hugomods/hugo:exts
  variables:
    GIT_SUBMODULE_STRATEGY: none
  script:
    - cd site
    - sh scripts/sync-docs.sh
    - hugo mod tidy
    - hugo --gc --minify --baseURL "$CI_PAGES_URL/" --destination "$CI_PROJECT_DIR/public"
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

Notes baked into the job (do not deviate):
- `$CI_PAGES_URL` is GitLab-injected → matches the provisioned unique domain; never hardcode.
- `--destination "$CI_PROJECT_DIR/public"` is absolute → artifact lands at job root regardless of `cd`.
- **No `changes:` rule** — merge-commit diff matching on the default branch is unreliable and causes stale publications. The Hugo build is cheap.
- `hugomods/hugo:exts` includes Hugo extended + Go + Node. If PostCSS errors appear, add `- npm install` after `cd site` (Docsy ships a `package.hugo.json` Hugo materializes to `package.json`).

- [ ] **Step 3: Validate the CI YAML locally**

```bash
# Option A: GitLab CI lint API (requires glab auth)
glab api --method POST "projects/:id/ci/lint" -f content=@.gitlab-ci.yml 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('valid=',d.get('valid')); print(d.get('errors',''))" 2>&1 | head

# Option B: if glab unavailable, basic YAML syntax check
python3 -c "import yaml,sys; yaml.safe_load(open('.gitlab-ci.yml')); print('YAML OK')"
```
Expected: `valid=True` (Option A) or `YAML OK` (Option B). Fix any syntax error before committing.

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci(site): add GitLab Pages job for Hugo + Docsy site"
```

---

### Task 7: README + final end-to-end verification

**Files:**
- Create: `site/README.md`

**Interfaces:**
- Produces: developer docs for local preview; closes the implementation.

- [ ] **Step 1: Write `site/README.md`**

````markdown
# GENIE.AI documentation site (Hugo + Docsy)

Published to GitLab Pages: <https://genie-ai-7e342b.opensource.unicc.org/>

## Prerequisites

- **Hugo extended** (≥ 0.110) — Docsy needs the extended SCSS pipeline.
  Check: `hugo version` must contain `+extended`.
- **Go** ≥ 1.21 — resolves the Docsy Hugo Module.
- **Node.js** ≥ 18 + npm — Docsy PostCSS/PurgeCSS asset pipeline.

## Local preview

```bash
cd site
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
````

- [ ] **Step 2: Full clean build (the end-to-end test)**

```bash
cd site
rm -rf public content/en/docs
sh scripts/sync-docs.sh
hugo --gc --minify --destination /tmp/genie-final
echo "--- pages built ---"
find /tmp/genie-final -name index.html | sort
echo "--- landing hero present ---"
grep -o "Sovereign, DPG-compliant generative AI" /tmp/genie-final/index.html | head -1
echo "--- 5 docs present ---"
for p in architecture deploy deploy-swarm integration database-migrations; do
  test -f "/tmp/genie-final/docs/$p/index.html" && echo "ok: $p" || echo "MISSING: $p"
done
echo "--- robots + sitemap ---"
test -f /tmp/genie-final/robots.txt && echo "ok: robots.txt"
test -f /tmp/genie-final/sitemap.xml && echo "ok: sitemap.xml"
echo "--- no internal scratch leaked ---"
(! grep -rl "superpowers\|_bmad-output\|e2e-tests" /tmp/genie-final) && echo "ok: no scratch leaked"
```
Expected:
- Landing + about + 5 docs + docs index all built (index.html present).
- Landing hero text found.
- `robots.txt` and `sitemap.xml` present.
- "no scratch leaked" — the grep for internal paths finds nothing.

- [ ] **Step 3: Commit**

```bash
git add site/README.md
git commit -m "docs(site): add site README with local-preview and source-of-truth guide"
```

- [ ] **Step 4: Open the MR (after pushing)**

```bash
git push -u origin feat/hugo-docs-site
# Create MR to main; wait for CI green (lint/test/build/scan + the new pages job) before merge.
```
After merge to `main`, the `pages:` job publishes to the provisioned URL. Verify acceptance criteria #5 (site live with landing + docs reachable).
