'use strict';

/**
 * RAGAS poll-loop tolerance (2026-10-18 live incident): a kong restart made
 * one poll of the generation GET fail with 502 and the UI gave up tracking a
 * job that was still running server-side. The four ragas poll actions
 * (ragasGenerate, ragasRun, ragasAdoptRun, ragasAdoptGeneration) must ride
 * out transient gateway failures and only give up after a solid stretch of
 * consecutive misses — the server never kills a healthy long job, so neither
 * may the UI's tracking loop.
 */

const mockGenerateSuite = jest.fn();
const mockGetSuite = jest.fn();
const mockRunSuite = jest.fn();
const mockGetRun = jest.fn();
const mockRescoreRun = jest.fn();

jest.mock('@/services/ragasService', () => ({
  __esModule: true,
  default: {
    generateSuite: (...a) => mockGenerateSuite(...a),
    getSuite: (...a) => mockGetSuite(...a),
    runSuite: (...a) => mockRunSuite(...a),
    getRun: (...a) => mockGetRun(...a),
    rescoreRun: (...a) => mockRescoreRun(...a),
    cancelSuiteGeneration: jest.fn(),
    cancelRun: jest.fn()
  }
}));

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn(), getDraft: jest.fn() }
}));

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { get: jest.fn(), list: jest.fn() }
}));

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { listForRepo: jest.fn() }
}));

jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));

jest.mock('@/services/okfRepoOps', () => ({ __esModule: true }));

jest.mock('@/services/headTestService', () => ({
  __esModule: true,
  default: { listRuns: jest.fn() }
}));

const Vuex = require('vuex');
const okfModule = require('@/store/modules/okf').default;

function buildStore() {
  return new Vuex.Store({
    modules: {
      okf: {
        ...okfModule,
        state: () => JSON.parse(JSON.stringify(okfModule.state))
      }
    }
  });
}

const GATEWAY_502 = Object.assign(new Error('Request failed with status code 502'), {
  code: 'ERR_BAD_RESPONSE'
});

describe('okf store — ragas poll loops survive transient gateway failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ragasGenerate rides out a 502 blip and still lands the suite', async () => {
    mockGenerateSuite.mockResolvedValue({ suite_key: 'rs-1' });
    mockGetSuite
      .mockRejectedValueOnce(GATEWAY_502)
      .mockRejectedValueOnce(GATEWAY_502)
      .mockResolvedValueOnce({
        suite_key: 'rs-1',
        status: 'generating',
        progress: { phase: 'building-knowledge-graph' }
      })
      .mockResolvedValue({ suite_key: 'rs-1', status: 'ready', entries: [] });

    const onProgress = jest.fn();
    const p = buildStore().dispatch('okf/ragasGenerate', {
      repoId: 'r-1',
      options: {},
      onStarted: jest.fn(),
      onProgress
    });
    await jest.advanceTimersByTimeAsync(2500 * 4);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(mockGetSuite).toHaveBeenCalledTimes(4);
    // The count-less KG phase still reaches the progress bar.
    expect(onProgress).toHaveBeenCalledWith({ phase: 'building-knowledge-graph' });
  });

  it('ragasGenerate gives up only after a solid stretch of consecutive misses', async () => {
    mockGenerateSuite.mockResolvedValue({ suite_key: 'rs-1' });
    mockGetSuite.mockRejectedValue(GATEWAY_502);

    const p = buildStore().dispatch('okf/ragasGenerate', { repoId: 'r-1', options: {} });
    await jest.advanceTimersByTimeAsync(2500 * 65);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(mockGetSuite).toHaveBeenCalledTimes(60);
  });

  it('ragasRun rides out a 502 blip and still lands the run', async () => {
    mockRunSuite.mockResolvedValue({ run_key: 'rr-1' });
    mockGetRun.mockRejectedValueOnce(GATEWAY_502).mockResolvedValue({
      run_key: 'rr-1',
      status: 'completed',
      summary: { faithfulness: 0.94 }
    });

    const p = buildStore().dispatch('okf/ragasRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      onStarted: jest.fn(),
      onProgress: jest.fn()
    });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(mockGetRun).toHaveBeenCalledTimes(2);
  });

  it('ragasAdoptGeneration re-attaches through a 502 blip after a refresh', async () => {
    mockGetSuite
      .mockRejectedValueOnce(GATEWAY_502)
      .mockResolvedValue({ suite_key: 'rs-1', status: 'ready', entries: [] });

    const p = buildStore().dispatch('okf/ragasAdoptGeneration', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      onProgress: jest.fn()
    });
    await jest.advanceTimersByTimeAsync(2500 * 2);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(mockGetSuite).toHaveBeenCalledTimes(2);
  });

  it('ragasAdoptRun re-attaches through a 502 blip after a refresh', async () => {
    mockGetRun.mockRejectedValueOnce(GATEWAY_502).mockResolvedValue({ run_key: 'rr-1', status: 'completed' });

    const p = buildStore().dispatch('okf/ragasAdoptRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-1',
      onProgress: jest.fn()
    });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(mockGetRun).toHaveBeenCalledTimes(2);
  });

  // Round 20 (#79900): adopt used to fold `cancelled` into the failure arm —
  // adopting a run someone deliberately stopped rendered "Run failed", the
  // operator retried a run that intentionally never happened, and telemetry
  // counted a phantom RUN_FAILED. With no doc.error on the mock, the OLD
  // branch answered RUN_FAILED here — this is the red/green proof.
  it('ragasAdoptRun answers RUN_CANCELLED for a deliberately stopped run (#79900)', async () => {
    mockGetRun
      .mockResolvedValueOnce({ run_key: 'rr-1', status: 'running' })
      .mockResolvedValue({ run_key: 'rr-1', status: 'cancelled' });

    const p = buildStore().dispatch('okf/ragasAdoptRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-1'
    });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'RUN_CANCELLED' });
  });

  it('a server-side failure still surfaces (tolerance must not mask real failures)', async () => {
    mockGenerateSuite.mockResolvedValue({ suite_key: 'rs-1' });
    mockGetSuite.mockResolvedValue({
      suite_key: 'rs-1',
      status: 'failed',
      error: { code: 'RAGAS_JOB_CANCELLED', message: 'cancelled by user' }
    });

    const p = buildStore().dispatch('okf/ragasGenerate', { repoId: 'r-1', options: {} });
    await jest.advanceTimersByTimeAsync(2500);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.code).toBe('RAGAS_JOB_CANCELLED');
  });
});

