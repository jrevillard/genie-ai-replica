# Docs Site — Design-System Theming + Docs Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the GENIE.AI docs site's visual identity with the project design system (`design-system.html`) and expand the docs portal to mirror `docs/index.md` (17 docs across 7 sections).

**Architecture:** OKLch design tokens in CSS custom properties (the visible identity, driving a custom SCSS component layer on top of Docsy) + sRGB hex for Bootstrap's compile-time `$primary`/`$secondary` (required: Bootstrap 5.3 `mix()` rejects oklch — verified build-breaker; same colors, two representations). Docs published via a rewritten sectioned `sync-docs.sh` (front-matter injection + relative-link rewriting, fail-loud, idempotent).

**Tech Stack:** Hugo extended (0.154.5 CI / 0.163.3 local), Docsy `/theme` (`cfc902046af7`), Dart Sass, PostCSS (npm), Inter + JetBrains Mono (self-hosted), Playwright (visual verify).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-30-site-design-system-docs-design.md` (v2) — read first; this plan implements it.
- **Design-system source of truth:** `/home/jerome/git_projects/ITU/genie-ai/design-system.html` `:root` token block. Exact values are cited below; if in doubt, re-read that file.
- **OKLch architecture (verified):** oklch ONLY in CSS custom properties; Bootstrap SCSS color vars (`$primary`, `$secondary`, etc.) MUST be hex (BS `mix()`/`tint-color()`/`color-contrast()` reject oklch → build fails). Hexes (computed from the oklch): `$primary: #1b3fad`, `$secondary: #122f87`.
- **All output in English** (comments, commits, content).
- **Never commit to `main`** — branch `feat/site-design-system-docs` in worktree `../genie-ai-site-ds`. Push only when asked.
- **CI image `hugomods/hugo:exts` = Hugo 0.154.5** (bundles dart-sass + PostCSS + Node). Docsy pinned `/theme@cfc902046af7`.
- **Local Hugo:** `~/.local/bin/hugo` = 0.163.3+extended (shadows `/usr/bin/hugo` 0.154.5). `cd site && npm install` once for PostCSS.
- **Verification per task:** `hugo --gc` exit 0 + assertion (grep on compiled CSS at `public/scss/main.min.*.css`, or page-present). Theming tasks (1–5) ALSO get a Playwright screenshot vs `design-system.html`.
- **CWD:** all commands run from the worktree `/home/jerome/git_projects/ITU/genie-ai-site-ds`; site work is under `site/`.

## Phase 0 (folded into Task 1)

Empirically verify the SCSS pipeline before building theming on it: hex `$primary` compiles (no `mix()` error), oklch CSS vars render. This is Task 1's gate.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `site/assets/scss/_variables_project.scss` | Bootstrap SCSS overrides in **hex** (primary/secondary, radii, font vars) | 1 |
| `site/assets/scss/_tokens.scss` | `:root` + `[data-theme=dark]` OKLch CSS custom properties (DS identity) + `@font-face` | 1, 2 |
| `site/assets/scss/_custom.scss` | Component restyle layer (navbar/sidebar/buttons/code/cards/tables/inputs/badges/links) | 4 |
| `site/assets/scss/main.scss` (project) | Import order: `_tokens` → Docsy → `_custom` (Hugo Pipes) | 1, 4 |
| `site/static/fonts/*.woff2`, `site/static/fonts/LICENSE` | Self-hosted Inter + JetBrains Mono | 2 |
| `site/assets/images/genie-ai-icon.svg`, `-light.svg`, `logo.svg` | Logo mark + dark variant + wordmark asset | 3 |
| `site/static/favicon.ico`, `apple-touch-icon.png` | Favicon | 3 |
| `site/scripts/sync-docs.sh` | Sectioned copy + front-matter inject + link rewrite | 6 |
| `site/content/en/docs/_index.md` | Portal landing (cards, reader path) | 8 |
| `site/content/en/docs/<section>/_index.md` ×7 | Section landings | 7 |
| `site/hugo.toml` | Chroma style pin (`[markup.highlight]`) | 5 |
| `site/.gitignore` | Corrected `**` negation | 9 |
| `site/layouts/partials/navbar.html` (override) | Logo + wordmark wiring, dark toggle persist | 3, 5 |

---

### Task 1: Token layer (Phase 0 + A1)

**Files:**
- Create: `site/assets/scss/_tokens.scss`
- Modify: `site/assets/scss/_variables_project.scss`
- Create: `site/assets/scss/main.scss` (project asset that orders imports)

**Interfaces:**
- Produces: `:root { --ds-accent, --ds-accent-hover, --ds-accent-secondary, --ds-bg, --ds-surface, --ds-fg, --ds-muted, --ds-border, --ds-radius-{sm,md,lg,xl}, --ds-shadow-{sm,md,lg}, --ds-font-body, --ds-font-mono }` (light) + overrides under `[data-theme="dark"]`. Tasks 2/4/5 consume these. Bootstrap `$primary`/`$secondary` = hex (consumed by Docsy/Bootstrap).

