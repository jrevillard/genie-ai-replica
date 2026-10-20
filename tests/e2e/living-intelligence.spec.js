// tests/e2e/living-intelligence.spec.js
const { test, expect } = require('@playwright/test');

// The decorative layer is configuration, and its assets live in the
// bind-mounted /config/ directory, so they must be revalidated like the
// other operator-editable files — a cached copy would keep serving the
// baked-in illustration after an operator swapped it on the host.
//
// The assertion set matches tests/e2e/theme-runtime-config.spec.js
// (the same operator-edit-cache contract). The helper is duplicated
// rather than imported — a spec is a test module, not a library, and
// reaching across files to share four lines is worse than the duplication.

function expectRevalidated(response, label) {
  expect(response.status(), `${label} should be served (HTTP 200)`).toBe(200);
  const cacheControl = response.headers()['cache-control'] || '';
  expect(cacheControl, `${label} must be no-cache`).toContain('no-cache');
  expect(cacheControl, `${label} must be must-revalidate`).toContain('must-revalidate');
  expect(cacheControl, `${label} must not be immutable`).not.toContain('immutable');
  expect(cacheControl, `${label} must not carry a one-year max-age`).not.toContain('max-age=31536000');
}

test.describe('Living Intelligence visual layer', () => {
  test('the decoration assets are served from /config/ and revalidated', async ({ request }) => {
    for (const asset of [
      '/config/genie-visual/assets/genie-hero-transparent.png',
      '/config/genie-visual/assets/genie-bottom-waves.svg',
      '/config/genie-visual/assets/genie-dot-mesh.svg',
      '/config/genie-visual/assets/genie-corner-network.svg'
    ]) {
      const response = await request.get(asset);
      expectRevalidated(response, asset);
    }
  });
});
