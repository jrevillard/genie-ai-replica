'use strict';

/**
 * okf store — the remaining action surface (David's standing rule, 2026-10-30:
 * coverage must INCREASE with every feature MR). The editor suite covers
 * openEditor/fetchConcepts/patchConcept; this file drives the wizard, PII,
 * head-suite and RAGAS actions — the {ok, code, message} envelope contract,
 * the poll loops (fake timers), the transient-fault tolerance and the
 * conversion poller's interval lifecycle.
 */

jest.mock('@/services/headTestService', () => ({
  __esModule: true,
  default: {
    rebuildHead: jest.fn(),
    routingTest: jest.fn(),
    generateSuite: jest.fn(),
    addSuiteQueries: jest.fn(),
    getSuite: jest.fn(),
    renameSuite: jest.fn(),
    deleteSuite: jest.fn(),
    probeSuiteQuery: jest.fn(),
    updateSuiteRows: jest.fn(),
    runSuite: jest.fn(),
    getRun: jest.fn(),
    explainRouting: jest.fn(),
    explainSuiteFailures: jest.fn(),
    getExplainFailures: jest.fn(),
    listRuns: jest.fn(),
    frontmatterHistory: jest.fn(),
    revertFrontmatter: jest.fn()
  }
}));
jest.mock('@/services/ragasService', () => ({
  __esModule: true,
  default: {
    generateSuite: jest.fn(),
    getSuite: jest.fn(),
    cancelSuiteGeneration: jest.fn(),
    cancelRun: jest.fn(),
    deleteRun: jest.fn(),
    updateSuiteRows: jest.fn(),
    addQueries: jest.fn(),
    renameSuite: jest.fn(),
    deleteSuite: jest.fn(),
    runSuite: jest.fn(),
    getRun: jest.fn(),
    rescoreRun: jest.fn(),
    listRuns: jest.fn(),
    probeEntry: jest.fn(),
    explainFailures: jest.fn(),
    getExplain: jest.fn(),
    exportSuite: jest.fn(),
    importSuite: jest.fn(),
    exportResults: jest.fn()
  }
}));
jest.mock('@/services/modelConfigService', () => ({
  __esModule: true,
  default: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    copy: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
    remove: jest.fn(),
    models: jest.fn(),
    modelsPreview: jest.fn(),
    test: jest.fn()
  }
}));
jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));
// The store binds okfRepoOps as the RAW module (ensureServices does
// require('@/services/okfRepoOps') with no .default) — the fns must sit at
// the top level of the factory, not under default.
jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: { createRepo: jest.fn(), addConcept: jest.fn(), deleteConcept: jest.fn() },
  createRepo: jest.fn(),
  addConcept: jest.fn(),
  deleteConcept: jest.fn(),
  lifecycle: jest.fn(),
  deleteRepo: jest.fn(),
  importRepoZip: jest.fn(),
  listVersions: jest.fn()
}));
jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn(), getDraft: jest.fn() }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    update: jest.fn(),
    getMetrics: jest.fn(),
    reingestFailed: jest.fn(),
    scanConceptPii: jest.fn(),
    startRepoPiiScan: jest.fn(),
    getRepoPiiScan: jest.fn(),
    patchConcept: jest.fn(),
    patchConceptBody: jest.fn(),
    list: jest.fn(),
    listConcepts: jest.fn(),
    listVersions: jest.fn().mockResolvedValue([]),
    getValidation: jest.fn(),
    wireCitations: jest.fn(),
    suggestLinks: jest.fn(),
    acceptLink: jest.fn(),
    startTopicLinks: jest.fn(),
    getTopicLinkRun: jest.fn()
  }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { get: jest.fn(), listForRepo: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/frontmatterService', () => ({
  __esModule: true,
  patchFrontmatter: jest.fn().mockResolvedValue({ ok: true })
}));
jest.mock('@/services/frontmatterMerge', () => ({
  __esModule: true,
  mergeFrontmatterIntoIndexMarkdown: jest.fn((md) => md)
}));
jest.mock('gray-matter', () => ({
  __esModule: true,
  default: { stringify: (body) => `---\n---\n${body}` }
}));

const headTestService = require('@/services/headTestService').default;
const studioService = require('@/services/studioService').default;

