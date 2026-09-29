'use strict';

// The logs window must mean "today in the operator's timezone" in EVERY
// timezone, not just the one the CI runner happens to sit in.
//
// The regression this guards: `searchLogs` used to derive its window by
// taking LOCAL midnight, converting it to a UTC date string, then
// re-anchoring that string as UTC midnight. The two conversions cancel
// exactly at TZ=UTC, so the bug was invisible on a UTC CI runner while
// shifting the window by up to 22 hours east of Greenwich. `getLogsInRange`
// used the correct local-midnight derivation, so the two endpoints could
// disagree about "today" on the same request.
//
// Each timezone runs in its own child process — V8 fixes the timezone at
// startup and `process.env.TZ` cannot change it inside a worker. See
// __tests__/helpers/tz-window-probe.js for why a subprocess and not a
// mocked clock.

const path = require('path');
const { execFileSync } = require('child_process');

const SENTINEL = '__TZ_WINDOW_RESULT__';
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const PROBE = path.join(BACKEND_DIR, '__tests__', 'helpers', 'tz-window-probe.js');

// UTC, UTC+2, UTC-7, UTC+11, UTC-12, and a 45-minute offset — the last
// is the interesting one, since every "add two hours" style fix gets
// fractional zones wrong.
const TIMEZONES = [
  'UTC',
  'Europe/Paris',
  'America/Los_Angeles',
  'Pacific/Kiritimati',
  'Pacific/Midway',
  'Asia/Kathmandu'
];

function runInTimezone(tz) {
  const stdout = execFileSync(process.execPath, [PROBE], {
    env: {
      ...process.env,
      TZ: tz,
      LS_PATH: path.join(BACKEND_DIR, 'services', 'logs-service.js'),
      SHARED_LIB: path.join(REPO_ROOT, 'components', 'shared', 'lib'),
      NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
      ENABLE_OBSERVABILITY: '0'
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const line = stdout.split('\n').find((l) => l.startsWith(SENTINEL));
  if (!line) throw new Error(`probe produced no result for ${tz}: ${stdout.slice(-400)}`);
  const parsed = JSON.parse(line.slice(SENTINEL.length));
  if (parsed.error) throw new Error(`probe failed for ${tz}: ${parsed.error}`);
  return parsed;
}

describe.each(TIMEZONES)('logs window under TZ=%s', (tz) => {
  let result;

  beforeAll(() => {
    result = runInTimezone(tz);
  }, 30000);

  it('starts at local midnight of the local calendar day', () => {
    expect(result.startLocalHours).toBe(0);
    expect(result.startLocalMinutes).toBe(0);
  });

  it('ends at the last millisecond of the local day', () => {
    expect(result.endLocalHours).toBe(23);
    expect(result.endLocalMinutes).toBe(59);
    expect(result.endLocalSeconds).toBe(59);
    expect(result.endLocalMilliseconds).toBe(999);
  });

  it('covers exactly one local day, not a day shifted across the date line', () => {
    // The child computes the real length of the local calendar day it
    // covered. Hardcoding 24h would go red twice a year in a DST zone —
    // measured: Europe/Paris is 23h on 2026-03-29 and 25h on 2026-10-25.
    expect(result.windowHours).toBeCloseTo(result.expectedDayHours, 3);
    // Sanity bounds so a wildly wrong window still fails rather than
    // matching a wrong expectation.
    expect(result.windowHours).toBeGreaterThan(22);
    expect(result.windowHours).toBeLessThan(26);
  });

  it('the start and the end fall on the same local calendar date', () => {
    // Both dates are read inside the child, in the timezone under test —
    // the parent's Date objects use the parent's timezone, which is the
    // thing being varied.
    expect(result.startLocalDate).toBe(result.endLocalDate);
  });

  it('searchLogs and getLogsInRange agree on the window', () => {
    // The regression: the list endpoint derived a local-midnight instant
    // while the search endpoint derived a UTC-midnight instant. They only
    // coincided at TZ=UTC.
    expect(result.searchWindow.start).toBe(result.listWindow.start);
    expect(result.searchWindow.end).toBe(result.listWindow.end);
  });
});

describe('logs window across timezones', () => {
  it('produces a different instant per zone, i.e. the zone is really applied', () => {
    // Guards the harness itself: if TZ were ignored, every run would
    // return the same window and the per-zone assertions would be
    // passing for the wrong reason.
    const utc = runInTimezone('UTC');
    const kiritimati = runInTimezone('Pacific/Kiritimati');
    expect(utc.offsetMinutes).toBe(0);
    expect(kiritimati.offsetMinutes).toBe(-840);
    expect(utc.listWindow.start).not.toBe(kiritimati.listWindow.start);
  });
});
