// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * repository-controller — the call()-wrapped handler surface (David's
 * standing rule, 2026-10-30: coverage must INCREASE with every feature MR).
 * The wave-2c collapse (#78670) left the 38 thin handlers without direct
 * tests — the routes suite drives a handful through supertest and the rest
 * sat uncovered. This drives EVERY wrapper directly with a fake
 * req/res/next: the service call, the status code and next(err) forwarding.
 */
jest.mock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({
    counter: () => ({ add: () => {} }),
    createCounter: () => ({ add: () => {} })
  })
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));
jest.mock('../services/repository-service', () => ({
  getById: jest.fn().mockResolvedValue({ repo_id: 'r1', name: 'R' }),
  create: jest.fn().mockResolvedValue({ repo_id: 'r1' }),
  update: jest.fn().mockResolvedValue({ repo_id: 'r1' }),
  frontmatterHistory: jest.fn().mockResolvedValue({ entries: [] }),
  revertFrontmatter: jest.fn().mockResolvedValue({ ok: true })
}));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/concept-meta-service', () => ({
  __esModule: true,
  default: {
    countByIndexStatus: jest.fn().mockResolvedValue(0),
    getConceptMeta: jest.fn(),
    patchConceptFields: jest.fn().mockResolvedValue({ ok: true })
  },
  countByIndexStatus: jest.fn().mockResolvedValue(0),
  getConceptMeta: jest.fn(),
  patchConceptFields: jest.fn().mockResolvedValue({ ok: true })
}));
jest.mock('../services/conformance-service', () => ({
  getRepoMetrics: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/crawl-conversion-service', () => ({
  startConversion: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/producer-service', () => ({
  startDocumentsConversion: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/type-inference-service', () => ({
  resolveStrategy: jest.fn().mockReturnValue({ strategy: 'heuristics' })
}));
jest.mock('../services/lifecycle-service', () => ({
  assertWritable: jest.fn(),
  transition: jest.fn().mockResolvedValue({ repo_id: 'r1' })
}));
jest.mock('../services/bundle-export-service', () => ({
  slugFor: jest.fn().mockReturnValue('general')
}));
jest.mock('../services/head-test-service', () => ({
  rebuildHead: jest.fn().mockResolvedValue({ score: 1 }),
  routingTest: jest.fn().mockResolvedValue({ verdict: {} }),
  explainRouting: jest.fn().mockResolvedValue({ suggestion: {} }),
  loadSiblings: jest.fn().mockResolvedValue([])
}));
jest.mock('../services/head-suite-service', () => ({
  beginSuiteGeneration: jest.fn().mockResolvedValue({ suite_key: 'sk', done: Promise.resolve() }),
  addQueries: jest.fn().mockResolvedValue({ suite: {} }),
  getSuite: jest.fn().mockResolvedValue({ suite_key: 'sk' }),
  updateSuiteRows: jest.fn().mockResolvedValue({ suite: {} }),
  renameSuite: jest.fn().mockResolvedValue({ suite: {} }),
  deleteSuite: jest.fn().mockResolvedValue({ ok: true }),
  probeSuiteQuery: jest.fn().mockResolvedValue({ verdict: 'answerable' }),
  beginRunSuite: jest.fn().mockResolvedValue({ run_key: 'rk', done: Promise.resolve() }),
  getRunSuite: jest.fn().mockResolvedValue({ status: 'done' }),
  beginExplainFailures: jest.fn().mockResolvedValue({ run_key: 'rk', done: Promise.resolve() }),
  getExplainFailures: jest.fn().mockResolvedValue({ status: 'done' }),
  listRuns: jest.fn().mockResolvedValue([]),
  beginRecommendTagSet: jest.fn().mockResolvedValue({ job_key: 'jk' }),
  getRecommendJob: jest.fn().mockResolvedValue({ status: 'done' })
}));
jest.mock('../services/studio-draft-service', () => ({
  getDraft: jest.fn().mockResolvedValue({ draft: null }),
  saveDraft: jest.fn().mockResolvedValue({ ok: true }),
  clearDraft: jest.fn().mockResolvedValue({ deleted: false })
}));
jest.mock('../services/ragas-suite-service', () => ({
  beginSuiteGeneration: jest.fn().mockResolvedValue({ suite_key: 'sk', done: Promise.resolve() }),
  getSuite: jest.fn().mockResolvedValue({ suite_key: 'sk' }),
  cancelSuiteGeneration: jest.fn().mockResolvedValue({ ok: true }),
  cancelSuiteRun: jest.fn().mockResolvedValue({ ok: true }),
  updateSuiteRows: jest.fn().mockResolvedValue({ suite: {} }),
  addQueries: jest.fn().mockResolvedValue({ suite: {}, added: 1, duplicates_dropped: 0 }),
  renameSuite: jest.fn().mockResolvedValue({ suite: {} }),
  deleteSuite: jest.fn().mockResolvedValue({ ok: true }),
  deleteRun: jest.fn().mockResolvedValue({ ok: true }),
  rescoreRun: jest
    .fn()
    .mockResolvedValue({ run_key: 'rk2', source_run_key: 'rk', status: 'running', done: Promise.resolve() }),
  beginRunSuite: jest.fn().mockResolvedValue({ run_key: 'rk', done: Promise.resolve() }),
  getRunSuite: jest.fn().mockResolvedValue({ status: 'done' }),
  listRuns: jest.fn().mockResolvedValue([]),
  beginExplainFailures: jest.fn().mockResolvedValue({ run_key: 'rk', explain_key: 'ek', done: Promise.resolve() }),
  getExplainFailures: jest.fn().mockResolvedValue({ status: 'done' }),
  probeEntry: jest.fn().mockResolvedValue({ verdict: 'answerable' }),
  exportSuiteXlsx: jest.fn().mockResolvedValue({ body: Buffer.from('x'), filename: 's.xlsx' }),
  importSuiteXlsx: jest.fn().mockResolvedValue({ suite: {} }),
  exportResultsXlsx: jest.fn().mockResolvedValue({ body: Buffer.from('y'), filename: 'r.xlsx' })
}));
jest.mock('../services/validation-service', () => ({
  __esModule: true,
  default: { validate: jest.fn().mockResolvedValue({ issues: [] }) },
  validate: jest.fn().mockResolvedValue({ issues: [] }),
  getValidationReport: jest.fn().mockResolvedValue({ issues: [] }),
  wireCitationHub: jest.fn().mockResolvedValue({ wired: 2, hub_created: true })
}));
jest.mock('../services/topic-link-authoring-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn().mockResolvedValue({ run_key: 'tk' }),
    getRun: jest.fn().mockResolvedValue({ status: 'idle' })
  },
  startRun: jest.fn().mockResolvedValue({ run_key: 'tk' }),
  getRun: jest.fn().mockResolvedValue({ status: 'idle' }),
  startTopicLinkRun: jest.fn().mockResolvedValue({ run_key: 'tk', dry_run: true }),
  getTopicLinkRunState: jest.fn().mockResolvedValue({ status: 'idle' })
}));
jest.mock('../services/llm-curation-service', () => ({
  __esModule: true,
  default: {
    suggestLinks: jest.fn().mockResolvedValue({ suggestions: [] }),
    acceptLink: jest.fn().mockResolvedValue({ ok: true }),
    proposeLinks: jest.fn().mockResolvedValue({ suggestions: [] })
  },
  suggestLinks: jest.fn().mockResolvedValue({ suggestions: [] }),
  acceptLink: jest.fn().mockResolvedValue({ ok: true }),
  proposeLinks: jest.fn().mockResolvedValue({ suggestions: [] })
}));
jest.mock('../services/scope-authz-service', () => ({
  deriveScopeAuthz: jest.fn().mockReturnValue({ isSuperAdmin: true, authorizedRepoIds: new Set() })
}));