// ─── remaining store surface ───────────────────────────────────────────────
describe('repo/lifecycle/version/validation pass-throughs', () => {
  it('fetchRepos upserts every repo and recomputes the lanes', async () => {
    repoOkfService.list.mockResolvedValueOnce([{ repo_id: 'a' }, { repo_id: 'b' }]);
    const store = buildStore();
    const res = await store.dispatch('okf/fetchRepos', { stage: 'draft' });
    expect(res.ok).toBe(true);
    expect(store.state.okf.reposById.a).toBeTruthy();
    repoOkfService.list.mockRejectedValueOnce(new Error('503'));
    expect(await store.dispatch('okf/fetchRepos', {})).toMatchObject({ ok: false, code: 'FETCH_FAILED' });
  });

  it('mintVersion passes through; failures map MINT_FAILED', async () => {
    repoOkfService.mintVersion = jest.fn().mockResolvedValueOnce({ ok: true, bundle_version: 3 });
    const store = buildStore();
    expect(await store.dispatch('okf/mintVersion', { repoId: 'r1', body: {} })).toMatchObject({ ok: true });
    repoOkfService.mintVersion.mockRejectedValueOnce(new Error('gate'));
    expect(await store.dispatch('okf/mintVersion', { repoId: 'r1' })).toMatchObject({ ok: false, code: 'MINT_FAILED' });
  });

  it('lifecycleTransition refreshes the repo row; deleteRepoAction recomputes lanes; upsertImported caches', async () => {
    okfRepoOps.lifecycle.mockResolvedValueOnce({ ok: true });
    repoOkfService.get.mockResolvedValueOnce({ repo_id: 'r1', lifecycle_state: 'published' });
    const store = buildStore();
    expect(await store.dispatch('okf/lifecycleTransition', { repoId: 'r1', action: 'publish' })).toMatchObject({
      ok: true
    });
    expect(store.state.okf.reposById.r1.lifecycle_state).toBe('published');
    const err = new Error('serving');
    err.code = 'INGESTED_DELETE_BLOCKED';
    okfRepoOps.lifecycle.mockRejectedValueOnce(err);
    expect(await store.dispatch('okf/lifecycleTransition', { repoId: 'r1', action: 'delete' })).toMatchObject({
      ok: false,
      code: 'INGESTED_DELETE_BLOCKED'
    });
    okfRepoOps.deleteRepo.mockResolvedValueOnce({});
    const store2 = buildStore({ reposById: { r1: { repo_id: 'r1', lifecycle_state: 'draft' } } });
    expect(await store2.dispatch('okf/deleteRepoAction', { repoId: 'r1' })).toMatchObject({ ok: true });
    expect(store2.state.okf.reposById.r1).toBeUndefined();
    okfRepoOps.importRepoZip.mockResolvedValueOnce({ repo_id: 'r9' });
    const store3 = buildStore();
    expect(await store3.dispatch('okf/upsertImported', { file: {}, name: 'N' })).toMatchObject({ ok: true });
    expect(store3.state.okf.reposById.r9).toBeTruthy();
    const dup = new Error('exists');
    dup.code = 'DUPLICATE_REPO';
    dup.repo = { repo_id: 'r-dup' };
    okfRepoOps.importRepoZip.mockRejectedValueOnce(dup);
    const res = await store3.dispatch('okf/upsertImported', { file: {} });
    expect(res).toMatchObject({ ok: false, code: 'DUPLICATE_REPO', repo: { repo_id: 'r-dup' } });
  });

  it('fetchVersions / fetchValidation / citations / links / topic-links pass-throughs', async () => {
    okfRepoOps.listVersions.mockResolvedValueOnce([{ bundle_version: 1 }]);
    const store = buildStore();
    expect(await store.dispatch('okf/fetchVersions', 'r1')).toMatchObject({
      ok: true,
      versions: [{ bundle_version: 1 }]
    });
    repoOkfService.getValidation.mockResolvedValueOnce({ issues: [] });
    expect(await store.dispatch('okf/fetchValidation', 'r1')).toMatchObject({ ok: true });
    repoOkfService.wireCitations.mockResolvedValueOnce({ wired: 1 });
    expect(await store.dispatch('okf/wireCitations', { repoId: 'r1' })).toMatchObject({ ok: true });
    repoOkfService.suggestLinks.mockResolvedValueOnce({ suggestions: [] });
    expect(await store.dispatch('okf/suggestLinks', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({ ok: true });
    repoOkfService.acceptLink.mockResolvedValueOnce({ ok: true });
    expect(await store.dispatch('okf/acceptLink', { repoId: 'r1', conceptId: 'c1', toConceptId: 'c2' })).toMatchObject({
      ok: true
    });
    repoOkfService.startTopicLinks.mockResolvedValueOnce({ run_key: 't1' });
    expect(await store.dispatch('okf/startTopicLinks', { repoId: 'r1', dryRun: true })).toMatchObject({ ok: true });
    expect(repoOkfService.startTopicLinks).toHaveBeenCalledWith('r1', true);
    repoOkfService.getTopicLinkRun.mockResolvedValueOnce({ status: 'done' });
    expect(await store.dispatch('okf/getTopicLinkRun', { repoId: 'r1' })).toMatchObject({ ok: true });
  });

  it('resplitRepo / autocorrectRepo (both proposal shapes + heuristics passthrough)', async () => {
    repoOkfService.resplit = jest.fn().mockResolvedValueOnce({ total: 5 });
    const store = buildStore(EDITOR_SEED());
    conceptService.listForRepo.mockResolvedValue([]);
    const res = await store.dispatch('okf/resplitRepo', { repoId: 'r1', mode: 'B' });
    expect(res).toMatchObject({ ok: true, total: 5 });
    expect(await store.dispatch('okf/resplitRepo', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR'
    });
    repoOkfService.autocorrect = jest.fn().mockResolvedValueOnce({ proposals: [{ concept_id: 'c1' }] });
    const res2 = await store.dispatch('okf/autocorrectRepo', { repoId: 'r1', dryRun: false });
    expect(res2.changes).toEqual([{ concept_id: 'c1' }]);
    repoOkfService.autocorrect.mockResolvedValueOnce({ proposals: { concept_id: 'c2' } });
    const res3 = await store.dispatch('okf/autocorrectRepo', { repoId: 'r1' });
    expect(res3.changes).toEqual([{ concept_id: 'c2' }]);
    repoOkfService.autocorrect.mockResolvedValueOnce({ changes: [], warnings: [] });
    const res4 = await store.dispatch('okf/autocorrectRepo', { repoId: 'r1' });
    expect(res4.changes).toEqual([]);
    repoOkfService.autocorrect.mockRejectedValueOnce(new Error('llm'));
    expect(await store.dispatch('okf/autocorrectRepo', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'AUTOCORRECT_FAILED'
    });
  });

  it('getConcept and headSuiteRun / headRecommend envelopes', async () => {
    conceptService.get.mockResolvedValueOnce({ concept_id: 'c1' });
    const store = buildStore();
    expect(await store.dispatch('okf/getConcept', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({ ok: true });
    conceptService.get.mockResolvedValueOnce(null);
    expect(await store.dispatch('okf/getConcept', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({ ok: false });
    headTestService.runSuite.mockResolvedValueOnce({ run_key: 'rk' });
    expect(await store.dispatch('okf/headSuiteRun', { repoId: 'r1', suiteKey: 's1' })).toMatchObject({ ok: true });
    headTestService.recommendTags = jest.fn().mockResolvedValueOnce({ changes: { add: [] } });
    expect(await store.dispatch('okf/headRecommend', { repoId: 'r1' })).toMatchObject({ ok: true });
    expect(headTestService.recommendTags).toHaveBeenCalledWith('r1', expect.anything());
  });

  // Round 21 (#80916): the STORE hop of the ADVISOR_TIMEOUT chain — the
  // envelope must carry the service's code through, or the Lab's translated
  // arm is keyed on a literal nothing produced. Middle hop of three (service
  // throws it, this forwards it, the dialog renders it).
  it('headRecommend forwards the service error CODE on the envelope (ADVISOR_TIMEOUT chain)', async () => {
    const timeout = new Error('still running');
    timeout.code = 'ADVISOR_TIMEOUT';
    headTestService.recommendTags = jest.fn().mockRejectedValueOnce(timeout);
    const store = buildStore();
    expect(await store.dispatch('okf/headRecommend', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'ADVISOR_TIMEOUT'
    });
  });
});

describe('draft lifecycle (Story 10.5)', () => {
  // Round 20: the dead `loadDraft` action (a pure cache lookup nothing
  // dispatched — the wizard rides fetchDraft's cache-first path) was removed
  // with its assertions; what remains pins fetchDraft itself.
  it('fetchDraft caches-first and null is not an error', async () => {
    const store = buildStore();
    studioService.getDraft.mockResolvedValueOnce({ step: 2 });
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res).toMatchObject({ ok: true });
    expect(store.state.okf.drafts.r1.repo_id).toBe('r1');
    studioService.getDraft.mockResolvedValueOnce(null);
    expect(await store.dispatch('okf/fetchDraft', { repoId: 'r1', force: true })).toMatchObject({
      ok: true,
      draft: null
    });
  });

  it('fetchDraft NOT_READY flags the session; other errors map DRAFT_FETCH_FAILED', async () => {
    const notReady = new Error('x');
    notReady.code = 'NOT_READY';
    studioService.getDraft.mockRejectedValueOnce(notReady);
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(store.state.okf.draftsUnavailable).toBe(true);
    studioService.getDraft.mockRejectedValueOnce(new Error('wire'));
    expect(await store.dispatch('okf/fetchDraft', { repoId: 'r1', force: true })).toMatchObject({
      ok: false,
      code: 'DRAFT_FETCH_FAILED'
    });
    expect(await store.dispatch('okf/fetchDraft', {})).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('saveDraft: Vuex-first always; frozen repos skip the server write; NOT_READY flags', async () => {
    studioService.saveDraft.mockResolvedValueOnce({ ok: true });
    const store = buildStore();
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { step: 4 } });
    expect(res).toMatchObject({ ok: true });
    expect(store.state.okf.drafts.r1.step).toBe(4);
    const frozen = buildStore({ reposById: { r1: { repo_id: 'r1', ingested_at: 'T' } } });
    const res2 = await frozen.dispatch('okf/saveDraft', { repoId: 'r1', draft: { step: 5 } });
    expect(res2).toMatchObject({ ok: true, skipped: 'frozen' });
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1); // not re-hammered
    const notReady = new Error('x');
    notReady.code = 'NOT_READY';
    studioService.saveDraft.mockRejectedValueOnce(notReady);
    const store3 = buildStore();
    expect(await store3.dispatch('okf/saveDraft', { repoId: 'r1', draft: {} })).toMatchObject({
      ok: false,
      code: 'NOT_READY'
    });
    expect(await store3.dispatch('okf/saveDraft', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR'
    });
  });

  it('clearDraft empties the slot', async () => {
    const store = buildStore({ drafts: { r1: { step: 1 } } });
    expect(await store.dispatch('okf/clearDraft', 'r1')).toMatchObject({ ok: true });
    expect(store.state.okf.drafts.r1).toBeUndefined();
  });
});
const ragasService = require('@/services/ragasService').default;
const modelConfigService = require('@/services/modelConfigService').default;
const c2o = require('@/services/crawlerToOkfService').default;
const okfRepoOps = require('@/services/okfRepoOps'); // raw module, like the store's binding
const repoOkfService = require('@/services/repoOkfService').default;
const conceptService = require('@/services/conceptService').default;

const Vuex = require('vuex');
const okfModule = require('@/store/modules/okf').default;

function buildStore(seed = {}) {
  return new Vuex.Store({
    modules: {
      okf: {
        ...okfModule,
        state: () => JSON.parse(JSON.stringify({ ...okfModule.state(), ...seed }))
      }
    }
  });
}

const EDITOR_SEED = (extra = {}) => ({
  editor: {
    repoId: 'r1',
    selectedConceptId: null,
    conceptsByRepo: { r1: [{ concept_id: 'index', is_index: true }] },
    conceptsLoading: false,
    loadProgress: null,
    subTab: 'editor',
    expertMode: false,
    drafts: {},
    ...extra
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ─── wizard / dashboard actions ────────────────────────────────────────────
describe('createFromCrawl + pollCrawlConversions', () => {
  it('upserts the repo, seeds the draft lane, registers the conversion and emits', async () => {
    jest.useFakeTimers();
    const events = [];
    const listener = (e) => events.push(e.detail.repo_id);
    window.addEventListener('okf:okf-repo-created', listener);
    c2o.convertCrawlToOkf.mockResolvedValueOnce({
      repo_id: 'r-new',
      name: 'N',
      conversion: { status: 'queued', stage: 'queued' }
    });
    const store = buildStore();
    const res = await store.dispatch('okf/createFromCrawl', { fileId: 'f1' });
    expect(res.ok).toBe(true);
    expect(store.state.okf.reposById['r-new']).toBeTruthy();
    expect(store.state.okf.reposByStage.draft).toContain('r-new');
    expect(store.state.okf.crawlConversions['r-new'].conversion.status).toBe('queued');
    // the poller armed: one tick fetches the repo doc
    repoOkfService.get.mockResolvedValueOnce({ repo_id: 'r-new', name: 'N', conversion: { status: 'done' } });
    await jest.advanceTimersByTimeAsync(3000);
    expect(repoOkfService.get).toHaveBeenCalledWith('r-new');
    // terminal conversion → the next tick reaps the timer
    await jest.advanceTimersByTimeAsync(3000);
    expect(store.state.okf.conversionPollTimer).toBeNull();
    window.removeEventListener('okf:okf-repo-created', listener);
    expect(events).toEqual(['r-new']);
  });

  it('failure maps the server code and sets the error state', async () => {
    const err = new Error('nope');
    err.code = 'CRAWL_FILE_MISSING';
    c2o.convertCrawlToOkf.mockRejectedValueOnce(err);
    const store = buildStore();
    const res = await store.dispatch('okf/createFromCrawl', {});
    expect(res).toMatchObject({ ok: false, code: 'CRAWL_FILE_MISSING' });
    expect(store.state.okf.error).toBe('nope');
  });

  it('pollCrawlConversions is a no-op with no active conversions or an armed timer', () => {
    const store = buildStore({
      crawlConversions: { r1: { repo_id: 'r1', conversion: { status: 'done' } } }
    });
    store.dispatch('okf/pollCrawlConversions');
    expect(store.state.okf.conversionPollTimer).toBeNull(); // untouched default
    const store2 = buildStore({
      crawlConversions: { r1: { repo_id: 'r1', conversion: { status: 'running' } } },
      conversionPollTimer: 12345
    });
    store2.dispatch('okf/pollCrawlConversions');
    expect(store2.state.okf.conversionPollTimer).toBe(12345); // not re-armed
  });
});

describe('createConcept / deleteConcept', () => {
  it('createConcept validates, creates via okfRepoOps and refetches', async () => {
    okfRepoOps.addConcept.mockResolvedValueOnce({ concept_id: 'c-new', index_updated: true });
    const store = buildStore(EDITOR_SEED());
    conceptService.listForRepo.mockResolvedValueOnce([{ concept_id: 'index' }, { concept_id: 'c-new' }]);
    const res = await store.dispatch('okf/createConcept', { repoId: 'r1', title: 'New', body: '# N' });
    expect(res.ok).toBe(true);
    expect(res.concept_id).toBe('c-new');
    expect(okfRepoOps.addConcept).toHaveBeenCalledWith(
      expect.objectContaining({ indexRow: expect.objectContaining({ concept_id: 'index' }) })
    );
    expect(await store.dispatch('okf/createConcept', { title: 'x' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR'
    });
  });

  it('createConcept honors updateIndex=false (no index row handed to the lib)', async () => {
    okfRepoOps.addConcept.mockResolvedValueOnce({ concept_id: 'c2' });
    const store = buildStore(EDITOR_SEED());
    conceptService.listForRepo.mockResolvedValueOnce([]);
    const res = await store.dispatch('okf/createConcept', { repoId: 'r1', title: 'X', updateIndex: false });
    expect(res.ok).toBe(true);
    expect(okfRepoOps.addConcept).toHaveBeenCalledWith(expect.objectContaining({ indexRow: null }));
  });

  it('deleteConcept clears a matching selection and refetches; failure keeps the row', async () => {
    okfRepoOps.deleteConcept.mockResolvedValueOnce({ ok: true });
    const store = buildStore(EDITOR_SEED({ selectedConceptId: 'c1', conceptsByRepo: { r1: [{ concept_id: 'c1' }] } }));
    conceptService.listForRepo.mockResolvedValueOnce([]);
    const res = await store.dispatch('okf/deleteConcept', { repoId: 'r1', conceptId: 'c1' });
    expect(res.ok).toBe(true);
    expect(store.state.okf.editor.selectedConceptId).toBeNull();
    okfRepoOps.deleteConcept.mockRejectedValueOnce(new Error('serving'));
    const res2 = await store.dispatch('okf/deleteConcept', { repoId: 'r1', conceptId: 'c1' });
    expect(res2).toMatchObject({ ok: false, code: 'DELETE_FAILED' });
    expect(await store.dispatch('okf/deleteConcept', { repoId: 'r1' })).toMatchObject({ ok: false });
  });
});

describe('updateLabels / fetchRepoMetrics / reingestFailed / requestRetract', () => {
  it('updateLabels upserts only after a successful PATCH; 404 maps to NOT_READY', async () => {
    repoOkfService.update.mockResolvedValueOnce({});
    const store = buildStore({ reposById: { r1: { repo_id: 'r1', labels: [] } } });
    const res = await store.dispatch('okf/updateLabels', { repoId: 'r1', labels: ['Health'] });
    expect(res.ok).toBe(true);
    expect(store.state.okf.reposById.r1.labels).toEqual(['Health']);
    const nf = new Error('x');
    nf.status = 404;
    repoOkfService.update.mockRejectedValueOnce(nf);
    const res2 = await store.dispatch('okf/updateLabels', { repoId: 'r1', labels: [] });
    expect(res2).toMatchObject({ ok: false, code: 'NOT_READY', status: 404 });
  });

  it('fetchRepoMetrics: success commits; 404 is ok+null; other failures surface (#78748)', async () => {
    repoOkfService.getMetrics.mockResolvedValueOnce({ parsed: 2 });
    const store = buildStore();
    const res = await store.dispatch('okf/fetchRepoMetrics', 'r1');
    expect(res).toMatchObject({ ok: true, metrics: { parsed: 2 } });
    const nf = new Error('nf');
    nf.status = 404;
    repoOkfService.getMetrics.mockRejectedValueOnce(nf);
    expect(await store.dispatch('okf/fetchRepoMetrics', 'r1')).toMatchObject({ ok: true, metrics: null });
    const boom = new Error('500');
    boom.status = 500;
    repoOkfService.getMetrics.mockRejectedValueOnce(boom);
    expect(await store.dispatch('okf/fetchRepoMetrics', 'r1')).toMatchObject({ ok: false, code: 'METRICS_FAILED' });
  });

  it('reingestFailed: ok envelopes refetch; !ok passes the server code; throw maps REINGEST_FAILED', async () => {
    repoOkfService.reingestFailed.mockResolvedValueOnce({ ok: true, requeued: 3, concept_ids: ['a'] });
    const store = buildStore();
    conceptService.listForRepo.mockResolvedValue([]);
    repoOkfService.get.mockResolvedValue({ repo_id: 'r1' });
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r1' });
    expect(res).toMatchObject({ ok: true, requeued: 3 });
    repoOkfService.reingestFailed.mockResolvedValueOnce({ ok: false, code: 'DRAIN_IN_PROGRESS', message: 'drain' });
    const res2 = await store.dispatch('okf/reingestFailed', { repoId: 'r1' });
    expect(res2).toMatchObject({ ok: false, code: 'DRAIN_IN_PROGRESS' });
    repoOkfService.reingestFailed.mockRejectedValueOnce(new Error('wire'));
    const res3 = await store.dispatch('okf/reingestFailed', { repoId: 'r1' });
    expect(res3).toMatchObject({ ok: false, code: 'REINGEST_FAILED' });
    expect(await store.dispatch('okf/reingestFailed', {})).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('requestRetract is the honest NOT_READY placeholder', async () => {
    const store = buildStore();
    expect(await store.dispatch('okf/requestRetract', 'r1')).toMatchObject({
      ok: false,
      code: 'NOT_READY',
      repoId: 'r1'
    });
  });
});

// ─── PII actions ───────────────────────────────────────────────────────────
describe('PII actions', () => {
  it('rescanConceptPii forces {rescan:true}; start arms; poll reads', async () => {
    // Round 16, #80119: the action now FETCHES the concept first and scans
    // what it loaded — no content means NO scan (fail closed), never a
    // meaningless 'clean' verdict on the meta row.
    conceptService.get.mockResolvedValueOnce({ body: 'concept body text', frontmatter: { title: 'T' } });
    repoOkfService.scanConceptPii.mockResolvedValueOnce({ scanned: 1 });
    const store = buildStore();
    const res = await store.dispatch('okf/rescanConceptPii', { repoId: 'r1', conceptId: 'c1' });
    expect(res.ok).toBe(true);
    expect(repoOkfService.scanConceptPii).toHaveBeenCalledWith('r1', 'c1', {
      rescan: true,
      frontmatter: { title: 'T' },
      body: 'concept body text'
    });
    // Fail closed: unreadable content refuses to scan at all.
    conceptService.get.mockResolvedValueOnce(null);
    expect(await store.dispatch('okf/rescanConceptPii', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({
      ok: false,
      code: 'CONCEPT_UNAVAILABLE'
    });
    expect(repoOkfService.scanConceptPii).toHaveBeenCalledTimes(1);
    // A concept row without a string body is equally unscannable.
    conceptService.get.mockResolvedValueOnce({ concept_id: 'c1' });
    expect(await store.dispatch('okf/rescanConceptPii', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({
      ok: false,
      code: 'CONCEPT_UNAVAILABLE'
    });
    expect(await store.dispatch('okf/rescanConceptPii', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR'
    });
    repoOkfService.startRepoPiiScan.mockResolvedValueOnce({ scan_key: 's1', status: 'running' });
    expect(await store.dispatch('okf/startRepoPiiScan', { repoId: 'r1' })).toMatchObject({ ok: true });
    repoOkfService.getRepoPiiScan.mockResolvedValueOnce({ status: 'done' });
    expect(await store.dispatch('okf/getRepoPiiScan', { repoId: 'r1', scanKey: 's1' })).toMatchObject({ ok: true });
    const err = new Error('scan down');
    err.code = 'PII_SCAN_FAILED';
    conceptService.get.mockResolvedValueOnce({ body: 'body text' });
    repoOkfService.scanConceptPii.mockRejectedValueOnce(err);
    expect(await store.dispatch('okf/rescanConceptPii', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({
      ok: false,
      code: 'PII_SCAN_FAILED'
    });
  });
});

// ─── head-suite actions ────────────────────────────────────────────────────
describe('head-suite actions', () => {
  const WRAPPERS = [
    ['headRebuild', 'rebuildHead', ['r1'], { repoId: 'r1' }, 'REBUILD_FAILED'],
    [
      'headRoutingTest',
      'routingTest',
      ['r1', { query: 'q', formula: undefined, include_probes: false }],
      { repoId: 'r1', query: 'q' },
      'ROUTING_TEST_FAILED'
    ],
    ['headSuiteGet', 'getSuite', ['r1', 's1'], { repoId: 'r1', suiteKey: 's1' }, 'SUITE_LOAD_FAILED'],
    [
      'headSuiteUpdateRows',
      'updateSuiteRows',
      ['r1', 's1', { removes: [] }],
      { repoId: 'r1', suiteKey: 's1', payload: { removes: [] } },
      'SUITE_UPDATE_FAILED'
    ],
    [
      'headSuiteRename',
      'renameSuite',
      ['r1', 's1', 'n'],
      { repoId: 'r1', suiteKey: 's1', name: 'n' },
      'SUITE_RENAME_FAILED'
    ],
    ['headSuiteDelete', 'deleteSuite', ['r1', 's1'], { repoId: 'r1', suiteKey: 's1' }, 'SUITE_DELETE_FAILED'],
    [
      'headSuiteProbe',
      'probeSuiteQuery',
      ['r1', 's1', 'q'],
      { repoId: 'r1', suiteKey: 's1', query: 'q' },
      'PROBE_FAILED'
    ],
    [
      'headSuiteGetRun',
      'getRun',
      ['r1', 's1', 'run-1'],
      { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' },
      'RUN_NOT_FOUND'
    ],
    ['headRoutingExplain', 'explainRouting', ['r1', 'q'], { repoId: 'r1', query: 'q' }, 'EXPLAIN_FAILED'],
    ['headSuiteListRuns', 'listRuns', ['r1', { kind: 'all', limit: 20 }], { repoId: 'r1' }, 'RUNS_FAILED'],
    ['frontmatterHistory', 'frontmatterHistory', ['r1'], { repoId: 'r1' }, 'HISTORY_FAILED'],
    ['frontmatterRevert', 'revertFrontmatter', ['r1', 'T1'], { repoId: 'r1', savedAt: 'T1' }, 'REVERT_FAILED']
  ];
  it.each(WRAPPERS)(
    '%s wraps the service call in the honest envelope',
    async (action, svcFn, svcArgs, dispatchArgs, fallbackCode) => {
      headTestService[svcFn].mockResolvedValueOnce({ result: true });
      const store = buildStore();
      const res = await store.dispatch(`okf/${action}`, dispatchArgs);
      expect(res.ok).toBe(true);
      expect(headTestService[svcFn]).toHaveBeenCalledWith(...svcArgs);
      const err = new Error('svc down');
      err.code = 'E_X';
      headTestService[svcFn].mockRejectedValueOnce(err);
      const res2 = await store.dispatch(`okf/${action}`, dispatchArgs);
      expect(res2).toMatchObject({ ok: false, code: 'E_X', message: 'svc down' });
      headTestService[svcFn].mockRejectedValueOnce(new Error('bare'));
      const res3 = await store.dispatch(`okf/${action}`, dispatchArgs);
      expect(res3).toMatchObject({ ok: false, code: fallbackCode });
    }
  );

  it('headSuiteGenerate maps the count knobs to the snake_case body', async () => {
    headTestService.generateSuite.mockResolvedValueOnce({ suite_key: 's' });
    const store = buildStore();
    const res = await store.dispatch('okf/headSuiteGenerate', {
      repoId: 'r1',
      nPositive: 5,
      nNegative: 5,
      nMeta: 2,
      name: 'Suite'
    });
    expect(res.ok).toBe(true);
    expect(headTestService.generateSuite).toHaveBeenCalledWith('r1', {
      n_positive: 5,
      n_negative: 5,
      n_negative_random: undefined,
      n_meta: 2,
      n_near_miss: undefined,
      name: 'Suite'
    });
  });

  it('headSuiteAddQueries passes the queries through', async () => {
    headTestService.addSuiteQueries.mockResolvedValueOnce({ added: 1 });
    const store = buildStore();
    const res = await store.dispatch('okf/headSuiteAddQueries', { repoId: 'r1', suiteKey: 's1', queries: [] });
    expect(res.ok).toBe(true);
    expect(headTestService.addSuiteQueries).toHaveBeenCalledWith('r1', 's1', []);
  });

  it('headSuiteExplainFailures: sync answer, poll-to-payload, failed doc, transient blips', async () => {
    const store = buildStore();
    headTestService.explainSuiteFailures.mockResolvedValueOnce({ advice: 'inline' });
    expect(await store.dispatch('okf/headSuiteExplainFailures', { repoId: 'r1', suiteKey: 's1' })).toMatchObject({
      ok: true,
      result: { advice: 'inline' }
    });
    jest.useFakeTimers();
    headTestService.explainSuiteFailures.mockResolvedValueOnce({ run_key: 'rk' });
    headTestService.getExplainFailures
      .mockRejectedValueOnce(Object.assign(new Error('502'), { status: 502 })) // blip
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', payload: { note: 'x' } });
    const p = store.dispatch('okf/headSuiteExplainFailures', { repoId: 'r1', suiteKey: 's1' });
    await jest.advanceTimersByTimeAsync(2000); // blip → tolerated
    await jest.advanceTimersByTimeAsync(2000); // running
    await jest.advanceTimersByTimeAsync(2000); // done
    await expect(p).resolves.toMatchObject({ ok: true, result: { note: 'x' } });
    headTestService.explainSuiteFailures.mockResolvedValueOnce({ run_key: 'rk2' });
    headTestService.getExplainFailures.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'E_ADVICE', message: 'llm' }
    });
    const p2 = store.dispatch('okf/headSuiteExplainFailures', { repoId: 'r1', suiteKey: 's1' });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p2).resolves.toMatchObject({ ok: false, code: 'E_ADVICE' });
  });
});

// ─── RAGAS actions ─────────────────────────────────────────────────────────
describe('ragas envelope wrappers', () => {
  const WRAPPERS = [
    ['ragasCancelGeneration', 'cancelSuiteGeneration', { repoId: 'r1', suiteKey: 's1' }],
    ['ragasCancelRun', 'cancelRun', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' }],
    ['ragasDeleteRun', 'deleteRun', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' }],
    ['ragasGetSuite', 'getSuite', { repoId: 'r1', suiteKey: 's1' }],
    ['ragasUpdateRows', 'updateSuiteRows', { repoId: 'r1', suiteKey: 's1', payload: {} }],
    ['ragasAddQueries', 'addQueries', { repoId: 'r1', suiteKey: 's1', queries: [] }],
    ['ragasRename', 'renameSuite', { repoId: 'r1', suiteKey: 's1', name: 'n' }],
    ['ragasDelete', 'deleteSuite', { repoId: 'r1', suiteKey: 's1' }],
    ['ragasGetRunQuiet', 'getRun', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' }],
    ['ragasProbe', 'probeEntry', { repoId: 'r1', suiteKey: 's1', id: 'e1' }],
    ['ragasExportSuite', 'exportSuite', { repoId: 'r1', suiteKey: 's1' }],
    ['ragasImportSuite', 'importSuite', { repoId: 'r1', arrayBuffer: new ArrayBuffer(2) }],
    ['ragasExportResults', 'exportResults', { repoId: 'r1', suiteKey: 's1', runKeys: ['run-1'] }]
  ];
  it.each(WRAPPERS)('%s resolves {ok:true} and maps service throws', async (action, svcFn, args) => {
    ragasService[svcFn].mockResolvedValueOnce({ fine: true });
    const store = buildStore();
    const res = await store.dispatch(`okf/${action}`, args);
    expect(res.ok).toBe(true);
    const err = new Error('x');
    err.code = 'E_R';
    ragasService[svcFn].mockRejectedValueOnce(err);
    const res2 = await store.dispatch(`okf/${action}`, args);
    expect(res2).toMatchObject({ ok: false, code: 'E_R' });
  });

  it('ragasListRuns / ragasGetExplainQuiet', async () => {
    ragasService.listRuns.mockResolvedValueOnce([{}]);
    const store = buildStore();
    expect(await store.dispatch('okf/ragasListRuns', { repoId: 'r1', kind: 'ragas_run' })).toMatchObject({
      ok: true,
      runs: [{}]
    });
    ragasService.getExplain.mockResolvedValueOnce({ payload: { note: 'n' } });
    expect(
      await store.dispatch('okf/ragasGetExplainQuiet', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' })
    ).toMatchObject({
      ok: true,
      result: { note: 'n' }
    });
    ragasService.getExplain.mockResolvedValueOnce(null);
    expect(
      await store.dispatch('okf/ragasGetExplainQuiet', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1' })
    ).toMatchObject({
      ok: false,
      result: null
    });
  });
});

describe('ragasGenerate — the generation poll', () => {
  afterEach(() => jest.useRealTimers());

  it('sync answer (no suite_key) returns as-is', async () => {
    ragasService.generateSuite.mockResolvedValueOnce({ ready: true });
    const store = buildStore();
    expect(await store.dispatch('okf/ragasGenerate', { repoId: 'r1', options: {} })).toMatchObject({
      ok: true,
      result: { ready: true }
    });
  });

  it('polls generating → done, tolerates a 502 blip, reports onStarted/onProgress', async () => {
    jest.useFakeTimers();
    ragasService.generateSuite.mockResolvedValueOnce({ suite_key: 'sk' });
    ragasService.getSuite
      .mockRejectedValueOnce(Object.assign(new Error('502'), { status: 502 }))
      .mockResolvedValueOnce({ status: 'generating', progress: { done: 3 } })
      .mockResolvedValueOnce({ status: 'done', payload: 1 });
    const onStarted = jest.fn();
    const onProgress = jest.fn();
    const store = buildStore();
    const p = store.dispatch('okf/ragasGenerate', { repoId: 'r1', onStarted, onProgress });
    await jest.advanceTimersByTimeAsync(2500); // blip
    await jest.advanceTimersByTimeAsync(2500); // generating (progress)
    await jest.advanceTimersByTimeAsync(2500); // done
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(onStarted).toHaveBeenCalledWith('sk');
    expect(onProgress).toHaveBeenCalledWith({ done: 3 });
  });

  it('a failed generation reports the server code', async () => {
    jest.useFakeTimers();
    ragasService.generateSuite.mockResolvedValueOnce({ suite_key: 'sk' });
    ragasService.getSuite.mockResolvedValueOnce({ status: 'failed', error: { code: 'E_GEN', message: 'vLLM' } });
    const store = buildStore();
    const p = store.dispatch('okf/ragasGenerate', { repoId: 'r1' });
    await jest.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toMatchObject({ ok: false, code: 'E_GEN' });
  });
});

describe('ragasRun / ragasRescoreRun / adopt paths', () => {
  afterEach(() => jest.useRealTimers());

  it('ragasRun: judge pick rides the body; no run_key is RUN_NOT_STARTED', async () => {
    ragasService.runSuite.mockResolvedValueOnce({});
    const store = buildStore();
    const res = await store.dispatch('okf/ragasRun', {
      repoId: 'r1',
      suiteKey: 's1',
      metrics: ['faithfulness'],
      judge_config_key: 'k1',
      judge_model: 'm1'
    });
    expect(res).toMatchObject({ ok: false, code: 'RUN_NOT_STARTED' });
    expect(ragasService.runSuite).toHaveBeenCalledWith('r1', 's1', {
      metrics: ['faithfulness'],
      judge_config_key: 'k1',
      judge_model: 'm1'
    });
  });

  it('ragasRun polls to done and separates cancelled from failed', async () => {
    jest.useFakeTimers();
    ragasService.runSuite.mockResolvedValueOnce({ run_key: 'rk' });
    ragasService.getRun.mockResolvedValueOnce({ status: 'cancelled' });
    const store = buildStore();
    const p = store.dispatch('okf/ragasRun', { repoId: 'r1', suiteKey: 's1' });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ ok: false, code: 'RUN_CANCELLED' });
    ragasService.runSuite.mockResolvedValueOnce({ run_key: 'rk2' });
    ragasService.getRun
      .mockResolvedValueOnce({ status: 'running', progress: { done: 1 } })
      .mockResolvedValueOnce({ status: 'done', results: [] });
    const onProgress = jest.fn();
    const p2 = store.dispatch('okf/ragasRun', { repoId: 'r1', suiteKey: 's1', onProgress });
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p2).resolves.toMatchObject({ ok: true });
    expect(onProgress).toHaveBeenCalledWith({ done: 1 });
  });

  it('ragasRescoreRun: adopt-shaped poll with the NEW run key on onStarted', async () => {
    jest.useFakeTimers();
    ragasService.rescoreRun.mockResolvedValueOnce({ run_key: 'rk-new', source_run_key: 'rk-old' });
    ragasService.getRun.mockResolvedValueOnce({ status: 'done', payload: {} });
    const onStarted = jest.fn();
    const store = buildStore();
    const p = store.dispatch('okf/ragasRescoreRun', { repoId: 'r1', suiteKey: 's1', runKey: 'rk-old', onStarted });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(onStarted).toHaveBeenCalledWith('rk-new');
  });

  it('ragasAdoptRun mirrors the poll without a start call', async () => {
    jest.useFakeTimers();
    ragasService.getRun.mockResolvedValueOnce({ status: 'failed', error: { code: 'RUN_FAILED', message: 'judge' } });
    const store = buildStore();
    const p = store.dispatch('okf/ragasAdoptRun', { repoId: 'r1', suiteKey: 's1', runKey: 'rk' });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ ok: false, code: 'RUN_FAILED' });
    expect(ragasService.runSuite).not.toHaveBeenCalled();
  });

  it('ragasAdoptGeneration polls the generating envelope', async () => {
    jest.useFakeTimers();
    ragasService.getSuite.mockResolvedValueOnce({ status: 'done', payload: 1 });
    const store = buildStore();
    const p = store.dispatch('okf/ragasAdoptGeneration', { repoId: 'r1', suiteKey: 'sk' });
    await jest.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(ragasService.generateSuite).not.toHaveBeenCalled();
  });
});

describe('ragasExplain — the advisor leg', () => {
  afterEach(() => jest.useRealTimers());

  it('polls to payload with run_key routing and progress', async () => {
    jest.useFakeTimers();
    ragasService.explainFailures.mockResolvedValueOnce({ run_key: 'ek' });
    ragasService.getExplain
      .mockResolvedValueOnce({ status: 'running', progress: { phase: 'judge' } })
      .mockResolvedValueOnce({ status: 'done', payload: { advice: [] } });
    const onProgress = jest.fn();
    const store = buildStore();
    const p = store.dispatch('okf/ragasExplain', { repoId: 'r1', suiteKey: 's1', runKey: 'run-1', onProgress });
    expect(ragasService.explainFailures).toHaveBeenCalledWith('r1', 's1', { run_key: 'run-1' });
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ ok: true, result: { advice: [] } });
    expect(onProgress).toHaveBeenCalledWith({ phase: 'judge' });
  });

  it('a sync answer without run_key returns inline', async () => {
    ragasService.explainFailures.mockResolvedValueOnce({ payload: { advice: [] } });
    const store = buildStore();
    expect(await store.dispatch('okf/ragasExplain', { repoId: 'r1', suiteKey: 's1' })).toMatchObject({
      ok: true,
      result: { payload: { advice: [] } }
    });
    expect(ragasService.explainFailures).toHaveBeenCalledWith('r1', 's1', {});
  });
});

// ─── model-config actions ──────────────────────────────────────────────────
describe('modelConfig actions', () => {
  it('list writes the envelope field-by-field (the blank-picker regression)', async () => {
    modelConfigService.list.mockResolvedValueOnce({
      configs: [{ key: 'a' }],
      env_judge: { model: 'g' },
      env_pick: null
    });
    const store = buildStore();
    const res = await store.dispatch('okf/modelConfigList');
    expect(res).toEqual({ ok: true, configs: [{ key: 'a' }], env_judge: { model: 'g' }, env_pick: null });
    modelConfigService.list.mockResolvedValueOnce(null);
    expect(await store.dispatch('okf/modelConfigList')).toEqual({
      ok: true,
      configs: [],
      env_judge: null,
      env_pick: null
    });
  });

  it('create/update/copy/activate/deactivate/delete/models/preview/test wrap the service', async () => {
    const store = buildStore();
    modelConfigService.create.mockResolvedValueOnce({ key: 'k' });
    expect(await store.dispatch('okf/modelConfigCreate', { provider: 'z' })).toMatchObject({ ok: true });
    modelConfigService.update.mockResolvedValueOnce({});
    expect(await store.dispatch('okf/modelConfigUpdate', { key: 'k', payload: {} })).toMatchObject({ ok: true });
    expect(modelConfigService.update).toHaveBeenCalledWith('k', {});
    modelConfigService.copy.mockResolvedValueOnce({});
    expect(await store.dispatch('okf/modelConfigCopy', { key: 'k' })).toMatchObject({ ok: true });
    modelConfigService.activate.mockResolvedValueOnce({});
    expect(await store.dispatch('okf/modelConfigActivate', { key: 'k' })).toMatchObject({ ok: true });
    modelConfigService.deactivate.mockResolvedValueOnce({});
    expect(await store.dispatch('okf/modelConfigDeactivate', { key: 'k' })).toMatchObject({ ok: true });
    modelConfigService.remove.mockResolvedValueOnce({});
    expect(await store.dispatch('okf/modelConfigDelete', { key: 'k' })).toMatchObject({ ok: true });
    modelConfigService.models.mockResolvedValueOnce(['m1']);
    expect(await store.dispatch('okf/modelConfigModels', { key: 'k' })).toMatchObject({ ok: true });
    modelConfigService.modelsPreview.mockResolvedValueOnce(['m2']);
    expect(await store.dispatch('okf/modelConfigModelsPreview', { base_url: 'u' })).toMatchObject({ ok: true });
    modelConfigService.test.mockResolvedValueOnce({ ok: false });
    expect(await store.dispatch('okf/modelConfigTest', { provider: 'z' })).toMatchObject({ ok: true });
    const err = new Error('dup');
    err.code = 'E_DUP';
    modelConfigService.create.mockRejectedValueOnce(err);
    expect(await store.dispatch('okf/modelConfigCreate', {})).toMatchObject({ ok: false, code: 'E_DUP' });
  });

  it('every modelConfig catch has its own honest code', async () => {
    const store = buildStore();
    const boom = new Error('x');
    const cases = [
      ['modelConfigList', [], 'MODEL_CONFIG_LIST_FAILED', modelConfigService.list],
      ['modelConfigUpdate', [{ key: 'k', payload: {} }], 'MODEL_CONFIG_UPDATE_FAILED', modelConfigService.update],
      ['modelConfigCopy', [{ key: 'k' }], 'MODEL_CONFIG_COPY_FAILED', modelConfigService.copy],
      ['modelConfigActivate', [{ key: 'k' }], 'MODEL_CONFIG_ACTIVATE_FAILED', modelConfigService.activate],
      ['modelConfigDeactivate', [{ key: 'k' }], 'MODEL_CONFIG_DEACTIVATE_FAILED', modelConfigService.deactivate],
      ['modelConfigDelete', [{ key: 'k' }], 'MODEL_CONFIG_DELETE_FAILED', modelConfigService.remove],
      ['modelConfigModels', [{ key: 'k' }], 'MODEL_LIST_FAILED', modelConfigService.models],
      ['modelConfigModelsPreview', [{ base_url: 'u' }], 'MODEL_LIST_FAILED', modelConfigService.modelsPreview],
      ['modelConfigTest', [{ provider: 'z' }], 'MODEL_TEST_FAILED', modelConfigService.test]
    ];
    for (const [action, args, code, fn] of cases) {
      fn.mockRejectedValueOnce(boom);

      const res = await store.dispatch(`okf/${action}`, ...args);
      expect(res).toMatchObject({ ok: false, code, message: 'x' });
    }
  });
});

// ─── validation guards + failure envelopes sweep ───────────────────────────
describe('validation guards', () => {
  it('every repoId-scoped action rejects a missing id with VALIDATION_ERROR', async () => {
    const store = buildStore();
    const guards = [
      ['okf/createRepo', [{}]],
      ['okf/openEditor', [{}]],
      ['okf/getConcept', [{ repoId: 'r1' }]],
      ['okf/saveFrontmatter', [{ repoId: 'r1' }]],
      ['okf/autocorrectRepo', [{}]],
      ['okf/startRepoPiiScan', [{}]],
      ['okf/getRepoPiiScan', [{ repoId: 'r1' }]]
    ];
    for (const [action, args] of guards) {
      expect(await store.dispatch(action, ...args)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    }
  });
});

describe('failure envelopes sweep', () => {
  it('createRepo: name required; service failures map CREATE_FAILED (+ err.code passthrough)', async () => {
    okfRepoOps.createRepo.mockRejectedValueOnce(new Error('net'));
    const store = buildStore();
    expect(await store.dispatch('okf/createRepo', {})).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'name required'
    });
    expect(await store.dispatch('okf/createRepo', { name: 'n', documents: [] })).toMatchObject({
      ok: false,
      code: 'CREATE_FAILED'
    });
    const dup = new Error('dup');
    dup.code = 'E_DUP';
    okfRepoOps.createRepo.mockRejectedValueOnce(dup);
    expect(await store.dispatch('okf/createRepo', { name: 'n' })).toMatchObject({ ok: false, code: 'E_DUP' });
    expect(store.state.okf.error).toBeTruthy();
  });

  // Round 20 (#80123): when the repo was created but its index-skeleton
  // import failed, okfRepoOps attaches it — the envelope must carry it so
  // the UI can offer "open it" instead of a blind retry.
  it('createRepo: a failure AFTER server-side creation passes the repo through (#80123)', async () => {
    const half = new Error('index import failed');
    half.code = 'CREATE_FAILED';
    half.repo = { repo_id: 'r-half', name: 'n', lifecycle_state: 'draft' };
    okfRepoOps.createRepo.mockRejectedValueOnce(half);
    const store = buildStore();
    expect(await store.dispatch('okf/createRepo', { name: 'n' })).toMatchObject({
      ok: false,
      code: 'CREATE_FAILED',
      repo: { repo_id: 'r-half' }
    });
  });

  it('createConcept / getConcept / patchConcept failures map their codes', async () => {
    okfRepoOps.addConcept.mockRejectedValueOnce(new Error('x'));
    const store = buildStore();
    expect(await store.dispatch('okf/createConcept', { repoId: 'r1', title: 't' })).toMatchObject({
      ok: false,
      code: 'CREATE_FAILED'
    });
    conceptService.get.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/getConcept', { repoId: 'r1', conceptId: 'c1' })).toMatchObject({
      ok: false,
      code: 'FETCH_FAILED'
    });
    repoOkfService.patchConcept.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/patchConcept', { repoId: 'r1', conceptId: 'c1', markdown: 'm' })).toMatchObject({
      ok: false,
      code: 'PATCH_FAILED'
    });
  });

  it('resplit / versions / validation / links / topic-links failures map their codes', async () => {
    const store = buildStore(EDITOR_SEED());
    conceptService.listForRepo.mockResolvedValue([]);
    repoOkfService.resplit = jest.fn().mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/resplitRepo', { repoId: 'r1', mode: 'A' })).toMatchObject({
      ok: false,
      code: 'RESPLIT_FAILED'
    });
    okfRepoOps.listVersions.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/fetchVersions', 'r1')).toMatchObject({ ok: false, code: 'VERSIONS_FAILED' });
    const catches = [
      ['okf/fetchValidation', ['r1'], repoOkfService.getValidation],
      ['okf/wireCitations', [{ repoId: 'r1' }], repoOkfService.wireCitations],
      ['okf/suggestLinks', [{ repoId: 'r1', conceptId: 'c1' }], repoOkfService.suggestLinks],
      ['okf/acceptLink', [{ repoId: 'r1', conceptId: 'c1', toConceptId: 'c2' }], repoOkfService.acceptLink],
      ['okf/startTopicLinks', [{ repoId: 'r1' }], repoOkfService.startTopicLinks],
      ['okf/getTopicLinkRun', [{ repoId: 'r1' }], repoOkfService.getTopicLinkRun]
    ];
    for (const [action, args, fn] of catches) {
      fn.mockRejectedValueOnce(new Error('x'));

      expect(await store.dispatch(action, ...args)).toMatchObject({ ok: false, error: 'x' });
    }
  });

  it('repo-wide PII scan arm/poll failures map RESCAN_FAILED', async () => {
    const store = buildStore();
    repoOkfService.startRepoPiiScan.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/startRepoPiiScan', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'RESCAN_FAILED'
    });
    repoOkfService.getRepoPiiScan.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/getRepoPiiScan', { repoId: 'r1', scanKey: 's' })).toMatchObject({
      ok: false,
      code: 'RESCAN_FAILED'
    });
  });

  it('lifecycle refresh tolerates a lost repo row; delete failures map DELETE_FAILED', async () => {
    okfRepoOps.lifecycle.mockResolvedValueOnce({ ok: true });
    repoOkfService.get.mockRejectedValueOnce(new Error('gone')); // .catch(() => null) arm
    const store = buildStore();
    expect(await store.dispatch('okf/lifecycleTransition', { repoId: 'r1', action: 'publish' })).toMatchObject({
      ok: true
    });
    okfRepoOps.deleteRepo.mockRejectedValueOnce(new Error('busy'));
    const store2 = buildStore({ reposById: { r1: { repo_id: 'r1' } } });
    expect(await store2.dispatch('okf/deleteRepoAction', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'DELETE_FAILED'
    });
  });

  it('Testing-Lab wrappers surface the server envelope (err.code / err.data.error)', async () => {
    const store = buildStore();
    const withData = new Error('x');
    withData.data = { error: 'E_SERVER' };
    headTestService.generateSuite.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/headSuiteGenerate', { repoId: 'r1', suiteKey: 's' })).toMatchObject({
      ok: false,
      code: 'SUITE_FAILED'
    });
    headTestService.addSuiteQueries.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/headSuiteAddQueries', { repoId: 'r1', suiteKey: 's' })).toMatchObject({
      ok: false,
      code: 'SUITE_UPDATE_FAILED'
    });
    headTestService.runSuite.mockRejectedValueOnce(withData);
    expect(await store.dispatch('okf/headSuiteRun', { repoId: 'r1', suiteKey: 's' })).toMatchObject({
      ok: false,
      code: 'E_SERVER'
    });
    headTestService.recommendTags = jest.fn().mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/headRecommend', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'ADVISE_FAILED'
    });
    ragasService.listRuns.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/ragasListRuns', { repoId: 'r1' })).toMatchObject({
      ok: false,
      code: 'RUNS_FAILED'
    });
    ragasService.getExplain.mockRejectedValueOnce(new Error('x'));
    expect(await store.dispatch('okf/ragasGetExplainQuiet', { repoId: 'r1', runKey: 'k' })).toEqual({
      ok: false,
      result: null
    });
  });
});

