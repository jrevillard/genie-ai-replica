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

// ASYNC BUILD (2026-09-13): the graph streams in setTimeout-yielded batches —
// the double-$nextTick that sufficed for the synchronous rebuild no longer
// guarantees vm.cy. Await the exposed build promise until the graph rests.
// (On components with no build path — e.g. the modal — this returns at once.)
async function built(wrapper) {
  for (let i = 0; i < 50; i++) {
    await wrapper.vm.$nextTick();
    if (wrapper.vm._buildPromise) await wrapper.vm._buildPromise;
    if (!wrapper.vm._buildPromise && !wrapper.vm.cy) return; // not a build path
    if (wrapper.vm.cy && !wrapper.vm.building) return; // built
  }
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
    await built(wrapper);
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
    await built(wrapper); // rebuild streams in batches (async build)
    wrapper.vm.cy.getElementById('wildlife').emit('tap');
    expect(wrapper.emitted('select')).toEqual([['wildlife']]);
  });

  it('highlights the link neighborhood on tap and clears on background tap', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await built(wrapper); // rebuild streams in batches (async build)
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
    await built(wrapper);
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
    await built(wrapper);
    expect(wrapper.vm.edges).toHaveLength(1);
    expect(mockGetManifest).toHaveBeenCalledWith('r-1');
  });

  it('tolerates both sources unavailable (nodes, zero edges)', async () => {
    mockGetRepoLinks.mockRejectedValue({ status: 404 });
    mockGetManifest.mockRejectedValue({ status: 404 });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await built(wrapper);
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
    await built(wrapper);
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

  // ---- hover summary card (David, 2026-09-12) ----------------------------
  const RICH_CONCEPTS = [
    {
      concept_id: 'wildlife',
      title: 'Wildlife of the Mara',
      type: 'topic',
      labels: ['Wildlife'],
      trust_tier: 'verified',
      summary: 'Big-cat populations, migration corridors and park conservation programmes.',
      chunk_count: 12,
      index_status: 'indexed',
      pii_state: 'hit'
    },
    { concept_id: 'parks', title: 'Parks', index_status: 'indexed' },
    // No links to/from it — outside every neighborhood.
    { concept_id: 'orphan', title: 'Orphan Page', index_status: 'indexed' }
  ];

  it('select syncs via select AND hovering the SELECTED node shows the summary card', async () => {
    mockGetRepoLinks.mockResolvedValue({
      links: [{ from_concept_id: 'wildlife', to_concept_id: 'parks', label: '', source: 'author' }]
    });
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: RICH_CONCEPTS });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    // Selection behavior UNCHANGED: tap emits 'select' (file-viewer sync).
    cy.getElementById('wildlife').emit('tap');
    expect(wrapper.emitted('select')).toEqual([['wildlife']]);
    // Hover the selected node -> the card floats with the OKF summary.
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.card.visible).toBe(true);
    expect(wrapper.vm.card.title).toBe('Wildlife of the Mara');
    expect(wrapper.vm.card.summary).toContain('migration corridors');
    expect(wrapper.vm.card.chips).toEqual(['topic', 'Wildlife', 'verified']);
    // out(1) + in(0) links, chunks, and the pii_state flag.
    expect(wrapper.vm.card.meta.join(' | ')).toContain('1 links');
    expect(wrapper.vm.card.meta.join(' | ')).toContain('12 chunks');
    expect(wrapper.vm.card.meta.join(' | ')).toContain('flagged entities');
  });

  it('does NOT show the card for a node that is not selected', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: RICH_CONCEPTS });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    wrapper.vm.cy.getElementById('wildlife').emit('mouseover');
    expect(wrapper.vm.card.visible).toBe(false);
  });

  it('zoom buttons change the zoom level about the viewport centre (cy.center() regression)', async () => {
    const wrapper = mountWith(OkfRepoGraphView, { repoId: 'r-1', concepts: CONCEPTS });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    const before = cy.zoom();
    // zoomIn (+): ×1.3. The old zoomBy passed cy.center() (the CORE, not a
    // position) as renderedPosition → NaN pan → viewport rejected it.
    wrapper.vm.zoomBy(1.3);
    expect(cy.zoom()).toBeCloseTo(before * 1.3, 5);
    wrapper.vm.zoomBy(1 / 1.3);
    expect(cy.zoom()).toBeCloseTo(before, 5);
  });

  it('shows the card for ADJACENT nodes of the selection, but not un-highlighted ones', async () => {
    const wrapper = mountWith(OkfRepoGraphView, {
      repoId: 'r-1',
      concepts: RICH_CONCEPTS,
      selectedId: 'wildlife'
    });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    // parks is wildlife's drawn neighbor — hovering it shows ITS summary.
    cy.getElementById('parks').emit('mouseover');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.card.visible).toBe(true);
    expect(wrapper.vm.card.title).toBe('Parks');
    // The selection itself still shows its own card.
    cy.getElementById('parks').emit('mouseout');
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.card.visible).toBe(true);
    expect(wrapper.vm.card.title).toBe('Wildlife of the Mara');
    // orphan is outside the highlighted neighborhood — nothing shows.
    // (mouseout now GRACE-DELAYS the dismiss so the user can reach the card;
    // the old card lingers briefly, and the un-highlighted node never shows.)
    cy.getElementById('wildlife').emit('mouseout');
    cy.getElementById('orphan').emit('mouseover');
    await new Promise((r) => setTimeout(r, 320)); // past the 250ms grace
    expect(wrapper.vm.card.visible).toBe(false);
  });

  it('hides the card on mouseout, on pan/zoom (viewport), and when the selection moves', async () => {
    const wrapper = mountWith(OkfRepoGraphView, {
      repoId: 'r-1',
      concepts: RICH_CONCEPTS,
      selectedId: 'wildlife'
    });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.card.visible).toBe(true);
    cy.getElementById('wildlife').emit('mouseout');
    // Grace-delayed dismiss (node→card mouse move) — gone after the window.
    await new Promise((r) => setTimeout(r, 320));
    expect(wrapper.vm.card.visible).toBe(false);
  });

  it('keeps the card while the mouse moves onto it and dismisses on card leave (David UX)', async () => {
    const wrapper = mountWith(OkfRepoGraphView, {
      repoId: 'r-1',
      concepts: RICH_CONCEPTS,
      selectedId: 'wildlife'
    });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    const card = wrapper.find('.okf-gv__card');
    expect(card.exists()).toBe(true);
    // Mouse leaves the node, enters the CARD: the pending dismiss is canceled.
    cy.getElementById('wildlife').emit('mouseout');
    await card.trigger('mouseenter');
    await new Promise((r) => setTimeout(r, 320));
    expect(wrapper.vm.card.visible).toBe(true); // survived the node→card move
    // Leaving the card dismisses it.
    await card.trigger('mouseleave');
    expect(wrapper.vm.card.visible).toBe(false);
  });

  it('hides the card on pan/zoom (viewport) and when the selection moves', async () => {
    const wrapper = mountWith(OkfRepoGraphView, {
      repoId: 'r-1',
      concepts: RICH_CONCEPTS,
      selectedId: 'wildlife'
    });
    await wrapper.vm.$nextTick();
    await built(wrapper);
    const cy = wrapper.vm.cy;
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    cy.emit('viewport'); // pan/zoom moves the node from under the cursor
    expect(wrapper.vm.card.visible).toBe(false);
    cy.getElementById('wildlife').emit('mouseover');
    await wrapper.vm.$nextTick();
    wrapper.vm.cy.getElementById('parks').emit('tap'); // selection moves
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.card.visible).toBe(false); // old card must not linger
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
    await built(wrapper);
    expect(wrapper.emitted('created')).toEqual([['wildlife']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers the index type only when the repo has no index yet', () => {
    const without = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: false });
    expect(without.find('select').html()).toContain('value="index"');
    const withIdx = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: true });
    expect(withIdx.find('select').html()).not.toContain('value="index"');
  });

  it('edits the body in the shared markdown editor — Source/Preview modes, value reaches create', async () => {
    const store = modalStore();
    const wrapper = mountWith(OkfAddConceptModal, { visible: true, repoId: 'r-1', hasIndex: true }, store);
    // The SAME DsOkfMarkdownEditor mode bar (Source | Split | Preview)…
    const modeButtons = wrapper.findAll('.ds-okf-md__mode').map((b) => b.text());
    expect(modeButtons).toEqual(expect.arrayContaining(['Preview', 'Split', 'Source only']));
    // …with the source pane usable immediately (expert) and NO frontmatter banner.
    expect(wrapper.find('.ds-okf-md__textarea').exists()).toBe(true);
    expect(wrapper.find('.ds-okf-md__frontmatter').exists()).toBe(false);
    // Typing in the editor reaches the modal body that createConcept dispatches.
    await wrapper.find('.ds-okf-md__textarea').setValue('# Wildlife\n\nReal body text');
    expect(wrapper.vm.body).toBe('# Wildlife\n\nReal body text');
    wrapper.vm.title = 'Wildlife';
    await wrapper.vm.$nextTick();
    wrapper.vm.onAction('create');
    await wrapper.vm.$nextTick();
    await built(wrapper);
    expect(wrapper.emitted('created')).toEqual([['wildlife']]);
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
