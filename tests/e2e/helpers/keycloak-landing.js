// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The Keycloak landing contracts, owned once: the auth-endpoint glob, the
// login/logout chain settle predicate, and the login-form proof shared by
// the auth suite's specs. A spec that walks a login or logout reads its
// landing from here instead of re-spelling the predicate — a realm rename
// or an endpoint change lands here once for every spec that imports this
// module (the navbar.js precedent for shared selector constants).
//
// Selectors here are third-party Keycloak markup (the upstream theme's own
// ids), exempt from the declared-handle gate per tests/e2e/CLAUDE.md.
const { expect } = require('@playwright/test');

// The auth endpoint's path suffix — the ONE owner of the endpoint string.
// The login page IS this endpoint's render; the glob and the concrete
// realm path below are both derived from it, so an AUTH-ENDPOINT change
// lands here once. (The realm PREFIX is spelled separately — in the genie
// path below and in the logout literal inside the settle predicate; a
// realm rename touches those spellings too.)
const KEYCLOAK_AUTH_ENDPOINT_SUFFIX = '/protocol/openid-connect/auth';
const KEYCLOAK_AUTH_ENDPOINT_GLOB = `**${KEYCLOAK_AUTH_ENDPOINT_SUFFIX}**`;

// The CONCRETE realm auth path (the genie realm's) — the string the glob
// resolves to on this deployment, and the one an assertion on the landed
// URL spells.
const KEYCLOAK_GENIE_AUTH_PATH = '/auth/realms/genie' + KEYCLOAK_AUTH_ENDPOINT_SUFFIX;

// The login/logout redirect chain reaches the realm through exactly two
// endpoints: the logout endpoint (signoutRedirect via oidc-client-ts) and
// the auth endpoint that renders the login page. A settle wait keyed on
// this predicate fires on the chain's first sampled realm hop; the
// landing proof below is the load-bearing assertion that follows it.
async function waitForRealmAuthEndpoint(page, timeout = 30000) {
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/logout') ||
        urlStr.includes(KEYCLOAK_GENIE_AUTH_PATH)
      );
    },
    { timeout }
  );
}

// The landing-form proof: the Keycloak login form renders only while the
// realm holds no live SSO session for the browser, so it pins both the
// destination and the unauthenticated state — a surviving session (a
// partial logout) bounces through the auth endpoint straight back into
// the app and never renders this form, while a realm-path URL match alone
// cannot tell the two apart. One expected landing, asserted unconditionally.
async function expectKeycloakLoginForm(page, message) {
  await expect(page.locator('#username'), message).toBeVisible({ timeout: 15000 });
}

module.exports = {
  KEYCLOAK_AUTH_ENDPOINT_SUFFIX,
  KEYCLOAK_AUTH_ENDPOINT_GLOB,
  KEYCLOAK_GENIE_AUTH_PATH,
  waitForRealmAuthEndpoint,
  expectKeycloakLoginForm
};
