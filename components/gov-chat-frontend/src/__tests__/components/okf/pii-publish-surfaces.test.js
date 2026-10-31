'use strict';

/**
 * MOUNT POINTS (2026-10-13).
 *
 * A component that is correct but never mounted changes nothing. These pin the
 * two facts the incident turns on:
 *   - the PII verdict renders INSIDE the publish dialogs (before the click),
 *   - the repo-wide re-scan is reachable from the editor's PII area.
 *
 * The dashboard/shell are stubbed heavily: this is about placement, not about
 * their behaviour. Reverting either template edit makes the matching assertion
 * fail — there is no way to pass these while the components sit unused.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([]),
    isBuilding: () => false,
    isRedraining: () => false,
    friendlyLifecycleError: (code, message) => message || String(code),
    lifecycle: jest.fn().mockResolvedValue({ ok: true }),
    deleteRepo: jest.fn().mockResolvedValue({ status: 'deleted' }),
    listVersions: jest.fn().mockResolvedValue([]),
    exportRepoZip: jest.fn().mockResolvedValue('x.zip')
  }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
    get: jest.fn().mockResolvedValue(null),
    lifecycle: jest.fn().mockResolvedValue({ ok: true }),
    deleteRepo: jest.fn().mockResolvedValue({ status: 'deleted' }),
    listVersions: jest.fn().mockResolvedValue([]),
    getRepoLogs: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    importConcepts: jest.fn(),
    mintVersion: jest.fn(),
    update: jest.fn().mockResolvedValue({ ok: true })
  }
}));

const OkfStudioDashboard = require('@/components/okf/StudioDashboard.vue').default;
const OkfRepoEditor = require('@/components/okf/editor/RepoEditor.vue').default;
const PiiReviewSummary = require('@/components/okf/editor/PiiReviewSummary.vue').default;
const PiiRepoRescan = require('@/components/okf/editor/PiiRepoRescan.vue').default;

/**
 * REAL Vuex store. Vuex getters are non-configurable, so the surfaces are set
 * up through STATE + the module's own mutations, which is what production
 * writes anyway — a redefined-getter mock would let these pass against a store
 * the real code could never be in.
 */
function fakeStore() {
  const dispatched = [];
  const okfModule = require('@/store/modules/okf').default;
  const store = new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
  store.__dispatched = dispatched;
  const real = store.dispatch.bind(store);
  store.dispatch = (t, p) => {
    dispatched.push({ type: t, payload: p });
    if (t === 'okf/fetchConcepts') return Promise.resolve({ ok: true, concepts: [] });
    if (t === 'okf/startRepoPiiScan') return Promise.resolve({ ok: true, result: { scan_key: 'sk' } });
    if (t === 'okf/getRepoPiiScan') return Promise.resolve({ ok: true, result: { status: 'done', scanned: 0 } });
    return real(t, p);
  };
  return store;
}

/** Put a repo in the draft lane the way fetchRepos would. */
function seedRepo(store, repo) {
  store.commit('okf/upsertRepo', repo);
  store.commit('okf/setReposByStage', {
    draft: [repo.repo_id],
    in_review: [],
    published: [],
    ingested: [],
    retracted: []
  });
}

// The dashboard's contextual action for 'approve' is 'publish' — that is the
// state a curator is actually in when the publish confirm opens. A 'draft' repo
// would open a SUBMIT confirm, which is a different dialog entirely.
const REPO = { repo_id: 'r1', name: 'Repo One', lifecycle_state: 'approve', pii_scan_status: 'complete' };

const settle = async (w, ticks = 5) => {
  for (let i = 0; i < ticks; i++) {
    await w.vm.$nextTick();
    await Promise.resolve();
  }
};

/**
 * DsModal renders through <Teleport to="body">, so the dialog's DOM lives in
 * document.body and NOT inside the wrapper. Asserting on wrapper.find() would
 * pass against a component that never rendered its dialog at all, so these
 * helpers read the real teleported node.
 *
 * Scoped to the LAST .ds-dialog so a leftover dialog from a previous test in
 * this file cannot satisfy an assertion about a different repository.
 */
const lastDialog = () => {
  const all = document.body.querySelectorAll('.ds-dialog, .ds-dialog__body');
  return all[all.length - 1] || null;
};
const inDialog = (sel) => {
  const d = lastDialog();
  return d ? d.querySelector(sel) || (d.matches && d.matches(sel) ? d : null) : null;
};
const dialogText = () => {
  const d = lastDialog();
  return d ? d.textContent || '' : '';
};

