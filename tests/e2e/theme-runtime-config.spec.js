const { test, expect } = require('@playwright/test');

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

function expectRevalidated(response, label) {
  expect(response.status(), `${label} should be served (HTTP 200)`).toBe(200);
  const cacheControl = response.headers()['cache-control'] || '';
  expect(cacheControl, `${label} must be no-cache`).toContain('no-cache');
  expect(cacheControl, `${label} must be must-revalidate`).toContain('must-revalidate');
  expect(cacheControl, `${label} must not be immutable`).not.toContain('immutable');
  expect(cacheControl, `${label} must not carry a one-year max-age`).not.toContain('max-age=31536000');
}

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
