const { defineConfig } = require('@playwright/test');
require('dotenv').config();

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Fail fast by default. Suites that mint session tokens through a
  // browser login need more — a stalled login cycle costs ≈135s — and
  // scope their own ceiling with test.describe.configure plus a
  // test.setTimeout inside their beforeAll (hooks read this project
  // timeout, not the suite timeout). See tests/e2e/epic2/*.
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
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
