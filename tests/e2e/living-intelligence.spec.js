// tests/e2e/living-intelligence.spec.js
const { test, expect } = require('@playwright/test');

// The decorative layer is configuration, and its assets live in the
// bind-mounted /config/ directory, so they must be revalidated like the
// other operator-editable files — a cached copy would keep serving the
// baked-in illustration after an operator swapped it on the host.

test.describe('Living Intelligence visual layer', () => {
  test('the decoration assets are served from /config/ and revalidated', async ({ request }) => {
    for (const asset of [
      '/config/genie-visual/assets/genie-hero-transparent.png',
      '/config/genie-visual/assets/genie-bottom-waves.svg',
      '/config/genie-visual/assets/genie-dot-mesh.svg',
      '/config/genie-visual/assets/genie-corner-network.svg'
    ]) {
      const response = await request.get(asset);
      expect(response.status(), `${asset} should be served`).toBe(200);
      const cacheControl = response.headers()['cache-control'] || '';
      expect(cacheControl, `${asset} must be revalidated`).toContain('no-cache');
      expect(cacheControl, `${asset} must not be immutable`).not.toContain('immutable');
    }
  });
});