const controller = require('../controllers/repository-controller');
const repoService = require('../services/repository-service');
const headTestService = require('../services/head-test-service');
const headSuiteService = require('../services/head-suite-service');
const studioDraftService = require('../services/studio-draft-service');
const ragasSuiteService = require('../services/ragas-suite-service');
const validationService = require('../services/validation-service');
const topicLinks = require('../services/topic-link-authoring-service');
const llmCuration = require('../services/llm-curation-service');

function fakeReq(over = {}) {
  return {
    params: {
      repo_id: 'r1',
      suite_key: 'sk',
      run_key: 'rk',
      job_key: 'jk',
      concept_id: 'c1',
      version: '2',
      saved_at: 'T1',
      ...over.params
    },
    body: over.body || {},
    query: over.query || {},
    headers: over.headers || {},
    okfScopes: over.okfScopes || [],
    okfIsSuperAdmin: true,
    user: { sub: 'u1' }
  };
}

function fakeRes() {
  const res = { statusCode: 0, body: undefined, headers: {} };
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b) => {
    res.body = b;
    return res;
  });
  res.setHeader = jest.fn((k, v) => {
    res.headers[k] = v;
  });
  res.send = jest.fn((b) => {
    res.body = b;
    return res;
  });
  return res;
}

async function drive(handler, over = {}) {
  const req = fakeReq(over);
  const res = fakeRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { req, res, next };
}

