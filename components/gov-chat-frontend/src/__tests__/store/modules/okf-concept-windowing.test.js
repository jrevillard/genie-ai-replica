/**
 * #2188 — the windowed parallel concept-list crawl.
 *
 * Pins the #2188 rewrite of `fetchConcepts` at the store boundary:
 *  - pages 2..N fly CONCURRENTLY in windows of 5 (the sequential loop's
 *    "each offset needs the previous count" premise was false — only page 1's
 *    `total` is needed);
 *  - ONE `setConcepts` commit + ONE progress commit per WAVE (not per page —
 *    the per-page full-accumulator commit was the O(n²) render hazard);
 *  - a wave's rows are ordered by offset before the commit (arrival order is
 *    nondeterministic once pages race);
 *  - wave offsets recompute from `acc.length` at wave start (a ragged page
 *    must never cause skipped rows);
 *  - the stale/generation guards keep their round-11/round-20 semantics;
 *  - the crawl registers CANCELLABLE with the operation-wait registry and the
 *    cancel drives a REAL AbortController (the #2195 rule: no fake affordances);
 *  - keep-last-known-list survives a wave failure.
 */
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { get: jest.fn(), listForRepo: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/operationWaitService', () => ({
  __esModule: true,
  default: {
    begin: jest.fn(() => ({
      id: 'op-test',
      setProgress: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
      cancel: jest.fn()
    }))
  }
}));

const Vuex = require('vuex').default || require('vuex');

// the wave-boundary assertions are ORDER-based (FIFO timers + microtasks) and
// stay correct under any wall-clock slowness; the 5s jest default is what the
// full --coverage run on a loaded box breaks, not the sequencing
jest.setTimeout(15000);
const conceptService = require('@/services/conceptService').default;
const opWait = require('@/services/operationWaitService').default;
const okfModule = require('@/store/modules/okf').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rows(from, to) {
  const out = [];
  for (let i = from; i < to; i++) out.push({ concept_id: `c${i}` });
  return out;
}

function page(total, from, to) {
  return { total, offset: from, limit: to - from, concepts: rows(from, to) };
}

// two macrotask ticks: one for the resolution microtasks, one so the
// implementation's between-wave renderer yield (setTimeout 0) fires first
const flush = () => new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));

function buildStore(seed = {}) {
  const commitCounts = {};
  const store = new Vuex.Store({
    modules: {
      okf: {
        ...okfModule,
        state: () => JSON.parse(JSON.stringify({ ...okfModule.state(), ...seed })),
        mutations: Object.fromEntries(
          Object.entries(okfModule.mutations).map(([type, fn]) => [
            type,
            (s, payload) => {
              commitCounts[type] = (commitCounts[type] || 0) + 1;
              return fn(s, payload);
            }
          ])
        )
      }
    }
  });
  return { store, commitCounts };
}

function waitHandle() {
  return opWait.begin.mock.results[0].value;
}

function beginOpts() {
  return opWait.begin.mock.calls[0][1];
}

let pending;
let inFlight;

beforeEach(() => {
  jest.clearAllMocks();
  pending = 0;
  inFlight = [];
  conceptService.listForRepo.mockImplementation(() => {
    pending++;
    const d = deferred();
    inFlight.push(d);
    return d.promise;
  });
});

afterEach(() => {
  // settle any still-pending deferreds so no test leaks a floating promise
  inFlight.forEach((d) => d.resolve({ concepts: [] }));
});

