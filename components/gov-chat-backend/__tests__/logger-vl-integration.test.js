// Story 2.11 — `logger-vl-integration.test.js` (fake OTLPLogExporter).
//
// Background (CAP-1, AD-1, AD-2):
//   The Winston → VictoriaLogs producer chain ships as four cooperating
//   surfaces:
//
//     Winston `info` object
//       └─ VictoriaLogsTransport (Winston TransportStream)
//            └─ `@opentelemetry/api-logs` `Logger.emit(LogRecord)`
//                 └─ LoggerProvider + BatchLogRecordProcessor
//                      └─ OTLPLogExporter  (POST :4318/v1/logs → Collector → VL)
//
//   Story 2.6 wires this in production (`tracing.js` calls
//   `logs.setGlobalLoggerProvider(new LoggerProvider({ processors: [new
//   BatchLogRecordProcessor(new OTLPLogExporter({ url }))] }))`). This story
//   tests the same chain end-to-end, with the only swap being the network
//   exporter replaced by a `FakeOTLPLogExporter` that records everything it
//   would have shipped. The real SDK code path (transport → Logger →
//   BatchLogRecordProcessor) executes unmodified.
//
// Surface: the Winston → LoggerProvider integration surface that Story 2.6
// will wire in production. These tests prove the chain reaches the exporter
// with the right severity, body, trace_id, span_id, and attribute folding,
// and that the EXCLUDED attrs (`level`, `message`, `timestamp`, `splat`,
// `trace_id`, `span_id`, `service`) are not double-promoted into the
// exported LogRecord's attribute bag.
//
// Deferred:
//   - PII redaction on the body field is exercised through the helper
//     `redactLogRecordBody` (Story 2.9); end-to-end wiring through
//     `PIIRedactingLogRecordProcessor` is a Story 2.6 surface and out of
//     scope here. The body-redaction contract is asserted by importing the
//     helper and asserting its behaviour on representative body shapes.

'use strict';

const { logs } = require('@opentelemetry/api-logs');
const {
  LoggerProvider,
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor
} = require('@opentelemetry/sdk-logs');
const { SeverityNumber } = require('@opentelemetry/api-logs');

const { VictoriaLogsTransport } = require('../../shared/lib/victorialogs-transport');
const { redactLogRecordBody } = require('../tracing-pii');

// OTel API-Logs surfaces a noop logger when no global provider is set. Tests
// that depend on emission reaching the fake exporter must run under the
// `with-fake-exporter` block, which swaps the global to a fresh provider
// per test.

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

const SAMPLE_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SAMPLE_SPAN_ID = '00f067aa0ba902b7';

// OTel SDK 0.221 surfaces `hrTime` as `[micros-since-epoch, nanos-within-micro]`
// (i.e. `[1_788_659_371_401_000, 936_000_000]`) — the spec type is
// `[seconds, nanos]` but the SDK in practice packs the integer part into
// microseconds for sub-second precision. Older shapes used a single
// ns-since-epoch number. Coerce both to seconds for semantic assertions.
function coerceHrTimeToSeconds(hr) {
  if (Array.isArray(hr) && hr.length === 2) {
    // hr[0] is microseconds since epoch when it exceeds 1e12 (year ~2001);
    // older SDKs use plain seconds. Use magnitude to disambiguate.
    const first = hr[0];
    const nsWithin = hr[1];
    if (first > 1e12) {
      // Microseconds since epoch + ns remainder
      return first / 1e6 + nsWithin / 1e9;
    }
    // Plain seconds + ns fractional
    return first + nsWithin / 1e9;
  }
  if (typeof hr === 'number') {
    // Heuristic: > 1e12 → already ns-since-epoch; else → seconds-since-epoch
    return hr > 1e12 ? hr / 1e9 : hr;
  }
  return NaN;
}

function buildWinstonInfo(overrides = {}) {
  return {
    level: 'info',
    message: 'hello world',
    timestamp: '2026-09-06T01:30:34.000Z',
    service: 'genie-backend',
    ...overrides
  };
}

