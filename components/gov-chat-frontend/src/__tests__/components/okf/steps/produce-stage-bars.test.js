'use strict';

/**
 * Step 4 per-stage progress bars (Story 1-8g-y).
 *
 * REGRESSION GUARD for a live-only defect (David, 2026-10-11: "I am importing
 * the existing files from the document repo and the files bar is not moving").
 * The server was demonstrably working — 50/50 files, 913/913 concepts,
 * curation climbing 259→282→314 of 587 — while every row rendered "Waiting".
 *
 * Cause: `this.liveRepo = repo` in poll()'s tick assigned a property that was
 * never returned from data(). In Vue 3 only data() properties are reactive, so
 * stageList had no reactive dependency and kept its FIRST evaluation — the one
 * taken while liveRepo was still undefined. The bars were frozen for the whole
 * run, and poll()'s empty catch meant nothing ever surfaced it.
 *
 * These tests assert the REACTIVITY contract directly: mutate the field, expect
 * the DOM to follow. A regression to an undeclared instance field fails here.
 */

const { mount } = require('@vue/test-utils');

const mockRepoGet = jest.fn();
jest.mock('@/services/repoOkfService', () => ({
  // __esModule matters: without it babel's interop hands the WHOLE module
  // object to the default import, so repoOkfService.get is undefined, the tick
  // throws, and poll()'s empty catch silently discards it.
  __esModule: true,
  default: {
    get: (...a) => mockRepoGet(...a),
    importDocuments: jest.fn(() => Promise.resolve({ status: 202 })),
    convertFromCrawlInto: jest.fn(() => Promise.resolve({ status: 202 })),
    loadSubjectAreaOptions: jest.fn(() => Promise.resolve([]))
  }
}));
jest.mock('oidc-client-ts', () => ({ UserManager: jest.fn() }));

const OkfStepProduce = require('@/components/okf/steps/Produce.vue').default;

const DRAFT = { repo_id: 'r1', name: 'El Salvador', input: { document_ids: ['d1', 'd2'] } };

// A repo doc exactly as the poll tick receives it mid-run.
const LIVE_REPO = {
  repo_id: 'r1',
  conversion: {
    status: 'classifying',
    stage: 'curating',
    files_done: 50,
    files_total: 50,
    concepts_done: 913,
    concepts_total: 913,
    batches_done: 5
  },
  curation: { done: 314, total: 587, labeled: 300, method: 'llm' }
};

function fakeStore() {
  return {
    getters: {
      'okf/isExpert': false,
      // mounted() -> repoConversionStatus() reads this; returning null sends it
      // down the kick() branch, which the mocked service absorbs.
      'okf/repoById': jest.fn(() => null),
      'okf/activeDraft': jest.fn(() => null)
    },
    dispatch: jest.fn(() => Promise.resolve({ ok: true, result: null }))
  };
}

async function mountProduce(draft = DRAFT) {
  const wrapper = mount(OkfStepProduce, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: { DsButton: true, DsProgress: true }
    },
    props: { draft, expert: false }
  });
  // mounted() kicks and calls poll(), whose FIRST tick() runs immediately and
  // assigns liveRepo asynchronously. Clearing the interval does NOT cancel an
  // already-running tick, so it would land after a test sets its own state and
  // silently clobber it. Let it land first, then stop the loop; the real-path
  // test drives poll() explicitly.
  if (wrapper.vm.pollTimer) clearInterval(wrapper.vm.pollTimer);
  await flush();
  return wrapper;
}

// Let the mount-time kick()->poll() promise chain settle. Real timers: the
// chain crosses several awaits and 3 microtask hops is not reliably enough.
const flush = async () => {
  await new Promise((r) => setTimeout(r, 25));
};

let w;
afterEach(() => {
  if (w) w.unmount();
  w = null;
  mockRepoGet.mockReset();
});

beforeEach(() => {
  mockRepoGet.mockResolvedValue(JSON.parse(JSON.stringify(LIVE_REPO)));
});

