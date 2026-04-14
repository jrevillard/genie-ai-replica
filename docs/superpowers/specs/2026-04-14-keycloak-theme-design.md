# Keycloak Theme — GENIE.AI

## Overview

Create a custom Keycloak theme for GENIE.AI that provides full visual continuity between the Keycloak authentication pages and the main application. The theme covers all login-type pages, the account console, and email templates.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Split panel (brand left + form right) | Professional SaaS look, reinforces visual identity |
| Brand panel content | Minimal (logo + name + tagline) | Clean, institutional, no distraction from the form |
| Form style | Flat (direct on background, no card) | Modern, more space, lighter feel |
| Dark mode | Light + Dark auto via `prefers-color-scheme` | Matches frontend behavior |
| Scope | Login pages + Account console + Email templates | Full coverage, no visual disconnect |
| Logo | Existing GENIE.AI logo | Consistency, no extra design work |

## File Structure

```
configs/keycloak/themes/genie/
├── login/
│   ├── theme.properties          # parent=keycloak, styles, imports
│   ├── resources/
│   │   ├── css/
│   │   │   ├── genie.css         # Main styles (layout, components)
│   │   │   └── dark.css          # @media (prefers-color-scheme: dark)
│   │   ├── img/
│   │   │   ├── logo.png          # GENIE.AI logo
│   │   │   └── favicon.ico       # GENIE.AI favicon
│   │   └── js/
│   │       └── genie.js          # Manual dark mode toggle (cookie persistence)
│   └── messages/
│       ├── messages_en.properties
│       └── messages_fr.properties
├── account/
│   ├── theme.properties          # parent=keycloak
│   ├── resources/
│   │   └── css/
│   │       ├── genie.css         # Color palette, typography for account console
│   │       └── dark.css
│   └── messages/
│       ├── messages_en.properties
│       └── messages_fr.properties
└── email/
    ├── theme.properties          # parent=keycloak
    ├── resources/
    │   └── img/
    │       └── logo.png
    └── messages/
        ├── messages_en.properties
        └── messages_fr.properties
```

## Theme Types

### Login Theme

**Layout approach:** Extend the `keycloak` base theme. Override `template.ftl` to replace the default single-column layout with a split panel structure. Individual page templates (`login.ftl`, `register.ftl`, etc.) inherit this layout automatically.

**Templates to override:**

| Template | Page |
|----------|------|
| `template.ftl` | Base layout — split panel wrapper |
| `login.ftl` | Login page |
| `register.ftl` | User registration |
| `login-config-totp.ftl` | 2FA setup |
| `login-idp-link-confirm.ftl` | External IdP linking confirmation |
| `login-oauth-grant.ftl` | OAuth consent screen |
| `login-reset-password.ftl` | Password reset request |
| `login-update-password.ftl` | Password change |
| `login-verify-email.ftl` | Email verification |
| `login-terms.ftl` | Terms and conditions acceptance |
| `code.ftl` | OTP code entry |
| `error.ftl` | Error page |
| `info.ftl` | Information page |
| `select-authenticator.ftl` | Authenticator selection |

**Responsive behavior:**
- Desktop: Split panel ~45/55 (brand left, form right)
- Tablet (<1024px): Brand panel reduced to ~35%
- Mobile (<768px): Brand collapses to compact header (logo + tagline), form takes full width

**Colors (CSS custom properties):**
- Primary: `#4E97D1` (GENIE.AI blue)
- Primary hover: `#3a7da0`
- Background: `#f5f7fa` (light), `#1e1e1e` (dark)
- Surface: `#ffffff` (light), `#252525` (dark)
- Text primary: `#333333` (light), `#e0e0e0` (dark)
- Text secondary: `#888888` (light), `#999999` (dark)

### Account Console Theme

Same color palette and typography. Override CSS only (the account console is a React SPA — FreeMarker templates cannot be used). Target the existing Keycloak account console CSS classes to apply GENIE.AI styling.

### Email Theme

HTML email templates with:
- Logo in header
- GENIE.AI color scheme
- Responsive table-based layout (email client compatibility)
- Institutional footer with ITU branding
- Override `text/` templates for welcome, password reset, verification, etc.

## Docker Integration

- Theme files live in `configs/keycloak/themes/genie/`
- The existing `configs/keycloak/Dockerfile` copies `themes/` into the Keycloak container
- `KEYCLOAK_LOGIN_THEME=genie` in the realm YAML activates the theme
- Account and email themes are activated via `accountTheme` and `emailTheme` realm properties (to be added to `genie-realm.yaml`)

## i18n

Keycloak's default message bundles provide translations for all supported locales. The theme adds custom `messages_en.properties` and `messages_fr.properties` to override specific labels if needed (e.g., customizing the login heading, tagline text). Other locales fall back to Keycloak's built-in translations.

## Dark Mode

- CSS `@media (prefers-color-scheme: dark)` in `dark.css` overrides all color custom properties
- Optional JS (`genie.js`) provides a manual toggle that sets a `theme` cookie, with CSS reading `:root[data-theme="dark"]` as a fallback when `prefers-color-scheme` is not available
- Both mechanisms coexist: system preference by default, manual override via cookie
