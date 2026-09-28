'use strict';

/**
 * 3.10 T2 — the UNIVERSAL WORKBENCH Input step (D5+D6):
 *   every variant lands on the same surface — the concept TREE (the
 *   editor's real ConceptList; click re-opens a saved concept in the
 *   ConceptEditor dialog; delete works) + ALL feeders always (source
 *   picker, markdown import, hand-written concepts). Production is
 *   DATA-driven: picked sources ride document_ids + document_names to
 *   Produce regardless of variant. The gate opens on content from any
 *   feeder (sources OR concepts); clone stays free.
 * Store-shape rule (masked-shape lesson): mapGetters needs a REAL Vuex
 * store — $store mocks break _modulesNamespaceMap and crash the worker.
 */

const mockImportConcepts = jest.fn();
const mockListConcepts = jest.fn();
const mockDeleteConcept = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    importConcepts: (...a) => mockImportConcepts(...a),
    listConcepts: (...a) => mockListConcepts(...a),
    deleteConcept: (...a) => mockDeleteConcept(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepInput = require('@/components/okf/steps/Input.vue').default;
const OkfSourceDialog = require('@/components/okf/wizard/OkfSourceDialog.vue').default;
const OkfAddConceptModal = require('@/components/okf/editor/AddConceptModal.vue').default;
const OkfConceptList = require('@/components/okf/editor/ConceptList.vue').default;
const OkfConceptEditor = require('@/components/okf/editor/ConceptEditor.vue').default;

const CONCEPTS = [
  { concept_id: 'index', title: 'Index', type: 'index' },
  { concept_id: 'water-points', title: 'Water Points', type: 'topic' },
  { concept_id: 'water-points-2', title: 'Water Points 2', type: 'topic' }
];

function mountInput(draft) {
  return mount(OkfStepInput, {
    props: { draft: draft || { repo_id: 'r1' }, expert: false },
    global: {
      stubs: { DsInfoTip: true, OkfConceptEditor: true },
      plugins: [
        new Vuex.Store({
          modules: {
            okf: {
              namespaced: true,
              getters: {
                repoById: () => (id) => (id === 'r1' ? { repo_id: 'r1', name: 'R1' } : null)
              },
              actions: { fetchRepos: () => ({}) }
            }
          }
        })
      ]
    }
  });
}

async function settled(wrapper) {
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockImportConcepts.mockResolvedValue({ ok: true });
  mockDeleteConcept.mockResolvedValue({ ok: true });
  mockListConcepts.mockResolvedValue(CONCEPTS.map((c) => ({ ...c })));
});

it('documents: picker opens with search+upload; confirming writes back ids AND names (T3 accounting)', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  expect(wrapper.emitted('gate')[0][0]).toBe(false);
  const dialog = wrapper.findComponent(OkfSourceDialog);
  expect(dialog.exists()).toBe(true);
  expect(dialog.props('defaultSource')).toBe('all');
  expect(dialog.props('allowUpload')).toBe(true);
  await dialog.vm.$emit('confirm', {
    ids: ['f1', 'f2'],
    rows: [
      { file_id: 'f1', file_name: 'a.pdf' },
      { file_id: 'f2', file_name: 'b.md' }
    ]
  });
  await wrapper.vm.$nextTick();
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.document_ids).toEqual(['f1', 'f2']);
  expect(last.document_names).toEqual([
    { file_id: 'f1', file_name: 'a.pdf' },
    { file_id: 'f2', file_name: 'b.md' }
  ]);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('crawl: the picker opens PRE-SCOPED to crawls and stays multi (D1+D3)', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'crawl', input: { document_ids: [] } });
  const dialog = wrapper.findComponent(OkfSourceDialog);
  expect(dialog.props('defaultSource')).toBe('crawl');
  // multi-crawl: selecting twice JOINS — the dialog owns that (covered in
  // source-dialog.test.js); here: allowUpload stays TRUE (D6 — any feeder
  // from any variant).
  expect(dialog.props('allowUpload')).toBe(true);
});

