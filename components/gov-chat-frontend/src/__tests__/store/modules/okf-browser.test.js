'use strict';

/**
 * W9 (concept tree browse) — the okf store's browser slice: the progressive
 * index assembly (pages of 200, SEQUENTIAL offsets, per-page commits,
 * progress line), the honest unavailable arm (the 404 anti-enumeration
 * envelope), the stale guards (a superseded run never commits over a newer
 * one), and the per-hop CAP-2 fetch with its unavailable mapping. The
 * dialog rendering lives in concept-browser-dialog.test.js.
 */

const mockTreePage = jest.fn();
const mockFetchConcept = jest.fn();

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: jest.fn(),
    get: jest.fn(),
    getConceptTree: (...a) => mockTreePage(...a),
    update: jest.fn()
  }
}));

jest.mock('@/utils/document-opener', () => ({
  ...jest.requireActual('@/utils/document-opener'),
  fetchOkfConcept: (...a) => mockFetchConcept(...a),
  downloadOkfConcept: jest.fn()
}));

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: {
    saveDraft: jest.fn().mockRejectedValue({ status: 404 }),
    getDraft: jest.fn().mockRejectedValue({ status: 404 })
  }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn(), get: jest.fn(), patchConcept: jest.fn(), patchConceptBody: jest.fn() }
}));
jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));

const Vuex = require('vuex');
const okfModule = require('@/store/modules/okf').default;

function buildStore() {
  return new Vuex.Store({
    modules: {
      okf: {
        ...okfModule,
        state: () => JSON.parse(JSON.stringify(okfModule.state()))
      }
    }
  });
}

const page = (total, offset, n) => ({
  total,
  offset,
  limit: 200,
  concepts: Array.from({ length: n }, (_, i) => ({ concept_id: `c${offset + i}`, title: `T${offset + i}`, links: [] }))
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTreePage.mockReset();
  mockFetchConcept.mockReset();
});

