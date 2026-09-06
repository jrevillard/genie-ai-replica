// Severity + trace_id flow coverage for the Winston → VictoriaLogs transport.
// The transport (`components/shared/lib/victorialogs-transport.js`) is a thin
// `TransportStream` that maps every Winston log record onto an OTel `LogRecord`
// emitted via `logs.getLogger(name).emit({...})`. These tests pin the contract
// that admins and SREs rely on to filter VL streams by `severity` and join VL
// rows against VictoriaTraces via `trace_id`:
//   - Winston levels are translated to the documented OTel `SeverityNumber`
//     band (error → ERROR=17..21, warn → WARN=13..17, info/http → INFO=9..13,
//     verbose/debug → DEBUG=5..9, silly → TRACE=1..5, unknown → INFO fallback).
//   - `info.trace_id` / `info.span_id` surface as attributes on the emitted
//     `LogRecord`, but the all-zero sentinels (`0000...`) are dropped to avoid
//     noise in the VL `_stream_fields` cardinality.
//   - The transport swallows errors from the OTel `logs` API (CAP-1) so a
//     down/disabled VictoriaLogs never blocks a Node service.

// Helper: clear call history ONLY on the two mocks we care about, without
// touching their default implementations. `jest.clearAllMocks()` also rewinds
// `mockGetLogger.mockImplementation` to `() => undefined` (the bare default),
// which would rewind the factory-set `() => ({ emit: mockEmit })` and make
// `logger.emit(...)` throw on `undefined` inside the transport's swallow.
// `clearMockHistory` is the per-test equivalent of the global clear that
// preserves mock implementations, which is the documented behaviour in
// jest >= 28 (`jest.clearAllMocks` resets calls+results but not
// implementations).
function clearMockHistory() {
  mockEmit.mockClear();
  mockGetLogger.mockClear();
}

const mockEmit = jest.fn();
const mockGetLogger = jest.fn(() => ({ emit: mockEmit }));

// `winston-transport` and `@opentelemetry/api-logs` live only in the backend's
// `node_modules`; the `victorialogs-transport.js` source under test is in
// `components/shared/lib/`, a sibling tree with no `node_modules` of its own.
// Provide virtual mocks so the require chain resolves cleanly.

jest.mock(
  'winston-transport',
  () => {
    const { EventEmitter } = require('events');
    class TransportStream extends EventEmitter {
      constructor(opts = {}) {
        super();
        Object.assign(this, opts);
      }
    }
    TransportStream.LegacyTransportStream = class LegacyTransportStream extends EventEmitter {};
    return TransportStream;
  },
  { virtual: true }
);

jest.mock(
  '@opentelemetry/api-logs',
  () => {
    // Use jest.requireActual to break the recursion: importing api-logs
    // here would re-route to the mock under construction. requireActual hits
    // the real on-disk module and reads SeverityNumber from the build artifact
    // (subpath varies across api-logs patch versions — the real public entry
    // re-exports the canonical enum so the test is decoupled from that
    // internal layout).
    const actual = jest.requireActual('@opentelemetry/api-logs');
    return {
      logs: { getLogger: mockGetLogger },
      SeverityNumber: actual.SeverityNumber
    };
  },
  { virtual: true }
);

const SeverityNumber = jest.requireActual('@opentelemetry/api-logs').SeverityNumber;
const { VictoriaLogsTransport } = require('../../shared/lib/victorialogs-transport');

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';
const REAL_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const REAL_SPAN_ID = '00f067aa0ba902b7';
const FIXED_TS = '2026-09-06T01:30:34.000Z';
const FIXED_TS_MS = Date.parse(FIXED_TS);

// Helpers --------------------------------------------------------------

// Drives a Winston log record through the transport synchronously and returns
// the OTel log record the transport passed to `logs.getLogger(...).emit(...)`.
function emitRecord(transport, info) {
  mockEmit.mockClear();
  transport.log(info, () => {});
  expect(mockEmit).toHaveBeenCalledTimes(1);
  return mockEmit.mock.calls[0][0];
}

function makeTransport(opts = {}) {
  return new VictoriaLogsTransport({
    enabled: true,
    service: 'genie-backend',
    loggerName: 'winston-test',
    ...opts
  });
}

function baseInfo(extra = {}) {
  return {
    timestamp: new Date(FIXED_TS),
    trace_id: REAL_TRACE_ID,
    span_id: REAL_SPAN_ID,
    ...extra
  };
}

// Tests -----------------------------------------------------------------

