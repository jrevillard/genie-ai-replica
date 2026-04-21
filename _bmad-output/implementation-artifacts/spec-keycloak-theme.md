# Keycloak Theme — GENIE.AI

## Overview

Custom Keycloak theme for GENIE.AI providing visual continuity between authentication pages, account console, and email templates. CSS-only approach: override PatternFly v5 CSS custom properties — no custom templates for login (upstream keycloak.v2 used as-is with logo injection), no custom JS.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Upstream keycloak.v2 2-column grid | Avoids maintenance burden of custom templates |
| Account console | keycloak.v3 parent, comprehensive PF5 variable override | React SPA — CSS-only theming via `styles` property |
| Dark mode | Upstream `darkMode=true` (system preference via `prefers-color-scheme`) | Consistent with frontend behavior, no manual toggle needed |
| i18n | 9 locales matching frontend ∩ Keycloak built-in support | ar, de, en, es, fr, pt, ru, th, zh |
| Email | Custom HTML template with GENIE.AI branding + 9 locale message files | Professional look, ITU footer |
| Logo | splash-genie-ai.png (1024x1024) from frontend | Single logo across all theme types |

## File Structure

```
configs/keycloak/themes/genie/
├── login/
│   ├── theme.properties          # parent=keycloak.v2, styles=css/genie.css css/dark.css, darkMode=true
│   ├── resources/
│   │   ├── css/
│   │   │   ├── genie.css         # 14 PF5 global variable overrides + 3 selectors
│   │   │   └── dark.css          # @media (prefers-color-scheme: dark) overrides
│   │   └── img/
│   │       ├── logo.png          # splash-genie-ai.png (1024x1024)
│   │       └── favicon.ico
│   └── template.ftl              # Exact copy of upstream keycloak.v2 + <img> in header
├── account/
│   ├── theme.properties          # parent=keycloak.v3, styles=css/genie.css css/dark.css, darkMode=true, logo=img/logo.png
│   ├── resources/
│   │   ├── css/
│   │   │   ├── genie.css         # ~90 PF5 variable overrides (global + semantic + layout)
│   │   │   └── dark.css          # .pf-v5-theme-dark scoped overrides
│   │   └── img/
│   │       └── logo.png
│   └── messages/                 # (not needed — inherits from upstream keycloak.v3)
└── email/
    ├── theme.properties          # parent=keycloak
    ├── html/
    │   └── template.ftl          # HTML layout with GENIE.AI gradient header, button styles, ITU footer
    ├── resources/
    │   └── img/
    │       └── logo.png
    └── messages/
        ├── messages_en.properties
        ├── messages_fr.properties
        ├── messages_ar.properties
        ├── messages_de.properties
        ├── messages_es.properties
        ├── messages_pt.properties
        ├── messages_ru.properties
        ├── messages_th.properties
        └── messages_zh_Hans.properties
```

## Theme Types

### Login Theme

**Parent:** `keycloak.v2` (PatternFly v5, 2-column CSS grid layout)

**Template:** Exact copy of upstream `keycloak.v2/template.ftl` (Keycloak 26.5.6) with one modification — `<img>` tag added in `#kc-header-wrapper` for logo display.

**CSS approach:** Override PF5 global CSS custom properties only. Components (buttons, forms, links) inherit automatically from globals — no component-level overrides needed.

**Light mode variables (genie.css):**
- Primary: `--pf-v5-global--primary-color--100: #4E97D1`
- Background: `--pf-v5-global--BackgroundColor--100: #f5f7fa`
- Text: `--pf-v5-global--Color--100: #333333`
- Borders: `--pf-v5-global--BorderColor--100: #dcdfe4`
- Status: success `#10b981`, warning `#f59e0b`, danger `#ef4444`
- Header/footer brand color selectors

**Dark mode (dark.css):** `@media (prefers-color-scheme: dark)` — same variable names with dark values.

### Account Console Theme

**Parent:** `keycloak.v3` (React SPA, compiled PF5 bundle)

**Key difference from login:** The account console v3 uses semantic PF5 variables (`dark-100`, `light-100`, `light-300`) in addition to numeric ones. Components reference these semantic variants, so all must be overridden for full color coverage.

**CSS approach:** Comprehensive PF5 override covering:
- Global variables (`--100`, `--200`, `--300`, `--400`)
- Semantic variants (`dark-100`, `light-100`, `light-200`, `light-300`)
- Palette scale (`black-50` through `black-1000`)
- Icon colors (`icon--Color--dark`, `icon--Color--light`)
- Link colors (with `--dark--hover`, `--light--hover` variants)
- Status colors (success, warning, danger)
- Component-level layout (`page__header--BackgroundColor`, `page__sidebar--BackgroundColor`)
- Header: `#4E97D1` (blue, matches frontend navbar)
- Sidebar: `#ffffff` (light) / `#252525` (dark)

**Dark mode (dark.css):** Scoped to `.pf-v5-theme-dark` class (upstream adds this class to `<html>` based on system preference — NOT `@media`).

**Logo:** Set via `logo=img/logo.png` in `theme.properties`. The React SPA reads this property from the inline JSON config to display the logo.

### Email Theme

**Parent:** `keycloak` (HTML email templates)

**Template:** Custom `html/template.ftl` with:
- Gradient header: `linear-gradient(135deg, #4E97D1, #3a7da0)` with logo and "GENIE.AI" brand name
- Content area with styled buttons (`class="button"`)
- ITU footer: "International Telecommunication Union (ITU), Place des Nations, CH-1211 Geneva"

**Messages:** 9 locale files overriding email subjects (append "- GENIE.AI") and HTML bodies (use template CSS classes). Placeholders: `{0}` (link), `{2}` (realm name), `{3}` (expiry), `{4}` (expiry), `{5}` (link).

## Realm Configuration

All theme settings are managed via `genie-realm.yaml` and applied by `keycloak-config-cli`:

```yaml
loginTheme: genie
accountTheme: genie
emailTheme: genie
internationalizationEnabled: true
defaultLocale: en
supportedLocales: [ar, de, en, es, fr, pt, ru, th, zh]
```

## Docker Integration

- Theme files live in `configs/keycloak/themes/genie/`
- `configs/keycloak/Dockerfile` copies `themes/` into the Keycloak image (`COPY themes/ /opt/keycloak/themes/`)
- Theme is baked into the image — requires `docker compose build keycloak` after changes
- `configs/keycloak/Dockerfile.config-cli` copies `genie-realm.yaml` for config-cli
- Account/account-console clients configured with `webOrigins` via `$(env:NGINX_PUBLIC_DOMAIN)`

## i18n Coverage

| Code | Language | Keycloak built-in | Email messages |
|------|----------|-------------------|----------------|
| ar | Arabic | Yes | Yes |
| de | German | Yes | Yes |
| en | English | Yes | Yes |
| es | Spanish | Yes | Yes |
| fr | French | Yes | Yes |
| pt | Portuguese | Yes | Yes |
| ru | Russian | Yes | Yes |
| th | Thai | Yes | Yes |
| zh | Chinese (Simplified) | Yes (`zh_Hans`) | Yes (`messages_zh_Hans`) |

**Excluded frontend locales** (not in Keycloak): `bn` (Bengali), `id` (Indonesian), `man` (Mandingo), `st` (Sesotho), `sw` (Swahili).