// The re-score's poll loop had NO test at all (2026-10-25 review): the
// panel test mocks the whole dispatch away, and this file covered only the
// four sibling actions. So the "a cancel is not a failure" behaviour the
// change set out to deliver — the one David asked for by name — was
// unprotected: if the store's `cancelled` branch were dropped or its code
// string changed, the panel would re-open the re-score dialog with an error
// banner for a run the user deliberately stopped, and no test would fail.
describe('okf store — ragasRescoreRun maps the terminal state honestly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a CANCELLED re-score is RUN_CANCELLED, not a failure', async () => {
    mockRescoreRun.mockResolvedValue({ run_key: 'rr-new' });
    mockGetRun.mockResolvedValue({ run_key: 'rr-new', status: 'cancelled' });

    const p = buildStore().dispatch('okf/ragasRescoreRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-old'
    });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.code).toBe('RUN_CANCELLED');
    // The panel branches on this exact code to suppress the error banner.
    expect(res.code).not.toBe('RESCORE_FAILED');
  });

  it("a FAILED re-score carries the server's own error code", async () => {
    mockRescoreRun.mockResolvedValue({ run_key: 'rr-new' });
    mockGetRun.mockResolvedValue({
      run_key: 'rr-new',
      status: 'failed',
      error: { code: 'RAGAS_UNAVAILABLE', message: 'the sidecar is down' }
    });

    const p = buildStore().dispatch('okf/ragasRescoreRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-old'
    });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.code).toBe('RAGAS_UNAVAILABLE');
  });

  it('a 202 with no run key is a failure, not a silent success', async () => {
    // The server accepted the request but returned nothing to track. The
    // old code returned ok:true, so the panel reported a finished re-score
    // that did not exist and there was no run to cancel.
    mockRescoreRun.mockResolvedValue({});

    const p = buildStore().dispatch('okf/ragasRescoreRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-old'
    });
    await jest.advanceTimersByTimeAsync(2000);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.code).toBe('RESCORE_NOT_STARTED');
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it('reports the new run key and the live progress', async () => {
    mockRescoreRun.mockResolvedValue({ run_key: 'rr-new' });
    mockGetRun
      .mockResolvedValueOnce({
        run_key: 'rr-new',
        status: 'running',
        progress: { phase: 'judge', done: 3, total: 10 }
      })
      .mockResolvedValue({ run_key: 'rr-new', status: 'done', summary: { metrics: {} } });

    const onStarted = jest.fn();
    const onProgress = jest.fn();
    const p = buildStore().dispatch('okf/ragasRescoreRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      runKey: 'rr-old',
      onStarted,
      onProgress
    });
    await jest.advanceTimersByTimeAsync(2000 * 3);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(onStarted).toHaveBeenCalledWith('rr-new');
    expect(onProgress).toHaveBeenCalledWith({ phase: 'judge', done: 3, total: 10 });
  });
});