describe('OkfStepProduce — per-stage bars follow the live repo', () => {
  test('the live repo fields are DECLARED in data() (non-reactive instance fields froze the bars)', async () => {
    w = await mountProduce();
    // If absent from data() they are plain instance fields and any computed
    // reading them caches its first value forever.
    expect(Object.keys(w.vm.$data)).toEqual(expect.arrayContaining(['liveRepo', 'lastConv']));
    // Value is not asserted: mountProduce lets the poll tick populate it.
    expect(w.vm.$data).toHaveProperty('liveRepo');
    expect(w.vm.$data).toHaveProperty('lastConv');
  });

  test('assigning liveRepo re-renders the stage counts (the frozen-bars regression)', async () => {
    w = await mountProduce();
    // Start from the no-data state explicitly. mountProduce() deliberately
    // lets the mount-time poll tick land, so the bars are already populated —
    // which is itself the proof the poll path works. Clearing shows the bars
    // returning to "Waiting" and then following the assignment back.
    w.vm.liveRepo = null;
    await w.vm.$nextTick();
    expect(w.text()).toContain('Waiting');

    // The exact mutation poll()'s tick performs.
    w.vm.liveRepo = JSON.parse(JSON.stringify(LIVE_REPO));
    await w.vm.$nextTick();

    const text = w.text();
    expect(text).toContain('documents');
    expect(text).toContain('topics');
    expect(text).toContain('314');
    expect(text).not.toContain('Waiting');
  });

  test('each stage reports its own real numerator/denominator', async () => {
    w = await mountProduce();
    w.vm.liveRepo = JSON.parse(JSON.stringify(LIVE_REPO));
    await w.vm.$nextTick();
    const rows = w.vm.stageList;
    const files = rows.find((r) => r.key === 'files');
    const concepts = rows.find((r) => r.key === 'concepts');
    const curating = rows.find((r) => r.key === 'curating');
    expect(files.pct).toBe(100);
    expect(files.done).toBe(true);
    expect(concepts.pct).toBe(100);
    expect(curating.count).toContain('314');
    expect(curating.count).toContain('587');
  });

  test('the cross-link row appears only once that stage has run', async () => {
    w = await mountProduce();
    w.vm.liveRepo = JSON.parse(JSON.stringify(LIVE_REPO));
    await w.vm.$nextTick();
    expect(w.vm.stageList.find((r) => r.key === 'crosslink')).toBeFalsy();

    w.vm.liveRepo = {
      ...JSON.parse(JSON.stringify(LIVE_REPO)),
      conversion: {
        ...LIVE_REPO.conversion,
        stage: 'cross-linking',
        link_progress: { batches_done: 2, batches_total: 8, written: 17 }
      }
    };
    await w.vm.$nextTick();
    const cross = w.vm.stageList.find((r) => r.key === 'crosslink');
    expect(cross).toBeTruthy();
    expect(cross.count).toContain('17');
  });

  test('the crawled leg counts PAGES, not documents', async () => {
    w = await mountProduce({ repo_id: 'r1', input: { crawl_seeds: [{ url: 'https://example.org', file_name: 'seed' }] } });
    w.vm.liveRepo = {
      repo_id: 'r1',
      conversion: { status: 'running', stage: 'downloading', pages_done: 12, pages_total: 120 },
      curation: {}
    };
    await w.vm.$nextTick();
    const files = w.vm.stageList.find((r) => r.key === 'files');
    expect(files.pct).toBe(10);
    expect(files.count).toContain('12');
    expect(files.count).toContain('120');
  });

  test('a polled repo drives the bars with no manual assignment (the real path)', async () => {
    mockRepoGet.mockResolvedValue(JSON.parse(JSON.stringify(LIVE_REPO)));
    w = await mountProduce();
    w.vm.poll();
    await flush();
    await w.vm.$nextTick();
    // The tick's assignment is the thing under test.
    expect(w.vm.liveRepo).toBeTruthy();
    expect(w.vm.liveRepo.conversion.files_total).toBe(50);
    expect(w.text()).not.toContain('Waiting');
    expect(w.text()).toContain('587');
  });
});