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
 * @param {boolean} options.translationSucceeds - whether the translation call answers
 */
function mockFetch({ faqAvailable, translationSucceeds }) {
  return jest.fn((url) => {
    if (url === '/FAQ.md') {
      if (!faqAvailable) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FAQ_MARKDOWN) });
    }
    if (url === '/api/translate/markdown') {
      if (!translationSucceeds) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ translated_markdown: '## Qu est-ce que GENIE.AI ?' })
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
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
    global.fetch = mockFetch({ faqAvailable: true, translationSucceeds: false });

    const wrapper = mountSidebar();
    await flushPromises();

    const notice = wrapper.find('[data-testid="faq-translation-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('sidebar.faqTranslationUnavailable');

    // The English original is still usable.
    expect(wrapper.find('.faq-question').text()).toContain('What is GENIE.AI?');
  });

  it('shows no notice when the translation succeeds', async () => {
    global.fetch = mockFetch({ faqAvailable: true, translationSucceeds: true });

    const wrapper = mountSidebar();
    await flushPromises();

    expect(wrapper.find('[data-testid="faq-translation-notice"]').exists()).toBe(false);
    expect(wrapper.find('.faq-question').text()).toContain('Qu est-ce que GENIE.AI ?');
  });

  it('shows a localized error state when the FAQ cannot be loaded', async () => {
    global.fetch = mockFetch({ faqAvailable: false, translationSucceeds: true });

    const wrapper = mountSidebar();
    await flushPromises();

    const error = wrapper.find('[data-testid="faq-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('sidebar.faqError');

    // No FAQ entry pretends to be content.
    expect(wrapper.find('.faq-question').exists()).toBe(false);
  });
});
