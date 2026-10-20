// tests/e2e/living-intelligence.spec.js
const { test, expect } = require('@playwright/test');
const { expectRevalidated } = require('./helpers/cache-headers');

// The decorative layer is configuration, and its assets live in the
// bind-mounted /config/ directory, so they must be revalidated like the
// other operator-editable files — a cached copy would keep serving the
// baked-in illustration after an operator swapped it on the host.
//
// The shared assertion (no-cache, must-revalidate, no immutable stamp,
// no one-year max-age) lives in helpers/cache-headers.js: every spec
// that touches an operator-editable runtime-config path uses the same
// helper so the contract diverges in one place rather than per spec.

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

  test('the layer writes data-visual=on and resolves --visual-hero at the document root', async ({ page }) => {
    // A pure asset-availability check cannot fail when the layer stops
    // rendering entirely — the layer is conditional on the loader having
    // written `data-visual=on` AND run for a real page. Walking the home
    // page and reading the live DOM is what proves the wiring.
    await page.goto('/');
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-visual')), { timeout: 15000 })
      .toBe('on');
    const heroUrl = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--visual-hero').trim();
      return raw.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
    });
    expect(heroUrl, '--visual-hero must resolve to the configured asset URL').toBe(
      '/config/genie-visual/assets/genie-hero-transparent.png'
    );
    // Per-asset presence flag drives the band-collapse: hero is wired
    // here, so the flag must be 1. The CSS layer uses it as a length
    // multiplier (calc(... * 0)) to drop the box when the operator
    // omits the asset.
    const heroSet = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--visual-hero-set').trim()
    );
    expect(heroSet, '--visual-hero-set must be 1 when hero is configured').toBe('1');
  });
});