describe('okf store — browser slice (W9 concept tree browse)', () => {
  test('openConceptBrowser validates identity and resets the slice', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(2, offset, 2));
    const store = buildStore();
    const noId = await store.dispatch('okf/openConceptBrowser', { repoId: 'r1' });
    expect(noId.ok).toBe(false);
    expect(store.state.okf.browser.visible).toBe(false);

    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'cited' });
    const b = store.state.okf.browser;
    expect(b.visible).toBe(true);
    expect(b.repoId).toBe('r1');
    expect(b.startConceptId).toBe('cited');
    expect(b.concepts.length).toBe(2); // the walk ran and committed its page
    expect(b.unavailable).toBe(false);
    // A fresh open is a fresh walk + the first hop (both dispatched).
    expect(mockTreePage).toHaveBeenCalledWith('r1', { limit: 200, offset: 0 });
    expect(mockFetchConcept).toHaveBeenCalledWith('r1', 'cited');
  });

  test('the index assembles progressively: 450 total → 3 sequential pages, progress then cleared', async () => {
    mockTreePage.mockImplementation(async (repoId, { offset }) => {
      if (offset === 0) return page(450, 0, 200);
      if (offset === 200) return page(450, 200, 200);
      return page(450, 400, 50);
    });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'cited' });
    await new Promise((r) => setTimeout(r, 0));
    const b = store.state.okf.browser;
    expect(b.concepts.length).toBe(450);
    expect(b.total).toBe(450);
    expect(b.loading).toBe(false);
    expect(b.progress).toBeNull();
    expect(b.unavailable).toBe(false);
    // The offsets walked sequentially — never one full-corpus payload.
    const offsets = mockTreePage.mock.calls.map((c) => c[1].offset);
    expect(offsets).toEqual([0, 200, 400]);
    mockTreePage.mock.calls.forEach((c) => expect(c[1].limit).toBe(200));
  });

  test('a fenced/absent repo (null page = the 404 refusal) arms the honest unavailable state', async () => {
    mockTreePage.mockResolvedValue(null);
    const store = buildStore();
    // The OPEN itself succeeds — the refusal lands in the state the dialog
    // renders, never as a thrown error.
    const result = await store.dispatch('okf/openConceptBrowser', { repoId: 'fenced', conceptId: 'c' });
    expect(result.ok).toBe(true);
    const b = store.state.okf.browser;
    expect(b.unavailable).toBe(true);
    expect(b.loading).toBe(false);
    expect(b.concepts).toEqual([]);
    expect(b.error).toBeNull(); // an authz refusal is not an error toast
  });

  test('a transport failure lands in the error arm, not the unavailable arm', async () => {
    mockTreePage.mockRejectedValue(new Error('gateway 502'));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    const b = store.state.okf.browser;
    expect(b.unavailable).toBe(false);
    expect(b.error).toBe('gateway 502');
    expect(b.loading).toBe(false);
  });

  test('an out-of-range offset returns an empty page and ends the walk (total stays true)', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => (offset === 0 ? page(2, 0, 2) : page(2, 5000, 0)));
    // A repo smaller than one page: the first page's short length ends it.
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    expect(store.state.okf.browser.concepts.length).toBe(2);
    expect(mockTreePage).toHaveBeenCalledTimes(1);
  });

  test('stale guard: a newer open supersedes an in-flight walk — the old pages never commit', async () => {
    let releasePage2;
    const page2 = new Promise((resolve) => {
      releasePage2 = resolve;
    });
    mockTreePage.mockImplementation(async (repoId, { offset }) => {
      if (repoId === 'r1' && offset === 0) return page(400, 0, 200);
      if (repoId === 'r1') return page2; // held until the test releases it
      return page(1, 0, 1); // r2: one tiny page
    });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    await new Promise((r) => setTimeout(r, 0)); // page 1 of r1 committed
    expect(store.state.okf.browser.concepts.length).toBe(200);

    await store.dispatch('okf/openConceptBrowser', { repoId: 'r2', conceptId: 'c' });
    expect(store.state.okf.browser.repoId).toBe('r2');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.okf.browser.concepts.length).toBe(1); // r2's page

    // The old walk resolves now — it must NOT commit its pages over r2's,
    // and it must NOT clear r2's live flags on its way out.
    releasePage2(page(400, 200, 200));
    await new Promise((r) => setTimeout(r, 0));
    const b = store.state.okf.browser;
    expect(b.repoId).toBe('r2');
    expect(b.concepts.length).toBe(1);
    expect(b.concepts[0].concept_id).toBe('c0');
  });

  test('browserLoadConcept: success stores the card; unavailable maps honestly', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(2, offset, 2));
    // A STANDING success card: the open's own first hop consumes one too.
    mockFetchConcept.mockResolvedValue({ concept_id: 'c1', title: 'C1', body: '# body', links: [] });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    await store.dispatch('okf/browserLoadConcept', { repoId: 'r1', conceptId: 'c1' });
    expect(store.state.okf.browser.selectedConceptId).toBe('c1');
    expect(store.state.okf.browser.selectedConcept.body).toBe('# body');
    expect(store.state.okf.browser.selectedUnavailable).toBe(false);

    const unavailable = new Error('gone');
    unavailable.code = 'OKF_CONCEPT_UNAVAILABLE';
    mockFetchConcept.mockRejectedValueOnce(unavailable);
    await store.dispatch('okf/browserLoadConcept', { repoId: 'r1', conceptId: 'c9' });
    expect(store.state.okf.browser.selectedUnavailable).toBe(true);
    expect(store.state.okf.browser.selectedConcept).toBeNull();
    expect(store.state.okf.browser.error).toBeNull();

    mockFetchConcept.mockRejectedValueOnce(new Error('network down'));
    await store.dispatch('okf/browserLoadConcept', { repoId: 'r1', conceptId: 'c9' });
    expect(store.state.okf.browser.selectedUnavailable).toBe(false);
    expect(store.state.okf.browser.error).toBe('network down');
  });

  test('a hop for a superseded repo is dropped (STALE)', async () => {
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    const result = await store.dispatch('okf/browserLoadConcept', { repoId: 'other-repo', conceptId: 'c1' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('STALE');
    expect(mockFetchConcept).not.toHaveBeenCalledWith('other-repo', 'c1');
  });

  test('closeConceptBrowser hides without wiping the slice (a mis-tap costs nothing)', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => (offset === 0 ? page(2, 0, 2) : page(2, 200, 0)));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    store.dispatch('okf/closeConceptBrowser');
    expect(store.state.okf.browser.visible).toBe(false);
    expect(store.state.okf.browser.concepts.length).toBe(2);
  });
});
