'use strict';

// Child-process probe for the logs window timezone tests.
//
// WHY A SUBPROCESS: V8 fixes the process timezone at startup. Assigning
// `process.env.TZ` inside a Jest worker does NOT change the offset
// (measured: it stays 0), so a test cannot switch timezones in-process.
// A freshly spawned node DOES honour `TZ` from its environment, which is
// the only way to exercise the same code under several zones.
//
// The service is loaded for real rather than reconstructed, so this tests
// the shipped module. Two things Jest normally provides are reproduced
// here, because plain node does not have them:
//
//   - `./shared-lib` / `../shared-lib` require aliases, which exist only
//     via Jest's moduleNameMapper (the Docker COPY renames
//     `shared/lib` -> `shared-lib`, and Jest maps it back);
//   - node_modules resolution for `components/shared/lib`, which is not
//     under the backend's node_modules — NODE_PATH covers it.
//
// Stdout carries the service's own startup logging, so the result is
// emitted after a sentinel and the parent reads the last line.

const Module = require('module');
const path = require('path');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (/shared-lib(\/|$)/.test(request)) {
    const sub = request.replace(/^(\.\.\/)*shared-lib\/?/, '');
    return originalResolve.call(this, path.join(process.env.SHARED_LIB, sub), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const SENTINEL = '__TZ_WINDOW_RESULT__';

async function main() {
  const { LogsService } = require(process.env.LS_PATH);
  const svc = new LogsService();

  // Capture the window each endpoint actually sends to VictoriaLogs.
  const windows = [];
  svc.setVictoriaLogsClient({
    query: async (args) => {
      windows.push({ start: args.start, end: args.end });
      return [];
    },
    count: async () => 0,
    hits: async () => ({})
  });

  await svc.getLogsInRange({ dateRange: 'today' });
  const listWindow = { ...windows[windows.length - 1] };

  await svc.searchLogs({ dateRange: 'today' });
  const searchWindow = { ...windows[windows.length - 1] };

  const start = new Date(listWindow.start);
  const end = new Date(listWindow.end);

  // Length of the local calendar day the window covers. A local day is
  // 23h or 25h on a DST transition day, so the parent cannot assume 24h
  // and still call the window correct.
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const nextDayStart = new Date(dayStart);
  nextDayStart.setDate(dayStart.getDate() + 1);

  const localDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Every local-time value is computed HERE, in the timezone under test.
  // The parent cannot re-derive them: its own Date objects use the
  // parent's timezone, which is the one thing being varied.
  process.stdout.write(
    `${SENTINEL}${JSON.stringify({
      listWindow,
      searchWindow,
      startLocalHours: start.getHours(),
      startLocalMinutes: start.getMinutes(),
      endLocalHours: end.getHours(),
      endLocalMinutes: end.getMinutes(),
      endLocalSeconds: end.getSeconds(),
      endLocalMilliseconds: end.getMilliseconds(),
      offsetMinutes: start.getTimezoneOffset(),
      startLocalDate: localDate(start),
      endLocalDate: localDate(end),
      windowHours: (end - start) / 36e5,
      expectedDayHours: (nextDayStart - dayStart) / 36e5
    })}\n`
  );
}

main().catch((err) => {
  process.stdout.write(`${SENTINEL}${JSON.stringify({ error: String(err && err.message) })}\n`);
  process.exitCode = 1;
});
