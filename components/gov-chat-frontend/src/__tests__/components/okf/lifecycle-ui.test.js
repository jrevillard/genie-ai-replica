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
    listVersions: mockOpsVersions,
    // The real predicate (same logic as okfRepoOps.isBuilding) — the building
    // UI must react to REAL shapes, not a jest.fn().
    isBuilding: (repo) =>
      !!repo &&
      ((repo.conversion && !['done', 'failed'].includes(repo.conversion.status)) || (repo.indexing_pending || 0) > 0)
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
const OkfBuildProgressCard = require('@/components/okf/editor/BuildProgressCard.vue').default;

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
    await (
      dialog.find('button').exists()
        ? dialog.findAll('button').find((b) => b.text() === 'Rename')
        : { trigger: () => {} }
    ).trigger('click');
    await flush();
    expect(repoOkfService.update).toHaveBeenCalledWith('d1', { name: 'Drafty Renamed' });
    expect(dialog.props('visible')).toBe(false);
  });
});

describe('BUILDING GATE (David, 2026-09-02) — building repos stay In progress', () => {
  // lifecycle_state says 'review'/'approve' — the BUILDING state must override
  // the lane, the action button AND the card's health ring.
  const BUILDING = {
    repo_id: 'b1',
    name: 'Builder',
    lifecycle_state: 'review',
    concept_count: 3,
    conversion: { status: 'splitting', stage: 'splitting', pages_done: 12, batches_done: 2 }
  };
  const INDEXING = {
    repo_id: 'b2',
    name: 'Indexer',
    lifecycle_state: 'approve',
    concept_count: 41,
    indexing_pending: 41
  };
  const DONE = {
    repo_id: 'ok1',
    name: 'DoneRepo',
    lifecycle_state: 'review',
    conversion: { status: 'done' },
    concept_count: 5
  };

  it('a building repo lands in the In progress lane (laneFor pinning)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [BUILDING, INDEXING, DONE]);
    await flush();
    const lanes = wrapper.findAll('.okf-dashboard__lane');
    const inProgress = lanes[0].text();
    expect(inProgress).toContain('Builder'); // conversion active → pinned to In progress
    expect(inProgress).toContain('Indexer'); // indexing_pending>0 → pinned too
    const inReview = lanes[1].text();
    expect(inReview).toContain('DoneRepo');
    expect(inProgress).not.toContain('In review');
  });

  it('building cards show the spinner + disabled Building… chip, no lifecycle action', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [BUILDING]);
    await flush();
    const card = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Builder'));
    expect(card.findComponent({ name: 'DsSpinner' }).exists()).toBe(true);
    const chip = card.findAll('button').find((b) => b.text() === 'Building…');
    expect(chip).toBeTruthy();
    expect(chip.attributes('disabled')).toBeDefined();
    expect(card.findAll('button').some((b) => b.text() === 'Approve')).toBe(false);
  });

  it('a done conversion + zero indexing_pending does NOT build-block (the contextual action returns)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [DONE]);
    await flush();
    const card = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('DoneRepo'));
    expect(card.findAll('button').some((b) => b.text() === 'Approve')).toBe(true);
    expect(card.findAll('button').some((b) => b.text() === 'Building…')).toBe(false);
  });

  it('editor shell: lifecycle button shows Building…, disabled, click is a no-op', async () => {
    const store = buildStore();
    await seedRepos(store, [
      {
        repo_id: 'sh1',
        name: 'ShellBuild',
        lifecycle_state: 'review',
        conversion: { status: 'downloading' }
      }
    ]);
    await flush();
    const wrapper = mount(OkfRepoEditorShell, {
      global: { mocks: { $store: store }, stubs: STUBS },
      props: { repoId: 'sh1' }
    });
    const btn = wrapper.findAll('button').find((b) => b.text() === 'Building…');
    expect(btn).toBeTruthy();
    expect(btn.attributes('disabled')).toBeDefined();
    await btn.trigger('click');
    await flush();
    expect(mockOpsLifecycle).not.toHaveBeenCalledWith('sh1', 'approve', {});
  });

  it('hovering a building card opens the live progress metrics card (David, 2026-09-03)', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [BUILDING]);
    await flush();
    repoOkfService.get.mockResolvedValueOnce({
      repo_id: 'b1',
      name: 'Builder',
      concept_count: 40,
      indexing_pending: 10,
      conversion: { status: 'adding', stage: 'adding', pages_done: 12, batches_done: 3, bytes_total: 2048 }
    });
    const card = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Builder'));
    await card.find('.okf-dashboard__card').trigger('mouseenter');
    await flush();
    const pop = wrapper.findComponent(OkfBuildProgressCard);
    expect(pop.exists()).toBe(true);
    await flush(); // the component's own fetch resolves into `fresh`
    const text = wrapper.text();
    expect(text).toContain('30 / 40'); // indexed / total
    expect(text).toContain('75%');
    expect(text).toContain('Adding');
    expect(text).toContain('12'); // pages processed
    expect(text).toContain('3'); // batches stored
    expect(text).toContain('2.0 KB'); // fmtBytes(bytes_total)
  });

  it('a NON-building card never sprouts the progress popup', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [DONE]);
    await flush();
    const card = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('DoneRepo'));
    await card.find('.okf-dashboard__card').trigger('mouseenter');
    await flush();
    expect(wrapper.findComponent(OkfBuildProgressCard).exists()).toBe(false);
  });

  it('leaving the card closes the popup after the grace period', async () => {
    const store = buildStore();
    const wrapper = mount(OkfStudioDashboard, { global: { mocks: { $store: store }, stubs: STUBS } });
    await seedRepos(store, [BUILDING]);
    await flush();
    const card = wrapper.findAll('.okf-dashboard__card-wrap').find((c) => c.text().includes('Builder'));
    await card.find('.okf-dashboard__card').trigger('mouseenter');
    await flush();
    expect(wrapper.findComponent(OkfBuildProgressCard).exists()).toBe(true);
    await card.find('.okf-dashboard__card').trigger('mouseleave');
    await new Promise((r) => setTimeout(r, 350)); // > the 250 ms grace
    expect(wrapper.findComponent(OkfBuildProgressCard).exists()).toBe(false);
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
