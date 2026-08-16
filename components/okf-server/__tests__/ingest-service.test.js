// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.1 T4 — the write-side orchestrator (ADR-021 §2.3 steps 4a–4f).
// Red-green: FAILS before services/ingest-service.js exists.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../shared-lib/db-connection-service', () => ({
  getConnection: jest.fn(() => Promise.resolve(require('./mocks/arango-mock').createMockDb()))
}));
jest.mock('../services/parser-service', () => ({
  parseConcept: jest.fn(async (markdown, ctx) => ({
    concept_id: `concepts/${ctx.path.replace(/\.md$/, '')}`,
    repo_id: ctx.repo_id,
    path: ctx.path,
    frontmatter: { title: 'T', type: 'service' },
    body: markdown,
    status: 'stable',
    sources: [],
    links: []
  }))
}));
jest.mock('../services/conformance-service', () => ({
  validateConcept: jest.fn(() => ({ issues: [], valid: true })),
  persistConformanceIssues: jest.fn(async () => undefined)
}));
jest.mock('../services/concept-meta-service', () => ({
  // Real contentHash is exported by the 2.9.2 writer; the mock mirrors the
  // sha256 contract with a deterministic value the dedup tests control.
  contentHash: jest.fn(() => 'same-hash'),
  upsertConceptMeta: jest.fn(async (repo_id, parsed, opts) => ({
    action: 'created',
    doc: {
      repo_id,
      concept_id: parsed.concept_id,
      content_hash: `hash-${parsed.concept_id}`,
      index_status: 'parsed',
      ...opts
    }
  }))
}));
jest.mock('../services/pii-service', () => ({
  scanConcept: jest.fn(async (repo_id, concept_id) => ({
    repo_id,
    concept_id,
    pii_state: 'clean',
    pii_hits_summary: {}
  }))
}));
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn(), post: jest.fn(async () => ({ status: 202, data: { file_id: 'file-x' } })) }
}));
jest.mock('../services/repository-service', () => ({
  getById: jest.fn(async (repo_id) => ({
    repo_id,
    domain: 'social',
    graph_name: `OKF_${repo_id}`,
    version: 3,
    lifecycle_state: 'register'
  }))
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));

const ingestService = require('../services/ingest-service');
const parserService = require('../services/parser-service');
const conformanceService = require('../services/conformance-service');
const conceptMeta = require('../services/concept-meta-service');
const piiService = require('../services/pii-service');

const { authedAxios } = require('../services/service-token');

const REPO = '11111111-2222-3333-4444-555555555555';
const ACTOR = { sub: 'steward-1', name: 'Steward', source_ip: '127.0.0.1' };
const conceptInput = (name, extra = {}) => ({ frontmatter: { title: name }, body: `# ${name}\nBody text.`, ...extra });

describe('ingestService.ingestRepoConcepts (ADR-021 4a–4f)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('happy path: per-concept sequence in order, 202-ready summary', async () => {
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('Alpha'), conceptInput('Beta')] },
      ACTOR
    );

    expect(summary).toMatchObject({
      repo_id: REPO,
      total: 2,
      enqueued: 2,
      skipped_dedup: 0,
      pii: { clean: 2, hit: 0, error: 0 },
      enqueue_errors: []
    });
    // Order: parse → full upsert → validate+persist → scan → enqueue, per concept
    expect(parserService.parseConcept).toHaveBeenCalledTimes(2);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledTimes(2);
    expect(conformanceService.validateConcept).toHaveBeenCalledTimes(2);
    expect(conformanceService.persistConformanceIssues).toHaveBeenCalledTimes(2);
    expect(piiService.scanConcept).toHaveBeenCalledTimes(2);
    expect(authedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('4b FULL upsert happens BEFORE 4c conformance persist (the clobber-proof order)', async () => {
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Order')] }, ACTOR);
    const upsertOrder = conceptMeta.upsertConceptMeta.mock.invocationCallOrder[0];
    const persistOrder = conformanceService.persistConformanceIssues.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(persistOrder);
    // Full input to the writer (has frontmatter AND body — NOT the minimal stub)
    const writerInput = conceptMeta.upsertConceptMeta.mock.calls[0][1];
    expect(writerInput.frontmatter).toBeDefined();
    expect(writerInput.body).toBeDefined();
  });

  test('derives ACL labels from the repo (t:domain r:repo d:domain — D-A) and appends caller labels after', async () => {
    await ingestService.ingestRepoConcepts(
      REPO,
      { labels: ['Service Directory'], concepts: [conceptInput('Acl')] },
      ACTOR
    );
    const body = authedAxios.post.mock.calls[0][1];
    expect(body.labels).toEqual([`t:social`, `r:${REPO}`, `d:social`, 'Service Directory']);
    expect(body.graph_name).toBe(`OKF_${REPO}`);
    expect(body.repo_id).toBe(REPO);
    expect(body.defer_kick).toBe(true);
    expect(body.originalFileName).toBe('acl.md');
  });

  test('threads bundle_version from repo.version (D-B) into the writer opts', async () => {
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('V')] }, ACTOR);
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.bundle_version).toBe(3);
  });

  test('dedup (4e): unchanged hash + index_status=indexed → enqueue SKIPPED, counted', async () => {
    conceptMeta.upsertConceptMeta.mockResolvedValueOnce({
      action: 'updated',
      doc: { concept_id: 'concepts/Dup', content_hash: 'same-hash', index_status: 'indexed' }
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Dup')] }, ACTOR);
    expect(summary.skipped_dedup).toBe(1);
    expect(summary.enqueued).toBe(0);
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('re-ingest of a parsed (not indexed) concept still enqueues (dedup cannot fire pre-2.9.4)', async () => {
    conceptMeta.upsertConceptMeta.mockResolvedValueOnce({
      action: 'updated',
      doc: { concept_id: 'concepts/Re', content_hash: 'same-hash', index_status: 'parsed' }
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Re')] }, ACTOR);
    expect(summary.enqueued).toBe(1);
  });

  test('per-concept isolation: an enqueue failure records the error, others proceed', async () => {
    authedAxios.post
      .mockRejectedValueOnce(new Error('doc-repo down'))
      .mockResolvedValueOnce({ status: 202, data: { file_id: 'f2' } });
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('Bad'), conceptInput('Good')] },
      ACTOR
    );
    expect(summary.enqueued).toBe(1);
    expect(summary.enqueue_errors).toHaveLength(1);
    expect(summary.enqueue_errors[0].concept_id).toBe('concepts/bad');
  });

  test('PII fail-closed CONTINUES: an unexpected scan throw is isolated, not fatal', async () => {
    piiService.scanConcept.mockRejectedValueOnce(new Error('scan exploded'));
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('P'), conceptInput('Q')] },
      ACTOR
    );
    expect(summary.total).toBe(2);
    expect(summary.pii.error).toBe(1);
    expect(summary.enqueued).toBe(2); // the errored concept STILL enqueues (state recorded, publish gate blocks later)
  });

  test('audit row written (actor = sub string)', async () => {
    const { writeAudit } = require('../services/audit-service');
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Aud')] }, ACTOR);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.ingest', actor: 'steward-1', repo_id: REPO, source_ip: '127.0.0.1' })
    );
  });

  test('OKF_INGEST_MAX_CONCEPTS bound: above the cap → VALIDATION-style error', async () => {
    const tooMany = Array.from({ length: 3 }, (_, i) => conceptInput(`C${i}`));
    await expect(ingestService._ingestWithCap(REPO, { concepts: tooMany }, ACTOR, 2)).rejects.toMatchObject({
      code: 'TOO_MANY_CONCEPTS',
      status: 400
    });
  });

  test('file_ids mode: inputs fetched via piiService.discoverRepoFiles', async () => {
    piiService.discoverRepoFiles = jest.fn(async () => [
      { concept_id: 'f1', frontmatter: {}, body: '# x', file_id: 'f1' }
    ]);
    const summary = await ingestService.ingestRepoConcepts(REPO, { file_ids: ['f1'] }, ACTOR);
    expect(summary.total).toBe(1);
    expect(summary.enqueued).toBe(1);
  });
});
