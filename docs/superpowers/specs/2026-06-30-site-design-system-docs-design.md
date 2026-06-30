# Docs Site — Design-System Theming + Docs Expansion — Design Spec (v2, revised)

- **Date:** 2026-06-30 (revised after BMAD party-mode review)
- **Branch:** `feat/site-design-system-docs` (worktree `../genie-ai-site-ds`, off merged main `93a958871`)
- **Status:** Approved (revised) → ready for implementation plan
- **Predecessor:** `docs/superpowers/specs/2026-06-29-hugo-docs-site-design.md`
- **Revision driver:** party-mode review (Winston/Paige/Sally/Amelia) flagged 4 blockers + refinements. v2 resolves them with **working solutions, no fallbacks** (per user directive: "on doit faire des choses qui fonctionnent").

## 1. Purpose

The live docs site ships Docsy defaults + placeholder brand + 5 of ~20 docs. This initiative (1) aligns the site's visual identity with the project design system (`design-system.html`) and (2) expands the docs portal to mirror `docs/index.md` (17 docs, 7 sections).

## 2. Decisions (unchanged from v1)

| Decision | Choice |
|---|---|
| Theming depth | B — token override + key component restyle |
| Docs structure | Mirror `docs/index.md` (7 sections) |
| Docs scope | A — all `docs/` root reference docs (~17) |
| Fonts | B — self-host Inter + JetBrains Mono |

## 3. Design-system contract — `design-system.html` is the single source of truth

**Source of truth:** the `:root` token block in `/home/jerome/git_projects/ITU/genie-ai/design-system.html`. The implementer MUST read it for the full, exact token values. Key tokens (verified present):

