'use strict';

/**
 * RightSideBarComponent — FAQ language contract.
 *
 * The FAQ is written in English and translated for the interface language.
 * When the translation cannot be produced, the English original is still
 * shown, but the user has to be told: an English FAQ presented as a
 * translated one is the failure these tests pin.
 */

const { mount, flushPromises } = require('@vue/test-utils');
const { createStore } = require('vuex');

jest.mock('@lucide/vue', () => ({
  ChevronLeft: { template: '<svg />' },
  ChevronRight: { template: '<svg />' },
  ChevronUp: { template: '<svg />' },
  ChevronDown: { template: '<svg />' },
  FileText: { template: '<svg />' },
  HelpCircle: { template: '<svg />' },
  Globe: { template: '<svg />' },
  FileSpreadsheet: { template: '<svg />' },
  FileImage: { template: '<svg />' },
  Languages: { template: '<svg />' },
  ExternalLink: { template: '<svg />' },
  Library: { template: '<svg />' }
}));

const RightSideBarComponent = require('../../components/RightSideBarComponent.vue').default;

const FAQ_MARKDOWN = '## What is GENIE.AI?\n\nA sovereign RAG platform.\n\n## Who uses it?\n\nPublic sector staff.\n';

function createSidebarStore() {
  return createStore({
    state: () => ({ accessToken: 'mock-access-token' }),
    getters: {
      accessToken: (state) => state.accessToken
    }
  });
}

function mountSidebar(props = {}) {
  return mount(RightSideBarComponent, {
    propsData: { currentLocale: 'fr', ...props },
    global: {
      plugins: [createSidebarStore()],
      mocks: { $t: (key) => key }
    }
  });
}

/**
 * @param {object} options
 * @param {boolean} options.faqAvailable - whether /FAQ.md can be fetched
 * @param {object|null} options.translation - the body the translation call answers with;
 *   null makes the call fail
 */
