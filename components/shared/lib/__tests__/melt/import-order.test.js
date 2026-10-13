// components/shared/lib/__tests__/melt/import-order.test.js
'use strict';

/**
 * The MELT barrel and the VictoriaLogs adapter used to require each
 * other: the adapter reached the port through `require('./index')`, and
 * the barrel reached the adapter through
 * `require('./victorialogs-client')`. Which file Node loaded first then
 * decided whether the module worked at all.
 *
 * Requiring the adapter first captured the barrel's exports object
 * before the barrel's trailing `module.exports = {…}` replaced it with a
 * new literal, so `new VictoriaLogsClient()` threw
 * `TypeError: VictoriaLogsAdapter is not a constructor` — and every
 * admin /api/admin/logs request would have 500'd. Production escaped it
 * only because both consumers happen to require the barrel first.
 *
 * These run in child processes: a module registry is per-process, so an
 * in-process test could not re-run the load in a different order.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const MELT_DIR = path.resolve(__dirname, '../../melt');
const BARREL = path.join(MELT_DIR, 'index.js');
const ADAPTER = path.join(MELT_DIR, 'victorialogs-client.js');
const PORT = path.join(MELT_DIR, 'log-query-repository.js');

function loadInOrder(files) {
  // Each order gets a fresh process: the module cache is what makes the
  // order matter in the first place.
  return execFileSync(
    process.execPath,
    [
      '-e',
      `${files.map((f) => `require(${JSON.stringify(f)});`).join('\n')}
       const m = require(${JSON.stringify(BARREL)});
       new m.VictoriaLogsClient({ baseURL: 'http://vl.local', skipHealthProbe: true });
       process.stdout.write('ok');`
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

describe('MELT module load order does not matter', () => {
  it('barrel first', () => {
    expect(loadInOrder([BARREL])).toContain('ok');
  });

  it('adapter first — the order that used to throw', () => {
    expect(loadInOrder([ADAPTER])).toContain('ok');
  });

  it('port first', () => {
    expect(loadInOrder([PORT])).toContain('ok');
  });

  it.each([
    ['barrel', BARREL],
    ['adapter', ADAPTER],
    ['port', PORT]
  ])('loading the %s emits no circular-dependency warning', (_label, entry) => {
    // Node prints "Accessing non-existent property … inside circular
    // dependency" on stderr when it resolves a cycle from a partial
    // exports object. Its absence is the real assertion — a cycle that
    // happens to resolve is still a cycle.
    let stderr = '';
    try {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(entry)});`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      stderr = String(err.stderr || '');
    }
    expect(stderr).not.toMatch(/circular dependency/i);
  });
});

describe('the adapter no longer reaches the barrel', () => {
  it('victorialogs-client.js does not require ./index', () => {
    const src = require('fs').readFileSync(ADAPTER, 'utf8');
    // Comment references are fine; a live require is not.
    expect(src).not.toMatch(/require\(['"]\.\/index['"]\)/);
  });

  it('the port lives in its own module', () => {
    expect(require('fs').existsSync(PORT)).toBe(true);
    expect(require(PORT).LogQueryRepository).toBe(require(BARREL).LogQueryRepository);
  });
});
