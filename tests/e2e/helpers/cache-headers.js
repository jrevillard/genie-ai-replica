// Shared helpers for the runtime-config e2e specs.
//
// expectRevalidated is the contract assertion every operator-editable
// runtime-config path must satisfy: the file is served (HTTP 200) and
// the cache headers declare no-cache / must-revalidate without an
// immutable stamp or a one-year max-age. The frontend nginx pins this
// with the `^~ /config/` prefix location, exact-match (`=`) locations
// and the @theme_fallback named location (all sharing
// nginx-revalidate-headers.inc), which take precedence over the
// `~* \.(js|css|...)$` rule that stamps hashed assets with a one-year
// immutable cache. Dropping either modifier silently reintroduces
// that cache on files that operators edit at runtime, which is exactly
// what this helper exists to catch.

const { expect } = require('@playwright/test');

function expectRevalidated(response, label) {
  expect(response.status(), `${label} should be served (HTTP 200)`).toBe(200);
  const cacheControl = response.headers()['cache-control'] || '';
  expect(cacheControl, `${label} must be no-cache`).toContain('no-cache');
  expect(cacheControl, `${label} must be must-revalidate`).toContain('must-revalidate');
  expect(cacheControl, `${label} must not be immutable`).not.toContain('immutable');
  expect(cacheControl, `${label} must not carry a one-year max-age`).not.toContain('max-age=31536000');
}

module.exports = { expectRevalidated };