// ─── saveFrontmatter (the two-write index YAML path) ───────────────────────
describe('saveFrontmatter (Story 1.7 two-write)', () => {
  it('happy path: reads index, merges YAML, patches concept + repo doc', async () => {
    conceptService.get.mockResolvedValueOnce({ concept_id: 'index', frontmatter: { title: 'T' }, body: 'B' });
    repoOkfService.patchConcept.mockResolvedValueOnce({ ok: true, content_hash: 'h2' });
    const store = buildStore();
    const res = await store.dispatch('okf/saveFrontmatter', { repoId: 'r1', shape: { subject: 'agri' } });
    expect(res).toMatchObject({ ok: true, step: 'done' });
    expect(repoOkfService.patchConcept).toHaveBeenCalledWith('r1', 'index', expect.stringContaining('B'), undefined);
    expect(require('@/services/frontmatterService').patchFrontmatter).toHaveBeenCalledWith('r1', {
      subject: 'agri'
    });
  });

  it('index without frontmatter uses the raw body; missing index is CONCEPT_NOT_FOUND', async () => {
    conceptService.get.mockResolvedValueOnce({ concept_id: 'index', body: 'B' });
    repoOkfService.patchConcept.mockResolvedValueOnce({ ok: true });
    const store = buildStore();
    expect(await store.dispatch('okf/saveFrontmatter', { repoId: 'r1', shape: {} })).toMatchObject({
      ok: true,
      step: 'done'
    });
    conceptService.get.mockResolvedValueOnce(null);
    expect(await store.dispatch('okf/saveFrontmatter', { repoId: 'r1', shape: {} })).toMatchObject({
      ok: false,
      code: 'CONCEPT_NOT_FOUND',
      step: 'get'
    });
  });

  it('yaml write failure stops before the doc write; doc failure surfaces SAVE_FAILED', async () => {
    conceptService.get.mockResolvedValueOnce({ concept_id: 'index', frontmatter: { title: 'T' }, body: 'B' });
    repoOkfService.patchConcept.mockRejectedValueOnce(new Error('gate'));
    const store = buildStore();
    expect(await store.dispatch('okf/saveFrontmatter', { repoId: 'r1', shape: {} })).toMatchObject({
      ok: false,
      code: 'PATCH_FAILED',
      step: 'yaml'
    });
    expect(require('@/services/frontmatterService').patchFrontmatter).not.toHaveBeenCalled();
    conceptService.get.mockResolvedValueOnce({ concept_id: 'index', body: 'B' });
    repoOkfService.patchConcept.mockResolvedValueOnce({ ok: true });
    require('@/services/frontmatterService').patchFrontmatter.mockRejectedValueOnce(new Error('doc write'));
    expect(await store.dispatch('okf/saveFrontmatter', { repoId: 'r1', shape: {} })).toMatchObject({
      ok: false,
      code: 'SAVE_FAILED',
      step: 'unknown'
    });
  });
});