function mockFetch({ faqAvailable, translation }) {
  return jest.fn((url) => {
    if (url === '/FAQ.md') {
      if (!faqAvailable) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAQ_MARKDOWN) });
    }
    if (url === '/api/translate/markdown') {
      if (translation === null) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(translation) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

const TRANSLATED_FAQ = { translated_markdown: '## Qu est-ce que GENIE.AI ?' };

// The sidebar lists the SAME citations as the answer card, so its badge must
// say the same thing: an OKF concept has no file extension, and the
// extension fallback renders the first four characters of its name.
describe('RightSideBarComponent OKF concept citations', () => {
  it('badges an OKF concept citation as OKF, not as a file extension', () => {
    const wrapper = mountSidebar({
      relatedDocuments: [{ id: 'hadith-nawawi-36', title: 'hadith nawawi 36', source: 'okf-concept' }]
    });
    const badge = wrapper.find('.file-type-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('OKF');
  });

  it('keeps the file-extension badge for a repository document', () => {
    const wrapper = mountSidebar({
      relatedDocuments: [{ id: 'doc-1', title: 'Guide', fileName: 'guide.pdf' }]
    });
    const badge = wrapper.find('.file-type-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('PDF');
  });

  // Review fix (2026-11-07): the origin-row TEMPLATE block had no render
  // test — the existing suites assert the methods only, so a v-if that never
  // fires (or rows moved outside the card's v-for scope) would silently drop
  // the sidebar's W5 origin affordance with every gate green. Mirror of the
  // ChatBotComponent CAP-4 rendering test.
  it('renders origin rows for a resolved concept row and none without resolved origins', () => {
    const wrapper = mountSidebar({
      relatedDocuments: [
        {
          id: 'alpha_concept',
          title: 'Alpha Concept',
          source: 'okf-concept',
          repoId: 'repo-1',
          okfSources: [{ kind: 'document', file_id: 'doc-9', file_name: 'Report.pdf' }]
        },
        { id: 'doc-7', title: 'Plain.pdf', url: '/api/files/doc-7/download' },
        { id: 'bare_concept', title: 'Bare', source: 'okf-concept', repoId: 'repo-1', okfSources: [] }
      ]
    });
    const origins = wrapper.findAll('.document-origin');
    expect(origins.length).toBe(1);
    expect(origins[0].attributes('data-testid')).toBe('document-origin-0');
    expect(origins[0].text()).toContain('Report.pdf');
    wrapper.unmount();
  });
});

describe('RightSideBarComponent FAQ language contract', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows the English FAQ and announces it when the translation fails', async () => {
    global.fetch = mockFetch({ faqAvailable: true, translation: null });

    const wrapper = mountSidebar();
    await flushPromises();

    const notice = wrapper.find('[data-testid="faq-translation-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('sidebar.faqTranslationUnavailable');

    // The English original is still usable.
    expect(wrapper.find('[data-testid="faq-question"]').text()).toContain('What is GENIE.AI?');
  });

  it('shows the English FAQ when the answer carries no translation', async () => {
    global.fetch = mockFetch({ faqAvailable: true, translation: {} });

    const wrapper = mountSidebar();
    await flushPromises();

    expect(wrapper.find('[data-testid="faq-translation-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="faq-question"]').text()).toContain('What is GENIE.AI?');
  });

  it('shows the English FAQ when the translation is empty', async () => {
    global.fetch = mockFetch({ faqAvailable: true, translation: { translated_markdown: '' } });

    const wrapper = mountSidebar();
    await flushPromises();

    expect(wrapper.find('[data-testid="faq-translation-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="faq-question"]').text()).toContain('What is GENIE.AI?');
  });

  it('shows no notice when the translation succeeds', async () => {
    global.fetch = mockFetch({ faqAvailable: true, translation: TRANSLATED_FAQ });

    const wrapper = mountSidebar();
    await flushPromises();

    expect(wrapper.find('[data-testid="faq-translation-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="faq-question"]').text()).toContain('Qu est-ce que GENIE.AI ?');
  });

  it('shows a localized error state when the FAQ cannot be loaded', async () => {
    global.fetch = mockFetch({ faqAvailable: false, translation: TRANSLATED_FAQ });

    const wrapper = mountSidebar();
    await flushPromises();

    const error = wrapper.find('[data-testid="faq-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('sidebar.faqError');

    // No FAQ entry pretends to be content.
    expect(wrapper.find('[data-testid="faq-question"]').exists()).toBe(false);
  });

  it('asks for the FAQ in the interface language, from English', async () => {
    const fetchMock = mockFetch({ faqAvailable: true, translation: TRANSLATED_FAQ });
    global.fetch = fetchMock;

    mountSidebar({ currentLocale: 'fr' });
    await flushPromises();

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/translate/markdown');
    expect(call).toBeDefined();

    // The languages are named by the contract the backend resolves: the
    // interface language is the target, English is the source the FAQ is
    // written in. A request that names them differently would be refused.
    const body = JSON.parse(call[1].body);
    expect(body.target_lang).toBe('fr');
    expect(body.source_lang).toBe('en');
    expect(body.markdown).toContain('What is GENIE.AI?');

    // The endpoint is authenticated: an anonymous request comes back
    // unauthorized and the user is left with the English original.
    expect(call[1].headers.Authorization).toBe('Bearer mock-access-token');
  });
});

// ===========================================================================
// CAP-3 (chat-source resolution): the sidebar's okf-concept open branch and
// the URL display guard.
// ===========================================================================
jest.mock('../../utils/document-opener', () => ({
  ...jest.requireActual('../../utils/document-opener'),
  openOkfConcept: jest.fn(),
  openOkfSource: jest.fn(),
  openRepositoryDocument: jest.fn()
}));
jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() }
}));

describe('CAP-3 okf-concept sidebar branch', () => {
  const documentOpener = require('../../utils/document-opener');
  const notificationService = require('../../services/notificationService').default;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('openDocument routes a concept with repo identity through openOkfConcept', async () => {
    const wrapper = mountSidebar();
    documentOpener.openOkfConcept.mockResolvedValueOnce(undefined);
    await wrapper.vm.openDocument({ id: 'alpha_concept', source: 'okf-concept', repoId: 'repo-1', url: '' });
    expect(documentOpener.openOkfConcept).toHaveBeenCalledWith('repo-1', 'alpha_concept');
    expect(documentOpener.openRepositoryDocument).not.toHaveBeenCalled();
    expect(wrapper.emitted('open-document')).toHaveLength(1);
  });

  it('openDocument degrades an identity-less concept to the info notice', async () => {
    const wrapper = mountSidebar();
    await wrapper.vm.openDocument({ id: 'old_concept', source: 'okf-concept', repoId: null, url: '' });
    expect(documentOpener.openOkfConcept).not.toHaveBeenCalled();
    expect(notificationService.info).toHaveBeenCalled();
    expect(wrapper.emitted('open-document')).toBeUndefined();
  });

  it('getDisplayUrl shows no doc-repo URL for concept rows', () => {
    const wrapper = mountSidebar();
    expect(wrapper.vm.getDisplayUrl({ id: 'alpha_concept', source: 'okf-concept', url: '' })).toBe('');
    expect(wrapper.vm.getDisplayUrl({ id: 'doc-9', url: '/api/files/doc-9/download' })).toContain(
      '/api/files/doc-9/viewbrowser'
    );
  });
});

