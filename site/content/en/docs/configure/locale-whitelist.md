---
title: "Restrict active locales on a deployment"
description: "Restrict which languages the GENIE.AI web UI, Keycloak login, and Flutter mobile app expose. Covers VUE_APP_AVAILABLE_LOCALES, KEYCLOAK_SUPPORTED_LOCALES, and KeycloakConfig.supportedLocaleCodes."
weight: 6
section: "configure"
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-19
---

GENIE.AI ships **locale files for every supported language** in the source
tree. A deployment chooses which subset to **expose** at runtime via three
configuration knobs — one per runtime surface:

| Surface | Knob | Where it is read | Default (unset) |
|---|---|---|---|
| **Web UI** (language selector, vue-i18n runtime) | `VUE_APP_AVAILABLE_LOCALES` | Frontend `.env` (build-time, then injected into `window.APP_CONFIG`) | All 14 locales |
| **Keycloak login pages** | `KEYCLOAK_SUPPORTED_LOCALES` | Keycloak realm config (JSON array, read at realm import / restart) | Curated default set |
| **Flutter mobile app** | `KeycloakConfig.supportedLocaleCodes` | Per-flavor Dart config (e.g. `lib/flavors/prod.dart`) | Curated default set |

These three knobs are **independent** — a deployment can restrict the web
UI to `en,fr` while keeping all login-page languages (e.g. for a
deployment that federates to several identity providers each serving a
different locale audience).

## What "active locale" means (and what it doesn't)

The whitelist controls **what the user sees in the language selector** —
it does not control **whether a translation exists** for a given key.

- Translation files for all locales live in the source tree
  (`components/gov-chat-frontend/src/i18n/locales/*.json`) and the
  build always includes them.
- A locale that is **not** in `VUE_APP_AVAILABLE_LOCALES` cannot be
  picked from the dropdown, but its translations are still shipped in the
  JS bundle.
- Adding a new language to the catalog means **adding translations** in
  the locale files (see [Contribute → i18n](/docs/contribute/i18n/) for
  the contributor key-parity rules). The whitelist does **not** change
  what translations exist.

## Web: `VUE_APP_AVAILABLE_LOCALES`

A comma-separated list of locale codes, e.g. `en,es,fr`. Read at
**build time** by the frontend's `vue-i18n` setup and exposed to the SPA
via `window.APP_CONFIG.availableLocales`.

```bash
# In .env
VUE_APP_AVAILABLE_LOCALES=en,fr
```

Effect after a frontend rebuild + service restart:

- The language selector in the web UI shows only `en` and `fr`.
- All other locale files are still bundled but unreachable from the UI.
- The runtime locale (set per-user from the selector) is constrained to
  this set — `vue-i18n` warns and falls back to the default locale
  (`en`) if the user's persisted locale is not in the whitelist.

## Keycloak: `KEYCLOAK_SUPPORTED_LOCALES`

A JSON array, e.g. `["en","es","fr"]`. Read by the Keycloak realm
configuration when the realm is bootstrapped (`keycloak-realm.json` /
realm import). Affects the locale selector rendered on **Keycloak's own
login, registration, and email-verification pages** — not the GENIE.AI
web UI.

```bash
# In .env
KEYCLOAK_SUPPORTED_LOCALES=["en","fr"]
```

The codes are Keycloak's internal locale codes (typically `en`, `es`,
`fr`, `de`, etc., and hyphenated variants like `zh-Hans`). They must
match the codes declared in the Keycloak theme.

> **Restore gotcha.** `KEYCLOAK_SUPPORTED_LOCALES` is captured in the
> Keycloak database at realm-import time. After a backup-and-restore
> cycle, if the env-var on the new host differs from what was active
> when the dump was taken, the restored realm shows the *old* set. Re-apply
> the env var to match. See
> [Backup & restore](/docs/operate/backup-restore/#restore-edge-cases).

## Flutter mobile: `KeycloakConfig.supportedLocaleCodes`

A `List<String>` set per flavor in the Flutter app
(`mobile/genie_ai_mobile/lib/flavors/<flavor>.dart`):

```dart
class KeycloakConfig {
  static const supportedLocaleCodes = ['en', 'fr'];
  // ...
}
```

Mobile and web whitelists are configured **separately** — the Flutter
build does not read `VUE_APP_AVAILABLE_LOCALES`. Keep them aligned if
your users are expected to use both surfaces.

## Example: restrict to English and French

A deployment serving only English and French on every surface:

```bash
# .env
VUE_APP_AVAILABLE_LOCALES=en,fr
KEYCLOAK_SUPPORTED_LOCALES=["en","fr"]
```

```dart
// mobile/genie_ai_mobile/lib/flavors/prod.dart
class KeycloakConfig {
  static const supportedLocaleCodes = ['en', 'fr'];
}
```

Rebuild and restart every service that reads these values (frontend,
Keycloak, mobile build pipeline). The change takes effect on the **next
session** for end users — already-loaded apps keep their persisted
locale until the user clears site data or reinstalls.

## Verification

After redeploy, confirm the whitelist is in effect:

- **Web**: open the language selector in the UI; only `en` and `fr`
  appear. Persist a different locale (e.g. `es`) and reload — the
  selector falls back to `en` (or whatever `VUE_APP_DEFAULT_LOCALE`
  is).
- **Keycloak**: visit the login page; the locale dropdown lists only
  `en` and `fr`.
- **Mobile**: rebuild the APK / IPA and check the Settings → Language
  list.

To inspect the runtime config the SPA sees, open the browser
DevTools console and run:

```javascript
JSON.stringify(window.APP_CONFIG.availableLocales)
// expected: ["en","fr"]
```

If the array is empty or `undefined`, the env var was unset at build
time (default = all 14 locales).

## Related

- [Contribute → i18n](/docs/contribute/i18n/) — adding a new language
  (translation key parity, locale files, contributor workflow). **Different
  audience** — this page is for deployers; the contribute page is for
  translators / contributors.
- [Configure → Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/)
  — realm-level locale configuration beyond the env var.
- [Frontend → Settings page](/docs/frontend/settings-page/) — where the
  `<LanguageSelector>` component reads the whitelist.
- [Operate → Backup & restore](/docs/operate/backup-restore/#restore-edge-cases)
  — restore gotcha for `KEYCLOAK_SUPPORTED_LOCALES`.
- [Reference → env-vars](/docs/reference/env-vars/) — full env-var
  reference.