/**
 * workers/crawlWorkerSupervisor.js
 *
 * Runs on the MAIN thread: spawns the crawl worker thread and respawns it
 * with exponential backoff when it dies.
 *
 * Bounded by design: consecutive failures back off 5s → 10s → ... → 80s,
 * and after MAX_CONSECUTIVE_FAILURES the supervisor gives up (reports
 * `gaveUp` in getStatus(), surfaced by /health) and re-arms itself only
 * after a long cooldown — a persistent crash loop cannot spin forever, but
 * the queue also cannot stay dead until a manual restart. A run of
 * HEALTHY_UPTIME_MS resets the backoff, so one flaky crash never consumes
 * the budget of a persistent failure.
 */

const { Worker } = require('worker_threads');
const path = require('path');

const { logger } = require('../shared-lib');

const RESTART_BASE_DELAY_MS = 5000;
const RESTART_MAX_ATTEMPTS = 5; // max delay = base * 2^(attempts-1) = 80s
const HEALTHY_UPTIME_MS = 10 * 60 * 1000;
const REARM_COOLDOWN_MS = 30 * 60 * 1000;

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
let stopping = false;

const spawn = () => {
  try {
    // Eval-spawn: run crawlWorker.js's start() inside the thread.
    const w = new Worker(
      `
      const { start } = require('${workerPath.replace(/\\/g, '/')}');
      start();
    `,
      { eval: true }
    );
    // Construction succeeded — only now does a worker exist to report on.
    worker = w;
    spawnedAt = Date.now();
    state.running = true;
    w.on('error', (err) => logger.error(`Crawl Worker Error: ${err.message}`, err));
    w.on('exit', (code) => onExit(code));
  } catch (error) {
    // `new Worker` throws when the thread cannot be created (resource limits,
    // degraded process state) — handle it like a crash so the backoff and the
    // give-up cap apply instead of the exception reaching the timer callback
    // and killing the API process as an uncaughtException. A failed
    // construction had no run time: anchor spawnedAt to now so the healthy-
    // reset below cannot treat the attempt as a healthy long run.
    logger.error(`Crawl Worker spawn failed: ${error.message}`, error);
    spawnedAt = Date.now();
    onExit(-1);
  }
};

const scheduleRestart = () => {
  const delay = RESTART_BASE_DELAY_MS * 2 ** (consecutiveFailures - 1);
  logger.error(`Respawning Crawl Worker in ${delay}ms (attempt ${consecutiveFailures}/${RESTART_MAX_ATTEMPTS})`);
  // No `stopping` re-check here: onExit is the single respawn gate, and stop()
  // clears this timer before it can fire. A callback already dequeued in the
  // same tick as stop() may still spawn once — harmless during shutdown.
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawn();
  }, delay);
};

const onExit = (code) => {
  if (stopping) return; // deliberate stop (graceful shutdown) — never respawn
  state.running = false;
  state.lastExitCode = code;
  state.lastExitAt = new Date().toISOString();
  worker = null;

  if (code === 0) return; // clean exit — do not respawn

  const uptime = Date.now() - spawnedAt;
  if (uptime >= HEALTHY_UPTIME_MS) consecutiveFailures = 0;
  consecutiveFailures += 1;
  state.restarts += 1;

  logger.error(`Crawl Worker exited with code ${code} (failure ${consecutiveFailures}/${RESTART_MAX_ATTEMPTS})`, {
    lastExitCode: code,
    restarts: state.restarts
  });

  if (consecutiveFailures > RESTART_MAX_ATTEMPTS) {
    state.gaveUp = true;
    logger.error(
      `Crawl Worker failed ${consecutiveFailures} times in a row — giving up; re-arming in ${REARM_COOLDOWN_MS / 60000} min`,
      { lastExitCode: code, restarts: state.restarts }
    );
    // Not terminal: after a long cooldown, try again. The startup zombie
    // requeue in crawlWorker recovers whatever job the dead run held.
    restartTimer = setTimeout(() => {
      restartTimer = null;
      consecutiveFailures = 0;
      state.gaveUp = false;
      spawn();
    }, REARM_COOLDOWN_MS);
    return;
  }

  scheduleRestart();
};

const start = () => {
  stopping = false;
  consecutiveFailures = 0;
  state.gaveUp = false;
  spawn();
};

const stop = () => {
  stopping = true;
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
