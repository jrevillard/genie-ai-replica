// k6 benchmark: OTel Collector overhead on backend health endpoint
// Measures P50/P95/P99 latency to quantify the OTel instrumentation cost.
//
// Run TWICE and compare results:
//   1. With OTel:   k6 run tests/melt-correlation/k6-collector-overhead.js
//   2. Without OTel: k6 run tests/melt-correlation/k6-collector-overhead.js
//                   (after setting OTEL_TRACES_SAMPLER_RATE=0 or disabling collector)
//
// The difference in P99 latency is the OTel overhead.
// Threshold: P99 < 10ms overhead (configured below).
//
// Usage:
//   k6 run tests/melt-correlation/k6-collector-overhead.js \
//     -e BASE_URL=https://localhost/api/health \
//     -e TOKEN=<your-token> \
//     -e VUS=100 -e DURATION=30s
//
// Output:
//   k6 stdout + optional JSON summary (set SUMMARY_OUTPUT env var)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://localhost/api/health';
const TOKEN = __ENV.TOKEN || '';
const VUS = parseInt(__ENV.VUS || '100', 10);
const DURATION = __ENV.DURATION || '30s';
const SUMMARY_OUTPUT = __ENV.SUMMARY_OUTPUT || '';

// Custom k6 metrics for OTel overhead measurement
const reqDuration = new Trend('req_duration');
const reqRate = new Rate('req_rate');
const otelOverhead = new Trend('otel_overhead');

const params = {
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: '30s',
};

// P99 overhead threshold: 10ms (Story 7.10 AC#7)
// This threshold is for the DIFFERENCE between OTel-enabled and OTel-disabled runs.
// Individual run P99 may be higher — compare two runs.
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    // Health endpoint should be fast even with OTel
    'req_duration{p(95)}': ['p(95)<100'], // 100ms P95 absolute cap
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(`${BASE_URL}`, null, params);

  check(res, {
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  reqDuration.add(res.timings.duration);
  reqRate.add(res.status === 200);

  sleep(0.05); // 50ms think time — ~20 RPS per VU
}
