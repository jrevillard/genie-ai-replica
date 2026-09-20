---
title: Settings Page
description: The Settings page — display preferences (language, theme, font size), notification toggles, account management links, and the GDPR reset/delete flows.
weight: 10
mode: reference
audience: developer, user
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For frontend developers extending the Settings page, and for
> deployers shipping the GDPR delete/reset flows.** The Settings page
> is a single-column, three-section form: a **Display** box (language,
> theme, font size), a **Notifications** box (email + sound toggles),
> and an **Account Management** section (Keycloak console, reset data,
> delete account). All toggles persist to `localStorage` and Vuex; the
> destructive flows hit the backend `/api/me/*` endpoints.

This page documents the layout, the persistence model, and the wire
endpoints for each action.

## Prerequisites

- A Keycloak access token (`currentUser` populated in Vuex).
- The `themeManager` utility loaded by `App.vue` (it owns the
  `data-theme` attribute on `<div id="app">`).
- The `vue-i18n` instance with `currentLocale` set (drives the
  `<LanguageSelector>`).
- A user with `profileIcon` set (the placeholder avatar is computed
  from the initials of `userData.name`).

## Page anatomy

`src/components/SettingsComponent.vue` is the only file. Top to bottom:

| Region | Source location | Notes |
|--------|-----------------|-------|
| Header | `template` lines 5–14 | Title (`settings.title`) + **Save Settings** primary button. Save is a no-op — preferences are already live-applied. |
| Profile section | `template` lines 28–55 | Avatar (initials or stored URL), `name`, `email`, `accountType` from `userData`. |
| Display box | `template` lines 60–104 | Language, Theme, Font Size controls. |
| Notifications box | `template` lines 108–138 | Email Updates + Sound Notifications toggles. |
| Account Management section | `template` lines 142–end | Keycloak console link, Reset my data, Delete my account. |

Three DS primitives back the layout: `DsButton`, `DsSpinner`, and
`DsStateDisplay`. No `DsTabs` — the form is a flat scroll.

## Display preferences

### Language

```html
<language-selector v-model="settings.language" />
```

`<LanguageSelector>` (in `src/components/LanguageSelector.vue`) lists the
locales declared in `VUE_APP_AVAILABLE_LOCALES` (env var; see [Restrict active locales](/docs/configure/locale-whitelist/)). Changing it
fires the `vue-i18n` `localeChanged` event, which propagates to every
`translate()` call.

### Theme

```html
<DsButton variant="secondary" :class="{ active: settings.theme === 'light' }"
          @click="applyTheme('light')">Light</DsButton>
<DsButton variant="secondary" :class="{ active: settings.theme === 'dark' }"
          @click="applyTheme('dark')">Dark</DsButton>
```

`applyTheme(theme)` writes `settings.theme` and forwards to
`themeManager.setTheme(theme)` (see
[`src/utils/ThemeManager.js`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/utils/ThemeManager.js)).
The theme is reflected as `data-theme="light|dark"` on `<div id="app">`
in `App.vue:3`, which cascades to every CSS variable under
`[data-theme="dark"]` selectors.

### Font size

```html
<input id="font-size-slider" v-model.number="settings.fontSize"
       type="range" min="30" max="100" class="slider" />
```

The slider stores a percentage (30–100). On change it sets
`document.documentElement.style.fontSize = ${settings.fontSize / 50}rem`
(`SettingsComponent.vue:487` converts the percentage slider value to a rem
value by dividing by 50). The full app's typography scales by rem, so the
change cascades to every component without a re-render.

> **Accessibility note:** the slider has `aria-label="Font Size"`
> derived from the same translation key as the visible label. The `<span>`
> next to it (`{{ settings.fontSize }}%`) is read by screen readers as a
> live region.

## Notification preferences

Two toggle rows in the Notifications box:

| Toggle | Backing field | Effect |
|--------|---------------|--------|
| Email Updates | `settings.emailUpdates` | Persisted in `localStorage`. Wired to the backend email preferences endpoint **only when** the deployment has the email service enabled (`EMAIL_*` env vars set). When email is unconfigured, the toggle persists locally but does nothing on the wire. |
| Sound Notifications | `settings.soundNotifications` | Pure client-side — persisted in `localStorage['soundNotifications']` but currently **no audio playback logic exists** in `ChatBotComponent.vue` (no `playChime`, no `new Audio`, no `soundNotifications` reference). The toggle persists the user's intent, but no sound is played on bot replies. |

The toggle is a custom switch component (CSS-only — track + thumb with
`active` class). It is keyboard-operable (Space/Enter toggles) and has
`role="switch"` + `aria-checked`.

## Account Management

Three actions, all rendered with `DsButton variant="secondary"`:

