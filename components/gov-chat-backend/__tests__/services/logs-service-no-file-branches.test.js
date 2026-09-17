'use strict';
const fs = require('fs');
const path = require('path');

// SPEC D2 + AD-6 keep: `_sourceMode()` (per-call env read) and
// `VlFilesDisabledError` (503 contract). All file-source branches +
// helpers + `LOG_TO_FILE` guards are dropped in T8.
const KEPT_IN_LOGS_SERVICE = ['_sourceMode', 'VlFilesDisabledError'];

const DEAD_METHODS = [
  '_getLogsInRangeFromFile',
  '_getLogsSummaryFromFile',
  '_searchLogsFromFile',
  '_debugYesterdayLogsFromFile',
  '_getLogFilesInRangeFromDisk',
  '_acquireReadLock',
  '_releaseReadLock',
  '_readLogFileAd10',
  '_parseNdjsonContent',
  '_extractTimestamp',
  '_extractMessage',
  '_extractService',
  '_extractLevel',
  '_extractEnvironment',
  '_extractFields',
  'fileExists',
  'readLogFile',
  'extractDateFromFilename',
  'extractLogs',
  'groupLogs',
  'parseLogs',
  'detectLogLevel',
  'detectService'
];

const SOURCE_PATH = path.resolve(__dirname, '../../services/logs-service.js');

test('logs-service drops all file-source branches per SPEC D2 cleanup', () => {
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');
  for (const sym of DEAD_METHODS) {
    expect(src).not.toContain(sym);
  }
  // 4 LOG_TO_FILE guards in the file-source methods are gone with the methods
  expect(src.match(/booleanEnv\(\s*['"]LOG_TO_FILE['"]\s*\)/g) || []).toHaveLength(0);
  // `LOG_TO_FILE` must not appear anywhere in the file (the escape hatch
  // is gone; the VlFilesDisabledError message + docstrings were rewritten)
  expect(src).not.toMatch(/LOG_TO_FILE/);
  // Kept per SPEC D2 + AD-6
  for (const sym of KEPT_IN_LOGS_SERVICE) {
    expect(src).toContain(sym);
  }
});
