'use strict';

/**
 * #1056 — the DEGRADED-DRAFT NOTICE.
 *
 * The NOT_READY fallback used to be silent: when the draft endpoint is not
 * available in the session, saves stayed in memory and a refresh lost the
 * curation state, with nothing telling the curator. The notice lives on the
 * Studio TAB (not the wizard) because the latch is session-global and the
 * zip-import path lands on the dashboard without ever entering the wizard.
 *
 * The suite mounts with the REAL English locale tree, so the assertions
 * cover the copy that ships — not the inline translate() fallback.
 */

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn().mockResolvedValue([]), get: jest.fn(), getMetrics: jest.fn() }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { listForRepo: jest.fn().mockResolvedValue([]), get: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: {
    saveDraft: jest.fn().mockRejectedValue({ status: 404 }),
    getDraft: jest.fn().mockRejectedValue({ status: 404 })
  }
}));
jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));
jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([]),
    createRepo: jest.fn().mockResolvedValue({ repo_id: 'r1' }),
    importZipIntoRepo: jest.fn().mockResolvedValue({ ok: true })
  }
}));

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const okfModule = require('@/store/modules/okf').default;
const OkfStudioTab = require('@/components/okf/StudioTab.vue').default;
const en = require('@/i18n/locales/en.js').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
}

function mountTab(store) {
  return mount(OkfStudioTab, {
    global: {
      plugins: [store],
      mocks: { $i18n: { messages: { en }, locale: 'en' } },
      stubs: {
        OkfStudioDashboard: true,
        OkfStudioWizard: true,
        OkfRepoEditorShell: true,
        OkfNarrative: true,
        DsModeSwitch: true
      }
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('a healthy session renders NO degraded-draft notice', async () => {
  const wrapper = mountTab(buildStore());
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.okf-studio-tab__draft-notice').exists()).toBe(false);
  wrapper.unmount();
});

it('#1056: the NOT_READY latch surfaces the degraded-draft notice on the tab', async () => {
  const store = buildStore();
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();
  store.commit('okf/setDraftsUnavailable');
  await wrapper.vm.$nextTick();
  const notice = wrapper.find('.okf-studio-tab__draft-notice');
  expect(notice.exists()).toBe(true);
  // The SHIPPED English copy, not the inline fallback.
  expect(notice.text()).toBe(en.okf.studio.draft.notReady);
  wrapper.unmount();
});

it('#1056: the shipped notice does not prescribe a reload (a reload drops the only copy)', () => {
  // Drafts live in the Vuex store only — a reload clears them, so the copy
  // must state the consequence instead of advising the curator to reload.
  expect(en.okf.studio.draft.notReady).not.toMatch(/reload the page/i);
  expect(en.okf.studio.draft.notReady).toMatch(/lost/i);
});

it('#1056: the shipped notice names both stale parties, not one', () => {
  // A 404 alone cannot tell an older server from a stale page — the copy
  // must not assert the backend is the stale one.
  expect(en.okf.studio.draft.notReady).toMatch(/page and the server may be different versions/i);
});