describe('repository-controller — head/Lab handlers (call() surface)', () => {
  it('rebuildRepoHead → 200 {ok, repo_id, head}', async () => {
    const { res, next } = await drive(controller.rebuildRepoHead);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, repo_id: 'r1' });
    expect(headTestService.rebuildHead).toHaveBeenCalledWith('r1', expect.anything());
    expect(next).not.toHaveBeenCalled();
  });

  it('routingTest / routingExplain pass the body + admin opts', async () => {
    await drive(controller.routingTest, { body: { query: 'q' } });
    expect(headTestService.routingTest).toHaveBeenCalledWith('r1', { query: 'q' }, expect.anything());
    const { res } = await drive(controller.routingExplain, { body: { query: 'q2' } });
    expect(headTestService.explainRouting).toHaveBeenCalledWith('r1', { query: 'q2' }, expect.anything());
    expect(res.statusCode).toBe(200);
  });

  it('generateTestSuite → 202 generating (done promise detached)', async () => {
    const { res, next } = await drive(controller.generateTestSuite, { body: { n_positive: 3 } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ suite_key: 'sk', status: 'generating' });
    expect(headSuiteService.beginSuiteGeneration).toHaveBeenCalledWith('r1', { n_positive: 3 }, expect.anything());
    expect(next).not.toHaveBeenCalled();
  });

  it('addTestSuiteQueries / getTestSuite / updateTestSuiteRows / renameTestSuite / deleteTestSuite / probeTestSuiteQuery', async () => {
    (await drive(controller.addTestSuiteQueries, { body: { queries: [] } })).res.statusCode === 200 &&
      expect(headSuiteService.addQueries).toHaveBeenCalledWith('r1', 'sk', { queries: [] }, expect.anything());
    expect((await drive(controller.getTestSuite)).res.statusCode).toBe(200);
    expect(headSuiteService.getSuite).toHaveBeenCalledWith('r1', 'sk', expect.anything());
    await drive(controller.updateTestSuiteRows, { body: { removes: [] } });
    expect(headSuiteService.updateSuiteRows).toHaveBeenCalledWith('r1', 'sk', { removes: [] }, expect.anything());
    await drive(controller.renameTestSuite, { body: { name: 'N' } });
    expect(headSuiteService.renameSuite).toHaveBeenCalledWith('r1', 'sk', { name: 'N' }, expect.anything());
    await drive(controller.deleteTestSuite);
    expect(headSuiteService.deleteSuite).toHaveBeenCalledWith('r1', 'sk', expect.anything());
    await drive(controller.probeTestSuiteQuery, { body: { query: 'q' } });
    expect(headSuiteService.probeSuiteQuery).toHaveBeenCalledWith('r1', 'sk', { query: 'q' }, expect.anything());
  });

  it('runTestSuite → 202 running with probe default ON (body probe:false opts out)', async () => {
    const { res } = await drive(controller.runTestSuite, { body: {} });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ run_key: 'rk', status: 'running' });
    expect(headSuiteService.beginRunSuite).toHaveBeenCalledWith('r1', 'sk', expect.objectContaining({ probe: true }));
    await drive(controller.runTestSuite, { body: { probe: false } });
    expect(headSuiteService.beginRunSuite).toHaveBeenLastCalledWith(
      'r1',
      'sk',
      expect.objectContaining({ probe: false })
    );
  });

  it('getTestSuiteRun / explainTestSuiteFailures / getExplainFailures / listTestSuiteRuns', async () => {
    const r1 = await drive(controller.getTestSuiteRun);
    expect(r1.res.statusCode).toBe(200);
    expect(headSuiteService.getRunSuite).toHaveBeenCalledWith('r1', 'sk', 'rk', expect.anything());
    const r2 = await drive(controller.explainTestSuiteFailures);
    expect(r2.res.statusCode).toBe(202);
    expect(headSuiteService.beginExplainFailures).toHaveBeenCalledWith('r1', 'sk', expect.anything());
    const r3 = await drive(controller.getExplainFailures);
    expect(r3.res.statusCode).toBe(200);
    expect(headSuiteService.getExplainFailures).toHaveBeenCalledWith('r1', 'sk', 'rk');
    const r4 = await drive(controller.listTestSuiteRuns, { query: { kind: 'run', limit: '5' } });
    expect(r4.res.body).toEqual({ runs: [] });
    expect(headSuiteService.listRuns).toHaveBeenCalledWith('r1', { kind: 'run', limit: '5' });
  });

  it('recommendTagSet → 202 running; recommendJob reads the job', async () => {
    const { res } = await drive(controller.recommendTagSet, { body: {} });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ repo_id: 'r1', job_key: 'jk', status: 'running' });
    await drive(controller.recommendJob);
    expect(headSuiteService.getRecommendJob).toHaveBeenCalledWith('r1', 'jk');
  });

  it('frontmatterHistory reads; revertFrontmatter validates saved_at before anything else', async () => {
    await drive(controller.frontmatterHistory);
    expect(repoService.frontmatterHistory).toHaveBeenCalledWith('r1', expect.anything());
    await drive(controller.revertFrontmatter, { body: { saved_at: 'T1' } });
    expect(repoService.revertFrontmatter).toHaveBeenCalledWith('r1', 'T1', expect.anything());
    // empty saved_at throws inside the handler — call() forwards to next and
    // never writes the BODY (call sets the status eagerly, before the await;
    // the error middleware owns the final response)
    const { res, next } = await drive(controller.revertFrontmatter, { body: {} });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('studio drafts: get/put/delete', async () => {
    (await drive(controller.getStudioDraft)).res.statusCode === 200 &&
      expect(studioDraftService.getDraft).toHaveBeenCalledWith('r1', expect.anything());
    await drive(controller.putStudioDraft, { body: { step: 3 } });
    expect(studioDraftService.saveDraft).toHaveBeenCalledWith('r1', { step: 3 }, expect.anything());
    await drive(controller.deleteStudioDraft);
    expect(studioDraftService.clearDraft).toHaveBeenCalledWith('r1', expect.anything());
  });
});