describe('VictoriaLogsTransport — severity mapping', () => {
  beforeEach(() => {
    // Clear only call history — NOT the default implementations of
    // mockEmit / mockGetLogger. jest.clearAllMocks() also clears
    // mockGetLogger.mockImplementation, which would rewind it to the bare
    // `() => undefined` default, making `logger.emit(...)` throw on
    // `undefined` and silently swallow the call. Clearing only the call
    // history (the actual `jest.fn` instances) keeps the factory-set
    // implementations across the test suite.
    mockEmit.mockClear();
  });

  it('maps the `error` Winston level to the SeverityNumber.ERROR band', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'error', message: 'boom' }));

    // OTel spec assigns ERROR=17..21; the SDK ships the band's lower bound (17).
    expect(record.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record.severityText).toBe('ERROR');
  });

  it('maps the `warn` Winston level to the SeverityNumber.WARN band', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'warn', message: 'careful' }));

    expect(record.severityNumber).toBe(SeverityNumber.WARN);
    expect(record.severityText).toBe('WARN');
  });

  it('maps `info` and `http` Winston levels to the SeverityNumber.INFO band', () => {
    const transport = makeTransport();

    const infoRecord = emitRecord(transport, baseInfo({ level: 'info', message: 'request handled' }));
    expect(infoRecord.severityNumber).toBe(SeverityNumber.INFO);
    expect(infoRecord.severityText).toBe('INFO');

    // `http` maps to the same SeverityNumber as `info`; severityText preserves
    // the raw level so VL consumers can distinguish winston `http` from `info`.
    const httpRecord = emitRecord(transport, baseInfo({ level: 'http', message: 'GET /api/health' }));
    expect(httpRecord.severityNumber).toBe(SeverityNumber.INFO);
    expect(httpRecord.severityText).toBe('HTTP');
  });

  it('maps `verbose` and `debug` Winston levels to the SeverityNumber.DEBUG band', () => {
    const transport = makeTransport();

    const verboseRecord = emitRecord(transport, baseInfo({ level: 'verbose', message: 'verbose detail' }));
    expect(verboseRecord.severityNumber).toBe(SeverityNumber.DEBUG);
    expect(verboseRecord.severityText).toBe('VERBOSE');

    const debugRecord = emitRecord(transport, baseInfo({ level: 'debug', message: 'debug detail' }));
    expect(debugRecord.severityNumber).toBe(SeverityNumber.DEBUG);
    expect(debugRecord.severityText).toBe('DEBUG');
  });

  it('maps the `silly` Winston level to the SeverityNumber.TRACE band', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'silly', message: 'silly chatter' }));

    expect(record.severityNumber).toBe(SeverityNumber.TRACE);
    expect(record.severityText).toBe('SILLY');
  });

  it('falls back to the SeverityNumber.INFO band when the level is unknown', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'totally-unknown', message: 'weird level' }));

    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    // severityText is derived from the raw level string (uppercased)
    expect(record.severityText).toBe('TOTALLY-UNKNOWN');
  });

  it('treats a non-string `level` as `info`', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: undefined, message: 'no level provided' }));

    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    expect(record.severityText).toBe('INFO');
  });
});

