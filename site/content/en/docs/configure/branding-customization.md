---
title: "Branding Customization"
description: "Replace the GENIE.AI logo, app name, favicon, brand color, and Keycloak login screen with your institution's identity."
weight: 4
section: "configure"
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-20
---

This guide explains how to rebrand a GENIE.AI deployment for a partner institution: swap the logo, favicon, application title, and brand color in the web UI; replace the logo on the Keycloak login, account, admin, and email templates; and verify that everything renders correctly after a redeploy.

The brand surface is small (one JSON config, four logo files, two CSS files) and every file is committed to the repository, so rebranding is a normal code change — open one MR, get one review, no runtime overlay to maintain.

## Overview

GENIE.AI exposes two brand surfaces:

1. **The web app** (`components/gov-chat-frontend/`) — driven by `public/config/genie-ai-config.json` and `src/main.js`. Logo, app title, favicon, and brand color live here. The brand color flows through the entire UI via the Design System `--brand` CSS variable.
2. **The Keycloak login + account + admin + email templates** (`configs/keycloak/themes/genie/`) — driven by theme properties files and FreeMarker templates. Logo, favicon, and theme colors live here.

The two surfaces are independent: changing the web app's logo does not change the Keycloak login screen, and vice versa. Plan to update both for a full rebrand.

> **Architecture overview.** This doc is the deployer-facing "how do I do it" companion. For the deep "why one brand color drives the entire palette via OKLch" explanation, see [Theme System](/docs/frontend/theme-system/).

## Frontend brand (logo, favicon, app name, brand color)

The frontend reads its branding from a single JSON file shipped with the build:

- `components/gov-chat-frontend/public/config/genie-ai-config.json`

The runtime fetch happens in `components/gov-chat-frontend/src/main.js` (`loadConfig()`). The defaults baked into `main.js` are:

| Field | Default | Used by |
|---|---|---|
| `app.title` | `GENIE.AI` | `<title>`, navbar brand text, i18n fallback |
| `app.icon.value` | `/config/logo-genie-ai.jpeg` | Navbar logo + browser favicon (32×32, 16×16, apple-touch) |
| `theme.brandColor` | `#4071cb` | Sets `--brand` CSS variable on `<html>` |
| `features.chat.welcomeMessage` | `Welcome to GENIE.AI` | Empty-chat greeting |
| `features.chat.botName` | `GENIE.AI` | Chat subtitle |

### File locations (frontend)

| Asset | Path |
|---|---|
| Runtime JSON config | `components/gov-chat-frontend/public/config/genie-ai-config.json` |
| Default logo (used if config absent) | `components/gov-chat-frontend/public/config/logo-genie-ai.jpeg` |
| Brand color → CSS var wiring | `components/gov-chat-frontend/src/main.js` (`loadConfig`, sets `--brand`) |
| Favicon `<link>` tags | `components/gov-chat-frontend/public/index.html` |
| Theme tokens consuming `--brand` | `components/gov-chat-frontend/src/theme-variables.css` |

### How to change the frontend brand

Edit `components/gov-chat-frontend/public/config/genie-ai-config.json`. The file is shipped as a runtime fetch (`/config/genie-ai-config.json`), so no rebuild of the frontend image is required to change a value — but the `public/` directory is **baked into the Docker image at build time**, so a redeploy is required.

Example: replace the GENIE.AI brand with a partner institution's brand:

```json
{
  "app": {
    "title": "MyGov Assistant",
    "icon": {
      "type": "file",
      "value": "/config/logo-mygov.jpeg"
    }
  },
  "theme": {
    "brandColor": "#0a7d52"
  },
  "features": {
    "chat": {
      "welcomeMessage": "Welcome to MyGov Assistant",
      "botName": "MyGov Assistant"
    }
  }
}
```

Then drop your logo at `components/gov-chat-frontend/public/config/logo-mygov.jpeg` (same filename as the `app.icon.value` path, under the `public/config/` directory). Rebuild the frontend image and redeploy.

