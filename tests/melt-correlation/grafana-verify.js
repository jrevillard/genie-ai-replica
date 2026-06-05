#!/usr/bin/env node
// Grafana Datasource Verification Test (AC#3)
//
// Validates all 3 Grafana datasources proxy queries work end-to-end
// by querying through Grafana's datasource proxy API:
//   - VictoriaMetrics (prometheus, proxy/1)
//   - VictoriaTraces (tempo, proxy/2)
//   - VictoriaLogs (victoriametrics-logs, proxy/3)
//
// Uses the Grafana API with admin basic auth credentials.
//
// Usage (from inside Docker network):
//   node tests/melt-correlation/grafana-verify.js
//
// Environment variables:
//   GRAFANA_URL          Grafana URL (default: http://grafana:3000)
//   GRAFANA_ADMIN_USER   Grafana admin username (default: admin)
//   GRAFANA_ADMIN_PASSWORD Grafana admin password (required)
//   TRACE_ID             Known trace ID to query (or generates one)
//   PROPAGATION_DELAY    Seconds to wait for trace propagation (default: 15)
//   JUNIT_OUTPUT         JUnit XML output path

'use strict';

const path = require('path');
const {
  generateTraceId,
  generateSpanId,
  buildTraceparent,
  generateJUnitReport,
  assertCondition,
  sleep,
  httpGet,
  KONG_URL,
  GRAFANA_URL,
} = require('./melt-utils');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GRAFANA_ADMIN_USER = process.env.GRAFANA_ADMIN_USER || 'admin';
const GRAFANA_ADMIN_PASSWORD = process.env.GRAFANA_ADMIN_PASSWORD || '';
const PROPAGATION_DELAY =
  parseInt(process.env.PROPAGATION_DELAY || '15', 10);
const JUNIT_OUTPUT =
  process.env.JUNIT_OUTPUT ||
  path.join(__dirname, '..', '..', 'reports', 'melt-grafana-report.xml');

// Grafana datasource proxy paths (UID-based, discovered from provisioning)
const DS_VICTORIAMETRICS = 'prometheus'; // proxy/1 — default Prometheus DS
const DS_VICTORIATRACES = 'tempo'; // proxy/2 — tempo DS for VictoriaTraces
const DS_VICTORIALOGS = 'victoriametrics-logs-datasource'; // proxy/3 — logs DS

// ---------------------------------------------------------------------------
// Grafana API helpers
// ---------------------------------------------------------------------------

/**
 * Build Grafana API URL with basic auth headers.
 * @param {string} apiPath - API path (e.g., /api/datasources/proxy/1/...)
 * @returns {{ url: string, headers: object }}
 */
function grafanaApi(apiPath) {
  const url = `${GRAFANA_URL}${apiPath}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(
      `${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASSWORD}`,
    ).toString('base64')}`,
  };
  return { url, headers };
}

/**
 * GET through Grafana datasource proxy.
 * @param {string} dsType - Datasource type path segment (proxy/1, proxy/2, etc.)
 * @param {string} queryPath - Backend-specific query path
 * @returns {Promise<object>}
 */
async function grafanaProxyGet(dsType, queryPath) {
  const { url, headers } = grafanaApi(
    `/api/datasources/${dsType}${queryPath}`,
  );
  return httpGet(url, headers);
}

/**
 * POST through Grafana datasource proxy.
 * @param {string} dsType - Datasource type path segment
 * @param {string} queryPath - Backend-specific query path
 * @param {object} body - Request body
 * @returns {Promise<object>}
 */