// ─── poll deadline + 60-miss guards ────────────────────────────────────────
describe('poll deadline + transient-miss guards', () => {
  afterEach(() => jest.useRealTimers());

  // 60 fake-timer fires are multi-second wall-clock — every 60-miss test
  // carries an explicit jest timeout well above the 5s default.
  it('ragasRun: 60 transient blips give up and map RUN_FAILED', async () => {
    jest.useFakeTimers();
    ragasService.runSuite.mockResolvedValueOnce({ run_key: 'rk' });
    ragasService.getRun.mockRejectedValue(new Error('502'));
    const store = buildStore();
    const assertion = expect(
      store.dispatch('okf/ragasRun', { repoId: 'r1', suiteKey: 's1', judgeKey: 'g' })
    ).resolves.toMatchObject({ ok: false, code: 'RUN_FAILED' });
    await jest.advanceTimersByTimeAsync(130000);
    await assertion;
  }, 20000);

  it('adopt/rescore/generation polls hit their honest TIMEOUT envelopes', async () => {
    jest.useFakeTimers();
    // ragasAdoptRun: still running at the 24h deadline → RUN_TIMEOUT (progress rides along)
    ragasService.getRun.mockResolvedValue({ status: 'running', progress: { pct: 1 } });
    const onProgress = jest.fn();
    const store = buildStore();
    const adopt = expect(
      store.dispatch('okf/ragasAdoptRun', { repoId: 'r1', suiteKey: 's1', runKey: 'rk', onProgress })
    ).resolves.toMatchObject({ ok: false, code: 'RUN_TIMEOUT' });
    jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(2000);
    await adopt;
    expect(onProgress).toHaveBeenCalledWith({ pct: 1 });

    // ragasRescoreRun: 60 missed reads → RESCORE_FAILED
    ragasService.rescoreRun.mockResolvedValueOnce({ run_key: 'rk2' });
    ragasService.getRun.mockReset();
    ragasService.getRun.mockRejectedValue(new Error('502'));
    const rescore = expect(
      store.dispatch('okf/ragasRescoreRun', { repoId: 'r1', suiteKey: 's1', runKey: 'rk2' })
    ).resolves.toMatchObject({ ok: false, code: 'RESCORE_FAILED' });
    await jest.setSystemTime(Date.now()); // back to "now" for the new deadline
    await jest.advanceTimersByTimeAsync(130000);
    await rescore;

    // ragasAdoptGeneration: still generating at the deadline → GENERATION_TIMEOUT
    ragasService.getSuite.mockResolvedValue({ status: 'generating', progress: { pct: 5 } });
    const gen = expect(
      store.dispatch('okf/ragasAdoptGeneration', { repoId: 'r1', suiteKey: 'sk' })
    ).resolves.toMatchObject({ ok: false, code: 'GENERATION_TIMEOUT' });
    jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(2500);
    await gen;
  }, 25000);

  it('headSuiteExplainFailures: 60 blips → EXPLAIN_FAILED; ragasGenerate deadline → GENERATION_TIMEOUT', async () => {
    jest.useFakeTimers();
    headTestService.explainSuiteFailures.mockResolvedValueOnce({ run_key: 'ek' });
    headTestService.getExplainFailures.mockRejectedValue(new Error('502'));
    const store = buildStore();
    const explain = expect(
      store.dispatch('okf/headSuiteExplainFailures', { repoId: 'r1', suiteKey: 's1' })
    ).resolves.toMatchObject({ ok: false, code: 'EXPLAIN_FAILED' });
    await jest.advanceTimersByTimeAsync(130000);
    await explain;

    ragasService.generateSuite.mockResolvedValueOnce({ suite_key: 'sk' });
    ragasService.getSuite.mockReset();
    ragasService.getSuite.mockResolvedValue({ status: 'generating' });
    const gen = expect(store.dispatch('okf/ragasGenerate', { repoId: 'r1', options: {} })).resolves.toMatchObject({
      ok: false,
      code: 'GENERATION_TIMEOUT'
    });
    // First advance lets the action capture its deadline BEFORE the jump
    // (the leading generateSuite await is a microtask — jumping first would
    // move the deadline itself beyond reach and the poll would never end).
    await jest.advanceTimersByTimeAsync(2500);
    jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(2500);
    await gen;
  }, 25000);
});

