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

// The auth endpoint glob every login redirect lands on. The login page IS
// this endpoint's render.
const KEYCLOAK_AUTH_ENDPOINT_GLOB = '**/protocol/openid-connect/auth**';

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
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/auth')
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
  KEYCLOAK_AUTH_ENDPOINT_GLOB,
  waitForRealmAuthEndpoint,
  expectKeycloakLoginForm
};
