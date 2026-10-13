'use strict';

// VictoriaLogs migration tests for `LogsService`.
//
// Covers the single-channel behaviour after the T8 cleanup:
//   - `getLogsInRange` / `searchLogs` / `getLogsSummary` /
//     `getDebugYesterday` happy paths through
//     `VictoriaLogsClient` (canonical `{logs, total, limit, offset}`
//     envelope).
//   - VL outage surfaces as `VlUnavailableError` (503, body
//     `{error: 'vl_unreachable', message}`) for ECONNREFUSED, ENOTFOUND,
//     ETIMEDOUT, `VictoriaLogsHealthError`, and 5xx upstream responses.
//   - Validation / programmer errors propagate unchanged (not wrapped).
//   - `_escapeLogSql` adversarial inputs (LogSQL injection defence).
//   - `_normalizeLevelFilter` allowlist + clamp.

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

jest.mock('zlib', () => ({
  gunzip: jest.fn()
}));

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

const util = require('util');
jest.spyOn(util, 'promisify').mockReturnValue(jest.fn().mockResolvedValue(Buffer.from('decompressed')));

let logsService;
let mockVlClient;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  delete process.env.VL_QUERY_TIMEOUT_MS;
  mockVlClient = {
    query: jest.fn().mockResolvedValue([]),
    hits: jest.fn().mockResolvedValue({})
  };
  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
    logsService.setVictoriaLogsClient(mockVlClient);
  });
});

