// Supervisor tests — respawn-on-exit contract (issue #991).
// The supervisor's whole job: a dead crawl worker thread must never leave the
// crawl queue silent. These tests drive the real module with a fake Worker
// class and mock Date/timers, so the backoff math and the give-up cap are
// asserted against observed spawn timestamps, not implementation internals.

const { EventEmitter } = require('events');

jest.mock('worker_threads', () => ({
  Worker: jest.fn()
}));
// The module is re-required per test inside isolateModules (fresh state) —
// which re-runs the worker_threads and shared-lib mock factories too, so the
// module's Worker and logger mocks are re-fetched after each reset (a handle
// kept from before the reset would silently point at a different instance).
let mod;
let WorkerMock;
let loggerMock;

// Fake Worker: an EventEmitter that records constructor calls. Each test
// triggers lifecycle events on the instance the supervisor holds.
class FakeWorker extends EventEmitter {
  constructor() {
    super();
    // The real Worker delivers 'exit' ASYNCHRONOUSLY after terminate() — the
    // fake must too, otherwise the stale-exit path (a terminated worker's exit
    // arriving after a fresh worker was spawned) is never exercised.
    this.terminate = jest.fn().mockImplementation(() => {
      Promise.resolve().then(() => this.emit('exit', 1));
      return Promise.resolve(0);
    });
    FakeWorker.instances.push(this);
  }
}
FakeWorker.instances = [];

beforeEach(() => {
  jest.useFakeTimers();
  FakeWorker.instances = [];
  // fresh module state per test
  jest.resetModules();
  jest.isolateModules(() => {
    mod = require('../../../workers/crawlWorkerSupervisor');
    WorkerMock = require('worker_threads').Worker;
    WorkerMock.mockImplementation(() => new FakeWorker());
    loggerMock = require('../../../__tests__/__mocks__/shared-lib').logger;
  });
});

afterEach(() => {
  mod.stop();
  jest.useRealTimers();
});

