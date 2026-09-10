'use strict';

/**
 * Labels write-through (David, 2026-09-05): the wizard Curate step writes
 * accepted labels IMMEDIATELY (conceptService.update → { frontmatter } PATCH)
 * and NEVER swallows a failure — a REPO_READ_ONLY 409 on a serving repo must
 * surface "retract to edit" and roll the local chips back, not vanish.
 */

const mockListForRepo = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: (...a) => mockListForRepo(...a),
    get: jest.fn(),
    update: (...a) => mockUpdate(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const OkfStepCurate = require('@/components/okf/steps/Curate.vue').default;

function mountCurate() {
  return mount(OkfStepCurate, {
    props: { draft: { repo_id: 'r-1', name: 'Repo' }, expert: false },
    global: {
      mocks: {
        $store: { getters: { 'okf/isExpert': false } }
      },
      stubs: {
        DsInput: true,
        DsButton: true,
        DsPill: true,
        DsOkfMarkdownEditor: true,
        OkfLabelEditor: true
      }
    }
  });
}

const ROWS = [{ concept_id: 'c-1', title: 'C1', labels: ['Old'], body: '# C1', sources: [] }];

describe('OkfStepCurate — labels write-through', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes accepted labels immediately through conceptService.update', async () => {
    mockListForRepo.mockResolvedValue(ROWS.map((r) => ({ ...r, labels: r.labels.slice() })));
    mockUpdate.mockResolvedValue({ ok: true });
    const wrapper = mountCurate();
    await wrapper.vm.$nextTick();
    wrapper.vm.selected = 'c-1';
    await wrapper.vm.$nextTick();
    await wrapper.vm.onLabelsSave(['New']);
    expect(mockUpdate).toHaveBeenCalledWith('r-1', 'c-1', { labels: ['New'] });
    expect(wrapper.vm.labelError).toBe('');
    expect(wrapper.vm.selectedConcept.labels).toEqual(['New']);
  });

  it('surfaces REPO_READ_ONLY ("retract to edit") and rolls the chips back', async () => {
    mockListForRepo.mockResolvedValue(ROWS.map((r) => ({ ...r, labels: r.labels.slice() })));
    mockUpdate.mockRejectedValue({ status: 409, data: { error: 'REPO_READ_ONLY' } });
    const wrapper = mountCurate();
    await wrapper.vm.$nextTick();
    wrapper.vm.selected = 'c-1';
    await wrapper.vm.$nextTick();
    await wrapper.vm.onLabelsSave(['New']);
    expect(wrapper.vm.labelError).toContain('READ ONLY');
    expect(wrapper.vm.labelError).toContain('retract');
    // the local mirror shows only what the server actually accepted
    expect(wrapper.vm.selectedConcept.labels).toEqual(['Old']);
  });

  it('surfaces a generic failure with a fallback message (never a silent catch)', async () => {
    mockListForRepo.mockResolvedValue(ROWS.map((r) => ({ ...r, labels: r.labels.slice() })));
    mockUpdate.mockRejectedValue(new Error('network down'));
    const wrapper = mountCurate();
    await wrapper.vm.$nextTick();
    wrapper.vm.selected = 'c-1';
    await wrapper.vm.$nextTick();
    await wrapper.vm.onLabelsSave(['New']);
    expect(wrapper.vm.labelError).toContain('network down');
    expect(wrapper.vm.selectedConcept.labels).toEqual(['Old']);
  });
});
