---
title: "Theme System"
description: "CSS-native theming for the Vue 3 web app — single brand color, OKLch derivation, config variants, and dark mode."
weight: 3
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers and deployers.** How a single brand color drives the entire palette (accent + neutrals + dark mode) without any JavaScript color math.

## Overview

GENIE.AI uses a **CSS-native theming** architecture. A single brand color — loaded from a JSON config — drives the entire accent palette. Every other color is derived in CSS using [OKLch relative color syntax](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch#relative_oklch_colors). Dark mode is the same CSS file with a different selector; the same `--brand` token flows through both.

```
JSON config (genie-ai-config.json)
  │
  ▼
main.js — reads config, sets --brand (and optional overrides) on <html>
  │
  ▼
theme-variables.css — derives full palette via OKLch relative syntax
  │
  ▼
Components consume tokens via var(--token)
```

OKLch encodes color as **L**ightness, **C**hroma (saturation), **H**ue. The relative syntax `oklch(from <color> l c h)` derives a new color from an existing one — useful for hover/active states without hand-picking hex values. The DS uses it to lighten (`l + 0.2`), darken (`l - 0.04`), mute (multiply chroma), and tint neutrals by the brand hue.

## JSON config

`components/gov-chat-frontend/public/config/genie-ai-config.json`:

```json
{
  "theme": {
    "brandColor": "#4071cb",
    "bg": "#f0f2f5",
    "fg": "#1a1a2e",
    "navbar": {
      "background": "#4071cb",
      "text": "#ffffff"
    },
    "colors": {
      "success": "#10b981",
      "warning": "#f59e0b",
      "danger": "#ef4444",
      "info": "#3b82f6"
    },
    "typography": {
      "fontFamily": "'Inter', sans-serif",
      "fontScale": 1.1
    }
  }
}
```

| Field | Required | Default | Effect |
|-------|----------|---------|--------|
| `brandColor` | yes | `#4071cb` | The single seed color. All accent variants (hover, muted, fg, secondary) and dark-mode neutrals are derived from it. |
| `bg` | no | `oklch(98% 0.005 250)` (near-white) | Light-mode page background. |
| `fg` | no | `oklch(22% 0.02 240)` (dark blue) | Light-mode primary text. |
| `navbar.background` | no | falls back to `brandColor` | Navbar background. |
| `navbar.text` | no | auto-derived by `--navbar-fg` (WCAG-style contrast against `navbar.background`) | Navbar text/icon color. |
| `colors.success` / `warning` / `danger` / `info` | no | DS defaults (`#10b981`, `#f59e0b`, `#ef4444`, `oklch(65% 0.15 240)`) | Semantic status colors. Apply to **both light and dark modes** — there is no separate dark override. |
| `typography.fontFamily` | no | system font stack | Applied to both `--font-body` and `--font-display`. |
| `typography.fontScale` | no | `1` | Multiplier for all `--text-*` tokens. Use values like `1.1` (10 % bigger) or `0.9` (10 % smaller). |

> The full config also defines `app`, `services`, `locale`, and other non-theme sections. Those are not consumed by the theme system.

## CSS derivation — `src/theme-variables.css`

Two selectors: `:root` for light, `[data-theme="dark"]` (plus `html[data-theme="dark"]` and `body[data-theme="dark"]` for safety) for dark. Both reference `--brand`. The whole file is OKLch.

```css
:root {
  --brand: oklch(47% 0.14 265);   /* fallback for dev — overridden by JS at boot */
  --bg: var(--config-bg, oklch(98% 0.005 250));
  --fg: var(--config-fg, oklch(22% 0.02 240));

  --accent: var(--brand);
  --accent-hover: oklch(from var(--brand) calc(l - 0.04) c h);
  --accent-muted: oklch(from var(--brand) l c h / 0.12);
  --accent-fg: oklch(from var(--brand) min(calc(l + 0.56), 0.98) calc(c * 0.1) h);
  --accent-secondary: oklch(from var(--brand) max(calc(l - 0.07), 0.05) c calc(h + 0));
}

[data-theme="dark"] {
  --bg: oklch(from var(--brand) 0.14 calc(c * 0.25) h);
  --surface: oklch(from var(--brand) 0.22 calc(c * 0.18) h);
  --fg: oklch(95% 0.005 250);
  --accent: oklch(from var(--brand) calc(l + 0.2) calc(c * 0.85) h);
  /* ... etc. */
}
```

Key behaviours:

- **Light mode** — `--accent` is the brand color, hover is darker (`l - 0.04`), muted is brand at 12 % opacity.
- **Dark mode** — `--accent` is lightened (`l + 0.2`, chroma reduced 15 %). The entire neutral palette (`--bg`, `--surface`, `--muted`, `--border`, `--bg-sidebar`) is **brand-tinted** at varying lightness/chroma — so a magenta brand produces a magenta-tinted dark mode, a green brand a green-tinted dark mode, etc.
- **Zero JavaScript color math.** The legacy `adjustColor()` helper has been removed; everything is CSS.

## Variable injection — `src/main.js`

`main.js` reads the config (either a `fetch('/config/genie-ai-config.json')` or the runtime-injected `window.APP_CONFIG` — see [Configuration](/docs/configure/)) and writes CSS custom properties on `<html>`. **The `--brand` setProperty has a `'#4071cb'` fallback** so the app works if config isn't loaded yet (first paint, broken CDN, etc.).

```javascript
// Simplified excerpt — see src/main.js lines ~57-83 for the full implementation.
const root = document.documentElement;
const theme = config.theme || {};

// Required — falls back to GENIE.AI blue if missing
root.style.setProperty('--brand', theme.brandColor || '#4071cb');

// Optional — only written if the config provides a value, otherwise CSS uses its own fallback
if (theme.bg) root.style.setProperty('--config-bg', theme.bg);
if (theme.fg) root.style.setProperty('--config-fg', theme.fg);
if (theme.navbar?.background) root.style.setProperty('--navbar-bg', theme.navbar.background);
if (theme.navbar?.text) root.style.setProperty('--navbar-fg', theme.navbar.text);
if (theme.colors) {
  ['success', 'warning', 'danger', 'info'].forEach((key) => {
    if (theme.colors[key]) root.style.setProperty(`--${key}`, theme.colors[key]);
  });
}
if (theme.typography?.fontFamily) {
  root.style.setProperty('--font-body', theme.typography.fontFamily);
  root.style.setProperty('--font-display', theme.typography.fontFamily);
}
if (theme.typography?.fontScale) {
  root.style.setProperty('--font-scale', String(theme.typography.fontScale));
}
```

`--config-bg` and `--config-fg` are **intermediate variables**: JS writes them, CSS reads them with `var(--config-bg, <fallback>)`. This pattern avoids specificity fights when the dark-mode selector wants to override `--bg`.

## Switching themes

The config file is **baked into the image at build time** — it is not loaded at runtime by default. To deploy with a different brand, rebuild the frontend image.

### Procedure

1. Choose or create a config variant in `components/gov-chat-frontend/public/config/` (see [Available variants](#available-variants) below).
2. Select it for the build:
   ```bash
   # Default GENIE.AI config — used automatically when nothing else is set
   docker compose build frontend

   # A non-default variant — override the config file in the image
   docker compose build --build-arg GENIE_AI_CONFIG_FILE=genie-ai-config-huduma.json frontend
   ```
3. Push the new image and restart:
   ```bash
   docker compose up -d frontend
   ```
   Or for Swarm:
   ```bash
   docker service update --image <registry>/<image>:<tag> genieai_frontend
   ```

> The rebuild is required because `public/config/*.json` is copied into the static-asset layer of the `nginx` image at `docker build` time. Restarting an old image with a new file on disk does nothing.

### Verify it worked

1. Hard-refresh the browser (Cmd/Ctrl + Shift + R) — service workers may cache the old JSON.
2. Open DevTools → Elements → `<html>` — the `--brand` style should reflect your new brand color.
3. Confirm the right file was baked into the image:
   ```bash
   docker exec $(docker ps --format '{{.Names}}' | grep frontend | head -1) \
     cat /usr/share/nginx/html/config/genie-ai-config.json | head -20
   ```
4. Check the dark mode too — switch the theme in Settings and confirm the neutrals are tinted by the new brand.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Brand color unchanged after restart | Stale image (config was edited but `docker compose build` not re-run) | Re-build with `docker compose build --no-cache frontend` then restart. |
| Brand color reverts on hard-refresh | Browser cache or service worker | Clear site data or run DevTools → Application → Clear storage. |
| App shows GENIE.AI blue even though you configured a different color | `theme.brandColor` is missing or null in the JSON | Check `docker exec <frontend> cat /usr/share/nginx/html/config/genie-ai-config.json | grep brandColor`. |
| Navbar text invisible after color change | `navbar.text` not auto-contrasting with `navbar.background` | Either provide an explicit `navbar.text` in the config, or pick a `navbar.background` with enough lightness for the default `--navbar-fg` derivation to stay readable. |
| Status colors (success/warning/danger) don't match your brand | `colors.*` overrides not applied | Confirm the JSON keys are exactly `success`, `warning`, `danger`, `info` (lowercase). |
| Custom font not loading | `typography.fontFamily` quoted wrong in JSON | Use the same quoting style as the example (single-quote the family name; escape with `\"` if embedded in a JSON string). |
| Dark mode looks broken | `data-theme="dark"` not being set | Check `Settings → Theme` is set to `Dark` or `System`. `System` requires the OS preference to be dark. |

### Available variants

Each variant is a full config file with the same schema. Override `bg`, `fg`, `navbar`, `colors`, `typography` independently.

| File | Brand color | Description |
|------|-------------|-------------|
| `genie-ai-config.json` | `#4071cb` | Default GENIE.AI. |
| `genie-ai-config-original.json` | `#4682B4` | Steel-blue original. |
| `genie-ai-config-huduma.json` | `#4E97D1` | Kenya Huduma deployment. |
| `genie-ai-config-huduma-magenta.json` | `#7A2A6A` | Huduma variant — magenta. |
| `genie-ai-config-huduma-red.json` | `#8B2A2A` | Huduma variant — red. |
| `genie-ai-config-huduma-dark-blue.json` | `#255C92` | Huduma variant — dark blue. |
| `genie-ai-config-naat.json` | `#7FBA59` | NAAT (green) deployment. |

To deploy a variant: copy it over `genie-ai-config.json` (or wire `GENIE_AI_CONFIG_FILE` to your build arg), rebuild, restart.

## Token reference

### Accent tokens (derived from `--brand`)

| Token | Light mode | Dark mode |
|-------|-----------|-----------|
| `--accent` | Brand | Lightened brand (`l + 0.2`, chroma × 0.85) |
| `--accent-hover` | Slightly darker (`l - 0.04`) | Slightly less lightened (`l + 0.14`) |
| `--accent-muted` | Brand at 12 % opacity | Brand at 15 % opacity |
| `--accent-fg` | High-contrast on brand (`l + 0.56`, chroma × 0.1) | Dark on lightened brand (`l - 0.32`) |
| `--accent-secondary` | Darker brand (`l - 0.07`) | Slightly lightened brand (`l + 0.1`) |

### Core palette

| Token | Light mode | Dark mode |
|-------|-----------|-----------|
| `--bg` | Config `bg` or near-white (`oklch(98% 0.005 250)`) | Brand-tinted dark (`l 0.14`, chroma × 0.25) |
| `--surface` | White | Brand-tinted (`l 0.22`, chroma × 0.18) |
| `--fg` | Config `fg` or dark blue (`oklch(22% 0.02 240)`) | Near-white (`oklch(95% 0.005 250)`) |
| `--muted` | Medium gray (`oklch(50% 0.018 240)`) | Brand-tinted (`l 0.58`, chroma × 0.15) |
| `--border` | Light gray (`oklch(82% 0.012 240)`) | Brand-tinted (`l 0.30`, chroma × 0.20) |
| `--bg-sidebar` | Light gray-blue (`oklch(93% 0.008 250)`) | Brand-tinted (`l 0.16`, chroma × 0.22) |

### Typography

`--font-scale` multiplier is applied to every `--text-*` token:

```css
--text-xs:  calc(0.7rem  * var(--font-scale));
--text-sm:  calc(0.75rem * var(--font-scale));
--text-base: calc(0.875rem * var(--font-scale));
--text-md:  calc(1rem     * var(--font-scale));
--text-lg:  calc(1.25rem  * var(--font-scale));
--text-xl:  calc(1.5rem   * var(--font-scale));
--text-2xl: calc(2rem     * var(--font-scale));
--text-3xl: calc(2.5rem   * var(--font-scale));
```

## Dark mode

The theme is controlled by the `data-theme` attribute **on `<div id="app">` in `src/App.vue` line 3** (`<div id="app" :data-theme="theme">`), not on `<html>`. The CSS selectors `html[data-theme='dark']`, `body[data-theme='dark']`, and `[data-theme='dark']` cover all three cases (the generic attribute selector matches the `data-theme` value wherever it appears in the tree).

Three values are valid:

| Value | Behaviour |
|-------|-----------|
| `dark` | Always dark. |
| `light` | Always light. |
| `system` | Follow OS preference. The app registers a `matchMedia('(prefers-color-scheme: dark)')` change listener at `App.vue:201`; when the user flips their OS theme, `ThemeManager` re-resolves the value. |

The default at first load is whatever `localStorage.theme` contains, falling back to `matchMedia('(prefers-color-scheme: dark)')` — so a user who never opened Settings starts in their OS theme. The user can lock to `Light` or `Dark` via Settings → Theme.

### What changes in dark mode

- `--bg` and `--surface` get brand-tinted and dark (`l 0.14` and `l 0.22`).
- `--fg` becomes near-white.
- The accent (`--accent`) is **lightened** to maintain contrast against the dark surface.
- Shadows get heavier (`rgba(0,0,0,0.1)` → `rgba(0,0,0,0.3)`).
- Overlay gets darker (`rgba(0,0,0,0.5)` → `rgba(0,0,0,0.7)`).
- The tooltip palette flips (`--tooltip-bg` becomes near-white, `--tooltip-fg` becomes dark).

## Mobile (Flutter) — pointer

The mobile app (`mobile/genie_ai_mobile/`) follows the same JSON schema and the same "single brand color drives everything" philosophy. It parses the same config and derives a parallel Dart token set via `AppTokens.fromConfig` (HSLColor-based, the Dart analogue of OKLch relative syntax).

For the Flutter side — DS components, spacing/radii tokens, theme wiring — see [/docs/mobile/mobile-architecture/](/docs/mobile/mobile-architecture/). This page intentionally focuses on the web frontend.

## Related

- [Configuration](/docs/configure/) — runtime config injection, env-var overrides.
- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — DS primitives that consume these tokens.
- [Auth Flow](/docs/frontend/auth-flow/) — no theme dependency.
- `components/gov-chat-frontend/CLAUDE.md` — DS rules, per-component variants, the full token table.
