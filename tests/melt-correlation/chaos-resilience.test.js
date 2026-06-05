#!/usr/bin/env node
// Chaos Resilience Test (AC#4, AC#5)
//
// For each Victoria* backend (VictoriaTraces, VictoriaLogs):
//   1. Generate baseline trace, verify it appears
//   2. Stop the backend (simulating outage)
//   3. Generate N requests during outage — Collector queues data
//   4. Verify OTel Collector stays healthy during outage
//   5. Restart the backend
//   6. Wait for backend healthy
//   7. Re-query ALL outage trace IDs — verify zero data loss
//
// MUST run inside Docker network (container-only services).
// Requires Docker socket access (mount -v /var/run/docker.sock:/var/run/docker.sock)
// or run from a Swarm manager node.
//
// Usage (from Swarm manager or Docker host with socket access):
//   node tests/melt-correlation/chaos-resilience.test.js
//
// Environment variables:
//   KONG_URL              Kong internal URL (default: http://kong:8000)
//   VICTORIATRACES_URL    VictoriaTraces URL (default: http://victoriatraces:10428)
//   VICTORIALOGS_URL      VictoriaLogs URL (default: http://victorialogs:9428)
//   OTEL_COLLECTOR_URL    OTel Collector health URL (default: http://otel-collector:13133)
//   PROPAGATION_DELAY     Seconds to wait for propagation (default: 15)
//   RESTART_TIMEOUT       Max seconds to wait for backend restart (default: 60)
//   OUTAGE_REQUESTS       Number of requests during outage (default: 3)
//   JUNIT_OUTPUT          JUnit XML output path
//   SKIP_BACKENDS         Comma-separated list of backends to skip (e.g., "victorialogs")

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const {
  generateTraceId,
  generateSpanId,
  buildTraceparent,
  queryTrace,
  queryLogs,
  checkServiceHealth,
  generateJUnitReport,
  assertCondition,
  sleep,
  OTEL_COLLECTOR_URL,
  KONG_URL,
} = require('./melt-utils');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROPAGATION_DELAY =
  parseInt(process.env.PROPAGATION_DELAY || '15', 10);
const RESTART_TIMEOUT =
  parseInt(process.env.RESTART_TIMEOUT || '60', 10);
const OUTAGE_REQUESTS =
  parseInt(process.env.OUTAGE_REQUESTS || '3', 10);
const JUNIT_OUTPUT =
  process.env.JUNIT_OUTPUT ||
  path.join(__dirname, '..', '..', 'reports', 'melt-chaos-report.xml');

const SKIP_BACKENDS = new Set(
  (process.env.SKIP_BACKENDS || '').split(',').filter(Boolean),
);

// Backend definitions
const BACKENDS = [
  {
    name: 'VictoriaTraces',
    skip: SKIP_BACKENDS.has('victoriatraces'),
    container: 'victoriatraces',
    stopCmd: 'docker compose stop victoriatraces',
    startCmd: 'docker compose start victoriatraces',
    healthUrl: 'http://victoriatraces:10428/select/jaeger/api/services',
    queryFn: (traceId) => queryTrace(traceId),
    verifyResult: (result) =>
      result !== null && result.spans && result.spans.length > 0,
  },
  {
    name: 'VictoriaLogs',
    skip: SKIP_BACKENDS.has('victorialogs'),
    container: 'victorialogs',
    stopCmd: 'docker compose stop victorialogs',
    startCmd: 'docker compose start victorialogs',
    healthUrl: 'http://victorialogs:9428/health',
    queryFn: (traceId) => queryLogs(traceId, 180),
    verifyResult: (result) => Array.isArray(result) && result.length > 0,
  },
];

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

/**
 * Execute a docker compose command and return output.
 * @param {string} cmd
 * @returns {string}
 */
