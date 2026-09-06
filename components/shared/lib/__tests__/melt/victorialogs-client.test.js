// components/shared/lib/__tests__/melt/victorialogs-client.test.js
'use strict';

/**
 * Co-located unit test for `components/shared/lib/melt/victorialogs-client.js`
 * (Story 4.5). Pins the AD-3 normalize contract, AD-15 AccountID/ProjectID
 * tenant headers, AD-16 axios timeout + lazy health probe (3×5 s) +
 * memoization, and the edge-case behaviour documented in the spec.
 *
 * Scope:
 *  - `axios` is fully mocked via `jest.mock('axios')`. No real HTTP traffic.
 *  - Pure unit tests; no jest is installed in `components/shared/lib/node_modules`
 *    (CI gate for this code lives downstream at Story 5.8
 *    `logs-vl-contract.test.js`). Humans run this file locally for fast
 *    feedback on adapter regressions.
 *  - AD-3 row shape (8 sub-shapes), AD-15 tenant headers, AD-16 timeout
 *    + health probe, edge cases (empty / null rows, malformed _time,
 *    empty-string trace_id preserved verbatim, reserved-char escape).
 *
 * CommonJS only (C-1 / project-context.md). Uses the existing project test
 * style: 2-space indent, single quotes, mandatory semicolons, no trailing
 * commas (matches root `.prettierrc`).
 */

jest.mock('axios');

const axios = require('axios');
const { VictoriaLogsAdapter, VictoriaLogsHealthError } = require('../../melt/victorialogs-client');

// ----- helpers ---------------------------------------------------------------

/**
 * Snapshot the process.env subset this file mutates, and restore it after each
 * test so env mutations from one `describe` never leak into another.
 */
const ENV_KEYS = ['VICTORIALOGS_TENANT_ID', 'VL_QUERY_TIMEOUT_MS'];
function snapshotEnv() {
  const snap = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}
function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/**
 * Build a fresh adapter with a per-test `axios.create` mock so every test
 * sees an isolated `axios.get` history. Returns both the adapter and the
 * per-instance `get` jest.fn for assertions.
 */
function makeAdapter(options = {}) {
  const mockGet = jest.fn();
  const mockInstance = { get: mockGet };
  axios.create.mockReset();
  axios.create.mockReturnValue(mockInstance);
  const adapter = new VictoriaLogsAdapter(options);
  return { adapter, mockGet, mockInstance };
}

const baseQuery = {
  q: '_msg:""',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-02T00:00:00.000Z'
};

// ----- AD-15 — tenant identity headers --------------------------------------

describe('VictoriaLogsAdapter — AD-15 AccountID/ProjectID headers', () => {
  let envSnap;
  beforeEach(() => {
    envSnap = snapshotEnv();
    delete process.env.VICTORIALOGS_TENANT_ID;
  });
  afterEach(() => restoreEnv(envSnap));

  it('defaults to AccountID "0" / ProjectID "0" when env is unset and no override', () => {
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledTimes(1);
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://vl.local',
        headers: { AccountID: '0', ProjectID: '0' }
      })
    );
  });

  it('parses VICTORIALOGS_TENANT_ID="42:7" into AccountID "42" / ProjectID "7"', () => {
    process.env.VICTORIALOGS_TENANT_ID = '42:7';
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { AccountID: '42', ProjectID: '7' }
      })
    );
  });

  it('constructor tenantId overrides the VICTORIALOGS_TENANT_ID env value', () => {
    process.env.VICTORIALOGS_TENANT_ID = '99:99';
    makeAdapter({ baseURL: 'http://vl.local', tenantId: '42:7' });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { AccountID: '42', ProjectID: '7' }
      })
    );
  });

  it('handles a missing project-id segment in the env value', () => {
    process.env.VICTORIALOGS_TENANT_ID = '42';
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { AccountID: '42', ProjectID: '0' }
      })
    );
  });
});

// ----- AD-16 — axios timeout -------------------------------------------------

