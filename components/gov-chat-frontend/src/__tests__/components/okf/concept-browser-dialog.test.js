'use strict';

/**
 * ConceptBrowserDialog (W9 — concept tree browse): the citizen modal viewer.
 * Pinned here: the CURRENT-STATE notice (browse shows what is indexed now),
 * the honest unavailable arm (fenced/absent repo), progressive list +
 * client-side filter, per-hop selection through the okf store, related
 * concepts normalized from the CAP-2 card links, the sanitized markdown
 * render, the download verb, and the windowed render ("Show more").
 * The store-side assembly/stale-guards live in okf-browser.test.js.
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
  progress: null,
  unavailable: false,
  error: null,
  selectedConceptId: null,
  selectedConcept: null,
  selectedLoading: false,
  selectedUnavailable: false,
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
    const w = mountDialog(BROWSER({ concepts: [{ concept_id: 'c1', title: 'C1', links: [] }], total: 1 }));
    const notice = w.find('[data-testid="okf-browser-current-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('indexed now');
  });

  it('a fenced/absent repo (the 404 refusal) renders the honest unavailable notice and no list', () => {
    const w = mountDialog(BROWSER({ unavailable: true }));
    expect(w.find('[data-testid="okf-browser-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-table"]').exists()).toBe(false);
    expect(w.find('[data-testid="okf-browser-filter"]').exists()).toBe(false);
  });
});

describe('ConceptBrowserDialog — list, filter, progress', () => {
  it('renders assembled rows with the count placeholder replaced ({n})', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ concept_id: `c${i}`, title: `Concept ${i}`, links: [] }));
    const w = mountDialog(BROWSER({ concepts: rows, total: 3 }));
    expect(w.find('[data-testid="okf-browser-count"]').text()).toBe('3 concepts');
    expect(w.findAll('.ds-table tbody tr').length).toBe(3);
    expect(w.find('[data-testid="okf-browser-count"]').text()).not.toContain('{n}');
  });

  it('the progress line renders done/total with the placeholders replaced', () => {
    const rows = Array.from({ length: 2 }, (_, i) => ({ concept_id: `c${i}`, title: `C${i}`, links: [] }));
    const w = mountDialog(BROWSER({ concepts: rows, total: 6, progress: { done: 2, total: 6 } }));
    const line = w.find('[data-testid="okf-browser-progress"]');
    expect(line.exists()).toBe(true);
    expect(line.text()).toContain('2 of 6');
    expect(line.text()).not.toContain('{done}');
  });

  it('the filter narrows the assembled rows client-side (title or id) and the count follows', async () => {
    const rows = [
      { concept_id: 'alpha', title: 'Alpha Booking', links: [] },
      { concept_id: 'hours', title: 'Office Hours', links: [] }
    ];
    const w = mountDialog(BROWSER({ concepts: rows, total: 2 }));
    expect(w.find('[data-testid="okf-browser-count"]').text()).toBe('2 concepts');
    await w.find('[data-testid="okf-browser-filter"]').setValue('alpha');
    expect(w.findAll('.ds-table tbody tr').length).toBe(1);
    expect(w.text()).toContain('Alpha Booking');
    // Review r0: while filtering, the count names the FILTERED rows — an
    // unfiltered total above a zero-match table would read as a contradiction.
    expect(w.find('[data-testid="okf-browser-count"]').text()).toBe('1 concepts');
    await w.find('[data-testid="okf-browser-filter"]').setValue('zzz-no-match');
    expect(w.find('[data-testid="okf-browser-count"]').text()).toBe('0 concepts');
  });

  it('a windowed render: 250 rows render 100 + Show more extends by 100', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ concept_id: `c${i}`, title: `C${i}`, links: [] }));
    const w = mountDialog(BROWSER({ concepts: rows, total: 250 }));
    expect(w.findAll('.ds-table tbody tr').length).toBe(100);
    const more = w.find('[data-testid="okf-browser-show-more"]');
    expect(more.exists()).toBe(true);
    await more.trigger('click');
    expect(w.findAll('.ds-table tbody tr').length).toBe(200);
    // When the window covers the set, the affordance is gone.
    await w.find('[data-testid="okf-browser-show-more"]').trigger('click');
    expect(w.find('[data-testid="okf-browser-show-more"]').exists()).toBe(false);
  });

  it('a service error renders in the error line', () => {
    const w = mountDialog(BROWSER({ error: 'cursor died' }));
    expect(w.find('[data-testid="okf-browser-error"]').text()).toBe('cursor died');
  });
});

describe('ConceptBrowserDialog — per-hop selection + related concepts', () => {
  it('a row click dispatches the per-hop CAP-2 fetch with repo + concept identity', async () => {
    const store = fakeStore(BROWSER({ concepts: [{ concept_id: 'c2', title: 'C2', links: [] }], total: 1 }));
    const w = mount(ConceptBrowserDialog, {
      global: { mocks: { $store: store }, stubs: { DsDialog: { template: '<div><slot /></div>' }, DsSpinner: true } },
      props: { visible: true }
    });
    await w.findAll('.ds-table tbody tr')[0].trigger('click');
    expect(store.dispatch).toHaveBeenCalledWith('okf/browserLoadConcept', { repoId: 'repo-1', conceptId: 'c2' });
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
    expect(w.vm.$store.dispatch).toHaveBeenCalledWith('okf/browserLoadConcept', { repoId: 'repo-1', conceptId: 'c2' });
  });

  it('the open concept renders markdown through the sanitizer', () => {
    const w = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: '# Hello' } })
    );
    expect(DOMPurify.sanitize).toHaveBeenCalled();
    expect(w.find('[data-testid="okf-browser-markdown"]').exists()).toBe(true);
    expect(w.html()).toContain('sanitized');
  });

  it('an unavailable concept renders the honest notice, not a dead link', () => {
    const w = mountDialog(BROWSER({ selectedConceptId: 'c9', selectedUnavailable: true }));
    expect(w.find('[data-testid="okf-browser-concept-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="okf-browser-markdown"]').exists()).toBe(false);
  });

  it('a loading hop shows the loading pane', () => {
    const w = mountDialog(BROWSER({ selectedConceptId: 'c2', selectedLoading: true }));
    expect(w.find('[data-testid="okf-browser-detail-loading"]').exists()).toBe(true);
  });

  it('Back to list clears the selection through the store', async () => {
    const w = mountDialog(
      BROWSER({ selectedConceptId: 'c1', selectedConcept: { concept_id: 'c1', title: 'C1', body: 'x' } })
    );
    await w.find('[data-testid="okf-browser-back"]').trigger('click');
    expect(w.vm.$store.commit).toHaveBeenCalledWith('okf/setBrowserSelected', { conceptId: null, concept: null });
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