// ─── getters, lanes and small mutations ────────────────────────────────────
describe('getters + lane mapping + small mutations', () => {
  it('groupReposByStage maps every lifecycle_state to its lane', async () => {
    repoOkfService.list.mockResolvedValueOnce([
      { repo_id: 'a' },
      { repo_id: 'b', lifecycle_state: 'review' },
      { repo_id: 'c', lifecycle_state: 'approve' },
      { repo_id: 'd', lifecycle_state: 'publish', ingested_at: 'T' },
      { repo_id: 'e', lifecycle_state: 'publish' },
      { repo_id: 'f', lifecycle_state: 'retracted' },
      { repo_id: 'g', lifecycle_state: 'version' },
      { repo_id: 'h', lifecycle_state: 'deprecate' },
      { repo_id: 'i', lifecycle_state: 'retire' }
    ]);
    const store = buildStore();
    await store.dispatch('okf/fetchRepos', {});
    const lanes = store.state.okf.reposByStage;
    expect(lanes.draft).toEqual(['a']);
    expect(lanes.in_review).toEqual(['b', 'c']);
    expect(lanes.ingested).toEqual(['d']);
    expect(lanes.published).toEqual(['e', 'g', 'h', 'i']);
    expect(lanes.retracted).toEqual(['f']);
  });

  it('editor getters: gate default, conceptById both arms, selection, error', async () => {
    const store = buildStore(EDITOR_SEED());
    expect(store.getters['okf/gate']('nope')).toEqual({ visible: false, reasonKey: null });
    store.commit('okf/setGate', { name: 'g1', value: { visible: true, reasonKey: 'why' } });
    expect(store.getters['okf/gate']('g1')).toEqual({ visible: true, reasonKey: 'why' });
    expect(store.getters['okf/editorRepoId']).toBe('r1');
    expect(store.getters['okf/conceptById']('r1', 'index')).toMatchObject({ is_index: true });
    expect(store.getters['okf/conceptById']('missing', 'index')).toBeNull();
    store.commit('okf/setSelection', { documents: ['f1'] });
    expect(store.getters['okf/selection']).toMatchObject({ documents: ['f1'] });
    store.dispatch('okf/clearSelection');
    expect(store.getters['okf/selection']).toEqual({ documents: [], crawlSeeds: [], clonedFrom: null });
    store.commit('okf/setError', 'boom');
    expect(store.getters['okf/error']).toBe('boom');
    expect(store.getters['okf/editorSubTab']).toBe('editor');
  });

  it('small mutations no-op safely; metrics merge into an existing row', async () => {
    const store = buildStore({ reposById: { r1: { repo_id: 'r1' } } });
    store.commit('okf/upsertRepo', null);
    store.commit('okf/setCrawlConversion', {});
    store.commit('okf/setRepoMetrics', { repoId: 'r1', metrics: { concepts: 9 } });
    expect(store.state.okf.reposById.r1.metrics).toEqual({ concepts: 9 });
    store.commit('okf/setRepoMetrics', { repoId: 'ghost', metrics: {} });
    expect(store.state.okf.reposById.ghost).toBeUndefined();
    await store.dispatch('okf/setExpertMode', true);
    await store.dispatch('okf/setSelection', { crawlSeeds: ['s1'] });
    expect(store.state.okf.selection.crawlSeeds).toEqual(['s1']);
  });
});
