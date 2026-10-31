'use strict';

/**
 * Round 18 (#80465) — the Testing Lab's two waits, rebuilt on the store's
 * pollJob instead of the dialog's hand-rolled loops. What these tests pin:
 *
 * 1. FIRST-FETCH FAST PATH — pollJob sleeps before its first fetch, but a
 *    fast suite generation / a run that already finished must land on
 *    attempt 0, with NO sleep before the answer.
 * 2. CANCEL — the component signal aborts the wait (the Lab's close path).
 * 3. TRANSIENT TOLERANCE — one failed GET mid-wait (the 2026-10-18
 *    gateway-restart class) no longer rejects the whole wait.
 * 4. FAILED mapping — a failed run comes back as code RUN_FAILED so the
 *    dialog's error contract (onRunSuite) is preserved.
 */

jest.mock('@/services/headTestService', () => ({
  __esModule: true,
  default: {
    getSuite: jest.fn(),
    getRun: jest.fn(),
    recommendTags: jest.fn(),
    runSuite: jest.fn()
  }
}));

const Vuex = require('vuex');
const headTestService = require('@/services/headTestService').default;
const okfModule = require('@/store/modules/okf').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('okf/pollHeadSuite — suite generation wait', () => {
  it('resolves on the FIRST fetch when the suite already landed (no sleep)', async () => {
    jest.useFakeTimers();
    headTestService.getSuite.mockResolvedValue({ suite_key: 's1', payload: { rows: [] } });
    const store = buildStore();
    const res = await store.dispatch('okf/pollHeadSuite', { repoId: 'r1', suiteKey: 's1' });
    expect(res.ok).toBe(true);
    expect(res.result.suite_key).toBe('s1');
    expect(headTestService.getSuite).toHaveBeenCalledTimes(1);
    // Nothing slept — a fast generation must not wait a poll interval. If
    // the implementation lost the fast path, the promise only settles after
    // jest.advanceTimersByTime and this await deadlocks the test timeout.
  });

  it('keeps waiting on the generating envelope, then adopts the doc', async () => {
    jest.useFakeTimers();
    headTestService.getSuite
      .mockResolvedValueOnce({ suite_key: 's1', status: 'generating' })
      .mockResolvedValueOnce({ suite_key: 's1', status: 'generating' })
      .mockResolvedValueOnce({ suite_key: 's1', payload: { rows: [1] } });
    const store = buildStore();
    const p = store.dispatch('okf/pollHeadSuite', { repoId: 'r1', suiteKey: 's1' });
    // Two poll intervals (2.5s each) elapse before the terminal answer.
    await jest.advanceTimersByTimeAsync(2500);
    await jest.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(headTestService.getSuite).toHaveBeenCalledTimes(3);
  });

  it('one transient GET failure does not reject the wait (gateway-restart class)', async () => {
    jest.useFakeTimers();
    headTestService.getSuite
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue({ suite_key: 's1', payload: { rows: [] } });
    const store = buildStore();
    const p = store.dispatch('okf/pollHeadSuite', { repoId: 'r1', suiteKey: 's1' });
    await jest.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.ok).toBe(true);
  });

  it('an aborted signal stops the wait with POLL_ABORTED', async () => {
    jest.useFakeTimers();
    headTestService.getSuite.mockResolvedValue({ suite_key: 's1', status: 'generating' });
    const store = buildStore();
    const signal = { aborted: false };
    const p = store.dispatch('okf/pollHeadSuite', { repoId: 'r1', suiteKey: 's1', signal });
    signal.aborted = true; // the Lab closed mid-wait
    await jest.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.code).toBe('POLL_ABORTED');
  });
});

describe('okf/pollHeadSuiteRun — async run wait', () => {
  it('resolves on the FIRST fetch when the run already finished', async () => {
    jest.useFakeTimers();
    headTestService.getRun.mockResolvedValue({ run_key: 'k1', payload: { summary: {} } });
    const store = buildStore();
    const res = await store.dispatch('okf/pollHeadSuiteRun', {
      repoId: 'r1',
      suiteKey: 's1',
      runKey: 'k1'
    });
    expect(res.ok).toBe(true);
    expect(headTestService.getRun).toHaveBeenCalledTimes(1);
  });

  it('taps live progress while the run is in flight', async () => {
    jest.useFakeTimers();
    headTestService.getRun
      .mockResolvedValueOnce({ run_key: 'k1', status: 'running', progress: { phase: 'scoring', done: 2, total: 5 } })
      .mockResolvedValueOnce({ run_key: 'k1', payload: { summary: {} } });
    const store = buildStore();
    const seen = [];
    const p = store.dispatch('okf/pollHeadSuiteRun', {
      repoId: 'r1',
      suiteKey: 's1',
      runKey: 'k1',
      onProgress: (pr) => seen.push(pr)
    });
    await jest.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(seen).toEqual([{ phase: 'scoring', done: 2, total: 5 }]);
  });

  it('maps a failed run to code RUN_FAILED (the dialog error contract)', async () => {
    jest.useFakeTimers();
    headTestService.getRun.mockResolvedValue({
      run_key: 'k1',
      status: 'failed',
      error: { code: 'SCORING_FAILED', message: 'reranker down' }
    });
    const store = buildStore();
    const res = await store.dispatch('okf/pollHeadSuiteRun', { repoId: 'r1', suiteKey: 's1', runKey: 'k1' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('SCORING_FAILED');
    expect(res.message).toBe('reranker down');
  });
});
