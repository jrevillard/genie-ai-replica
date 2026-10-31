const { defineConfig } = require('@playwright/test');
require('dotenv').config();

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Session-token mints log in through the browser — on a stalled stack
  // one login cycle costs ≈135s (two attempts of 30s navigation + 15s
  // redirect wait + retry budget). The ceiling is sized for the worst
  // beforeAll stacking such a login on top of its admin-API requests
  // (i1: ~5 requests at the 30s cap). It also bounds hooks: this project
  // timeout is what beforeAll/afterAll run under.
  timeout: 360000,
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