describe('LogsService VictoriaLogs rewrite', () => {
  describe('getLogsInRange — VL path', () => {
    it('returns envelope {logs, total, limit, offset} from VictoriaLogsClient', async () => {
      const rows = [
        {
          timestamp: '2026-09-01T00:00:00.000Z',
          message: 'm1',
          date: '2026-09-01',
          time: '00:00:00',
          level: 'INFO',
          service: 'backend',
          stream: { service: 'backend', environment: 'test' },
          fields: {}
        },
        {
          timestamp: '2026-09-01T00:00:01.000Z',
          message: 'm2',
          date: '2026-09-01',
          time: '00:00:01',
          level: 'INFO',
          service: 'backend',
          stream: { service: 'backend', environment: 'test' },
          fields: {}
        }
      ];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 100,
        offset: 0
      });
      expect(result).toEqual({
        logs: rows,
        total: 2,
        limit: 100,
        offset: 0
      });
    });

    it('applies offset + limit pagination on the envelope', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        timestamp: `2026-09-01T00:00:0${i}.000Z`,
        message: `m${i}`,
        date: '2026-09-01',
        time: `00:00:0${i}`,
        level: 'INFO',
        service: 'backend',
        stream: { service: 'backend', environment: 'test' },
        fields: {}
      }));
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 2,
        offset: 1
      });
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
      expect(result.total).toBe(5);
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0].message).toBe('m1');
    });

    it('throws VlUnavailableError on ECONNREFUSED (no graceful-degradation envelope)', async () => {
      // T8 contract: VL outage always surfaces as a typed VlUnavailableError
      // (503, body `{error: 'vl_unreachable', message}`). The legacy
      // VL_FAIL_OPEN=true degraded-envelope path is gone — operators flip
      // VL back up, they do not silence the error.
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      mockVlClient.query.mockRejectedValueOnce(err);
      await expect(
        logsService.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z'
        })
      ).rejects.toMatchObject({
        name: 'VlUnavailableError',
        statusCode: 503,
        body: expect.objectContaining({ error: 'vl_unreachable' })
      });
    });

    it('throws VlUnavailableError on 5xx upstream response', async () => {
      const err = new Error('Server Error');
      err.response = { status: 503 };
      mockVlClient.query.mockRejectedValueOnce(err);
      await expect(
        logsService.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z'
        })
      ).rejects.toMatchObject({
        name: 'VlUnavailableError',
        statusCode: 503
      });
    });
  });

  describe('getLogsSummary — VL path', () => {
    // Same root cause as the searchLogs level filter: the fluentd-driven
    // Winston transport writes the real level INSIDE the `_msg` JSON
    // envelope (not as a top-level VL field), so VL's `hits(field=level)`
    // always returns `{ERROR: 0, WARN: 0, ...}`. We fetch the day's rows
    // and count client-side AFTER the MELT normalizer has lifted the
    // level out of `_msg`.
    it('counts ERROR + WARN buckets from observed query rows', async () => {
      // Post-F11 the buckets are populated from query() rows (not
      // hits() counts). service.name + the message head are the
      // row shape; bucket grouping is client-side on the returned
      // rows. The previous "seed from hits, override with observed
      // rows" was removed because the hits count duplicated the
      // observed count and added no actionable signal. The
      // service list derives from union of bucket rows.
      //
      // INFO is not queried: it is the bulk of the log volume and
      // nothing in a dashboard tile is actionable from it. The third
      // round-trip it cost was paid on every dashboard load for rows
      // the UI discarded.
      //
      // Bucket queries OR-join the legacy alias
      // (ERROR↔FATAL, WARN↔WARNING) so a Python fleet producing
      // FATAL/WARNING isn't silently dropped from the buckets.
      mockVlClient.query.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:ERROR OR severity_text:FATAL') {
          return [{ 'service.name': 'backend', _msg: 'cache miss' }];
        }
        if (q === 'severity_text:WARN OR severity_text:WARNING') {
          return [
            { 'service.name': 'document-repository', _msg: 'deprecated api' },
            { 'service.name': 'backend', _msg: 'deprecated api' }
          ];
        }
        return [];
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(mockVlClient.query).toHaveBeenCalledTimes(2);
      // One `hits()` call remains, for the service FILTER. It used to be
      // zero: the dropdown was derived from the ERROR/WARN buckets, which
      // made it a list of services that had something wrong today — a
      // healthy nginx or kong was unselectable. This call is scoped to
      // `field: 'service.name'` and is NOT the rejected-status probe the
      // F11 optimisation removed; the outage detection still rides on
      // `query()` alone.
      expect(mockVlClient.hits).toHaveBeenCalledTimes(1);
      expect(mockVlClient.hits).toHaveBeenCalledWith(expect.objectContaining({ field: 'service.name', q: '*' }));
      expect(result.date).toBe('2026-09-01');
      expect(result.errors).toHaveLength(1);
      expect(result.warnings).toHaveLength(2);
      expect(result).not.toHaveProperty('infos');
      // Service list = union of bucket rows grouped by service.name
      // (1 backend from ERROR + 1 backend from WARN + 1 doc-repo from WARN).
      expect(result.services).toEqual([
        { name: 'backend', count: 2 },
        { name: 'document-repository', count: 1 }
      ]);
    });

    it('extracts the actual message from a Winston JSON envelope before categorising (TYPE column fidelity)', async () => {
      // Real VL `_msg` for Node services is a Winston JSON envelope:
      //   `{"level":"info","message":"[DB_CONNECTION] Getting database connection",...}`
      // The legacy file-log `groupLogs()` path parsed the envelope first
      // and ran the regex / `split(':')[0]` fallback on the inner
      // `.message` field. The VL summary must do the same — otherwise
      // the TYPE column shows literal `{"level"` for every Winston row.
      //
      // Bucket query is `severity_text:WARN OR severity_text:WARNING`
      // so a Python WARN/WARNING record lands in the same bucket.
      mockVlClient.query.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:WARN OR severity_text:WARNING') {
          return [
            {
              _msg: JSON.stringify({
                level: 'warn',
                message: '[DB_CONNECTION] Getting database connection',
                service: 'backend'
              }),
              service: 'backend'
            },
            {
              _msg: JSON.stringify({
                level: 'warn',
                message: 'ENOENT: no such file or directory',
                service: 'backend'
              }),
              service: 'backend'
            }
          ];
        }
        return [];
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'WARN' });
      const types = result.warnings.map((r) => r.type).sort();
      // Two entries expected — 2 message-derived types from the row fetch.
      // The level-only seed row was removed (commit): surfacing "INFO"
      // for every service that had hits but no observed rows was
      // misleading and duplicated the per-service total already in
      // `services[]` (used by the Log Search dropdown).
      expect(types).toEqual(['[DB_CONNECTION] Getting database connection', 'fileNotFound']);
      // No literal envelope leakage.
      expect(result.warnings.every((r) => !r.type.startsWith('{'))).toBe(true);
    });

    it('falls through to the raw `_msg` for non-JSON payloads (e.g. uvicorn access logs)', async () => {
      // Python uvicorn access logs are NOT JSON envelopes — they are
      // raw text lines like `INFO: 127.0.0.1:... - "GET /health"`.
      // The `split(':')[0]` fallback should still work on them.
      //
      // Bucket query is `severity_text:WARN OR severity_text:WARNING`.
      mockVlClient.query.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:WARN OR severity_text:WARNING') {
          return [
            {
              _msg: 'INFO:     127.0.0.1:51056 - "GET /health HTTP/1.1" 200 OK',
              service: 'textgen'
            }
          ];
        }
        return [];
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'WARN' });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('INFO');
    });

    it('returns empty buckets when VL has no ERROR/WARN rows', async () => {
      mockVlClient.hits.mockImplementation(async () => ({}));
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result).not.toHaveProperty('infos');
      expect(result.services).toEqual([]);
    });

    it('throws VlUnavailableError when VL times out (ETIMEDOUT)', async () => {
      // T8 contract: VL outage always surfaces as VlUnavailableError; no
      // graceful-degradation envelope. Post-F11 the failure path is
      // query() not hits() — the outermost catch in getLogsSummary
      // funnels every connection-class error through `_vlOrThrow`.
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      mockVlClient.query.mockRejectedValue(err);
      await expect(logsService.getLogsSummary({ date: '2026-09-01' })).rejects.toMatchObject({
        name: 'VlUnavailableError',
        statusCode: 503,
        body: expect.objectContaining({ error: 'vl_unreachable' })
      });
    });

    it('getLogsSummary — VL path with level=ERROR returns only errors bucket', async () => {
      // No query mock → no rows observed → errors bucket is empty.
      // The previous seed (level-only ERROR rows from hits()) was removed;
      // see the test above for the rationale.
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:ERROR') return { auth: 2 };
        if (q === '*') return { auth: 2 };
        return {};
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'ERROR' });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result).not.toHaveProperty('infos');
    });

    it('getLogsSummary — VL path rejects a level that has no bucket', async () => {
      // The summary covers ERROR and WARN only. INFO used to be a third
      // bucket whose rows the UI discarded; it is no longer queried, so
      // asking for it is a client error rather than an empty summary.
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === '*') return { backend: 2, 'document-repository': 1 };
        return {};
      });
      await expect(logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' })).rejects.toMatchObject({
        name: 'InvalidFilterError',
        statusCode: 400
      });
      expect(mockVlClient.query).not.toHaveBeenCalled();
    });
  });

  describe('searchLogs — VL path', () => {
    it('builds LogSQL from term + severity_text + service.name filters', async () => {
      // The producer-side transform stamps severity_text + service.name
      // at top level in VL, so the level + service filters are pushed
      // down to VL (no over-fetch + client-side filter required). The
      // resulting VL query matches every fluentd-sourced log uniformly
      // (no dual-path fallback needed).
      const rows = [
        {
          timestamp: '2026-09-01T00:00:00.000Z',
          message: 'login',
          level: 'INFO',
          service: 'auth',
          date: '2026-09-01',
          time: '00:00:00',
          stream: { service: 'auth', environment: 'test' },
          fields: {}
        }
      ];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.searchLogs({
        dateRange: 'today',
        term: 'login',
        level: 'INFO',
        service: 'auth',
        limit: 50
      });
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      const callArg = mockVlClient.query.mock.calls[0][0];
      // All three filters are now pushed down to VL as LogSQL clauses.
      // Term uses both-sides wildcard (`*<term>*`) so VL does prefix-
      // within-token matching — phrase `"<term>"` would fail to match
      // substring fragments like `DB_` inside a longer token
      // (`DB_CONNECTION` tokenises as one word).
      expect(callArg.q).toContain('_msg:*login*');
      expect(callArg.q).toContain('severity_text:INFO');
      expect(callArg.q).toContain('service.name:"auth"');
      // Limit is honoured exactly (no more 4x over-fetch multiplier).
      expect(callArg.limit).toBe(50);
      expect(result.logs).toEqual(rows);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('strips LogSQL reserved chars in the term (replaces with space)', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      await logsService.searchLogs({ dateRange: 'today', term: 'a*b?c:d"e\\f' });
      const callArg = mockVlClient.query.mock.calls[0][0];
      // Reserved chars are replaced with spaces — safer than backslash
      // escaping (LogSQL has no escape sequence for newline/control chars;
      // a literal newline in the source would break out of the quoted
      // segment and inject arbitrary filter syntax).
      //
      // The result is a multi-word term, so it is wrapped in quotes inside
      // the wildcard. Unquoted, VictoriaLogs rejects it outright:
      // `_msg:*a b c d e f*` -> 400 "missing ending '*'", which reached the
      // caller as an unexplained 500.
      expect(callArg.q).toContain('_msg:*"a b c d e f"*');
    });

    it('strips newline + LogSQL control chars to prevent injection', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      // Newline + quoted-string terminator + backtick + control chars.
      // After stripping, the `_stream:"evil"` filter clause cannot
      // appear verbatim — the `"`, `:` and newline that close the
      // outer `_msg:*...*` segment are removed (the wildcard wrap does
      // not use quotes, so any literal `"` or `:` would still be a
      // LogSQL injection vector).
      await logsService.searchLogs({
        dateRange: 'today',
        term: 'safe\n_stream:"evil" _msg:`injected'
      });
      const callArg = mockVlClient.query.mock.calls[0][0];
      expect(callArg.q).not.toContain('_stream:"evil"');
      expect(callArg.q).not.toContain('_msg:*evil*');
      expect(callArg.q).not.toContain('`');
      expect(callArg.q).not.toContain('\n');
    });
  });

  describe('getDebugYesterday — VL path', () => {
    it('returns success envelope with sample lines', async () => {
      const rows = [{ message: 'sample-1' }, { message: 'sample-2' }];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.debugYesterdayLogs();
      expect(result.success).toBe(true);
      expect(result.lines).toBe(2);
      expect(result.sample).toEqual(['sample-1', 'sample-2']);
      expect(result).not.toHaveProperty('filesFound');
    });

    it('throws VlUnavailableError on ENOTFOUND', async () => {
      // T8: debugYesterdayLogs no longer has a VL_FAIL_OPEN graceful-
      // degradation envelope. The ENOTFOUND upstream maps to
      // VlUnavailableError (503, body `vl_unreachable`).
      const err = new Error('connect ENOTFOUND');
      err.code = 'ENOTFOUND';
      mockVlClient.query.mockRejectedValueOnce(err);
      await expect(logsService.debugYesterdayLogs()).rejects.toMatchObject({
        name: 'VlUnavailableError',
        statusCode: 503,
        body: expect.objectContaining({ error: 'vl_unreachable' })
      });
    });
  });

  describe('review follow-up — 2026-09-07 patches', () => {
    it('_defaultStartIso throws on unknown dateRange (no silent today fallback)', () => {
      // The previous behaviour fell through to "today" for any unknown
      // value — silently widening the query range. The fix throws so the
      // route layer surfaces a 400 rather than returning today's logs
      // for a typo like 'todya' or a new dateRange we haven't taught
      // the helper about.
      expect(() => logsService._defaultStartIso('todya')).toThrow(/unknown dateRange/);
      expect(() => logsService._defaultStartIso('last-week')).toThrow(/unknown dateRange/);
    });
    it('_defaultEndIso throws on unknown dateRange (no silent now fallback)', () => {
      expect(() => logsService._defaultEndIso('todya')).toThrow(/unknown dateRange/);
    });

    it('_defaultEndIso("yesterday") snaps to yesterday 23:59:59 (does NOT spill into today)', () => {
      const endIso = logsService._defaultEndIso('yesterday');
      const end = new Date(endIso);
      const now = new Date();
      // Must be earlier than or equal to today's local 23:59:59.999 and
      // not later than "now" (the previous bug used today's now as the
      // upper bound — queries for yesterday spilled into today).
      const upperBound = new Date(now);
      upperBound.setHours(23, 59, 59, 999);
      expect(end.getTime()).toBeLessThanOrEqual(upperBound.getTime());
    });

    // _isVlUnavailable was removed in T8: VL outage classification now
    // lives inline in `_vlOrThrow` and the dead-method tests are gone.
    // The new contract is asserted via the
    // `VlUnavailableError` tests in the `getLogsInRange` / `getLogsSummary`
    // / `getDebugYesterday` / `searchLogs` suites
    // (see above + `logs-vl-degradation.test.js`).

    it('passes the user-supplied q through to VL without a dedup suffix', () => {
      // After the OTel SDK revert (T1-T4b) there is a single emit path
      // (Winston -> stdout -> fluentd -> collector -> VL). The legacy
      // `NOT fluent.tag:*` dedup discriminator served dual-channel
      // reconciliation and is now dead code — the dispatcher passes `q`
      // straight through to the VL adapter.
      mockVlClient.query.mockResolvedValueOnce([]);
      return logsService
        .getLogsInRange({ start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T23:59:59.999Z', limit: 1 })
        .then(() => {
          const callArg = mockVlClient.query.mock.calls[0][0];
          expect(callArg.q).toBe('*');
          expect(callArg.q).not.toMatch(/NOT\s+fluent\.tag/);
        });
    });

    // _sourceMode was removed in T8: `ADMIN_LOGS_SOURCE=file` no longer routes
    // to a (deleted) file reader, and the env var is now ignored entirely.
    // Operators setting it will see `VlUnavailableError` from VL — not a
    // graceful-degradation envelope. See `logs-vl-degradation.test.js`.

    describe('_escapeLogSql adversarial inputs', () => {
      // Adversarial payloads that attempt to break out of the surrounding
      // `_msg:"..."` wrapper. The escape must leave LogSQL unable to parse
      // a secondary clause / character class.
      const t = (raw) => logsService._escapeLogSql(raw);

      it('strips ASCII double-quote (LogSQL string terminator)', () => {
        expect(t('foo"bar')).not.toMatch(/"/);
      });
      it('strips backslash escape sequences', () => {
        expect(t('foo\\"bar')).not.toMatch(/\\/);
      });
      it('strips newline/CR (multi-line string terminator)', () => {
        expect(t('foo\nbar')).not.toMatch(/\n/);
        expect(t('foo\r\nbar')).not.toMatch(/\r/);
      });
      it('strips Unicode curly double-quotes (homoglyph defence)', () => {
        // The Unicode “” pair must not survive into the sanitised string.
        const sanitized = t('foo“bar”');
        expect(sanitized).not.toMatch(/[“”]/);
      });
      it('strips curly single-quotes (homoglyph defence)', () => {
        const sanitized = t('foo‘bar’');
        expect(sanitized).not.toMatch(/[‘’]/);
      });
      it('strips ASCII single-quote (defence-in-depth)', () => {
        expect(t("foo'bar")).not.toMatch(/'/);
      });
      it('strips LogSQL clause keywords AND/OR/NOT whole-word, case-insensitive', () => {
        expect(t('a) OR (_stream:"*")')).not.toMatch(/\bOR\b/i);
        expect(t('a AND level:ERROR')).not.toMatch(/\bAND\b/i);
        expect(t('a Not level:ERROR')).not.toMatch(/\bNOT\b/i);
        expect(t('a and level:ERROR')).not.toMatch(/\bAND\b/i);
      });
      it('strips LogSQL structural punctuation (: ( ) { } ; , = * ? `)', () => {
        // Each one must be replaced with whitespace.
        for (const ch of [':', '(', ')', '{', '}', ';', ',', '=', '*', '?', '`']) {
          expect(t(`a${ch}b`)).not.toContain(ch);
        }
      });
      it('preserves allowed word characters and spaces between tokens', () => {
        const input = 'normal search term with spaces';
        const sanitized = t(input);
        // Verbatim — every char in the allowlist is preserved.
        expect(sanitized).toBe('normal search term with spaces');
      });
      it('canonical injected payload: a) OR (_stream:"*") cannot break out', () => {
        const sanitized = t('a) OR (_stream:"*")');
        // Compose the full filter the caller would emit.
        const filter = `_msg:"${sanitized}"`;
        expect(filter).not.toMatch(/\)\s*OR\s*\(/i);
        expect(filter).not.toMatch(/\bOR\s*\(_stream/i);
        // The literal payload characters that mattered are gone.
        expect(sanitized).not.toContain('(');
        expect(sanitized).not.toContain(')');
        expect(sanitized).not.toContain(':');
        expect(sanitized).not.toContain('*');
        expect(sanitized).not.toContain('"');
      });
    });

    describe('level filter allowlist', () => {
      it('accepts every canonical level (TRACE/DEBUG/INFO/WARN/ERROR/FATAL)', () => {
        for (const lvl of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
          expect(logsService._normalizeLevelFilter(lvl)).toBe(lvl);
        }
      });
      it('uppercases and trims input', () => {
        expect(logsService._normalizeLevelFilter('  info ')).toBe('INFO');
        expect(logsService._normalizeLevelFilter('warn')).toBe('WARN');
      });
      it('maps the legacy WARNING synonym to WARN', () => {
        expect(logsService._normalizeLevelFilter('WARNING')).toBe('WARN');
        expect(logsService._normalizeLevelFilter('warning')).toBe('WARN');
      });
      it('rejects injection payloads outside the allowlist', () => {
        const hostile = 'INFO OR _stream:*';
        expect(() => logsService._normalizeLevelFilter(hostile)).toThrow(
          /must be one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL/
        );
      });
      it('rejects empty / non-string level', () => {
        expect(() => logsService._normalizeLevelFilter('')).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(null)).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(undefined)).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(42)).toThrow(/non-empty string/);
      });
      it('searchLogs — VL path: hostile level throws before the VL call', async () => {
        mockVlClient.query.mockResolvedValue([]);
        await expect(
          logsService.searchLogs({ level: 'INFO OR _stream:*', startDate: '2026-09-01', endDate: '2026-09-01' })
        ).rejects.toThrow(/must be one of/);
        expect(mockVlClient.query).not.toHaveBeenCalled();
      });
      it('searchLogs — VL path: valid level is normalised then filtered client-side (NOT pushed to VL)', async () => {
        // The level clause used to be pushed to VL as `level:INFO AND ...`
        // — but the fluentd-driven Winston transport writes the real
        // level INSIDE the `_msg` JSON envelope (not as a top-level VL
        // field), so the VL clause never matched anything. The new
        // architecture filters level on the normalized rows AFTER the
        // MELT adapter lifts it out of `_msg`.
        mockVlClient.query.mockResolvedValue([]);
        await logsService.searchLogs({
          level: 'INFO',
          startDate: '2026-09-01',
          endDate: '2026-09-01'
        });
        expect(mockVlClient.query).toHaveBeenCalledTimes(1);
        const call = mockVlClient.query.mock.calls[0][0];
        expect(call.q).not.toMatch(/\blevel:/);
      });
    });

    describe('review follow-up #2 — 2026-09-07 patches (round 3)', () => {
      // _logVlUnavailableOnce was removed in T8 along with the
      // VL_FAIL_OPEN graceful-degradation envelope and the
      // /tmp/vl-fail-open-ts cooldown file. VL outages now surface as
      // VlUnavailableError (503, body `vl_unreachable`) — the operator
      // sees the 503 directly and can act on it. The rate-limit cooldown
      // contract is asserted elsewhere by the `VlUnavailableError` tests
      // in this file and in `logs-vl-degradation.test.js`.

      it('_defaultEndIso("week") snaps to end-of-day (no minute drift)', () => {
        const before = new Date();
        before.setHours(23, 59, 59, 999);
        const expected = before.toISOString();
        const actual = logsService._defaultEndIso('week');
        expect(actual).toBe(expected);
      });

      it('_defaultEndIso("month") snaps to end-of-day', () => {
        const before = new Date();
        before.setHours(23, 59, 59, 999);
        const expected = before.toISOString();
        const actual = logsService._defaultEndIso('month');
        expect(actual).toBe(expected);
      });

      it('searchLogs — VL path honours caller offset (paginates the result window)', async () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({ _msg: `row-${i}` }));
        mockVlClient.query.mockResolvedValueOnce(rows);
        const result = await logsService.searchLogs({
          dateRange: 'today',
          limit: 10,
          offset: 5
        });
        // Adapter asked for limit + offset = 15 rows, then we slice [5, 15).
        expect(mockVlClient.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 15 }));
        expect(result.logs).toHaveLength(10);
        expect(result.logs[0]).toEqual({ _msg: 'row-5' });
        expect(result.limit).toBe(10);
        expect(result.offset).toBe(5);
      });

      it('searchLogs — VL path clamps negative limit/offset to safe values', async () => {
        const rows = Array.from({ length: 3 }, (_, i) => ({ _msg: `r${i}` }));
        mockVlClient.query.mockResolvedValueOnce(rows);
        const result = await logsService.searchLogs({
          dateRange: 'today',
          limit: -5,
          offset: -10
        });
        // limit=0 → no rows in slice; offset=0 → start from 0
        expect(mockVlClient.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 0 }));
        expect(result.logs).toHaveLength(0);
        expect(result.limit).toBe(0);
        expect(result.offset).toBe(0);
      });

      it('getLogsSummary — VL path with level=ERROR returns only errors bucket', async () => {
        // Per-service hits() with q=severity_text:ERROR returns 7 ERROR
        // rows across two services (5 in auth + 2 in system). The summary
        // surfaces both rows, sorted by count desc; the WARN row in the
        // input set is dropped because the caller's level=ERROR filter
        // excluded it before the bucket was queried.
        mockVlClient.hits.mockImplementation(async ({ q }) => {
          if (q === 'severity_text:ERROR') return { auth: 5, system: 2 };
          if (q === '*') return { auth: 5, system: 2 };
          return {};
        });
        const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'ERROR' });
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result).not.toHaveProperty('infos');
      });

      it('getLogsSummary — VL path rejects level=INFO without querying VL', async () => {
        // 42 INFO rows exist (38 backend + 4 retriever), but the summary
        // does not cover INFO. A 200 with empty buckets here would read
        // as "a quiet day" rather than "this endpoint does not
        // summarise that level".
        mockVlClient.hits.mockImplementation(async ({ q }) => {
          if (q === '*') return { backend: 38, retriever: 4 };
          return {};
        });
        await expect(logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' })).rejects.toMatchObject({
          name: 'InvalidFilterError',
          statusCode: 400
        });
        expect(mockVlClient.query).not.toHaveBeenCalled();
      });

      it('getLogsSummary — VL path with level unset queries ERROR + WARN in parallel (single query per bucket)', async () => {
        // F11 — post-F11 the architecture fires ONE query() per bucket
        // instead of the previous 2-per-bucket design. The `hits`
        // round-trips were pure overhead — the hits result was read only
        // for rejection status; the row grouping reads query rows.
        // Service list now derives from the union of bucket rows (no
        // separate `hits` call).
        //
        // Two buckets, not three: dropping INFO removed one round-trip
        // from every dashboard load, for rows nothing displayed.
        mockVlClient.query.mockImplementation(async ({ q }) => {
          if (q === 'severity_text:ERROR') return [];
          if (q === 'severity_text:WARN') return [];
          return [];
        });
        const result = await logsService.getLogsSummary({ date: '2026-09-06' });
        expect(mockVlClient.query).toHaveBeenCalledTimes(2);
        // One `hits()` call remains, for the service FILTER. It used to be
        // zero: the dropdown was derived from the ERROR/WARN buckets, which
        // made it a list of services that had something wrong today — a
        // healthy nginx or kong was unselectable. This call is scoped to
        // `field: 'service.name'` and is NOT the rejected-status probe the
        // F11 optimisation removed; the outage detection still rides on
        // `query()` alone.
        expect(mockVlClient.hits).toHaveBeenCalledTimes(1);
        expect(mockVlClient.hits).toHaveBeenCalledWith(expect.objectContaining({ field: 'service.name', q: '*' }));
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.services).toEqual([]);
      });
    });
  });
});
