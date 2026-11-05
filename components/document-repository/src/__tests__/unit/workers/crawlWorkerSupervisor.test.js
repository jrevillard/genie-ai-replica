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
    this.terminate = jest.fn().mockResolvedValue(0);
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

  it('does not respawn after a clean exit (code 0)', () => {
    mod.start();
    FakeWorker.instances[0].emit('exit', 0);
    jest.runAllTimers();
    jest.advanceTimersByTime(3600000);
    expect(WorkerMock).toHaveBeenCalledTimes(1);
    expect(mod.getStatus()).toMatchObject({ running: false, lastExitCode: 0, gaveUp: false });
  });

  it('logs the exit at error level so the death is observable', () => {
    mod.start();
    loggerMock.error.mockClear();
    FakeWorker.instances[0].emit('exit', 1);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('exit'), expect.anything());
  });

  it('cancelles a pending respawn on stop', () => {
    mod.start();
    FakeWorker.instances[0].emit('exit', 1);
    mod.stop();
    jest.runAllTimers();
    expect(WorkerMock).toHaveBeenCalledTimes(1);
  });

  it('never respawns after stop, even when the terminate-triggered exit fires late', () => {
    mod.start();
    mod.stop(); // terminate() → the real worker fires 'exit' AFTER stop returns
    FakeWorker.instances[0].emit('exit', 1);
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
    expect(mod.getStatus()).toMatchObject({ running: false, restarts: 2 }); // exit + failed spawn
    // And the backoff continues: 10s later a fresh spawn is attempted.
    jest.advanceTimersByTime(10000);
    expect(WorkerMock).toHaveBeenCalledTimes(3);
    expect(mod.getStatus().running).toBe(true);
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
