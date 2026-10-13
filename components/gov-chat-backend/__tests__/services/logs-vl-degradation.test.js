'use strict';

// Story 5.9 — VL degradation tests, post-T8 contract:
//
// After the dead-code refactor the VL outage contract is uniform across
// every read path:
//   1. Connection-class errors (ECONNREFUSED / ENOTFOUND / ETIMEDOUT /
//      ECONNABORTED / `VictoriaLogsHealthError` / 5xx upstream response)
//      are wrapped in a typed `VlUnavailableError` carrying the
//      standard `{error: 'vl_unreachable', message}` envelope and 503
//      status.
//   2. Validation / programmer errors (TypeError, ArgumentError, …)
//      propagate unchanged — the route layer keeps its existing 400 /
//      500 semantics.
//   3. The legacy `_logVlUnavailableOnce` rate-limit helper, the
//      `VL_FAIL_OPEN` graceful-degradation envelope, and the
//      `/tmp/vl-fail-open-ts` cooldown file are all removed. Operators
//      see a clean 503 from the route layer and act on it directly.

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

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

let mockVlClient;

function mountService() {
  let service;
  jest.isolateModules(() => {
    service = require('../../services/logs-service');
    service.initialized = false;
    service.setVictoriaLogsClient(mockVlClient);
  });
  return service;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  delete process.env.VL_QUERY_TIMEOUT_MS;

  mockVlClient = {
    query: jest.fn(),
    hits: jest.fn().mockResolvedValue({})
  };

  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
});

describe('VL outage surfaces as VlUnavailableError (503, body vl_unreachable)', () => {
  const baseOpts = {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-01T23:59:59.999Z',
    limit: 100,
    offset: 0
  };

  it('getLogsInRange: ECONNREFUSED → VlUnavailableError (no degraded envelope)', async () => {
    const service = mountService();
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9428'), { code: 'ECONNREFUSED' });
    mockVlClient.query.mockRejectedValueOnce(err);

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    // Loud failure — typed VlUnavailableError with the standard envelope.
    expect(captured).toBeDefined();
    expect(captured.name).toBe('VlUnavailableError');
    expect(captured.statusCode).toBe(503);
    expect(captured.body.error).toBe('vl_unreachable');
    // Critical: no `degraded` envelope field — the failure is loud.
    expect(captured.degraded).toBeUndefined();
  });

  it('getLogsInRange: ENOTFOUND → VlUnavailableError', async () => {
    const service = mountService();
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND victorialogs'), { code: 'ENOTFOUND' });
    mockVlClient.query.mockRejectedValueOnce(err);

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeDefined();
    expect(captured.name).toBe('VlUnavailableError');
    expect(captured.statusCode).toBe(503);
    expect(captured.body.error).toBe('vl_unreachable');
  });

  it('getLogsInRange: ETIMEDOUT → VlUnavailableError', async () => {
    const service = mountService();
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.getLogsInRange(baseOpts)).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });

  it('getLogsInRange: ECONNABORTED (axios timeout) → VlUnavailableError', async () => {
    // axios raises `code: 'ECONNABORTED'` with message
    // "timeout of <ms>ms exceeded" when the request exceeds the timeout
    // budget (see axios/lib/adapters/http.js). Without the
    // ECONNABORTED branch in `_vlOrThrow` the `VL_QUERY_TIMEOUT_MS`
    // path falls through to the generic 500.
    const service = mountService();
    const err = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.getLogsInRange(baseOpts)).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });

  it('getLogsInRange: VictoriaLogsHealthError → VlUnavailableError (retry-exhausted path)', async () => {
    // The adapter raises a typed `VictoriaLogsHealthError` after exhausting
    // its retries; `_vlOrThrow` catches the name discriminator and rewraps
    // it as VlUnavailableError so the route layer sees a uniform envelope.
    const service = mountService();
    const err = Object.assign(new Error('VL health probe failed'), { name: 'VictoriaLogsHealthError' });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.getLogsInRange(baseOpts)).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503,
      body: expect.objectContaining({ error: 'vl_unreachable' })
    });
  });

  it('getLogsInRange: 5xx upstream response → VlUnavailableError', async () => {
    const service = mountService();
    const err = Object.assign(new Error('VL returned 503 Service Unavailable'), {
      response: { status: 503 }
    });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.getLogsInRange(baseOpts)).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });

  it('searchLogs: VL outage on the outer query → VlUnavailableError', async () => {
    const service = mountService();
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });

  it('getLogsSummary: outer query() outage → VlUnavailableError', async () => {
    // Post-F11 getLogsSummary fires one query() per requested bucket
    // (3 round-trips for the default level set). The per-bucket
    // .catch() inside bucketForLevel converts each query rejection
    // into `{__degraded: true}` (no rejection escapes the inner
    // function). The OUTERMOST VlUnavailableError comes from the
    // post-F11 complete-outage guard at logs-service.js:582-584:
    // when ALL 3 buckets report `degraded`, the outer block throws
    // `new VlUnavailableError()` so the route renders 503 instead
    // of 200 + empty arrays + degraded:true. The outermost
    // try/catch in getLogsSummary catches that throw via
    // `_vlOrThrow(err)` (a no-op pass-through for typed errors),
    // preserving the typed envelope to the caller.
    const service = mountService();
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    mockVlClient.query.mockRejectedValue(err);

    await expect(service.getLogsSummary({ date: '2026-09-01' })).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });

  it('debugYesterdayLogs: VL outage → VlUnavailableError (no degraded envelope)', async () => {
    const service = mountService();
    const err = Object.assign(new Error('connect ENOTFOUND victorialogs'), { code: 'ENOTFOUND' });
    mockVlClient.query.mockRejectedValueOnce(err);

    await expect(service.debugYesterdayLogs()).rejects.toMatchObject({
      name: 'VlUnavailableError',
      statusCode: 503
    });
  });
});

