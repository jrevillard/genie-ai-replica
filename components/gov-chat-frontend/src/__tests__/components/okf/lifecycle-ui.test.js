'use strict';

/**
 * Story #978 lifecycle UI (David, 2026-08-28) — the dashboard's five lanes +
 * per-card lifecycle actions, the editor shell's lifecycle strip, and the
 * Versions dialog. The machine's CONTEXTUAL action per state is asserted for
 * every state, plus the delete-hidden-while-serving rule.
 */

const { mount } = require('@vue/test-utils');

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    lifecycle: jest.fn().mockResolvedValue({ ok: true }),
    deleteRepo: jest.fn().mockResolvedValue({ status: 'deleted' }),
    listVersions: jest.fn(),
    create: jest.fn(),
    ingest: jest.fn(),
    mintVersion: jest.fn()
  }
}));

const mockOpsLifecycle = jest.fn().mockResolvedValue({ ok: true });
const mockOpsDelete = jest.fn().mockResolvedValue({ status: 'deleted' });
const mockOpsVersions = jest
  .fn()
  .mockResolvedValue([{ bundle_version: 1, okf_tag: 'okf:v1', trigger: 'publish', concept_count: 2 }]);

jest.mock('@/services/okfRepoOps', () => {
  // BOTH surfaces: components import .default; the store's ensureServices()
  // requires the NAMESPACE (no .default) and uses the named exports.
  const impl = {
    exportRepoZip: jest.fn().mockResolvedValue('demo-v1.zip'),
    publish: jest.fn(),
    ingest: jest.fn(),
    retract: jest.fn(),
    lifecycle: mockOpsLifecycle,
    deleteRepo: mockOpsDelete,
    listVersions: mockOpsVersions
  };
  return { __esModule: true, default: impl, ...impl };
});

const okfRepoOps = require('@/services/okfRepoOps').default;
const repoOkfService = require('@/services/repoOkfService').default;

/** REAL Vuex store with the okf module — mapGetters needs it (a plain-object
 * mock leaves this.$store.getters undefined inside mapped getters). */
function buildStore() {
  const Vuex = require('vuex');
  const okfModule = require('@/store/modules/okf').default;
  return new Vuex.Store({
    modules: {
      okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) }
    }
  });
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

async function seedRepos(store, repos) {
  repoOkfService.list.mockResolvedValueOnce(repos);
  await store.dispatch('okf/fetchRepos', { stage: 'all' });
}

const OkfStudioDashboard = require('@/components/okf/StudioDashboard.vue').default;
const OkfRepoEditorShell = require('@/components/okf/editor/RepoEditorShell.vue').default;
const OkfVersionsDialog = require('@/components/okf/editor/VersionsDialog.vue').default;

const STUBS = { teleport: true };

