'use strict';

/**
 * STORY 10.5 — the wizard RESUMES a persisted draft across a refresh.
 *
 * This is the whole point of the story: `state.okf.drafts` used to live only
 * in Vuex, so a browser refresh threw the wizard's curation view-state away
 * and reopened it on the permissive fallback (studio_step 9) rather than the
 * step the steward left off at. `onResume` now hydrates from the server
 * BEFORE reading the draft.
 *
 * The two properties that make this safe:
 *   1. a null draft (no draft yet, or a repo that is gone) still opens the
 *      wizard on the same permissive fallback it always used — additive,
 *      never a throw, never a blocked open,
 *   2. the store is cache-first, so an in-session resume costs no round-trip
 *      and the pre-10.5 behaviour is unchanged.
 */

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn().mockResolvedValue([]), get: jest.fn(), getMetrics: jest.fn() }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { listForRepo: jest.fn().mockResolvedValue([]), get: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn().mockResolvedValue({}), getDraft: jest.fn() }
}));
jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));
jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([]),
    createRepo: jest.fn(),
    importZipIntoRepo: jest.fn()
  },
  loadSubjectAreaOptions: jest.fn().mockResolvedValue([]),
  createRepo: jest.fn(),
  importZipIntoRepo: jest.fn()
}));

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const studioService = require('@/services/studioService').default;
const okfModule = require('@/store/modules/okf').default;
const OkfStudioTab = require('@/components/okf/StudioTab.vue').default;

function mountTab(store) {
  return mount(OkfStudioTab, {
    global: {
      plugins: [store],
      stubs: {
        OkfStudioDashboard: true,
        OkfStudioWizard: true,
        OkfRepoEditorShell: true,
        OkfNarrative: true,
        DsModeSwitch: true
      }
    }
  });
}

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  studioService.getDraft.mockReset();
});

it('onResume hydrates the PERSISTED draft — the wizard reopens where the steward left off', async () => {
  // A fresh page load: Vuex holds nothing, the server holds the draft.
  studioService.getDraft.mockResolvedValueOnce({
    repo_id: 'r1',
    name: 'Bali',
    domain: 'Water Supply',
    source: 'crawl',
    source_file_id: 'f9',
    concept_count: 12,
    studio_step: 5,
    updated_at: '2026-10-12T09:00:00.000Z'
  });
  const store = buildStore();
  store.commit('okf/upsertRepo', { repo_id: 'r1', name: 'Bali', domain: 'Water Supply', concept_count: 12 });
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();

  await wrapper.vm.onResume('r1');

  expect(studioService.getDraft).toHaveBeenCalledWith('r1');
  expect(wrapper.vm.activeDraft.studio_step).toBe(5); // NOT the permissive 9
  expect(wrapper.vm.activeDraft.name).toBe('Bali');
  expect(wrapper.vm.activeSourceFileId).toBe('f9');
  expect(wrapper.vm.view).toBe('repo');
  // the flat wire draft is committed to the store too (the rail + the
  // wizard's liveDraft computed both read it from there)
  expect(store.getters['okf/activeDraft']('r1').studio_step).toBe(5);
  wrapper.unmount();
});

it('no persisted draft → the permissive fallback still opens the wizard (nothing throws)', async () => {
  studioService.getDraft.mockResolvedValueOnce(null);
  const store = buildStore();
  store.commit('okf/upsertRepo', { repo_id: 'r1', name: 'Bali', domain: 'Water Supply', concept_count: 12 });
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();

  await wrapper.vm.onResume('r1');

  expect(wrapper.vm.activeDraft.studio_step).toBe(9); // everything unlocked — pre-10.5 behaviour
  expect(wrapper.vm.activeDraft.name).toBe('Bali');
  expect(wrapper.vm.view).toBe('repo');
  wrapper.unmount();
});

it('a server WITHOUT the endpoint (NOT_READY) opens the wizard on the fallback', async () => {
  studioService.getDraft.mockRejectedValueOnce(Object.assign(new Error('NOT_READY'), { code: 'NOT_READY' }));
  const store = buildStore();
  store.commit('okf/upsertRepo', { repo_id: 'r1', name: 'Bali', domain: 'Water Supply', concept_count: 12 });
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();

  await expect(wrapper.vm.onResume('r1')).resolves.not.toThrow();

  expect(wrapper.vm.activeDraft.studio_step).toBe(9);
  expect(wrapper.vm.view).toBe('repo');
  wrapper.unmount();
});

it('a hard failure still opens the wizard — a resume never blocks the UI', async () => {
  studioService.getDraft.mockRejectedValueOnce({ status: 500, data: { error: 'INTERNAL_ERROR' } });
  const store = buildStore();
  store.commit('okf/upsertRepo', { repo_id: 'r1', name: 'Bali', domain: 'Water Supply', concept_count: 12 });
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();

  await expect(wrapper.vm.onResume('r1')).resolves.not.toThrow();

  expect(wrapper.vm.activeDraft.studio_step).toBe(9);
  wrapper.unmount();
});

