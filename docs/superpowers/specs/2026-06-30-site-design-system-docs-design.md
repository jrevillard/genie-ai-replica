# Docs Site — Design-System Theming + Docs Expansion — Design Spec

- **Date:** 2026-06-30
- **Branch:** `feat/site-design-system-docs` (worktree `../genie-ai-site-ds`, off merged main `93a958871`)
- **Status:** Approved (brainstorming complete) → ready for implementation plan
- **Predecessor:** `docs/superpowers/specs/2026-06-29-hugo-docs-site-design.md` (the initial Hugo+Docsy site, now live)

## 1. Purpose

The live docs site (`https://genie-ai-7e342b.opensource.unicc.org/`) ships Docsy defaults with a placeholder brand color and placeholder logo, and publishes only 5 of ~20 docs with no structure. This initiative:

1. **Aligns the site's visual identity with the project design system** (`design-system.html` — OKLch tokens, Inter + JetBrains Mono, the real GENIE.AI logo, dark mode) via Docsy SCSS overrides + a component restyle layer.
2. **Expands the docs portal** to mirror the existing curated `docs/index.md` — 17 reference docs across 7 sections, with section landings and a portal landing.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Theming depth | **B — token override + key component restyle** | Token override gets the identity cheaply; restyle of navbar/sidebar/buttons/code/callouts closes the visible gap without rebuilding Docsy (option C, rejected as overkill for docs) |
| Docs structure | **Mirror `docs/index.md`** | The repo already has a curated, sectioned TOC; reuse it rather than inventing one |
| Docs scope | **A — all `docs/` root reference docs** per index.md (~17) | Fills the empty section into a real portal; excludes test-internals (e2e-tests) |
| Fonts | **B — self-host** Inter + JetBrains Mono (`.woff2`) | Sovereign/DPG ethos; no external CDN; offline-capable; matches `design-system.html` which inlines its fonts |

## 3. Design-system reference (the contract to follow)

Source: `design-system.html` at repo root. Key tokens:

- **Accent / primary:** `oklch(42% 0.18 265)` institutional blue. Secondary `oklch(62% 0.17 162)` (teal). Dim/accent-dim variants per scale.
- **Neutrals (dark mode native):** surface `oklch(10% 0 0)` → text `oklch(95% 0 0)`; muted `oklch(60% 0 0)`. Borders `oklch(22% 0 0)` / `oklch(30% 0 0)`.
- **Fonts:** `--font-body`=Inter, `--font-mono`=JetBrains Mono. Uppercase mono labels (`text-transform:uppercase; letter-spacing:0.08em`) for metadata/eyebrows.
- **Radii:** sm 4 / md 8 / lg 12 / xl 16 / pill 100.
- **Shadows:** sm / md / lg.
- **Type scale:** text-xs(0.7rem) … text-3xl(2.5rem); display weights 600/700, negative letter-spacing on display.
- **Logo:** the GENIE.AI genie mark. Asset: `mobile/genie_ai_mobile/assets/config/genie-ai.svg` (full wordmark), with `-icon.svg` / `-icon-light.svg` / `-icon-dark.svg` variants for the mark + dark mode. Sizes 20/32/40/56px.

## 4. Workstream A — Design-system theming

### A1 — OKLch tokens (`assets/scss/_variables_project.scss`)
Override Docsy/Bootstrap SCSS variables with the design-system OKLch scale:
- `$primary` → `oklch(42% 0.18 265)`; `$secondary` → `oklch(62% 0.17 162)`.
- Define `--font-body`, `--font-mono` CSS vars; set Docsy `$font-family-sans-serif` / `$font-family-monospace` to them.
- Radii/shadows map to DS values.
- Dark-mode palette: override Docsy's `[data-theme="dark"]`/`html.dark` surface/text/border to the DS dark tokens.

### A2 — Self-hosted fonts
- Place `static/fonts/Inter-*.woff2` (400/500/600/700) and `static/fonts/JetBrainsMono-*.woff2` (400/500) — subsetted latin.
- `@font-face` declarations in `assets/scss/_fonts.scss` (or `_variables_project.scss`), referencing `/fonts/...`.
- Source the `.woff2` from a reliable download (Google Fonts API `.woff2` endpoints or the `@fontsource` package). License: Inter = OFL, JetBrains Mono = OFL — record in repo.

### A3 — Real logo
- Replace placeholder `assets/images/logo.svg` with the real mark from `mobile/genie_ai_mobile/assets/config/genie-ai-icon.svg` (navbar) and `genie-ai.svg` (footer/landing if needed).
- Wire dark-mode variant (`genie-ai-icon-light.svg`) so the mark is visible on dark navbar — via Docsy's dark-mode CSS or a `[data-theme=dark]` selector.
- Confirm `navbar_logo = true` renders it.

