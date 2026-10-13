'use strict';

// Regression tests for the round-7 review pass on the VictoriaLogs
// single-channel logs service.
//
// Each block below pins a defect that shipped green:
//
//   - the service dropdown matched zero rows for every hyphenated
//     service name, because `_escapeLogSql` stripped `-`;
//   - `?level=Garbage` and `?level=ALL` returned a 200 with an empty
//     page instead of rejecting the filter;
//   - `getLogsSummary({level:'WARNING'})` disabled all three buckets and
//     answered with an empty-but-successful response;
//   - the per-service roll-up counted distinct message heads instead of
//     log volume;
//   - `searchLogs` derived its window through a local→UTC date round
//     trip that disagreed with `getLogsInRange` off UTC.

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

let logsService;
let LogsService;
let mockVlClient;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockVlClient = {
    query: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    hits: jest.fn().mockResolvedValue({})
  };
  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    LogsService = logsService.LogsService;
    logsService.initialized = false;
    logsService.setVictoriaLogsClient(mockVlClient);
  });
});

describe('service filter keeps hyphenated OTel service names intact', () => {
  it('emits the service name verbatim into the LogSQL clause', async () => {
    await logsService.getLogsInRange({ service: 'genieai-chatqna' });

    expect(mockVlClient.query).toHaveBeenCalledTimes(1);
    expect(mockVlClient.query.mock.calls[0][0].q).toBe('service.name:"genieai-chatqna"');
  });

  it.each([['genieai-chatqna'], ['document-repository'], ['otel-collector'], ['genieai-el-salvador_dataprep']])(
    'preserves hyphens and underscores in %s',
    async (service) => {
      await logsService.getLogsInRange({ service });

      expect(mockVlClient.query.mock.calls[0][0].q).toBe(`service.name:"${service}"`);
    }
  );

  it('still neutralises a leading hyphen run so the unquoted wildcard site cannot read it as NOT', () => {
    const escaped = logsService._escapeLogSql('-negated');
    expect(escaped.trim()).toBe('negated');
  });

  it('collapses an all-hyphen term to blank so the caller skips the term filter', () => {
    expect(logsService._escapeLogSql('---').trim()).toBe('');
  });

  it('keeps stripping the clause keywords that would inject a second filter', () => {
    expect(logsService._escapeLogSql('a AND _stream:*')).not.toMatch(/AND/i);
  });

  it('strips a hyphen that opens a token, which LogsQL reads as NOT', async () => {
    // In LogsQL a hyphen opening a token is the NOT operator, so one
    // surviving here would change the filter's meaning. The
    // `*<term>*` call site emits `*foo -bar*`, which VictoriaLogs
    // rejects outright (400, "missing ending '*'") — surfacing as a
    // 500, since a 400 is not classified as an outage.
    // Word-joining hyphens must survive.
    for (const term of ['foo -bar', 'genieai - restarted', '-negated', 'a - b']) {
      expect(logsService._escapeLogSql(term)).not.toMatch(/(^|\s)-/);
    }
    expect(logsService._escapeLogSql('genieai-chatqna')).toBe('genieai-chatqna');
    expect(logsService._escapeLogSql('document-repository')).toBe('document-repository');
  });

  it('quotes a multi-word free-text term so the wildcard cannot swallow it', async () => {
    // Verified against a live VictoriaLogs: `_msg:*foo bar*` is a 400
    // ("missing ending '*'"), which surfaced as an unexplained 500. Any
    // search term containing a space was affected.
    await logsService.searchLogs({ term: 'pool exhausted' });
    expect(mockVlClient.query.mock.calls[0][0].q).toBe('_msg:*"pool exhausted"*');

    mockVlClient.query.mockClear();
    await logsService.searchLogs({ term: 'foo -bar' });
    expect(mockVlClient.query.mock.calls[0][0].q).toBe('_msg:*"foo bar"*');
  });

  it('leaves a single-word term unquoted', async () => {
    await logsService.searchLogs({ term: 'timeout' });
    expect(mockVlClient.query.mock.calls[0][0].q).toBe('_msg:*timeout*');
  });

  // A filter that escapes to nothing is not "no filter" — it is a filter
  // the operator cannot see. Two earlier shapes of this test: building
  // `service.name:" "` (matches nothing, reports success) and then
  // dropping the clause (matches EVERYTHING, reports a huge total). The
  // only honest answer is to say the filter is meaningless.
  it.each([['-'], ['---'], ['***'], ['???'], ['- - -']])(
    'rejects the degenerate service filter %j with a 400 instead of quietly widening the query',
    async (svc) => {
      await expect(logsService.getLogsInRange({ service: svc })).rejects.toMatchObject({
        name: 'InvalidFilterError',
        statusCode: 400,
        body: { error: 'invalid_filter', message: expect.stringContaining('no searchable characters') }
      });
      expect(mockVlClient.query).not.toHaveBeenCalled();
    }
  );

  it('applies the same rule in searchLogs', async () => {
    await expect(logsService.searchLogs({ term: 'x', service: '***' })).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400
    });
  });

  // A value that is empty or whitespace is an ABSENT filter, not a
  // degenerate one — same rule as `?q=`, and the reason `service=all`
  // works as "no filter" in the UI dropdown.
  it.each([['all'], [''], ['   '], [undefined], [null]])(
    'still treats %j as an absent filter rather than an error',
    async (svc) => {
      await logsService.getLogsInRange({ service: svc, dateRange: 'today' });
      expect(mockVlClient.query.mock.calls[0][0].q).toBe('*');
    }
  );
});

