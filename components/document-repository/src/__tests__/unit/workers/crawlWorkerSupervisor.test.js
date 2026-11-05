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

  it('gives up after the cap of consecutive failures and stops respawning', () => {
    mod.start();
    // Fail the initial spawn + 5 capped respawns.
    for (let i = 0; i < 6; i++) {
      const instance = FakeWorker.instances[i];
      instance.emit('exit', 1);
      jest.runAllTimers();
    }
    const spawnsAfterCap = WorkerMock.mock.calls.length;
    expect(mod.getStatus()).toMatchObject({ gaveUp: true, running: false });

    // No further respawn attempt, however long we wait.
    jest.advanceTimersByTime(3600000);
    expect(WorkerMock.mock.calls.length).toBe(spawnsAfterCap);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('giving up'), expect.anything());
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
});
