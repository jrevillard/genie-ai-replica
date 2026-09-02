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
    getRepoLogs: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    ingest: jest.fn(),
    mintVersion: jest.fn(),
    update: jest.fn().mockResolvedValue({ ok: true })
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
const OkfRepoEditor = require('@/components/okf/editor/RepoEditor.vue').default;
const OkfLogsDialog = require('@/components/okf/editor/LogsDialog.vue').default;
const OkfRenameRepoDialog = require('@/components/okf/editor/RenameRepoDialog.vue').default;

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

  it('offers Logs between Versions and Export on EVERY card and opens the dialog for that repo (David, 2026-08-31)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const cards = wrapper.findAll('.okf-dashboard__card-wrap');
    expect(cards.length).toBe(REPOS.length);
    for (const card of cards) {
      const buttons = card.findAll('button').map((b) => b.text());
      expect(buttons).toContain('Logs');
      // BETWEEN Versions and Export (the audit-log directive order)
      expect(buttons.indexOf('Logs')).toBeGreaterThan(buttons.indexOf('Versions'));
      expect(buttons.indexOf('Logs')).toBeLessThan(buttons.indexOf('Export'));
    }
    const drafty = cards.find((c) => c.text().includes('Drafty'));
    await drafty
      .findAll('button')
      .find((b) => b.text() === 'Logs')
      .trigger('click');
    const dialog = wrapper.findComponent(OkfLogsDialog);
    expect(dialog.props('visible')).toBe(true);
    expect(dialog.props('repo')).toMatchObject({ repo_id: 'd1' });
  });

  it('offers Rename between Export and Delete on NON-serving cards only (hidden while serving)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const cards = wrapper.findAll('.okf-dashboard__card-wrap');
    const serving = cards.find((c) => c.text().includes('Ingesty'));
    const draft = cards.find((c) => c.text().includes('Drafty'));
    expect(serving.findAll('button').some((b) => b.text() === 'Rename')).toBe(false);
    expect(draft.findAll('button').some((b) => b.text() === 'Rename')).toBe(true);
    // order: ... Export · Rename · Delete
    const buttons = draft.findAll('button').map((b) => b.text());
    expect(buttons.indexOf('Rename')).toBeGreaterThan(buttons.indexOf('Export'));
    expect(buttons.indexOf('Rename')).toBeLessThan(buttons.indexOf('Delete'));
  });

  it('Rename opens the dialog prefilled; saving calls update and refreshes', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, {
      global: { mocks: { $store: store }, stubs: STUBS }
    });
    await seedRepos(store, REPOS);
    await flush();
    const draft = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Drafty'));
    await draft
      .findAll('button')
      .find((b) => b.text() === 'Rename')
      .trigger('click');
    const dialog = wrapper.findComponent(OkfRenameRepoDialog);
    expect(dialog.props('visible')).toBe(true);
    expect(dialog.props('repo')).toMatchObject({ repo_id: 'd1', name: 'Drafty' });
    await dialog.setData({ name: 'Drafty Renamed' });
    await (dialog.find('button').exists()
      ? dialog.findAll('button').find((b) => b.text() === 'Rename')
      : { trigger: () => {} }
    ).trigger('click');
    await flush();
    expect(repoOkfService.update).toHaveBeenCalledWith('d1', { name: 'Drafty Renamed' });
    expect(dialog.props('visible')).toBe(false);
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

  it('serving repo: READ ONLY pill + serving-graph chip + readOnly wired to the editor', async () => {
    const store = buildStore();
    await seedRepos(store, [
      {
        repo_id: 'r-3',
        name: 'Kenya Government Services',
        lifecycle_state: 'publish',
        version: 2,
        ingested_at: '2026-08-30T10:00:00Z',
        ingested_graph_name: 'OKF_kenya-government-services_v2',
        bundle: { file_id: 'f', file_name: 'kenya-government-services-v2.zip' }
      }
    ]);
    await flush();
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'r-3' }
    });
    expect(wrapper.text()).toContain('READ ONLY');
    expect(wrapper.text()).toContain('OKF_kenya-government-services_v2');
    expect(wrapper.findComponent(OkfRepoEditor).props('readOnly')).toBe(true);
  });

  it('non-serving repo: no READ ONLY pill, editor is writable', async () => {
    const store = buildStore();
    await seedRepos(store, [{ repo_id: 'r-4', name: 'Editable', lifecycle_state: 'approve', version: 1 }]);
    await flush();
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'r-4' }
    });
    expect(wrapper.text()).not.toContain('READ ONLY');
    expect(wrapper.findComponent(OkfRepoEditor).props('readOnly')).toBe(false);
  });

  it('Logs opens the activity-log dialog between Versions and Export (David, 2026-08-31)', async () => {
    const repoOkfService = require('@/services/repoOkfService').default;
    repoOkfService.getRepoLogs.mockResolvedValue([
      {
        ts: '2026-08-31T10:00:00Z',
        actor: 'steward-1',
        actor_name: 'Steward One',
        action: 'repo.publish',
        description: 'Published version 1 — bundle "demo-v1.zip" stored in the document repository'
      },
      {
        ts: '2026-08-31T11:00:00Z',
        actor: 'steward-1',
        actor_name: 'Steward One',
        action: 'repo.ingest',
        description: 'Ingested version 1 — graph "OKF_demo_v1" is now serving'
      }
    ]);
    const store = buildStore();
    await seedRepos(store, [{ repo_id: 'r-5', name: 'Logged', lifecycle_state: 'approve', version: 1 }]);
    await flush();
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'r-5' }
    });
    const btns = wrapper.findAll('button').map((b) => b.text());
    const versionsIdx = btns.indexOf('Versions');
    const logsIdx = btns.indexOf('Logs');
    const exportIdx = btns.findIndex((t) => t.includes('Export'));
    expect(logsIdx).toBeGreaterThan(-1);
    expect(logsIdx).toBeGreaterThan(versionsIdx);
    expect(logsIdx).toBeLessThan(exportIdx);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Logs')
      .trigger('click');
    await flush();
    const dialog = wrapper.findComponent(OkfLogsDialog);
    expect(dialog.props('visible')).toBe(true);
    expect(repoOkfService.getRepoLogs).toHaveBeenCalledWith('r-5');
    // The rendered rows: user, timestamp, action and the human description.
    const text = wrapper.text();
    expect(text).toContain('Steward One');
    expect(text).toContain('repo.publish');
    expect(text).toContain('Published version 1 — bundle "demo-v1.zip" stored in the document repository');
    expect(text).toContain('Ingested version 1 — graph "OKF_demo_v1" is now serving');
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

  it('publish action is DISABLED while serving (READ ONLY — retract first)', () => {
    const store = buildStore();
    const wrapper = mount(OkfVersionsDialog, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: {
        visible: true,
        repo: {
          repo_id: 'r-1',
          name: 'Demo',
          lifecycle_state: 'publish',
          version: 1,
          ingested_at: '2026-08-30T10:00:00Z'
        }
      }
    });
    expect(wrapper.vm.canPublish).toBe(false);
  });
});
