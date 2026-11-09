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
  list: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
  create: jest.fn().mockResolvedValue({ repo_id: 'r1' }),
  update: jest.fn().mockResolvedValue({ repo_id: 'r1' }),
  remove: jest.fn().mockResolvedValue({ repo_id: 'r1', status: 'deleted', deletion_reason: null }),
  frontmatterHistory: jest.fn().mockResolvedValue({ entries: [] }),
  revertFrontmatter: jest.fn().mockResolvedValue({ ok: true }),
  // CAP-2 fence: the controller destructures RepoError from this module to
  // mirror getById's denial byte-for-byte (real export: repository-service:1050).
  RepoError: class RepoError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
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
jest.mock('../services/concept-meta-service', () => {
  const base = {
    countByIndexStatus: jest.fn().mockResolvedValue(0),
    getConceptMeta: jest.fn(),
    patchConceptFields: jest.fn().mockResolvedValue({ ok: true }),
    patchConceptMeta: jest.fn().mockResolvedValue({ ok: true }),
    discoverRepos: jest.fn().mockResolvedValue([]),
    ensureSummary: jest.fn().mockResolvedValue(null),
    readManifest: jest.fn().mockResolvedValue(null),
    // CAP-2 fence suite drives these read paths directly.
    listConceptsMeta: jest.fn().mockResolvedValue([]),
    getRepoLinks: jest.fn().mockResolvedValue([]),
    // W9 tree index (the citizen browse).
    listConceptTree: jest.fn().mockResolvedValue({ total: 0, offset: 0, limit: 200, concepts: [] })
  };
  return { __esModule: true, default: base, ...base };
});
jest.mock('../services/conformance-service', () => ({
  getRepoMetrics: jest.fn().mockResolvedValue({}),
  getDebtByRepos: jest.fn().mockResolvedValue([])
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
jest.mock('../services/scope-authz-service', () => {
  // The suite's standing assumption: every driven caller is privileged. The
  // CAP-2 fence delegates the SCOPE GRAMMAR (parseOkfScope/LEVEL_SATISFIES)
  // to the real module via access-control-service — keep those real — and
  // reads authorizedRepoIds === null as privilege, so the mock must mirror
  // the real derivation's SHAPE (null when superadmin, else the scope set)
  // or the privileged fence case would fence the superadmin.
  const real = jest.requireActual('../services/scope-authz-service');
  return {
    ...real,
    // Delegate to the REAL derivation: it is a pure scope-grammar parse, and
    // the publication-gate steward check (W2 security review) needs
    // scope-bearing callers to land in authorizedRepoIds — a scope-ignoring
    // stub would classify a scoped steward as a citizen.
    deriveScopeAuthz: jest.fn((okfScopes, isSuperAdmin) => real.deriveScopeAuthz(okfScopes, isSuperAdmin))
  };
});

const controller = require('../controllers/repository-controller');
const repoService = require('../services/repository-service');
const conformanceService = require('../services/conformance-service');
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
    // Default TRUE preserves every pre-fence test's privileged caller; the
    // CAP-2 fence tests below pass explicit false to exercise the gate.
    okfIsSuperAdmin: over.okfIsSuperAdmin !== undefined ? over.okfIsSuperAdmin : true,
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

  it('convertFromDocuments: repo_id path NEVER reports name_adjusted — nothing is renamed (round 20, #80807)', async () => {
    // The existing repo keeps its own name; body.name differs from it but is
    // ignored for targeting. The old `repo.name !== baseName` comparison read
    // that difference as a rename and reported name_adjusted: true — a lie,
    // since only the create-path suffix loop can rename.
    repoService.getById.mockReset();
    repoService.getById.mockResolvedValue({ repo_id: 'r1', name: 'Existing Name' });
    const { res } = await drive(controller.convertFromDocuments, {
      body: { repo_id: 'r1', name: 'A Totally Different Name', file_ids: ['f1'] }
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ repo_id: 'r1', name: 'Existing Name', name_adjusted: false });
    expect(repoService.create).not.toHaveBeenCalled();
  });

  // Round 21 (#80915): the CRAWL endpoint's repo_id path had no test — the
  // documents one covered convertFromDocuments only. Same lie the old code
  // told: a differing body.name on an existing repo must NOT read as a
  // rename (name_adjusted true). This fails on the pre-#80807 code.
  it('convertFromCrawl: repo_id path NEVER reports name_adjusted — nothing is renamed (#80915)', async () => {
    repoService.getById.mockReset();
    repoService.getById.mockResolvedValue({ repo_id: 'r1', name: 'Existing Name' });
    const { res } = await drive(controller.convertFromCrawl, {
      body: { repo_id: 'r1', name: 'A Totally Different Name', file_id: 'f1', split_mode: 'B' }
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ repo_id: 'r1', name: 'Existing Name', name_adjusted: false });
    expect(repoService.create).not.toHaveBeenCalled();
    expect(require('../services/crawl-conversion-service').startConversion).toHaveBeenCalledWith(
      expect.objectContaining({ repo_id: 'r1', file_id: 'f1', split_mode: 'B' })
    );
  });

  // Issue #1190: on the CREATE path the crawl endpoint applies the slug SSOT
  // (nameFromSource) to the raw intent the frontend now sends — a client-side
  // slugging regression (raw filename/URL stored as the repo name) must ship
  // red. A non-string name falls back to the safe default, never String()
  // coercion ('[object Object]').
  it('convertFromCrawl create path derives the repo name via nameFromSource (#1190)', async () => {
    repoService.create.mockReset().mockResolvedValue({ repo_id: 'r1' });
    const { res } = await drive(controller.convertFromCrawl, {
      body: { file_id: 'f1', split_mode: 'B', name: 'https://www.example.com/Kenya Health.md' }
    });
    expect(res.statusCode).toBe(202);
    expect(repoService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'example-com-kenya-health' }),
      expect.anything(),
      expect.anything()
    );
    expect(require('../services/crawl-conversion-service').startConversion).toHaveBeenCalledWith(
      expect.objectContaining({ requested_name: 'example-com-kenya-health' })
    );
  });

  it('convertFromCrawl: a non-string name falls back to the default, never String() coercion (#1190)', async () => {
    repoService.create.mockReset().mockResolvedValue({ repo_id: 'r1' });
    await drive(controller.convertFromCrawl, { body: { file_id: 'f1', split_mode: 'B', name: {} } });
    expect(repoService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'crawled-repository' }),
      expect.anything(),
      expect.anything()
    );
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
    const mod = require('../services/concept-meta-service');
    mod.patchConceptFields.mockClear();
    mod.patchConceptMeta.mockClear();
    llmCuration.proposeFrontmatter.mockResolvedValueOnce([
      { concept_id: 'c1', changes: [{ field: 'topic' }], after: { topic: ['x'] } },
      { concept_id: 'c2', changes: [], after: {} } // no changes — skipped
    ]);
    let { res } = await drive(controller.autocorrectRepo, { body: { mode: 'llm', dry_run: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, dry_run: true, applied: 0 });
    expect(mod.patchConceptFields).not.toHaveBeenCalled();

    llmCuration.proposeFrontmatter.mockResolvedValueOnce({
      concept_id: 'c1',
      changes: [{}],
      after: { topic: ['y'] }
    });
    ({ res } = await drive(controller.autocorrectRepo, { body: { mode: 'llm', dry_run: false } }));
    expect(res.body).toMatchObject({ dry_run: false, applied: 1 });
    // The apply must merge frontmatter (patchConceptFields) — NOT hand the
    // proposal to patchConceptMeta, which treats its argument as a FULL
    // parsed concept and would blank the concept's markdown body.
    expect(mod.patchConceptFields).toHaveBeenCalledWith('r1', 'c1', {
      frontmatterPatch: { topic: ['y'] }
    });
    expect(mod.patchConceptMeta).not.toHaveBeenCalled();
  });

  it('deleteRepo → 202 and passes the optional body reason through (W8 deletion_reason)', async () => {
    const { res, next } = await drive(controller.deleteRepo, { body: { reason: 'gdpr erasure request' } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ status: 'deleted' });
    expect(repoService.remove).toHaveBeenCalledWith('r1', expect.anything(), { reason: 'gdpr erasure request' });
    expect(next).not.toHaveBeenCalled();
    // No body → reason undefined, the call shape stays the three-arg one.
    const second = await drive(controller.deleteRepo);
    expect(second.res.statusCode).toBe(202);
    expect(repoService.remove).toHaveBeenLastCalledWith('r1', expect.anything(), { reason: undefined });
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

// ===========================================================================
// CAP-2 (chat-source resolution) — the 6-1c restricted-repo READ fence on the
// concept-content read family. resolveGraphSet has fenced RESTRICTED repos
// from non-privileged callers since 6-1c (callerMayTraverseRepo); these read
// routes must not serve what retrieval refuses. Denial = getById's exact
// shape (RepoError REPO_NOT_FOUND 404 + audit) so foreign and fenced stay
// indistinguishable (anti-enumeration).
// ===========================================================================
describe('repository-controller — CAP-2 restricted-repo read fence', () => {
  const conceptMetaService = require('../services/concept-meta-service');
  const auditService = require('../services/audit-service');
  const RESTRICTED = { repo_id: 'r1', name: 'R', acl: { restricted: true, required_scopes: ['okf:t:dom:admin'] } };
  // no acl → never restricted; a SERVING repo is published AND ingested —
  // the CAP-2 serving-read surface serves only the retrieval-serving state.
  const OPEN_REPO = { repo_id: 'r1', name: 'R', lifecycle_state: 'publish', ingested_at: '2026-11-04T00:00:00Z' };

  const cases = (handler, svcFn, svcResult) => {
    return [
      () => {
        // fenced: scopeless non-privileged caller on a RESTRICTED repo → 404 + audit
        repoService.getById.mockResolvedValueOnce(RESTRICTED);
        if (svcFn) svcFn.mockResolvedValueOnce(svcResult);
        return drive(handler, { okfIsSuperAdmin: false, okfScopes: [] });
      },
      () => {
        // granted: exact-repo read scope on the same RESTRICTED repo → served
        repoService.getById.mockResolvedValueOnce(RESTRICTED);
        if (svcFn) svcFn.mockResolvedValueOnce(svcResult);
        return drive(handler, { okfIsSuperAdmin: false, okfScopes: ['okf:t:r1:read'] });
      },
      () => {
        // privileged: superadmin passes without any scope
        repoService.getById.mockResolvedValueOnce(RESTRICTED);
        if (svcFn) svcFn.mockResolvedValueOnce(svcResult);
        return drive(handler, { okfIsSuperAdmin: true, okfScopes: [] });
      },
      () => {
        // unchanged: scopeless caller on a NEVER-restricted repo (the default-open base)
        repoService.getById.mockResolvedValueOnce(OPEN_REPO);
        if (svcFn) svcFn.mockResolvedValueOnce(svcResult);
        return drive(handler, { okfIsSuperAdmin: false, okfScopes: [] });
      }
    ];
  };

  it('getConcept: fenced caller 404s with the getById denial shape + audit; granted/privileged/unrestricted pass', async () => {
    conceptMetaService.getConceptMeta.mockResolvedValue({ concept_id: 'c1', body: '# hi' });
    const [fenced, granted, privileged, base] = cases(controller.getConcept, conceptMetaService.getConceptMeta, {
      concept_id: 'c1'
    });

    const deny = await fenced();
    expect(deny.next).toHaveBeenCalled();
    expect(deny.next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    expect(deny.next.mock.calls[0][0].status).toBe(404);
    expect(deny.res.json).not.toHaveBeenCalled();
    expect(auditService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.denied.repo', repo_id: 'r1' })
    );

    for (const run of [granted, privileged, base]) {
      const { res, next } = await run();
      expect(res.statusCode).toBe(200);
      expect(next).not.toHaveBeenCalled();
    }
    expect(conceptMetaService.getConceptMeta).toHaveBeenCalledWith('r1', 'c1');
  });

  it('listConcepts: fenced caller 404s — the index must not leak a fenced repo', async () => {
    const [fenced, , , base] = cases(controller.listConcepts, conceptMetaService.listConceptsMeta, []);

    const deny = await fenced();
    expect(deny.next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    expect(conceptMetaService.listConceptsMeta).not.toHaveBeenCalled();

    const { res } = await base();
    expect(res.statusCode).toBe(200);
  });

  it('getRepoManifest: fenced caller 404s — the manifest names every concept', async () => {
    const [fenced, , , base] = cases(controller.getRepoManifest, conceptMetaService.readManifest, { concepts: [] });

    const deny = await fenced();
    expect(deny.next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');

    const { res } = await base();
    expect(res.statusCode).toBe(200);
  });

  it('getRepoLinks: fenced caller 404s — the projection exposes repo structure', async () => {
    const [fenced, , , base] = cases(controller.getRepoLinks, conceptMetaService.getRepoLinks, []);

    const deny = await fenced();
    expect(deny.next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');

    const { res } = await base();
    expect(res.statusCode).toBe(200);
  });

  it('the concept read family never touches the internal shared secret (CAP-2 hard rule)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'repository-controller.js'), 'utf8');
    expect(src).not.toContain('x-okf-internal-secret');
    expect(src).not.toContain('internal.secret');
  });
});

// ===========================================================================
// CAP-2 additive grants (review fix 2026-11-07): in OPEN mode (the default)
// the serving read bases EVERY caller on the full serving set — grants are
// ADDITIVE and never remove the public repos (the resolveGraphSet base rule;
// its own comment records the exact-list-in-open-mode first cut as the bug
// "caught in review against the product model"). The getById mock here
// MIRRORS the real authz filter (a Set 404s repos outside it) so the
// verdict's SHAPE is exercised: under the first cut these cases 404'd.
// ===========================================================================
describe('repository-controller — CAP-2 additive grants on the serving read', () => {
  const OPEN_REPO = { repo_id: 'r1', name: 'R', lifecycle_state: 'publish', ingested_at: '2026-11-04T00:00:00Z' };
  const { RepoError } = require('../services/repository-service');

  beforeEach(() => {
    // Mirror the real getById authz filter (repository-service: outsideAuthz
    // → REPO_NOT_FOUND 404). Without this mirror the exact-Set bug was
    // invisible: a plain mockResolvedValue served every repo regardless of
    // the verdict the controller computed.
    repoService.getById.mockImplementation((repoId, opts = {}) => {
      if (opts && opts.authz instanceof Set && !opts.authz.has(repoId)) {
        return Promise.reject(new RepoError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404));
      }
      return Promise.resolve(OPEN_REPO);
    });
  });

  it('open mode: a scoped, non-privileged caller reads an open repo card — the verdict rides to getById as null', async () => {
    const { res, next } = await drive(controller.getConcept, {
      okfIsSuperAdmin: false,
      okfScopes: ['okf:t:other:read']
    });
    expect(res.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
    // THE assertion: under the first cut this call carried Set{'other'} and
    // the authz-aware mirror 404'd r1 (a single grant stripped every open
    // repo's citation cards). Additive grants ⇒ null.
    expect(repoService.getById).toHaveBeenCalledWith('r1', expect.objectContaining({ authz: null }));
  });

  it('open mode: the scoped caller gets the CITIZEN card (scope names another repo — not steward)', async () => {
    const conceptMetaService = require('../services/concept-meta-service');
    conceptMetaService.getConceptMeta.mockResolvedValueOnce({
      concept_id: 'c1',
      title: 'C1',
      body: '# hi',
      pii_scan_error: 'internal-only',
      last_worker_error: 'internal-only',
      sources: [{ kind: 'doc-repo', file_id: 'f1', file_name: 'a.pdf', internal_note: 'drop-me' }, { kind: 'doc-repo' }]
    });
    const { res } = await drive(controller.getConcept, { okfIsSuperAdmin: false, okfScopes: ['okf:t:other:read'] });
    expect(res.statusCode).toBe(200);
    expect(res.body.concept_id).toBe('c1');
    expect(res.body.pii_scan_error).toBeUndefined();
    expect(res.body.last_worker_error).toBeUndefined();
    expect(res.body.max_doc_chars).toBeUndefined();
    // sources narrowed: the entry lacking both file_id and resource is dropped
    expect(res.body.sources).toEqual([{ kind: 'doc-repo', file_id: 'f1', file_name: 'a.pdf' }]);
  });

  it('closed mode: the exact list still governs — a caller scoped elsewhere is 404 on this repo', async () => {
    const prev = process.env.OKF_SCOPE_MODE;
    process.env.OKF_SCOPE_MODE = 'closed';
    try {
      const { next } = await drive(controller.getConcept, {
        okfIsSuperAdmin: false,
        okfScopes: ['okf:t:other:read']
      });
      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
      expect(next.mock.calls[0][0].status).toBe(404);
    } finally {
      if (prev === undefined) delete process.env.OKF_SCOPE_MODE;
      else process.env.OKF_SCOPE_MODE = prev;
    }
  });
});

// ===========================================================================
// W2 security review (2026-11-04) — the CAP-2 citizen content path serves
// ONLY what retrieval serves. Two gates beyond the restricted fence:
// (1) publication gate — non-steward callers get the servingRepos predicate
//     (lifecycle_state==='publish' && ingested_at != null); retracted keeps
//     meta rows, drafts carry bodies from import time, publish-to-drain has
//     a window — none may serve a citizen. Same 404 envelope as the fence,
//     but NO audit row (normal lifecycle traffic, not an authz denial).
//     Stewards (superadmin / wildcard / this repo's scope) keep the editor
//     contract — the draft/retracted row IS their working set.
// (2) field projection — non-steward callers get the CAP-3 card contract
//     (identity + title/labels/summary/body/links), never worker internals,
//     curation provenance, Arango system fields, or sources[] (stays
//     steward-only until W5 delivers it behind the W4 serve-refusal gate).
// ===========================================================================
describe('repository-controller — CAP-2 publication gate + card projection (W2 security review)', () => {
  const conceptMetaService = require('../services/concept-meta-service');
  const auditService = require('../services/audit-service');
  // W8 ceiling × CSR batch composition: the steward row carries the ceiling
  // field (the editor's "advise the curator" number); the citizen card does not.
  const { maxConceptDocChars } = require('../services/concept-ceiling');

  const FULL_ROW = {
    repo_id: 'r1',
    concept_id: 'c1',
    graph_name: 'OKF_r1',
    bundle_version: 3,
    title: 'Concept One',
    labels: ['tax.a'],
    summary: 's',
    body: '# body',
    links: [{ target: 'c2' }],
    // everything below must NOT reach a citizen
    path: 'dir/c1.md',
    curation: { by: 'steward' },
    sources: [{ kind: 'crawl', resource: 'x', file_id: 'f9' }],
    pii_state: 'error',
    pii_hits_summary: { DATE_TIME: 2 },
    pii_scan_error: { message: 'scan failed' },
    index_status: 'error',
    last_error: 'axios boom http://dataprep:5000/ingest',
    last_worker_error: 'Internal Server Error',
    ingest_attempts: 7,
    worker_claimed_at: '2026-11-04T00:00:00Z',
    next_attempt_after: '2026-11-04T01:00:00Z',
    content_hash: 'h',
    ingest_labels: ['x'],
    trust_tier: 'gold',
    _key: 'k',
    _id: 'okf_concepts_meta/k',
    _rev: 'r'
  };

  const servingRepo = (over = {}) => ({
    repo_id: 'r1',
    name: 'R',
    lifecycle_state: 'publish',
    ingested_at: '2026-11-04T00:00:00Z',
    ...over
  });

  beforeEach(() => {
    conceptMetaService.getConceptMeta.mockReset();
    conceptMetaService.getConceptMeta.mockResolvedValue({ ...FULL_ROW });
    auditService.writeAudit.mockClear();
  });

  it('citizen + serving repo → 200 card contract: card fields + narrowed sources, no worker/PII/system fields', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo());
    const { res, next } = await drive(controller.getConcept, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    // CAP-4 (W5): sources ride narrowed to {kind, file_id, file_name, resource}
    // — the D4 serve gate refuses restricted bytes, so naming them is safe.
    expect(res.body).toEqual({
      repo_id: 'r1',
      concept_id: 'c1',
      graph_name: 'OKF_r1',
      bundle_version: 3,
      title: 'Concept One',
      labels: ['tax.a'],
      summary: 's',
      body: '# body',
      links: [{ target: 'c2' }],
      sources: [{ kind: 'crawl', file_id: 'f9', resource: 'x' }]
    });
  });

  it('sources entries with NEITHER file_id nor resource are dropped, not leaked', async () => {
    conceptMetaService.getConceptMeta.mockResolvedValue({
      ...FULL_ROW,
      sources: [
        { kind: 'document', file_id: 'keep-1', file_name: 'a.pdf' },
        { kind: 'mystery' },
        'garbage-string',
        null
      ]
    });
    repoService.getById.mockResolvedValueOnce(servingRepo());
    const { res } = await drive(controller.getConcept, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.body.sources).toEqual([{ kind: 'document', file_id: 'keep-1', file_name: 'a.pdf' }]);
  });

  it('an absent sources field stays absent (bundle-import/scratch rows render no affordance)', async () => {
    conceptMetaService.getConceptMeta.mockResolvedValue({ ...FULL_ROW, sources: undefined });
    repoService.getById.mockResolvedValueOnce(servingRepo());
    const { res } = await drive(controller.getConcept, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.body.sources).toBeUndefined();
  });

  it.each([
    ['retracted', { lifecycle_state: 'retracted' }],
    ['draft (never published)', { lifecycle_state: 'draft' }],
    ['published but not yet drained', { lifecycle_state: 'publish', ingested_at: null }]
  ])('citizen + %s repo → 404 REPO_NOT_FOUND, silent (no audit)', async (_label, over) => {
    repoService.getById.mockResolvedValueOnce(servingRepo(over));
    const { res, next } = await drive(controller.getConcept, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    expect(next.mock.calls[0][0].status).toBe(404);
    expect(auditService.writeAudit).not.toHaveBeenCalled();
    expect(conceptMetaService.getConceptMeta).not.toHaveBeenCalled();
  });

  it('superadmin + retracted repo → 200 FULL row + ceiling (steward editor contract intact)', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo({ lifecycle_state: 'retracted' }));
    const { res, next } = await drive(controller.getConcept, { okfIsSuperAdmin: true, okfScopes: [] });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...FULL_ROW, max_doc_chars: maxConceptDocChars() });
  });

  it('scoped steward + draft repo → 200 FULL row + ceiling (the editor working set)', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo({ lifecycle_state: 'draft' }));
    const { res, next } = await drive(controller.getConcept, {
      okfIsSuperAdmin: false,
      okfScopes: ['okf:t:r1:read']
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...FULL_ROW, max_doc_chars: maxConceptDocChars() });
  });

  it('citizen + serving repo the caller is NOT scoped to → still the projected card (scope names restrict, not widen)', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo());
    const { res } = await drive(controller.getConcept, {
      okfIsSuperAdmin: false,
      okfScopes: ['okf:t:other-repo:read']
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.body).toBe('# body');
    expect(res.body.last_error).toBeUndefined();
  });
});

