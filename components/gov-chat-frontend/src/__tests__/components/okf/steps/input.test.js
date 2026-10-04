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
const mockBulkPiiAction = jest.fn();
const mockGetAdminCategories = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    importConcepts: (...a) => mockImportConcepts(...a),
    listConcepts: (...a) => mockListConcepts(...a),
    deleteConcept: (...a) => mockDeleteConcept(...a),
    bulkPiiAction: (...a) => mockBulkPiiAction(...a)
  }
}));

jest.mock('@/services/serviceTreeService', () => ({
  __esModule: true,
  default: { getAdminCategories: (...a) => mockGetAdminCategories(...a) }
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

function mountInput(draft, repoDoc) {
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
                repoById: () => (id) => (id === 'r1' ? repoDoc || { repo_id: 'r1', name: 'R1' } : null)
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
  mockGetAdminCategories.mockResolvedValue([]);
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
      { file_id: 'f1', file_name: 'a.pdf', source: 'upload' },
      { file_id: 'f2', file_name: 'b.md', source: 'crawl' }
    ]
  });
  await wrapper.vm.$nextTick();
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.document_ids).toEqual(['f1', 'f2']);
  // A2: each row carries its T1 origin stamp so Produce routes per origin.
  expect(last.document_names).toEqual([
    { file_id: 'f1', file_name: 'a.pdf', source: 'upload' },
    { file_id: 'f2', file_name: 'b.md', source: 'crawl' }
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

it('workbench: delete CONFIRMS via the dialog, then removes via the service (A7-4)', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  // First click only ASKS — nothing is deleted until the dialog confirms.
  await wrapper.vm.onDeleteAsk({ concept_id: 'water-points-2' });
  expect(wrapper.vm.deleteAsk).not.toBeNull();
  expect(mockDeleteConcept).not.toHaveBeenCalled();
  await wrapper.vm.onDeleteAction('confirm');
  expect(mockDeleteConcept).toHaveBeenCalledWith('r1', 'water-points-2');
  expect(wrapper.vm.deleteAsk).toBeNull();
  await settled(wrapper);
  expect(wrapper.vm.concepts.length).toBe(3); // re-fetched (mock returns the same 3)
});

it('A7-1: hasIndex reaches AddConceptModal — no second index, append offered', async () => {
  mockListConcepts.mockResolvedValue([
    { concept_id: 'index', title: 'Index', type: 'index', is_index: true },
    { concept_id: 'a', title: 'A', type: 'topic' }
  ]);
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  expect(wrapper.vm.hasIndex).toBe(true);
  expect(wrapper.findComponent(OkfAddConceptModal).props('hasIndex')).toBe(true);
});

it('A7-3: a SERVING repo is readOnly — feeders disabled, editor dialog threads it', async () => {
  const wrapper = mountInput(
    { repo_id: 'r1', source: 'manual' },
    { repo_id: 'r1', name: 'R1', ingested_at: '2026-09-29T00:00:00Z' }
  );
  await settled(wrapper);
  expect(wrapper.vm.readOnly).toBe(true);
  const buttons = wrapper.findAll('button').map((b) => b.element.disabled);
  // every feeder button (picker, FS import, write-a-concept) is disabled
  expect(buttons.filter((d) => d === true).length).toBeGreaterThanOrEqual(3);
  await wrapper.vm.onConceptSelect('water-points');
  await wrapper.vm.$nextTick();
  const editor = wrapper.findComponent(OkfConceptEditor);
  expect(editor.props('readOnly')).toBe(true);
  // delete asks are refused outright in readOnly
  await wrapper.vm.onDeleteAsk({ concept_id: 'water-points' });
  expect(wrapper.vm.deleteAsk).toBeNull();
});

it('A7-5: KH label options reach the tree and the edit dialog (no dead-end affordance)', async () => {
  const okfRepoOps = require('@/services/okfRepoOps');
  const spy = jest.spyOn(okfRepoOps, 'labelOptionsForDomain');
  spy.mockReturnValue({ options: [{ value: 'l1', label: 'Water services' }], bounded: true });
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  expect(spy).toHaveBeenCalled();
  expect(wrapper.findComponent(OkfConceptList).props('labelOptions')).toEqual([
    { value: 'l1', label: 'Water services' }
  ]);
  await wrapper.vm.onConceptSelect('water-points');
  await wrapper.vm.$nextTick();
  expect(wrapper.findComponent(OkfConceptEditor).props('labelOptions')).toEqual([
    { value: 'l1', label: 'Water services' }
  ]);
  spy.mockRestore();
});

it('B2: names rows SURVIVE a Back→Continue remount (restored from the draft, load-bearing for dispatch)', async () => {
  const names = [{ file_id: 'f1', file_name: 'a.pdf', source: 'crawl' }];
  const wrapper = mountInput({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['f1'], document_names: names }
  });
  expect(wrapper.vm.selectedNames).toEqual(names); // restored like the ids
  await wrapper.vm.beforeAdvance();
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.document_names).toEqual(names); // writeBack did not destroy them
});

it('B3: changing the selection DROPS any queued conversion legs (no deselected file ever kicks)', async () => {
  const wrapper = mountInput({
    repo_id: 'r1',
    source: 'crawl',
    input: {
      document_ids: ['c1'],
      document_names: [{ file_id: 'c1', file_name: 'a.md', source: 'crawl' }],
      convert_queue: [{ k: 'c', id: 'c1' }]
    }
  });
  await wrapper.vm.onSourcesConfirmed({ ids: ['f2'], rows: [{ file_id: 'f2', file_name: 'b.pdf' }] });
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.document_ids).toEqual(['f2']);
  expect(last.convert_queue).toEqual([]); // stale legs dropped with the selection
});

