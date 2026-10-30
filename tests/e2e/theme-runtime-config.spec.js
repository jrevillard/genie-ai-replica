const { test, expect } = require('@playwright/test');
const { expectRevalidated } = require('./helpers/cache-headers');
const BASE_URL = process.env.BASE_URL || 'https://localhost';

// Cache-header contract for the runtime theme configuration.
//
// /config/theme-variables.css, /runtime/config.js and /theme-fallback.css are all
// editable (or regenerated) outside the image build, so a browser must revalidate
// them on every load. The frontend nginx pins this with a `^~ /config/` prefix
// location, exact-match (`=`) locations and the @theme_fallback named location
// (all sharing nginx-revalidate-headers.inc), which take precedence over the
// `~* \.(js|css|...)$` rule that stamps hashed assets with a one-year immutable
// cache. Dropping either modifier silently reintroduces that cache on files that
// operators edit at runtime, which is exactly what these tests exist to catch.

const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';

test.describe('Runtime theme config cache headers', () => {
  test('operator-editable theme stylesheet is revalidated', async ({ request }) => {
    const response = await request.get('/config/theme-variables.css');
    expectRevalidated(response, '/config/theme-variables.css');
  });

  test('startup-generated runtime config is revalidated', async ({ request }) => {
    const response = await request.get('/runtime/config.js');
    expectRevalidated(response, '/runtime/config.js');
  });

  test('image-baked theme fallback is revalidated', async ({ request }) => {
    const response = await request.get('/theme-fallback.css');
    expectRevalidated(response, '/theme-fallback.css');
  });

  test('hashed build assets keep the immutable cache', async ({ request }) => {
    // Guards against over-broadening the revalidation rule: only the runtime
    // config paths are exempt, content-hashed bundles stay immutable.
    const home = await request.get('/');
    expect(home.status(), 'homepage should be served').toBe(200);
    const match = (await home.text()).match(/\/js\/app\.[a-f0-9]+\.js/);
    expect(match, 'homepage should reference a content-hashed app bundle').not.toBeNull();

    const response = await request.get(match[0]);
    expect(response.status(), `${match[0]} should be served`).toBe(200);
    expect(response.headers()['cache-control']).toBe(IMMUTABLE_ASSET_CACHE);
  });
});

test.describe('Keycloak runtime theme mount', () => {
  // The keycloak side of the runtime theme contract: the login page must be
  // served through the gateway with the MOUNTED genie theme. A bind mount
  // never falls back to image contents, so an unseeded or misrouted mount
  // silently serves Keycloak's unbranded built-in theme — no crash, no health
  // signal. These are the only tests that would catch it.

  test('realm is reachable through the gateway', async ({ request }) => {
    const response = await request.get('/auth/realms/genie/.well-known/openid-configuration');
    expect(response.status(), 'realm discovery endpoint should be served').toBe(200);
    // JSON, not an HTML error page served with a 200 (nginx fallback class).
    expect(response.headers()['content-type']).toContain('application/json');
    // The issuer comes from Keycloak's own hostname config (KC_HOSTNAME), not
    // from this request's URL: a wrong hostname setting keeps the endpoint
    // green while silently breaking every OIDC redirect.
    const base = process.env.BASE_URL || 'https://localhost';
    // A multi-origin dev slot (9444/9445 in front of a shared stack) mints
    // the stack's canonical issuer for every origin — the backend's issuer
    // map knows only that one. KEYCLOAK_PUBLIC_ORIGIN names it; unset, the
    // browser origin IS the canonical origin (single-origin deployments, CI).
    const kcOrigin = (process.env.KEYCLOAK_PUBLIC_ORIGIN || base).replace(/^https?:\/\//, '');
    const body = await response.json();
    expect(body.issuer, 'issuer must use the public origin the browser reaches').toContain(
      `${kcOrigin}/auth/realms/genie`
    );
  });

  // A deployment may select any mounted theme via KEYCLOAK_THEME (default
  // genie). Built-in theme names are rejected: their assets are what Keycloak
  // serves on an unmounted/broken theme, so asserting one would make the test
  // pass on exactly the failure it exists to catch.
  const expectedTheme = process.env.KEYCLOAK_THEME || 'genie';
  if (/^keycloak/.test(expectedTheme)) {
    throw new Error(`KEYCLOAK_THEME=${expectedTheme} is a built-in theme; the theme-mount test cannot assert it`);
  }

  test(`login page renders the mounted ${expectedTheme} theme`, async ({ request }) => {
    // Keycloak enforces PKCE (S256, min 43 chars) for genie-app and only
    // renders the login form after validating the request. A syntactically
    // valid dummy challenge yields the real login page without any session;
    // the redirect URI is accepted via the client's KC_PUBLIC_ORIGIN/* wildcard.
    const base = process.env.BASE_URL || 'https://localhost';
    const challenge = 'a'.repeat(43);
    const response = await request.get(
      `/auth/realms/genie/protocol/openid-connect/auth` +
        `?client_id=genie-app&response_type=code&scope=openid` +
        `&redirect_uri=${encodeURIComponent(`${base}/callback`)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`
    );
    expect(response.status(), 'login page should be served').toBe(200);
    const html = await response.text();
    // Theme assets are referenced as /auth/resources/<hash>/login/<theme>/...;
    // referencing the selected theme proves the MOUNTED theme resolved — the
    // built-in fallback would reference login/keycloak[.v2] instead.
    expect(html, `login page should load the mounted ${expectedTheme} theme assets`).toContain(
      `login/${expectedTheme}/`
    );
  });
});
