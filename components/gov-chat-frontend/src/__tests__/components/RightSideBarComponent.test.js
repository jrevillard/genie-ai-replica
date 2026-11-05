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
  Languages: { template: '<svg />' }
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
