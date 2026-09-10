'use strict';

/**
 * FRONTMATTER BAR (David, 2026-09-06): display is the PRIMARY job — the
 * collapsed bar shows the parsed frontmatter at a glance; the per-field
 * edit form is secondary behind Expand. Saves go through the {frontmatter}
 * PATCH mode (server-side merge, no snapshot round-trip), the 400
 * VALIDATION_ERROR details array maps inline, and the source pane
 * recomposes via matter.stringify so form and source never diverge.
 * The ⓘ tip carries the UX-proposal §A copy verbatim.
 */

const mockConceptUpdate = jest.fn();

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    update: (...a) => mockConceptUpdate(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const OkfConceptEditor = require('@/components/okf/editor/ConceptEditor.vue').default;

function fakeStore() {
  return {
    getters: { 'okf/editorSubTab': 'editor' },
    commit() {},
    dispatch(type) {
      if (type === 'okf/getConcept') {
        return Promise.resolve({
          ok: true,
          concept: {
            concept_id: 'c-1',
            frontmatter: { type: 'topic', title: 'C1', labels: ['Health Services'] },
            body: '# C1 body'
          }
        });
      }
      return Promise.resolve({ ok: true });
    }
  };
}

function mountEditor() {
  return mount(OkfConceptEditor, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: { DsOkfMarkdownEditor: true }
    },
    props: { repoId: 'r-1', conceptId: 'c-1', labelOptions: [{ value: 'Water Supply', label: 'Water Supply' }] }
  });
}

async function loaded() {
  const wrapper = mountEditor();
  await new Promise((r) => setTimeout(r, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(() => jest.clearAllMocks());

it('shows the parsed frontmatter at a glance when collapsed (the PRIMARY job)', async () => {
  const wrapper = await loaded();
  const rows = wrapper.findAll('.okf-ce__fm-row').map((r) => r.text());
  expect(wrapper.find('.okf-ce__fm-form').exists()).toBe(false); // edit is secondary
  expect(rows.some((t) => t.includes('type'))).toBe(true);
  expect(rows.some((t) => t.includes('topic'))).toBe(true);
  expect(rows.some((t) => t.includes('Health Services'))).toBe(true);
});

it('expands to a per-field form and saves via the {frontmatter} PATCH', async () => {
  const wrapper = await loaded();
  wrapper.vm.openFm();
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.okf-ce__fm-form').exists()).toBe(true);
  expect(wrapper.vm.fmDraft.type).toBe('topic');
  expect(wrapper.vm.fmDraft.labels).toBe('Health Services');
  wrapper.vm.fmDraft.labels = 'Water Supply';
  mockConceptUpdate.mockResolvedValue({ ok: true });
  await wrapper.vm.saveFm();
  expect(mockConceptUpdate).toHaveBeenCalledWith('r-1', 'c-1', {
    type: 'topic',
    title: 'C1',
    labels: ['Water Supply']
  });
  // the source pane recomposed — form and source never diverge
  expect(wrapper.vm.markdown).toContain('Water Supply');
  expect(wrapper.vm.savedMarkdown).toBe(wrapper.vm.markdown); // no dirty body
  expect(wrapper.vm.fmSaved).toBe(true);
});

it('maps the 400 VALIDATION_ERROR details array inline', async () => {
  const wrapper = await loaded();
  wrapper.vm.openFm();
  mockConceptUpdate.mockRejectedValue({
    status: 400,
    data: { error: 'VALIDATION_ERROR', details: ['"type" must be one of [topic, entity, …]'] }
  });
  await wrapper.vm.saveFm();
  expect(wrapper.vm.fmError).toContain('"type" must be one of');
  expect(wrapper.vm.fmSaved).toBe(false);
});

it('carries the ⓘ tip with the proposal §A copy', async () => {
  const wrapper = await loaded();
  const tip = wrapper.findComponent({ name: 'DsInfoTip' });
  expect(tip.exists()).toBe(true);
  expect(tip.props('text')).toContain('structured information at the top of each file');
});
