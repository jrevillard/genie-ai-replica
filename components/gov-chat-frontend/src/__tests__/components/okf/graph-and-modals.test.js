'use strict';

/**
 * Story #978 - RepoGraphView (SVG concept graph), AddConceptModal, and the
 * Validate step's real-data wiring.
 */

const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const okfModule = require('@/store/modules/okf').default;

const mockGetManifest = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    getManifest: (...a) => mockGetManifest(...a),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(null),
    patchConcept: jest.fn().mockResolvedValue({ ok: true }),
    resplit: jest.fn(),
    autocorrect: jest.fn().mockResolvedValue({ ok: true, changes: [], warnings: [] }),
    ingest: jest.fn().mockResolvedValue({ ok: true }),
    deleteConcept: jest.fn().mockResolvedValue({ ok: true }),
    create: jest.fn(),
    mintVersion: jest.fn()
  }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    update: jest.fn()
  }
}));
jest.mock('@/services/serviceTreeService', () => ({
  __esModule: true,
  default: { getAdminCategories: jest.fn().mockResolvedValue([]) }
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

function realStore() {
  return createStore({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
  });
}

function mountWith(component, props, store) {
  return mount(component, {
    global: { plugins: [store || realStore()], stubs: { teleport: true } },
    props
  });
}

const OkfRepoGraphView = require('@/components/okf/editor/RepoGraphView.vue').default;

describe('OkfRepoGraphView', () => {
  const CONCEPTS = [
    { concept_id: 'index', title: 'Index', is_index: true, index_status: 'indexed' },
    { concept_id: 'wildlife', title: 'Wildlife', index_status: 'indexed' },
    { concept_id: 'parks', title: 'Parks', index_status: 'failed' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetManifest.mockResolvedValue({
      concepts: [{ concept_id: 'wildlife', links: [{ to_concept_id: 'parks', label: 'see' }] }]
    });
  });

  it('renders index center + ring nodes and draws only in-repo link edges', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.nodes).toHaveLength(3);
    expect(wrapper.vm.edges).toHaveLength(1);
    expect(wrapper.findAll('.okf-gv__node').length).toBe(3);
    expect(wrapper.findAll('.okf-gv__edge').length).toBe(1);
    expect(mockGetManifest).toHaveBeenCalledWith('r-1');
  });

  it('emits select when a node is clicked', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.findAll('.okf-gv__node')[1].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['wildlife']]);
  });

  it('tolerates a not-yet-settled manifest (nodes, zero edges)', async () => {
    mockGetManifest.mockRejectedValue({ status: 404 });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.edges).toHaveLength(0);
    expect(wrapper.vm.nodes).toHaveLength(3);
  });

  it('shows the empty state for a repo without concepts', () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: [] });
    expect(wrapper.text()).toContain('nothing to graph');
  });
});

const OkfAddConceptModal = require('@/components/okf/editor/AddConceptModal.vue').default;

describe('OkfAddConceptModal', () => {
  function modalStore() {
    const store = realStore();
    const orig = store.dispatch.bind(store);
    store.dispatch = (type, payload) => {
      if (type === 'okf/createConcept') return Promise.resolve({ ok: true, concept_id: 'wildlife' });
      return orig(type, payload);
    };
    return store;
  }

  it('disables Create until a title is entered and dispatches on create', async () => {
    const store = modalStore();
    const wrapper = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: true }, store);
    const createBtn = wrapper.findAll('button').find((b) => b.text().includes('Create file'));
    expect(createBtn.element.disabled).toBe(true);
    wrapper.vm.title = 'Wildlife';
    await wrapper.vm.$nextTick();
    const createBtn2 = wrapper.findAll('button').find((b) => b.text().includes('Create file'));
    expect(createBtn2.element.disabled).toBe(false);
    wrapper.vm.onAction('create');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('created')).toEqual([['wildlife']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers the index type only when the repo has no index yet', () => {
    const without = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: false });
    expect(without.find('select').html()).toContain('value="index"');
    const withIdx = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: true });
    expect(withIdx.find('select').html()).not.toContain('value="index"');
  });
});

const OkfStepValidate = require('@/components/okf/steps/Validate.vue').default;

describe('OkfStepValidate - real data wiring (was hard-coded zeros)', () => {
  it('populates issue groups from the autocorrect dry-run + index failures', async () => {
    const store = realStore();
    const orig = store.dispatch.bind(store);
    store.dispatch = (type, payload) => {
      if (type === 'okf/autocorrectRepo') {
        return Promise.resolve({
          ok: true,
          changes: [{ concept_id: 'c1', reason: 'MISSING_TYPE', before: null, after: 'topic' }],
          warnings: [{ concept_id: 'c2', rule: 'INVALID_TYPE', severity: 'warning', message: 'bad type' }]
        });
      }
      if (type === 'okf/fetchConcepts') {
        return Promise.resolve({
          ok: true,
          concepts: [
            { concept_id: 'c3', index_status: 'failed' },
            { concept_id: 'c4', index_status: 'indexed' }
          ]
        });
      }
      return orig(type, payload);
    };

    const wrapper = mountWith(OkfStepValidate, { draft: { repo_id: 'r-1', concept_count: 4 } }, store);
    await wrapper.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    const groups = wrapper.vm.issueGroups;
    const byCode = Object.fromEntries(groups.map((g) => [g.code, g.count]));
    expect(byCode.MISSING_TYPE).toBe(1);
    expect(byCode.INVALID_TYPE).toBe(1);
    expect(byCode.INDEX_FAILED).toBe(1);
    const text = wrapper.text();
    expect(text).toContain('c1');
    expect(text).toContain('c3');
  });
});
