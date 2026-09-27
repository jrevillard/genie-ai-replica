'use strict';

/**
 * 3.4 Amendment A slice 1 — the wizard SHELL contract:
 *   A1  step selections write back into the draft (idempotent re-entry)
 *   A2  the ACTIVE step owns the Continue gate (no global bypass)
 *   A3  advance consults the step's async beforeAdvance hook (Entry creates)
 *   A4  the resume pointer persists server-side (okf_repositories.studio_step)
 *   A5  the context rail reads the REAL repo doc, never phantom draft shapes
 */

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn().mockResolvedValue({}), getDraft: jest.fn().mockResolvedValue(null) }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    saveStudioStep: jest.fn().mockResolvedValue(true)
  }
}));

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const okfModule = require('@/store/modules/okf').default;
const repoOkfService = require('@/services/repoOkfService').default;
const StudioWizard = require('@/components/okf/StudioWizard.vue').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
  });
}

const STUBS = {
  DsStepper: true,
  DsButton: {
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ['disabled', 'variant']
  },
  DsStatusTag: true,
  DsTag: true,
  OkfNarrative: true,
  OkfStepEntry: true,
  OkfStepChoose: true,
  OkfStepInput: true,
  OkfStepProduce: true,
  OkfStepLabel: true,
  OkfStepCurate: true,
  OkfStepValidate: true,
  OkfStepAutocorrect: true,
  OkfStepReview: true,
  OkfStepPublish: true
};

function mountWizard(draft, store) {
  return mount(StudioWizard, {
    props: { draft },
    global: {
      plugins: [store],
      mocks: { $i18n: { t: (k) => k, locale: 'en' } },
      stubs: STUBS
    }
  });
}

const DRAFT = { repo_id: 'r1', name: 'Demo', domain: 'Water Supply', studio_step: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Amendment A slice 1 — the wizard shell contract', () => {
  it('A1: onDraftUpdate emits update-draft AND persists the merged draft to the store', async () => {
    const store = buildStore();
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'Renamed' });
    await wrapper.vm.$nextTick();
    // the patch flows UP to the draft's owner (the wizard never mutates a prop)
    const updates = wrapper.emitted('update-draft') || [];
    expect(updates[updates.length - 1]).toEqual([{ name: 'Renamed' }]);
    // the store's in-memory draft got the MERGED draft (saveDraft commits setDraft)
    expect(store.state.okf.drafts.r1.name).toBe('Renamed');
    wrapper.unmount();
  });

  it('A2: the step owns the Continue — onGate(false) disables it, onGate(true) re-enables', async () => {
    const wrapper = mountWizard({ ...DRAFT }, buildStore());
    await wrapper.vm.$nextTick();
    const continueBtn = () =>
      wrapper
        .findAll('button')
        .filter((b) => b.text() === 'Continue')
        .pop();
    expect(continueBtn()).toBeTruthy();
    expect(continueBtn().attributes('disabled')).toBeUndefined();
    wrapper.vm.onGate(false);
    await wrapper.vm.$nextTick();
    expect(continueBtn().attributes('disabled')).toBeDefined();
    wrapper.vm.onGate(true);
    await wrapper.vm.$nextTick();
    expect(continueBtn().attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('A2: onAdvance refuses to move while the gate is closed', async () => {
    const wrapper = mountWizard({ ...DRAFT }, buildStore());
    await wrapper.vm.$nextTick();
    wrapper.vm.onGate(false);
    wrapper.vm.onAdvance();
    await Promise.resolve();
    expect(wrapper.vm.activeStep).toBe(0);
    wrapper.unmount();
  });

  it('A3: onAdvance consults beforeAdvance — a refusal stays, a pass advances', async () => {
    const wrapper = mountWizard({ ...DRAFT }, buildStore());
    await wrapper.vm.$nextTick();
    jest.spyOn(wrapper.vm, 'activeStepVm').mockReturnValue({ beforeAdvance: jest.fn().mockResolvedValue(false) });
    await wrapper.vm.onAdvance();
    expect(wrapper.vm.activeStep).toBe(0);
    wrapper.vm.activeStepVm.mockReturnValue({ beforeAdvance: jest.fn().mockResolvedValue(true) });
    await wrapper.vm.onAdvance();
    expect(wrapper.vm.activeStep).toBe(1);
    wrapper.unmount();
  });

  it('A4: persisting a step saves studio_step server-side (unfrozen repo)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'X' });
    await Promise.resolve();
    expect(repoOkfService.saveStudioStep).toHaveBeenCalledWith('r1', 0);
    wrapper.unmount();
  });

  it('A4/R-C: a SERVING repo never persists the pointer (frozen)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'publish', ingested_at: '2026-09-27T00:00:00Z' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'X' });
    await Promise.resolve();
    expect(repoOkfService.saveStudioStep).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('A5: the context rail reads the REAL repo doc (name/version/concepts/sources)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', {
      repo_id: 'r1',
      name: 'Real Repo',
      domain: 'Water Supply',
      version: 3,
      concept_count: 41,
      source_documents: [{ file_id: 'f1' }, { file_id: 'f2' }],
      lifecycle_state: 'review'
    });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain('Real Repo'); // the repo doc's name, not the draft's
    expect(text).toContain('v3');
    expect(text).toContain('41');
    expect(text).not.toContain('no sources'); // the phantom-shape label is dead
    wrapper.unmount();
  });

  it('A5: an unnamed draft shows the Untitled fallback', async () => {
    const wrapper = mountWizard({ domain: 'Water Supply', studio_step: 0 }, buildStore());
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Untitled repository');
    wrapper.unmount();
  });
});