async function grafanaProxyPost(dsType, queryPath, body) {
  const { url, headers } = grafanaApi(
    `/api/datasources/${dsType}${queryPath}`,
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from Grafana proxy: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];

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
// Tests
// ---------------------------------------------------------------------------

/**
 * Test: Grafana API is accessible with admin credentials.
 */
async function testGrafanaApiAccessible() {
  assertCondition(
    GRAFANA_ADMIN_PASSWORD,
    'GRAFANA_ADMIN_PASSWORD environment variable is required',
  );

  const { url, headers } = grafanaApi('/api/org');
  const data = await httpGet(url, headers);

  assertCondition(
    data && data.id,
    `Grafana API returned unexpected response: ${JSON.stringify(data)}`,
  );
  console.log(`    Org: "${data.name}" (ID ${data.id})`);
}

/**
 * Test: List all provisioned datasources.
 */
async function testDatasourcesProvisioned() {
  const { url, headers } = grafanaApi('/api/datasources');
  const data = await httpGet(url, headers);

  assertCondition(
    Array.isArray(data) && data.length >= 3,
    `Expected ≥3 datasources, found ${Array.isArray(data) ? data.length : 'non-array'}`,
  );

  const names = data.map((ds) => ds.name);
  assertCondition(
    names.includes('VictoriaMetrics'),
    'VictoriaMetrics datasource not found',
  );
  assertCondition(
    names.includes('VictoriaTraces'),
    'VictoriaTraces datasource not found',
  );
  assertCondition(
    names.includes('VictoriaLogs'),
    'VictoriaLogs datasource not found',
  );

  console.log(`    Datasources: ${names.join(', ')}`);
}

/**
 * Test: VictoriaMetrics datasource proxy query returns data.
 * Queries http_server_request_duration_count through Grafana → VictoriaMetrics.
 */
async function testVictoriaMetricsProxy() {
  const end = Math.floor(Date.now() / 1000);
  const query = encodeURIComponent(
    'http_server_request_duration_count{service_name="gov-chat-backend"}',
  );
  const data = await grafanaProxyGet(
    DS_VICTORIAMETRICS,
    `/prometheus/api/v1/query?query=${query}&time=${end}`,
  );

  assertCondition(
    data.status === 'success',
    `VictoriaMetrics proxy query failed: ${JSON.stringify(data)}`,
  );

  // Note: data may be empty on fresh stack — we just verify the proxy works
  console.log(`    Proxy status: ${data.status}, results: ${data.data?.result?.length || 0}`);
}

/**
 * Test: VictoriaTraces datasource proxy returns trace data.
 * Generates a known trace ID, sends request, waits, queries through Grafana.
 */
async function testVictoriaTracesProxy(traceId) {
  const data = await grafanaProxyGet(
    DS_VICTORIATRACES,
    `/api/traces/${traceId}`,
  );

  assertCondition(
    data && data.data && data.data.length > 0,
    `VictoriaTraces proxy returned no data for trace ${traceId}`,
  );

  assertCondition(
    data.data[0].spans && data.data[0].spans.length > 0,
    `Trace ${traceId} has no spans through Grafana proxy`,
  );

  console.log(
    `    Trace via Grafana: ${data.data[0].spans.length} span(s)`,
  );
}

/**
 * Test: VictoriaLogs datasource proxy returns log entries.
 */
async function testVictoriaLogsProxy(traceId) {
  const end = new Date().toISOString();
  const start = new Date(Date.now() - 120000).toISOString();

  const data = await grafanaProxyPost(
    DS_VICTORIALOGS,
    '/api/v1/query_range',
    {
      query: `trace_id:"${traceId}"`,
      start,
      end,
      limit: 100,
    },
  );

  // VictoriaLogs datasource may return { data: [...] } or ndjson
  let entries = [];
  if (Array.isArray(data)) {
    entries = data;
  } else if (data && data.data) {
    entries = Array.isArray(data.data) ? data.data : [data.data];
  }

  assertCondition(
    entries.length > 0,
    `VictoriaLogs proxy returned no entries for trace_id "${traceId}"`,
  );

  console.log(`    Logs via Grafana: ${entries.length} entry(ies)`);
}

/**
 * Generate a known trace ID by sending a request through Kong.
 */
async function generateKnownTrace() {
  const traceId = process.env.TRACE_ID || generateTraceId();
  const spanId = generateSpanId();
  const traceparent = buildTraceparent(traceId, spanId);

  const errorUrl = `${KONG_URL}/api/melt-grafana-test-${Date.now()}`;
  await fetch(errorUrl, {
    headers: { traceparent, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  console.log(`    trace_id: ${traceId}`);
  return traceId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('═'.repeat(55));
  console.log('  Grafana Datasource Verification (AC#3)');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═'.repeat(55));
  console.log('');

  // 1. Grafana API accessible
  await runTest('AC3 — Grafana API accessible with admin credentials', testGrafanaApiAccessible);

  // 2. Datasources provisioned
  await runTest('AC3 — All 3 datasources provisioned', testDatasourcesProvisioned);

  // 3. VictoriaMetrics proxy
  await runTest(
    'AC3 — VictoriaMetrics datasource proxy query works',
    testVictoriaMetricsProxy,
  );

  // 4. Generate known trace for traces + logs tests
  let traceId;
  await runTest('AC3 — Generate known trace via Kong', async () => {
    traceId = await generateKnownTrace();
  });

  // 5. Wait for propagation
  if (traceId) {
    console.log(`  ⏳ Waiting ${PROPAGATION_DELAY}s for propagation...`);
    await sleep(PROPAGATION_DELAY * 1000);
  }

  // 6. VictoriaTraces proxy
  await runTest(
    'AC3 — VictoriaTraces datasource proxy returns trace data',
    async () => {
      await testVictoriaTracesProxy(traceId);
    },
  );

  // 7. VictoriaLogs proxy
  await runTest(
    'AC3 — VictoriaLogs datasource proxy returns log entries',
    async () => {
      await testVictoriaLogsProxy(traceId);
    },
  );

  // JUnit report
  generateJUnitReport(results, JUNIT_OUTPUT, 'melt-grafana');
  console.log('');
  console.log(`JUnit report: ${JUNIT_OUTPUT}`);

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