// FakeOTLPLogExporter — records every batch the processor hands it. Mirrors
// the real `OTLPLogExporter` contract (`LogRecordExporter.export()` +
// `shutdown()`) so it slots into `BatchLogRecordProcessor` without any
// adapter. Built fresh per test so state never leaks across cases.
//
// `nextResultCode` lets a test inject a non-zero `ExportResult` to verify
// the processor's error-handling path.
function makeFakeExporter(opts = {}) {
  const exported = [];
  const fake = {
    get exportedRecords() {
      return exported;
    },
    export(records, resultCallback) {
      if (!Array.isArray(records)) {
        // Defensive: never let a malformed export call crash the test
        // runner — the real OTLPLogExporter guards the same way.
        resultCallback({ code: 1 });
        return;
      }
      exported.push(
        ...records.map((r) => ({
          body: r.body,
          severityNumber: r.severityNumber,
          severityText: r.severityText,
          attributes: r.attributes,
          hrTime: r.hrTime,
          resource: r.resource
        }))
      );
      const code = opts.nextResultCode === undefined ? 0 : opts.nextResultCode;
      resultCallback({ code });
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    }
  };
  return fake;
}

// Helper: spin up a fresh LoggerProvider backed by a fake exporter, install
// it as the global, yield the controller, tear it down on completion. The
// `Simple` processor flushes per-emit (deterministic for assertions);
// `Batch` is exercised in a dedicated describe below.
//
// IMPORTANT: `@opentelemetry/api-logs`' `setGlobalLoggerProvider` is a
// one-shot — subsequent calls are no-ops once the global is set. Tests that
// need a fresh provider MUST call `logs.disable()` first to clear the
// global slot (the same pattern the OTel SDK uses internally).
async function withFakeExporter(processorKind, fn) {
  if (processorKind !== 'simple' && processorKind !== 'batch') {
    // Defensive: a typo silently selects BatchLogRecordProcessor (the
    // falsy branch of the ternary). Surface the mistake at the call site
    // instead of producing a timing-dependent flaky test.
    throw new Error(`withFakeExporter: unknown processorKind=${String(processorKind)}`);
  }
  logs.disable();
  const fake = makeFakeExporter();
  const processor =
    processorKind === 'simple'
      ? new SimpleLogRecordProcessor({ exporter: fake })
      : new BatchLogRecordProcessor({
          exporter: fake,
          maxExportBatchSize: 5,
          maxQueueSize: 100,
          scheduledDelayMillis: 1,
          exportTimeoutMillis: 1000
        });
  const provider = new LoggerProvider({ processors: [processor] });
  logs.setGlobalLoggerProvider(provider);
  try {
    await fn(fake, provider, processor);
  } finally {
    try {
      await provider.shutdown();
    } catch {
      // Defensive: if shutdown rejects (rare race in BatchLogRecordProcessor
      // timer teardown), still restore the noop global so subsequent tests
      // don't inherit a pinned-but-broken provider.
    }
    logs.disable();
  }
}

