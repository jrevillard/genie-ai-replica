'use strict';

/**
 * Amendment A slice 4a (B1, David 2026-09-27 redesign) — the real Input step:
 *   documents/crawl → the dual-source OkfSourceDialog (repo + local FS);
 *                     the step itself never lists files (the dialog owns the
 *                     paginated listing; limit ≤ 50 or the backend 400s).
 *   manual          → the editor IS the surface: auto-opens on first arrival
 *                     (editor_offered rides the draft so it never re-pops);
 *                     FS markdown import stays available via /import upsert.
 *   clone           → the fork already landed the content, so the gate is
 *                     open at once.
 * The input patch SPREADS draft.input — a whole-object replace would drop
 * Produce's conversion_kicked on a Back-visit (shallow wizard merge).
 */

const mockImportConcepts = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { importConcepts: (...a) => mockImportConcepts(...a) }
}));

const { mount } = require('@vue/test-utils');
const OkfStepInput = require('@/components/okf/steps/Input.vue').default;
const OkfSourceDialog = require('@/components/okf/wizard/OkfSourceDialog.vue').default;
const OkfAddConceptModal = require('@/components/okf/editor/AddConceptModal.vue').default;

function mountInput(draft) {
  return mount(OkfStepInput, {
    props: { draft: draft || { repo_id: 'r1' }, expert: false },
    global: { stubs: { DsInfoTip: true } }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockImportConcepts.mockResolvedValue({ ok: true });
});

it('documents: the dialog owns the sources; confirming writes back and opens the gate', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  expect(wrapper.emitted('gate')[0][0]).toBe(false);
  const dialog = wrapper.findComponent(OkfSourceDialog);
  expect(dialog.exists()).toBe(true);
  expect(dialog.props('mode')).toBe('multi');
  expect(dialog.props('allowUpload')).toBe(true);
  await dialog.vm.$emit('confirm', { ids: ['f1', 'f2'], rows: [{ file_id: 'f1', file_name: 'a.pdf' }] });
  await wrapper.vm.$nextTick();
  const updates = wrapper.emitted('update');
  expect(updates.length).toBeGreaterThan(0);
  const last = updates[updates.length - 1][0].input;
  expect(last.document_ids).toEqual(['f1', 'f2']);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
  expect(dialog.props('visible')).toBe(false); // dialog closed on confirm
});

it('crawl: the dialog is single-select with no upload section', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'crawl', input: { document_ids: [] } });
  const dialog = wrapper.findComponent(OkfSourceDialog);
  expect(dialog.props('mode')).toBe('single');
  expect(dialog.props('allowUpload')).toBe(false);
});

it('clone: the gate is open at once and no dialog renders', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'clone' });
  expect(wrapper.emitted('gate')[0][0]).toBe(true);
  expect(wrapper.findComponent(OkfSourceDialog).exists()).toBe(false);
});

it('manual: the editor auto-opens on FIRST arrival and editor_offered rides the draft', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  await wrapper.vm.$nextTick(); // addOpen set in mounted → render flush
  expect(wrapper.findComponent(OkfAddConceptModal).props('visible')).toBe(true);
  const updates = wrapper.emitted('update');
  expect(updates.length).toBeGreaterThan(0);
  const last = updates[updates.length - 1][0].input;
  expect(last.editor_offered).toBe(true);
  expect(last.concepts_added).toBe(0);
});

it('manual: a declined editor never re-pops (editor_offered respected)', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual', input: { editor_offered: true } });
  expect(wrapper.findComponent(OkfAddConceptModal).props('visible')).toBe(false);
  expect(wrapper.emitted('update')).toBeUndefined();
});

it('manual: the input patch SPREADS draft.input (conversion_kicked survives)', async () => {
  const wrapper = mountInput({
    repo_id: 'r1',
    source: 'manual',
    input: { conversion_kicked: true }
  });
  const fake = { name: 'Water Points.md', text: async () => '# Water Points' };
  await wrapper.vm.onFsFiles({ target: { files: [fake] } });
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.conversion_kicked).toBe(true); // not clobbered by the replace
  expect(last.concepts_added).toBe(1);
  expect(mockImportConcepts).toHaveBeenCalledWith('r1', [
    { path: 'Water Points', frontmatter: { type: 'topic', title: 'Water Points' }, body: '# Water Points' }
  ]);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('documents: beforeAdvance refuses when the draft has no repo to land in', async () => {
  const wrapper = mountInput({ source: 'documents', input: { document_ids: ['f1'] } });
  await expect(wrapper.vm.beforeAdvance()).resolves.toBe(false);
  expect(wrapper.vm.inputError).toBeTruthy();
});
