/**
 * workers/crawlWorkerSupervisor.js
 *
 * Runs on the MAIN thread: spawns the crawl worker thread and respawns it
 * with a bounded exponential backoff when it dies (issue #991).
 *
 * Before this module the worker thread was spawned once in server.js and its
 * exit handler only logged — an OOM death left every crawl job silently
 * Pending forever while the container stayed healthy.
 *
 * Bounded by design: consecutive crashes back off 5s → 10s → ... capped at
 * 5 minutes, and after MAX_CONSECUTIVE_FAILURES the supervisor gives up and
 * reports `gaveUp` in getStatus() (surfaced by /health) instead of spinning
 * forever. A run of HEALTHY_UPTIME_MS resets the backoff, so one flaky crash
 * never consumes the budget of a persistent failure.
 */

const { Worker } = require('worker_threads');
const path = require('path');

const { logger } = require('../shared-lib');

const RESTART_BASE_DELAY_MS = 5000;
const RESTART_MAX_DELAY_MS = 5 * 60 * 1000;
const RESTART_MAX_ATTEMPTS = 5;
const HEALTHY_UPTIME_MS = 10 * 60 * 1000;

const workerPath = path.resolve(__dirname, 'crawlWorker.js');

const state = {
  running: false,
  restarts: 0,
  lastExitCode: null,
  lastExitAt: null,
  gaveUp: false
};

let worker = null;
let restartTimer = null;
let spawnedAt = 0;
let consecutiveFailures = 0;

const spawn = () => {
  spawnedAt = Date.now();
  state.running = true;
  // Same eval-spawn as before: run crawlWorker.js's start() inside the thread.
  worker = new Worker(
    `
    const { start } = require('${workerPath.replace(/\\/g, '/')}');
    start();
  `,
    { eval: true }
  );
  worker.on('error', (err) => logger.error(`Crawl Worker Error: ${err.message}`, err));
  worker.on('exit', (code) => onExit(code));
};

const onExit = (code) => {
  state.running = false;
  state.lastExitCode = code;
  state.lastExitAt = new Date().toISOString();
  worker = null;

  if (code === 0) return; // clean exit (process shutdown) — do not respawn

  logger.error(`Crawl Worker exited with code ${code}; ${state.restarts} restart(s) so far`, {
    lastExitCode: code,
    restarts: state.restarts
  });

  const uptime = Date.now() - spawnedAt;
  if (uptime >= HEALTHY_UPTIME_MS) consecutiveFailures = 0;
  consecutiveFailures += 1;
  state.restarts += 1;

  if (consecutiveFailures > RESTART_MAX_ATTEMPTS) {
    state.gaveUp = true;
    logger.error(
      `Crawl Worker failed ${consecutiveFailures} times in a row — giving up, crawl jobs will starve until the service restarts`,
      { lastExitCode: code, restarts: state.restarts }
    );
    return;
  }

  const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), RESTART_MAX_DELAY_MS);
  logger.error(`Respawning Crawl Worker in ${delay}ms (attempt ${consecutiveFailures}/${RESTART_MAX_ATTEMPTS})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawn();
  }, delay);
};

const start = () => {
  consecutiveFailures = 0;
  state.gaveUp = false;
  spawn();
};

const stop = () => {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
  state.running = false;
};

const getStatus = () => ({ ...state });

module.exports = { start, stop, getStatus };
