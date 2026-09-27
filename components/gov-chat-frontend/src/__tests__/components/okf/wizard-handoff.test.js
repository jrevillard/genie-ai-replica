'use strict';

/**
 * Amendment A hand-off decisions (David, 2026-09-27): the lifecycle ritual —
 * submit → approve → publish — lives ENTIRELY outside the wizard; the Labels
 * step is automated + preview (never free text); finishing the wizard lands
 * in the repo's Editor shell with the Editor sub-tab active.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

const mockListConcepts = jest.fn().mockResolvedValue([]);
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    listConcepts: (...a) => mockListConcepts(...a),
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([])
  }
}));

const OkfStepReview = require('@/components/okf/steps/Review.vue').default;
const OkfStepLabel = require('@/components/okf/steps/LabelOnboard.vue').default;
const OkfStudioTab = require('@/components/okf/StudioTab.vue').default;

beforeEach(() => {
  jest.clearAllMocks();
});

function mountStep(cmp, draft) {
  return mount(cmp, {
    props: { draft: draft || { repo_id: 'r1' }, expert: false },
    global: {
      stubs: { DsInfoTip: true, DsSpinner: true, DsTag: true },
      plugins: [
        new Vuex.Store({
          modules: { okf: { namespaced: true, getters: { repoById: () => () => null } } }
        })
      ]
    }
  });
}

it('review: no lifecycle transitions — the ritual is named as living outside the wizard', () => {
  const w = mountStep(OkfStepReview);
  expect(w.emitted('gate')[0][0]).toBe(true);
  // the submit/approve/publish action block is gone; only tool + dialog
  // buttons remain (versions/logs/rename)
  expect(w.find('.okf-step__action').exists()).toBe(false);
  expect(w.text()).toContain('Editor');
});

it('labels: automated + preview — no free-text adder, live labeled count', async () => {
  mockListConcepts.mockResolvedValue([
    { concept_id: 'c1', title: 'Water Points', labels: ['Water Supply'] },
    { concept_id: 'c2', title: 'Clinics', labels: [] }
  ]);
  const w = mountStep(OkfStepLabel);
  await w.vm.$nextTick();
  await w.vm.$nextTick();
  expect(mockListConcepts).toHaveBeenCalledWith('r1', { strict: true });
  expect(w.text()).toContain('1 of 2'); // labeled / total preview line
  expect(w.find('.okf-step__add').exists()).toBe(false); // the free-text adder is gone
  expect(w.emitted('gate')[0][0]).toBe(true);
});

it('labels: a repo without an id skips the preview without failing', () => {
  const w = mountStep(OkfStepLabel, {});
  expect(mockListConcepts).not.toHaveBeenCalled();
  expect(w.emitted('gate')[0][0]).toBe(true);
});

function tabCtx() {
  return {
    activeDraft: { repo_id: 'r1', name: 'R' },
    activeRepoId: null,
    activeSourceFileId: null,
    view: 'wizard',
    onBackToDashboard: jest.fn(),
    $store: {
      commit: jest.fn(),
      dispatch: jest.fn(),
      getters: {
        'okf/activeDraft': () => ({ repo_id: 'r1', source_file_id: 'f9' }),
        'okf/repoById': () => ({})
      }
    }
  };
}

it('wizard finish: lands in the repo shell with the EDITOR sub-tab active', () => {
  const ctx = tabCtx();
  OkfStudioTab.methods.onWizardFinish.call(ctx, { repo_id: 'r1' });
  expect(ctx.$store.dispatch).toHaveBeenCalledWith('okf/setEditorSubTab', 'editor');
  expect(ctx.view).toBe('repo');
  expect(ctx.activeRepoId).toBe('r1');
  expect(ctx.activeSourceFileId).toBe('f9');
});

it('wizard finish: with no repo it falls back to the dashboard', () => {
  const ctx = tabCtx();
  ctx.activeDraft = null;
  OkfStudioTab.methods.onWizardFinish.call(ctx, {});
  expect(ctx.onBackToDashboard).toHaveBeenCalled();
  expect(ctx.view).toBe('wizard'); // untouched by the fallback
});
