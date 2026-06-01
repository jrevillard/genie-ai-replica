// tracing.js — OpenTelemetry SDK initialization
// MUST be imported as the first line in index.js (before Express and all other modules)
// to ensure auto-instrumentation hooks activate before module loading.

// Test environment guard — no-op when testing (must be before any OTel requires)
if (process.env.NODE_ENV === 'test') {
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
  module.exports = {
    sdk: null,
    getTracer: () => noOpTracer
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
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { redactAttributes } = require('./tracing-pii');

  // Custom SpanProcessor that redacts PII before export
  class PIIRedactionProcessor {
    constructor(exporter) {
      this._delegate = new BatchSpanProcessor(exporter);
    }

    onStart(span, parentContext) {
      this._delegate.onStart(span, parentContext);
    }

    onEnd(span) {
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

  // Resource attributes
  const serviceName = 'genie-backend';
  const serviceVersion = process.env.npm_package_version || '1.0.0';
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318'
  });

  // Metrics exporter — sends OTel HTTP metrics to VictoriaMetrics via Collector
  const metricExporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318/v1/metrics'
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
      [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment
    }),
    traceExporter: exporter,
    metricReader: metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false }
      })
    ],
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: [new PIIRedactionProcessor(exporter)]
  });

  // Start the SDK
  sdk.start();

  // Graceful shutdown
  const SHUTDOWN_TIMEOUT_MS = 5000;
  const gracefulShutdown = async () => {
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
    clearTimeout(timeout);
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  function getTracer() {
    return trace.getTracer(serviceName, serviceVersion);
  }

  module.exports = { sdk, getTracer };
}
