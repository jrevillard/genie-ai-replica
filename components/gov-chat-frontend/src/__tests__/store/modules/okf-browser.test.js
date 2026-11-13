'use strict';

/**
 * W9 (concept tree browse) — the okf store's browser slice: LAZY index
 * loading (David, 2026-11-08 — the open fetches ONLY the first page of 200,
 * further pages extend on demand through browserExtendConceptTree with
 * SEQUENTIAL offsets and the same stale guards), the honest unavailable arm
 * (the 404 anti-enumeration envelope), the stale guards (a superseded run
 * never commits over a newer one), and the per-hop CAP-2 fetch with its
 * unavailable mapping. The dialog rendering lives in
 * concept-browser-dialog.test.js.
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

  test('lazy loading: the open fetches ONLY the first page (200 of 450) — the rest on demand', async () => {
    mockTreePage.mockImplementation(async (_repoId, { offset }) => page(450, offset, Math.min(200, 450 - offset)));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'cited' });
    await new Promise((r) => setTimeout(r, 0));
    const b = store.state.okf.browser;
    // David, 2026-11-08: the dialog must not wait for the whole repository —
    // ONE page, then interactive; total stays true for the on-demand extends.
    expect(b.concepts.length).toBe(200);
    expect(b.total).toBe(450);
    expect(b.loading).toBe(false);
    expect(b.treeComplete).toBe(false);
    expect(b.unavailable).toBe(false);
    const offsets = mockTreePage.mock.calls.map((c) => c[1].offset);
    expect(offsets).toEqual([0]);
  });

  test('browserExtendConceptTree fetches the NEXT pages sequentially on demand, completing the tree', async () => {
    mockTreePage.mockImplementation(async (_repoId, { offset }) => page(450, offset, Math.min(200, 450 - offset)));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    await new Promise((r) => setTimeout(r, 0));
    await store.dispatch('okf/browserExtendConceptTree', { repoId: 'r1' });
    expect(store.state.okf.browser.concepts.length).toBe(400);
    expect(store.state.okf.browser.treeComplete).toBe(false);
    expect(store.state.okf.browser.extending).toBe(false);
    await store.dispatch('okf/browserExtendConceptTree', { repoId: 'r1' });
    const b = store.state.okf.browser;
    expect(b.concepts.length).toBe(450);
    expect(b.total).toBe(450);
    expect(b.treeComplete).toBe(true); // the short page completed the tree
    const offsets = mockTreePage.mock.calls.map((c) => c[1].offset);
    expect(offsets).toEqual([0, 200, 400]); // sequential, never a full-corpus payload
  });

  test('browserExtendConceptTree refuses a completed tree and does not double-fetch while extending', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(2, offset, 2));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.okf.browser.treeComplete).toBe(true); // 2 rows < 200
    const callsBefore = mockTreePage.mock.calls.length;
    const done = await store.dispatch('okf/browserExtendConceptTree', { repoId: 'r1' });
    expect(done.ok).toBe(false);
    expect(done.code).toBe('STALE');
    expect(mockTreePage.mock.calls.length).toBe(callsBefore);
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

  test('a repo smaller than one page completes the tree immediately — never a second fetch', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => (offset === 0 ? page(2, 0, 2) : page(2, 5000, 0)));
    // A repo smaller than one page: the first page's short length ends it.
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    expect(store.state.okf.browser.concepts.length).toBe(2);
    expect(mockTreePage).toHaveBeenCalledTimes(1);
  });

  test('stale guard: a newer open supersedes an in-flight first page — the old page never commits', async () => {
    let releasePage1;
    const page1 = new Promise((resolve) => {
      releasePage1 = resolve;
    });
    mockTreePage.mockImplementation(async (repoId) => {
      if (repoId === 'r1') return page1; // held until the test releases it
      return page(1, 0, 1); // r2: one tiny page
    });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    await new Promise((r) => setTimeout(r, 0)); // r1's page still held

    await store.dispatch('okf/openConceptBrowser', { repoId: 'r2', conceptId: 'c' });
    expect(store.state.okf.browser.repoId).toBe('r2');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.okf.browser.concepts.length).toBe(1); // r2's page

    // The old fetch resolves now — it must NOT commit its page over r2's,
    // and it must NOT clear r2's live flags on its way out.
    releasePage1(page(400, 0, 200));
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

  test('a slower earlier hop never overwrites a newer selection (same-repo race)', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(2, offset, 2));
    let releaseA;
    const slowA = new Promise((resolve) => {
      releaseA = resolve;
    });
    mockFetchConcept.mockImplementation(async (_repo, conceptId) => {
      if (conceptId === 'cA') {
        return slowA.then(() => ({ concept_id: 'cA', title: 'CA', body: 'A body', links: [] }));
      }
      return { concept_id: 'cB', title: 'CB', body: 'B body', links: [] };
    });
    const store = buildStore();
    // The open's own hop (cA) is held in flight.
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'cA' });
    // A newer hop for cB resolves fast while cA is still pending.
    await store.dispatch('okf/browserLoadConcept', { repoId: 'r1', conceptId: 'cB' });
    expect(store.state.okf.browser.selectedConceptId).toBe('cB');
    expect(store.state.okf.browser.selectedConcept.body).toBe('B body');
    // The held cA resolves now — it must NOT commit over cB.
    releaseA({ concept_id: 'cA', title: 'CA', body: 'A body', links: [] });
    await new Promise((r) => setTimeout(r, 0));
    const b = store.state.okf.browser;
    expect(b.selectedConceptId).toBe('cB');
    expect(b.selectedConcept.body).toBe('B body');
  });

  test('closing the dialog cancels an in-flight page fetch — it never commits', async () => {
    let releasePage1;
    const page1 = new Promise((resolve) => {
      releasePage1 = resolve;
    });
    mockTreePage.mockImplementation(async () => page1);
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    await new Promise((r) => setTimeout(r, 0)); // the first page is still held
    store.dispatch('okf/closeConceptBrowser');
    expect(store.state.okf.browser.visible).toBe(false);
    // The held page resolves after the close — the fetch must have exited via
    // its stale guard and never commit it.
    releasePage1(page(400, 0, 200));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.okf.browser.concepts.length).toBe(0);
    // A fresh open resets cleanly (the stale generation never poisons it).
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r2', conceptId: 'x' });
    const b = store.state.okf.browser;
    expect(b.visible).toBe(true);
    expect(b.repoId).toBe('r2');
    expect(b.concepts.length).toBe(1);
    expect(b.loading).toBe(false);
  });

  test('a superseded extension never commits into a newer open (stale generation)', async () => {
    let releasePage1;
    const page1 = new Promise((resolve) => {
      releasePage1 = resolve;
    });
    mockTreePage.mockImplementation(async (_r, { offset }) => (offset === 0 ? page(200, 0, 200) : page1));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c' });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.okf.browser.concepts.length).toBe(200);
    // An extension whose fetch is held; a NEW open resets the slice mid-flight.
    const ext = store.dispatch('okf/browserExtendConceptTree', { repoId: 'r1' });
    await new Promise((r) => setTimeout(r, 0));
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r2', conceptId: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    releasePage1(page(400, 200, 200));
    await ext;
    const b = store.state.okf.browser;
    expect(b.repoId).toBe('r2');
    expect(b.concepts.length).toBe(1);
    expect(b.extending).toBe(false);
    expect(b.loading).toBe(false);
  });
});

describe('okf store — browser history (issue #1836: the browser has back/forward)', () => {
  test('open seeds the history with the entry concept', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'cited' });
    const b = store.state.okf.browser;
    expect(b.history).toEqual(['cited']);
    expect(b.historyIndex).toBe(0);
  });

  test('a tree-row visit appends; back then a fresh visit TRUNCATES the forward tail', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    mockFetchConcept.mockResolvedValue({ concept_id: 'x', title: 'X', body: 'b' });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'a' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'b' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'c' });
    let b = store.state.okf.browser;
    expect(b.history).toEqual(['a', 'b', 'c']);
    expect(b.historyIndex).toBe(2);
    expect(b.selectedConceptId).toBe('c');
    // Back twice: b, then a. Forward is possible from a.
    await store.dispatch('okf/browserBack');
    await store.dispatch('okf/browserBack');
    b = store.state.okf.browser;
    expect(b.historyIndex).toBe(0);
    expect(b.selectedConceptId).toBe('a');
    // A fresh visit at a — the web-history semantic: 'b'/'c' die.
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'd' });
    b = store.state.okf.browser;
    expect(b.history).toEqual(['a', 'd']);
    expect(b.historyIndex).toBe(1);
  });

  test('a repeat visit of the CURRENT entry does not grow the stack', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'a' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'b' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'b' });
    const b = store.state.okf.browser;
    expect(b.history).toEqual(['a', 'b']);
    expect(b.historyIndex).toBe(1);
  });

  test('back/forward load the entry content through the guarded hop loader; boundary calls are no-ops', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    mockFetchConcept.mockResolvedValue({ concept_id: 'x', title: 'X', body: 'b' });
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'a' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'b' });
    mockFetchConcept.mockClear();
    // At the forward boundary: a no-op (no load, no index move).
    const fwd = await store.dispatch('okf/browserForward');
    expect(fwd.ok).toBe(false);
    expect(mockFetchConcept).not.toHaveBeenCalled();
    // Back loads 'a'; then back again is a boundary no-op.
    await store.dispatch('okf/browserBack');
    expect(store.state.okf.browser.selectedConceptId).toBe('a');
    expect(mockFetchConcept).toHaveBeenCalledWith('r1', 'a');
    const back = await store.dispatch('okf/browserBack');
    expect(back.ok).toBe(false);
    expect(store.state.okf.browser.historyIndex).toBe(0);
    // Forward re-enters 'b'.
    await store.dispatch('okf/browserForward');
    expect(store.state.okf.browser.selectedConceptId).toBe('b');
    expect(mockFetchConcept).toHaveBeenLastCalledWith('r1', 'b');
  });

  test('a visit for a superseded repo is refused and never enters the history', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'a' });
    const res = await store.dispatch('okf/browserVisitConcept', { repoId: 'OTHER', conceptId: 'x' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('STALE');
    expect(store.state.okf.browser.history).toEqual(['a']);
  });

  test('back-to-list clears the selection but the history SURVIVES (a fresh click continues the session)', async () => {
    mockTreePage.mockImplementation(async (_r, { offset }) => page(1, offset, 1));
    const store = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'a' });
    await store.dispatch('okf/browserVisitConcept', { repoId: 'r1', conceptId: 'b' });
    store.commit('okf/setBrowserSelected', { conceptId: null, concept: null });
    const b = store.state.okf.browser;
    expect(b.selectedConceptId).toBe(null);
    expect(b.history).toEqual(['a', 'b']);
    expect(b.historyIndex).toBe(1);
  });
});