describe('okf store — poll cancellation (round 16, #80124: the pollJob signal)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('an aborted signal stops the poll within one cadence — no further fetches', async () => {
    mockRunSuite.mockResolvedValue({ run_key: 'rr-1' });
    mockGetRun.mockResolvedValue({ run_key: 'rr-1', status: 'running', progress: { done: 1 } });

    const signal = { aborted: false };
    const p = buildStore().dispatch('okf/ragasRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      signal,
      onProgress: jest.fn()
    });
    // Two poll ticks happen normally…
    await jest.advanceTimersByTimeAsync(2000 * 2);
    expect(mockGetRun).toHaveBeenCalledTimes(2);
    // …then the component unmounts mid-poll.
    signal.aborted = true;
    await jest.advanceTimersByTimeAsync(2000 * 3);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'POLL_ABORTED' });
    // The loop died with the component — the gateway is not hammered for the
    // remaining 24h horizon (the exact regression this token exists for).
    expect(mockGetRun).toHaveBeenCalledTimes(2);
  });

  it('a pre-aborted signal never fetches at all', async () => {
    mockRunSuite.mockResolvedValue({ run_key: 'rr-1' });

    const p = buildStore().dispatch('okf/ragasRun', {
      repoId: 'r-1',
      suiteKey: 'rs-1',
      signal: { aborted: true }
    });
    await jest.advanceTimersByTimeAsync(2000);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'POLL_ABORTED' });
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it('an aborted GENERATION poll also stops (the 2500ms cadence family)', async () => {
    mockGenerateSuite.mockResolvedValue({ suite_key: 'rs-9' });
    mockGetSuite.mockResolvedValue({ suite_key: 'rs-9', status: 'generating' });

    const signal = { aborted: false };
    const p = buildStore().dispatch('okf/ragasGenerate', { repoId: 'r-1', options: {}, signal });
    await jest.advanceTimersByTimeAsync(2500);
    expect(mockGetSuite).toHaveBeenCalledTimes(1);
    signal.aborted = true;
    await jest.advanceTimersByTimeAsync(2500 * 2);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'POLL_ABORTED' });
    expect(mockGetSuite).toHaveBeenCalledTimes(1);
  });

  it('the 24h UI horizon still bounds the loop after the pollJob extraction', async () => {
    mockRunSuite.mockResolvedValue({ run_key: 'rr-1' });
    mockGetRun.mockResolvedValue({ run_key: 'rr-1', status: 'running' });

    const p = buildStore().dispatch('okf/ragasRun', { repoId: 'r-1', suiteKey: 'rs-1' });
    // One real tick, then jump the clock past the horizon — advancing 43k
    // real timer ticks would take longer than the test timeout for no extra
    // coverage; setSystemTime exercises the same Date.now() check.
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockGetRun).toHaveBeenCalledTimes(1);
    jest.setSystemTime(jest.now() + 24 * 60 * 60 * 1000 + 2000);
    await jest.advanceTimersByTimeAsync(2000);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'RUN_TIMEOUT' });
  });

  it('a cancelled run is still RUN_CANCELLED (not ok, not failed) after the extraction', async () => {
    mockRunSuite.mockResolvedValue({ run_key: 'rr-1' });
    mockGetRun
      .mockResolvedValueOnce({ run_key: 'rr-1', status: 'running' })
      .mockResolvedValue({ run_key: 'rr-1', status: 'cancelled' });

    const p = buildStore().dispatch('okf/ragasRun', { repoId: 'r-1', suiteKey: 'rs-1' });
    await jest.advanceTimersByTimeAsync(2000 * 2);
    const res = await p;

    expect(res).toMatchObject({ ok: false, code: 'RUN_CANCELLED' });
    expect(res.result.status).toBe('cancelled');
  });
});
