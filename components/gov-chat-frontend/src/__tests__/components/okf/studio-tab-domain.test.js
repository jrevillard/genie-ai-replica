'use strict';

/**
 * ZIP-IMPORT SUBJECT AREA (David, 2026-09-05 — "That is incorrect"): a zip
 * import must never silently fall back to 'General'. Domain is immutable
 * post-create, so the create dialog forces an explicit KH pick — no
 * auto-picking the first category, Import refused until chosen, and the
 * chosen domain rides the import payload.
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

const mockLoad = jest.fn().mockResolvedValue([
  { value: 'Water Supply', label: 'Water Supply' },
  { value: 'Health Services', label: 'Health Services' }
]);
const mockCreateRepo = jest.fn().mockResolvedValue({ repo_id: 'r1', name: 'bundle', domain: 'Water Supply' });
const mockImportZip = jest.fn().mockResolvedValue({ ok: true });

jest.mock('@/services/okfRepoOps', () => {
  // BOTH surfaces: components import .default; the store requires the
  // NAMESPACE (no .default) — named exports must exist at top level too.
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

// A REAL Vuex store (mapGetters needs _modulesNamespaceMap) with the okf
// module; dispatch is spied so assertions see the exact payloads.
function buildStore() {
  const store = new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
  });
  const dispatch = jest.spyOn(store, 'dispatch');
  return { store, dispatch };
}

function mountTab(store) {
  return mount(OkfStudioTab, {
    global: {
      plugins: [store],
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

function zipPickEvent(name) {
  return {
    target: {
      files: [new File(['zip-bytes'], name, { type: 'application/zip' })],
      value: 'C:\\fake\\' + name
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('the create action is disabled until a Subject Area is explicitly picked', async () => {
  const { store } = buildStore();
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();
  wrapper.vm.createOpen = true;
  wrapper.vm.createName = 'Permits';
  await wrapper.vm.$nextTick();
  const create = wrapper.vm.createActions.find((a) => a.key === 'create');
  expect(create.disabled).toBe(true); // no domain picked — no silent 'General'
  wrapper.vm.createDomain = 'Water Supply';
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.createActions.find((a) => a.key === 'create').disabled).toBe(false);
  wrapper.unmount();
});

it('a zip import without a Subject Area is refused and never dispatched', async () => {
  const { store, dispatch } = buildStore();
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();
  const evt = zipPickEvent('bundle.zip');
  await wrapper.vm.onImportFilePick(evt);
  expect(dispatch).not.toHaveBeenCalledWith('okf/upsertImported', expect.anything());
  expect(wrapper.vm.createError).toContain('subject area');
  expect(evt.target.value).toBe(''); // the pick is reset so the steward retries
  wrapper.unmount();
});

it('zip import: selection STAGES, the Create click creates → navigates → imports in background (P0-UX)', async () => {
  const { store, dispatch } = buildStore();
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();
  wrapper.vm.createDomain = 'Water Supply';
  wrapper.vm.importClassification = 'llm';
  await wrapper.vm.onImportFilePick(zipPickEvent('bundle.zip'));
  // staging only — no repo action on selection (David, 2026-09-08)
  expect(dispatch).not.toHaveBeenCalledWith('okf/createRepo', expect.anything());
  expect(wrapper.vm.stagedZipName).toBe('bundle.zip');
  // the Create click is the action point: create → dashboard → background
  await wrapper.vm.onCreateAction('create');
  expect(dispatch).toHaveBeenCalledWith(
    'okf/createRepo',
    expect.objectContaining({ name: 'bundle', domain: 'Water Supply' })
  );
  expect(mockImportZip).toHaveBeenCalledWith(expect.objectContaining({ repoId: 'r1', classification: 'llm' }));
  expect(wrapper.vm.view).toBe('dashboard'); // the card is the progress surface
  wrapper.unmount();
});
