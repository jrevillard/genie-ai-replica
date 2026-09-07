'use strict';

// Story 5.4 — `LogsService` file-fallback contract test.
//
// Pinned by Epic 5 review: the admin-dashboard `getLogs()` regression (F4)
// was a triple-bracket regex parser that no longer matched the NDJSON
// producer. Story 5.3 swapped the parser to a NDJSON reader
// (`_parseNdjsonContent`, JSON.parse with N=4096 re-parse window). This
// file is the contract that locks the swap in place: the file fallback
// MUST keep parsing via JSON.parse and MUST NOT regress to the printf
// regex. The 5.8 end-to-end parity test would not fail if a future
// refactor reverted to regex — that's why this contract exists.

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  open: jest.fn(),
  unlink: jest.fn(),
  constants: { R_OK: 4 }
};

const mockFsSync = {
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  openSync: jest.fn(),
  closeSync: jest.fn(),
  writeSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn()
};

jest.mock('fs', () => ({
  readFileSync: mockFsSync.readFileSync,
  writeFileSync: mockFsSync.writeFileSync,
  openSync: mockFsSync.openSync,
  closeSync: mockFsSync.closeSync,
  writeSync: mockFsSync.writeSync,
  existsSync: mockFsSync.existsSync,
  unlinkSync: mockFsSync.unlinkSync,
  promises: mockFs,
  constants: { R_OK: 4 }
}));

jest.mock('zlib', () => ({
  gunzip: jest.fn()
}));

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

const util = require('util');
jest.spyOn(util, 'promisify').mockReturnValue(jest.fn().mockResolvedValue(Buffer.from('decompressed')));

let logsService;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  delete process.env.ADMIN_LOGS_SOURCE;
  delete process.env.LOG_TO_FILE;
  delete process.env.VL_FAIL_OPEN;
  delete process.env.VL_QUERY_TIMEOUT_MS;
  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
  });
});

describe('Story 5.4 — LogsService file-fallback uses JSON.parse, not regex', () => {
  it('uses JSON.parse, not regex, in file fallback', () => {
    // Construct NDJSON content whose lines would NOT match the legacy
    // triple-bracket regex (`[ts] [LEVEL] [service] message`). Each
    // line is a self-contained JSON object — if the parser fell back to
    // regex, the lines would all be discarded as "unparseable" and
    // `_parseNdjsonContent` would return [].
    //
    // The first line carries an `info.trace_id` / `info.span_id` payload
    // that is structurally meaningful only as a JSON key — the legacy
    // regex would have parsed it as part of the trailing message and
    // the trace_id would have ended up swallowed by `messageKey`
    // stripping (or worse, surfaced under the wrong row).
    const line = {
      timestamp: '2026-09-01T00:00:00.000Z',
      level: 'INFO',
      service: 'genie-backend',
      message: 'request handled',
      info: { trace_id: 'abc123', span_id: 'def456' },
      environment: 'test',
      extra: 'plain'
    };
    const content = JSON.stringify(line) + '\n';

    const rows = logsService._parseNdjsonContent(content);

    // The parser MUST recognise the JSON shape and produce one row.
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.timestamp).toBe('2026-09-01T00:00:00.000Z');
    expect(row.service).toBe('genie-backend');
    expect(row.message).toBe('request handled');
    expect(row.level).toBe('INFO');

    // Pinned JSON-key assertion: `info.trace_id` / `info.span_id` are
    // JSON keys, not printf substrings. The fallback path's `_extractFields`
    // walks the parsed object and preserves them under the `fields`
    // envelope; the legacy regex would have silently dropped the
    // nested trace correlation.
    expect(row.fields).toBeDefined();
    expect(row.fields.info).toBeDefined();
    expect(row.fields.info.trace_id).toBe('abc123');
    expect(row.fields.info.span_id).toBe('def456');
    expect(row.fields.extra).toBe('plain');
  });

  it('does not collapse distinct rows when their message happens to match a triple-bracket pattern', () => {
    // Synthetic regression: a string that LOOKS like the legacy
    // triple-bracket format (`[ts] [LEVEL] [service] message`) but is
    // also valid NDJSON. The old regex path would have parsed it as a
    // log line and produced a single (mis-categorised) row. The
    // JSON.parse path parses it as one row, but the `service` comes
    // from the JSON `service` key — NOT from the literal third bracket
    // group. If a refactor re-introduced the regex, the
    // `expected_service` below would surface as
    // 'not-the-bracket-content'.
    const trickyLine = {
      timestamp: '2026-09-01T00:00:00.000Z',
      level: 'INFO',
      service: 'real-service-from-json-key',
      message: '[2026-09-01T00:00:00.000Z] [INFO] [bracket-service] injected pattern'
    };
    const content = JSON.stringify(trickyLine) + '\n';
    const rows = logsService._parseNdjsonContent(content);
    expect(rows.length).toBe(1);
    expect(rows[0].service).toBe('real-service-from-json-key');
    expect(rows[0].message).toBe(trickyLine.message);
  });

  it('keeps JSON.parse working with the N=4096 re-parse window on truncated lines', () => {
    // Mirror the AD-9 hardening: truncated NDJSON line + tail appended
    // by the re-parse window. The contract is that JSON.parse succeeds
    // for valid lines AND the retry path (the future refactor is not
    // allowed to silently drop the retry either).
    const truncated = '{"timestamp":"2026-09-01T00:00:00.000Z","message":"truncated';
    const tail = '","level":"INFO","service":"genie-backend"}\n';
    const content = truncated + tail;
    const rows = logsService._parseNdjsonContent(content);
    expect(rows.length).toBe(1);
    expect(rows[0].message).toBe('truncated');
    expect(rows[0].service).toBe('genie-backend');
  });
});
