const { defineConfig } = require('@playwright/test');
require('dotenv').config();

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Session-token mints log in through the browser (two attempts on a
  // stalled stack: 30s navigation + 15s redirect wait + retry budget
  // each ≈ 135s). beforeAll hooks are bounded by this project timeout —
  // test.setTimeout cannot raise them — so the ceiling lives here.
  timeout: 180000,
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