describe('module exports', () => {
  it('exports InvalidFilterError so route-level tests can assert on the type', () => {
    const { InvalidFilterError, VlUnavailableError } = require('../../services/logs-service');
    expect(typeof InvalidFilterError).toBe('function');
    expect(typeof VlUnavailableError).toBe('function');
  });
});

describe('level filter rejects unknown values instead of returning an empty page', () => {
  it('throws a typed 400 for a level outside the allowlist', async () => {
    await expect(logsService.getLogsInRange({ level: 'Garbage' })).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400,
      body: { error: 'invalid_filter' }
    });
  });

  it('does not query VL when the level is invalid', async () => {
    await expect(logsService.getLogsInRange({ level: 'Garbage' })).rejects.toThrow();
    expect(mockVlClient.query).not.toHaveBeenCalled();
  });

  it('treats the ALL sentinel case-insensitively as "no filter"', async () => {
    await logsService.getLogsInRange({ level: 'ALL' });

    expect(mockVlClient.query).toHaveBeenCalledTimes(1);
    expect(mockVlClient.query.mock.calls[0][0].q).toBe('*');
  });

  it('accepts lower-case input and up-cases it into the clause', async () => {
    await logsService.getLogsInRange({ level: 'error' });

    expect(mockVlClient.query.mock.calls[0][0].q).toBe('severity_text:"ERROR"');
  });

  it('maps the legacy WARNING synonym onto WARN', async () => {
    await logsService.getLogsInRange({ level: 'WARNING' });

    expect(mockVlClient.query.mock.calls[0][0].q).toBe('severity_text:"WARN"');
  });
});