it('an in-session re-resume costs no round-trip (cache-first, pre-10.5 speed preserved)', async () => {
  studioService.getDraft.mockResolvedValueOnce({ repo_id: 'r1', name: 'Bali', studio_step: 5 });
  const store = buildStore();
  store.commit('okf/upsertRepo', { repo_id: 'r1', name: 'Bali', domain: 'Water Supply', concept_count: 12 });
  const wrapper = mountTab(store);
  await wrapper.vm.$nextTick();

  await wrapper.vm.onResume('r1');
  await wrapper.vm.onResume('r1');

  expect(studioService.getDraft).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

describe('!1067 — a bundle import lands on Curate, not past it', () => {
  /**
   * The bug and the reason the obvious fix does not work:
   *
   * The zip branch of onCreateAction sends the steward to the DASHBOARD and
   * they open the repo LATER via a card click, which runs onResume(). A repo
   * with no PERSISTED draft gets the permissive fallback `studio_step: 9` at
   * StudioTab.vue:381 — so the import opened on step 9 "Review", past step 6
   * "Curate", the only step with a blocking requirement (frontmatter tags, PII
   * acceptance, cross-links).
   *
   * That is also why seeding `activeDraft` would not have fixed it: this
   * branch navigates away, so only a persisted draft survives to the click.
   * Hence the assertion below is on `studioService.saveDraft` — the PERSISTED
   * write — and then the round trip through onResume, which is what the
   * operator actually experiences.
   */
  async function createFromBundle() {
    const store = buildStore();
    const wrapper = mountTab(store);
    await wrapper.vm.$nextTick();

    const realDispatch = store.dispatch.bind(store);
    store.dispatch = jest.fn((type, payload) => {
      if (type === 'okf/createRepo') {
        return Promise.resolve({
          ok: true,
          repo: { repo_id: 'r2', name: 'Bundle Co', domain: 'Water Supply', concept_count: 12 }
        });
      }
      if (type === 'okf/fetchRepos') return Promise.resolve({ ok: true });
      return realDispatch(type, payload);
    });

    wrapper.vm.stagedZipFile = { name: 'bundle.zip' }; // only truthiness is read
    wrapper.vm.stagedZipName = 'bundle.zip';
    wrapper.vm.createName = 'Bundle Co';
    wrapper.vm.createDomain = 'Water Supply';

    await wrapper.vm.onCreateAction('create');
    await wrapper.vm.$nextTick();
    return { store, wrapper };
  }

  it('persists a draft with studio_step 5 at import time', async () => {
    const { wrapper } = await createFromBundle();
    expect(studioService.saveDraft).toHaveBeenCalledWith('r2', expect.objectContaining({ studio_step: 5 }));
    wrapper.unmount();
  });

  it('the card click after the import lands on Curate (5), NOT the 9 fallback', async () => {
    const { store, wrapper } = await createFromBundle();

    // DELIBERATELY NOT STUBBING getDraft HERE. An earlier version of this test
    // handed onResume a hand-written draft, which made it pass against the
    // UNFIXED component — it was asserting that resume honours a draft, which
    // was always true, not that import creates one. onResume reads the cached
    // draft first (saveDraft commits in-memory before its network write), so
    // with no server stub the only thing that can put a draft there is the
    // import path itself. Remove the fix and this lands on the 9 fallback.
    store.commit('okf/upsertRepo', {
      repo_id: 'r2',
      name: 'Bundle Co',
      domain: 'Water Supply',
      concept_count: 12
    });
    await wrapper.vm.onResume('r2');

    expect(wrapper.vm.activeDraft.studio_step).toBe(5);
    // Regression guard: the permissive fallback is still 9, so this fails if the
    // seeding regresses rather than the expected value changing.
    expect(wrapper.vm.activeDraft.studio_step).not.toBe(9);
    wrapper.unmount();
  });

  it('a repo created WITHOUT a bundle still starts at step 1 (unchanged)', async () => {
    const store = buildStore();
    const wrapper = mountTab(store);
    await wrapper.vm.$nextTick();

    const realDispatch = store.dispatch.bind(store);
    store.dispatch = jest.fn((type, payload) => {
      if (type === 'okf/createRepo') {
        return Promise.resolve({ ok: true, repo: { repo_id: 'r3', name: 'Empty', domain: 'D', concept_count: 0 } });
      }
      return realDispatch(type, payload);
    });

    wrapper.vm.stagedZipFile = null;
    wrapper.vm.createName = 'Empty';
    wrapper.vm.createDomain = 'D';
    await wrapper.vm.onCreateAction('create');
    await wrapper.vm.$nextTick();

    // David, 2026-10-11: "when creating a new repo the wizard must start from
    // step 1 not step 10". Unrelated to !1067 — pinned so the fix above does not
    // drag it along.
    expect(wrapper.vm.activeDraft.studio_step).toBe(0);
    wrapper.unmount();
  });
});
