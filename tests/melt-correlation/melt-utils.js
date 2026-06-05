// Shared utilities for MELT (Metrics, Events/Logs, Traces) correlation tests.
// Queries VictoriaTraces, VictoriaMetrics, VictoriaLogs backends.
// Generates JUnit XML reports for CI ingestion.
//
// Usage:
//   const utils = require('./melt-utils');
//   const trace = await utils.queryTrace('abc123...');
//   utils.generateJUnitReport(results, 'reports/report.xml');

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration (env vars with defaults for Docker-internal networking)
// ---------------------------------------------------------------------------

const VICTORIATRACES_URL =
  process.env.VICTORIATRACES_URL || 'http://victoriatraces:10428';
const VICTORIAMETRICS_URL =
  process.env.VICTORIAMETRICS_URL || 'http://victoriametrics:8428';
const VICTORIALOGS_URL =
  process.env.VICTORIALOGS_URL || 'http://victorialogs:9428';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const KONG_URL = process.env.KONG_URL || 'http://kong:8000';
const OTEL_COLLECTOR_URL =
  process.env.OTEL_COLLECTOR_URL || 'http://otel-collector:13133';

// ---------------------------------------------------------------------------
// HTTP helpers (Node 18+ native fetch)
// ---------------------------------------------------------------------------

/**
 * GET request returning parsed JSON.
 * @param {string} url
 * @param {object} [headers]
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
async function httpGet(url, headers = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${body}`);
  }
  return res.json();
}

/**
 * POST request returning parsed JSON.
 * @param {string} url
 * @param {object} body
 * @param {object} [headers]
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
async function httpPost(url, body, headers = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
  }
  return res.json();
}

/**
 * POST request returning raw text (for ndjson responses like VictoriaLogs).
 * @param {string} url
 * @param {object} body
 * @param {object} [headers]
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function httpPostText(url, body, headers = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Trace ID helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random 32-char lowercase hex trace ID.
 * @returns {string}
 */
function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a random 16-char lowercase hex span ID.
 * @returns {string}
 */
function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Build W3C traceparent header value.
 * Format: 00-{traceId}-{spanId}-01 (version 0, sampled)
 * @param {string} traceId - 32-char hex
 * @param {string} spanId - 16-char hex
 * @returns {string}
 */
