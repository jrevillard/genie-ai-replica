'use strict';

/**
 * Amendment A slice 4 (B1) — the real Input step panels:
 *   documents/crawl → doc-repo picker (bundles excluded), selection drives
 *                     the gate and writes back to the draft;
 *   manual          → FS markdown import via the standard /import route
 *                     (idempotent upsert) + in-wizard authoring modal;
 *   clone           → the fork already landed the content, so the gate is
 *                     open at once (David, 2026-09-27: a closed Continue on
 *                     the clone side-visit read as a trap).
 */

const mockGetFiles = jest.fn();
const mockImportConcepts = jest.fn();

jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFiles: (...a) => mockGetFiles(...a) }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { importConcepts: (...a) => mockImportConcepts(...a) }
}));

const { mount } = require('@vue/test-utils');
const OkfStepInput = require('@/components/okf/steps/Input.vue').default;

function mountInput(draft) {
  return mount(OkfStepInput, {
    props: { draft: draft || { repo_id: 'r1' }, expert: false },
    global: { stubs: { DsInfoTip: true, DsSpinner: true, OkfAddConceptModal: true } }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFiles.mockResolvedValue([
    { file_id: 'f1', file_name: 'a.pdf', file_size: 2048 },
    { file_id: 'f2', file_name: 'b.zip', is_bundle: true }
  ]);
  mockImportConcepts.mockResolvedValue({ ok: true });
});

it('documents: bundles are never sources; picking a file writes back and opens the gate', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'documents' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick(); // getFiles resolves → rows render
  expect(mockGetFiles).toHaveBeenCalled();
  const rows = wrapper.findAll('.okf-step__row');
  expect(rows.length).toBe(1); // the is_bundle zip is filtered out
  // initial gate: closed until a selection exists
  expect(wrapper.emitted('gate').pop()[0]).toBe(false);
  await rows[0].trigger('click');
  const updates = wrapper.emitted('update');
  expect(updates.length).toBe(1);
  expect(updates[0][0].input.document_ids).toEqual(['f1']);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('clone: the gate is open at once and the panel says the content is already in place', () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'clone' });
  expect(wrapper.emitted('gate')[0][0]).toBe(true);
  expect(wrapper.text()).toContain('clone');
  expect(wrapper.find('.okf-step__row').exists()).toBe(false);
});

it('manual: importing FS markdown lands via the /import route and opens the gate', async () => {
  const wrapper = mountInput({ repo_id: 'r1', source: 'manual' });
  expect(wrapper.emitted('gate')[0][0]).toBe(false);
  const fake = { name: 'Water Points.md', text: async () => '# Water Points' };
  await wrapper.vm.onFsFiles({ target: { files: [fake] } });
  expect(mockImportConcepts).toHaveBeenCalledWith('r1', [
    { path: 'Water Points', frontmatter: { type: 'topic', title: 'Water Points' }, body: '# Water Points' }
  ]);
  expect(wrapper.emitted('update').pop()[0].input.concepts_added).toBe(1);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('documents: beforeAdvance refuses when the draft has no repo to land in', async () => {
  const wrapper = mountInput({ source: 'documents', input: { document_ids: ['f1'] } });
  await expect(wrapper.vm.beforeAdvance()).resolves.toBe(false);
  expect(wrapper.vm.inputError).toBeTruthy();
});
