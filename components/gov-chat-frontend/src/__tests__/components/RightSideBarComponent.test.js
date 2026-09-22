'use strict';

/**
 * RightSideBarComponent — FAQ language contract + AgroGenio brand integration.
 *
 * FAQ language contract: the FAQ is written in English and translated for the
 * interface language. When the translation cannot be produced, the English
 * original is still shown, but the user has to be told: an English FAQ
 * presented as a translated one is the failure these tests pin.
 *
 * Brand integration: the AgroGenio leaf decoration renders with the expanded
 * sidebar and hides with the collapsed one.
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

function createRightSideBarWrapper(propsOverrides = {}) {
  // RightSideBarComponent fetches /FAQ.md on mount — provide a minimal stub
  // so the fetch resolves cleanly without touching the network.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve('# FAQ\n\n## Q1\nA1\n')
  });

  return mount(RightSideBarComponent, {
    props: {
      currentLocale: 'en',
      relatedDocuments: [],
      ...propsOverrides
    },
    global: {
      mocks: {
        config: {
          app: {
            sidebarLeaf: { url: '/assets/agrogenio/leaf-particles.png' }
          }
        },
        $t: (key) => key,
        $i18n: { locale: 'en' }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag', 'ariaLabel'],
          emits: ['click']
        },
        FileText: true,
        ChevronRight: true,
        ChevronLeft: true
      }
    }
  });
}

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

describe('RightSideBarComponent', () => {
  describe('AgroGenio leaf decoration', () => {
    it('renders sidebar-header-leaves when sidebar is expanded', () => {
      const wrapper = createRightSideBarWrapper();
      const leaves = wrapper.find('.sidebar-header-leaves');
      expect(leaves.exists()).toBe(true);
      expect(leaves.attributes('src')).toBe('/assets/agrogenio/leaf-particles.png');
      expect(leaves.attributes('aria-hidden')).toBe('true');
    });

    it('hides sidebar-header-leaves when sidebar is collapsed', async () => {
      const wrapper = createRightSideBarWrapper();
      await wrapper.setData({ sidebarCollapsed: true });
      expect(wrapper.find('.sidebar-header-leaves').exists()).toBe(false);
    });
  });

  describe('basic rendering', () => {
    it('renders the sidebar container', () => {
      const wrapper = createRightSideBarWrapper();
      expect(wrapper.find('.sidebar').exists()).toBe(true);
    });

    it('renders the sidebar header with title and toggle', () => {
      const wrapper = createRightSideBarWrapper();
      expect(wrapper.find('.sidebar-header').exists()).toBe(true);
      expect(wrapper.find('.sidebar-toggle').exists()).toBe(true);
    });
  });
});