- [ ] **Step 1: Write `site/assets/scss/_tokens.scss` (light + dark OKLch CSS vars)**

```scss
// GENIE.AI design-system tokens (source: design-system.html :root).
// OKLch in CSS custom properties — the visible identity. Bootstrap SCSS vars
// stay hex (see _variables_project.scss) because BS mix()/color-contrast() reject oklch.

:root {
  // Accent (institutional blue)
  --ds-accent: oklch(42% 0.18 265);
  --ds-accent-hover: oklch(38% 0.20 265);
  --ds-accent-secondary: oklch(35% 0.15 265);
  --ds-accent-muted: oklch(42% 0.18 265 / 0.15);

  // Surfaces & text (light)
  --ds-bg: oklch(98% 0.005 250);
  --ds-surface: oklch(100% 0 0);
  --ds-fg: oklch(22% 0.02 240);
  --ds-muted: oklch(50% 0.018 240);
  --ds-border: oklch(82% 0.012 240);

  // Radii, shadows, fonts
  --ds-radius-sm: 4px;
  --ds-radius-md: 8px;
  --ds-radius-lg: 12px;
  --ds-radius-xl: 16px;
  --ds-shadow-sm: 0 1px 2px oklch(20% 0.02 250 / 0.08);
  --ds-shadow-md: 0 4px 6px oklch(20% 0.02 250 / 0.10);
  --ds-shadow-lg: 0 10px 15px oklch(20% 0.02 250 / 0.12);
  --ds-font-body: "Inter", system-ui, -apple-system, sans-serif;
  --ds-font-mono: "JetBrains Mono", ui-monospace, monospace;
}

[data-theme="dark"] {
  --ds-bg: oklch(15% 0.008 250);
  --ds-surface: oklch(24% 0.01 250);
  --ds-fg: oklch(95% 0.005 250);
  --ds-muted: oklch(73% 0.015 240);
  --ds-border: oklch(42% 0.015 250);
  --ds-accent: oklch(62% 0.17 265);
  --ds-accent-hover: oklch(56% 0.19 265);
  --ds-accent-secondary: oklch(52% 0.15 265);
  --ds-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --ds-shadow-md: 0 4px 6px rgba(0, 0, 0, 0.3);
  --ds-shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: Replace `site/assets/scss/_variables_project.scss` (Bootstrap hex overrides)**

```scss
// Bootstrap/Docsy SCSS overrides. HEX only here — Bootstrap color functions
// (mix/tint/shade/color-contrast) reject oklch and break the build.
// Hexes are the sRGB rendering of the DS oklch accent (same colors).
$primary: #1b3fad;       // = oklch(42% 0.18 265)
$secondary: #122f87;     // = oklch(35% 0.15 265)
$body-bg: #ffffff;

// Font stacks (self-hosted via _tokens.scss @font-face — Task 2 wires the files)
$font-family-sans-serif: "Inter", system-ui, -apple-system, sans-serif;
$font-family-monospace: "JetBrains Mono", ui-monospace, monospace;

