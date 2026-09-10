// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// tracing.js — OpenTelemetry SDK initialization (shared by all Node services)
// MUST be imported as the first line in index.js (before Express and all other modules)
// to ensure auto-instrumentation hooks activate before module loading.
// SERVICE_NAME is read from env so each consumer (backend, okf-server, …) is attributed correctly.

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

  // Resource attributes
  const serviceName = process.env.SERVICE_NAME || 'genie-backend';
  const serviceVersion = process.env.npm_package_version || '1.0.0';
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter — base URL from env var, append signal-specific path (aligned with OPEA tracing.py)
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318';

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

  module.exports = { sdk, getTracer, withSpan };
}