### A4 — Component restyle layer (`assets/scss/_custom.scss`, imported after Docsy)
Token-driven overrides on top of Docsy/Bootstrap for the high-visibility surfaces:
- **Navbar** — DS surface, subtle shadow on scroll, uppercase mono section labels.
- **Sidebar nav** — DS radii, active-link accent, compact spacing.
- **Buttons** — DS radii (8), accent fill, hover lift; ghost/outline variants.
- **Code blocks** — JetBrains Mono, DS surface, DS radius, consistent with mono-label treatment.
- **Callouts/admonitions** — DS accent left-border + tinted surface.
- **Cards** — DS radius (12) + shadow-sm.

### A5 — Dark mode alignment
Docsy's light/dark toggle is already enabled (`showLightDarkModeMenu=true`). Map the dark palette to the DS dark tokens so dark mode matches the design system, not Docsy's default gray.

## 5. Workstream B — Docs portal expansion (mirror `docs/index.md`)

### B1 — Sectioned sync (`scripts/sync-docs.sh`, rewritten)
Copy `docs/<file>.md` → `content/en/docs/<section>/<name>.md`. Seven sections, 17 docs:

| Section dir | Docs (source → target name) |
|---|---|
| `core/` | project-overview, source-tree-analysis, integration-architecture, development-guide |
| `frontend/` | ui-component-inventory-gov-chat-frontend, state-management-gov-chat-frontend, theme-system |
| `backend/` | api-contracts-gov-chat-backend |
| `mobile/` | ui-component-inventory-mobile, mobile-architecture-genie-ai-mobile |
| `architecture/` | architecture, LOGGING-ARCHITECTURE-EVALUATION |
| `deployment/` | docker-compose-setup, docker-swarm-setup, mobile-deployment-guide |
| `configuration/` | keycloak-admin-guide, external-idp-integration-guide |

- Maintains the loud-failure contract (`set -eu`, missing source = `cp` error = red CI).
- Excludes: `index.md` (becomes the portal landing), `roadmap-sprint-20-to-25.md`, `database-migrations.md` (not in index.md's portal sections), `e2e-tests/*` (test internals).

### B2 — Section landings (authored, committed)
`content/en/docs/<section>/_index.md` for each of the 7 sections — one-line purpose + `weight` so the sidebar groups correctly. These are committed (not gitignored).

### B3 — Portal landing (`content/en/docs/_index.md`, authored, committed)
Mirrors `docs/index.md`'s overview + section list, but with **Hugo-correct internal links** (`/docs/core/project-overview/`, not repo `./project-overview.md`). Replaces the current sparse `_index.md`.

### B4 — `.gitignore`
Extend `/content/en/docs/*` ignore to the sectioned tree while keeping authored `_index.md` files tracked:
```
/content/en/docs/**/*
!/content/en/docs/**/_index.md
```

## 6. Verification

Per task: `hugo --gc` exits 0; **playwright screenshot** (against the local `hugo server` at `:1313`) for theming tasks (visual diff vs `design-system.html`); build + page-present for docs tasks. The sectioned docs must each render at `/docs/<section>/<name>/`.

## 7. Execution

writing-plans → subagent-driven-development (fresh subagent per task + review), in worktree `../genie-ai-site-ds`. Local `hugo server` live on `:1313` for visual iteration. Commit per task on `feat/site-design-system-docs`; MR after all tasks + final review pass.

## 8. Out of scope

- i18n (ES translations); version dropdown; search analytics.
- Non-`docs/`-root references (`deploy/ansible`, `components/.../TRANSLATION-SERVICE-ARCHITECTURE.md`, root `README`/`CONTRIBUTING`) — stub links or omit.
- Rebuilding Docsy components from scratch (option C).
- Chat-app-only DS components (chat bubbles, modals, toasts) — not relevant to a docs site.

## 9. Acceptance criteria

1. Site builds clean (`hugo --gc` exit 0) on Hugo 0.154.5 (CI) and 0.163.3 (local).
2. Accent color `oklch(42% 0.18 265)` (or its computed form) appears in compiled CSS; primary navbar/buttons/links use it.
3. Inter + JetBrains Mono are self-hosted (`/fonts/*.woff2`), loaded via `@font-face`, no external font requests.
4. Navbar shows the real GENIE.AI mark (mobile `genie-ai-icon.svg`); dark-mode variant renders correctly.
5. Dark mode palette matches the DS dark tokens (toggle works, surfaces/text correct).
6. Docs portal renders 7 sections + 17 docs at `/docs/<section>/<name>/`; each section has a landing; portal landing links resolve.
7. No internal scratch (`superpowers`, `_bmad-output`, `e2e-tests`) leaks into the build.
8. `sync-docs.sh` still fails loudly on a missing source (curated allowlist intact).
