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

// Review now embeds the read-only repo editor (final visual review,
// 2026-09-29). The handoff tests assert the step's COPY and hand-off
// wiring — stub the heavy child instead of providing the editor's
// whole getter surface in every store mock here.
jest.mock('@/components/okf/editor/RepoEditor.vue', () => ({
  name: 'OkfRepoEditor',
  props: ['repoId', 'readOnly', 'sourceFileId'],
  template: '<div class="repo-editor-stub" />'
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

// RAIL-FREEZE FIX (David, 2026-09-30): saveDraft REPLACES the store's draft
// object on every step advance; the wizard's draft prop must track the LIVE
// store object, not the reference captured at open time (the frozen
// studio_step locked the rail at steps 7-10 while the footer showed 10/10).
describe('StudioTab.liveDraft', () => {
  const liveDraft = (ctx) => OkfStudioTab.computed.liveDraft.call(ctx);

  it("prefers the store's LIVE draft over the captured reference", () => {
    const live = { repo_id: 'r1', studio_step: 9 };
    const ctx = {
      activeDraft: { repo_id: 'r1', studio_step: 5 },
      $store: { getters: { 'okf/activeDraft': (id) => (id === 'r1' ? live : null) } }
    };
    expect(liveDraft(ctx)).toBe(live);
  });

  it('falls back to the local draft while the store has none (fresh resume)', () => {
    const local = { repo_id: 'r2', studio_step: 9 };
    const ctx = {
      activeDraft: local,
      $store: { getters: { 'okf/activeDraft': () => null } }
    };
    expect(liveDraft(ctx)).toBe(local);
  });

  it('falls back when the draft has no repo yet (pre-Entry create)', () => {
    const local = { repo_id: null, studio_step: 0 };
    const ctx = {
      activeDraft: local,
      $store: { getters: { 'okf/activeDraft': () => ({ repo_id: 'other' }) } }
    };
    expect(liveDraft(ctx)).toBe(local);
  });
});
