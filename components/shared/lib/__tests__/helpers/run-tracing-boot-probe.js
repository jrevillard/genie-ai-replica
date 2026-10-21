'use strict';

// Spawns tracing-boot-probe.js against one component's tracing.js and returns
// its parsed result. Shared so the backend and document-repository assert the
// same contract the same way instead of each re-deriving the probe env.

const path = require('path');
const { execFileSync } = require('child_process');

const SENTINEL = '__TRACING_BOOT_RESULT__';
const PROBE = path.join(__dirname, 'tracing-boot-probe.js');
const SHARED_LIB = path.resolve(__dirname, '..', '..');

/**
 * @param {object} options
 * @param {string} options.componentDir absolute path to the component root (its
 *   `node_modules` is what the probe resolves the OTel packages from)
 * @param {string} options.tracingFile tracing.js path relative to componentDir
 * @returns {{booted: boolean, error?: string, sdkPresent?: boolean,
 *   tracerIsLive?: boolean, propagatorFields?: string[], carrierKeys?: string[],
 *   baggage?: string}}
 */
function runTracingBootProbe({ componentDir, tracingFile }) {
  // A hand-built env rather than `{ ...process.env }`: the parent is a Jest
  // worker, and inheriting its NODE_ENV=test — or any OTel variable a previous
  // suite left behind — would silently put tracing.js back on its no-op branch
  // and make this probe assert nothing.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'development',
    ENABLE_OBSERVABILITY: '1',
    SHARED_LIB,
    NODE_PATH: path.join(componentDir, 'node_modules'),
    TRACING_PATH: path.join(componentDir, tracingFile)
  };

  let stdout;
  try {
    // Generous, because the probe really is slow: loading
    // `@opentelemetry/auto-instrumentations-node` pulls in ~80 instrumentation
    // packages, which is most of the wall clock. That is the cost of booting
    // the real file, and it is the only way to reach the branch that breaks.
    stdout = execFileSync(process.execPath, [PROBE], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000
    });
  } catch (err) {
    // Exit code 1 means "the module did not boot" — which is exactly the
    // regression this probe exists to catch, so surface the payload rather than
    // the spawn failure. A missing sentinel is a probe bug and still throws.
    if (err.status !== 1 || !err.stdout) throw err;
    stdout = err.stdout;
  }

  const line = stdout.split('\n').find((l) => l.startsWith(SENTINEL));
  if (!line) {
    throw new Error(`tracing boot probe produced no result line. Output tail:\n${stdout.slice(-800)}`);
  }
  return JSON.parse(line.slice(SENTINEL.length));
}

module.exports = { runTracingBootProbe };