describe('VictoriaLogsAdapter — AD-16 axios timeout', () => {
  let envSnap;
  beforeEach(() => {
    envSnap = snapshotEnv();
    delete process.env.VL_QUERY_TIMEOUT_MS;
  });
  afterEach(() => restoreEnv(envSnap));

  it('defaults to 30000 ms when VL_QUERY_TIMEOUT_MS is unset', () => {
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000 }));
  });

  it('honors VL_QUERY_TIMEOUT_MS=12345 → timeout: 12345', () => {
    process.env.VL_QUERY_TIMEOUT_MS = '12345';
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 12345 }));
  });

  it('falls back to 30000 ms on a malformed VL_QUERY_TIMEOUT_MS value', () => {
    process.env.VL_QUERY_TIMEOUT_MS = 'garbage';
    makeAdapter({ baseURL: 'http://vl.local' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000 }));
  });

  it('falls back to 30000 ms when the constructor `timeout` is 0 (never 0)', () => {
    makeAdapter({ baseURL: 'http://vl.local', timeout: 0 });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000 }));
  });

  it('constructor `timeout` takes precedence over VL_QUERY_TIMEOUT_MS when > 0', () => {
    process.env.VL_QUERY_TIMEOUT_MS = '12345';
    makeAdapter({ baseURL: 'http://vl.local', timeout: 7777 });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 7777 }));
  });
});

// ----- AD-16 — lazy health probe --------------------------------------------

describe('VictoriaLogsAdapter — AD-16 lazy health probe', () => {
  it('does NOT probe on construction', () => {
    const { mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('first query() runs the probe against ${baseURL}/health with a 5 s per-attempt timeout', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    mockGet.mockResolvedValue({ data: [] });
    await adapter.query(baseQuery);

    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(1);
    expect(healthCalls[0][1]).toEqual({ timeout: 5000 });
  });

  it('retries 3×5 s on persistent failure, then throws VictoriaLogsHealthError with the last error as `cause`', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    const err1 = new Error('attempt-1-failed');
    const err2 = new Error('attempt-2-failed');
    const err3 = new Error('attempt-3-failed');
    mockGet.mockRejectedValueOnce(err1).mockRejectedValueOnce(err2).mockRejectedValueOnce(err3);

    // Single first-call: all three queued rejections are consumed; the probe
    // exhausts the budget and throws. Recovery-after-failure is covered by the
    // dedicated `it` block below — this block pins only the cause-chain shape.
    await expect(adapter.query(baseQuery)).rejects.toMatchObject({
      name: 'VictoriaLogsHealthError',
      code: 'VL_HEALTH_FAILED',
      cause: err3,
      message: expect.stringContaining('3 attempts')
    });

    // Each of the three attempts used the 5 s timeout against /health.
    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(3);
    for (const call of healthCalls) {
      expect(call[1]).toEqual({ timeout: 5000 });
    }
  });

  it('memoizes: two concurrent first-call query() invocations trigger exactly ONE probe', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    mockGet.mockResolvedValue({ data: [] });

    const p1 = adapter.query(baseQuery);
    const p2 = adapter.query(baseQuery);
    await Promise.all([p1, p2]);

    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(1);
    expect(healthCalls[0][1]).toEqual({ timeout: 5000 });
  });

  it('memoizes: a SEQUENTIAL second query() after success short-circuits (no second probe)', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    mockGet.mockResolvedValue({ data: [] });

    await adapter.query(baseQuery);
    await adapter.query(baseQuery);

    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(1);
  });

  it('after probe failure, the in-flight promise is cleared so the next query() retries', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local' });
    mockGet
      .mockRejectedValueOnce(new Error('a1'))
      .mockRejectedValueOnce(new Error('a2'))
      .mockRejectedValueOnce(new Error('a3'));

    await expect(adapter.query(baseQuery)).rejects.toBeInstanceOf(VictoriaLogsHealthError);
    const failedHealthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health').length;
    expect(failedHealthCalls).toBe(3);

    // The next first-call must NOT see the stale `true` flag and MUST retry.
    mockGet.mockResolvedValue({ data: [] });
    await adapter.query(baseQuery);

    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(4);
  });

  it('skips the probe entirely when constructed with { skipHealthProbe: true }', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local', skipHealthProbe: true });
    mockGet.mockResolvedValue({ data: [] });
    await adapter.query(baseQuery);
    const healthCalls = mockGet.mock.calls.filter((c) => c[0] === '/health');
    expect(healthCalls).toHaveLength(0);
  });
});

// ----- AD-3 — _normalizeRows 8 sub-shapes -----------------------------------