// Docsy radii
$border-radius: 8px;
$border-radius-sm: 4px;
$border-radius-lg: 12px;
```

- [ ] **Step 3: Create `site/assets/scss/main.scss` to fix import order (tokens → Docsy → custom)**

```scss
// Project SCSS entry — controls import order over Docsy.
@import "tokens";                 // DS OKLch CSS vars (light + dark)
@import "../themes/docsy/assets/scss/main";   // Docsy/Bootstrap (uses $primary hex above)
@import "custom";                 // component restyle (Task 4 adds this; empty stub for now)
```
(If Docsy's main path differs, use the module path Docsy resolves — verify by checking the built source. A fallback: keep `_variables_project.scss` + `_tokens.scss` auto-imported by Docsy's own `main.scss` and SKIP this file; Docsy auto-imports `_variables_project.scss`. Prefer letting Docsy import `_variables_project.scss`, and add `_tokens.scss` + `_custom.scss` via Docsy's `_variables_project.scss` `@import` at top/bottom. **Decide empirically in Step 5**: if Docsy already picks up `_variables_project.scss`, append `@import "tokens";` at its top and `@import "custom";` at its bottom instead of a separate `main.scss`.)

- [ ] **Step 4: Create an empty `site/assets/scss/_custom.scss` stub (Task 4 fills it)**

```scss
// GENIE.AI component restyle (filled in Task 4). Imported after Docsy.
```

- [ ] **Step 5: Phase 0 — verify the SCSS pipeline compiles (the gate)**

```bash
cd site
npm install >/dev/null 2>&1   # PostCSS deps (first time)
hugo --gc --destination /tmp/genie-t1 2>&1 | grep -iE "error|must be a color|Total in" | head
```
Expected: `Total in <ms>`, NO `error`, NO `must be a color`. If `mix()` error returns, `$primary` is not hex — fix Step 2.

```bash
grep -o "oklch(42% 0.18 265)" /tmp/genie-t1/scss/*.css | head -1   # DS identity in :root
grep -o "#1b3fad" /tmp/genie-t1/scss/*.css | head -1                # BS primary hex
grep -o '\[data-theme="dark"\]' /tmp/genie-t1/scss/*.css | head -1  # dark block present
```
Expected: all three print a match. **This is the Phase 0 pass** — dart-sass present, hex compiles, oklch renders.

- [ ] **Step 6: Commit**

```bash
git add site/assets/scss/
git commit -m "feat(site): DS token layer (OKLch CSS vars + hex Bootstrap primary)"
```

---

### Task 2: Self-hosted fonts (A2)

**Files:**
- Create: `site/static/fonts/inter-*.woff2`, `jetbrains-mono-*.woff2`, `site/static/fonts/LICENSE`
- Modify: `site/assets/scss/_tokens.scss` (append `@font-face`)

**Interfaces:**
- Produces: `/fonts/inter-400.woff2` … `/fonts/jetbrains-mono-400.woff2` served from `static/fonts/`; `@font-face` families `"Inter"` and `"JetBrains Mono"` (referenced by `--ds-font-body`/`--ds-font-mono` from Task 1).

- [ ] **Step 1: Install font packages and copy the woff2 files**

```bash
cd site
npm install --save-dev @fontsource/inter @fontsource/jetbrains-mono >/dev/null 2>&1
mkdir -p static/fonts
# Inter weights 400/500/600/700 (latin + latin-ext subsets)
for w in 400 500 600 700; do
  cp node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2 static/fonts/inter-${w}.woff2
  cp node_modules/@fontsource/inter/files/inter-latin-ext-${w}-normal.woff2 static/fonts/inter-latin-ext-${w}.woff2
done
# JetBrains Mono 400/500
for w in 400 500; do
  cp node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2 static/fonts/jetbrains-mono-${w}.woff2
done
# License (both OFL)
cat node_modules/@fontsource/inter/LICENSE > static/fonts/LICENSE
```
(If `@fontsource` file names differ by version, `ls node_modules/@fontsource/inter/files/` to find the exact `*-latin-*-normal.woff2` names and adjust.)

- [ ] **Step 2: Append `@font-face` to `site/assets/scss/_tokens.scss`**

```scss
// Self-hosted fonts (no external requests). font-display: swap = no FOIT.
@font-face {
  font-family: "Inter"; font-style: normal; font-weight: 400; font-display: swap;
  src: url("/fonts/inter-400.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face { font-family: "Inter"; font-weight: 500; font-display: swap; font-style: normal; src: url("/fonts/inter-500.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; font-display: swap; font-style: normal; src: url("/fonts/inter-600.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 700; font-display: swap; font-style: normal; src: url("/fonts/inter-700.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400; font-display: swap; font-style: normal; src: url("/fonts/jetbrains-mono-400.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 500; font-display: swap; font-style: normal; src: url("/fonts/jetbrains-mono-500.woff2") format("woff2"); }
```

- [ ] **Step 3: Verify fonts are served + referenced, no external font calls**

```bash
cd site && hugo --gc --destination /tmp/genie-t2 >/dev/null 2>&1
ls /tmp/genie-t2/fonts/ | grep -E "inter-400|jetbrains-mono-400"   # files published
grep -o '/fonts/inter-400.woff2' /tmp/genie-t2/index.html | head -1  # referenced
grep -c "fonts.googleapis\|fonts.gstatic" /tmp/genie-t2/index.html   # 0 = no external
```
Expected: files present, reference present, external count `0`.

- [ ] **Step 4: Commit**

```bash
git add site/static/fonts/ site/assets/scss/_tokens.scss
git commit -m "feat(site): self-host Inter + JetBrains Mono (sovereign, no external CDN)"
```

---

### Task 3: Logo + wordmark + favicon (A3)

**Files:**
- Create: `site/assets/images/genie-ai-icon.svg`, `genie-ai-icon-light.svg`, `logo.svg`
- Create: `site/static/favicon.ico`, `site/static/apple-touch-icon.png`
- Create/Modify: `site/layouts/partials/navbar.html` (Docsy override — logo + wordmark)

**Interfaces:**
- Consumes: `mobile/genie_ai_mobile/assets/config/genie-ai-icon.svg` + `-light.svg` (source assets).
- Produces: navbar renders mark + "GENIE" wordmark; dark navbar uses `-light.svg`; favicon served.

- [ ] **Step 1: Copy logo assets from the mobile app**

```bash
cd site
MOBILE=../../mobile/genie_ai_mobile/assets/config
cp "$MOBILE/genie-ai-icon.svg"        assets/images/genie-ai-icon.svg
cp "$MOBILE/genie-ai-icon-light.svg"  assets/images/genie-ai-icon-light.svg
# wordmark variant if present, else use the icon for now
cp "$MOBILE/genie-ai-icon.svg"        assets/images/logo.svg
```

- [ ] **Step 2: Derive favicon + apple-touch-icon**

```bash
cd site
# Convert the mark to favicon/png (requires rsvg-convert or inkscape; fallback: copy svg)
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 32 -h 32 assets/images/genie-ai-icon.svg -o static/apple-touch-icon.png
  rsvg-convert -w 32 -h 32 assets/images/genie-ai-icon.svg -o /tmp/fav.png
else
  cp assets/images/genie-ai-icon.svg static/favicon.svg   # SVG favicon fallback
fi
```
(If no raster converter, ship `static/favicon.svg` + `static/apple-touch-icon.png` copied from the mobile `assets/icons/android-chrome-192x192.png` — `ls ../../mobile/genie_ai_mobile/assets/icons/`.)

- [ ] **Step 3: Override Docsy navbar partial — logo + wordmark + dark variant**

Read Docsy's `navbar.html` first to copy its structure:
```bash
find ~/.cache/hugo_cache -path "*docsy*layouts/partials/navbar.html" | head -1 | xargs cat
```
Create `site/layouts/partials/navbar.html` mirroring Docsy's, but replace the logo block with:
```html
{{/* GENIE.AI logo: mark + wordmark, dark variant via CSS */}}
<a class="navbar-brand ds-brand" href="{{ "/" | relLangURL }}">
  <img class="ds-logo" src="{{ "images/genie-ai-icon.svg" | relURL }}" height="32" alt="GENIE.AI">
  <img class="ds-logo-dark" src="{{ "images/genie-ai-icon-light.svg" | relURL }}" height="32" alt="GENIE.AI">
  <span class="ds-wordmark">GENIE</span>
