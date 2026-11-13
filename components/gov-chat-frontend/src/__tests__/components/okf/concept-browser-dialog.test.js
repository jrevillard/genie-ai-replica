'use strict';

/**
 * ConceptBrowserDialog (W9 browser; REDESIGNED per issue #1836, David
 * 2026-11-14): the citizen modal viewer. Pinned here: the CURRENT-STATE
 * notice, the honest unavailable arm, the TREE pane (the editor's own
 * OkfConceptList, read-only — index root + children), the back/forward
 * HISTORY affordances, the ALWAYS-RENDERED content pane (the old v-if
 * vanish is the defect), per-hop selection through the store's visit
 * action, related concepts normalized from the CAP-2 card links, the
 * sanitized markdown render, per-concept scroll memory, and the download
 * verb. The store-side assembly/stale-guards live in okf-browser.test.js.
 */

const { mount } = require('@vue/test-utils');

jest.mock('dompurify', () => ({ sanitize: jest.fn((c) => `<sanitized>${c}</sanitized>`) }));
jest.mock('@/services/notificationService', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() }
}));
jest.mock('@/utils/document-opener', () => ({
  ...jest.requireActual('@/utils/document-opener'),
  downloadOkfConcept: jest.fn()
}));

const ConceptBrowserDialog = require('@/components/okf/ConceptBrowserDialog.vue').default;
const notificationService = require('@/services/notificationService').default;
const { downloadOkfConcept } = require('@/utils/document-opener');
const DOMPurify = require('dompurify');

const BROWSER = (over = {}) => ({
  visible: true,
  repoId: 'repo-1',
  startConceptId: 'c1',
  concepts: [],
  total: 0,
  loading: false,
  extending: false,
  treeComplete: false,
  unavailable: false,
  error: null,
  selectedConceptId: null,
  selectedConcept: null,
  selectedLoading: false,
  selectedUnavailable: false,
  history: ['c1'],
  historyIndex: 0,
  ...over
});

function fakeStore(browserState) {
  const store = {
    getters: { 'okf/browser': browserState },
    commit: jest.fn(),
    dispatch: jest.fn().mockResolvedValue({ ok: true })
  };
  return store;
}