describe('OkfStudioDashboard — five lifecycle lanes', () => {
  const REPOS = [
    { repo_id: 'd1', name: 'Drafty', lifecycle_state: 'draft', concept_count: 1 },
    { repo_id: 'rv', name: 'Reviewing', lifecycle_state: 'review', concept_count: 1 },
    { repo_id: 'pb', name: 'Pubby', lifecycle_state: 'publish', version: 2, concept_count: 4 },
    {
      repo_id: 'in',
      name: 'Ingesty',
      lifecycle_state: 'publish',
      version: 2,
      ingested_at: '2026-08-28T10:00:00Z',
      concept_count: 4
    },
    { repo_id: 'rt', name: 'Pully', lifecycle_state: 'retracted', version: 1, concept_count: 2 }
  ];

  it('renders all five lanes with their repos in the right one', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const headers = wrapper.findAll('.okf-dashboard__lane-header h4').map((h) => h.text());
    expect(headers).toEqual(['In progress', 'In review', 'Published', 'Ingested', 'Retracted']);
    const text = wrapper.text();
    expect(text).toContain('Drafty');
    expect(text).toContain('Ingesty');
    expect(text).toContain('Pully');
    expect(text).toContain('Ingested v2');
    expect(text).toContain('Published v2');
    expect(text).toContain('Retracted');
  });

  it('offers the machine contextual action per state', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const labels = wrapper.findAll('.okf-dashboard__card-actions button').map((b) => b.text());
    expect(labels).toContain('Submit for review');
    expect(labels).toContain('Approve');
    expect(labels).toContain('Ingest');
    expect(labels).toContain('Retract');
  });

  it('hides Delete while an ingested version is serving, shows it otherwise', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const cards = wrapper.findAll('.okf-dashboard__card-wrap');
    const serving = cards.find((c) => c.text().includes('Ingesty'));
    const draft = cards.find((c) => c.text().includes('Drafty'));
    expect(serving.findAll('button').some((b) => b.text() === 'Delete')).toBe(false);
    expect(draft.findAll('button').some((b) => b.text() === 'Delete')).toBe(true);
  });

  it('dispatches the contextual lifecycle action (ingest on a published repo)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, REPOS);
    await flush();
    const pubby = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Pubby'));
    const ingestBtn = pubby.findAll('button').find((b) => b.text() === 'Ingest');
    await ingestBtn.trigger('click');
    expect(mockOpsLifecycle).toHaveBeenCalledWith('pb', 'ingest', {});
  });

  it('export calls the shared library', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const draft = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Drafty'));
    const exportBtn = draft.findAll('button').find((b) => b.text() === 'Export');
    await exportBtn.trigger('click');
    expect(okfRepoOps.exportRepoZip).toHaveBeenCalled();
  });

  it('opens the Versions dialog from a card', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const draft = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Drafty'));
    await draft
      .findAll('button')
      .find((b) => b.text() === 'Versions')
      .trigger('click');
    expect(wrapper.findComponent(OkfVersionsDialog).props('visible')).toBe(true);
  });
});

describe('OkfRepoEditorShell — lifecycle strip', () => {
  it('draft repo: shows Draft + the Submit action; back button emits back', async () => {
    const store = buildStore();
    await seedRepos(store, [{ repo_id: 'r-1', name: 'Repo One', lifecycle_state: 'draft' }]);
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'r-1' }
    });
    expect(wrapper.text()).toContain('Draft');
    const submit = wrapper.findAll('button').find((b) => b.text() === 'Submit for review');
    await submit.trigger('click');
    await flush();
    expect(mockOpsLifecycle).toHaveBeenCalledWith('r-1', 'submit', {});
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Studio dashboard'))
      .trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();
  });

  it('serving repo: Ingested pill + Retract action + no Delete', async () => {
    const store = buildStore();
    await seedRepos(store, [
      {
        repo_id: 'r-2',
        name: 'Served',
        lifecycle_state: 'publish',
        version: 3,
        ingested_at: '2026-08-28T10:00:00Z',
        bundle: { file_id: 'f', file_name: 'served-v3.zip' }
      }
    ]);
    await flush();
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'r-2' }
    });
    expect(wrapper.text()).toContain('Ingested');
    expect(wrapper.text()).toContain('served-v3.zip');
    expect(wrapper.findAll('button').some((b) => b.text() === 'Retract')).toBe(true);
    expect(wrapper.findAll('button').some((b) => b.text() === 'Delete')).toBe(false);
  });
});

describe('OkfVersionsDialog — the versions panel', () => {
  it('lists the ledger and dispatches publish on Create new version', async () => {
    const store = buildStore();
    repoOkfService.listVersions.mockResolvedValue([
      { bundle_version: 1, okf_tag: 'okf:v1', trigger: 'publish', concept_count: 2 }
    ]);
    const wrapper = mount(OkfVersionsDialog, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: {
        visible: true,
        repo: { repo_id: 'r-1', name: 'Demo', lifecycle_state: 'publish', version: 1 }
      }
    });
    await flush();
    expect(wrapper.text()).toContain('okf:v1');
    const dialog = wrapper.findComponent({ name: 'DsDialog' });
    await dialog.vm.$emit('action', 'publish');
    await flush();
    expect(mockOpsLifecycle).toHaveBeenCalledWith('r-1', 'publish', {});
  });

  it('publish action is DISABLED for a draft repo (approve first)', () => {
    const store = buildStore();
    const wrapper = mount(OkfVersionsDialog, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { visible: true, repo: { repo_id: 'r-1', name: 'Demo', lifecycle_state: 'draft', version: 0 } }
    });
    expect(wrapper.vm.canPublish).toBe(false);
  });
});
