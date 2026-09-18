'use strict';

/**
 * Opt-in LIVE adapter diagnostics — NOT part of the normal test run.
 *
 *   AGRI_LIVE=1 node node_modules/jest/bin/jest.js adapter-live-diag
 *
 * Runs resolve→fetch→parse→normalize against the REAL upstreams and prints
 * what came back, so schema drift can be diagnosed without a deployment.
 * Never committed with failures ignored — this is a debugging tool.
 */
require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const ONLY = (process.env.ADAPTER || '').split(',').filter(Boolean);

const loadAdapters = () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../../services/agri/adapters');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .map((f) => require(path.join(dir, f)));
};

// Skipped unless AGRI_LIVE=1 — never runs in CI (live network calls)
const describeLive = process.env.AGRI_LIVE === '1' ? describe : describe.skip;

describeLive('agri adapter LIVE diagnostics', () => {
  test('resolve → fetch → parse → normalize against real upstreams', async () => {
    const { adapterConfig } = require('../../../services/agri/config');
    for (const adapter of loadAdapters()) {
      if (ONLY.length > 0 && !ONLY.includes(adapter.id)) continue;
      const cfg = adapterConfig(adapter);
      const log = (m) => console.log(`[${adapter.id}] ${m}`);
      try {
        const resolved = await adapter.resolve(cfg);
        log(`resolved: ${JSON.stringify(resolved).slice(0, 200)}`);
        const raw = await adapter.fetch(resolved, cfg);
        const bytes = raw && raw.length !== undefined ? raw.length : (raw && raw.byteLength) || '?';
        log(`fetched: ${bytes} bytes`);
        const parsed = await adapter.parse(raw, cfg);
        const parsedSummary = Array.isArray(parsed)
          ? `${parsed.length} rows; first=${parsed[0] ? JSON.stringify(parsed[0]).slice(0, 300) : '(empty)'}`
          : typeof parsed;
        log(`parsed: ${parsedSummary}`);
        if (process.env.DUMP_ROWS === '1' && Array.isArray(parsed)) {
          parsed.slice(0, 8).forEach((r, i) => {
            const head = Array.isArray(r) ? r.slice(0, 5) : r;
            log(`row${i}: ${JSON.stringify(head)}`);
          });
        }
        const { docs } = await adapter.normalize(parsed, cfg);
        log(`normalized: ${docs ? docs.length : 0} docs`);
      } catch (error) {
        log(`FAILED: ${error.message} | ${error.stack}`);
      }
    }
  }, 600000);
});