describe('logger-vl-integration.test.js — Winston → VictoriaLogs end-to-end (Story 2.11 / CAP-1)', () => {
  describe('Given a single emit, when the BatchLogRecordProcessor flushes, then the fake exporter receives one LogRecord (round-trip)', () => {
    it('Given a LoggerProvider backed by a fake exporter, when the global logger emits one record, then the fake captures exactly one record', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const logger = logs.getLogger('winston');

        // When
        logger.emit({
          timestamp: 1_725_671_834_000_000_000, // 2026-09-06T01:30:34Z in ns
          severityNumber: SeverityNumber.INFO,
          severityText: 'INFO',
          body: 'hello world',
          attributes: { service: 'genie-backend' }
        });

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].body).toBe('hello world');
        expect(fake.exportedRecords[0].severityNumber).toBe(SeverityNumber.INFO);
        expect(fake.exportedRecords[0].severityText).toBe('INFO');
        expect(fake.exportedRecords[0].attributes.service).toBe('genie-backend');
      });
    });
  });

  describe('VictoriaLogsTransport (Story 2.4) wired to the global LoggerProvider', () => {
    it('Given a Winston info object, when the transport logs it, then the fake exporter receives a record with the right severityNumber, severityText, body, and service attribute', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ level: 'info', message: 'hello world' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const rec = fake.exportedRecords[0];
        expect(rec.body).toBe('hello world');
        expect(rec.severityNumber).toBe(SeverityNumber.INFO);
        expect(rec.severityText).toBe('INFO');
        expect(rec.attributes.service).toBe('genie-backend');
      });
    });

    it('Given a transport with enabled=false, when the transport logs it, then the fake exporter receives nothing (CAP-1: kill-switch)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: false });

        // When
        transport.log(buildWinstonInfo({ level: 'info', message: 'should not be exported' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(0);
      });
    });

    it('Given a Winston info object with a non-string message, when the transport logs it, then the body is stringified (defensive coerce)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ message: { nested: 'object', count: 7 } }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(typeof fake.exportedRecords[0].body).toBe('string');
        expect(fake.exportedRecords[0].body).toBe('[object Object]');
      });
    });

    it('Given a Winston info object with a missing timestamp, when the transport logs it, then the exported record has an hrTime populated (Date.now() fallback)', async () => {
      // Given
      const beforeMs = Date.now();
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When — omit `timestamp` entirely
        transport.log(buildWinstonInfo({ timestamp: undefined }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const rec = fake.exportedRecords[0];
        expect(rec.hrTime).toBeDefined();
        // The OTel SDK 0.221 surfaces `hrTime` either as `[seconds, nanos]`
        // (per the spec HrTime type) or as a single ns-since-epoch number,
        // depending on the export path. Coerce to "seconds since epoch"
        // and verify the value is fresh — a malformed hrTime would silently
        // misorder the stream in VL.
        const seconds = coerceHrTimeToSeconds(rec.hrTime);
        expect(Number.isFinite(seconds)).toBe(true);
        expect(seconds).toBeGreaterThanOrEqual(Math.floor(beforeMs / 1000) - 60);
        expect(seconds).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
      });
    });

    it('Given the transport logs a record, when the fake receives it, then the record carries a populated resource (AD-2 service.name)', async () => {
      // Given — `resource` is the OTel carrier for service-level identity;
      // the SDK auto-populates it from `LoggerProvider` resource.
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ message: 'with-resource' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].resource).toBeDefined();
        // Resource attributes are SDK-internal — at minimum the record must
        // carry one. The exact set is owned by the SDK + 2.6 wiring.
        expect(Object.keys(fake.exportedRecords[0].resource.attributes || {}).length).toBeGreaterThan(0);
      });
    });

    it('Given the transport logs, when the winston callback fires, then the callback is invoked exactly once (Winston contract)', async () => {
      // Given — Winston requires the transport's `log(info, callback)` to
      // call the callback even on no-op or emit failure, otherwise the
      // pending log call hangs forever.
      await withFakeExporter('simple', async () => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        let callbackCount = 0;
        const cb = () => {
          callbackCount += 1;
        };

        // When
        transport.log(buildWinstonInfo({ message: 'cb-check' }), cb);

        // Then
        expect(callbackCount).toBe(1);
      });
    });

    it('Given a winston info carrying an Error with a stack, when the transport logs it, then no throw escapes and the record is still emitted (errors.format is upstream)', async () => {
      // Given — Winston adds `info.error` for `logger.error(err)`-style
      // calls. The transport doesn't reach into Error (that is
      // `winston.format.errors({ stack: true })`'s job, set in the
      // logger pipeline), but must not crash on its presence.
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        const err = new Error('boom');
        err.stack = 'Error: boom\n    at /fake/path:1:1';

        // When
        let threw = null;
        try {
          transport.log(buildWinstonInfo({ error: err, message: 'failed' }), () => {});
        } catch (e) {
          threw = e;
        }

        // Then
        expect(threw).toBeNull();
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].body).toBe('failed');
      });
    });

    it('Given a winston info with a circular message value, when the transport logs it, then the transport swallows the cycle and still emits (CAP-1: must not block the Node service)', async () => {
      // Given — the transport stringifies via `String(info.message)` so a
      // cycle in a non-string body yields the engine's "[object Object]"
      // default, never a hang.
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        const cyclic = { name: 'cycle' };
        cyclic.self = cyclic;

        // When
        let threw = null;
        try {
          transport.log(buildWinstonInfo({ message: cyclic }), () => {});
        } catch (e) {
          threw = e;
        }

        // Then
        expect(threw).toBeNull();
        expect(fake.exportedRecords).toHaveLength(1);
        expect(typeof fake.exportedRecords[0].body).toBe('string');
      });
    });

    it('Given a winston info with an empty-string message, when logged, then the empty body still reaches the exporter (no implicit drop)', async () => {
      // Given — empty messages are rare but legal (think `logger.info('')`
      // for heartbeat-style probes). The transport must not filter them.
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ message: '' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].body).toBe('');
      });
    });
  });

  describe('severity mapping (every Winston level → SeverityNumber)', () => {
    // Each case wires a fresh provider so cases are independent.
    const cases = [
      { level: 'error', expected: SeverityNumber.ERROR },
      { level: 'warn', expected: SeverityNumber.WARN },
      { level: 'info', expected: SeverityNumber.INFO },
      { level: 'http', expected: SeverityNumber.INFO },
      { level: 'verbose', expected: SeverityNumber.DEBUG },
      { level: 'debug', expected: SeverityNumber.DEBUG },
      { level: 'silly', expected: SeverityNumber.TRACE }
    ];

    test.each(cases)(
      'Given level=%s, when logged, then severityNumber=$expected (and severityText is uppercase)',
      async ({ level, expected }) => {
        await withFakeExporter('simple', async (fake) => {
          const transport = new VictoriaLogsTransport({ enabled: true });
          transport.log(buildWinstonInfo({ level, message: `${level} msg` }), () => {});
          expect(fake.exportedRecords).toHaveLength(1);
          expect(fake.exportedRecords[0].severityNumber).toBe(expected);
          expect(fake.exportedRecords[0].severityText).toBe(level.toUpperCase());
        });
      }
    );

    it('Given an unknown level, when logged, then severityNumber falls back to INFO (defensive default)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When — Winston normally guarantees a level, but the transport must
        // never crash on a stray value (CAP-1 kill-VL-does-not-block-service)
        transport.log(buildWinstonInfo({ level: 'mystery-level' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].severityNumber).toBe(SeverityNumber.INFO);
        // severityText is derived from the raw level — uppercase the unknown
        // string so downstream LogSQL can still filter on it.
        expect(fake.exportedRecords[0].severityText).toBe('MYSTERY-LEVEL');
      });
    });

    // Defensive defaults for missing / non-string level values — Winston
    // rarely produces them, but the transport must never throw on a stray
    // `info.level`.
    test.each([
      ['null', null],
      ['undefined (omitted)', undefined],
      ['empty string', '']
    ])('Given info.level=%s, when logged, then severityNumber falls back to INFO', async (_label, level) => {
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        transport.log(buildWinstonInfo({ level, message: 'level-default' }), () => {});
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].severityNumber).toBe(SeverityNumber.INFO);
      });
    });
  });

  describe('trace_id / span_id propagation', () => {
    it('Given a real (non-zero) trace_id and span_id on the info, when logged, then both appear in the exported record attributes', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ trace_id: SAMPLE_TRACE_ID, span_id: SAMPLE_SPAN_ID }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const attrs = fake.exportedRecords[0].attributes;
        expect(attrs.trace_id).toBe(SAMPLE_TRACE_ID);
        expect(attrs.span_id).toBe(SAMPLE_SPAN_ID);
      });
    });

    it('Given a zero trace_id (no active span) on the info, when logged, then trace_id is dropped from attributes (not promoted to a stream field)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When — zero IDs mean "no active span"; they must not pollute the
        // record (Cardinality control — AD-4 stream-field rules).
        transport.log(buildWinstonInfo({ trace_id: ZERO_TRACE_ID, span_id: ZERO_SPAN_ID }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const attrs = fake.exportedRecords[0].attributes;
        expect(attrs.trace_id).toBeUndefined();
        expect(attrs.span_id).toBeUndefined();
      });
    });

    it('Given only trace_id set (no span_id), when logged, then only trace_id lands in attributes', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ trace_id: SAMPLE_TRACE_ID }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const attrs = fake.exportedRecords[0].attributes;
        expect(attrs.trace_id).toBe(SAMPLE_TRACE_ID);
        expect(attrs.span_id).toBeUndefined();
      });
    });
  });

  describe('EXCLUDED attrs are NOT promoted to LogRecord attributes (AD-2 attribute folding)', () => {
    // The transport folds `level`/`message`/`timestamp` into dedicated fields
    // (severity*, body, hrTime) and intentionally drops them from the
    // attribute bag. `trace_id`/`span_id`/`service` are promoted only when
    // they carry real values. `splat` is Winston-internal.
    const excluded = ['level', 'message', 'timestamp', 'splat'];

    test.each(excluded)(
      'Given info.%s set, when logged, then %s is absent from the exported record attributes',
      async (key) => {
        await withFakeExporter('simple', async (fake) => {
          const transport = new VictoriaLogsTransport({ enabled: true });
          const info = buildWinstonInfo({ [key]: `${key}-value-that-must-not-leak` });
          transport.log(info, () => {});
          expect(fake.exportedRecords).toHaveLength(1);
          expect(fake.exportedRecords[0].attributes[key]).toBeUndefined();
        });
      }
    );

    it('Given a Winston info with extra custom fields, when logged, then the custom fields appear in attributes (no over-redaction)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(
          buildWinstonInfo({
            conversation_id: 'conv-7',
            user_id: 'u-42',
            request_path: '/api/chat'
          }),
          () => {}
        );

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        const attrs = fake.exportedRecords[0].attributes;
        expect(attrs.conversation_id).toBe('conv-7');
        expect(attrs.user_id).toBe('u-42');
        expect(attrs.request_path).toBe('/api/chat');
      });
    });

    it('Given a Winston info with custom field whose value is undefined, when logged, then the key is omitted (no `{key: undefined}` in attributes)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ optional_meta: undefined }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect('optional_meta' in fake.exportedRecords[0].attributes).toBe(false);
      });
    });
  });

  describe('service attribute override via transport constructor', () => {
    it('Given a transport constructed with {service: "x"}, when the info lacks a service field, then the exported record carries the override', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true, service: 'document-repository' });

        // When — `info` carries no service; constructor override wins
        const info = buildWinstonInfo();
        delete info.service;
        transport.log(info, () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].attributes.service).toBe('document-repository');
      });
    });

    it('Given a transport with default service, when info.service is set, then info.service wins (per-call override)', async () => {
      // Given
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        transport.log(buildWinstonInfo({ service: 'chatqna' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].attributes.service).toBe('chatqna');
      });
    });

    it('Given BOTH constructor.service and info.service are set, then info.service wins (per-call always overrides)', async () => {
      // Given — precedence must be deterministic; future refactors of the
      // transport's override logic must not flip this rule silently.
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true, service: 'a' });

        // When
        transport.log(buildWinstonInfo({ service: 'b' }), () => {});

        // Then
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].attributes.service).toBe('b');
      });
    });
  });

  describe('BatchLogRecordProcessor flush semantics', () => {
    it('Given a real BatchLogRecordProcessor (not Simple), when forceFlush is called, then all buffered records reach the fake exporter with the full attribute bag intact (severityNumber, severityText, attributes, hrTime)', async () => {
      // Given — use the real batch processor; the fake exporter is the only
      // network-layer substitute. This is the production-path assertion.
      await withFakeExporter('batch', async (fake, provider) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        // The transport honours the Winston info timestamp; assert hrTime
        // matches that pre-formatted value (not "now").
        const expectedSec = Math.floor(Date.parse('2026-09-06T01:30:34.000Z') / 1000);

        // When — emit 3 records with varied severity + a trace_id-bearing one
        transport.log(buildWinstonInfo({ level: 'info', message: 'one' }), () => {});
        transport.log(
          buildWinstonInfo({
            level: 'warn',
            message: 'two',
            trace_id: SAMPLE_TRACE_ID,
            span_id: SAMPLE_SPAN_ID
          }),
          () => {}
        );
        transport.log(buildWinstonInfo({ level: 'error', message: 'three' }), () => {});

        await provider.forceFlush();

        // Then — every record has the full shape (not just a count) so a
        // regression in the batch flush path cannot slip past this test.
        expect(fake.exportedRecords).toHaveLength(3);

        const byBody = Object.fromEntries(fake.exportedRecords.map((r) => [r.body, r]));
        expect(byBody.one.severityNumber).toBe(SeverityNumber.INFO);
        expect(byBody.one.severityText).toBe('INFO');
        expect(byBody.one.attributes.service).toBe('genie-backend');
        expect(coerceHrTimeToSeconds(byBody.one.hrTime)).toBe(expectedSec);

        expect(byBody.two.severityNumber).toBe(SeverityNumber.WARN);
        expect(byBody.two.severityText).toBe('WARN');
        expect(byBody.two.attributes.trace_id).toBe(SAMPLE_TRACE_ID);
        expect(byBody.two.attributes.span_id).toBe(SAMPLE_SPAN_ID);

        expect(byBody.three.severityNumber).toBe(SeverityNumber.ERROR);
        expect(byBody.three.severityText).toBe('ERROR');
      });
    });

    it('Given the global provider was swapped by a previous test, when a new fake-exporter test runs, then the new provider is the only one used (no cross-test leakage)', async () => {
      // Given — first test installs a provider that records nothing observable
      await withFakeExporter('simple', async () => {
        // When/Then — no assertion; the helper teardown restores the noop global
        const logger = logs.getLogger('winston');
        logger.emit({
          timestamp: 0,
          severityNumber: SeverityNumber.INFO,
          severityText: 'INFO',
          body: 'first-test-only',
          attributes: {}
        });
      });

      // And a fresh test sees only its own records
      await withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        transport.log(buildWinstonInfo({ message: 'second-test' }), () => {});
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].body).toBe('second-test');
      });
    });

    it('Given the fake exporter returns a failure code, when the SimpleLogRecordProcessor hands it a record, then the processor still resolves (no test hang)', async () => {
      // Given — verifies the processor tolerates an exporter-level error.
      logs.disable();
      const fake = makeFakeExporter({ nextResultCode: 1 });
      const provider = new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter: fake })]
      });
      logs.setGlobalLoggerProvider(provider);
      try {
        const transport = new VictoriaLogsTransport({ enabled: true });

        // When
        let threw = null;
        try {
          transport.log(buildWinstonInfo({ message: 'failed-export' }), () => {});
        } catch (e) {
          threw = e;
        }

        // Then — the Simple processor surfaces the failure via its metrics
        // + globalErrorHandler (OTel SDK contract); the transport must not
        // propagate it to the caller. Fake still recorded the record.
        expect(threw).toBeNull();
        expect(fake.exportedRecords).toHaveLength(1);
      } finally {
        await provider.shutdown();
        logs.disable();
      }
    });

    it('Given no global LoggerProvider is set (OTel uninitialised), when a transport.log call happens, then the call still completes without throwing (CAP-1: never block the Node service)', async () => {
      // Given — fresh process, no SDK init; the OTel noop logger takes over.
      logs.disable();
      const transport = new VictoriaLogsTransport({ enabled: true });

      // When
      let threw = null;
      let callbackCount = 0;
      try {
        transport.log(buildWinstonInfo({ message: 'noop-path', trace_id: SAMPLE_TRACE_ID }), () => {
          callbackCount += 1;
        });
      } catch (e) {
        threw = e;
      }

      // Then — noop logger silently absorbs the emit; transport still
      // honours the Winston callback contract.
      expect(threw).toBeNull();
      expect(callbackCount).toBe(1);
    });
  });

  describe('InMemoryLogRecordExporter parity (sanity cross-check)', () => {
    // The OTel SDK ships `InMemoryLogRecordExporter` which records records
    // into a flat array. We assert it captures the same shape we expect our
    // fake to capture — proves our fake mirrors the SDK contract correctly.
    it('Given the SDK-shipped InMemoryLogRecordExporter, when a logger emits a record, then it captures the same {body, severityNumber, severityText, attributes} shape', async () => {
      // Given
      logs.disable();
      const memExporter = new InMemoryLogRecordExporter();
      const provider = new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter: memExporter })]
      });
      logs.setGlobalLoggerProvider(provider);
      try {
        const logger = logs.getLogger('winston');

        // When
        logger.emit({
          timestamp: 0,
          severityNumber: SeverityNumber.WARN,
          severityText: 'WARN',
          body: 'mem-export check',
          attributes: { service: 'genie-backend' }
        });

        // Then
        const records = memExporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        expect(records[0].body).toBe('mem-export check');
        expect(records[0].severityNumber).toBe(SeverityNumber.WARN);
        expect(records[0].severityText).toBe('WARN');
        expect(records[0].attributes.service).toBe('genie-backend');
      } finally {
        await provider.shutdown();
        logs.disable();
      }
    });
  });

  describe('PII body redaction (Story 2.9 helper, integration with the transport body field)', () => {
    it('Given a string body containing an email, when the helper is applied, then the email is replaced with [REDACTED] before the record reaches the collector', () => {
      // Given — the helper is the production redaction entry point; the
      // wiring into the LogRecord pipeline is owned by Story 2.6.
      const body = 'Login failed for user john.doe@example.com at 10:00 UTC';

      // When
      const redacted = redactLogRecordBody(body);

      // Then
      expect(redacted).toBe('Login failed for user [REDACTED] at 10:00 UTC');
    });

    it('Given a string body containing a Bearer token, when the helper is applied, then the token is replaced with [REDACTED]', () => {
      // Given
      const body = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';

      // When
      const redacted = redactLogRecordBody(body);

      // Then
      expect(redacted).toBe('Authorization: [REDACTED]');
    });

    it('Given an object body with a nested PII field, when the helper is applied, then PII at depth is scrubbed (the Story 2.9 contract)', () => {
      // Given
      const body = {
        user: { id: 'u-1', email: 'alice@example.com' },
        request: { headers: { authorization: 'Bearer xyz' } }
      };

      // When
      const redacted = redactLogRecordBody(body);

      // Then
      expect(redacted).toEqual({
        user: { id: 'u-1', email: '[REDACTED]' },
        request: { headers: { authorization: '[REDACTED]' } }
      });
    });

    it('Given a body with no PII at all, when the helper is applied, then the body is left verbatim (no over-redaction)', () => {
      // Given — common case: a chat completion log carries no PII. The
      // helper must not mutate it.
      const body = 'GET /api/health 200 in 12 ms';

      // When
      const redacted = redactLogRecordBody(body);

      // Then
      expect(redacted).toBe(body);
    });

    it('Given a PII-bearing body fed to transport.log, when the chain reaches the exporter, then the body in the exporter is the unredacted raw value (helper is wired by Story 2.6, not here)', () => {
      // Given — this documents the current scope honestly: the transport
      // emits the raw body. PII scrubbing on `POST /v1/logs` is a 2.6
      // surface (`PIIRedactingLogRecordProcessor.onEmit` calls
      // `redactLogRecordBody`); this test pins the pre-2.6 behavior so a
      // future regression to the helper wiring is caught.
      return withFakeExporter('simple', async (fake) => {
        const transport = new VictoriaLogsTransport({ enabled: true });
        const piiBody = 'Login failed for user john.doe@example.com';

        // When
        transport.log(buildWinstonInfo({ message: piiBody }), () => {});

        // Then — raw PII reaches the exporter today; redaction is owned by 2.6
        expect(fake.exportedRecords).toHaveLength(1);
        expect(fake.exportedRecords[0].body).toBe(piiBody);
        // Cross-check via the helper: the redactor DOES scrub this string
        expect(redactLogRecordBody(piiBody)).toBe('Login failed for user [REDACTED]');
      });
    });
  });
});
