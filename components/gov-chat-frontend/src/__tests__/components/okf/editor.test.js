'use strict';

/**
 * Story #978 - Studio editor component tests (ConceptList / ConceptEditor /
 * ResplitModal / RepoEditorShell default sub-tab).
 */

const { mount } = require('@vue/test-utils');

// Subject Areas load from the Knowledge Hierarchy via okfRepoOps — the
// dashboard's domain-filter regression test pins that contract with a
// canned tree (no network in jsdom). isBuilding mirrors the real semantics
// (conversion non-terminal) so the dashboard's building-poll test can drive it.
jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([
      { value: 'Water Supply', label: 'Water Supply' },
      { value: 'Health Services', label: 'Health Services' },
      { value: 'transport', label: 'transport (legacy)' }
    ]),
    isBuilding: jest.fn((r) => !!(r && r.conversion && !['done', 'failed'].includes(r.conversion.status))),
    // P0-UI: publish-state drains are REBUILDS, never building — the
    // dashboard poll keys on this plus the drain flags.
    isRedraining: jest.fn(
      (r) =>
        !!r &&
        r.lifecycle_state === 'publish' &&
        (r.rag_drain_active === true || !!(r.rag_ingestion && r.rag_ingestion.status === 'draining'))
    ),
    friendlyLifecycleError: (code, message) => message || String(code)
  }
}));

function fakeStore() {
  const dispatched = [];
  const store = {
    dispatched,
    getters: {
      'okf/editorSubTab': 'editor',
      'okf/repoById': () => ({ repo_id: 'r-1', name: 'Repo One', lifecycle_state: 'draft' })
    },
    commit(type, payload) {
      store.dispatched.push({ type, payload });
    },
    dispatch(type, payload) {
      store.dispatched.push({ type, payload });
      if (type === 'okf/getConcept') {
        return Promise.resolve({
          ok: true,
          concept: { concept_id: 'c-1', frontmatter: { type: 'topic', title: 'C1' }, body: '# C1 body' }
        });
      }
      if (type === 'okf/patchConcept') {
        return Promise.resolve({ ok: true, content_hash: 'H2', index_status: 'parsed' });
      }
      return Promise.resolve({ ok: true });
    }
  };
  return store;
}

function mountWith(component, store, props, stubs) {
  return mount(component, {
    global: { mocks: { $store: store }, stubs: stubs || {} },
    props
  });
}

const OkfConceptList = require('@/components/okf/editor/ConceptList.vue').default;

describe('OkfConceptList', () => {
  const base = [
    { concept_id: 'c-1', title: 'Page one', index_status: 'indexed', sources: [{ resource: 'https://x/1' }] },
    { concept_id: 'c-2', title: 'Page two', index_status: 'failed', is_index: true, labels: ['Health'] }
  ];

  it('renders rows with selection highlight, index badge and label', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base, selectedId: 'c-1' });
    expect(wrapper.findAll('.okf-cl__row')).toHaveLength(2);
    expect(wrapper.find('.okf-cl__row--selected').exists()).toBe(true);
    expect(wrapper.text()).toContain('Page one');
    expect(wrapper.text()).toContain('index');
    expect(wrapper.text()).toContain('Health');
  });

  it('filters rows by title text', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    await wrapper.find('input').setValue('two');
    expect(wrapper.findAll('.okf-cl__row')).toHaveLength(1);
  });

  it('renders a TREE (index root + children) and emits select from both', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    const rows = wrapper.findAll('.okf-cl__row');
    expect(rows).toHaveLength(2); // root + one child
    await rows[0].trigger('click'); // root = the index concept (c-2)
    expect(wrapper.emitted('select')).toEqual([['c-2']]);
    await rows[1].trigger('click'); // child = c-1
    expect(wrapper.emitted('select')[1]).toEqual(['c-1']);
  });

  it('emits add from the footer and delete per row action', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add concept'));
    await addBtn.trigger('click');
    expect(wrapper.emitted('add')).toHaveLength(1);
    const delBtn = wrapper.find('.okf-cl__action--danger');
    await delBtn.trigger('click');
    expect(wrapper.emitted('delete')).toHaveLength(1);
    expect(wrapper.emitted('delete')[0][0].concept_id).toBe('c-2');
  });

  it('emits label with the picked Knowledge-Hierarchy value', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), {
      concepts: base,
      labelOptions: [{ value: 'Health', label: 'Health' }]
    });
    const labelBtn = wrapper.find('.okf-cl__action');
    await labelBtn.trigger('click'); // opens the inline picker
    const select = wrapper.find('.okf-cl__label-edit select');
    expect(select.exists()).toBe(true);
    await select.setValue('Health');
    expect(wrapper.emitted('label')).toEqual([[{ conceptId: 'c-2', label: 'Health' }]]);
  });
});