describe('getLogsSummary honours the level filter', () => {
  const summaryRow = (service) => ({
    _msg: '{"level":"error","message":"[DB_CONNECTION] something"}',
    'service.name': service
  });

  it('queries the WARN bucket for the legacy WARNING synonym', async () => {
    mockVlClient.query.mockResolvedValue([summaryRow('backend', 1)]);

    const result = await logsService.getLogsSummary({ date: '2026-09-01', level: 'WARNING' });

    const clauses = mockVlClient.query.mock.calls.map((c) => c[0].q);
    // WARN + WARNING alias — the OTel collector's stamp_log_metadata
    // transform preserves Python's `WARNING` (capitalised) as
    // severity_text=WARNING. Backend normalises to WARN at the search
    // boundary; the summary tile OR-joins both so a Python WARN row
    // isn't silently dropped from the bucket count.
    expect(clauses).toEqual(['severity_text:WARN OR severity_text:WARNING']);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('never answers a bucketable level with every bucket skipped', async () => {
    mockVlClient.query.mockResolvedValue([]);

    for (const level of ['WARNING', 'FATAL']) {
      mockVlClient.query.mockClear();
      await logsService.getLogsSummary({ date: '2026-09-01', level });
      expect(mockVlClient.query.mock.calls.length).toBeGreaterThan(0);
    }
  });

  it('folds FATAL into the error bucket', async () => {
    mockVlClient.query.mockResolvedValue([]);

    await logsService.getLogsSummary({ date: '2026-09-01', level: 'FATAL' });
    // FATAL → error bucket for the response shape, but the VL query
    // must catch BOTH severities: Python's logging.fatal() + the OTel
    // collector's stamp_log_metadata transform stamp severity_text
    // = FATAL (NOT ERROR). Pre-fix this returned 0 rows for any day
    // with FATAL-only traffic.
    expect(mockVlClient.query.mock.calls.map((c) => c[0].q)).toEqual(['severity_text:ERROR OR severity_text:FATAL']);
  });

  it('rejects a level that has no bucket instead of returning an empty summary', async () => {
    // The summary covers ERROR and WARN only. `level=INFO` used to skip
    // every query and answer 200 with nothing, which reads as "a quiet
    // day" rather than "this endpoint does not summarise that level".
    for (const level of ['INFO', 'DEBUG', 'TRACE']) {
      mockVlClient.query.mockClear();
      await expect(logsService.getLogsSummary({ date: '2026-09-01', level })).rejects.toMatchObject({
        name: 'InvalidFilterError',
        statusCode: 400
      });
      expect(mockVlClient.query).not.toHaveBeenCalled();
    }
  });

  it('does not query the INFO bucket at all', async () => {
    mockVlClient.query.mockResolvedValue([]);

    const result = await logsService.getLogsSummary({ date: '2026-09-01' });

    const clauses = mockVlClient.query.mock.calls.map((c) => c[0].q);
    // Both buckets query with their OR-clause aliases (WARN↔WARNING,
    // ERROR↔FATAL) so a Python fleet producing WARNING/FATAL lands in
    // the same buckets as the Node fleet's WARN/ERROR.
    expect(clauses.sort()).toEqual([
      'severity_text:ERROR OR severity_text:FATAL',
      'severity_text:WARN OR severity_text:WARNING'
    ]);
    expect(result).not.toHaveProperty('infos');
  });

  it('raises a 503 when a single-level request is the only thing running and it fails', async () => {
    // A skipped bucket resolves to a `degraded: false` stand-in, so
    // testing "all buckets degraded" meant a `level=ERROR` request could
    // never be recognised as an outage — a total VL outage answered 200
    // with empty arrays whenever the caller filtered to one level.
    const outage = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    mockVlClient.query.mockRejectedValue(outage);

    await expect(logsService.getLogsSummary({ date: '2026-09-01', level: 'ERROR' })).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
    await expect(logsService.getLogsSummary({ date: '2026-09-01', level: 'WARN' })).rejects.toMatchObject({
      statusCode: 503
    });
    // No level: both buckets run, both fail — same 503.
    await expect(logsService.getLogsSummary({ date: '2026-09-01' })).rejects.toMatchObject({
      statusCode: 503
    });
  });

  it('still returns degraded:true 200 when only one of two buckets fails', async () => {
    mockVlClient.query.mockImplementation(({ q }) =>
      q.includes('ERROR')
        ? Promise.reject(Object.assign(new Error('boom'), { response: { status: 500 } }))
        : Promise.resolve([])
    );

    const result = await logsService.getLogsSummary({ date: '2026-09-01' });

    expect(result.degraded).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unknown level with the same typed 400 as the list endpoint', async () => {
    await expect(logsService.getLogsSummary({ date: '2026-09-01', level: 'Garbage' })).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400
    });
  });
});