function dockerExec(cmd) {
  try {
    return execSync(cmd, {
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err.stderr || err.message;
    throw new Error(`Docker command failed: ${msg}`, { cause: err });
  }
}

/**
 * Generate a known request through Kong with a traceparent.
 * @param {string} [marker] - URL marker suffix
 * @returns {string} traceId
 */
async function generateRequest(marker) {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  const traceparent = buildTraceparent(traceId, spanId);
  const url = `${KONG_URL}/api/melt-chaos-${marker || Date.now()}`;

  await fetch(url, {
    headers: { traceparent, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  return traceId;
}

/**
 * Wait for a backend to become healthy.
 * @param {string} healthUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitForHealthy(healthUrl, timeoutMs = RESTART_TIMEOUT * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkServiceHealth(healthUrl, 3000)) {
      return;
    }
    await sleep(2000);
  }
  throw new Error(
    `Backend not healthy after ${timeoutMs / 1000}s at ${healthUrl}`,
  );
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
 * Test: Baseline — verify all backends healthy before chaos.
 */
async function testPrerequisites() {
  const otelOk = await checkServiceHealth(OTEL_COLLECTOR_URL);
  assertCondition(otelOk, `OTel Collector not healthy at ${OTEL_COLLECTOR_URL}`);

  for (const backend of BACKENDS) {
    if (backend.skip) {
      console.log(`    ${backend.name}: SKIPPED`);
      continue;
    }
    const ok = await checkServiceHealth(backend.healthUrl);
    assertCondition(ok, `${backend.name} not healthy at ${backend.healthUrl}`);
    console.log(`    ${backend.name}: healthy`);
  }
}

/**
 * Test: Baseline trace appears in backend (pre-chaos).
 */
async function testBaselineTrace(backend) {
  const traceId = await generateRequest('baseline');
  console.log(`    baseline trace_id: ${traceId}`);

  console.log(`    Waiting ${PROPAGATION_DELAY}s for propagation...`);
  await sleep(PROPAGATION_DELAY * 1000);

  const result = await backend.queryFn(traceId);
  assertCondition(
    backend.verifyResult(result),
    `Baseline trace ${traceId} not found in ${backend.name}`,
  );
}

/**
 * Test: Stop backend and generate outage requests.
 * Verifies OTel Collector stays healthy during outage.
 */
async function testOutagePhase(backend) {
  // Stop backend
  console.log(`    Stopping ${backend.container}...`);
  dockerExec(backend.stopCmd);

  // Verify backend is actually down
  await sleep(3000);
  const down = !(
    await checkServiceHealth(backend.healthUrl, 3000)
  );
  assertCondition(down, `${backend.name} still responding after stop`);

  // Verify OTel Collector is still healthy
  const otelOk = await checkServiceHealth(OTEL_COLLECTOR_URL);
  assertCondition(
    otelOk,
    'OTel Collector became unhealthy during backend outage',
  );

  // Generate requests during outage
  const outageTraceIds = [];
  for (let i = 0; i < OUTAGE_REQUESTS; i++) {
    const traceId = await generateRequest(`outage-${backend.container}-${i}`);
    outageTraceIds.push(traceId);
    console.log(`    outage[${i}] trace_id: ${traceId}`);
  }

  return outageTraceIds;
}

/**
 * Test: Restart backend and verify zero data loss.
 */
async function testRecoveryPhase(backend, outageTraceIds) {
  // Restart backend
  console.log(`    Starting ${backend.container}...`);
  dockerExec(backend.startCmd);

  // Wait for healthy
  await waitForHealthy(backend.healthUrl);
  console.log(`    ${backend.name} is healthy`);

  // Wait for data propagation
  const waitTime = Math.max(PROPAGATION_DELAY, 20);
  console.log(`    Waiting ${waitTime}s for data replay...`);
  await sleep(waitTime * 1000);

  // Verify ALL outage trace IDs appear (zero data loss)
  let missing = 0;
  for (const traceId of outageTraceIds) {
    let found = false;
    for (let retry = 0; retry < 3; retry++) {
      const result = await backend.queryFn(traceId);
      if (backend.verifyResult(result)) {
        found = true;
        break;
      }
      console.log(`    ${traceId} not found, retry ${retry + 1}/3`);
      await sleep(10000);
    }
    if (!found) {
      missing++;
      console.log(`    ❌ LOST: ${traceId}`);
    }
  }

  assertCondition(
    missing === 0,
    `Data loss: ${missing}/${outageTraceIds.length} traces missing from ${backend.name}`,
  );

  console.log(
    `    All ${outageTraceIds.length} outage traces recovered (zero data loss)`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('═'.repeat(55));
  console.log('  Chaos Resilience Test (AC#4, AC#5)');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═'.repeat(55));
  console.log('');

  // 1. Prerequisites
  await runTest(
    'AC8 — Prerequisites: Collector and all backends healthy',
    testPrerequisites,
  );

  // Run chaos sequence for each backend
  for (const backend of BACKENDS) {
    if (backend.skip) {
      console.log(`\n  ⏭️  ${backend.name}: SKIPPED (SKIP_BACKENDS)`);
      continue;
    }

    console.log(`\n  ── ${backend.name} ──`);

    // Baseline
    await runTest(
      `AC4 — ${backend.name}: baseline trace verified`,
      async () => {
        await testBaselineTrace(backend);
      },
    );

    // Outage phase
    let outageTraceIds;
    await runTest(
      `AC4 — ${backend.name}: outage phase (${OUTAGE_REQUESTS} requests, Collector healthy)`,
      async () => {
        outageTraceIds = await testOutagePhase(backend);
      },
    );

    // Recovery phase
    await runTest(
      `AC5 — ${backend.name}: zero data loss after restart`,
      async () => {
        await testRecoveryPhase(backend, outageTraceIds);
      },
    );
  }

  // JUnit report
  generateJUnitReport(results, JUNIT_OUTPUT, 'melt-chaos');
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
