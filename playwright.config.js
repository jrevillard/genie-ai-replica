const { defineConfig } = require('@playwright/test');
require('dotenv').config();

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
    baseURL: process.env.BASE_URL || 'https://localhost',
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    actionTimeout: 15000,
    // HOST_RESOLVER_RULES pins the suite's hostname to a concrete
    // address for the whole run — a kubectl port-forward under the
    // suite's own load dies mid-run (listener alive, tunnel dead) and
    // every later goto times out against networkidle. The k8s dev
    // cluster serves the edge on its nodePort; resolve the name there
    // and nothing between the browser and Envoy can break.
    launchOptions: process.env.HOST_RESOLVER_RULES
      ? { args: [`--host-resolver-rules=${process.env.HOST_RESOLVER_RULES}`] }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