describe('per-service roll-up counts log volume, not distinct message heads', () => {
  const row = (service, head) => ({
    _msg: JSON.stringify({ level: 'error', message: head }),
    'service.name': service
  });

  it('reports the hit count of a service that repeats one message head', async () => {
    // Three log lines, one distinct head → the bucket groups them into a
    // single row carrying count=3. A `+1`-per-row roll-up would report 1.
    mockVlClient.query.mockImplementation(({ q }) =>
      Promise.resolve(
        q.includes('ERROR')
          ? [
              row('backend', '[DB_CONNECTION] pool exhausted'),
              row('backend', '[DB_CONNECTION] pool exhausted'),
              row('backend', '[DB_CONNECTION] pool exhausted')
            ]
          : []
      )
    );

    const result = await logsService.getLogsSummary({ date: '2026-09-01' });

    const backend = result.services.find((s) => s.name === 'backend');
    expect(backend).toBeDefined();
    expect(backend.count).toBe(3);
  });

  it('adds the counts of several distinct heads for the same service', async () => {
    // Two heads × 3 and 5 lines → 8, not 2.
    mockVlClient.query.mockImplementation(({ q }) => {
      if (!q.includes('ERROR')) return Promise.resolve([]);
      return Promise.resolve([
        ...Array.from({ length: 3 }, () => row('backend', '[DB_CONNECTION] pool exhausted')),
        ...Array.from({ length: 5 }, () => row('backend', '[AUTH] token rejected'))
      ]);
    });

    const result = await logsService.getLogsSummary({ date: '2026-09-01' });

    const backend = result.services.find((s) => s.name === 'backend');
    expect(backend.count).toBe(8);
  });

  it('orders services by volume, not by how many message heads they emit', async () => {
    // auth has more distinct heads (3) but fewer lines (3); backend has
    // one head and 6 lines. Ordering by volume puts backend first —
    // ordering by row count reversed it.
    mockVlClient.query.mockImplementation(({ q }) => {
      if (!q.includes('ERROR')) return Promise.resolve([]);
      return Promise.resolve([
        ...Array.from({ length: 6 }, () => row('backend', '[DB_CONNECTION] pool exhausted')),
        row('auth', '[AUTH] a'),
        row('auth', '[AUTH] b'),
        row('auth', '[AUTH] c')
      ]);
    });

    const result = await logsService.getLogsSummary({ date: '2026-09-01' });

    expect(result.services[0].name).toBe('backend');
    expect(result.services[0].count).toBe(6);
  });
});

describe('searchLogs and getLogsInRange agree on the window', () => {
  it('derives the same start instant for the same named range', async () => {
    await logsService.getLogsInRange({ dateRange: 'today' });
    const listStart = mockVlClient.query.mock.calls[0][0].start;

    mockVlClient.query.mockClear();
    await logsService.searchLogs({ dateRange: 'today' });
    const searchStart = mockVlClient.query.mock.calls[0][0].start;

    expect(searchStart).toBe(listStart);
  });

  it('derives the same end instant for the same named range', async () => {
    await logsService.getLogsInRange({ dateRange: 'yesterday' });
    const listEnd = mockVlClient.query.mock.calls[0][0].end;

    mockVlClient.query.mockClear();
    await logsService.searchLogs({ dateRange: 'yesterday' });
    const searchEnd = mockVlClient.query.mock.calls[0][0].end;

    expect(searchEnd).toBe(listEnd);
  });

  it('keeps the local calendar day rather than shifting to the UTC date', async () => {
    await logsService.searchLogs({ dateRange: 'today' });
    const { start } = mockVlClient.query.mock.calls[0][0];

    const startLocal = new Date(start);
    expect(startLocal.getHours()).toBe(0);
    expect(startLocal.getMinutes()).toBe(0);
  });

  it('honours an explicit custom range', async () => {
    await logsService.searchLogs({ startDate: '2026-01-01', endDate: '2026-01-02' });

    const { start, end } = mockVlClient.query.mock.calls[0][0];
    expect(start).toBe('2026-01-01T00:00:00.000Z');
    expect(end).toBe('2026-01-02T23:59:59.999Z');
  });

  it.each([
    ['getLogsInRange', (svc) => svc.getLogsInRange({ dateRange: 'custom' })],
    ['searchLogs', (svc) => svc.searchLogs({ dateRange: 'custom' })]
  ])('rejects %s with dateRange=custom and no bounds as a 400, not a 500', async (_name, call) => {
    await expect(call(logsService)).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400,
      body: { error: 'invalid_filter' }
    });
    expect(mockVlClient.query).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised dateRange as a 400', async () => {
    await expect(logsService.getLogsInRange({ dateRange: 'fortnight' })).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400
    });
  });
});

