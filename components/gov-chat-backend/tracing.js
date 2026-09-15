// tracing.js — OpenTelemetry SDK initialization
// MUST be imported as the first line in index.js (before Express and all other modules)
// to ensure auto-instrumentation hooks activate before module loading.

// Test environment guard OR observability disabled — no-op (must be before any OTel requires)
// ENABLE_OBSERVABILITY is the single gate: when disabled the Collector is not deployed,
// so SDK init would produce DNS errors. OTEL_EXPORTER_OTLP_ENDPOINT always has a compose
// default and cannot be used as the gate.
// Aligned with OPEA tracing.py.
if (process.env.NODE_ENV === 'test' || process.env.ENABLE_OBSERVABILITY !== '1') {
  const noOpSpan = {
    end: () => {},
    setAttribute: () => {},
    addEvent: () => {},
    setStatus: () => {},
    recordException: () => {},
    updateName: () => {}
  };
  const noOpTracer = {
    startSpan: () => noOpSpan,
    startActiveSpan: (name, opts, fn) => {
      if (typeof opts === 'function') {
        return opts(noOpSpan);
      }
      return fn(noOpSpan);
    }
  };
  const withSpanNoOp = (name, fn) => fn(noOpSpan);
  module.exports = {
    sdk: null,
    withSpan: withSpanNoOp,
    getTracer: () => noOpTracer,
    // No-op branches export `null` loggerProvider + droppedCounter so test files can
    // destructure them uniformly without conditional checks.
    loggerProvider: null,
    droppedCounter: null
  };
} else {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
    ATTR_DEPLOYMENT_ENVIRONMENT
  } = require('@opentelemetry/semantic-conventions');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
  const { W3CTraceContextPropagator } = require('@opentelemetry/core');
  const { trace } = require('@opentelemetry/api');
  const { logs } = require('@opentelemetry/api-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { redactAttributes } = require('./tracing-pii');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  const { LoggerProvider } = require('@opentelemetry/sdk-logs');
  const { PIIRedactingLogRecordProcessor } = require('./tracing-pii-logs');
  // Single boolean-env.js helper, accepts 1/true/TRUE/yes — NOT strict `=== '1'`.
  const { booleanEnv } = require('./shared-lib/boolean-env');
  // Shared batch tuning — both backend and document-repository require this file
  // to avoid per-component drift in BatchLogRecordProcessor queue / batch / delay config.
  const sharedBatchConfig = require('./shared-lib/otel-batch-config');
  // Background-task tracing helpers — used by the SIGTERM/SIGINT handlers
  // below so the emitted shutdown logs inherit a real trace_id instead of
  // being orphaned. Deep import matches the existing shared-lib/X pattern.
  const { withBackgroundSpan } = require('./shared-lib/tracing-background');
  // otlp_unreachable call-site: module-load dropped counter.
  // Backed by the canonical enum exported from metrics.js — never pass raw
  // strings to `.add()` (cardinality-bounded set).
  // Module-load counter creation is guarded so the OTel SDK being absent (or
  // `getMeter` throwing at require-time) never breaks tracing.js load —
  // every other backend module depends on tracing.js requiring successfully.
  // A throw leaves `droppedCounter` as the no-op stub below: subsequent
  // `.add()` calls become absorbed and the SDK init still surfaces its real
  // error.
  const { getMeter, LOG_DROPPED_REASON, LOG_RECORD_DROPPED_TOTAL } = require('./metrics');
  const droppedCounter = (() => {
    try {
      return getMeter().createCounter(LOG_RECORD_DROPPED_TOTAL, {
        description: 'Otel log records dropped before export'
      });
    } catch {
      return { add: () => {} };
    }
  })();

  // Custom SpanProcessor that redacts PII and drops noise spans before export
  class PIIRedactionProcessor {
    constructor(exporter) {
      this._delegate = new BatchSpanProcessor(exporter);
      // Paths that should not generate traces (health checks, readiness probes)
      this._ignoredPaths = ['/health', '/ready', '/alive', '/favicon.ico'];
    }

    onStart(span, parentContext) {
      this._delegate.onStart(span, parentContext);
    }

    onEnd(span) {
      // Drop health-check spans before export to reduce noise in Grafana
      const attrs = span.attributes || {};
      const target = attrs['http.target'] || attrs['http.route'] || '';
      if (target && this._ignoredPaths.some((p) => target.includes(p))) {
        return; // silently drop the span
      }
      // Drop Express catch-all route handler spans (health checks hitting wildcard routes)
      const opName = span.name || '';
      if (opName.startsWith('request handler - *')) {
        return;
      }
      try {
        const attrs = span.attributes;
        if (attrs) {
          const redacted = redactAttributes(attrs);
          for (const [key, value] of Object.entries(redacted)) {
            span.setAttribute(key, value);
          }
        }
      } catch {
        // Redaction failure must not block span export
      }
      this._delegate.onEnd(span);
    }

    async shutdown() {
      return this._delegate.shutdown();
    }

    async forceFlush() {
      return this._delegate.forceFlush();
    }
  }

  // Resource attributes — service.version reads package.json (npm does NOT
  // propagate npm_package_version into Docker runtime; the previous
  // "1.0.0" fallback was misleading — every deployment looked at v1.0.0
  // regardless of the actual image tag). Operators can still override via
  // the `SERVICE_VERSION` env var.
  const fs = require('fs');
  const path = require('path');
  function _readPackageVersion() {
    // Read THIS component's package.json (not the shared
    // `components/package.json`) — otherwise backend + doc-repo would
    // report the same version, defeating the per-component claim.
    // `__dirname` for backend's tracing.js is `components/gov-chat-backend/`,
    // so the file lives at `components/gov-chat-backend/package.json`.
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  const serviceName = 'genie-backend';
  const serviceVersion = process.env.SERVICE_VERSION || _readPackageVersion();
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter — base URL from env var, append signal-specific path (aligned with OPEA tracing.py)
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const exporter = new OTLPTraceExporter({
    url: `${endpointBase}/v1/traces`
  });

  // Metrics exporter — sends OTel HTTP metrics to VictoriaMetrics via Collector
  const metricExporter = new OTLPMetricExporter({
    url: `${endpointBase}/v1/metrics`
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000
  });

  // Create SDK with auto-instrumentations
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // ATTR_DEPLOYMENT_ENVIRONMENT is undefined in some semantic-conventions
      // versions — use raw key as fallback.
      ...(ATTR_DEPLOYMENT_ENVIRONMENT !== undefined
        ? { [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment }
        : { 'deployment.environment': deploymentEnvironment })
    }),
    traceExporter: exporter,
    metricReader: metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // Suppress noisy Express middleware spans — only create spans for route handlers.
        // Without this, every middleware (cors, helmet, logger, etc.) creates a separate
        // root span, flooding traces with <100µs noise entries.
        '@opentelemetry/instrumentation-express': {
          ignoreLayersType: ['middleware']
        },
        // Include URL path in HTTP span names (default is just "GET"/"POST").
        // Callback signature: (span, request, response) — all 3 args required.
        // Server: request = IncomingMessage with .url
        // Client: request = ClientRequest with .path
        '@opentelemetry/instrumentation-http': {
          applyCustomAttributesOnSpan(span, request, _response) {
            const method = request.method || 'HTTP';
            // IncomingMessage (server) uses .url, ClientRequest (outgoing) uses .path
            const rawPath = request.url || request.path || '';
            const path = (typeof rawPath === 'string' ? rawPath.split('?')[0] : '') || '';
            if (path) {
              span.updateName(`${method} ${path}`);
            }
          }
        }
      })
    ],
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: [new PIIRedactionProcessor(exporter)]
  });

  // Start the SDK. OTLP exporters are lazy — they open the HTTP connection
  // on first export. Failures surface synchronously here only when the
  // endpoint URL is malformed, the DNS lookup fails synchronously, or the
  // collector rejects the protocol handshake; otherwise the failure is
  // recorded by the exporter's internal retry loop and the call below is a
  // silent no-op. We wrap it anyway so the otlp_unreachable counter is wired
  // at the module's contract surface; a true per-send failure detector (a
  // custom exporter wrapping `_delegate.send`) is a follow-up.
  try {
    sdk.start();
  } catch (err) {
    try {
      droppedCounter.add(1, { reason: LOG_DROPPED_REASON.OTLP_UNREACHABLE });
    } catch {
      // metric failure must never mask the underlying SDK init error
    }
    throw err;
  }

  // LoggerProvider for OTel logs — gated on LOG_TO_VICTORIALOGS AND
  // ENABLE_OBSERVABILITY. NodeSDK owns traces/metrics; log export sits
  // outside the SDK config so the gate stays local to this module.
  // logRecordProcessors redact PII on every emitted record via the span-side
  // redactAttributes contract.
  //
  // PIIRedactingLogRecordProcessor (tracing-pii-logs.js) wraps an inner
  // BatchLogRecordProcessor constructed with the sdk-logs 0.221.x positional
  // (exporter, config) signature. sharedBatchConfig (otel-batch-config.js)
  // pins maxExportBatchSize / scheduledDelayMillis / maxQueueSize for both
  // backend + document-repository.
  let loggerProvider = null;
  if (booleanEnv('LOG_TO_VICTORIALOGS') && booleanEnv('ENABLE_OBSERVABILITY')) {
    try {
      const logExporter = new OTLPLogExporter({
        url: `${endpointBase}/v1/logs`
      });
      loggerProvider = new LoggerProvider({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: serviceName,
          [ATTR_SERVICE_VERSION]: serviceVersion,
          ...(ATTR_DEPLOYMENT_ENVIRONMENT !== undefined
            ? { [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment }
            : { 'deployment.environment': deploymentEnvironment })
        }),
        // sdk-logs 0.221.x reads `config.processors` (NOT `logRecordProcessors`).
        // The 2-6 merge was reading the wrong config key; the processor list
        // was silently dropped. See review findings on commit 251f99d57.
        processors: [
          new PIIRedactingLogRecordProcessor({
            exporter: logExporter,
            ...sharedBatchConfig
          })
        ]
      });
      logs.setGlobalLoggerProvider(loggerProvider);
    } catch (err) {
      try {
        droppedCounter.add(1, { reason: LOG_DROPPED_REASON.OTLP_UNREACHABLE });
      } catch {
        // metric failure must never mask the underlying LoggerProvider init error
      }
      throw err;
    }
  }

  // Graceful shutdown — bump the timeout to 15s to give the
  // BatchLogRecordProcessor + sdk force_flush enough time to drain
  // under load (the Collector may also be tearing down concurrently in
  // Swarm, adding latency to OTLP exports). The signal name is captured
  // as a span attribute (low-cardinality span name, high-cardinality
  // detail per OTel semconv guidance).
  const SHUTDOWN_TIMEOUT_MS = 15000;
  const gracefulShutdown = async (_signame) => {
    let flushed = false;
    const timeout = setTimeout(() => {
      if (!flushed) process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await sdk.shutdown();
      flushed = true;
    } catch {
      // Shutdown errors are non-fatal — best-effort flush
    }
    try {
      await loggerProvider?.shutdown();
    } catch {
      // Shutdown errors are non-fatal — best-effort flush
    }
    clearTimeout(timeout);
    process.exit(0);
  };

  // `process.on()` ignores the listener's return value, so the Promise
  // returned by `withBackgroundSpan` would be dropped on the floor —
  // the span's `finally` block never fires, the span leaks, and any
  // rejection inside `gracefulShutdown` becomes an unhandled rejection.
  // We must explicitly capture the Promise and attach `.catch()` so the
  // span ends AND rejections surface (not as process termination via
  // Node 15+'s unhandledRejection default policy).
  function _registerShutdown(signame) {
    withBackgroundSpan(
      'otel.shutdown',
      () => gracefulShutdown(signame),
      { 'genie.signal': signame }
    ).catch((err) => {
      // Rejection inside the span body — record + log, but do not crash
      // the shutdown path. `process.exit` still runs via the inner
      // gracefulShutdown timeout (or the inner try/finally itself).
      // eslint-disable-next-line no-console
      console.error(`[otel.shutdown] ${signame} handler failed:`, err);
    });
  }
  process.on('SIGTERM', () => _registerShutdown('SIGTERM'));
  process.on('SIGINT', () => _registerShutdown('SIGINT'));

  function getTracer() {
    return trace.getTracer(serviceName, serviceVersion);
  }

  /**
   * Span helper — wraps the common try/catch/finally pattern with built-in error handling.
   *
   * Usage:
   *   const { withSpan } = require('./tracing');
   *   const result = await withSpan('service.operation', async (span) => {
   *     const data = await doWork();
   *     span.setAttribute('data.count', data.length);
   *     return data;
   *   });
   *
   * Guarantees:
   *   - span.setStatus(ERROR) + recordException on any exception
   *   - span.end() always called (finally)
   *   - No-op in test environment
   */
  function withSpan(name, fn, options = {}) {
    const tracer = getTracer();
    const span = tracer.startSpan(name, options);
    try {
      const result = fn(span);
      if (result && typeof result.then === 'function') {
        return result
          .catch((err) => {
            span.recordException(err);
            span.setStatus({ code: 2, message: err.message }); // 2 = ERROR
            throw err;
          })
          .finally(() => span.end());
      }
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message });
      span.end();
      throw err;
    }
  }

  module.exports = { sdk, getTracer, withSpan, loggerProvider, droppedCounter };
}