describe('VictoriaLogsAdapter — AD-3 _normalizeRows 8 sub-shapes', () => {
  function adapter() {
    return makeAdapter({ baseURL: 'http://vl.local', skipHealthProbe: true }).adapter;
  }

  it('maps a fully populated VL row to all 8 canonical sub-shapes', () => {
    const row = adapter()._normalizeRows([
      {
        _msg: 'hello world',
        _time: '2026-09-06T12:34:56.789Z',
        _stream: { service: 'genie-backend', environment: 'prod', level: 'info' },
        trace_id: 'abc123',
        user_id: 'u-42'
      }
    ])[0];

    // 1. timestamp — ISO 8601 from _time
    expect(row.timestamp).toBe('2026-09-06T12:34:56.789Z');
    // 2. message — string from _msg
    expect(row.message).toBe('hello world');
    // 3. stream — { service, environment } from _stream
    expect(row.stream).toEqual({ service: 'genie-backend', environment: 'prod' });
    // 4. fields — every ...rest key EXCEPT _msg / _stream / _time
    expect(row.fields).toEqual({ trace_id: 'abc123', user_id: 'u-42' });
    expect(Object.prototype.hasOwnProperty.call(row.fields, '_msg')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row.fields, '_stream')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row.fields, '_time')).toBe(false);
    // 5. date — UTC YYYY-MM-DD portion of _time
    expect(row.date).toBe('2026-09-06');
    // 6. time — UTC HH:MM:SS portion of _time
    expect(row.time).toBe('12:34:56');
    // 7. level — uppercase, sourced from _stream.level here
    expect(row.level).toBe('INFO');
    // 8. service — from _stream.service
    expect(row.service).toBe('genie-backend');
  });

  it('prefers fields.level over _stream.level when both are present', () => {
    const row = adapter()._normalizeRows([
      {
        _msg: 'x',
        _time: '2026-09-06T12:34:56.000Z',
        _stream: { service: 'svc', environment: 'prod', level: 'info' },
        level: 'warn'
      }
    ])[0];
    expect(row.level).toBe('WARN');
  });

  it('uppercases a lowercase _stream.level value', () => {
    const row = adapter()._normalizeRows([
      {
        _msg: 'x',
        _time: '2026-09-06T12:34:56.000Z',
        _stream: { service: 'svc', environment: 'prod', level: 'error' }
      }
    ])[0];
    expect(row.level).toBe('ERROR');
  });
});

// ----- Edge cases -----------------------------------------------------------

describe('VictoriaLogsAdapter — _normalizeRows edge cases', () => {
  function adapter() {
    return makeAdapter({ baseURL: 'http://vl.local', skipHealthProbe: true }).adapter;
  }

  it('_normalizeRows([]) returns []', () => {
    expect(adapter()._normalizeRows([])).toEqual([]);
  });

  it('_normalizeRows(null) returns []', () => {
    expect(adapter()._normalizeRows(null)).toEqual([]);
  });

  it('a row with a missing _stream falls back to service "unknown" and level "INFO"', () => {
    const row = adapter()._normalizeRows([{ _msg: 'x', _time: '2026-09-06T12:34:56.000Z' }])[0];
    expect(row.service).toBe('unknown');
    expect(row.stream.service).toBe('unknown');
    expect(row.level).toBe('INFO');
    expect(row.stream.environment).toBe('');
  });

  it('a row with _time "not-a-date" yields empty timestamp/date/time (no garbage slices)', () => {
    const row = adapter()._normalizeRows([{ _msg: 'x', _time: 'not-a-date' }])[0];
    expect(row.timestamp).toBe('');
    expect(row.date).toBe('');
    expect(row.time).toBe('');
  });

  it('an empty-string trace_id in `fields` is preserved verbatim (no auto-strip)', () => {
    const row = adapter()._normalizeRows([{ _msg: 'x', _time: '2026-09-06T12:34:56.000Z', trace_id: '' }])[0];
    expect(Object.prototype.hasOwnProperty.call(row.fields, 'trace_id')).toBe(true);
    expect(row.fields.trace_id).toBe('');
  });

  it('query() forwards `q` verbatim to axios — no double escape of reserved chars', async () => {
    const { adapter, mockGet } = makeAdapter({ baseURL: 'http://vl.local', skipHealthProbe: true });
    mockGet.mockResolvedValue({ data: [] });

    const reservedQ = '_msg:"hello: world"';
    await adapter.query({ q: reservedQ, start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' });

    expect(mockGet).toHaveBeenCalledWith('/select/logsql/query', {
      params: { q: reservedQ, start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' }
    });
    // Pin the exact string equality (no adapter-side escaping).
    const queryCall = mockGet.mock.calls.find((c) => c[0] === '/select/logsql/query');
    expect(queryCall[1].params.q).toBe(reservedQ);
  });
});