function mountDialog(browserState) {
  return mount(ConceptBrowserDialog, {
    global: {
      mocks: { $store: fakeStore(browserState) },
      stubs: {
        DsDialog: { template: '<div class="ds-dialog-stub"><slot /></div>' },
        DsSpinner: true
      }
    },
    props: { visible: true }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ConceptBrowserDialog — current-state + unavailable arms', () => {
  it('renders the current-state notice above the content (browse is NOW, not the cited version)', () => {
    const w = mountDialog(
      BROWSER({
        concepts: [{ concept_id: 'c1', title: 'C1', is_index: false, index_status: 'parsed', links: [] }],
        total: 1
      })
    );
    const notice = w.find('[data-testid="okf-browser-current-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('indexed now');
  });

  it('a fenced/absent repo (the 404 refusal) renders the honest unavailable notice and no tree', () => {
    const w = mountDialog(BROWSER({ unavailable: true }));
    expect(w.find('[data-testid="okf-browser-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-tree"]').exists()).toBe(false);
    expect(w.find('[data-testid="okf-browser-show-more"]').exists()).toBe(false);
  });
});

describe('ConceptBrowserDialog — the tree pane (issue #1836: the editor tree, not a flat table)', () => {
  const rows = [
    { concept_id: 'index', title: 'The index', is_index: true, index_status: 'indexed', links: [] },
    { concept_id: 'c1', title: 'Concept one', is_index: false, index_status: 'parsed', links: [] },
    { concept_id: 'c2', title: 'Concept two', is_index: false, index_status: 'parsed', links: [] }
  ];

  it('renders the concepts through the SHARED OkfConceptList (the editor tree: index root + children)', () => {
    const w = mountDialog(BROWSER({ concepts: rows, total: 3 }));
    // The shared component's own contract: BEM rows, the index badge, the
    // ROOT row's test hook (the component's hook is data-test-id, hyphenated,
    // on the root only) — the browser is the editor's tree view verbatim.
    expect(w.find('[data-testid="okf-browser-tree"]').exists()).toBe(true);
    expect(w.findAll('.okf-cl__row').length).toBe(3);
    expect(w.find('[data-test-id="okf-concept-row-index"]').exists()).toBe(true);
    expect(w.text()).toContain('Concept one');
    expect(w.find('.ds-table').exists()).toBe(false);
  });

  it('a tree-row click is a FORWARD navigation: okf/browserVisitConcept (history + load)', async () => {
    const store = fakeStore(BROWSER({ concepts: rows, total: 3 }));
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    // Child rows carry no per-row hook (the component's own contract) —
    // drive the rendered row; OkfConceptList emits the bare concept_id.
    const childRows = w.findAll('.okf-cl__row--child');
    expect(childRows.length).toBe(2);
    await childRows[1].trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('okf/browserVisitConcept', { repoId: 'repo-1', conceptId: 'c2' });
    expect(store.dispatch).not.toHaveBeenCalledWith('okf/browserLoadConcept', expect.anything());
  });

  it('lazy loading: Show more is the on-demand NEXT-PAGE fetch — no in-memory window anymore', async () => {
    const loaded = Array.from({ length: 200 }, (_, i) => ({
      concept_id: `c${i}`,
      title: `C${i}`,
      is_index: false,
      index_status: 'parsed',
      links: []
    }));
    const store = fakeStore(BROWSER({ concepts: loaded, total: 500, treeComplete: false }));
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    // All 200 loaded rows render (the tree is the editor's — every loaded
    // row is visible); the affordance offers the NEXT page.
    expect(w.findAll('.okf-cl__row').length).toBe(200);
    await w.find('[data-testid="okf-browser-show-more"]').trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('okf/browserExtendConceptTree', { repoId: 'repo-1' });
  });

  it('a complete tree hides Show more entirely', () => {
    const w = mountDialog(BROWSER({ concepts: rows, total: 3, treeComplete: true }));
    expect(w.find('[data-testid="okf-browser-show-more"]').exists()).toBe(false);
  });

  it('a service error renders in the error line', () => {
    const w = mountDialog(BROWSER({ error: 'cursor died' }));
    expect(w.find('[data-testid="okf-browser-error"]').text()).toBe('cursor died');
  });
});

describe('ConceptBrowserDialog — back/forward history (issue #1836: it is a browser)', () => {
  it('back/forward are enabled strictly inside the visited range', () => {
    const w = mountDialog(BROWSER({ history: ['c1', 'c2', 'c3'], historyIndex: 0, selectedConceptId: 'c1' }));
    expect(w.find('[data-testid="okf-browser-back"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="okf-browser-forward"]').attributes('disabled')).toBeUndefined();
    const w2 = mountDialog(
      BROWSER({
        history: ['c1', 'c2', 'c3'],
        historyIndex: 1,
        selectedConceptId: 'c2',
        selectedConcept: { concept_id: 'c2', title: 'C2', body: 'x' }
      })
    );
    expect(w2.find('[data-testid="okf-browser-back"]').attributes('disabled')).toBeUndefined();
    expect(w2.find('[data-testid="okf-browser-forward"]').attributes('disabled')).toBeUndefined();
    const w3 = mountDialog(
      BROWSER({
        history: ['c1', 'c2', 'c3'],
        historyIndex: 2,
        selectedConceptId: 'c3',
        selectedConcept: { concept_id: 'c3', title: 'C3', body: 'x' }
      })
    );
    expect(w3.find('[data-testid="okf-browser-back"]').attributes('disabled')).toBeUndefined();
    expect(w3.find('[data-testid="okf-browser-forward"]').attributes('disabled')).toBeDefined();
  });

  it('back dispatches okf/browserBack (mounted mid-history, forward-boundary end)', async () => {
    const store = fakeStore(
      BROWSER({
        history: ['c1', 'c2'],
        historyIndex: 1,
        selectedConceptId: 'c2',
        selectedConcept: { concept_id: 'c2', title: 'C2', body: 'x' }
      })
    );
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    await w.find('[data-testid="okf-browser-back"]').trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('okf/browserBack');
  });

  it('forward dispatches okf/browserForward (mounted at the back boundary, mid-range forward)', async () => {
    const store = fakeStore(
      BROWSER({
        history: ['c1', 'c2'],
        historyIndex: 0,
        selectedConceptId: 'c1',
        selectedConcept: { concept_id: 'c1', title: 'C1', body: 'x' }
      })
    );
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    await w.find('[data-testid="okf-browser-forward"]').trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('okf/browserForward');
    expect(store.dispatch).not.toHaveBeenCalledWith('okf/browserBack');
  });
});

describe('ConceptBrowserDialog — the content pane persists (issue #1836)', () => {
  it('the detail pane EXISTS with the select hint before anything is chosen (the v-if vanish is gone)', () => {
    const w = mountDialog(BROWSER({ selectedConceptId: null, selectedConcept: null, history: [], historyIndex: -1 }));
    expect(w.find('[data-testid="okf-browser-detail"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-select-hint"]').exists()).toBe(true);
  });

  it('a loading hop shows the loading pane INSIDE the always-present detail', () => {
    const w = mountDialog(BROWSER({ selectedConceptId: 'c2', selectedLoading: true }));
    expect(w.find('[data-testid="okf-browser-detail"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-detail-loading"]').exists()).toBe(true);
  });

  it('an unavailable concept renders the honest notice, not a dead link', () => {
    const w = mountDialog(BROWSER({ selectedConceptId: 'c9', selectedUnavailable: true }));
    expect(w.find('[data-testid="okf-browser-concept-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-markdown"]').exists()).toBe(false);
  });

  it('the open concept renders markdown through the sanitizer', () => {
    const w = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: '# Hello' } })
    );
    expect(DOMPurify.sanitize).toHaveBeenCalled();
    expect(w.find('[data-testid="okf-browser-markdown"]').exists()).toBe(true);
    expect(w.html()).toContain('sanitized');
  });

  it('related concepts normalize the card links (targets stripped of .md + prefix, labels as titles, self excluded)', async () => {
    const w = mountDialog(
      BROWSER({
        selectedConceptId: 'c1',
        selectedConcept: {
          concept_id: 'c1',
          title: 'C1',
          body: '# body',
          links: [
            { to_concept_id: 'c2', label: 'Booking' },
            { target: 'concepts/c3.md' },
            { to_concept_id: 'c1', label: 'self' },
            { to_concept_id: 'c2', label: 'dupe' },
            null
          ]
        }
      })
    );
    const chips = w.findAll('.okf-browser__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].text()).toBe('Booking');
    expect(chips[0].attributes('data-testid')).toBe('okf-browser-hop-c2');
    expect(chips[1].text()).toContain('c3');
    await chips[0].trigger('click');
    // A hop is also a FORWARD navigation (joins the history).
    expect(w.vm.$store.dispatch).toHaveBeenCalledWith('okf/browserVisitConcept', { repoId: 'repo-1', conceptId: 'c2' });
  });

  it('leaving a concept stores its scroll position in the component memory (never in the store)', async () => {
    const w = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: '# long' } })
    );
    const el = w.find('[data-testid="okf-browser-markdown"]').element;
    Object.defineProperty(el, 'scrollTop', { value: 432, configurable: true, writable: true });
    w.vm.$options.watch.selectedConceptId.call(w.vm, 'c2', 'c1');
    expect(w.vm.scrollMemory.c1).toBe(432);
    expect(w.vm.$store.commit).not.toHaveBeenCalled();
  });

  it('Back to list clears the selection through the store and leaves the history alone', async () => {
    const store = fakeStore(
      BROWSER({
        selectedConceptId: 'c1',
        selectedConcept: { concept_id: 'c1', title: 'C1', body: 'x' },
        history: ['c1'],
        historyIndex: 0
      })
    );
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    await w.find('[data-testid="okf-browser-back-to-list"]').trigger('click');
    expect(store.commit).toHaveBeenCalledWith('okf/setBrowserSelected', { conceptId: null, concept: null });
    // #1836: back-to-list is NOT a history event — no history mutation, no
    // dispatch; re-selecting continues the same session.
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});