| Action | Endpoint | Confirmation |
|--------|----------|--------------|
| **Manage my account** | Opens `<KEYCLOAK_URL>/realms/<REALM>/account` in a new tab | None |
| **Reset my data** | `POST /api/me/reset-data` | `ConfirmDialog` with simple "Reset" confirmation (no typed-confirmation pattern). |
| **Delete my account** | `POST /api/me/delete` | `ConfirmDialog` with simple "Delete" confirmation (no typed-confirmation, no follow-up modal). |

The Keycloak console link is generated from `this.$config.keycloakUrl`
(injected via `window.APP_CONFIG`) — see
[Configure &rarr; Keycloak admin guide](/docs/configure/keycloak-admin-guide/)
for the realm/client configuration.

## State management

The component keeps a local `settings` object:

```javascript
settings: {
  language: 'en',          // mirrored from Vuex currentLocale
  theme: 'light',          // mirrored from themeManager.getTheme()
  fontSize: 100,           // percent
  emailUpdates: true,      // localStorage 'emailUpdates'
  soundNotifications: false // localStorage 'soundNotifications'
}
```

Persistence rules:

- **language** — written to `vue-i18n` immediately; mirrored in
  `localStorage['userLocale']`.
- **theme** — written to `themeManager` immediately; persisted in
  `localStorage['theme']`.
- **fontSize** — written to `document.documentElement.style.fontSize`
  immediately; persisted in `localStorage['fontSize']`.
- **emailUpdates** / **soundNotifications** — written to `localStorage['emailUpdates']` /
  `localStorage['soundNotifications']` immediately; no backend round-trip on save.

The "Save Settings" button at the top is **a UX placeholder** — the
underlying primitives all persist live. Pressing it does nothing except
close any pending dialog. The intent is to make the destructive
Account Management flows feel distinct from the always-live Display and
Notifications settings.

## Loading and error states

Same DS primitives as [User Profile](/docs/frontend/user-profile/):

| State | Primitive | When |
|-------|-----------|------|
| Loading | `DsSpinner overlay` | Initial `fetchUserData` call. |
| Error | `DsStateDisplay type="error"` | The fetch failed. The Retry button calls `fetchUserData` again. |
| Loaded | Three-box layout | Default state. |

## Verifying it works

### 1. Theme switch

Open the page, click **Dark**, then reload the browser. The page should
still be in dark mode (persisted in `localStorage`).

```javascript
// In the browser console:
localStorage.getItem('theme')   // "dark" or "light"
document.documentElement.querySelector('#app').dataset.theme  // matches
```

### 2. Font size

Set the slider to 50%, then inspect any text element:

```javascript
getComputedStyle(document.body).fontSize   // half of the default
```

### 3. GDPR delete

The destructive flows require a real Keycloak session. Use a test user
(scratch account, not `genie-admin`):

```bash
ADMIN_TOKEN=...   # test user JWT

# Trigger reset (wipes profile data, keeps account)
curl -sk -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<NGINX_PUBLIC_DOMAIN>/api/me/reset-data

# Confirm profile is wiped
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<NGINX_PUBLIC_DOMAIN>/api/me | jq .
# Expect: most fields empty / null
```

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Theme switch does not change the page | `themeManager.setTheme` was not called, or the `data-theme` attribute is on `<html>` instead of `<div id="app">` | Check `App.vue:3` — `data-theme` must be on the inner div. See [Theme System](/docs/frontend/theme-system/) for the binding chain. |
| Font size slider is stuck at 100% | `v-model.number` is missing the `.number` modifier and the input stays as a string | Inspect the input: `type=range` with `:value` instead of `v-model.number` is a known regression. Fix in `SettingsComponent.vue:93`. |
| "Manage my account" link opens to a 404 | `this.$config.keycloakUrl` is empty | Inject via `window.APP_CONFIG.keycloakUrl` (see [Auth Flow](/docs/frontend/auth-flow/)) or fall back to `VUE_APP_KEYCLOAK_URL`. |
| Reset / delete button stays disabled even after the user clicks it | n/a — `ConfirmDialog` has no typed-confirmation requirement; the button is enabled as soon as the dialog opens. | If the destructive action does not fire, check the parent handler (`handleResetDataConfirm` / `handleDeleteAccountConfirm` in `SettingsComponent.vue`). |
| After delete, the user stays logged in | The backend should also clear the Keycloak session | The `POST /api/me/delete` route ends with a server-side logout; the frontend should redirect to `/auth/logout`. See [Auth Flow → Logout](/docs/frontend/auth-flow/#logout). |

## Related

- [Auth Flow](/docs/frontend/auth-flow/) — the Keycloak session and
  logout flow.
- [Theme System](/docs/frontend/theme-system/) — what the theme toggle
  actually changes (CSS variable cascade).
- [State Management](/docs/frontend/state-management-frontend/) —
  `currentUser`, `currentLocale`, and the namespacing rules.
- [User Profile](/docs/frontend/user-profile/) — the per-tab profile
  form; this page is the **preferences** sibling.