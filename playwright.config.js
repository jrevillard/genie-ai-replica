const { defineConfig } = require('@playwright/test');
require('dotenv').config();
// The venue's edge, the ONE definition (tests/e2e/helpers/base-url.js):
// the config's own default would be a second copy of the fact, and no
// mechanism keeps the two equal. The module is dependency-free and
// credential-free, so the config may require it.
const { BASE_URL } = require('./tests/e2e/helpers/base-url');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Fail fast by default. Suites that mint session tokens through a
  // browser login need more — a stalled login cycle costs ≈135s — and
  // scope their own ceiling with test.describe.configure plus a
  // test.setTimeout inside their beforeAll/afterAll (hooks read this
  // project timeout, not the suite timeout). See tests/e2e/epic2/*;
  // SESSION_MINT_TIMEOUT_MS in tests/e2e/helpers/auth.js holds the value
  // and its derivation.
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'reports/playwright-report.xml' }],
  ],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