describe('ConceptBrowserDialog — download verb', () => {
  it('Download is disabled until a concept is open', () => {
    const w = mountDialog(BROWSER({}));
    expect(w.vm.actions.find((a) => a.key === 'download').disabled).toBe(true);
    const w2 = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: 'x' } })
    );
    expect(w2.vm.actions.find((a) => a.key === 'download').disabled).toBe(false);
  });

  it('Download fetches through the shared helper (the caller scope) — and an unavailable hop notifies honestly', async () => {
    const w = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: 'x' } })
    );
    downloadOkfConcept.mockResolvedValueOnce(undefined);
    await w.vm.onAction('download');
    expect(downloadOkfConcept).toHaveBeenCalledWith('repo-1', 'c1');
    expect(notificationService.info).not.toHaveBeenCalled();

    const unavailable = new Error('gone');
    unavailable.code = 'OKF_CONCEPT_UNAVAILABLE';
    downloadOkfConcept.mockRejectedValueOnce(unavailable);
    await w.vm.onAction('download');
    expect(notificationService.info).toHaveBeenCalled();
    expect(notificationService.error).not.toHaveBeenCalled();

    downloadOkfConcept.mockRejectedValueOnce(new Error('network down'));
    await w.vm.onAction('download');
    expect(notificationService.error).toHaveBeenCalled();
  });
});