// ===========================================================================
// W9 (concept tree browse, 2026-11-08): the paginated tree INDEX composes
// the SAME serving gates as getConcept — readAuthzForService (additive
// open-mode verdict) + the 6-1c restricted fence (404 + audit) + the
// publication gate (citizen = publish+ingested only, same 404 envelope, NO
// audit). Mirrors the CAP-2 fence cases above, per the spec's "per the
// CAP-2 precedents".
// ===========================================================================
describe('repository-controller — W9 getConceptTree serving gates', () => {
  const conceptMetaService = require('../services/concept-meta-service');
  const auditService = require('../services/audit-service');
  const RESTRICTED = { repo_id: 'r1', name: 'R', acl: { restricted: true, required_scopes: ['okf:t:dom:admin'] } };
  const servingRepo = (over = {}) => ({
    repo_id: 'r1',
    name: 'R',
    lifecycle_state: 'publish',
    ingested_at: '2026-11-04T00:00:00Z',
    ...over
  });
  const PAGE = { total: 2, offset: 0, limit: 200, concepts: [{ concept_id: 'c1', title: 'T', links: ['c2'] }] };

  beforeEach(() => {
    conceptMetaService.listConceptTree.mockReset();
    conceptMetaService.listConceptTree.mockResolvedValue({ ...PAGE });
    auditService.writeAudit.mockClear();
  });

  it('fenced caller 404s with the getById denial shape + audit; the index never runs', async () => {
    repoService.getById.mockResolvedValueOnce(RESTRICTED);
    const { res, next } = await drive(controller.getConceptTree, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    expect(next.mock.calls[0][0].status).toBe(404);
    expect(auditService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.denied.repo', repo_id: 'r1' })
    );
    expect(conceptMetaService.listConceptTree).not.toHaveBeenCalled();
  });

  it('granted / privileged / open-repo callers pass — the index rides the query limit/offset', async () => {
    const cases = [
      () => {
        repoService.getById.mockResolvedValueOnce(RESTRICTED);
        return drive(controller.getConceptTree, { okfIsSuperAdmin: false, okfScopes: ['okf:t:r1:read'] });
      },
      () => {
        repoService.getById.mockResolvedValueOnce(RESTRICTED);
        return drive(controller.getConceptTree, { okfIsSuperAdmin: true, okfScopes: [] });
      },
      () => {
        repoService.getById.mockResolvedValueOnce(servingRepo());
        return drive(controller.getConceptTree, { okfIsSuperAdmin: false, okfScopes: [] });
      }
    ];
    for (const run of cases) {
      const { res, next } = await run();
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(PAGE);
    }
    expect(conceptMetaService.listConceptTree).toHaveBeenLastCalledWith('r1', { limit: undefined, offset: undefined });
  });

  it.each([
    ['retracted', { lifecycle_state: 'retracted' }],
    ['draft (never published)', { lifecycle_state: 'draft' }],
    ['published but not yet drained', { lifecycle_state: 'publish', ingested_at: null }]
  ])('citizen + %s repo → 404 REPO_NOT_FOUND, silent (no audit), index never runs', async (_label, over) => {
    repoService.getById.mockResolvedValueOnce(servingRepo(over));
    const { res, next } = await drive(controller.getConceptTree, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    expect(next.mock.calls[0][0].status).toBe(404);
    expect(auditService.writeAudit).not.toHaveBeenCalled();
    expect(conceptMetaService.listConceptTree).not.toHaveBeenCalled();
  });

  it('steward + draft repo → 200 (the editor contract — a steward may browse a draft)', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo({ lifecycle_state: 'draft' }));
    const { res, next } = await drive(controller.getConceptTree, {
      okfIsSuperAdmin: false,
      okfScopes: ['okf:t:r1:read']
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('closed mode: the exact list still governs — a caller scoped elsewhere is 404', async () => {
    const prev = process.env.OKF_SCOPE_MODE;
    process.env.OKF_SCOPE_MODE = 'closed';
    try {
      repoService.getById.mockImplementation(async (repoId, opts = {}) => {
        if (opts && opts.authz instanceof Set && !opts.authz.has(repoId)) {
          const { RepoError: E } = require('../services/repository-service');
          throw new E('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
        }
        return servingRepo();
      });
      const { next } = await drive(controller.getConceptTree, {
        okfIsSuperAdmin: false,
        okfScopes: ['okf:t:other:read']
      });
      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].code).toBe('REPO_NOT_FOUND');
    } finally {
      if (prev === undefined) delete process.env.OKF_SCOPE_MODE;
      else process.env.OKF_SCOPE_MODE = prev;
    }
  });

  it('open mode: the additive verdict rides to getById as null (grants never strip open repos)', async () => {
    repoService.getById.mockImplementation(async (repoId, opts = {}) => {
      if (opts && opts.authz instanceof Set && !opts.authz.has(repoId)) {
        const { RepoError: E } = require('../services/repository-service');
        throw new E('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
      }
      return servingRepo();
    });
    const { res, next } = await drive(controller.getConceptTree, {
      okfIsSuperAdmin: false,
      okfScopes: ['okf:t:other:read']
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(repoService.getById).toHaveBeenCalledWith('r1', expect.objectContaining({ authz: null }));
  });

  it('a service throw reaches next verbatim', async () => {
    repoService.getById.mockResolvedValueOnce(servingRepo());
    const boom = new Error('cursor died');
    conceptMetaService.listConceptTree.mockRejectedValueOnce(boom);
    const { next } = await drive(controller.getConceptTree, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(next).toHaveBeenCalledWith(boom);
  });
});

// ── #948 (narrowed disposition): cross-repo conformance-debt aggregation ──
describe('repository-controller — conformance-debt aggregation (#948)', () => {
  beforeEach(() => {
    // This suite resets mocks TARGETEDLY, not wholesale — clear the two this
    // describe touches so prior tests' call records cannot leak in.
    repoService.list.mockClear();
    conformanceService.getDebtByRepos.mockClear();
  });

  it('pages the readable catalog, aggregates once, enriches rows with repo metadata', async () => {
    repoService.list
      .mockResolvedValueOnce({
        items: [
          { repo_id: 'ra', name: 'A', domain: 'health', lifecycle_state: 'publish' },
          { repo_id: 'rb', name: 'B', domain: 'health', lifecycle_state: 'draft' }
        ],
        next_cursor: 'page-2'
      })
      .mockResolvedValueOnce({
        items: [{ repo_id: 'rc', name: 'C', domain: 'social', lifecycle_state: 'review' }],
        next_cursor: null
      });
    conformanceService.getDebtByRepos.mockResolvedValueOnce([
      {
        repo_id: 'ra',
        concept_count: 12,
        conformance_issue_count: 4,
        stale_concept_count: 1,
        pii_hit_count: 0,
        has_reserved_index: true
      },
      {
        repo_id: 'rc',
        concept_count: 3,
        conformance_issue_count: 0,
        stale_concept_count: 0,
        pii_hit_count: 2,
        has_reserved_index: false
      }
    ]);
    const { res } = await drive(controller.listConformanceDebt, { okfIsSuperAdmin: true });
    expect(res.statusCode).toBe(200);
    // The page loop followed next_cursor to exhaustion.
    expect(repoService.list).toHaveBeenCalledTimes(2);
    expect(repoService.list).toHaveBeenNthCalledWith(1, { authz: null, cursor: null, limit: 100 });
    expect(repoService.list).toHaveBeenNthCalledWith(2, { authz: null, cursor: 'page-2', limit: 100 });
    // ONE aggregation call over the UNION of pages.
    expect(conformanceService.getDebtByRepos).toHaveBeenCalledTimes(1);
    expect(conformanceService.getDebtByRepos).toHaveBeenCalledWith(['ra', 'rb', 'rc']);
    // Rows carry the repo-list metadata; 'rb' has NO meta rows → omitted.
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ repo_id: 'ra', name: 'A', domain: 'health', lifecycle_state: 'publish' });
    expect(res.body.items[1]).toMatchObject({ repo_id: 'rc', name: 'C', domain: 'social', lifecycle_state: 'review' });
    expect(res.body.generated_at).toBeTruthy();
  });

  it('an empty readable catalog short-circuits before the aggregation', async () => {
    // Default-deny G3: the scoped-no-grants caller's empty set → the service
    // list returns no items → the controller answers [] and never aggregates.
    const { res } = await drive(controller.listConformanceDebt, { okfIsSuperAdmin: false, okfScopes: [] });
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(conformanceService.getDebtByRepos).not.toHaveBeenCalled();
  });

  it('a service throw reaches next verbatim', async () => {
    repoService.list.mockResolvedValueOnce({
      items: [{ repo_id: 'ra', name: 'A', domain: 'health', lifecycle_state: 'publish' }],
      next_cursor: null
    });
    const boom = new Error('debt scan died');
    conformanceService.getDebtByRepos.mockRejectedValueOnce(boom);
    const { next } = await drive(controller.listConformanceDebt);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
