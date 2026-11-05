'use strict';

/**
 * STUDIO TAB TEST RIG — the mock battery + store + mount for
 * `components/okf/StudioTab.vue`. New StudioTab suites MUST use this rig:
 * a new service import is mocked in ONE file, and a suite that forgets a
 * mock mounts the real service. (studio-tab-domain and
 * studio-tab-draft-notice use it; the older wizard-handoff and
 * studio-draft-resume suites still carry their own batteries — migrate
 * them when next touched.)
 *
 * The StudioTab dependencies are mocked HERE (module scope, so jest hoists
 * them for every importing suite); the per-suite jest.fn handles are
 * exported so a test can shape its own answers.
 */

const mockLoad = jest.fn().mockResolvedValue([
  { value: 'Water Supply', label: 'Water Supply' },
  { value: 'Health Services', label: 'Health Services' }
]);
const mockCreateRepo = jest.fn().mockResolvedValue({ repo_id: 'r1', name: 'bundle', domain: 'Water Supply' });
const mockImportZip = jest.fn().mockResolvedValue({ ok: true });

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    getMetrics: jest.fn(),
    // The retrieval posture card (Story 10.7) is a real child of StudioTab
    // now — it reads this on mount. Without it the card renders its error
    // state, which is a lie about the surface this suite mounts.
    getRetrievalConfig: jest.fn().mockResolvedValue({
      config: {
        mode: 'legacy',
        revision: 0,
        max_fanout_graphs: 5,
        spine_max_hops: 2,
        extracted_hop_cap: 1,
        candidate_cap_per_graph: 50,
        candidate_cap_global: 200
      },
      source: 'env-defaults',
      limits: {
        max_fanout_graphs: { min: 1, max: 20 },
        spine_max_hops: { min: 1, max: 3 },
        extracted_hop_cap: { min: 1, max: 3 },
        candidate_cap_per_graph: { min: 1, max: 200 },
        candidate_cap_global: { min: 1, max: 1000 }
      },
      modes: ['legacy', 'okf_only', 'hybrid'],
      serving_graph_count: 0,
      serving_graphs: [],
      engaged: false,
      warnings: []
    }),
    getRetrievalConfigAudit: jest.fn().mockResolvedValue([])
  }
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
// BOTH surfaces: components import .default; the store requires the
// NAMESPACE (no .default) — named exports must exist at top level too.
jest.mock('@/services/okfRepoOps', () => {
  const impl = {
    loadSubjectAreaOptions: (...a) => mockLoad(...a),
    createRepo: (...a) => mockCreateRepo(...a),
    importZipIntoRepo: (...a) => mockImportZip(...a)
  };
  return { __esModule: true, default: impl, ...impl };
});

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const okfModule = require('@/store/modules/okf').default;
const OkfStudioTab = require('@/components/okf/StudioTab.vue').default;

/**
 * A REAL Vuex store (mapGetters needs _modulesNamespaceMap) with the okf
 * module; dispatch is spied so assertions see the exact payloads.
 */
function buildStore() {
  const store = new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
  const dispatch = jest.spyOn(store, 'dispatch');
  return { store, dispatch };
}

/**
 * Mount the Studio tab.
 * @param {object} store  a Vuex store
 * @param {object} [options]  { i18n } — an $i18n mock; omit for the
 *   inline-fallback path (no i18n tree at all).
 */
function mountTab(store, options = {}) {
  const global = {
    plugins: [store],
    stubs: {
      OkfStudioDashboard: true,
      OkfStudioWizard: true,
      OkfRepoEditorShell: true,
      OkfNarrative: true,
      DsModeSwitch: true
    }
  };
  if (options.i18n) global.mocks = { $i18n: options.i18n };
  return mount(OkfStudioTab, { global });
}

module.exports = { buildStore, mountTab, mockLoad, mockCreateRepo, mockImportZip };