describe('#2188 windowed concept-list crawl', () => {
  it('dispatches pages 2..N concurrently in windows of five, not sequentially', async () => {
    const { store } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    expect(inFlight.length).toBe(1); // page 1 alone, serial
    inFlight[0].resolve(page(2000, 0, 200));
    await flush();
    // the whole first window is in flight at once — the sequential loop kept
    // this at exactly 1
    expect(pending).toBe(6);
    expect(inFlight.length).toBe(6);
    inFlight.slice(1, 6).forEach((d) => d.resolve(page(2000, 0, 200)));
    await flush();
    // wave 2 dispatches after the renderer yield
    expect(inFlight.length).toBe(10);
    inFlight.slice(6).forEach((d) => d.resolve(page(2000, 0, 200)));
    await t;
  });

  it('commits once per wave, not once per page, with per-wave progress', async () => {
    const { store, commitCounts } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    inFlight[0].resolve(page(2000, 0, 200));
    await flush();
    // wave 1: five pages resolve (arrival order scrambled on purpose)
    inFlight[5].resolve(page(2000, 400, 600));
    inFlight[4].resolve(page(2000, 1000, 1200));
    inFlight[3].resolve(page(2000, 800, 1000));
    inFlight[2].resolve(page(2000, 600, 800));
    inFlight[1].resolve(page(2000, 200, 400));
    await flush();
    // after wave 1 exactly: page 1 + one wave commit; progress = 1200/2000
    expect(commitCounts.setConcepts).toBe(2);
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(1200);
    expect(store.state.okf.editor.loadProgress).toEqual({ repoId: 'r1', done: 1200, total: 2000 });
    // wave 2: the remaining four pages
    inFlight.slice(6).forEach((d) => d.resolve(page(2000, 0, 200)));
    const res = await t;
    expect(res.ok).toBe(true);
    expect(commitCounts.setConcepts).toBe(3); // page 1 + 2 waves for 9 pages
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(2000);
    expect(store.state.okf.editor.loadProgress).toBeNull();
  });

  it('orders a wave by offset before committing — arrival order never leaks', async () => {
    const { store } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    inFlight[0].resolve(page(1200, 0, 200));
    await flush();
    // resolve the first wave completely out of order
    inFlight[5].resolve(page(1200, 1000, 1200));
    inFlight[4].resolve(page(1200, 800, 1000));
    inFlight[3].resolve(page(1200, 600, 800));
    inFlight[2].resolve(page(1200, 400, 600));
    inFlight[1].resolve(page(1200, 200, 400));
    await flush();
    const list = store.state.okf.editor.conceptsByRepo.r1;
    expect(list).toHaveLength(1200);
    list.forEach((c, i) => expect(c.concept_id).toBe(`c${i}`));
    await t;
  });

  it('recomputes wave offsets from acc.length — a ragged page never skips rows', async () => {
    const { store } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    inFlight[0].resolve(page(2000, 0, 200));
    await flush();
    const wave1Offsets = [200, 400, 600, 800, 1000];
    inFlight.slice(1, 6).forEach((d, i) => {
      // the page at offset 400 comes back ragged: 150 rows, not 200
      d.resolve(i === 1 ? page(2000, 400, 550) : page(2000, wave1Offsets[i], wave1Offsets[i] + 200));
    });
    await flush();
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(1150); // 200 + (200+150+200+200+200)
    // wave 2 must pin its offsets from acc.length = 1150 — not from 400+PAGE steps
    expect(inFlight.length).toBe(11);
    const wave2 = conceptService.listForRepo.mock.calls.slice(6, 11).map(([, opts]) => opts.offset);
    expect(wave2).toEqual([1150, 1350, 1550, 1750, 1950]);
    inFlight.slice(6).forEach((d) => d.resolve(page(2000, 0, 200)));
    await t;
  });

  it('a superseded fetch commits nothing further and leaves the flags to the newer fetch', async () => {
    const { store, commitCounts } = buildStore();
    const t1 = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    inFlight[0].resolve(page(2000, 0, 200));
    await flush(); // fetch 1's wave 1 (5 pages) now in flight
    // a NEWER fetch supersedes by generation (its page 1 returns 250 rows)
    conceptService.listForRepo.mockImplementationOnce(async () => page(250, 0, 250));
    const t2 = store.dispatch('okf/fetchConcepts', 'r1');
    await t2;
    // release fetch 1's wave — its stale check must fire BEFORE its commit
    inFlight.slice(1, 6).forEach((d) => d.resolve(page(2000, 0, 200)));
    const r1 = await t1;
    expect(r1.stale).toBe(true);
    // fetch 2's page-1 commit is the LAST setConcepts — fetch 1's wave never lands
    expect(commitCounts.setConcepts).toBe(2);
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(250);
    expect(store.state.okf.editor.loading).toBe(false);
  });

  it('registers cancellable with the wait registry and the cancel aborts the in-flight pages for real', async () => {
    const { store, commitCounts } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    expect(opWait.begin).toHaveBeenCalledWith(
      'concept-list-fetch',
      expect.objectContaining({ cancellable: true, onCancel: expect.any(Function) })
    );
    inFlight[0].resolve(page(2000, 0, 200));
    await flush();
    expect(inFlight.length).toBe(6);
    // the overlay's Cancel -> onCancel -> real AbortController
    beginOpts().onCancel();
    // every in-flight page shares the controller's signal, and it is aborted
    for (let i = 1; i < 6; i++) {
      const opts = conceptService.listForRepo.mock.calls[i][1];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      expect(opts.signal.aborted).toBe(true);
    }
    // the aborted pages reject the way axios v1 rejects a signal abort
    const abortErr = new Error('canceled');
    abortErr.name = 'CanceledError';
    abortErr.code = 'ERR_CANCELED';
    inFlight.slice(1).forEach((d) => d.reject(abortErr));
    const res = await t;
    expect(res.ok).toBe(false);
    expect(res.code).toBe('ABORTED');
    // keep-last-known: the committed rows stay; no blanking
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(200);
    expect(commitCounts.setConcepts).toBe(1);
    // a deliberate cancel is not an error: the op settles complete, never fail
    expect(waitHandle().complete).toHaveBeenCalled();
    expect(waitHandle().fail).not.toHaveBeenCalled();
    expect(store.state.okf.editor.loading).toBe(false);
  });

  it('a wave failure keeps the last known list and reports FETCH_FAILED', async () => {
    const { store, commitCounts } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    inFlight[0].resolve(page(2000, 0, 200));
    await flush();
    inFlight[1].resolve(page(2000, 200, 400));
    inFlight[2].reject(new Error('502'));
    inFlight.slice(3, 6).forEach((d) => d.resolve(page(2000, 0, 200)));
    const res = await t;
    expect(res).toMatchObject({ ok: false, code: 'FETCH_FAILED' });
    // round-20 #80803: rows already committed stay committed
    expect(store.state.okf.editor.conceptsByRepo.r1).toHaveLength(200);
    expect(commitCounts.setConcepts).toBe(1);
    expect(waitHandle().fail).toHaveBeenCalled();
    expect(store.state.okf.editor.loading).toBe(false);
  });

  it('every page — page 1 included — carries the abort signal; legacy shapes stay single-commit', async () => {
    const { store } = buildStore();
    const t = store.dispatch('okf/fetchConcepts', 'r1');
    await flush();
    expect(conceptService.listForRepo.mock.calls[0][1]).toMatchObject({ limit: 200, offset: 0 });
    expect(conceptService.listForRepo.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    // legacy single payload: no paging at all
    inFlight[0].resolve([{ concept_id: 'legacy' }]);
    const res = await t;
    expect(res.ok).toBe(true);
    expect(store.state.okf.editor.conceptsByRepo.r1).toEqual([{ concept_id: 'legacy' }]);
    expect(conceptService.listForRepo).toHaveBeenCalledTimes(1);
    expect(waitHandle().complete).toHaveBeenCalled();
  });
});