function buildTraceparent(traceId, spanId) {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Extract trace ID from W3C traceparent header.
 * @param {string} traceparent
 * @returns {string|null}
 */
function extractTraceIdFromTraceparent(traceparent) {
  if (!traceparent) return null;
  const parts = traceparent.split('-');
  return parts.length >= 2 ? parts[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// VictoriaTraces queries (Jaeger-compatible JSON API)
// Endpoint: GET /select/jaeger/api/traces/{traceID}
// Response: { "data": [{ "traceID": "...", "spans": [...], "processes": {...} }] }
// ---------------------------------------------------------------------------

/**
 * Query VictoriaTraces for a specific trace by ID.
 * @param {string} traceId - 32-char lowercase hex
 * @returns {Promise<object|null>} Trace object or null if not found
 */
async function queryTrace(traceId) {
  const url = `${VICTORIATRACES_URL}/select/jaeger/api/traces/${traceId.toLowerCase()}`;
  const data = await httpGet(url);
  if (!data.data || data.data.length === 0) {
    return null;
  }
  return data.data[0];
}

/**
 * List observed services from VictoriaTraces.
 * @returns {Promise<string[]>}
 */
async function queryServices() {
  const url = `${VICTORIATRACES_URL}/select/jaeger/api/services`;
  const data = await httpGet(url);
  return data.data || [];
}

/**
 * Extract unique service names from a trace object.
 * @param {object} trace - Trace object with spans and processes
 * @returns {Set<string>}
 */
function extractServiceNames(trace) {
  const names = new Set();
  if (!trace || !trace.spans || !trace.processes) return names;
  for (const span of trace.spans) {
    const proc = trace.processes[span.processID];
    if (proc && proc.serviceName) {
      names.add(proc.serviceName);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// VictoriaMetrics queries (Prometheus-compatible API)
// Endpoint: GET /prometheus/api/v1/query?query={PromQL}
// Note: All endpoints require /prometheus/ prefix (NOT bare /api/v1/)
// ---------------------------------------------------------------------------

/**
 * Query VictoriaMetrics with an instant PromQL query.
 * @param {string} promql - Prometheus query expression
 * @param {number} [time] - Unix timestamp (default: now)
 * @returns {Promise<object>} Prometheus query response
 */
async function queryProm(promql, time) {
  const ts = time || Math.floor(Date.now() / 1000);
  const query = encodeURIComponent(promql);
  const url = `${VICTORIAMETRICS_URL}/prometheus/api/v1/query?query=${query}&time=${ts}`;
  return httpGet(url);
}

/**
 * Query VictoriaMetrics with a range PromQL query.
 * @param {string} promql - Prometheus query expression
 * @param {number} start - Start Unix timestamp
 * @param {number} end - End Unix timestamp
 * @param {number} [step=15] - Step in seconds
 * @returns {Promise<object>} Prometheus query_range response
 */
async function queryPromRange(promql, start, end, step = 15) {
  const query = encodeURIComponent(promql);
  const url = `${VICTORIAMETRICS_URL}/prometheus/api/v1/query_range?query=${query}&start=${start}&end=${end}&step=${step}`;
  return httpGet(url);
}

/**
 * Check that the OTel HTTP server duration metric has data points.
 * Uses auto-converted histogram: http_server_request_duration_count
 * @param {string} [service] - Service name filter (default: gov-chat-backend)
 * @returns {Promise<boolean>}
 */
async function hasServerDurationMetric(service = 'gov-chat-backend') {
  const promql = `http_server_request_duration_count{service_name="${service}"}`;
  const data = await queryProm(promql);
  return (
    data.status === 'success' &&
    data.data &&
    data.data.result &&
    data.data.result.length > 0 &&
    parseFloat(data.data.result[0].value[1]) > 0
  );
}

// ---------------------------------------------------------------------------
// VictoriaLogs queries (LogQL)
// Endpoint: POST /select/logsql/query
// Response: newline-delimited JSON (ndjson)
// Note: trace_id filter requires QUOTED value: trace_id:"{hex}"
// ---------------------------------------------------------------------------

/**
 * Query VictoriaLogs for log entries matching a trace ID.
 * Returns array of parsed JSON objects (one per log line).
 * @param {string} traceId - 32-char lowercase hex
 * @param {number} [timeRangeSec=120] - Lookback window in seconds
 * @returns {Promise<object[]>} Array of parsed log entries
 */
async function queryLogs(traceId, timeRangeSec = 120) {
  const end = new Date().toISOString();
  const start = new Date(
    Date.now() - timeRangeSec * 1000,
  ).toISOString();

  const url = `${VICTORIALOGS_URL}/select/logsql/query`;
  const text = await httpPostText(url, {
    query: `trace_id:"${traceId.toLowerCase()}"`,
    start,
    end,
    limit: 100,
  });

  // VictoriaLogs returns ndjson (one JSON object per line)
  const lines = text.trim().split('\n').filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Query VictoriaLogs with a custom LogQL query.
 * @param {string} logql - LogQL query string
 * @param {number} [timeRangeSec=120] - Lookback window in seconds
 * @param {number} [limit=100] - Max results
 * @returns {Promise<object[]>}
 */
async function queryLogsRaw(logql, timeRangeSec = 120, limit = 100) {
  const end = new Date().toISOString();
  const start = new Date(
    Date.now() - timeRangeSec * 1000,
  ).toISOString();

  const url = `${VICTORIALOGS_URL}/select/logsql/query`;
  const text = await httpPostText(url, { query: logql, start, end, limit });
  const lines = text.trim().split('\n').filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Wait for propagation (eventual consistency — Victoria* may lag 5-15s)
// ---------------------------------------------------------------------------

/**
 * Poll VictoriaTraces until the trace appears or retries exhausted.
 * @param {string} traceId - 32-char hex
 * @param {number} [maxRetries=3]
 * @param {number} [intervalMs=10000] - Delay between retries
 * @returns {Promise<object|null>} Trace object or null
 */
async function waitForPropagation(
  traceId,
  maxRetries = 3,
  intervalMs = 10000,
) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const trace = await queryTrace(traceId);
      if (trace && trace.spans && trace.spans.length > 0) {
        return trace;
      }
    } catch {
      // Backend may not be ready yet
    }
    if (i < maxRetries) {
      await sleep(intervalMs);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

/**
 * Check if a service is healthy (HTTP GET returns 2xx).
 * @param {string} url - Health endpoint URL
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<boolean>}
 */
async function checkServiceHealth(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check all MELT prerequisites (Victoria*, OTel Collector).
 * @param {object[]} [extraServices] - Additional services to check
 * @returns {Promise<object>} Map of service name → boolean
 */
async function checkPrerequisites(extraServices = []) {
  const defaults = [
    {
      name: 'VictoriaTraces',
      url: `${VICTORIATRACES_URL}/select/jaeger/api/services`,
    },
    {
      name: 'VictoriaMetrics',
      url: `${VICTORIAMETRICS_URL}/prometheus/api/v1/health`,
    },
    { name: 'VictoriaLogs', url: `${VICTORIALOGS_URL}/health` },
    { name: 'OTel Collector', url: OTEL_COLLECTOR_URL },
  ];
  const services = [...defaults, ...extraServices];

  const results = {};
  for (const svc of services) {
    results[svc.name] = await checkServiceHealth(svc.url);
  }
  return results;
}

// ---------------------------------------------------------------------------
// JUnit XML report generation
// ---------------------------------------------------------------------------

/**
 * Generate a JUnit XML report file.
 * @param {object[]} results - Test results
 * @param {string} results[].name - Test name
 * @param {boolean} results[].passed - Pass/fail
 * @param {number} [results[].duration] - Duration in seconds
 * @param {string} [results[].classname] - Test class name
 * @param {string} [results[].failureMessage] - Failure message (when !passed)
 * @param {string} [results[].failureDetail] - Failure stack trace (when !passed)
 * @param {string} outputFile - Output file path
 * @param {string} [suiteName='melt-correlation'] - Test suite name
 * @returns {string} Generated XML string
 */
function generateJUnitReport(
  results,
  outputFile,
  suiteName = 'melt-correlation',
) {
  const totalDuration = results.reduce(
    (sum, r) => sum + (r.duration || 0),
    0,
  );
  const failures = results.filter((r) => !r.passed).length;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites tests="${results.length}" failures="${failures}">\n`;
  xml += `  <testsuite name="${escapeXml(suiteName)}" tests="${results.length}" failures="${failures}" errors="0" time="${totalDuration.toFixed(3)}">\n`;

  for (const tc of results) {
    const dur = (tc.duration || 0).toFixed(3);
    const cls = tc.classname || suiteName;
    if (tc.passed) {
      xml += `    <testcase name="${escapeXml(tc.name)}" classname="${escapeXml(cls)}" time="${dur}" />\n`;
    } else {
      xml += `    <testcase name="${escapeXml(tc.name)}" classname="${escapeXml(cls)}" time="${dur}">\n`;
      xml += `      <failure message="${escapeXml(tc.failureMessage || 'Test failed')}">${escapeXml(tc.failureDetail || tc.failureMessage || '')}</failure>\n`;
      xml += `    </testcase>\n`;
    }
  }

  xml += '  </testsuite>\n';
  xml += '</testsuites>\n';

  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputFile, xml, 'utf8');

  return xml;
}

/**
 * Escape a string for safe inclusion in XML.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Assertion helper (throws with descriptive message)
// ---------------------------------------------------------------------------

/**
 * Assert a condition; throw AssertionError if false.
 * @param {boolean} condition
 * @param {string} message - Error message on failure
 */
function assertCondition(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.name = 'AssertionError';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current Unix timestamp.
 * @returns {number}
 */
function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

module.exports = {
  // Configuration
  VICTORIATRACES_URL,
  VICTORIAMETRICS_URL,
  VICTORIALOGS_URL,
  GRAFANA_URL,
  KONG_URL,
  OTEL_COLLECTOR_URL,

  // HTTP helpers
  httpGet,
  httpPost,
  httpPostText,

  // Trace ID helpers
  generateTraceId,
  generateSpanId,
  buildTraceparent,
  extractTraceIdFromTraceparent,

  // Victoria* queries
  queryTrace,
  queryServices,
  extractServiceNames,
  queryProm,
  queryPromRange,
  hasServerDurationMetric,
  queryLogs,
  queryLogsRaw,

  // Health & propagation
  waitForPropagation,
  checkPrerequisites,
  checkServiceHealth,

  // JUnit XML
  generateJUnitReport,
  escapeXml,

  // Assertion
  assertCondition,

  // Utilities
  sleep,
  nowSeconds,
};