// ---------------------------------------------------------------------------
// Curly-quote LogSQL breakout
// ---------------------------------------------------------------------------
// The homoglyph pass used to MAP `“”` → `"`, which reintroduced the exact
// byte the character-strip pass had just removed. `abc“def` therefore built
// `service.name:"abc"def"` — a LogSQL parse error (400) for any text pasted
// from a word processor or a PDF. The step's own comment claimed it made a
// Unicode-only payload unable to break out of the quotes; it manufactured
// the breakout instead.
describe('LogSQL quote-breakout via Unicode homoglyphs', () => {
  const cases = [
    ['left double curly quote', 'abc“def'],
    ['right double curly quote', 'abc”def'],
    ['left single curly quote', 'abc‘def'],
    ['right single curly quote', 'abc’def'],
    ['quote surrounded by words', 'foo“bar”baz'],
    ['a lone curly quote', '“'],
    ['JSON pasted from a doc', '{“level”:“ERROR”}']
  ];

  it.each(cases)('%s leaves no quote in the escaped value', (_label, input) => {
    const escaped = logsService._escapeLogSql(input);
    expect(escaped).not.toMatch(/["']/);
  });

  it.each(cases)('%s builds a double-quoted clause that stays balanced', (_label, input) => {
    const escaped = logsService._escapeLogSql(input);
    const clause = `service.name:"${escaped}"`;
    // Exactly one opening and one closing quote — the ones we added.
    expect(clause.split('"').length - 1).toBe(2);
  });

  it('still preserves the hyphenated service names the dropdown produces', () => {
    for (const name of ['genieai-chatqna', 'document-repository', 'otel-collector']) {
      expect(logsService._escapeLogSql(name)).toBe(name);
    }
  });

  it('leaves an ordinary multi-word term intact', () => {
    expect(logsService._escapeLogSql('pool exhausted')).toBe('pool exhausted');
  });
});

// ---------------------------------------------------------------------------
// VictoriaLogs 4xx classification
// ---------------------------------------------------------------------------
// VictoriaLogs answers a LogSQL expression it cannot parse with 400 and a
// message naming the offending fragment. `_isVlUnavailable` only matches
// connection codes and 5xx, so a 400 fell through with no `.statusCode`
// and the global handler rendered a bare 500 — the exact failure a
// multi-word search term produced before that symptom was patched at one
// call site instead of in the classifier.
describe('VictoriaLogs 4xx is a filter error, not an outage', () => {
  const vlBadRequest = (status, data) => {
    const err = new Error('Request failed with status code ' + status);
    err.response = { status, data };
    return err;
  };

  beforeEach(() => {
    mockVlClient.query.mockRejectedValueOnce(
      vlBadRequest(400, 'cannot parse `query` arg: missing ending \'*\' in the *"foo bar"* filter')
    );
  });

  it.each([
    ['getLogsInRange', (svc) => svc.getLogsInRange({ dateRange: 'today' })],
    ['searchLogs', (svc) => svc.searchLogs({ dateRange: 'today' })]
  ])('%s surfaces a VL parse error as a 400 carrying VL’s own message', async (_name, call) => {
    await expect(call(logsService)).rejects.toMatchObject({
      name: 'InvalidFilterError',
      statusCode: 400,
      body: { error: 'invalid_filter' }
    });
  });

  it('carries the VL text, so the operator sees which filter to fix', async () => {
    await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      body: { message: expect.stringContaining('cannot parse `query` arg') }
    });
  });

  it('reads the message from a JSON error body too', () => {
    const err = vlBadRequest(400, { error: 'cannot parse `query` arg: unexpected token' });
    expect(logsService.constructor._vlParseMessage(err)).toContain('unexpected token');
  });

  it('still answers with a message when VL returns an unparseable body', () => {
    expect(LogsService._vlParseMessage(vlBadRequest(400, ''))).toMatch(/VictoriaLogs rejected the query/);
  });

  it('does not reclassify 401/403 — those are credential faults, not bad filters', () => {
    for (const status of [401, 403]) {
      expect(LogsService._isVlBadRequest(vlBadRequest(status, 'nope'))).toBe(false);
    }
  });

  it('does not reclassify a 5xx — that stays a 503 outage', () => {
    expect(LogsService._isVlBadRequest(vlBadRequest(503, 'unavailable'))).toBe(false);
  });

  // A 404 is the endpoint being wrong, not the query. Reporting it as
  // "check the level and service filters" sent the operator to debug a
  // dropdown that had nothing to do with it.
  it('routes a 404 to an endpoint fault, not to an invalid filter', async () => {
    mockVlClient.query.mockReset();
    mockVlClient.query.mockRejectedValueOnce(vlBadRequest(404, '404 page not found'));
    await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      name: 'VlEndpointError',
      statusCode: 502,
      body: { error: 'vl_endpoint', message: expect.stringContaining('VICTORIALOGS_URL') }
    });
  });

  it.each([[404], [405], [410], [418]])('treats VL %s as an endpoint fault', async (status) => {
    mockVlClient.query.mockReset();
    mockVlClient.query.mockRejectedValueOnce(vlBadRequest(status, 'nope'));
    await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      name: 'VlEndpointError',
      statusCode: 502
    });
  });

  it('routes a 429 to the outage family — capacity, retry, not a bad filter', async () => {
    mockVlClient.query.mockReset();
    mockVlClient.query.mockRejectedValueOnce(vlBadRequest(429, 'slow down'));
    await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503,
      body: { error: 'vl_unreachable', message: expect.stringContaining('rate-limiting') }
    });
  });

  it('still leaves 401/403 as a credential fault, distinct from all three', async () => {
    mockVlClient.query.mockReset();
    for (const status of [401, 403]) {
      mockVlClient.query.mockRejectedValueOnce(vlBadRequest(status, 'denied'));
      const err = await logsService.searchLogs({ dateRange: 'today' }).catch((e) => e);
      expect(err.name).not.toBe('InvalidFilterError');
      expect(err.name).not.toBe('VlEndpointError');
      expect(err.name).not.toBe('VlUnavailableError');
    }
  });

  it('exports VlEndpointError so route-level tests can assert the type', () => {
    expect(typeof require('../../services/logs-service').VlEndpointError).toBe('function');
  });

  it('a 500 on the query path is still VlUnavailableError, not InvalidFilterError', async () => {
    // Drop the 400 the suite-level beforeEach queued, so this test's
    // rejection is the one the call actually sees.
    mockVlClient.query.mockReset();
    const err = new Error('upstream');
    err.response = { status: 500, data: 'boom' };
    mockVlClient.query.mockRejectedValueOnce(err);
    await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });
});