it('workbench: the concept TREE renders from live data; gate reflects it', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  await settled(wrapper);
  const list = wrapper.findComponent(OkfConceptList);
  expect(list.exists()).toBe(true);
  expect(list.props('concepts').length).toBe(3);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true); // concepts satisfy the gate
});

it('workbench: clicking a concept opens the EDITOR dialog; saving closes + refreshes (D5)', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  const callsBefore = mockListConcepts.mock.calls.length;
  await wrapper.vm.onConceptSelect('water-points');
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.editOpen).toBe(true);
  const editor = wrapper.findComponent(OkfConceptEditor);
  expect(editor.exists()).toBe(true);
  expect(editor.props('conceptId')).toBe('water-points');

  await wrapper.vm.onConceptSaved();
  await settled(wrapper);
  expect(wrapper.vm.editOpen).toBe(false);
  expect(mockListConcepts.mock.calls.length).toBeGreaterThan(callsBefore); // refreshed from server truth
});

it('workbench: delete removes via the service and refreshes the tree', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  await wrapper.vm.onConceptDelete({ concept_id: 'water-points-2' });
  expect(mockDeleteConcept).toHaveBeenCalledWith('r1', 'water-points-2');
  await settled(wrapper);
  expect(wrapper.vm.concepts.length).toBe(3); // re-fetched (mock returns the same 3)
});

it('gate: sources OR concepts open it; an empty repo stays shut', async () => {
  mockListConcepts.mockResolvedValue([]);
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  await settled(wrapper);
  expect(wrapper.emitted('gate').pop()[0]).toBe(false);
  await wrapper.vm.onSourcesConfirmed({ ids: ['f1'], rows: [{ file_id: 'f1', file_name: 'a.pdf' }] });
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('clone: gate open at once; the source-picker button is absent (content already landed)', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'clone' });
  expect(wrapper.emitted('gate')[0][0]).toBe(true);
  const buttons = wrapper.findAll('button').map((b) => b.text());
  expect(buttons.join(' ')).not.toContain('Choose');
});

it('manual: the editor auto-opens on FIRST arrival; editor_offered rides the draft', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual', input: {} });
  await wrapper.vm.$nextTick();
  expect(wrapper.findComponent(OkfAddConceptModal).props('visible')).toBe(true);
  const updates = wrapper.emitted('update');
  const last = updates[updates.length - 1][0].input;
  expect(last.editor_offered).toBe(true);
});

it('manual: a declined editor never re-pops (editor_offered respected)', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual', input: { editor_offered: true } });
  await settled(wrapper);
  expect(wrapper.findComponent(OkfAddConceptModal).props('visible')).toBe(false);
});

it('FS import: the patch SPREADS draft.input (conversion_kicked survives) and the tree refreshes', async () => {
  const wrapper = mountInput({
    repo_id: 'r1',
    source: 'manual',
    input: { conversion_kicked: true }
  });
  await settled(wrapper);
  const fake = { name: 'Water Points.md', text: async () => '# Water Points' };
  await wrapper.vm.onFsFiles({ target: { files: [fake] } });
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.conversion_kicked).toBe(true); // not clobbered
  // F13: 'Water Points' AND 'Water Points 2' already exist in the mock tree
  // → the slug builder walks to water-points-3. The import payload's path is
  // the bare concept_id (this lineage's /import convention — the caller
  // overrides buildConceptPayload's .md-suffixed path).
  expect(mockImportConcepts).toHaveBeenCalledWith('r1', [
    expect.objectContaining({ path: 'water-points-3', frontmatter: expect.objectContaining({ title: 'Water Points' }) })
  ]);
  expect(mockListConcepts).toHaveBeenCalledWith('r1');
});

it('documents: beforeAdvance refuses when the draft has no repo to land in', async () => {
  const wrapper = mountInput({ source: 'documents', input: { document_ids: ['f1'] } });
  await settled(wrapper);
  await expect(wrapper.vm.beforeAdvance()).resolves.toBe(false);
  expect(wrapper.vm.inputError).toBeTruthy();
});