describe('Validation / programmer errors propagate unchanged (NOT wrapped)', () => {
  const baseOpts = {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-01T23:59:59.999Z',
    limit: 100,
    offset: 0
  };

  it('getLogsInRange: TypeError from the VL client propagates unchanged', async () => {
    // A TypeError is a programmer / contract error, not a VL outage.
    // `_vlOrThrow` re-throws it verbatim so the route layer renders
    // 500 (not the 503 vl_unreachable envelope).
    const service = mountService();
    const typeErr = new TypeError('Cannot read properties of undefined (reading "stream")');
    mockVlClient.query.mockRejectedValueOnce(typeErr);

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBe(typeErr); // same instance, NOT wrapped
    expect(captured.name).toBe('TypeError');
    const { VlUnavailableError } = require('../../services/logs-service');
    expect(captured).not.toBeInstanceOf(VlUnavailableError);
  });

  it('getLogsInRange: plain Error with no code / no 5xx response propagates unchanged', async () => {
    const service = mountService();
    const err = new Error('unexpected adapter failure');
    mockVlClient.query.mockRejectedValueOnce(err);

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBe(err);
    expect(captured.name).not.toBe('VlUnavailableError');
  });

  it('getLogsInRange: a 401/403 propagates unchanged — credential fault, not a bad filter', async () => {
    // 401/403 mean the tenant or the credentials are wrong. That is a
    // deployment fault an operator must see distinctly, so it is NOT
    // folded into the InvalidFilterError 400 that a LogSQL parse failure
    // now produces. It still must not become a 503 either.
    const service = mountService();
    const err = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    mockVlClient.query.mockRejectedValueOnce(err);

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    expect(captured).toBe(err);
    expect(captured.name).not.toBe('VlUnavailableError');
    expect(captured.name).not.toBe('InvalidFilterError');
  });

  it('getLogsInRange: a 4xx parse rejection becomes a 400 carrying the VL message', async () => {
    // A LogSQL expression VL cannot parse is a bad filter, not an outage.
    // Wrapped as InvalidFilterError so the response carries VL's own text
    // naming the offending fragment; unclassified it reached the global
    // handler with no statusCode and became a bare 500.
    const service = mountService();
    mockVlClient.query.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: 'cannot parse `query` arg: missing ending "*"' }
      })
    );

    let captured;
    try {
      await service.getLogsInRange(baseOpts);
    } catch (e) {
      captured = e;
    }
    expect(captured.name).toBe('InvalidFilterError');
    expect(captured.statusCode).toBe(400);
    expect(captured.body.message).toContain('missing ending');
  });
});