const OkfConceptEditor = require('@/components/okf/editor/ConceptEditor.vue').default;

describe('OkfConceptEditor', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function mountEditor(store) {
    return mountWith(OkfConceptEditor, store || fakeStore(), { repoId: 'r-1', conceptId: 'c-1' });
  }

  it('loads the concept markdown (frontmatter + body composed)', async () => {
    const wrapper = mountEditor();
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.markdownLoaded).toBe(true);
    expect(wrapper.vm.markdown).toContain('type: topic');
    expect(wrapper.vm.markdown).toContain('# C1 body');
  });

  it('marks dirty on edit and autosaves after the debounce window', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('---\ntype: topic\n---\n# edited');
    expect(wrapper.vm.dirty).toBe(true);
    await jest.advanceTimersByTimeAsync(1500);
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.markdown).toContain('# edited');
  });

  it('saves BODY-ONLY when the edited frontmatter is unchanged (labels write-through)', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    // Same frontmatter as loaded ({ type: 'topic', title: 'C1' }) — body edit.
    const matter = require('gray-matter');
    wrapper.vm.onEdit(matter.stringify('# edited body\n', { type: 'topic', title: 'C1' }));
    await jest.advanceTimersByTimeAsync(1500);
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.body).toContain('# edited body');
    expect(patch.payload.markdown).toBeUndefined(); // no fm snapshot round-trip
  });

  it('flushes a pending save when switching concepts', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('# changed');
    await wrapper.setProps({ conceptId: 'c-2' });
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.conceptId).toBe('c-1');
  });
});

const OkfResplitModal = require('@/components/okf/editor/ResplitModal.vue').default;

describe('OkfResplitModal', () => {
  it('renders three modes with C disabled', () => {
    const wrapper = mountWith(OkfResplitModal, fakeStore(), { visible: true, repoId: 'r-1' }, { teleport: true });
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
    expect(radios[2].attributes('disabled')).toBeDefined();
  });

  it('confirm dispatches okf/resplitRepo with mode + fileId and closes', async () => {
    const store = fakeStore();
    const wrapper = mountWith(
      OkfResplitModal,
      store,
      { visible: true, repoId: 'r-1', fileId: 'f-1' },
      { teleport: true }
    );
    wrapper.vm.onAction('confirm');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const resplit = store.dispatched.find((d) => d.type === 'okf/resplitRepo');
    expect(resplit.payload).toMatchObject({ repoId: 'r-1', mode: 'B', fileId: 'f-1' });
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

const { shallowMount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const okfModule = require('@/store/modules/okf').default;
// Services mocked at module level — the real Vuex store's actions call them.
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

const OkfStudioDashboard = require('@/components/okf/StudioDashboard.vue').default;

describe('OkfStudioDashboard — domain filter (DsSelect options regression)', () => {
  it('renders the subject-area options via the DsSelect slot', async () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
    realStore.commit('okf/setExpertMode', true);
    const wrapper = mount(OkfStudioDashboard, { global: { plugins: [realStore] } });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // options load asynchronously from the KH tree
    const opts = wrapper.findAll('select option').map((o) => o.text());
    // SUBJECT AREAS follow the Knowledge Hierarchy (David, 2026-09-04):
    // KH categories + legacy repo domains, never a hard-coded list.
    expect(opts).toContain('All subject areas');
    expect(opts).toContain('Water Supply');
    expect(opts).toContain('transport (legacy)');
    wrapper.unmount();
  });
});

describe('OkfStudioDashboard — building poll (the 11-hour ghost fix, 2026-09-05)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function buildStore() {
    return createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
  }

  it('polls the repo list UNCONDITIONALLY while mounted (P0-UX: no gates — cards project the fresh doc each tick)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', {
      repo_id: 'r-b',
      name: 'Building Repo',
      lifecycle_state: 'register',
      conversion: { status: 'splitting', stage: 'splitting' }
    });
    const wrapper = mount(OkfStudioDashboard, { global: { plugins: [store] } });
    await jest.advanceTimersByTimeAsync(0); // mounted() fetchRepos
    const repoOkfService = require('@/services/repoOkfService').default;
    const afterMount = repoOkfService.list.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(5000); // tick 1
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 1);
    await jest.advanceTimersByTimeAsync(5000); // tick 2
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 2);
    // NO idle state: the poll never gates (David, 2026-09-08) — every
    // tick fetches, so a transition to done/draining arrives on its own.
    store.commit('okf/upsertRepo', {
      repo_id: 'r-b',
      name: 'Building Repo',
      lifecycle_state: 'register',
      conversion: { status: 'done', stage: 'done' }
    });
    await jest.advanceTimersByTimeAsync(10000); // two more ticks
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 4);
    wrapper.unmount();
  });
});
const OkfRepoEditorShell = require('@/components/okf/editor/RepoEditorShell.vue').default;