it('B6: the tree inline set-label WRITES via applyLabel and refreshes (no dead-end affordance)', async () => {
  const okfRepoOps = require('@/services/okfRepoOps');
  const spy = jest.spyOn(okfRepoOps, 'applyLabel').mockResolvedValue({});
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await settled(wrapper);
  const list = wrapper.findComponent(OkfConceptList);
  await list.vm.$emit('label', { conceptId: 'water-points', label: 'l1' });
  await settled(wrapper);
  expect(spy).toHaveBeenCalledWith('r1', 'water-points', ['l1']);
  spy.mockRestore();
});

it('gate: sources OR concepts open it; an empty repo stays shut', async () => {
  mockListConcepts.mockResolvedValue([]);
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  await settled(wrapper);
  expect(wrapper.emitted('gate').pop()[0]).toBe(false);
  await wrapper.vm.onSourcesConfirmed({ ids: ['f1'], rows: [{ file_id: 'f1', file_name: 'a.pdf' }] });
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('clone: gate open at once; the source-picker button is PRESENT (A7-2 — D6: all feeders, always)', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'clone' });
  expect(wrapper.emitted('gate')[0][0]).toBe(true);
  const buttons = wrapper.findAll('button').map((b) => b.text());
  expect(buttons.join(' ')).toContain('Choose');
});

it('manual: the editor auto-opens on FIRST arrival; editor_offered rides the draft', async () => {
  mockListConcepts.mockResolvedValue([]); // blank canvas — resolved EMPTY (verifier A7-minor: the nudge waits for the resolved list, so hasIndex is honest)
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual', input: {} });
  await settled(wrapper);
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

// #1040 — the workbench's bulk PII buttons (Redact all / Remove all /
// Accept all in ConceptList's header) emitted `pii-bulk` with NO listener:
// live on the re-imported NCD bundle, 41 flagged entities, clicking Accept
// all produced zero requests and zero audit rows. The workbench now runs the
// same ask → confirm → bulkPiiAction → refresh contract as RepoEditor.
// NOTE: DsDialog teleports to document.body — DOM assertions read the body,
// component assertions use findComponent (vnode tree), actions call the
// handler the dialog binds (onPiiBulkAction) directly.
describe('Input workbench — bulk PII actions (#1040)', () => {
  const FLAGGED = [
    { concept_id: 'index', title: 'Index', type: 'index', pii_state: 'clean' },
    { concept_id: 'page-a', title: 'Page A', type: 'topic', pii_state: 'hit' },
    { concept_id: 'page-b', title: 'Page B', type: 'topic', pii_state: 'hit' }
  ];

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('flagged rows show the count pill; Accept all opens the confirm dialog', async () => {
    mockListConcepts.mockResolvedValue(FLAGGED.map((c) => ({ ...c })));
    const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
    await settled(wrapper);
    expect(wrapper.text()).toContain('2 flagged');
    const acceptBtn = wrapper.findAll('button').find((b) => b.text() === 'Accept all');
    expect(acceptBtn).toBeTruthy();
    await acceptBtn.trigger('click');
    await settled(wrapper);
    expect(wrapper.vm.piiBulkAsk).toBe('accept');
    expect(document.body.textContent).toContain('Concepts affected: 2.');
    expect(mockBulkPiiAction).not.toHaveBeenCalled(); // confirm-gated
  });

  it('confirming calls the bulk action and the tree comes back clean', async () => {
    mockListConcepts.mockResolvedValueOnce(FLAGGED.map((c) => ({ ...c })));
    // post-action refresh returns clean rows — the pill and buttons vanish
    mockListConcepts.mockResolvedValueOnce(FLAGGED.map((c) => ({ ...c, pii_state: 'clean' })));
    mockBulkPiiAction.mockResolvedValue({ ok: true, action: 'accept', concepts_affected: 2 });
    const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
    await settled(wrapper);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Accept all')
      .trigger('click');
    await settled(wrapper);
    await wrapper.vm.onPiiBulkAction('confirm'); // the dialog's Apply action
    await settled(wrapper);
    await settled(wrapper);
    expect(mockBulkPiiAction).toHaveBeenCalledWith('r1', 'accept');
    expect(wrapper.text()).not.toContain('flagged');
    expect(wrapper.vm.piiBulkAsk).toBeNull();
  });

  it('a failed bulk action surfaces the error and keeps the dialog flow intact', async () => {
    mockListConcepts.mockResolvedValue(FLAGGED.map((c) => ({ ...c })));
    mockBulkPiiAction.mockResolvedValue({ ok: false });
    const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
    await settled(wrapper);
    await wrapper.vm.onPiiBulkAsk('remove');
    await settled(wrapper);
    await wrapper.vm.onPiiBulkAction('confirm');
    await settled(wrapper);
    expect(wrapper.vm.inputError).toBeTruthy();
    expect(mockListConcepts).toHaveBeenCalledTimes(1); // no refresh on failure
  });

  it('cancel closes the dialog without touching the server', async () => {
    mockListConcepts.mockResolvedValue(FLAGGED.map((c) => ({ ...c })));
    const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
    await settled(wrapper);
    await wrapper.vm.onPiiBulkAsk('redact');
    await settled(wrapper);
    await wrapper.vm.onPiiBulkAction('cancel');
    await settled(wrapper);
    expect(wrapper.vm.piiBulkAsk).toBeNull();
    expect(mockBulkPiiAction).not.toHaveBeenCalled();
  });
});