describe('crawlWorkerSupervisor', () => {
  it('spawns one worker on start and reports it running', () => {
    mod.start();
    expect(WorkerMock).toHaveBeenCalledTimes(1);
    expect(mod.getStatus()).toMatchObject({ running: true, restarts: 0, gaveUp: false });
  });

  it('respawns after the base delay when the worker exits non-zero', () => {
    mod.start();
    const first = FakeWorker.instances[0];
    first.emit('exit', 1);
    expect(mod.getStatus()).toMatchObject({ running: false, lastExitCode: 1 });

    jest.advanceTimersByTime(4000);
    expect(WorkerMock).toHaveBeenCalledTimes(1); // base delay is 5s — not yet

    jest.advanceTimersByTime(1000);
    expect(WorkerMock).toHaveBeenCalledTimes(2);
    expect(mod.getStatus()).toMatchObject({ running: true, restarts: 1 });
  });

  it('backs off exponentially across consecutive failures', () => {
    mod.start();
    // 5s, then 10s, then 20s...
    FakeWorker.instances[0].emit('exit', 1);
    jest.advanceTimersByTime(5000);
    expect(WorkerMock).toHaveBeenCalledTimes(2);

    FakeWorker.instances[1].emit('exit', 1);
    jest.advanceTimersByTime(9999);
    expect(WorkerMock).toHaveBeenCalledTimes(2); // 10s delay not elapsed
    jest.advanceTimersByTime(1);
    expect(WorkerMock).toHaveBeenCalledTimes(3);

    FakeWorker.instances[2].emit('exit', 1);
    jest.advanceTimersByTime(19999);
    expect(WorkerMock).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    expect(WorkerMock).toHaveBeenCalledTimes(4);
  });

  it('gives up after the cap of consecutive failures and holds through the cooldown window', () => {
    mod.start();
    // 5 failures with respawns between them, then the 6th exit trips the cap.
    for (let i = 0; i < 5; i++) {
      FakeWorker.instances[i].emit('exit', 1);
      jest.runAllTimers();
    }
    FakeWorker.instances[5].emit('exit', 1);
    const spawnsAfterCap = WorkerMock.mock.calls.length;
    expect(mod.getStatus()).toMatchObject({ gaveUp: true, running: false });
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('giving up'), expect.anything());

    // No respawn while the re-arm cooldown is still running.
    jest.advanceTimersByTime(25 * 60 * 1000);
    expect(WorkerMock.mock.calls.length).toBe(spawnsAfterCap);
  });

  it('resets the backoff after a healthy run', () => {
    mod.start();
    // Two quick crashes push the delay to 10s; the next worker then runs
    // healthy for ≥ HEALTHY_UPTIME_MS before crashing, so the crash that
    // follows must be delayed by the BASE 5s again (backoff reset) — not by
    // the accumulated 20s a third consecutive failure would get.
    FakeWorker.instances[0].emit('exit', 1);
    jest.advanceTimersByTime(5000);
    FakeWorker.instances[1].emit('exit', 1);
    jest.advanceTimersByTime(10000); // third spawn, running healthy now
    jest.advanceTimersByTime(10 * 60 * 1000);
    FakeWorker.instances[2].emit('exit', 1);

    jest.advanceTimersByTime(4999);
    expect(WorkerMock).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    expect(WorkerMock).toHaveBeenCalledTimes(4);
  });

  it('respawns even after a clean exit (the thread never exits on its own)', () => {
    // The worker thread never terminates by design — an exit 0 means it died
    // quietly, which is exactly the silent death this supervisor exists for.
    // (The deliberate stop() path is gated separately by `stopping`.)
    mod.start();
    FakeWorker.instances[0].emit('exit', 0);
    jest.advanceTimersByTime(5000);
    expect(WorkerMock).toHaveBeenCalledTimes(2);
    expect(mod.getStatus()).toMatchObject({ running: true, lastExitCode: 0, gaveUp: false });
  });

  it('logs the exit at error level so the death is observable', () => {
    mod.start();
    loggerMock.error.mockClear();
    FakeWorker.instances[0].emit('exit', 1);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('exit'), expect.anything());
  });

  it('cancels a pending respawn on stop', () => {
    mod.start();
    FakeWorker.instances[0].emit('exit', 1);
    mod.stop();
    jest.runAllTimers();
    expect(WorkerMock).toHaveBeenCalledTimes(1);
  });

  it('a second start() does not leak a second worker or a pending timer', async () => {
    mod.start();
    mod.start(); // re-entry while the first worker is LIVE: stop it, spawn fresh
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    expect(WorkerMock).toHaveBeenCalledTimes(2);

    // The terminated worker's exit arrives late — it must NOT clear the live
    // worker's state nor arm a respawn (the stale-exit guard).
    await Promise.resolve();
    jest.runAllTimers();
    expect(WorkerMock).toHaveBeenCalledTimes(2);
    expect(mod.getStatus()).toMatchObject({ running: true });

    FakeWorker.instances[1].emit('exit', 1); // the live worker dies
    jest.runAllTimers();
    expect(WorkerMock).toHaveBeenCalledTimes(3); // normal respawn — no stacked timer
  });

  it('a second start() clears a pending respawn timer instead of stacking on it', () => {
    mod.start();
    FakeWorker.instances[0].emit('exit', 1); // respawn timer armed
    mod.start();
    jest.runAllTimers();
    expect(WorkerMock).toHaveBeenCalledTimes(2); // initial + the re-entry spawn only
    expect(mod.getStatus()).toMatchObject({ running: true });
  });

  it('never respawns after stop, even when the terminate-triggered exit fires late', async () => {
    mod.start();
    mod.stop(); // terminate() → the fake fires 'exit' on the next microtask
    await Promise.resolve();
    jest.runAllTimers();
    jest.advanceTimersByTime(3600000);
    expect(WorkerMock).toHaveBeenCalledTimes(1);
    // The late exit must not churn supervisor state either — onExit is the
    // single respawn gate and it is closed once stopped.
    expect(mod.getStatus()).toMatchObject({ running: false, gaveUp: false, restarts: 0, lastExitCode: null });
  });

  it('handles a spawn failure like a crash instead of throwing out of the timer', () => {
    mod.start();
    FakeWorker.instances[0].emit('exit', 1);
    // Next construction attempt throws (degraded process, resource limits).
    WorkerMock.mockImplementationOnce(() => {
      throw new Error('thread creation failed');
    });
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    // running must be false (no worker exists) and the failure must count.
    // exit of the run that died; the failed construction is NOT a restart
    expect(mod.getStatus()).toMatchObject({ running: false, restarts: 1 });
    // And the backoff continues: 10s later a fresh spawn is attempted.
    jest.advanceTimersByTime(10000);
    expect(WorkerMock).toHaveBeenCalledTimes(3);
    expect(mod.getStatus().running).toBe(true);
  });

  it('a healthy run followed by persistent spawn failures still reaches the give-up cap', () => {
    mod.start();
    // Healthy uptime, crash, then every construction attempt throws — each
    // failed attempt had ZERO run time, so the healthy-reset must not keep
    // resetting the counter (otherwise the cap never trips and the supervisor
    // spawns in a 5s loop forever).
    jest.advanceTimersByTime(10 * 60 * 1000);
    FakeWorker.instances[0].emit('exit', 1);
    WorkerMock.mockImplementation(() => {
      throw new Error('thread creation failed');
    });
    // Bounded advances cover the whole failure ladder (each failed spawn
    // schedules the next attempt; the last step lands at +80s, hence the
    // second window. A bare runAllTimers would chase the self-rescheduling
    // chain forever).
    jest.advanceTimersByTime(120000);
    jest.advanceTimersByTime(120000);
    expect(mod.getStatus()).toMatchObject({ gaveUp: true, running: false });
  });

  it('re-arms after the give-up cooldown instead of staying dead forever', () => {
    mod.start();
    // 5 failures with respawns between them, then the 6th exit trips the cap.
    // (runAllTimers inside the loop must NOT fire here — it would consume the
    // rearm cooldown too.)
    for (let i = 0; i < 5; i++) {
      FakeWorker.instances[i].emit('exit', 1);
      jest.runAllTimers();
    }
    FakeWorker.instances[5].emit('exit', 1);
    expect(mod.getStatus().gaveUp).toBe(true);

    // Still dead right after the cap, alive again after the 30 min cooldown.
    jest.advanceTimersByTime(29 * 60 * 1000);
    expect(mod.getStatus().gaveUp).toBe(true);
    jest.advanceTimersByTime(60 * 1000);
    expect(mod.getStatus()).toMatchObject({ gaveUp: false, running: true });
    expect(WorkerMock).toHaveBeenCalledTimes(7);
  });
});
