// D4b: pins the CPU-translation worker respawn state machine — the live 09-29
// incident had a single failed model download ("terminated" at 30s) orphan the
// init loop forever (supervisor nulled the worker and never respawned → whole
// API 502). Contract: exit → respawn after 30s backoff, max 3 attempts, one
// ERROR past the cap, successful init resets the counter.
jest.mock('worker_threads', () => {
  const { EventEmitter } = require('events');
  const spawns = [];
  class MockWorker extends EventEmitter {
    constructor(path, opts) {
      super();
      this.path = path;
      this.opts = opts;
      spawns.push(this);
    }
    postMessage(msg) {
      this.lastMessage = msg;
    }
    terminate() {
      return Promise.resolve();
    }
  }
  return { Worker: MockWorker, spawns, parentPort: null, workerData: {} };
});

const { Worker, spawns } = require('worker_threads');
const CpuTranslateBackend = require('../services/translation/cpu-translate-backend');

// Timers: the 30s respawn backoff is real setTimeout — fake timers keep it fast.
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks(); // logger call-counts are per-test (no global clearMocks)
  spawns.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('cpu-translate-backend worker respawn (D4b)', () => {
  it('constructor spawns the first worker and sends init', () => {
    new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    expect(spawns).toHaveLength(1);
    expect(spawns[0].lastMessage).toEqual({ type: 'init' });
  });

  it('worker exit → respawn scheduled after 30s backoff', () => {
    new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    expect(spawns).toHaveLength(1);
    spawns[0].emit('exit', 1);
    expect(spawns).toHaveLength(1); // not before the backoff
    jest.advanceTimersByTime(30000);
    expect(spawns).toHaveLength(2); // respawned
    expect(spawns[1].lastMessage).toEqual({ type: 'init' });
  });

  it('3 failures → no 4th spawn; a 4th exit does not schedule more', () => {
    new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    for (let i = 0; i < 3; i++) {
      spawns[spawns.length - 1].emit('exit', 1);
      jest.advanceTimersByTime(30000);
    }
    expect(spawns).toHaveLength(4); // initial + 3 respawns
    // the 3rd respawn also dies — past the cap, no 5th
    spawns[3].emit('exit', 1);
    jest.advanceTimersByTime(120000);
    expect(spawns).toHaveLength(4);
  });

  it('successful init resets the attempt counter', () => {
    const b = new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    // one failure + respawn…
    spawns[0].emit('exit', 1);
    jest.advanceTimersByTime(30000);
    expect(spawns).toHaveLength(2);
    // …then success resets…
    spawns[1].emit('message', { type: 'init', success: true });
    expect(b.workerReady).toBe(true);
    // …so three MORE failures still earn respawns (fresh budget)
    for (let i = 0; i < 3; i++) {
      spawns[spawns.length - 1].emit('exit', 1);
      jest.advanceTimersByTime(30000);
    }
    expect(spawns).toHaveLength(5);
  });

  it('init-FAILURE message terminates the zombie worker → exit → respawn engages', () => {
    new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    const terminate = jest.fn().mockResolvedValue(undefined);
    spawns[0].terminate = terminate;
    spawns[0].emit('message', { type: 'init', success: false, error: 'terminated' });
    expect(terminate).toHaveBeenCalled(); // zombie killed…
    spawns[0].emit('exit', 0); // …exit handler takes over
    jest.advanceTimersByTime(30000);
    expect(spawns).toHaveLength(2); // respawn engaged
  });

  it('worker exit rejects queued translations (no hour-long hang)', () => {
    const b = new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    const reject = jest.fn();
    b.messageQueue.set('msg-1', { resolve: jest.fn(), reject });
    spawns[0].emit('exit', 1);
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: 'Translation worker died' }));
    expect(b.messageQueue.size).toBe(0);
  });

  it('past the cap: further exits log the give-up ERROR exactly once (not per exit)', () => {
    new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    for (let i = 0; i < 3; i++) {
      spawns[spawns.length - 1].emit('exit', 1);
      jest.advanceTimersByTime(30000);
    }
    spawns[3].emit('exit', 1);
    spawns[3].emit('exit', 1); // two more deaths past the cap
    jest.advanceTimersByTime(120000);
    const { logger } = require('../mocks/shared-lib.js');
    const giveUps = logger.error.mock.calls.filter(c => String(c[0]).includes('3 init attempts')).length;
    expect(giveUps).toBe(1);
  });

  it('shutdown() stops all respawning', () => {
    const b = new CpuTranslateBackend('Xenova/nllb-200-distilled-600M');
    b.shutdown();
    spawns[0].emit('exit', 1);
    jest.advanceTimersByTime(120000);
    expect(spawns).toHaveLength(1);
  });
});