describe('repository-controller — RAGAS handlers (call() surface)', () => {
  it('generateRagasSuite / getRagasSuite / cancels', async () => {
    const g = await drive(controller.generateRagasSuite, { body: { testset_size: 10 } });
    expect(g.res.statusCode).toBe(202);
    expect(g.res.body).toEqual({ suite_key: 'sk', status: 'generating' });
    expect(ragasSuiteService.beginSuiteGeneration).toHaveBeenCalledWith('r1', { testset_size: 10 }, expect.anything());
    await drive(controller.getRagasSuite);
    expect(ragasSuiteService.getSuite).toHaveBeenCalledWith('r1', 'sk');
    await drive(controller.cancelRagasSuiteGeneration);
    expect(ragasSuiteService.cancelSuiteGeneration).toHaveBeenCalledWith('r1');
    await drive(controller.cancelRagasSuiteRun);
    expect(ragasSuiteService.cancelSuiteRun).toHaveBeenCalledWith('r1', 'sk', 'rk');
  });

  it('updateRagasSuiteRows / addRagasSuiteQueries (envelope re-shape) / renameRagasSuite / deleteRagasSuite / deleteRagasSuiteRun', async () => {
    await drive(controller.updateRagasSuiteRows, { body: { modifications: [] } });
    expect(ragasSuiteService.updateSuiteRows).toHaveBeenCalledWith(
      'r1',
      'sk',
      { modifications: [] },
      expect.anything()
    );
    const a = await drive(controller.addRagasSuiteQueries, { body: { queries: [{ query: 'q' }] } });
    expect(a.res.body).toEqual({ suite: {}, added: 1, duplicates_dropped: 0 });
    expect(ragasSuiteService.addQueries).toHaveBeenCalledWith(
      'r1',
      'sk',
      { queries: [{ query: 'q' }] },
      expect.anything()
    );
    await drive(controller.renameRagasSuite, { body: { name: 'N' } });
    expect(ragasSuiteService.renameSuite).toHaveBeenCalledWith('r1', 'sk', { name: 'N' }, expect.anything());
    await drive(controller.deleteRagasSuite);
    expect(ragasSuiteService.deleteSuite).toHaveBeenCalledWith('r1', 'sk');
    await drive(controller.deleteRagasSuiteRun);
    expect(ragasSuiteService.deleteRun).toHaveBeenCalledWith('r1', 'sk', 'rk');
  });

  it('rescoreRagasSuiteRun → 202 with source lineage; runRagasSuite → 202 running', async () => {
    const r = await drive(controller.rescoreRagasSuiteRun, { body: { judge_model: 'm' } });
    expect(r.res.statusCode).toBe(202);
    expect(r.res.body).toEqual({ run_key: 'rk2', source_run_key: 'rk', status: 'running' });
    expect(ragasSuiteService.rescoreRun).toHaveBeenCalledWith(
      'r1',
      'sk',
      'rk',
      { judge_model: 'm' },
      expect.anything()
    );
    const run = await drive(controller.runRagasSuite, { body: {} });
    expect(run.res.statusCode).toBe(202);
    expect(ragasSuiteService.beginRunSuite).toHaveBeenCalledWith('r1', 'sk', {}, expect.anything());
  });

  it('getRagasSuiteRun / listRagasSuiteRuns / probeRagasEntry', async () => {
    await drive(controller.getRagasSuiteRun);
    expect(ragasSuiteService.getRunSuite).toHaveBeenCalledWith('r1', 'sk', 'rk');
    const l = await drive(controller.listRagasSuiteRuns, { query: { kind: 'ragas_run' } });
    expect(l.res.body).toEqual({ runs: [] });
    await drive(controller.probeRagasEntry, { body: { id: 'e1' } });
    expect(ragasSuiteService.probeEntry).toHaveBeenCalledWith('r1', 'sk', { id: 'e1' }, expect.anything());
  });

  it('explainRagasFailures → 202 with explain_key; getRagasExplainFailures', async () => {
    const e = await drive(controller.explainRagasFailures, { body: {} });
    expect(e.res.statusCode).toBe(202);
    expect(e.res.body).toEqual({ run_key: 'rk', explain_key: 'ek', status: 'running' });
    await drive(controller.getRagasExplainFailures);
    expect(ragasSuiteService.getExplainFailures).toHaveBeenCalledWith('r1', 'sk', 'rk');
  });

  it('xlsx routes set attachment headers and send bytes', async () => {
    const a = await drive(controller.exportRagasSuiteXlsx);
    expect(a.res.headers['Content-Type']).toContain('spreadsheetml');
    expect(a.res.headers['Content-Disposition']).toContain('s.xlsx');
    const b = await drive(controller.importRagasSuiteXlsx, { body: Buffer.from('zip') });
    expect(b.res.statusCode).toBe(201);
    expect(ragasSuiteService.importSuiteXlsx).toHaveBeenCalledWith('r1', expect.any(Buffer), expect.anything());
    const empty = await drive(controller.importRagasSuiteXlsx, { body: Buffer.alloc(0) });
    expect(empty.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    const c = await drive(controller.exportRagasResultsXlsx, { body: {} });
    expect(c.res.headers['Content-Disposition']).toContain('r.xlsx');
  });
});

describe('repository-controller — validation / citations / topic links', () => {
  it('getRepoValidation reports; wireRepoCitations wires the hub (audited)', async () => {
    const v = await drive(controller.getRepoValidation);
    expect(v.res.statusCode).toBe(200);
    expect(validationService.getValidationReport).toHaveBeenCalledWith('r1');
    const w = await drive(controller.wireRepoCitations, { body: { hub_concept_id: 'hub' } });
    expect(w.res.statusCode).toBe(200);
    expect(w.res.body).toMatchObject({ success: true, wired: 2 });
    expect(validationService.wireCitationHub).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ hub_concept_id: 'hub' })
    );
  });

  it('suggestConceptLinks proposes via llmCuration.proposeLinks', async () => {
    const s = await drive(controller.suggestConceptLinks);
    expect(s.res.statusCode).toBe(200);
    expect(s.res.body).toMatchObject({ success: true });
    expect(llmCuration.proposeLinks).toHaveBeenCalled();
  });

  it('acceptConceptLink appends a frontmatter link through patchConceptFields', async () => {
    const conceptMetaService = require('../services/concept-meta-service');
    conceptMetaService.getConceptMeta.mockImplementation(async (_repo, id) =>
      id === 'c2' ? { concept_id: 'c2', title: 'Target' } : { concept_id: 'c1', frontmatter: {} }
    );
    const a = await drive(controller.acceptConceptLink, { body: { to_concept_id: 'c2', label: 'see' } });
    expect(a.res.statusCode).toBe(200);
    expect(conceptMetaService.patchConceptFields).toHaveBeenCalledWith('r1', 'c1', {
      frontmatterPatch: { links: [{ target: 'c2.md', label: 'see' }] }
    });
    // a duplicate link is a no-op success
    conceptMetaService.getConceptMeta.mockImplementation(async (_repo, id) =>
      id === 'c2'
        ? { concept_id: 'c2', title: 'Target' }
        : { concept_id: 'c1', frontmatter: { links: [{ target: 'c2.md' }] } }
    );
    const dup = await drive(controller.acceptConceptLink, { body: { to_concept_id: 'c2' } });
    expect(dup.res.body).toMatchObject({ success: true, already_linked: true });
    // missing target refuses
    const missing = await drive(controller.acceptConceptLink, { body: {} });
    expect(missing.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('startTopicLinks → 202 detached run; getTopicLinks polls the run state', async () => {
    const t = await drive(controller.startTopicLinks, { body: { dry_run: true } });
    expect(t.res.statusCode).toBe(202);
    expect(topicLinks.startTopicLinkRun).toHaveBeenCalledWith(
      expect.objectContaining({ repo_id: 'r1' }),
      expect.objectContaining({ dryRun: true })
    );
    await drive(controller.getTopicLinks);
    expect(topicLinks.getTopicLinkRunState).toHaveBeenCalledWith(expect.objectContaining({ repo_id: 'r1' }));
  });
});

describe('repository-controller — next(err) forwarding', () => {
  it('a service throw reaches next verbatim (the call() envelope owns this)', async () => {
    const err = new Error('TEI down');
    err.status = 503;
    // Queue the rejection on every plausible binding (raw module AND
    // .default) — whichever object the controller's require resolved to
    // receives it exactly once.
    const mod = require('../services/head-test-service');
    if (mod.rebuildHead && mod.rebuildHead.mockRejectedValueOnce) mod.rebuildHead.mockRejectedValueOnce(err);
    if (mod.default && mod.default.rebuildHead !== mod.rebuildHead) mod.default.rebuildHead.mockRejectedValueOnce(err);
    const { res, next } = await drive(controller.rebuildRepoHead);
    // call() sets the status eagerly, but the BODY is never written on a
    // throw — next(err) carries the response to the error middleware.
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });
});