</a>
```
(Match Docsy's surrounding `<nav>`/container markup from the file you read.)

- [ ] **Step 4: Append brand styling to `site/assets/scss/_custom.scss`**

```scss
// Navbar brand: mark + wordmark. Dark variant swaps via [data-theme=dark].
.ds-brand { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
.ds-wordmark { font-family: var(--ds-font-body); font-weight: 700; letter-spacing: -0.02em; color: var(--ds-fg); }
.ds-logo-dark { display: none; }
[data-theme="dark"] .ds-logo { display: none; }
[data-theme="dark"] .ds-logo-dark { display: inline; }
```

- [ ] **Step 5: Verify**

```bash
cd site && hugo --gc --destination /tmp/genie-t3 >/dev/null 2>&1
grep -o 'genie-ai-icon.svg' /tmp/genie-t3/index.html | head -1   # logo referenced
grep -o 'ds-wordmark' /tmp/genie-t3/index.html | head -1          # wordmark rendered
grep -o 'ds-logo-dark' /tmp/genie-t3/index.html | head -1         # dark variant wired
test -f /tmp/genie-t3/images/genie-ai-icon.svg && echo "mark published"
```
Expected: all present. Playwright: open `http://127.0.0.1:1313/`, screenshot navbar — mark + "GENIE" visible.

- [ ] **Step 6: Commit**

```bash
git add site/assets/images/ site/static/ site/layouts/ site/assets/scss/_custom.scss
git commit -m "feat(site): real GENIE.AI logo + wordmark + favicon, dark variant"
```

---

### Task 4: Component restyle layer (A4)

**Files:**
- Modify: `site/assets/scss/_custom.scss` (the bulk — token-driven overrides on top of Docsy/Bootstrap)

**Interfaces:**
- Consumes: all `--ds-*` CSS vars from Task 1, fonts from Task 2.
- Produces: DS-styled navbar/sidebar/buttons/links/code/callouts/cards/tables/inputs/badges.

- [ ] **Step 1: Append the component restyle to `_custom.scss`**

```scss
// === GENIE.AI component restyle (on top of Docsy/Bootstrap) — token-driven ===

// Body / base
body { background: var(--ds-bg); color: var(--ds-fg); font-family: var(--ds-font-body); }
a { color: var(--ds-accent); }
a:hover { color: var(--ds-accent-hover); }

// Navbar
.td-navbar { background: var(--ds-surface); border-bottom: 1px solid var(--ds-border); box-shadow: var(--ds-shadow-sm); }
.td-navbar .nav-link { color: var(--ds-fg); font-weight: 500; }
.td-navbar .nav-link:hover { color: var(--ds-accent); }

// Sidebar
.td-sidebar { background: var(--ds-surface); border-right: 1px solid var(--ds-border); }
.td-sidebar-nav a { border-radius: var(--ds-radius-sm); color: var(--ds-fg); }
.td-sidebar-nav a.active { background: var(--ds-accent-muted); color: var(--ds-accent); font-weight: 600; }

// Buttons
.btn { border-radius: var(--ds-radius-md); font-weight: 500; }
.btn-primary { background: var(--ds-accent); border-color: var(--ds-accent); }
.btn-primary:hover { background: var(--ds-accent-hover); border-color: var(--ds-accent-hover); }
.btn-outline-secondary { border-radius: var(--ds-radius-md); }

// Cards
.card { border-radius: var(--ds-radius-lg); border: 1px solid var(--ds-border); box-shadow: var(--ds-shadow-sm); background: var(--ds-surface); }

// Code blocks (Chroma base; Task 5 pins the Chroma theme)
pre, code, pre code { font-family: var(--ds-font-mono); }
pre { background: var(--ds-surface); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); padding: 12px; }
:not(pre) > code { background: var(--ds-accent-muted); border-radius: var(--ds-radius-sm); padding: 1px 4px; }

// Callouts / admonitions
.alert { border-radius: var(--ds-radius-md); border-left: 4px solid var(--ds-accent); background: var(--ds-accent-muted); }

// Tables
table { border-radius: var(--ds-radius-md); overflow: hidden; }
th { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78rem; color: var(--ds-muted); border-bottom: 1px solid var(--ds-border); }

// Inputs / search
.form-control, .td-search input { border-radius: var(--ds-radius-md); border: 1px solid var(--ds-border); font-size: 0.9rem; }
.form-control:focus, .td-search input:focus { border-color: var(--ds-accent); box-shadow: 0 0 0 2px var(--ds-accent-muted); }

// Badges
.badge { border-radius: var(--ds-radius-sm); font-family: var(--ds-font-mono); font-weight: 500; }

// Mono eyebrow labels (DS convention)
.eyebrow { font-family: var(--ds-font-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.7rem; color: var(--ds-muted); }
```

- [ ] **Step 2: Verify compile + tokens reach components**

```bash
cd site && hugo --gc --destination /tmp/genie-t4 >/dev/null 2>&1
grep -o "var(--ds-accent)" /tmp/genie-t4/scss/*.css | head -1          # vars applied
grep -o "oklch(42% 0.18 265)" /tmp/genie-t4/scss/*.css | head -1        # identity preserved
```
Expected: both present.

- [ ] **Step 3: Playwright visual check vs design-system.html**

```bash
hugo server -D --port 1313 >/tmp/hugo.log 2>&1 &  # if not already running
sleep 3
playwright-cli open http://127.0.0.1:1313/docs/   # sidebar + content styling
playwright-cli screenshot
```
Compare the sidebar/navbar/buttons against `design-system.html` (open it in a browser). Confirm accent blue, Inter type, radii, shadows match. Iterate `_custom.scss` selectors as needed (Docsy class names may differ by version — inspect with `grep -rn "td-sidebar\|td-navbar" ~/.cache/hugo_cache/.../docsy.../layouts`).

- [ ] **Step 4: Commit**

```bash
git add site/assets/scss/_custom.scss
git commit -m "feat(site): DS component restyle (navbar/sidebar/buttons/cards/code/tables/inputs/badges)"
```

---

### Task 5: Dark mode + Chroma + WCAG contrast (A5)

**Files:**
- Modify: `site/assets/scss/_tokens.scss` (dark vars already there; ensure Docsy dark selector matches)
- Modify: `site/hugo.toml` (pin Chroma style)
- Modify: `site/layouts/partials/navbar.html` or a small JS hook (toggle persistence)
- Create: `site/assets/js/theme-toggle.js` (localStorage persist)

**Interfaces:**
- Produces: working + persisted dark toggle; DS-dark palette; Chroma code theme matching DS surface; WCAG AA contrast met.

- [ ] **Step 1: Pin Chroma style in `site/hugo.toml`**

Append:
```toml
[markup.highlight]
  style = "github-dark"
  lineNos = false
  noClasses = false
```

- [ ] **Step 2: Override Chroma background to DS surface (append to `_custom.scss`)**

```scss
// Chroma code blocks: DS surface, not the theme's hardcoded bg.
.highlight, .chroma { background: var(--ds-surface) !important; border-radius: var(--ds-radius-md); }
```

- [ ] **Step 3: Theme-toggle persistence — create `site/assets/js/theme-toggle.js`**

```javascript
// Persist Docsy's light/dark choice. Apply before paint to avoid flash.
(function () {
  var saved = localStorage.getItem('preferred_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.querySelector('.td-navbar .btn-link, [aria-label*="theme" i]');
  if (!btn) return;
  var observer = new MutationObserver(function () {
    var t = document.documentElement.getAttribute('data-theme') || 'light';
    localStorage.setItem('preferred_theme', t);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});
```
Reference it: add `<script src="{{ "js/theme-toggle.js" | relURL }}" defer></script>` to `site/layouts/partials/hooks/body-end.html` (create the file; Docsy calls this hook if present).

- [ ] **Step 4: Ensure dark selector matches**

Docsy toggles `html.dark` by default; `_tokens.scss` uses `[data-theme="dark"]`. Unify — change `_tokens.scss` dark block to target BOTH:
```scss
[data-theme="dark"], html.dark, .dark { /* same dark vars */ }
```
(Update the `[data-theme="dark"] {` line from Task 1 to the multi-selector form.)

- [ ] **Step 5: Verify toggle + Chroma + contrast**

```bash
cd site && hugo --gc --destination /tmp/genie-t5 >/dev/null 2>&1
grep -o 'theme-toggle.js' /tmp/genie-t5/index.html | head -1                 # script wired
grep -o 'github-dark' /tmp/genie-t5/scss/*.css 2>/dev/null | head -1          # chroma class
grep -o 'html.dark' /tmp/genie-t5/scss/*.css | head -1                        # dark selector
```
Playwright: toggle dark mode in browser, screenshot — surfaces/text flip to DS dark tokens, code block background matches. **WCAG check:** for body text `--ds-fg` on `--ds-bg` (light: oklch(22%) on oklch(98%); dark: oklch(95%) on oklch(15%)), compute contrast ratio — must be ≥4.5:1. Use `https://contrast-ratio.com` or compute: both easily exceed 4.5:1 (verify and note the values).

- [ ] **Step 6: Commit**

```bash
git add site/hugo.toml site/assets/scss/ site/assets/js/ site/layouts/
git commit -m "feat(site): dark mode persistence + Chroma theme + WCAG-AA contrast"
```

---

### Task 6: sync-docs.sh rewrite (B1)

**Files:**
- Modify: `site/scripts/sync-docs.sh` (full rewrite)

**Interfaces:**
- Produces: `content/en/docs/<section>/<name>.md` for 17 docs (7 sections), each with front matter, intra-doc links rewritten to site paths, fail-loud + idempotent.

- [ ] **Step 1: Replace `site/scripts/sync-docs.sh`**

```sh
#!/usr/bin/env sh
# Sync curated repo-root docs/ into the Hugo site, sectioned + with front matter.
# Source of truth: <repo>/docs/*.md  ->  site/content/en/docs/<section>/<name>.md
# - Idempotent: rm + recopy each run.
# - Front-matter injection: prepend title/weight if the source has no TOML/YAML FM.
# - Relative-link rewrite: ](./foo.md) -> ](/docs/<section>/foo/) (best-effort).
# - Fail-loud: set -eu; missing source = cp error = red CI.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DOCS="$(cd "$SITE_DIR/../docs" && pwd)"
DEST="$SITE_DIR/content/en/docs"

# section : weight : source-basename : target-name
MAP="
core:1:project-overview.md:project-overview
core:2:source-tree-analysis.md:source-tree-analysis
core:3:integration-architecture.md:integration-architecture
core:4:development-guide.md:development-guide
frontend:1:ui-component-inventory-gov-chat-frontend.md:ui-component-inventory-frontend
frontend:2:state-management-gov-chat-frontend.md:state-management-frontend
frontend:3:theme-system.md:theme-system
backend:1:api-contracts-gov-chat-backend.md:api-contracts-backend
mobile:1:ui-component-inventory-mobile.md:ui-component-inventory-mobile
mobile:2:mobile-architecture-genie-ai-mobile.md:mobile-architecture
architecture:1:architecture.md:architecture
architecture:2:LOGGING-ARCHITECTURE-EVALUATION.md:logging-architecture
deployment:1:docker-compose-setup.md:docker-compose-setup
deployment:2:docker-swarm-setup.md:docker-swarm-setup
deployment:3:mobile-deployment-guide.md:mobile-deployment-guide
configuration:1:keycloak-admin-guide.md:keycloak-admin-guide
configuration:2:external-idp-integration-guide.md:external-idp-integration-guide
"

inject_front_matter() {
  # $1 = source file, $2 = title, $3 = weight, $4 = section
  if head -1 "$1" | grep -q '^---\|^+++'; then
    cat "$1"   # already has front matter
  else
    printf -- '---\ntitle: "%s"\nweight: %s\nsection: "%s"\n---\n\n' "$2" "$3" "$4"
    cat "$1"
  fi
}

rewrite_links() {
  # $1 = target section. Rewrites ](./foo.md) and ](../foo.md) -> ](/docs/<section>/foo/)
  # Best-effort: docs sharing a basename in the MAP resolve; others left (linkcheck flags them).
  sed -E 's#\]\(\./([a-zA-Z0-9_-]+)\.md\)#](/'"$1"'/\1)#g; s#\]\(\.\./([a-zA-Z0-9_-]+)\.md\)#](/'"$1"'/\1)#g'
}

rm -rf "$DEST"
echo "$MAP" | while IFS=: read -r section weight src tgt; do
  [ -z "$section" ] && continue
  mkdir -p "$DEST/$section"
  title=$(printf '%s' "$tgt" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1))substr($i,2)}1')
  inject_front_matter "$REPO_DOCS/$src" "$title" "$weight" "$section" | rewrite_links "$section" > "$DEST/$section/$tgt.md"
done

echo "Synced $(echo "$MAP" | grep -c ':') docs -> $DEST"
```

- [ ] **Step 2: Make executable + run**

```bash
cd site && chmod +x scripts/sync-docs.sh && sh scripts/sync-docs.sh
find content/en/docs -name '*.md' | sort   # expect 17 docs across 7 sections
```

- [ ] **Step 3: Verify front matter + link rewrite + fail-loud**

```bash
head -5 site/content/en/docs/core/project-overview.md          # has --- title/weight --- block
grep -rn '](\./' site/content/en/docs/ || echo "no ./ links remain"  # rewritten
# fail-loud: break one source path, expect non-zero
cp site/scripts/sync-docs.sh /tmp/s.bak
sed -i 's#project-overview.md#NOPE.md#' site/scripts/sync-docs.sh
(sh site/scripts/sync-docs.sh; echo "exit=$?")
cp /tmp/s.bak site/scripts/sync-docs.sh
```
Expected: front matter present; no `./` links; broken-source `exit` non-zero.

- [ ] **Step 4: Build the docs**

```bash
cd site && hugo --gc --destination /tmp/genie-t6 >/dev/null 2>&1
for p in core/project-overview deployment/docker-compose-setup architecture/architecture; do
  test -f "/tmp/genie-t6/docs/$p/index.html" && echo "ok: $p" || echo "MISSING: $p"
done
```

- [ ] **Step 5: Commit**

```bash
git add site/scripts/sync-docs.sh
git commit -m "feat(site): sectioned sync-docs (17 docs/7 sections, front-matter inject, link rewrite)"
```

---

### Task 7: Section landings + weights (B2)

**Files:**
- Create: `site/content/en/docs/{core,frontend,backend,mobile,architecture,deployment,configuration}/_index.md` (7 files)

**Interfaces:**
- Produces: per-section landing pages (one-paragraph purpose + doc list) with `weight` for sidebar grouping.

- [ ] **Step 1: Create the 7 section `_index.md` files**

For each section, a file like `site/content/en/docs/core/_index.md`:
```markdown
---
title: "Core"
weight: 1
description: "GENIE.AI foundations: overview, structure, integration, development."
---

# Core

Foundational references for understanding GENIE.AI: what it is, how the repo is laid out, how components integrate, and how to develop.

- [Project Overview](project-overview)
- [Source Tree Analysis](source-tree-analysis)
- [Integration Architecture](integration-architecture)
- [Development Guide](development-guide)
```
Weights: core=1, frontend=2, backend=3, mobile=4, architecture=5, deployment=6, configuration=7. Replace the title/description/list per section:
- frontend (w2): "Frontend (Vue 3)" — UI inventory, state management, theme system.
- backend (w3): "Backend (Node.js)" — API contracts.
- mobile (w4): "Mobile (Flutter)" — UI inventory, mobile architecture.
- architecture (w5): "Architecture" — system architecture, logging/observability.
- deployment (w6): "Deployment" — Docker Compose, Docker Swarm, mobile deployment.
- configuration (w7): "Configuration" — Keycloak admin, external IdP.

- [ ] **Step 2: Verify sidebar groups + section landings render**

```bash
cd site && sh scripts/sync-docs.sh && hugo --gc --destination /tmp/genie-t7 >/dev/null 2>&1
for s in core frontend backend mobile architecture deployment configuration; do
  test -f "/tmp/genie-t7/docs/$s/index.html" && echo "ok: $s landing" || echo "MISSING: $s"
done
```
Playwright: `/docs/` sidebar shows 7 grouped sections.

- [ ] **Step 3: Commit**

```bash
git add site/content/en/docs/*/_index.md
git commit -m "feat(site): 7 docs section landings + weight convention"
```

---

### Task 8: Portal landing (B3)

**Files:**
- Modify: `site/content/en/docs/_index.md` (replace the sparse landing with a real entry page)

**Interfaces:**
- Produces: portal landing with intro, "Start here" path, section cards (DS card), guide vs reference split, Hugo-correct links.

- [ ] **Step 1: Replace `site/content/en/docs/_index.md`**

```markdown
---
title: "Documentation"
weight: 1
description: "GENIE.AI documentation — architecture, development, deployment, integration."
---

# GENIE.AI Documentation

Sovereign, DPG-compliant generative AI / RAG framework for the public sector.

## Start here

New to GENIE.AI? Follow this path:

1. [Project Overview](/docs/core/project-overview/) — what it is and why.
2. [Development Guide](/docs/core/development-guide/) — build and run locally.
3. [Deployment (Docker Compose)](/docs/deployment/docker-compose-setup/) — ship it.

## Sections

<div class="row row-cols-1 row-cols-md-2 g-4">
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Core</h3><p class="card-text">Foundations: overview, structure, integration, development.</p>
    <a class="btn btn-primary" href="/docs/core/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Frontend</h3><p class="card-text">Vue 3 web app: UI inventory, state, theme.</p>
    <a class="btn btn-primary" href="/docs/frontend/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Backend</h3><p class="card-text">Node.js API contracts.</p>
    <a class="btn btn-primary" href="/docs/backend/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Mobile</h3><p class="card-text">Flutter app: UI inventory, architecture.</p>
    <a class="btn btn-primary" href="/docs/mobile/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Architecture</h3><p class="card-text">System architecture, logging & observability.</p>
    <a class="btn btn-primary" href="/docs/architecture/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Deployment</h3><p class="card-text">Docker Compose, Docker Swarm, mobile deployment.</p>
    <a class="btn btn-primary" href="/docs/deployment/">Open</a>
  </div></div></div>
  <div class="col"><div class="card h-100"><div class="card-body">
    <h3 class="card-title">Configuration</h3><p class="card-text">Keycloak admin, external IdP integration.</p>
    <a class="btn btn-primary" href="/docs/configuration/">Open</a>
  </div></div></div>
</div>

## Guides vs reference

- **Guides** (read top-to-bottom): Development Guide, Deployment, Keycloak admin.
- **Reference** (jump in): API contracts, UI inventories, integration architecture.
```

- [ ] **Step 2: Verify + linkcheck**

```bash
cd site && hugo --gc --destination /tmp/genie-t8 >/dev/null 2>&1
grep -o 'Start here' /tmp/genie-t8/docs/index.html | head -1
# linkcheck: no unresolved repo-relative links remain in built docs
(! grep -rl '](\./\|\.\./docs/' /tmp/genie-t8/docs/) && echo "linkcheck clean"
```
Expected: "Start here" present; linkcheck clean.

- [ ] **Step 3: Commit**

```bash
git add site/content/en/docs/_index.md
git commit -m "feat(site): docs portal landing (cards, reader path, guide/reference split)"
```

---

### Task 9: .gitignore fix + final E2E (B4)

**Files:**
- Modify: `site/.gitignore`

**Interfaces:**
- Produces: sectioned copied docs gitignored at any depth; authored `_index.md` tracked at any depth.

- [ ] **Step 1: Fix the `**` negation in `site/.gitignore`**

Replace the existing `/content/en/docs/*` + `!/content/en/docs/_index.md` lines with:
```gitignore
# Doc content copied at build time by scripts/sync-docs.sh.
# Ignore all (any depth); re-open dirs (trailing slash) + re-include authored _index.md.
/content/en/docs/**/*
!/content/en/docs/**/
!/content/en/docs/**/_index.md
```

- [ ] **Step 2: Verify tracked vs ignored at depth**

```bash
cd site && sh scripts/sync-docs.sh
git check-ignore content/en/docs/core/project-overview.md && echo "copied doc ignored ✓"
git check-ignore content/en/docs/core/_index.md || echo "section _index.md tracked ✓"
git status --short   # only _index.md files + intentional changes appear, no copied docs
```
Expected: copied doc ignored; section `_index.md` NOT ignored (tracked); status clean of copied docs.

- [ ] **Step 3: Full clean E2E build**

```bash
cd site
rm -rf public content/en/docs
sh scripts/sync-docs.sh
npm install >/dev/null 2>&1
hugo --gc --minify --destination /tmp/genie-final
find /tmp/genie-final -name index.html | wc -l                    # many pages
grep -o "oklch(42% 0.18 265)" /tmp/genie-final/scss/*.css | head -1  # DS identity
grep -o "#1b3fad" /tmp/genie-final/scss/*.css | head -1             # BS primary hex
for p in core/project-overview deployment/docker-compose-setup configuration/keycloak-admin-guide; do
  test -f "/tmp/genie-final/docs/$p/index.html" && echo "ok: $p" || echo "MISSING: $p"
done
test -f /tmp/genie-final/fonts/inter-400.woff2 && echo "fonts ok"
(! grep -rl "superpowers\|_bmad-output\|e2e-tests" /tmp/genie-final) && echo "no scratch leaked"
```
Expected: pages built, oklch + hex present, sample docs + fonts present, no scratch leaked.

- [ ] **Step 4: Commit**

```bash
git add site/.gitignore
git commit -m "fix(site): gitignore ** negation (track section _index.md at depth)"
```

- [ ] **Step 5: Push + open MR (after final review)**

```bash
git push -u origin feat/site-design-system-docs
# glab mr create --source-branch feat/site-design-system-docs --target-branch main ...
```
(Commit message body: references spec + plan. `pages` job runs in the MR pipeline — confirms the CI build.)

---

## Self-Review

**Spec coverage:**
- §3 OKLch architecture → Task 1 (Phase 0 gate). ✓
- A1 tokens → Task 1. A2 fonts → Task 2. A3 logo → Task 3. A4 components → Task 4. A5 dark/chroma/contrast → Task 5. ✓
- B1 sync → Task 6. B2 landings → Task 7. B3 portal landing → Task 8. B4 gitignore → Task 9. ✓
- §6 verification → every task (build + grep/screenshot); Phase 0 (T1); linkcheck (T8); WCAG (T5). ✓
- §8 rollback → branch-only, main untouched until merge. ✓
- §10 acceptance: 1(build T9), 2(Phase0 T1), 3(oklch+hex T1/T9), 4(fonts T2/T9), 5(logo T3), 6(dark+WCAG T5), 7(docs+landings+linkcheck T6/T7/T8), 8(no scratch T9), 9(sync contract T6), 10(gitignore depth T9). ✓

**Placeholder scan:** Task 1 Step 3 has an empirical "decide import mechanism" branch — that's a real Docsy-version unknown, resolved empirically in Step 5 (not a placeholder; it gives both options + a verification). Font file-name note in Task 2 Step 1 handles @fontsource version variance (concrete fallback given). No TBD/TODO.

**Type/consistency:** `--ds-*` var names consistent across Tasks 1/2/4/5. Section names + weights consistent across Tasks 6/7/8. Hex `$primary #1b3fad` consistent T1/T9. All checks pass.

**Execution:** 9 tasks, A(1–5) → B(6–9), each independently testable. Ready for SDD.