// ===========================================================================
// CAP-4 (W5): the sidebar's original-source origin rows — the same contract
// as the answer cards: openOkfSource for file_id origins, honest notice for
// the D4 refusal / gone file, notice without a fetch for crawl-only entries.
// ===========================================================================
describe('CAP-4 sidebar origin rows', () => {
  const documentOpener = require('../../utils/document-opener');
  const notificationService = require('../../services/notificationService').default;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('openOriginDocument opens a file-id origin through openOkfSource', async () => {
    const wrapper = mountSidebar();
    documentOpener.openOkfSource.mockResolvedValueOnce(undefined);
    await wrapper.vm.openOriginDocument({ kind: 'document', file_id: 'doc-9', file_name: 'Report.pdf' });
    expect(documentOpener.openOkfSource).toHaveBeenCalledWith('doc-9', expect.any(String));
    expect(wrapper.emitted('open-document')).toHaveLength(1);
  });

  it('a D4-refused or gone source shows the info notice', async () => {
    const wrapper = mountSidebar();
    const unavailable = new Error('not available');
    unavailable.code = 'OKF_SOURCE_UNAVAILABLE';
    documentOpener.openOkfSource.mockRejectedValueOnce(unavailable);
    await wrapper.vm.openOriginDocument({ kind: 'document', file_id: 'doc-9' });
    expect(notificationService.info).toHaveBeenCalled();
  });

  it('a crawl-resource origin without a file id notifies without fetching', async () => {
    const wrapper = mountSidebar();
    await wrapper.vm.openOriginDocument({ kind: 'crawl', resource: 'https://example.gov/page' });
    expect(documentOpener.openOkfSource).not.toHaveBeenCalled();
    expect(notificationService.info).toHaveBeenCalled();
  });

  it('originLabel prefers the file name, then the stripped URL, then the i18n wording', () => {
    const wrapper = mountSidebar();
    expect(wrapper.vm.originLabel({ file_name: 'Report.pdf' })).toBe('Report.pdf');
    expect(wrapper.vm.originLabel({ resource: 'https://example.gov/page' })).toBe('example.gov/page');
    // the harness $t resolves the key itself — assert only that the fallback
    // path yields the i18n word, not a name or a URL
    const fallback = wrapper.vm.originLabel({});
    expect(fallback).not.toBe('Report.pdf');
    expect(fallback).not.toContain('example.gov');
  });
});

// ===========================================================================
// W9 (concept tree browse): the sidebar's browse affordance — the same
// working-citation predicate as the answer cards; the dialog is owned by
// the parent (one instance for both surfaces), so the click only EMITS.
// ===========================================================================
describe('W9 sidebar browse affordance', () => {
  it('renders the browse affordance on a working concept card and none without repo identity', () => {
    const wrapper = mountSidebar({
      relatedDocuments: [
        { id: 'working', title: 'Working', source: 'okf-concept', repoId: 'repo-1' },
        { id: 'pre_cap1', title: 'Pre-CAP-1', source: 'okf-concept', repoId: null },
        { id: 'doc-7', title: 'Plain.pdf', url: '/api/files/doc-7/download' }
      ]
    });
    const browses = wrapper.findAll('.document-browse-btn');
    expect(browses.length).toBe(1);
    expect(browses[0].attributes('data-testid')).toBe('document-browse-0');
    expect(wrapper.findAll('[data-testid="document-browse-1"]').length).toBe(0);
    expect(wrapper.findAll('[data-testid="document-browse-2"]').length).toBe(0);
    wrapper.unmount();
  });

  it('clicking the affordance emits browse-document with the cited concept', async () => {
    const doc = { id: 'alpha_concept', title: 'Alpha', source: 'okf-concept', repoId: 'repo-1' };
    const wrapper = mountSidebar({ relatedDocuments: [doc] });
    await wrapper.find('[data-testid="document-browse-0"]').trigger('click');
    expect(wrapper.emitted('browse-document')).toHaveLength(1);
    expect(wrapper.emitted('browse-document')[0][0].id).toBe('alpha_concept');
    // The click must not fall through to the card's open flow.
    expect(wrapper.emitted('open-document')).toBeUndefined();
    wrapper.unmount();
  });

  it('canBrowseSource mirrors the answer-card predicate', () => {
    const wrapper = mountSidebar();
    expect(wrapper.vm.canBrowseSource({ id: 'c', source: 'okf-concept', repoId: 'r' })).toBe(true);
    expect(wrapper.vm.canBrowseSource({ id: 'c', source: 'okf-concept', repoId: null })).toBe(false);
    expect(wrapper.vm.canBrowseSource({ id: 'doc', url: '/api/files/doc' })).toBe(false);
    wrapper.unmount();
  });
});
