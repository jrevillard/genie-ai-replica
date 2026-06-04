// k6 benchmark: Custom metrics SDK overhead
// Measures the overhead of instrumenting HTTP requests with OTel custom metrics.
//
// Usage:
//   ENABLE_METRICS=true k6 run tests/metrics-overhead/k6-metrics-overhead.js \
//     -e BASE_URL=http://localhost:443/api/health \
//     -e TOKEN=<your-token>
//
// Compare with:
//   ENABLE_METRICS=false k6 run tests/metrics-overhead/k6-metrics-overhead.js \
//     -e BASE_URL=http://localhost:443/api/health \
//     -e TOKEN=<your-token>
//
// The difference in median response time is the metrics SDK overhead.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:443/api/health';
const TOKEN = __ENV.TOKEN || '';
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '30s';

// k6 built-in metrics for comparison
const reqDuration = new Trend('req_duration');
const reqRate = new Rate('req_rate');

const params = {
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: '30s',
};

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    // Metrics overhead should be < 5ms P95 (otherwise there's a bug)
    'req_duration{p(95)}': ['p(95)<5'], // 5ms
  },
};

export default function () {
  // Hit a lightweight health endpoint to isolate middleware overhead
  const res = http.get(`${BASE_URL}`, null, params);

  check(res, {
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  reqDuration.add(res.timings.duration);

  sleep(0.1);
}
