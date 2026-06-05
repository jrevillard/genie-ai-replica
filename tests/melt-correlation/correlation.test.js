#!/usr/bin/env node
// MELT Correlation Test (AC#1, AC#2)
//
// Sends a known error request through Kong with a generated traceparent,
// then validates the trace ID appears in all three Victoria* backends:
//   - VictoriaTraces (distributed trace with span hierarchy)
//   - VictoriaMetrics (http_server_request_duration_count metric)
//   - VictoriaLogs (structured log with trace_id attribute)
//
// Usage (from inside Docker network):
//   node tests/melt-correlation/correlation.test.js
//
// Environment variables:
//   KONG_URL              Kong internal URL (default: http://kong:8000)
//   VICTORIATRACES_URL    VictoriaTraces URL (default: http://victoriatraces:10428)
//   VICTORIAMETRICS_URL   VictoriaMetrics URL (default: http://victoriametrics:8428)
//   VICTORIALOGS_URL      VictoriaLogs URL (default: http://victorialogs:9428)
//   PROPAGATION_DELAY     Seconds to wait before querying backends (default: 15)
//   JUNIT_OUTPUT          JUnit XML output path (default: reports/melt-correlation-report.xml)

'use strict';

const path = require('path');
const {
  generateTraceId,
  generateSpanId,
  buildTraceparent,
  queryTrace,
  hasServerDurationMetric,
  queryLogs,
  waitForPropagation,
  checkPrerequisites,
  extractServiceNames,
  generateJUnitReport,
  assertCondition,
  sleep,
  KONG_URL,
} = require('./melt-utils');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROPAGATION_DELAY =
  parseInt(process.env.PROPAGATION_DELAY || '15', 10);
const JUNIT_OUTPUT =
  process.env.JUNIT_OUTPUT ||
  path.join(__dirname, '..', '..', 'reports', 'melt-correlation-report.xml');

// ---------------------------------------------------------------------------
// Test runner — collects results for JUnit report
// ---------------------------------------------------------------------------

const results = [];

/**
 * Run a single test, capture pass/fail for JUnit report.
 * @param {string} name - Test name (used as JUnit testcase name)
 * @param {Function} fn - Async test function
 * @returns {Promise<void>}
 */