describe('The publish dialog shows the PII verdict BEFORE the publish click', () => {
  it('StudioDashboard renders the summary inside the publish dialog', async () => {
    const store = fakeStore();
    seedRepo(store, REPO);
    const w = mount(OkfStudioDashboard, { global: { plugins: [store] }, propsData: { domain: '' } });
    await settle(w);

    // Open the publish confirm the way a curator does.
    w.vm.onLifecycle(REPO);
    await settle(w);

    expect(w.vm.publishAsk).toBeTruthy();
    // The dialog is visible AND contains the verdict component. A component
    // imported but not rendered inside the dialog would fail both.
    expect(w.findComponent(PiiReviewSummary).exists()).toBe(true);
    expect(inDialog('.okf-dashboard__pii-review')).toBeTruthy();
    expect(dialogText()).toContain('Personal data check');
  });

  it('the verdict names the state, so a flagged repo is not readable as all-clear', async () => {
    const store = fakeStore();
    seedRepo(store, REPO);
    store.commit('okf/setConcepts', {
      repoId: 'r1',
      concepts: Array.from({ length: 107 }, (_, i) => ({ concept_id: `h${i}`, pii_state: 'hit' }))
    });
    const w = mount(OkfStudioDashboard, { global: { plugins: [store] }, propsData: { domain: '' } });
    await settle(w);
    w.vm.onLifecycle(REPO);
    await settle(w);

    const summary = w.findComponent(PiiReviewSummary);
    expect(summary.exists()).toBe(true);
    expect(summary.props('repoId')).toBe('r1');
    // The count the curator must see before confirming, read from the real
    // (teleported) dialog DOM rather than the wrapper tree.
    expect(dialogText()).toContain('107');
  });
});

const EDITOR_STUBS = {
  OkfConceptEditor: true,
  FrontmatterPanel: true,
  OkfTestingLabDialog: true,
  DsOkfMarkdownEditor: true
};

describe('The editor reaches the repo-wide re-scan from its PII area', () => {
  it('RepoEditor mounts the re-scan control bound to this repository', async () => {
    const store = fakeStore();
    seedRepo(store, REPO);
    store.commit('okf/setConcepts', {
      repoId: 'r1',
      concepts: [{ concept_id: 'c1', title: 'C1', pii_state: 'error' }]
    });
    const w = mount(OkfRepoEditor, {
      global: { plugins: [store] },
      propsData: { repoId: 'r1', readOnly: false },
      stubs: EDITOR_STUBS
    });
    await settle(w);

    const rescan = w.findComponent(PiiRepoRescan);
    expect(rescan.exists()).toBe(true);
    expect(rescan.props('repoId')).toBe('r1');
    // It lives in the editor's PII block, not behind the concept selection.
    expect(w.find('.okf-re__pii-rescan').exists()).toBe(true);
  });

  it('the editor control is NOT gated on the selected concept being flagged', async () => {
    // The remedy must be reachable even while the curator is looking at a
    // clean page in a repo whose OTHER page is blocked.
    const store = fakeStore();
    seedRepo(store, REPO);
    store.commit('okf/setConcepts', {
      repoId: 'r1',
      concepts: [
        { concept_id: 'clean1', title: 'Clean', pii_state: 'clean' },
        { concept_id: 'blocked', title: 'Blocked', pii_state: 'error' }
      ]
    });
    const w = mount(OkfRepoEditor, {
      global: { plugins: [store] },
      propsData: { repoId: 'r1', readOnly: false },
      stubs: EDITOR_STUBS
    });
    await settle(w);

    expect(w.find('.okf-re__pii-rescan').exists()).toBe(true);
    expect(w.findComponent(PiiRepoRescan).exists()).toBe(true);
  });

  it('a successful re-scan refreshes the repository row so the badge follows', async () => {
    const store = fakeStore();
    seedRepo(store, REPO);
    const w = mount(OkfRepoEditor, {
      global: { plugins: [store] },
      propsData: { repoId: 'r1', readOnly: false },
      stubs: EDITOR_STUBS
    });
    await settle(w);

    const before = store.__dispatched.filter((d) => d.type === 'okf/fetchRepos').length;
    w.findComponent(PiiRepoRescan).vm.$emit('rescanned', { repoId: 'r1', tally: { scanned: 3 } });
    await settle(w);

    // The repo's own scan marker / ack may have moved with the run, so the
    // cached row is re-read rather than left showing the pre-scan truth.
    expect(store.__dispatched.filter((d) => d.type === 'okf/fetchRepos').length).toBeGreaterThan(before);
  });
});
