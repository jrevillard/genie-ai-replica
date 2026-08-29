'use strict';

/**
 * Story #978 - Studio editor component tests (ConceptList / ConceptEditor /
 * ResplitModal / RepoEditorShell default sub-tab).
 */

const { mount } = require('@vue/test-utils');

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
    const opts = wrapper.findAll('select option');
    expect(opts.length).toBeGreaterThanOrEqual(8);
    expect(wrapper.text()).toContain('All subject areas');
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
  });
});
