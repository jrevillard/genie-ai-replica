---
title: "Deployment flavors"
description: "How a GENIE.AI deployment is rebranded and tuned for a specific institution via the flavors directory — splash image, branding overrides, locale whitelist, and mobile OIDC client."
weight: 8
section: "configure"
mode: explanation
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-29
---

A **flavor** is the GENIE.AI term for everything that makes a deployment look
like a particular institution rather than the upstream "GENIE.AI" build. On
mobile, one flavor corresponds to one Dart file in
`mobile/genie_ai_mobile/lib/config/flavors/<name>.dart`; every artifact that
should differ between institutions — splash image, app title, Keycloak
branding overrides, locale whitelist, mobile OIDC client — is read from
that file (and the shared assets under `assets/`) at build time.

The production reference flavor is
`mobile/genie_ai_mobile/lib/config/flavors/itu.dart` (the ITU El Salvador
deployment). Every other flavor follows the same shape: copy `template.dart`
to `<institution>.dart`, edit the values that should change, and add a case
in `getConfig()` in `keycloak_config.dart` for the new flavor.

> For the canonical mobile flavor structure (Flutter build flags, deep-link
> schemes, OIDC client wiring), see
> `mobile/genie_ai_mobile/CLAUDE.md` in the repository.

## Flavor surface

| Concern | Where it lives | Default value (vanilla GENIE.AI) |
|---|---|---|
| Mobile OIDC + backend config | `mobile/genie_ai_mobile/lib/config/flavors/<name>.dart` (e.g. `itu.dart`) | values from `template.dart` |
| Mobile locale whitelist | `KeycloakConfig.supportedLocaleCodes` (set per-flavor in `mobile/genie_ai_mobile/lib/config/flavors/<name>.dart`, plus a `case` in `getConfig()`) | curated default (see [Restrict active locales](/docs/configure/locale-whitelist/)) |
| Mobile OIDC client id | `clientId:` in `mobile/genie_ai_mobile/lib/config/flavors/<name>.dart`; matching `KC_MOBILE_CLIENT_ID` env var | `genie-mobile-<institution>` |
| Mobile redirect scheme | `redirectScheme:` in `mobile/genie_ai_mobile/lib/config/flavors/<name>.dart`; matching `KC_MOBILE_REDIRECT_SCHEME` env var | `com.<institution>.genieai` |
| Keycloak login theme overrides | `configs/keycloak/themes/genie/` (shared across flavors; only the logo files differ) | upstream `genie` theme |
| Web app brand surface | `public/config/genie-ai-config.json` + `src/main.js` | upstream logo, app title, brand color |

## Branding, dashboard, and locale relationships

The brand surface is documented in
[Branding Customization](/docs/configure/branding-customization/) — replacing
the GENIE.AI logo, favicon, app title, and Keycloak login screen with your
institution's identity. The admin dashboard layout (which tabs and action
cards are shown) is documented in
[Admin dashboard customization](/docs/configure/dashboard-customization/) and
is **not** flavor-scoped — it lives in `AdminDashboard.vue`. The locale
whitelist (which languages the web UI, Keycloak login, and mobile app expose)
is documented in
[Restrict active locales](/docs/configure/locale-whitelist/) and is wired
through `VUE_APP_AVAILABLE_LOCALES` (web), `KEYCLOAK_SUPPORTED_LOCALES`
(Keycloak login), and `KeycloakConfig.supportedLocaleCodes` (mobile).

## "Flavor" vs "brand"

**"AgroGenio"** is the brand name of the .102 deployment (the live El
Salvador instance). It is **not** a flavor — the flavor for that deployment
is `itu`. The `.102` server runs `mobile/genie_ai_mobile/lib/config/flavors/itu.dart`; the splash, login,
and admin UI say "AgroGenio" because that's the institutional brand, and
the rest of the GENIE.AI stack is unchanged.

## Verifying the deployed flavor

After deploying a flavor change:

```bash
# Web: confirm the brand string is in the rendered config
curl -s https://<domain>/config/genie-ai-config.json | jq -r '.appTitle'

# Mobile: confirm the OIDC client id matches what Keycloak was configured for
flutter run --flavor itu
# → check lib/config/flavors/itu.dart → KeycloakConfig.clientId

# Keycloak: confirm the realm client id is the per-flavor value
KC_ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" .env | cut -d= -f2)
ADMIN_TOKEN=$(curl -sk -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" \
  -d "grant_type=password" | jq -r .access_token)
curl -sk "$KEYCLOAK_URL/admin/realms/genie/clients?clientId=$KC_MOBILE_CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].clientId'
```

If the mobile build keeps prompting for credentials even though
`access_token` is issued, the most common cause is a `redirect_uri`
mismatch — the scheme registered in `KC_MOBILE_REDIRECT_SCHEME` must
match the Android/iOS deep-link configuration in
`mobile/genie_ai_mobile/lib/config/flavors/<name>.dart` (the
`redirectScheme:` field).

## Related

- [Branding Customization](/docs/configure/branding-customization/) —
  swap logo, app title, favicon, brand color.
- [Admin dashboard customization](/docs/configure/dashboard-customization/) —
  add/remove tabs and action cards in the admin UI.
- [Restrict active locales](/docs/configure/locale-whitelist/) —
  per-deployment language whitelist for web / Keycloak / mobile.
- [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) —
  full Flutter build + per-flavor configuration walkthrough.