// ---------------------------------------------------------------------------
// A leading timestamp must not become the event category
// ---------------------------------------------------------------------------
// `extractType` falls back to `message.split(':')[0]`. Syslog-shaped
// lines — ClamAV, uvicorn, syslog daemons — start with
// `Mon Sep 28 14:03:18 2026 -> …`, so the first `:` falls INSIDE the
// clock and the category rendered in the admin panel was literally
// "Mon Sep 28 14". A timestamp is not an error type.
describe('summary categories ignore a leading timestamp', () => {
  const rowsFor = (messages) =>
    messages.map((message, i) => ({
      message,
      service: 'document-repository',
      level: 'ERROR',
      fields: {},
      timestamp: `2026-09-28T10:0${i}:00.000Z`
    }));

  const firstTypeFor = async (message) => {
    mockVlClient.query.mockResolvedValueOnce(rowsFor([message]));
    mockVlClient.hits.mockResolvedValueOnce({});
    const summary = await logsService.getLogsSummary({ date: '2026-09-28' });
    return summary.errors[0].type;
  };

  // One case per timestamp SHAPE, not per regex. The rule anchors on the
  // clock rather than enumerating formats, so the point of these is to
  // fail if someone swaps it back for a pattern list.
  it.each([
    ['syslog EN', "Mon Sep 28 14:03:18 2026 -> Can't download daily.cvd", "Can't download daily.cvd"],
    ['syslog localise', 'lun. 28 sept. 14:03:18 2026 -> Telechargement impossible', 'Telechargement impossible'],
    ['ISO avec decalage +', '2026-09-28T14:03:18.123456789+02:00 ERROR upstream refuse', 'ERROR upstream refuse'],
    ['ISO avec decalage -', '2026-09-28T14:03:18.123456789-05:30 ERROR refused', 'ERROR refused'],
    ['ISO Z', '2026-09-28T14:03:18.123456789Z ERROR upstream refuse', 'ERROR upstream refuse'],
    ['epoch', '1759068198 ERROR upstream refuse', 'ERROR upstream refuse'],
    ['barres obliques', '2026/09/28 14:03:18 ERROR upstream refuse', 'ERROR upstream refuse'],
    ['docker stdout', '2026-09-28T14:03:18.123Z stdout F hello world', 'stdout F hello world'],
    ['date-heure espace', '2026-09-28 14:03:18 [DB_TEST] Connection test failed', '[DB_TEST] Connection test failed']
  ])('%s : la categorie n est pas un fragment de timestamp', async (_label, message, expected) => {
    expect(await firstTypeFor(message)).toBe(expected);
  });

  // Regression: the first cut of the clock-anchored rule gated on the
  // clock's POSITION alone, so a message that merely mentioned a time
  // lost its real category — every `… at HH:MM:SS failed` collapsed into
  // one bucket named `failed`. The rule now also requires the prefix
  // before the clock to be date-shaped.
  it.each([
    ['Job abc at 14:03:18 failed', 'Job abc at 14'],
    ['Error: retry at 9:00:00 done', 'Error'],
    ['Retry 1 1:02:03 exhausted', 'Retry 1 1'],
    ['User bob 2:30:00 deleted doc 42', 'User bob 2']
  ])('une heure citée dans le message ne devient pas la categorie : %s', async (message, expected) => {
    expect(await firstTypeFor(message)).toBe(expected);
  });

  it('ne coupe pas une heure situee plus loin dans le message', async () => {
    const type = await firstTypeFor(
      '[DB_CONNECTION] Existing connection crawl_job failed: timeout after 3s at 10:00:00'
    );
    expect(type.startsWith('[DB_CONNECTION] Existing connection')).toBe(true);
  });

  it('conserve les tags entre crochets quand il n y a pas d horodatage', async () => {
    const type = await firstTypeFor('[DB_CONNECTION] Existing connection crawl_job failed: timeout after 3s');
    expect(type.startsWith('[DB_CONNECTION] Existing connection')).toBe(true);
    expect(type).not.toContain('timeout after 3s');
  });

  it('conserve les noms de symbole', async () => {
    expect(await firstTypeFor('WeatherService.record_analytics_failed: upstream 503')).toBe(
      'WeatherService.record_analytics_failed'
    );
  });

  it('un timestamp seul ne produit jamais une categorie vide', async () => {
    const type = await firstTypeFor('2026-09-28T14:03:18.123Z');
    expect(type).toBeTruthy();
    expect(type).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