- `--accent: oklch(42% 0.18 265)` (institutional blue). `--accent-hover`, `--accent-light`, `--secondary`, `--danger` (#ef4444), dark tokens (`--bg-dark`, `--bg-darker`, `--text-secondary`, `--border-dark`), radii (4/8/12/16/pill), space scale, shadows, transitions, `--font-body` / `--font-mono`.
- Fonts: Inter (body/display), JetBrains Mono (code/labels/eyebrows).
- Logo: GENIE.AI genie mark at `mobile/genie_ai_mobile/assets/config/genie-ai-icon.svg` (+ `-light.svg`/`-dark.svg`); wordmark "GENIE" in Inter 700, letter-spacing -0.02em.

### ⚠️ OKLch + Bootstrap — the critical architectural constraint (verified)

**Empirically proven:** setting Bootstrap's SCSS `$primary` (or any BS color var) to `oklch(...)` **breaks the build** — Bootstrap 5.3's `mix()` / `tint-color()` / `shade-color()` / `color-contrast()` (in `_functions.scss`) reject oklch:

```
TOCSS: failed: bootstrap/_functions.scss:212: argument `$color2` of `mix(...)` must be a color
```

**Working architecture (no fallback — both representations are the same color):**
- **OKLch in CSS custom properties** (`:root { --ds-accent: oklch(42% 0.18 265); ... }`) — the visible DS identity. Drives the `_custom.scss` component layer (everything users see: navbar, links, cards, code, callouts, buttons, etc.).
- **sRGB hex for Bootstrap's compile-time `$primary`/`$secondary`** — the SAME colors, rendered in sRGB, because Bootstrap's Sass color math cannot consume oklch. Verified to compile clean. Concrete hexes (computed from the oklch):
  - `$primary: #1b3fad` (= oklch(42% 0.18 265))
  - `$secondary: #00a465` (= oklch(62% 0.17 162))
  - accent-hover `#0b267d`, accent-light `#709afb` (for any BS-derivative state).
- This is a **deliberate, documented necessity**, not a degradation: oklch everywhere the pipeline permits (all visible styling via CSS vars); hex only as Bootstrap's internal compile-time input (same color).

**Phase 0 (first plan task):** empirically verify in the actual CI image (`hugomods/hugo:exts`) that (a) dart-sass is present, (b) hex `$primary` compiles, (c) oklch CSS vars render in output. If dart-sass/oklch is unavailable in that image, the fix is the toolchain (a dart-sass-bundling image or Hugo ≥0.158 install-in-CI) — **never** abandoning oklch.

## 4. Workstream A — Design-system theming

### A1 — Token layer (`assets/scss/_variables_project.scss` + `assets/scss/_tokens.scss`)
- `_variables_project.scss`: Bootstrap SCSS vars in **hex** (`$primary: #1b3fad`, `$secondary: #00a465`, radii, fonts). hex is mandatory for any var consumed by a BS color function.
- `_tokens.scss`: `:root` CSS custom properties in **oklch** — full DS token set (accent/hover/light, bg/dark/darker, text/secondary, borders, radii, space, shadows, transitions, fonts). Dark tokens under `[data-theme="dark"]` / `html.dark`. Import order: tokens first, then Docsy, then `_custom.scss`.
- Source values: read from `design-system.html :root`.

### A2 — Self-hosted fonts (`static/fonts/` + `_tokens.scss` `@font-face`)
- Inter (400/500/600/700) + JetBrains Mono (400/500), `.woff2`, sourced via `@fontsource` (OFL license — record `site/static/fonts/LICENSE`).
- Subsets: **latin + latin-ext + box-drawing (U+2500–257F) + arrows (U+2190–21FF)** so ASCII/box-drawing diagrams in docs render (no tofu). Project is multilingual → latin-ext covers diacritics.
- `font-display: swap` (no FOIT). `@font-face` in `_tokens.scss`, referenced from `/fonts/`.

### A3 — Logo + wordmark + favicon
- Navbar: genie mark (`genie-ai-icon.svg`) + "GENIE" wordmark (Inter 700, letter-spacing -0.02em) beside it.
- Dark-mode navbar: `genie-ai-icon-light.svg` (monochrome) via `[data-theme=dark]` selector.
- Favicon + `apple-touch-icon`: derive from `genie-ai-icon.svg` (place in `static/`).

### A4 — Component restyle layer (`assets/scss/_custom.scss`, imported after Docsy)
Token-driven (CSS vars), overrides Bootstrap defaults on the visible surfaces:
- **Navbar** (DS surface, shadow on scroll, uppercase mono eyebrows), **sidebar** (DS radii, active-link accent), **buttons** (radius 8, accent fill, hover via `--ds-accent-hover`), **links + hover**, **code blocks** (JetBrains Mono, DS surface, radius 8), **callouts/admonitions** (accent left-border + tinted surface), **cards** (radius 12 + shadow-sm), **tables** (uppercase header, DS borders), **inputs/forms** (navbar search, feedback — DS input style), **badges/tags**.

### A5 — Dark mode + Chroma + contrast
- **Mechanism:** Docsy's toggle (already enabled), persisted via `localStorage`; map DS dark tokens to Docsy dark palette.
- **Chroma (code highlighting):** pin a Chroma style (e.g. `github-dark`) in `hugo.toml` (`[markup.highlight] style`), override `.chroma` background to the DS dark surface so code blocks match.
- **WCAG AA contrast (acceptance criterion):** body text ≥4.5:1, large text/UI ≥3:1 — verified for both light and dark, especially low-chroma secondary text and accent-on-dark links.

## 5. Workstream B — Docs portal expansion (mirror `docs/index.md`)

### B1 — Sectioned sync (`scripts/sync-docs.sh`, rewritten — full contract)
Rewrite to a robust, idempotent, fail-loud script. **Behavior spec:**
- **Exhaustive source→target mapping** (data, not prose) — 17 docs into 7 sections (see table).
- **Front-matter injection:** Docsy requires front matter (title, weight). Many source docs lack it → the script **prepends** a front-matter block (title from the doc's first `# ` heading or filename; `weight` per the section's reader order) when absent. Idempotent (detect existing FM, don't duplicate).
- **Relative-link rewriting:** rewrite intra-doc relative links (`](./foo.md)`, `](../bar.md)`) to their new site paths (`](/docs/<section>/foo/)`) via a documented sed/regex pass. Links to non-ported targets (repo README, components/) → flagged in build log.
- **Idempotent:** `rm -rf content/en/docs/<section>` then recopy each run (CI-safe).
- **Fail-loud:** `set -eu`; missing source = `cp` error = red CI.

Section→doc mapping:

| Section | Docs |
|---|---|
| `core/` | project-overview, source-tree-analysis, integration-architecture, development-guide |
| `frontend/` | ui-component-inventory-gov-chat-frontend, state-management-gov-chat-frontend, theme-system |
| `backend/` | api-contracts-gov-chat-backend |
| `mobile/` | ui-component-inventory-mobile, mobile-architecture-genie-ai-mobile |
| `architecture/` | architecture, LOGGING-ARCHITECTURE-EVALUATION (slug → `logging-architecture`) |
| `deployment/` | docker-compose-setup, docker-swarm-setup, mobile-deployment-guide |
| `configuration/` | keycloak-admin-guide, external-idp-integration-guide |

Excluded (justified): `roadmap-sprint-20-to-25.md` (sprint artifact, not reference doc), `database-migrations.md` (ops runbook, not in index.md portal sections — can be added later under `backend/` if wanted), `e2e-tests/*` (test internals). The E2E `README.md` referenced in index.md §Testing is **out of root** — omit, note in portal landing.

### B2 — Section landings (authored, committed) + weight convention
- `content/en/docs/<section>/_index.md` per section (7 files): one-paragraph purpose + the section's docs as a list. `weight` per reader order (Core=1 … Configuration=7).
- **Mono-doc section (`backend/`):** keep as its own section for clarity (it's a distinct concern), landing states "Backend API contracts."
- **Intra-section `weight`:** reader order (e.g. Core: project-overview=1, source-tree=2, integration=3, dev-guide=4), not alphabetical.

### B3 — Portal landing (`content/en/docs/_index.md`, authored) — a real entry page
Not a flat TOC. Includes: (1) a 2-line "what is GENIE.AI" intro; (2) a **"Start here" reader path** (Project Overview → Development Guide → Deployment); (3) section cards (DS card component, radius 12 + shadow-sm) linking to each section landing; (4) distinction: **guides** (Development, Deployment) vs **reference** (API contracts, UI inventories). Hugo-correct internal links (`/docs/core/...`), no repo relative links.

### B4 — `.gitignore` (corrected `**` negation)
The `**` negation must re-open directories with a trailing slash, or nested `_index.md` won't track:
```gitignore
/content/en/docs/**/*
!/content/en/docs/**/
!/content/en/docs/**/_index.md
```
Verify empirically at 3 depth levels (docs/, docs/<sec>/, docs/<sec>/<sub>/).

## 6. Verification (per task + final)
- `hugo --gc` exit 0 on Hugo 0.154.5 (CI) + 0.163.3 (local).
- **Phase 0** dart-sass/oklch/hex compile test in CI image (§3).
- Theming tasks: **playwright screenshot** vs `design-system.html` (local `hugo server :1313`); WCAG contrast check (axe or manual ratio calc).
- Docs tasks: each doc renders at `/docs/<section>/<name>/`; **linkcheck** (`grep -rn '\.\./docs\|](\./' content/` after sync — no unresolved repo-relative links).
- `npm install` provides PostCSS locally; CI `hugomods:exts` bundles it.

## 7. Execution
writing-plans → subagent-driven-development (fresh subagent per task + review), worktree `../genie-ai-site-ds`. Local `hugo server` live for visual iteration. Commit per task on `feat/site-design-system-docs`; MR after final review.

## 8. Rollback
Predecessor: merged main `93a958871` (the live site). If a task breaks prod mid-MR, revert the offending commit(s) on `feat/site-design-system-docs` (the live `main` is untouched until merge) — no live-site risk until MR merge.

## 9. Out of scope
i18n (ES), version dropdown, search analytics, non-`docs/`-root refs (deploy/ansible, components/TRANSLATION — stub/omit), rebuilding Docsy from scratch, chat-app-only DS components (chat bubbles/modals/toasts), pure-oklch for Bootstrap-derivative states (impossible — Bootstrap rejects oklch; §3).

## 10. Acceptance criteria
1. `hugo --gc` exit 0 on Hugo 0.154.5 (CI) + 0.163.3 (local).
2. Phase 0 passes: dart-sass present in `hugomods:exts`; hex `$primary` compiles; oklch CSS vars render in output.
3. Bootstrap `$primary` = `#1b3fad` (sRGB of the accent) in compiled CSS; oklch `--ds-accent` present in `:root` and driving visible components.
4. Inter + JetBrains Mono self-hosted (`/fonts/*.woff2`), `@font-face`, `font-display: swap`, subsets include box-drawing + arrows + latin-ext; no external font requests.
5. Navbar shows genie mark + "GENIE" wordmark; dark variant correct; favicon present.
6. Dark mode palette = DS dark tokens; toggle persists; **WCAG AA contrast** verified (body ≥4.5:1, UI ≥3:1) light + dark.
7. Docs portal: 7 sections + 17 docs at `/docs/<section>/<name>/`; section landings + portal landing (cards, reader path, guide/reference split); all internal links resolve (linkcheck clean).
8. No internal scratch (`superpowers`, `_bmad-output`, `e2e-tests`) leaks.
9. `sync-docs.sh` idempotent, injects front matter, rewrites relative links, fails loud on missing source.
10. `.gitignore` tracks all section `_index.md` at any depth (verified).
