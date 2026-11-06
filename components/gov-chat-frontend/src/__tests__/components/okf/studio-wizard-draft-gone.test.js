'use strict';

/**
 * #1056 — the REPO-SCOPED degraded-draft notice (wizard level).
 *
 * A repository that answers 404 REPO_NOT_FOUND on a draft save is GONE
 * (deleted / soft-deleted / outside the caller's scope). That is one repo's
 * outcome, not the session's: it must NOT arm the session-wide latch (which
 * would push every other repo's saves to local-only behind a version-
 * mismatch notice), and it must be surfaced where the curator is — in the
 * wizard, on the repo they are editing.
 *
 * The wizard therefore inspects the save outcome and, once the repo is gone,
 * stops the doomed PUTs (the draft stays in the browser).
 */

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn().mockResolvedValue({}), getDraft: jest.fn().mockResolvedValue(null) }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn().mockResolvedValue([]), saveStudioStep: jest.fn().mockResolvedValue(true) }
}));

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const okfModule = require('@/store/modules/okf').default;
const studioService = require('@/services/studioService').default;
const StudioWizard = require('@/components/okf/StudioWizard.vue').default;
const en = require('@/i18n/locales/en.js').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
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
      mocks: { $i18n: { t: (k) => k, locale: 'en', messages: { en } } },
      stubs: STUBS
    }
  });
}

const DRAFT = { repo_id: 'r1', name: 'Demo', domain: 'Water Supply', studio_step: 0 };

/** Let the store action's promise chain settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The typed shape studioService's classifier throws for a gone repo. */
function repoGone() {
  return Object.assign(new Error('REPO_NOT_FOUND'), { code: 'REPO_NOT_FOUND', status: 404 });
}

beforeEach(() => {
  jest.clearAllMocks();
  studioService.saveDraft.mockReset();
  studioService.saveDraft.mockResolvedValue({});
});

describe('#1056 — the repo-scoped degraded-draft notice', () => {
  it('a healthy save renders NO notice', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'Renamed' });
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test-id="wizard-draft-gone"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('a gone repo names itself in the wizard and does NOT arm the session latch', async () => {
    studioService.saveDraft.mockRejectedValue(repoGone());
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'Renamed' });
    await flush();
    await wrapper.vm.$nextTick();
    const notice = wrapper.find('[data-test-id="wizard-draft-gone"]');
    expect(notice.exists()).toBe(true);
    // the shipped copy, not the inline fallback
    expect(notice.text()).toBe(en.okf.studio.draft.repoGone);
    // ONE repo is gone — the session latch must stay off, or every other
    // repo's saves would fall back to local-only behind this notice.
    expect(store.getters['okf/draftsUnavailable']).toBe(false);
    wrapper.unmount();
  });

  it('once the repo is gone the wizard stops the doomed PUTs and keeps the draft local', async () => {
    studioService.saveDraft.mockRejectedValue(repoGone());
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'Renamed' });
    await flush();
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1);
    // the next change does NOT reach the server again ...
    wrapper.vm.onDraftUpdate({ name: 'Renamed again' });
    await flush();
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1);
    // ... but the draft still lives in the browser (the curator keeps working)
    expect(store.state.okf.drafts.r1.name).toBe('Renamed again');
    wrapper.unmount();
  });

  it('the notice is repo-scoped: switching repos clears it', async () => {
    studioService.saveDraft.mockRejectedValue(repoGone());
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const wrapper = mountWizard({ ...DRAFT }, store);
    await wrapper.vm.$nextTick();
    wrapper.vm.onDraftUpdate({ name: 'Renamed' });
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test-id="wizard-draft-gone"]').exists()).toBe(true);
    // the wizard instance outlives a repo switch — the verdict must not
    await wrapper.setProps({ draft: { ...DRAFT, repo_id: 'r2', name: 'Other' } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test-id="wizard-draft-gone"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