async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = (Date.now() - start) / 1000;
    results.push({ name, passed: true, duration });
    console.log(`  ✅ ${name} (${duration.toFixed(1)}s)`);
  } catch (err) {
    const duration = (Date.now() - start) / 1000;
    results.push({
      name,
      passed: false,
      duration,
      failureMessage: err.message,
      failureDetail: err.stack,
    });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test: Prerequisites (AC#8)
// ---------------------------------------------------------------------------

async function testPrerequisites() {
  const health = await checkPrerequisites();
  const failed = Object.entries(health)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  assertCondition(
    failed.length === 0,
    `Prerequisites not met — unreachable: ${failed.join(', ')}`,
  );

  console.log('    All backends reachable');
}

// ---------------------------------------------------------------------------
// Test: Known error generation (AC#1)
// Sends a request to a non-existent endpoint through Kong, carrying a
// synthetic traceparent header. This produces a 404 which generates
// logs, traces, and metrics in the MELT pipeline.
// ---------------------------------------------------------------------------

async function testKnownErrorGeneration() {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  const traceparent = buildTraceparent(traceId, spanId);

  // Synthetic request to non-existent endpoint — guaranteed 404
  const errorUrl = `${KONG_URL}/api/melt-test-nonexistent-${Date.now()}`;
  const res = await fetch(errorUrl, {
    headers: {
      traceparent,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  // Expect non-2xx (404 from backend router)
  assertCondition(
    res.status >= 400,
    `Expected error status (>=400), got ${res.status}`,
  );

  console.log(`    trace_id: ${traceId}`);
  console.log(`    status: ${res.status}`);

  return { traceId, status: res.status };
}

// ---------------------------------------------------------------------------
// Test: Trace in VictoriaTraces (AC#2 — trace backend)
// Waits for propagation, then validates the trace exists with span data.
// ---------------------------------------------------------------------------

async function testTraceInVictoriaTraces(traceId) {
  console.log(
    `    Waiting ${PROPAGATION_DELAY}s for trace propagation...`,
  );
  await sleep(PROPAGATION_DELAY * 1000);

  const trace = await waitForPropagation(traceId, 3, 10000);

  assertCondition(
    trace !== null,
    `Trace ${traceId} not found in VictoriaTraces after retries`,
  );
  assertCondition(
    trace.spans && trace.spans.length > 0,
    `Trace ${traceId} has no spans`,
  );

  // Verify at least one service produced spans
  const services = extractServiceNames(trace);
  assertCondition(
    services.size >= 1,
    `Expected ≥1 service in trace, found: ${[...services].join(', ')}`,
  );

  console.log(
    `    spans: ${trace.spans.length}, services: ${[...services].join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// Test: Metrics in VictoriaMetrics (AC#2 — metric backend)
// Validates http_server_request_duration_count has data points for the
// gov-chat-backend service during the test window.
// ---------------------------------------------------------------------------

async function testMetricsInVictoriaMetrics() {
  const hasData = await hasServerDurationMetric('gov-chat-backend');

  assertCondition(
    hasData,
    'No http_server_request_duration_count metric found for gov-chat-backend',
  );
}

// ---------------------------------------------------------------------------
// Test: Logs in VictoriaLogs (AC#2 — log backend)
// Validates structured log entries contain the test trace_id.
// ---------------------------------------------------------------------------

async function testLogsInVictoriaLogs(traceId) {
  const logs = await queryLogs(traceId, 120);

  assertCondition(
    logs.length > 0,
    `No logs found for trace_id "${traceId}" in VictoriaLogs`,
  );

  // Verify at least one entry has matching trace_id field
  const match = logs.find(
    (entry) =>
      entry.trace_id &&
      entry.trace_id.toLowerCase() === traceId.toLowerCase(),
  );

  assertCondition(
    match !== undefined,
    `No log entry contains matching trace_id "${traceId}"`,
  );

  console.log(
    `    found ${logs.length} log(s), service: ${match['service.name'] || match.service || 'N/A'}`,
  );
}

// ---------------------------------------------------------------------------
// Test: Cross-backend correlation (AC#2 — full correlation)
// Same trace ID must appear in all 3 backends simultaneously.
// ---------------------------------------------------------------------------

async function testCrossBackendCorrelation(traceId) {
  const [trace, hasMetrics, logs] = await Promise.all([
    queryTrace(traceId),
    hasServerDurationMetric('gov-chat-backend'),
    queryLogs(traceId, 120),
  ]);

  const traceFound =
    trace !== null && trace.spans && trace.spans.length > 0;

  assertCondition(traceFound, `Trace ${traceId} missing from VictoriaTraces`);
  assertCondition(hasMetrics, 'Metrics missing from VictoriaMetrics');
  assertCondition(
    logs.length > 0,
    `Logs missing from VictoriaLogs for trace_id "${traceId}"`,
  );

  console.log(
    `    trace_id "${traceId}" confirmed in all 3 backends`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log(
    '═'.repeat(55),
  );
  console.log('  MELT Correlation Test (AC#1, AC#2, AC#8)');
  console.log(`  ${new Date().toISOString()}`);
  console.log(
    '═'.repeat(55),
  );
  console.log('');

  // 1. Prerequisites
  await runTest(
    'AC8 — Prerequisites: all backends reachable',
    testPrerequisites,
  );

  let traceId;

  // 2. Known error generation (AC#1)
  await runTest(
    'AC1 — Known error generation with trace context',
    async () => {
      const result = await testKnownErrorGeneration();
      traceId = result.traceId;
    },
  );

  // 3. Trace in VictoriaTraces (AC#2 partial)
  await runTest(
    'AC2 — Trace ID in VictoriaTraces with span hierarchy',
    async () => {
      await testTraceInVictoriaTraces(traceId);
    },
  );

  // 4. Metrics in VictoriaMetrics (AC#2 partial)
  await runTest(
    'AC2 — Error metric in VictoriaMetrics',
    async () => {
      await testMetricsInVictoriaMetrics();
    },
  );

  // 5. Logs in VictoriaLogs (AC#2 partial)
  await runTest(
    'AC2 — Logs with trace_id in VictoriaLogs',
    async () => {
      await testLogsInVictoriaLogs(traceId);
    },
  );

  // 6. Cross-backend correlation (AC#2 full)
  await runTest(
    'AC2 — Cross-backend correlation: same trace_id in all 3 backends',
    async () => {
      await testCrossBackendCorrelation(traceId);
    },
  );

  // Generate JUnit report
  generateJUnitReport(results, JUNIT_OUTPUT);
  console.log('');
  console.log(`JUnit report: ${JUNIT_OUTPUT}`);

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('');
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log('');

  if (failed > 0) {
    console.log('Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.failureMessage}`);
    }
    console.log('');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