describe('VictoriaLogsTransport — trace_id and span_id flow', () => {
  beforeEach(() => {
    clearMockHistory();
  });

  it('propagates a real trace_id / span_id pair as OTel log attributes', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'info', message: 'routing chat request' }));

    expect(record.attributes).toEqual(
      expect.objectContaining({
        trace_id: REAL_TRACE_ID,
        span_id: REAL_SPAN_ID,
        service: 'genie-backend'
      })
    );
  });

  it('drops the all-zero trace_id sentinel so it never lands on the VL stream', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'no active span',
      timestamp: new Date(FIXED_TS),
      trace_id: ZERO_TRACE_ID,
      span_id: ZERO_SPAN_ID
    });

    // Cardinality control: zero IDs must NOT appear as attributes — a stable
    // VL stream field would be polluted by every non-sampled record.
    expect(record.attributes).not.toHaveProperty('trace_id');
    expect(record.attributes).not.toHaveProperty('span_id');
  });

  it('drops a zero trace_id even when span_id is real (mixed state)', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'warn',
      message: 'partial context',
      timestamp: new Date(FIXED_TS),
      trace_id: ZERO_TRACE_ID,
      span_id: REAL_SPAN_ID
    });

    expect(record.attributes).not.toHaveProperty('trace_id');
    expect(record.attributes.span_id).toBe(REAL_SPAN_ID);
  });

  it('drops a zero span_id even when trace_id is real (asymmetric mixed state)', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'warn',
      message: 'partial context, real trace only',
      timestamp: new Date(FIXED_TS),
      trace_id: REAL_TRACE_ID,
      span_id: ZERO_SPAN_ID
    });

    expect(record.attributes.trace_id).toBe(REAL_TRACE_ID);
    expect(record.attributes).not.toHaveProperty('span_id');
  });

  it('treats a missing trace_id the same as the zero sentinel (no attribute emitted)', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'untraced log',
      timestamp: new Date(FIXED_TS)
      // trace_id / span_id intentionally absent
    });

    expect(record.attributes).not.toHaveProperty('trace_id');
    expect(record.attributes).not.toHaveProperty('span_id');
  });

  it('keeps trace context alongside the body and any extra Winston meta', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'chat completed',
      timestamp: new Date(FIXED_TS),
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID,
      user_id: 'u-42',
      conversation_id: 'conv-7'
    });

    expect(record.attributes).toEqual(
      expect.objectContaining({
        trace_id: REAL_TRACE_ID,
        span_id: REAL_SPAN_ID,
        service: 'genie-backend',
        user_id: 'u-42',
        conversation_id: 'conv-7'
      })
    );
  });

  it('does not re-emit Winston internal keys (level, message, timestamp, splat) as attributes', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'hello',
      timestamp: new Date(FIXED_TS),
      splat: ['unused-format-args'],
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID
    });

    // Internal Winston plumbing must never pollute the OTel attributes payload.
    expect(record.attributes).not.toHaveProperty('level');
    expect(record.attributes).not.toHaveProperty('message');
    expect(record.attributes).not.toHaveProperty('timestamp');
    expect(record.attributes).not.toHaveProperty('splat');
  });
});

describe('VictoriaLogsTransport — body and timestamp', () => {
  beforeEach(() => {
    clearMockHistory();
  });

  it('passes a string `message` through to `body` unchanged', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'info', message: 'GET /api/chat 200 in 87ms' }));

    expect(record.body).toBe('GET /api/chat 200 in 87ms');
  });

  it('stringifies a non-string `message` payload via the default `String(...)` coercion', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'info', message: { event: 'token_refreshed' } }));

    // The transport coerces non-string messages with `String(message)` — the
    // generic JS default. If the contract ever changes (e.g. to JSON.stringify),
    // update this assertion to pin the new format.
    expect(record.body).toBe('[object Object]');
  });

  it('coerces an `Error` instance to a string body containing the message', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, baseInfo({ level: 'error', message: new Error('boom') }));

    expect(typeof record.body).toBe('string');
    expect(record.body).toMatch(/boom/);
  });

  it('converts a numeric timestamp (ms since epoch) to nanoseconds', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'ms timestamp',
      timestamp: FIXED_TS_MS,
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID
    });

    expect(record.timestamp).toBe(FIXED_TS_MS * 1e6);
  });

  it('parses an ISO-8601 string timestamp into nanoseconds', () => {
    const transport = makeTransport();
    const record = emitRecord(transport, {
      level: 'info',
      message: 'iso timestamp',
      timestamp: FIXED_TS,
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID
    });

    expect(record.timestamp).toBe(FIXED_TS_MS * 1e6);
  });

  it('falls back to "now" (in nanoseconds) when timestamp is missing or unparseable', () => {
    const transport = makeTransport();
    // Anchor "now" to a generous lower bound — `Date.now() * 1e6` represents
    // nanoseconds since epoch for the test wall clock; any "now" implementation
    // should produce a number at or above this magnitude. The upper bound catches
    // a hypothetical microseconds-since-epoch bug (would produce ~1e15, well
    // below 1e18).
    const nowNanos = Date.now() * 1e6;

    const noTs = emitRecord(transport, {
      level: 'info',
      message: 'no timestamp',
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID
    });
    expect(noTs.timestamp).toBeGreaterThanOrEqual(nowNanos - 5e12); // ±5s tolerance
    expect(noTs.timestamp).toBeGreaterThan(1e18); // must be nanoseconds, not µs/ms

    const junkTs = emitRecord(transport, {
      level: 'info',
      message: 'junk timestamp',
      timestamp: 'not-a-date',
      trace_id: REAL_TRACE_ID,
      span_id: REAL_SPAN_ID
    });
    expect(junkTs.timestamp).toBeGreaterThan(1e18);
  });
});