describe('OkfRepoEditorShell', () => {
  it('defaults to the Editor sub-tab and dispatches on switch', async () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.vm.subTab).toBe('editor');
    wrapper.vm.onSubTab('wizard');
    expect(realStore.getters['okf/editorSubTab']).toBe('wizard');
    wrapper.unmount();
  });

  // BUILDING PREVIEW (David, 2026-09-05): a converting repo shows the live
  // import-progress card INSTEAD of the wizard/editor tabs — no concepts/
  // manifest/links/drafts fetches against a half-built repo — and a failed
  // conversion shows an actionable error instead of an empty editor.
  it('renders the building panel instead of the tabs while the conversion runs', () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
    realStore.commit('okf/upsertRepo', {
      repo_id: 'r-1',
      name: 'Repo One',
      lifecycle_state: 'register',
      conversion: { status: 'adding', stage: 'adding', pages_done: 5 }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.findComponent({ name: 'BuildProgressCard' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'DsTabs' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders an actionable failure panel when the conversion failed', () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
    realStore.commit('okf/upsertRepo', {
      repo_id: 'r-1',
      name: 'Repo One',
      lifecycle_state: 'register',
      conversion: { status: 'failed', stage: 'adding', error: 'source vanished mid-read' }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.find('.okf-shell__building-failed').exists()).toBe(true);
    expect(wrapper.text()).toContain('source vanished mid-read');
    expect(wrapper.findComponent({ name: 'DsTabs' }).exists()).toBe(false);
    wrapper.unmount();
  });
});

// ── CROSS-REPO STALE-STATE GUARD (David, 2026-09-06) ────────────────────────
// Opening repo B while a concept from repo A is still selected used to fire
// GET /repos/<A>/concepts/<B-concept> (404): the child editor mounts and
// fetches BEFORE the parent's openEditor reset runs. The guard renders the
// editor ONLY for a concept in the CURRENT repo's list — cross-pairing is
// impossible by construction.
const mockListForRepo = require('@/services/conceptService').default.listForRepo;
const mockConceptGetSvc = require('@/services/conceptService').default.get;
const OkfRepoEditorFull = require('@/components/okf/editor/RepoEditor.vue').default;

describe('OkfRepoEditor — cross-repo stale-selection guard', () => {
  function buildStore() {
    return createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
  }

  function mountEditorFor(repoId) {
    return mount(OkfRepoEditorFull, {
      global: {
        plugins: [buildStore()],
        stubs: {
          OkfConceptList: true,
          OkfRepoGraphView: true,
          OkfAddConceptModal: true,
          OkfResplitModal: true,
          OkfAutocorrectPanel: true,
          DsDialog: true,
          DsButton: true,
          DsFormGroup: true,
          DsInput: true,
          DsSelect: true
        }
      },
      props: { repoId }
    });
  }

  it('never mounts the concept editor with another repo’s selection', async () => {
    mockListForRepo.mockResolvedValue([{ concept_id: 'c-b', title: 'B1', is_index: true }]);
    mockConceptGetSvc.mockResolvedValue({ ok: true, concept: { concept_id: 'c-b', body: '# B1' } });
    const store = buildStore();
    // selection left over from repo A sits in the store BEFORE the switch
    store.commit('okf/setSelectedConcept', 'c-a');
    const wrapper = mount(OkfRepoEditorFull, {
      global: {
        plugins: [store],
        stubs: {
          OkfConceptList: true,
          OkfRepoGraphView: true,
          OkfAddConceptModal: true,
          OkfResplitModal: true,
          OkfAutocorrectPanel: true,
          DsDialog: true,
          DsButton: true,
          DsFormGroup: true,
          DsInput: true,
          DsSelect: true
        }
      },
      props: { repoId: 'r-b' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    // auto-open picked THIS repo's first concept — never the stale one
    const editor = wrapper.findComponent({ name: 'OkfConceptEditor' });
    expect(editor.exists()).toBe(true);
    expect(editor.props('conceptId')).toBe('c-b');
    expect(mockConceptGetSvc).not.toHaveBeenCalledWith('r-b', 'c-a');
    wrapper.unmount();
  });

  it('renders the placeholder while the selection is not in this repo’s list', async () => {
    mockListForRepo.mockResolvedValue([]); // fresh repo — nothing to select yet
    const wrapper = mountEditorFor('r-b');
    wrapper.vm.$store.commit('okf/setSelectedConcept', 'c-a');
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'OkfConceptEditor' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('Select a concept');
    wrapper.unmount();
  });
});