The same file also accepts `theme.bg`, `theme.fg`, `theme.navbar.background`, `theme.navbar.text`, `theme.colors.{success,warning,danger,info}`, `theme.typography.fontFamily`, and `theme.typography.fontScale`. See [Theme System → Config variants](/docs/frontend/theme-system/#config-variants) for the full schema.

## How the CSS variable system works

GENIE.AI's frontend uses a **single brand color** that drives the entire palette. The flow is:

1. `main.js` reads `theme.brandColor` from the JSON config and writes it to the `<html>` element as the CSS custom property `--brand` (`document.documentElement.style.setProperty('--brand', ...)`).
2. `theme-variables.css` defines `--accent`, `--accent-hover`, `--accent-muted`, `--accent-fg`, `--accent-secondary`, `--navbar-bg`, `--navbar-fg` — every one derived from `--brand` using OKLch relative color syntax. The `--brand` token itself defaults to `oklch(47% 0.14 265)` (the same hue family as `#4071cb`) when no config is loaded.
3. `theme-components.css` and every DS component reference these tokens via `var(--accent)`, `var(--accent-fg)`, etc. — never hardcoded values.
4. **Dark mode** is a separate selector (`[data-theme='dark']`) in the same files. The same `--brand` flows through both; only the surface/border/fg tokens flip.

What this means in practice: **you only set one color, and the entire UI follows.** Hover, pressed, focus, navbar, buttons, links, charts all derive automatically. No JavaScript color math, no per-component configuration.

For the complete token reference (colors, spacing, typography, radii, shadows) and how to override tokens per-component without `!important`, see:

- [Theme System → DS Token Reference](/docs/frontend/theme-system/#ds-token-reference)
- [Theme System → Dark mode](/docs/frontend/theme-system/#dark-mode)
- [Theme System → Extension points](/docs/frontend/theme-system/#extension-points)

## Per-institution logo

The default logo path is `/config/logo-genie-ai.jpeg` (referenced in `main.js` as a fallback if `genie-ai-config.json` cannot be fetched). To use your own logo:

1. **Drop the file** into `components/gov-chat-frontend/public/config/` using a descriptive filename:
   - `components/gov-chat-frontend/public/config/logo-<your-org>.jpeg` (or `.png`/`.svg`)
2. **Update `genie-ai-config.json`** to point `app.icon.value` at the new path:
   ```json
   "icon": {
     "type": "file",
     "value": "/config/logo-<your-org>.jpeg"
   }
   ```
3. **Rebuild** the frontend image — the `public/` directory is baked into the image at build time, not loaded from a volume.

Recommended image specs:

- **Format**: `.png` or `.svg` for crispness on retina displays; `.jpeg` is acceptable for photographic logos.
- **Dimensions**: at least 256×256 px so the navbar version (downscaled to ~32 px tall) and the favicon (32×32 and 16×16) both render cleanly.
- **Background**: prefer a transparent background (`.png`/`.svg`) so the logo sits cleanly on both light and dark navbar variants.

The same `app.icon.value` path is used for three `<link rel="icon">` tags (32×32, 16×16, apple-touch 180×180), so a single square logo covers all three sizes. The browser downsamples; no per-size asset is required.

## Keycloak login screen branding

The Keycloak login, account, admin, and email screens are themed by the `genie` theme under `configs/keycloak/themes/genie/`. Each surface has its own `theme.properties` and its own `resources/` directory:

| Surface | `theme.properties` | Logo location | Favicon | Stylesheet |
|---|---|---|---|---|
| Login | `configs/keycloak/themes/genie/login/theme.properties` | `resources/img/logo.png` | `resources/img/favicon.ico` | `resources/css/genie.css`, `resources/css/dark.css` |
| Account | `configs/keycloak/themes/genie/account/theme.properties` | `resources/img/logo.png` | (default favicon) | `resources/css/genie.css`, `resources/css/dark.css` |
| Admin | `configs/keycloak/themes/genie/admin/theme.properties` | `resources/img/logo.png` | `resources/img/favicon.ico` | `resources/css/genie.css`, `resources/css/dark.css` |
| Email | `configs/keycloak/themes/genie/email/theme.properties` | `resources/img/logo.png` | n/a | n/a |

The `genie` theme is a child of the Keycloak `keycloak.v2` (login/admin) / `keycloak.v3` (account) / `keycloak` (email) base themes — defined by the `parent=` line in each `theme.properties`.

### How to change the Keycloak login logo

Replace four PNG files (one per surface) and (optionally) tweak the CSS:

1. Drop your logo at the same path in each of the four surfaces:
   - `configs/keycloak/themes/genie/login/resources/img/logo.png`
   - `configs/keycloak/themes/genie/account/resources/img/logo.png`
   - `configs/keycloak/themes/genie/admin/resources/img/logo.png`
   - `configs/keycloak/themes/genie/email/resources/img/logo.png`
2. Keep the filename `logo.png` — every template references it directly:
   - `configs/keycloak/themes/genie/login/template.ftl`: `<img src="${url.resourcesPath}/img/logo.png" alt="GENIE.AI" ...>`
3. Replace the `alt` text in each template.ftl if your brand name changed (search for `alt="GENIE.AI"`).
4. (Optional) Tweak the brand color in `configs/keycloak/themes/genie/{login,account,admin}/resources/css/genie.css` — the admin theme especially uses several brand-tinted backgrounds.
5. Redeploy Keycloak (`docker service scale` or Ansible re-run). Keycloak caches themes in memory; **always restart** the Keycloak container after a theme file change — see [Troubleshooting](#troubleshooting).

> **Logo image specs:** Keycloak renders the login logo at `width: 120px` (height auto, scales with aspect ratio) per `configs/keycloak/themes/genie/login/resources/css/genie.css`. Use a transparent PNG at least 240px wide (2× for retina) so it stays sharp on high-DPI screens. The admin logo is constrained to `height: 32px` in `configs/keycloak/themes/genie/admin/resources/css/genie.css`. For the email surface, the logo is embedded as a CID attachment and capped at `max-width:120px; max-height:40px` in `template.ftl` — keep the file's natural dimensions in that range to avoid downscaling artifacts.

## Keycloak email branding

GENIE.AI-themed Keycloak emails (verification, password reset, etc.) use a single shared FreeMarker layout:

- `configs/keycloak/themes/genie/email/html/template.ftl`

The logo is embedded via a CID attachment (`<img src="cid:logo.png" alt="GENIE.AI">` on line 17), with the image file at `configs/keycloak/themes/genie/email/resources/img/logo.png`. Keycloak auto-attaches any file under `resources/img/` as a CID; do not change the `src="cid:logo.png"` reference unless you also rename the file.

To rebrand the emails:

1. Replace `configs/keycloak/themes/genie/email/resources/img/logo.png` with your logo (keep the filename).
2. Edit the two visible strings in `template.ftl`:
   - Line 8: `<title>${subject!"GENIE.AI"}</title>` — the email's `<title>` fallback (used by the subject only when no subject is set; most clients show the actual subject).
   - Line 18: `<div ...>GENIE.AI</div>` — the visible brand text rendered next to the logo.
3. The footer at lines 27–30 hardcodes "International Telecommunication Union (ITU)" and the Geneva address. Replace with your institution's footer text if rebranding.
4. The header gradient (line 16) uses a hardcoded ITU-blue: `background:linear-gradient(135deg,#2b4acb 0%,#1e3a8a 100%);`. Replace with your brand colors.

Restart Keycloak after the change (see [Troubleshooting](#troubleshooting)).

## Favicon

The Keycloak login and admin surfaces each ship their own favicon file:

- `configs/keycloak/themes/genie/login/resources/img/favicon.ico`
- `configs/keycloak/themes/genie/admin/resources/img/favicon.ico`

Replace each `.ico` with your institution's favicon. Use the same file in both locations — they are served independently by Keycloak per theme. For the account surface, no explicit favicon is configured; Keycloak falls back to the realm default.

The web app's favicon is controlled separately (see [Per-institution logo](#per-institution-logo)) via the `<link rel="icon">` tags in `components/gov-chat-frontend/public/index.html`, which are re-pointed at runtime by `main.js` from `app.icon.value`.

## Verify it worked

After a redeploy, verify each surface end-to-end before announcing the rebrand:

### Frontend brand

1. Open the deployed web app in a browser (hard-refresh: Ctrl+Shift+R / Cmd+Shift+R to bypass cache).
2. **Brand color**: open DevTools → Elements → click the `<html>` element → look at the Computed pane for `--brand`. The value should match your `theme.brandColor`.
   ```js
   // In the browser console:
   getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
   // → "#0a7d52"
   ```
3. **Logo**: open DevTools → Network tab → filter by `logo` → reload the page → verify your logo URL (e.g. `/config/logo-mygov.jpeg`) returns `200 OK` and your image is loaded. The navbar should display it.
4. **Favicon**: DevTools → Network tab → filter by `favicon` → the three `link[rel=icon]` requests should return your logo URL.
5. **App title**: hover the browser tab — the `<title>` should match `app.title`. Also check the navbar brand text.
6. **Dark mode**: toggle dark mode in the UI → verify the navbar background, accent buttons, and links all derive from your brand color. The `--brand` value does not change between modes; the surrounding tokens do.

### Keycloak login

1. Sign out (or open an incognito window) and navigate to the login page.
2. **Logo**: confirm your logo renders in the header.
3. **Favicon**: confirm your favicon appears in the browser tab.
4. **Theme colors**: confirm the brand-tinted accents (button background, focus rings) reflect your CSS changes — assuming you edited the CSS.
5. **Email**: trigger a verification or password-reset email → confirm the embedded logo and footer text render correctly. (Most clients cache email images; test from a fresh email address.)

### Common verification gotchas

- **Stale browser cache**: hard-refresh after every deploy. The HTML is small and unlikely to be cached, but the JSON config and logo file may be — set `Cache-Control: no-cache` on `/config/` if your reverse proxy supports it, or accept that the first hit may be stale.
- **Keycloak theme cache**: Keycloak caches themes in its infinispan layer at startup. **A theme file change requires a Keycloak restart**, not just a deploy. A redeploy that does not restart Keycloak will keep the old theme in memory.
- **Two favicon files**: the web app's favicon and the Keycloak login's favicon are served from different origins and cached independently. Test each one separately.

## Troubleshooting

### Logo doesn't show on the web app

- **Wrong path.** `app.icon.value` must point at a file under `public/config/` (served at `/config/`). The leading slash matters. If you forget it, the request becomes relative to the current page and 404s on most routes.
- **Wrong filename.** The path in the JSON must match the actual filename on disk, including the extension. The frontend does no extension rewriting.
- **Not rebuilt.** `public/` is baked into the Docker image at build time. Editing `public/config/logo-mygov.jpeg` without rebuilding the image leaves the old logo in the running container. Rebuild and redeploy.
- **Cached file.** Hard-refresh. If the problem persists, check `docker exec <frontend-container> ls /usr/share/nginx/html/config/` — your new file should be there.

### Theme overrides ignored after Keycloak restart

- **Wrong `parent=` line.** The `parent=` in each `theme.properties` must match a theme Keycloak ships — `keycloak.v2` (login/admin), `keycloak.v3` (account), `keycloak` (email). A typo silently fails to inherit the parent styles, leaving the theme unstyled.
- **Theme not registered.** Keycloak must be told the theme exists. In GENIE.AI deployments this is handled by the realm-import JSON under `configs/keycloak/`; verify the theme is listed. See [Keycloak Admin Guide → Theming](/docs/configure/keycloak-admin-guide/) for the registration flow.
- **CSS specificity.** Keycloak's base `keycloak.v2` styles are aggressive. Use higher-specificity selectors or `!important` (Keycloak-acceptable in theme CSS, unlike the web app where `!important` is forbidden).
- **Stale infinispan cache.** After a theme file change, restart Keycloak twice if the first restart still shows old styles — infinispan can survive a single restart in some versions.

### CSS not applying (frontend)

- **`!important` rules in your code.** The Design System forbids `!important` in component styles. If you find yourself reaching for it, you're probably overriding the wrong token. See [Theme System → Extension points](/docs/frontend/theme-system/#extension-points) for the CSS-variable-based override pattern.
- **Token name typo.** `var(--accent)` works; `var(--acccent)` silently fails and the property becomes its inherited value (or `unset`). DevTools → Computed shows the resolved value; check the source line if it's not what you expect.
- **Config not loading.** Open DevTools → Network → look for a request to `/config/genie-ai-config.json`. A `404` or `500` means the file is missing or malformed; the app falls back to the defaults baked into `main.js`.
- **Hardcoded hex in a component.** New components must reference DS tokens (`var(--accent)`, `var(--fg)`, etc.). Hardcoded values bypass the theme entirely. Use `Grep CSS` to audit: `grep -rn '#[0-9a-fA-F]\{3,8\}' components/gov-chat-frontend/src/components/` — anything that is not a comment or a test fixture is a violation.

### Dark mode tokens don't change with the brand color

This is **expected**: `--brand` is the same in light and dark mode; only the surrounding tokens (`--bg`, `--surface`, `--fg`, `--border`, `--muted`) flip. If your brand color looks wrong in dark mode, the issue is contrast — `--navbar-fg` and `--accent-fg` are derived from `--brand` using OKLch lightness shifts, so they should remain readable. If they don't, you've overridden one of the derived tokens with a hardcoded value.

## Related

- [Theme System](/docs/frontend/theme-system/) — deep dive on the CSS-native theming architecture, OKLch derivation, and dark mode.
- [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) — managing users, roles, and the realm; theme registration flow.
- [Install Guide](/docs/deploy/install-guide/) — Docker Compose and Ansible deployment steps; rebuilding images after a brand change.
- [Architecture Overview → Authentication](/docs/architecture/architecture/) — how the Keycloak-fronted web app fits together.