describe('VictoriaLogsTransport — service identity and configuration', () => {
  beforeEach(() => {
    clearMockHistory();
  });

  it('defaults `service` to `genie-backend` when no constructor opts are given', () => {
    const transport = new VictoriaLogsTransport({ enabled: true });
    const record = emitRecord(transport, baseInfo({ level: 'info', message: 'default service' }));

    expect(record.attributes.service).toBe('genie-backend');
  });

  it('honors a constructor-time `service` override', () => {
    const transport = new VictoriaLogsTransport({ enabled: true, service: 'document-repository' });
    const record = emitRecord(transport, baseInfo({ level: 'info', message: 'doc-repo log' }));

    expect(record.attributes.service).toBe('document-repository');
  });

  it('lets a per-record `info.service` override the transport default', () => {
    const transport = new VictoriaLogsTransport({ enabled: true, service: 'genie-backend' });
    const record = emitRecord(
      transport,
      baseInfo({ level: 'info', message: 'overridden service', service: 'chatqna' })
    );

    expect(record.attributes.service).toBe('chatqna');
  });

  it('passes the configured `loggerName` to `logs.getLogger(...)`', () => {
    const transport = new VictoriaLogsTransport({ enabled: true, loggerName: 'winston-custom' });
    emitRecord(transport, baseInfo({ level: 'info', message: 'named logger' }));

    expect(mockGetLogger).toHaveBeenCalledWith('winston-custom');
  });

  it('uses a non-empty string `loggerName` when none is supplied', () => {
    const transport = new VictoriaLogsTransport({ enabled: true });
    emitRecord(transport, baseInfo({ level: 'info', message: 'default logger name' }));

    // The exact default is an implementation detail, but it MUST be a
    // non-empty string — a literal `undefined` would explode downstream.
    expect(mockGetLogger).toHaveBeenCalledTimes(1);
    const [loggerName] = mockGetLogger.mock.calls[0];
    expect(typeof loggerName).toBe('string');
    expect(loggerName.length).toBeGreaterThan(0);
  });
});

describe('VictoriaLogsTransport — resilience', () => {
  beforeEach(() => {
    clearMockHistory();
  });

  it('skips emission entirely when constructed with `enabled: false` and still fires the Winston callback', () => {
    const transport = new VictoriaLogsTransport({ enabled: false });
    const callback = jest.fn();

    transport.log(
      {
        level: 'info',
        message: 'should be skipped',
        timestamp: new Date(FIXED_TS),
        trace_id: REAL_TRACE_ID,
        span_id: REAL_SPAN_ID
      },
      callback
    );

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockGetLogger).not.toHaveBeenCalled();
    // Winston contract: the callback must fire even when emission is skipped,
    // otherwise the calling pipeline stalls.
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(); // no error argument
  });

  it.each([
    ['no `enabled` key at all', {}],
    ['explicit `enabled: undefined`', { enabled: undefined }]
  ])('treats %s as enabled (default-on)', (_label, opts) => {
    const transport = new VictoriaLogsTransport(opts);
    emitRecord(transport, baseInfo({ level: 'info', message: 'implicitly enabled' }));

    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by `logs.getLogger` so the Node service stays up (CAP-1)', () => {
    // Always-throw impl (not once): the swallow contract must hold for every
    // downstream call, not only the first one.
    mockGetLogger.mockImplementation(() => {
      throw new Error('otel registry exploded');
    });

    const transport = new VictoriaLogsTransport({ enabled: true });
    const callback = jest.fn();

    expect(() =>
      transport.log(
        {
          level: 'info',
          message: 'before vl outage',
          timestamp: new Date(FIXED_TS),
          trace_id: REAL_TRACE_ID,
          span_id: REAL_SPAN_ID
        },
        callback
      )
    ).not.toThrow();

    // The Winston contract requires the transport to invoke the callback even
    // when emission fails — otherwise the pipeline stalls.
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by `logger.emit`', () => {
    const transport = new VictoriaLogsTransport({ enabled: true });
    mockEmit.mockImplementation(() => {
      throw new Error('collector unreachable');
    });

    const callback = jest.fn();

    expect(() =>
      transport.log(
        {
          level: 'error',
          message: 'during vl outage',
          timestamp: new Date(FIXED_TS),
          trace_id: REAL_TRACE_ID,
          span_id: REAL_SPAN_ID
        },
        callback
      )
    ).not.toThrow();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('extends the winston-transport `TransportStream` so it composes with the rest of the pipeline', () => {
    const TransportStream = require('winston-transport');
    const transport = new VictoriaLogsTransport({ enabled: true });

    // `instanceof` against the (mocked) `TransportStream` is a meaningful
    // check: the SUT must extend winston-transport's base class to plug into
    // the existing Winston pipeline. The `name` check pins the transport's
    // display name in pipeline-level error messages.
    expect(transport).toBeInstanceOf(TransportStream);
    expect(transport.name).toBe('victorialogs');
  });
});
