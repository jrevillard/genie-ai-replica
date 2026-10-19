// tracing.js — OpenTelemetry SDK initialization for document-repository.
//
// PARALLEL of components/gov-chat-backend/tracing.js with these differences:
//
// - Resource `service.name` = 'document-repository' (pinned, matches Compose block).
// - Traces + metrics exported via OTel HTTP; logs go through the single-channel
//   pipeline (winston → stdout → fluentd → collector → VL). Mirrors backend.
//
// Everything else — the propagator, the PII span processor, the shutdown
// handlers — is shared code from `shared-lib`, not a second copy of it.
//
// Test environment guard OR observability disabled — no-op (must be before any
// OTel requires). ENABLE_OBSERVABILITY is the single gate: when disabled the
// Collector is not deployed, so SDK init would produce DNS errors.

if (process.env.NODE_ENV === 'test' || process.env.ENABLE_OBSERVABILITY !== '1') {
  module.exports = {
    sdk: null,
    getTracer: () => ({ startSpan: () => ({}), startActiveSpan: (_n, fn) => fn({}) })
  };
} else {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_NAMESPACE,
    ATTR_SERVICE_VERSION,
    ATTR_DEPLOYMENT_ENVIRONMENT
  } = require('@opentelemetry/semantic-conventions');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  // Background-task tracing helpers — used by the SIGTERM/SIGINT handlers
  // below so the emitted shutdown logs inherit a real trace_id instead of
  // being orphaned. Deep import, not the barrel: the barrel pulls arangojs
  // and express-rate-limit into module load, and this file has to install
  // the OTel SDK before any of that. Jest maps these `shared-lib` paths back
  // to the real files (the rest of `shared-lib` stays on the test mock).
  const { setScopeName, withBackgroundSpan } = require('../shared-lib/tracing-background');
  const { createGeniePropagator } = require('../shared-lib/tracing-baggage');
  const { PIIRedactionProcessor } = require('../shared-lib/pii-span-processor');

  // Resource attributes — stamped on every span + metric this SDK emits
  // (so spans carry service.name in VictoriaTraces, metrics carry it in
  // VictoriaMetrics). Logs no longer flow through the OTel SDK; the
  // collector stamps the Compose-derived service.name on log records.
  const fs = require('fs');
  const path = require('path');
  function _readPackageVersion() {
    // Read THIS component's package.json — not the shared
    // `components/package.json`. `__dirname` for tracing.js at
    // `components/document-repository/src/tracing.js` resolves to
    // `components/document-repository/src/`, so the parent path lands
    // on `components/document-repository/package.json`.
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  // Canonical container identifier — must match the Compose block name
  // in docker-compose.yaml so the OTel Resource's service.name aligns
  // with the Compose label the fluentd driver forwards. No env override.
  const serviceName = 'document-repository';
  // Stamp otel.scope.name=document-repository on every span this SDK
  // emits. The shared helper defaults to 'backend'; without this call
  // every doc-repo span would land in VictoriaTraces under the wrong
  // scope and the otel.scope.name:document-repository filter returns
  // zero rows.
  setScopeName(serviceName);
  const serviceNamespace = 'genie-core';
  const serviceVersion = _readPackageVersion();
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter — base URL from env var, append signal-specific path (aligned with backend + OPEA).
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const traceExporter = new OTLPTraceExporter({
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

  // Create SDK with auto-instrumentations. Same single-exporter chain as
  // backend — spanProcessors owns export (no double-export from NodeSDK's
  // own BatchSpanProcessor).
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // ATTR_DEPLOYMENT_ENVIRONMENT is undefined in some semantic-conventions
      // versions — use raw key as fallback.
      ...(ATTR_DEPLOYMENT_ENVIRONMENT !== undefined
        ? { [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment }
        : { 'deployment.environment': deploymentEnvironment })
    }),
    metricReader: metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // Suppress noisy Express middleware spans — only create spans for route handlers.
        '@opentelemetry/instrumentation-express': {
          ignoreLayersType: ['middleware']
        },
        // Include URL path in HTTP span names (default is just "GET"/"POST").
        '@opentelemetry/instrumentation-http': {
          applyCustomAttributesOnSpan(span, request, _response) {
            const method = request.method || 'HTTP';
            const rawPath = request.url || request.path || '';
            const path = (typeof rawPath === 'string' ? rawPath.split('?')[0] : '') || '';
            if (path) {
              span.updateName(`${method} ${path}`);
            }
          }
        }
      })
    ],
    // Trace context alone drops the baggage header. The composite keeps
    // `genie.query_id` flowing on this service's outbound calls too.
    textMapPropagator: createGeniePropagator(),
    spanProcessors: [new PIIRedactionProcessor(new BatchSpanProcessor(traceExporter))]
  });

  try {
    sdk.start();
  } catch (err) {
    // SDK init failure (malformed OTLP endpoint, DNS error, protocol
    // handshake reject) must not block the doc-repo startup — log and
    // continue with no-op tracer so the rest of the app stays up.
    console.error('[otel] sdk.start failed:', err.message);
  }

  // Graceful shutdown — flush + shut down on SIGTERM/SIGINT.
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
    clearTimeout(timeout);
    // Return normally so `withBackgroundSpan`'s `finally { span.end() }`
    // fires. `process.exit` lives in the `_registerShutdown` `.then()`
    // callback so the otel.shutdown span captures the actual exit code
    // path. Exiting inside this body terminates the process before the
    // awaiting microtask drains — same bug backend's tracing.js had.
  };

  function _registerShutdown(signame) {
    const exitPromise = withBackgroundSpan('otel.shutdown', () => gracefulShutdown(signame), {
      'genie.signal': signame
    });
    exitPromise.then(
      () => process.exit(0),
      (err) => {
        console.error(`[otel.shutdown] ${signame} handler failed:`, err);
        process.exit(1);
      }
    );
  }
  process.on('SIGTERM', () => _registerShutdown('SIGTERM'));
  process.on('SIGINT', () => _registerShutdown('SIGINT'));

  module.exports = { sdk };
}
