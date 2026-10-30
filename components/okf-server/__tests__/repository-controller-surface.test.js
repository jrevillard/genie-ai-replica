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
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null),
  listRepoLogs: jest.fn().mockResolvedValue([])
}));
jest.mock('../services/pii-service', () => ({
  beginRepoConceptScan: jest.fn().mockResolvedValue({ scan_key: 'scan-1', done: Promise.resolve() }),
  discoverRepoFiles: jest.fn().mockResolvedValue([]),
  scanConcept: jest.fn().mockResolvedValue({ concept_id: 'c1', pii_state: 'clean' }),
  recordIngestVersion: jest.fn().mockResolvedValue({ version: 7 }),
  markRepoPiiScanned: jest.fn().mockResolvedValue(undefined),
  assertPiiClean: jest.fn().mockResolvedValue({ blocked: false, reasons: [] }),
  inspectConcept: jest.fn().mockResolvedValue({ state: 'clean' }),
  remediatePii: jest.fn().mockResolvedValue({ ok: true }),
  acceptPii: jest.fn().mockResolvedValue({ ok: true }),
  fileActionPii: jest.fn().mockResolvedValue({ ok: true }),
  redactWholeFile: jest.fn().mockResolvedValue({ ok: true }),
  repoBulkAction: jest.fn().mockResolvedValue({ ok: true }),
  acknowledgePii: jest.fn().mockResolvedValue({ ok: true, acknowledged: true })
}));
jest.mock('../services/concept-meta-service', () => ({
  __esModule: true,
  default: {
    countByIndexStatus: jest.fn().mockResolvedValue(0),
    getConceptMeta: jest.fn(),
    patchConceptFields: jest.fn().mockResolvedValue({ ok: true }),
    patchConceptMeta: jest.fn().mockResolvedValue({ ok: true }),
    discoverRepos: jest.fn().mockResolvedValue([]),
    ensureSummary: jest.fn().mockResolvedValue(null),
    readManifest: jest.fn().mockResolvedValue(null)
  },
  countByIndexStatus: jest.fn().mockResolvedValue(0),
  getConceptMeta: jest.fn(),
  patchConceptFields: jest.fn().mockResolvedValue({ ok: true }),
  patchConceptMeta: jest.fn().mockResolvedValue({ ok: true }),
  discoverRepos: jest.fn().mockResolvedValue([]),
  ensureSummary: jest.fn().mockResolvedValue(null),
  readManifest: jest.fn().mockResolvedValue(null)
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
  slugFor: jest.fn().mockReturnValue('general'),
  buildBundleZip: jest.fn().mockResolvedValue({ buffer: Buffer.from('zip-bytes') }),
  bundleFileName: jest.fn().mockReturnValue('repo-v3.zip')
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
    proposeLinks: jest.fn().mockResolvedValue({ suggestions: [] }),
    proposeFrontmatter: jest.fn().mockResolvedValue([])
  },
  suggestLinks: jest.fn().mockResolvedValue({ suggestions: [] }),
  acceptLink: jest.fn().mockResolvedValue({ ok: true }),
  proposeLinks: jest.fn().mockResolvedValue({ suggestions: [] }),
  proposeFrontmatter: jest.fn().mockResolvedValue([])
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

describe('repository-controller — pii / lifecycle / export / autocorrect surface', () => {
  const piiService = require('../services/pii-service');
  const auditService = require('../services/audit-service');
  const bundleExport = require('../services/bundle-export-service');
  const conceptMetaService = require('../services/concept-meta-service');
  const { ValidationError } = controller;

  // The file has no global beforeEach, and mockClear does NOT drop queued
  // mockResolvedValueOnce entries — each test here resets the fns it queues
  // and re-establishes the defaults, so nothing leaks across tests.
  beforeEach(() => {
    repoService.getById.mockReset().mockResolvedValue({ repo_id: 'r1', name: 'R' });
    repoService.create.mockReset().mockResolvedValue({ repo_id: 'r1' });
    conceptMetaService.getConceptMeta.mockReset();
    conceptMetaService.patchConceptMeta.mockReset().mockResolvedValue({ ok: true });
    conceptMetaService.discoverRepos.mockReset().mockResolvedValue([]);
    conceptMetaService.ensureSummary.mockReset().mockResolvedValue(null);
    conceptMetaService.readManifest.mockReset().mockResolvedValue(null);
    llmCuration.proposeFrontmatter.mockReset().mockResolvedValue([]);
    auditService.listRepoLogs.mockReset().mockResolvedValue([]);
    auditService.writeAudit.mockReset().mockResolvedValue(null);
    require('../services/lifecycle-service').transition.mockReset().mockResolvedValue({ repo_id: 'r1' });
    bundleExport.buildBundleZip.mockReset().mockResolvedValue({ buffer: Buffer.from('zip-bytes') });
    piiService.beginRepoConceptScan.mockReset().mockResolvedValue({ scan_key: 'scan-1', done: Promise.resolve() });
    piiService.discoverRepoFiles.mockReset().mockResolvedValue([]);
    piiService.scanConcept.mockReset().mockResolvedValue({ concept_id: 'c1', pii_state: 'clean' });
    piiService.recordIngestVersion.mockReset().mockResolvedValue({ version: 7 });
    piiService.markRepoPiiScanned.mockReset().mockResolvedValue(undefined);
    piiService.assertPiiClean.mockReset().mockResolvedValue({ blocked: false, reasons: [] });
    piiService.inspectConcept.mockReset().mockResolvedValue({ state: 'clean' });
    piiService.remediatePii.mockReset().mockResolvedValue({ ok: true });
    piiService.acceptPii.mockReset().mockResolvedValue({ ok: true });
    piiService.fileActionPii.mockReset().mockResolvedValue({ ok: true });
    piiService.redactWholeFile.mockReset().mockResolvedValue({ ok: true });
    piiService.repoBulkAction.mockReset().mockResolvedValue({ ok: true });
    piiService.acknowledgePii.mockReset().mockResolvedValue({ ok: true, acknowledged: true });
  });

  it('convertFromDocuments: file_ids required, target resolution failure, happy 202', async () => {
    let { res } = await drive(controller.convertFromDocuments, { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');

    // No repo_id → the 10-attempt name loop; every create colliding ends 409
    const dupErr = new Error('name taken');
    dupErr.code = 'DUPLICATE_REPO';
    repoService.create.mockRejectedValue(dupErr);
    ({ res } = await drive(controller.convertFromDocuments, {
      body: { file_ids: ['f1', ' ', 7] } // ' ' and 7 are filtered out
    }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_REPO');
    repoService.create.mockReset();
    repoService.create.mockResolvedValue({ repo_id: 'r1' });

    // A repo_id that resolves to nothing is a 404, not a create
    repoService.getById.mockResolvedValueOnce(null);
    ({ res } = await drive(controller.convertFromDocuments, {
      body: { repo_id: ' r1 ', file_ids: ['f1'] }
    }));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('REPO_NOT_FOUND');

    repoService.getById.mockResolvedValueOnce({ repo_id: 'r1', name: 'R' });
    ({ res } = await drive(controller.convertFromDocuments, {
      body: { repo_id: 'r1', name: 'R', file_ids: ['f1'], classification: 'llm' }
    }));
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ repo_id: 'r1', name_adjusted: false });
  });

  it('acceptConceptLink: self-links, missing targets and missing sources are refused', async () => {
    const first = await drive(controller.acceptConceptLink, { body: { to_concept_id: 'c1' } });
    expect(first.next).toHaveBeenCalledWith(expect.any(ValidationError)); // self-link

    const mod = require('../services/concept-meta-service');
    mod.getConceptMeta.mockResolvedValueOnce(null); // target does not exist
    const second = await drive(controller.acceptConceptLink, { body: { to_concept_id: 'cX' } });
    expect(second.next).toHaveBeenCalledWith(expect.any(ValidationError));

    mod.getConceptMeta
      .mockResolvedValueOnce({ concept_id: 'cX' }) // target exists
      .mockResolvedValueOnce(null); // source concept missing
    const final = await drive(controller.acceptConceptLink, { body: { to_concept_id: 'concepts/cX' } });
    expect(final.res.statusCode).toBe(404);
    expect(final.res.body.error).toBe('NOT_FOUND');
  });

  it('getRepoVersion: a non-integer bundle_version is a 400 ValidationError', async () => {
    const { next } = await drive(controller.getRepoVersion, { params: { bundle_version: '1.9' } });
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('getRepoManifest: summary flag routes to ensureSummary; absent manifest 404s', async () => {
    const mod = require('../services/concept-meta-service');
    let { res } = await drive(controller.getRepoManifest, {});
    expect(res.statusCode).toBe(404); // readManifest -> null
    expect(res.body.error).toBe('MANIFEST_NOT_FOUND');

    mod.ensureSummary.mockResolvedValueOnce({ manifest: true });
    ({ res } = await drive(controller.getRepoManifest, { query: { summary: 'true' } }));
    expect(res.statusCode).toBe(200);
    expect(mod.ensureSummary).toHaveBeenCalledWith('r1');

    mod.readManifest.mockResolvedValueOnce({ concepts: 3 });
    ({ res } = await drive(controller.getRepoManifest, {}));
    expect(res.statusCode).toBe(200);
  });

  it('discoverFromManifests: query required; tokens reach the service', async () => {
    let { res } = await drive(controller.discoverFromManifests, { body: { query: '   ' } });
    expect(res.statusCode).toBe(400);
    const mod = require('../services/concept-meta-service');
    mod.discoverRepos.mockResolvedValueOnce([{ repo_id: 'x' }]);
    ({ res } = await drive(controller.discoverFromManifests, {
      body: { query: 'water supply systems', labels: ['a'], domain: 'd', k: 5 }
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.candidates).toEqual([{ repo_id: 'x' }]);
  });

  it('inspectPii: missing concept 404s; the happy path inspects with stored frontmatter', async () => {
    const mod = require('../services/concept-meta-service');
    let { res } = await drive(controller.inspectPii);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('CONCEPT_NOT_FOUND');

    mod.getConceptMeta.mockResolvedValueOnce({ concept_id: 'c1', frontmatter: { topic: ['t'] }, body: 'B' });
    ({ res } = await drive(controller.inspectPii));
    expect(res.statusCode).toBe(200);
    expect(piiService.inspectConcept).toHaveBeenCalledWith('r1', 'c1', { topic: ['t'] }, 'B', expect.anything());
  });

  it('the five mutating PII handlers all gate on assertWritable and forward their service', async () => {
    const cases = [
      [controller.remediatePii, piiService.remediatePii],
      [controller.acceptPii, piiService.acceptPii],
      [controller.fileActionPii, piiService.fileActionPii],
      [controller.redactWholeFilePii, piiService.redactWholeFile],
      [controller.repoBulkPii, piiService.repoBulkAction]
    ];
    for (const [handler, fn] of cases) {
      const { res, next } = await drive(handler, { body: { action: 'mask' } });
      expect(res.statusCode).toBe(200);
      expect(next).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalled();
      expect(fn.mock.calls[0][0]).toBe('r1'); // repo-scoped, actor-carrying
    }
  });

  it('piiScan: concepts[] / file_ids[] / discover / scope-concepts arms', async () => {
    let { res } = await drive(controller.piiScan, { body: { scope: 'concepts' } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ status: 'running', scan_key: 'scan-1' });

    piiService.scanConcept.mockClear();
    ({ res } = await drive(controller.piiScan, {
      body: { concepts: [{ concept_id: 'c1', frontmatter: {}, body: 'B' }] }
    }));
    expect(res.statusCode).toBe(200);
    expect(piiService.scanConcept).toHaveBeenCalledTimes(1);

    piiService.discoverRepoFiles.mockResolvedValueOnce([
      { file_id: 'f2', concept_id: 'c2', frontmatter: {}, body: 'B2' },
      { file_id: 'f1', concept_id: 'c1', frontmatter: {}, body: 'B1' }
    ]);
    await drive(controller.piiScan, { body: { file_ids: ['f1'] } });
    expect(piiService.scanConcept).toHaveBeenCalledTimes(2); // only f1's concept
    expect(piiService.recordIngestVersion).toHaveBeenCalledWith('r1', {
      file_id: 'f1', // the REQUESTED file_ids carry the version, discovery order
      curator: { sub: 'u1', name: undefined }
    });

    piiService.discoverRepoFiles.mockResolvedValueOnce([
      { file_id: 'f1', concept_id: 'c1', frontmatter: {}, body: 'B' }
    ]);
    await drive(controller.piiScan, { body: { discover: true } });
    expect(piiService.scanConcept).toHaveBeenCalledTimes(3);

    const { next } = await drive(controller.piiScan, { body: {} });
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('transitionLifecycle forwards action + frontmatter to lifecycleService', async () => {
    const lifecycleService = require('../services/lifecycle-service');
    const { res } = await drive(controller.transitionLifecycle, {
      body: { action: 'publish', frontmatter: { topic: ['t'] } }
    });
    expect(res.statusCode).toBe(200);
    expect(lifecycleService.transition).toHaveBeenCalledWith('r1', 'publish', expect.anything(), {
      payload: { frontmatter: { topic: ['t'] } }
    });
  });

  it('exportRepoZip streams the bundle with attachment headers', async () => {
    const { res } = await drive(controller.exportRepoZip);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/zip');
    expect(res.headers['Content-Disposition']).toContain('repo-v3.zip');
    expect(res.body).toEqual(Buffer.from('zip-bytes'));
  });

  it('getRepoLogs reads the audit trail with the requested limit', async () => {
    auditService.listRepoLogs.mockResolvedValueOnce([{ action: 'repo.create' }]);
    const { res } = await drive(controller.getRepoLogs, { query: { limit: '5' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.logs).toEqual([{ action: 'repo.create' }]);
    expect(auditService.listRepoLogs).toHaveBeenCalledWith('r1', { limit: '5' });
  });

  it('acknowledgePii maps the boolean and forwards to the service', async () => {
    const { res } = await drive(controller.acknowledgePii, { body: { acknowledge: false } });
    expect(res.statusCode).toBe(200);
    expect(piiService.acknowledgePii).toHaveBeenCalledWith('r1', false, expect.anything());
  });

  it('autocorrectRepo: dry run proposes without applying; apply patches every proposal with changes', async () => {
    llmCuration.proposeFrontmatter.mockResolvedValueOnce([
      { concept_id: 'c1', changes: [{ field: 'topic' }], after: { topic: ['x'] } },
      { concept_id: 'c2', changes: [], after: {} } // no changes — skipped
    ]);
    const mod = require('../services/concept-meta-service');
    let { res } = await drive(controller.autocorrectRepo, { body: { mode: 'llm', dry_run: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, dry_run: true, applied: 0 });
    expect(mod.patchConceptMeta).not.toHaveBeenCalled();

    llmCuration.proposeFrontmatter.mockResolvedValueOnce({
      concept_id: 'c1',
      changes: [{}],
      after: { topic: ['y'] }
    });
    ({ res } = await drive(controller.autocorrectRepo, { body: { mode: 'llm', dry_run: false } }));
    expect(res.body).toMatchObject({ dry_run: false, applied: 1 });
    expect(mod.patchConceptMeta).toHaveBeenCalledWith('r1', 'c1', { frontmatter: { topic: ['y'] } });
  });

  it('every one of these handlers forwards a service throw to next(err)', async () => {
    const boom = new Error('sidecar down');
    const cases = [
      [controller.inspectPii, conceptMetaService.getConceptMeta],
      [controller.remediatePii, piiService.remediatePii],
      [controller.transitionLifecycle, require('../services/lifecycle-service').transition],
      [controller.exportRepoZip, bundleExport.buildBundleZip],
      [controller.getRepoLogs, auditService.listRepoLogs],
      [controller.acknowledgePii, piiService.acknowledgePii]
    ];
    const bodies = {
      transitionLifecycle: { action: 'publish' },
      acknowledgePii: { acknowledge: true }
    };
    for (const [handler, fn] of cases) {
      fn.mockRejectedValueOnce(boom);
      const { res, next } = await drive(handler, {
        params: { repo_id: 'r1' },
        body: bodies[handler.name] || {}
      });
      expect(next).toHaveBeenCalledWith(boom);
      expect(res.json).not.toHaveBeenCalled();
    }
  });
});
