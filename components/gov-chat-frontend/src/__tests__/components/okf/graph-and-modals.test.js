'use strict';

/**
 * Story #978 - RepoGraphView (SVG concept graph), AddConceptModal, and the
 * Validate step's real-data wiring.
 */

const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const okfModule = require('@/store/modules/okf').default;

const mockGetManifest = jest.fn();
const mockGetRepoLinks = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    getManifest: (...a) => mockGetManifest(...a),
    getRepoLinks: (...a) => mockGetRepoLinks(...a),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(null),
    patchConcept: jest.fn().mockResolvedValue({ ok: true }),
    resplit: jest.fn(),
    autocorrect: jest.fn().mockResolvedValue({ ok: true, changes: [], warnings: [] }),
    importConcepts: jest.fn().mockResolvedValue({ ok: true }),
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
    // PRIMARY source (David's rule): the LIVE meta projection —
    // GET /:repo_id/links — available from the first import, current through
    // every edit. The settled manifest is the FALLBACK (legacy backends).
    mockGetRepoLinks.mockResolvedValue({
      repo_id: 'r-1',
      links: [{ from_concept_id: 'wildlife', to_concept_id: 'parks', label: '', source: 'author' }],
      concept_count: 3
    });
    mockGetManifest.mockResolvedValue({
      root_id: 'index',
      links: [{ from_concept_id: 'wildlife', to_concept_id: 'parks', source: 'author' }]
    });
  });

  it('renders from the live links projection and draws only in-repo edges', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // Hub hidden by default (index TOC links are structure, not knowledge).
    expect(wrapper.vm.nodes).toHaveLength(2);
    expect(wrapper.vm.edges).toHaveLength(1);
    expect(wrapper.vm.edges[0].label).toBe('related');
    // v2 browser: nodes/edges live in the cytoscape instance (canvas), not the DOM.
    expect(wrapper.vm.cy.nodes()).toHaveLength(2);
    expect(wrapper.vm.cy.edges()).toHaveLength(1);
    expect(mockGetRepoLinks).toHaveBeenCalledWith('r-1');
    expect(mockGetManifest).not.toHaveBeenCalled();
  });

  it('emits select when a node is tapped in the browser', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // rebuild is post-DOM-patch now (nextTick)
    wrapper.vm.cy.getElementById('wildlife').emit('tap');
    expect(wrapper.emitted('select')).toEqual([['wildlife']]);
  });

  it('highlights the link neighborhood on tap and clears on background tap', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // rebuild is post-DOM-patch now (nextTick)
    const cy = wrapper.vm.cy;
    cy.getElementById('wildlife').emit('tap');
    // Hub hidden by default: wildlife + parks stay bright, their shared edge lights up.
    expect(cy.getElementById('wildlife').hasClass('faded')).toBe(false);
    expect(cy.getElementById('parks').hasClass('faded')).toBe(false);
    expect(cy.edges().hasClass('hot')).toBe(true);
    cy.emit('tap', { target: cy });
    expect(cy.elements().hasClass('faded')).toBe(false);
  });

  it('normalizes legacy concepts/ -prefixed link targets to node ids', async () => {
    mockGetRepoLinks.mockResolvedValue({
      links: [
        { from_concept_id: 'index', to_concept_id: 'concepts/wildlife', label: '', source: 'author' },
        { from_concept_id: 'wildlife', to_concept_id: 'concepts/parks', label: '', source: 'author' }
      ]
    });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // Hub hidden by default: index->wildlife (TOC edge) suppressed.
    expect(wrapper.vm.edges).toHaveLength(1);
    // Toolbar toggle restores the hub AND its TOC edges.
    wrapper.vm.showHub = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.edges).toHaveLength(2);
  });

  it('reloads links when the concept set changes (edits land live)', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    const calls = mockGetRepoLinks.mock.calls.length;
    await wrapper.setProps({ concepts: [...CONCEPTS, { concept_id: 'new', title: 'New' }] });
    await wrapper.vm.$nextTick();
    expect(mockGetRepoLinks.mock.calls.length).toBeGreaterThan(calls);
  });

  it('falls back to the settled manifest when the links route is absent (legacy backend)', async () => {
    mockGetRepoLinks.mockRejectedValue({ status: 404 });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.edges).toHaveLength(1);
    expect(mockGetManifest).toHaveBeenCalledWith('r-1');
  });

  it('tolerates both sources unavailable (nodes, zero edges)', async () => {
    mockGetRepoLinks.mockRejectedValue({ status: 404 });
    mockGetManifest.mockRejectedValue({ status: 404 });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.edges).toHaveLength(0);
    // Hub hidden by default → 2; toggle restores the index hub → 3.
    expect(wrapper.vm.nodes).toHaveLength(2);
    wrapper.vm.showHub = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.nodes).toHaveLength(3);
  });

  it('shows the empty state for a repo without concepts', () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: [] });
    expect(wrapper.text()).toContain('nothing to graph');
  });

  it('builds the browser when concepts arrive AFTER mount (fresh repo open — zero-graph regression)', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: [] });
    await wrapper.vm.$nextTick();
    // Empty state: no stage, no browser yet.
    expect(wrapper.vm.cy || null).toBe(null);
    // The steward opens the repo; the concepts fetch lands AFTER the Graph
    // tab mounted — the browser must build on arrival (live-broken 2026-09-05
    // on Kenya: rebuild ran before the stage existed and never retried).
    await wrapper.setProps({ concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.cy && wrapper.vm.cy.nodes()).toHaveLength(2);
  });

  it('produces canvas-safe palette colors (no NaN — the oklch tint regression)', () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    const p = wrapper.vm.palette();
    for (const k of Object.keys(p)) {
      expect(String(p[k]) + ' (' + k + ')').not.toMatch(/NaN/i);
      // Gradient stops / line colors must be a color the canvas accepts:
      // resolved rgba(), hex, or a passthrough token — never a broken mix.
      expect(String(p[k]) + ' (' + k + ')').toMatch(/^(rgba\(|#|oklch|rgb\(|--)/);
    }
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

const OkfRepoEditor = require('@/components/okf/editor/RepoEditor.vue').default;

describe('OkfRepoEditor - fresh-repo regression (syncMetaFields null row)', () => {
  it('mounts cleanly with an EMPTY concept list (fresh repo), then syncs on arrival', async () => {
    const store = realStore();
    const listMock = require('@/services/conceptService').default.listForRepo;
    listMock.mockResolvedValueOnce([]); // first fetch: empty (fresh repo)
    const wrapper = mount(OkfRepoEditor, {
      global: { plugins: [store] },
      props: { repoId: 'r-new' }
    });
    await wrapper.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.find('.okf-re__placeholder').exists()).toBe(true);
    // concepts arrive -> auto-select fires -> right rail syncs without throwing
    listMock.mockResolvedValueOnce([
      { concept_id: 'index', title: 'Index', is_index: true, frontmatter: { type: 'index', title: 'Index' } },
      { concept_id: 'w', title: 'Wildlife', frontmatter: { type: 'topic' }, labels: ['Health'] }
    ]);
    await store.dispatch('okf/fetchConcepts', 'r-new');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.metaType).toBe('index'); // index row has no label
    expect(wrapper.vm.metaLabel).toBe('');
    // selecting the labeled file syncs its label into the rail
    await store.commit('okf/setSelectedConcept', 'w');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.metaLabel).toBe('Health');
  });
});
