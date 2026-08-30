// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.1 T4 — the write-side orchestrator (ADR-021 §2.3 steps 4a–4f).
// Red-green: FAILS before services/ingest-service.js exists; extended with the
// 2026-08-16 review-fix contracts (parse isolation, pre-read dedup, ACL strip,
// slug collisions, enqueue timeout, not_found, success flag, strict discover).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/parser-service', () => ({
  parseConcept: jest.fn(async (markdown, ctx) => ({
    concept_id: ctx.path.replace(/.md$/, ''), // basename contract (2026-08-30)
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
  validateConcept: jest.fn(() => ({ issues: [], hardErrors: [], valid: true })),
  persistConformanceIssues: jest.fn(async () => undefined)
}));
jest.mock('../services/concept-meta-service', () => ({
  // Real contentHash is exported by the 2.9.2 writer; the mock is
  // body-dependent so the slug-collision tests are deterministic.
  contentHash: jest.fn((body) => `H${String(body).length}`),
  getConceptMeta: jest.fn(async () => null),
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
    okf_tag: 'okf:v3',
    lifecycle_state: 'register'
  }))
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));

const matter = require('gray-matter');
const ingestService = require('../services/ingest-service');
const parserService = require('../services/parser-service');
const conformanceService = require('../services/conformance-service');
const conceptMeta = require('../services/concept-meta-service');
const piiService = require('../services/pii-service');
const { logger } = require('../shared-lib/logger');

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
      parsed: 2,
      enqueued: 2,
      skipped_dedup: 0,
      pii: { clean: 2, hit: 0, error: 0 },
      enqueue_errors: [],
      not_found: [],
      success: true
    });
    // Order: parse → full upsert → validate+persist → scan → enqueue, per concept
    expect(parserService.parseConcept).toHaveBeenCalledTimes(2);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledTimes(2);
    expect(conformanceService.validateConcept).toHaveBeenCalledTimes(2);
    expect(conformanceService.persistConformanceIssues).toHaveBeenCalledTimes(2);
    expect(piiService.scanConcept).toHaveBeenCalledTimes(2);
    // Story 4.8-amend (content-only): NO doc-repo POST for a concept — the meta row
    // is the queue; the worker POSTs to dataprep directly.
    expect(authedAxios.post).not.toHaveBeenCalled();
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

  test('derives ACL labels from the repo (t:domain r:repo d:domain — D-A), caller labels, then the minted okf:v tag (content-only: rides the meta row)', async () => {
    await ingestService.ingestRepoConcepts(
      REPO,
      { labels: ['Service Directory'], concepts: [conceptInput('Acl')] },
      ACTOR
    );
    // Story 4.8-amend: NO doc-repo POST for a concept — the labels + graph + version
    // ride the 4b meta upsert (ingest_labels) for the worker to POST to dataprep.
    expect(authedAxios.post).not.toHaveBeenCalled();
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.ingest_labels).toEqual([`t:social`, `r:${REPO}`, `d:social`, 'Service Directory', 'okf:v3']);
    expect(opts.bundle_version).toBe(3); // Story 2.9.7: version rides the meta row → chunk docs
  });

  test('ACL-prefixed AND caller okf:v tags are STRIPPED + warned (sole-injector invariant)', async () => {
    await ingestService.ingestRepoConcepts(
      REPO,
      {
        labels: ['t:evil', 'r:evil', 'd:evil', 'T:EVIL', 'okf:v99', 'Service Directory'],
        concepts: [conceptInput('Acl')]
      },
      ACTOR
    );
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.ingest_labels).toEqual([`t:social`, `r:${REPO}`, `d:social`, 'Service Directory', 'okf:v3']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Caller-supplied ACL/version-tag labels stripped (sole-injector invariant)',
      expect.objectContaining({
        repo_id: REPO,
        stripped: expect.arrayContaining(['t:evil', 'r:evil', 'd:evil', 'T:EVIL', 'okf:v99'])
      })
    );
  });

  test('unminted repo (no version/okf_tag) → no tag in labels, bundle_version null (legacy shape)', async () => {
    const repoService = require('../services/repository-service');
    repoService.getById.mockResolvedValueOnce({
      repo_id: REPO,
      domain: 'social',
      graph_name: `OKF_${REPO}`,
      version: null,
      okf_tag: null
    });
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('NoV')] }, ACTOR);
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.ingest_labels).toEqual([`t:social`, `r:${REPO}`, `d:social`]);
    expect(opts.bundle_version).toBeNull();
  });

  test('threads bundle_version from repo.version (D-B) into the writer opts', async () => {
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('V')] }, ACTOR);
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.bundle_version).toBe(3);
  });

  test('dedup (4e): PRE-upsert doc with unchanged hash + index_status=indexed → enqueue SKIPPED (review fix)', async () => {
    // The stored (pre-upsert) doc: indexed with the hash the NEW body produces.
    conceptMeta.getConceptMeta.mockResolvedValueOnce({
      concept_id: 'dup',
      content_hash: 'MATCH',
      index_status: 'indexed'
    });
    conceptMeta.contentHash.mockImplementationOnce(() => 'MATCH'); // the only call in this test is the 4e compare
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Dup')] }, ACTOR);
    expect(summary.skipped_dedup).toBe(1);
    expect(summary.enqueued).toBe(0);
    expect(authedAxios.post).not.toHaveBeenCalled();
    expect(conceptMeta.getConceptMeta).toHaveBeenCalledWith(REPO, 'dup');
  });

  test('dedup (4e): CHANGED hash on an indexed concept → still enqueues (re-index needed)', async () => {
    conceptMeta.getConceptMeta.mockResolvedValueOnce({
      concept_id: 'concepts/chg',
      content_hash: 'OLD-HASH',
      index_status: 'indexed'
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Chg')] }, ACTOR);
    expect(summary.skipped_dedup).toBe(0);
    expect(summary.enqueued).toBe(1);
  });

  test('re-ingest of a parsed (not indexed) concept still enqueues (dedup cannot fire pre-2.9.4)', async () => {
    conceptMeta.getConceptMeta.mockResolvedValueOnce({
      concept_id: 'concepts/re',
      content_hash: 'H22', // same as the new body's mock hash — but NOT indexed
      index_status: 'parsed'
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Re')] }, ACTOR);
    expect(summary.enqueued).toBe(1);
    expect(summary.skipped_dedup).toBe(0);
  });

  test('no pre-existing doc → no dedup read hazard (getConceptMeta null)', async () => {
    conceptMeta.getConceptMeta.mockResolvedValueOnce(null);
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('New')] }, ACTOR);
    expect(summary.enqueued).toBe(1);
    expect(summary.created).toBe(1);
  });

  test('per-concept isolation: a meta-upsert failure records the error, others proceed', async () => {
    conceptMeta.upsertConceptMeta.mockRejectedValueOnce(new Error('arango down'));
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('Bad'), conceptInput('Good')] },
      ACTOR
    );
    expect(summary.enqueued).toBe(1);
    expect(summary.enqueue_errors).toHaveLength(1);
    expect(summary.enqueue_errors[0].concept_id).toBe('bad');
    expect(summary.enqueue_errors[0].stage).toBe('meta_upsert');
  });

  test('4a parse isolation (review fix): a PARSE_ERROR records {stage:"parse"} and the request STAYS 202', async () => {
    const parseErr = Object.assign(new Error('Malformed frontmatter: bad yaml'), {
      code: 'PARSE_ERROR',
      status: 400
    });
    parserService.parseConcept.mockRejectedValueOnce(parseErr);
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('Broken'), conceptInput('Fine')] },
      ACTOR
    );
    expect(summary.total).toBe(2);
    expect(summary.parsed).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(summary.enqueue_errors).toEqual([
      { concept_id: 'broken.md', stage: 'parse', error: 'Malformed frontmatter: bad yaml' }
    ]);
    expect(summary.success).toBe(true); // partial, not total failure
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

  test('audit row written (actor = sub string) — carries the per-bundle totals', async () => {
    const { writeAudit } = require('../services/audit-service');
    await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Aud')] }, ACTOR);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repo.ingest',
        actor: 'steward-1',
        repo_id: REPO,
        source_ip: '127.0.0.1',
        total: 1,
        enqueued: 1,
        skipped_dedup: 0,
        rejected: 0,
        error_count: 0
      })
    );
  });

  test('2-9-5 surfacing: last_ingest_summary written to the repo doc (capped errors)', async () => {
    const mockDb = require('../shared-lib/db-connection-service').__mockDb;
    const repoCol = mockDb.collection('okf_repositories');
    const realUpdate = repoCol.update.getMockImplementation();
    const updates = [];
    repoCol.update.mockImplementation(async (id, patch) => {
      updates.push({ id, patch });
      return realUpdate(id, patch);
    });
    // A partial ingest: one concept parses, one fails at 4a.
    parserService.parseConcept
      .mockResolvedValueOnce({
        concept_id: 'concepts/ok',
        repo_id: REPO,
        frontmatter: { title: 'T', type: 'service' },
        body: 'ok',
        links: []
      })
      .mockRejectedValueOnce(new Error('yaml explosion'));
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      { concepts: [conceptInput('Ok'), conceptInput('Bad')] },
      ACTOR
    );
    expect(summary.success).toBe(true); // partial 202 contract
    const surf = updates.find((u) => u.patch && u.patch.last_ingest_summary);
    expect(surf).toMatchObject({ id: REPO });
    expect(surf.patch.last_ingest_summary).toMatchObject({
      total: 2,
      parsed: 1,
      enqueued: 1,
      error_count: 1,
      errors: [{ concept_id: 'bad.md', stage: 'parse', error: 'yaml explosion' }]
    });
  });

  test('OKF_INGEST_MAX_CONCEPTS bound: above the cap → VALIDATION-style error', async () => {
    const tooMany = Array.from({ length: 3 }, (_, i) => conceptInput(`C${i}`));
    await expect(ingestService._ingestWithCap(REPO, { concepts: tooMany }, ACTOR, 2)).rejects.toMatchObject({
      code: 'TOO_MANY_CONCEPTS',
      status: 400
    });
  });

  test('file_ids mode: inputs fetched via discoverRepoFiles; missing ids surface in not_found (review fix)', async () => {
    piiService.discoverRepoFiles = jest.fn(async () => [
      { concept_id: 'f1', frontmatter: {}, body: '# x', file_id: 'f1' }
    ]);
    const summary = await ingestService.ingestRepoConcepts(REPO, { file_ids: ['f1', 'nope'] }, ACTOR);
    expect(summary.total).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(summary.not_found).toEqual(['nope']);
  });

  test('discover must be STRICTLY true — a truthy non-boolean is a 400 (review fix)', async () => {
    piiService.discoverRepoFiles = jest.fn(async () => []);
    await expect(ingestService.ingestRepoConcepts(REPO, { discover: 'yes' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    expect(piiService.discoverRepoFiles).not.toHaveBeenCalled();
  });

  test('stored-file inputs ALWAYS go through parseConcept (dead skip-branch removed — review fix)', async () => {
    piiService.discoverRepoFiles = jest.fn(async () => [
      // Non-empty frontmatter + concept_id — the shape the deleted branch
      // trusted; it MUST still be re-parsed (frontmatter/links re-derived).
      { concept_id: 'f9', frontmatter: { title: 'Stored' }, body: '# stored body', file_id: 'f9' }
    ]);
    const summary = await ingestService.ingestRepoConcepts(REPO, { discover: true }, ACTOR);
    expect(parserService.parseConcept).toHaveBeenCalledTimes(1);
    const markdown = parserService.parseConcept.mock.calls[0][0];
    expect(markdown).toContain('# stored body');
    expect(summary.parsed).toBe(1);
    expect(summary.enqueued).toBe(1);
  });

  test('the bundle-zip store POST carries a 30s timeout (review fix)', async () => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('tmo.md', Buffer.from('# Tmo'));
    await ingestService.ingestRepoConcepts(REPO, { zip: zip.toBuffer().toString('base64') }, ACTOR);
    expect(authedAxios.post.mock.calls[0][2]).toEqual({ timeout: 30000 });
  });

  test('hard conformance error REJECTS the concept — recorded, never enqueued (Story 4.8-amend)', async () => {
    conformanceService.validateConcept.mockReturnValueOnce({
      issues: [{ code: 'MISSING_TYPE', severity: 'error' }],
      hardErrors: [{ code: 'MISSING_TYPE', severity: 'error' }],
      valid: false
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Bad')] }, ACTOR);
    expect(summary.rejected).toBe(1);
    expect(summary.enqueued).toBe(0);
    // The reject persists index_status='rejected' via the writer; no enqueue → no files doc.
    const rejectUpsert = conceptMeta.upsertConceptMeta.mock.calls.find(
      (c) => c[2] && c[2].patch && c[2].patch.index_status === 'rejected'
    );
    expect(rejectUpsert).toBeTruthy();
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('warning-only conformance still enqueues (recorded, gated at publish)', async () => {
    conformanceService.validateConcept.mockReturnValueOnce({
      issues: [{ code: 'INVALID_STATUS_ENUM', severity: 'warning' }],
      hardErrors: [],
      valid: false
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('Warn')] }, ACTOR);
    expect(summary.rejected).toBe(0);
    expect(summary.enqueued).toBe(1);
  });
});

describe('ingestService slug handling (review fix: collisions + non-Latin)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('duplicate titles in one batch get content-hash suffixes — distinct concept_ids', async () => {
    const a = conceptInput('Same', { body: '# first body' });
    const b = conceptInput('Same', { body: '# second body, longer' });
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [a, b] }, ACTOR);
    expect(summary.total).toBe(2);
    const paths = parserService.parseConcept.mock.calls.map((c) => c[1].path);
    expect(paths[0]).toBe('same.md');
    expect(paths[1]).toMatch(/^same-H\d+\.md$/); // 'H' + body length (contentHash mock)
    expect(new Set(paths).size).toBe(2);
  });

  test('non-Latin title (empty slug) gets a concept-<hash8> slug, not a blanket "concept"', async () => {
    const summary = await ingestService.ingestRepoConcepts(REPO, { concepts: [conceptInput('中文')] }, ACTOR);
    expect(summary.parsed).toBe(1);
    const path = parserService.parseConcept.mock.calls[0][1].path;
    expect(path).toMatch(/^concept-H\d+\.md$/);
  });

  test('explicit path keeps its shape and still uniquifies on in-batch duplicates', async () => {
    const a = { path: 'guides/intro.md', body: '# one' };
    const b = { path: 'guides/intro.md', body: '# two!' };
    await ingestService.ingestRepoConcepts(REPO, { concepts: [a, b] }, ACTOR);
    const paths = parserService.parseConcept.mock.calls.map((c) => c[1].path);
    expect(paths[0]).toBe('guides/intro.md');
    expect(paths[1]).toMatch(/^guides\/intro-H\d+\.md$/);
  });
});

describe('ingestService.markdownFor (review fix: gray-matter serialization)', () => {
  test('colon-containing values round-trip through a real matter parse (the live-confirmed corruption)', () => {
    const md = ingestService.markdownFor({
      frontmatter: { description: 'Two issues: MISSING_TYPE (no type) and BAD_ACTOR_PREFIX.' },
      body: '# Title'
    });
    const parsed = matter(md);
    expect(parsed.data.description).toBe('Two issues: MISSING_TYPE (no type) and BAD_ACTOR_PREFIX.');
    expect(parsed.content.trim()).toBe('# Title');
  });

  test('empty frontmatter emits NO block — a stored file keeps its own frontmatter for 4a', () => {
    const stored = '---\ntitle: Kept\n---\n# Body';
    const md = ingestService.markdownFor({ frontmatter: {}, body: stored });
    expect(md).not.toContain('---\n{}');
    expect(matter(md).data.title).toBe('Kept');
  });

  test('arrays and nested objects serialize as valid YAML', () => {
    const md = ingestService.markdownFor({
      frontmatter: { tags: ['a', 'b'], generated: { by: 'human:steward', at: '2026-08-16T00:00:00Z' } },
      body: 'x'
    });
    const parsed = matter(md);
    expect(parsed.data.tags).toEqual(['a', 'b']);
    expect(parsed.data.generated).toEqual({ by: 'human:steward', at: '2026-08-16T00:00:00Z' });
  });
});

describe('ingestService.maxConceptsFromEnv (review fix: NaN-safe cap)', () => {
  afterEach(() => delete process.env.OKF_INGEST_MAX_CONCEPTS);

  test('unset → default 200', () => {
    delete process.env.OKF_INGEST_MAX_CONCEPTS;
    expect(ingestService.maxConceptsFromEnv()).toBe(200);
  });
  test('valid number → that number', () => {
    process.env.OKF_INGEST_MAX_CONCEPTS = '50';
    expect(ingestService.maxConceptsFromEnv()).toBe(50);
  });
  test('garbage → default (never NaN — NaN comparisons are always false)', () => {
    process.env.OKF_INGEST_MAX_CONCEPTS = 'banana';
    expect(ingestService.maxConceptsFromEnv()).toBe(200);
  });
  test('zero/negative → default (a nonsensical cap is not a cap)', () => {
    process.env.OKF_INGEST_MAX_CONCEPTS = '0';
    expect(ingestService.maxConceptsFromEnv()).toBe(200);
  });
});

describe('ingestService bundle-zip intake (Story 2.9.5 contract, pulled forward)', () => {
  const AdmZip = require('adm-zip');
  const mdEntry = (name, title) => `---\ntitle: ${title}\ntype: service\n---\n\n# ${title}\n\nBody of ${title}.`;

  const zipB64 = (files) => {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content));
    return zip.toBuffer().toString('base64');
  };

  test('FOLDERED zip intake: concept ids are basenames, never folder paths (2026-08-30)', async () => {
    // A bundle stored under an internal folder (kenya-okf/concepts/*.md) used to
    // mint ids WITH slashes — dataprep could not save them (nested dirs) and the
    // concepts never drained, bricking publish. Folder structure is presentation.
    const b64 = zipB64({
      'kenya-okf/concepts/ecitizen-digital-payments.md': '# eCitizen\n\nbody',
      'kenya-okf/index.md': '# Kenya\n\nindex'
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR);
    expect(summary.parsed).toBe(2);
    const ids = conceptMeta.upsertConceptMeta.mock.calls.map((c) => c[1].concept_id);
    expect(ids).toContain('ecitizen-digital-payments');
    expect(ids).toContain('index');
    expect(ids.some((id) => String(id).includes('/'))).toBe(false);
  });

  test('COLLIDING basenames across folders: second gets a hash suffix (never silently merged)', async () => {
    const b64 = zipB64({ 'v1/index.md': '# One', 'v2/index.md': '# Two' });
    const summary = await ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR);
    expect(summary.parsed).toBe(2);
    const ids = conceptMeta.upsertConceptMeta.mock.calls.map((c) => c[1].concept_id);
    expect(ids.filter((id) => String(id).startsWith('index')).length).toBe(2);
  });

  beforeEach(() => jest.clearAllMocks());

  test('zip of .md concepts → one concept per entry, full markdown preserved for 4a', async () => {
    const b64 = zipB64({
      'index.md': mdEntry('index', 'Government Services KB'),
      'service_directory.md': mdEntry('service_directory', 'Service Directory')
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR);
    expect(summary).toMatchObject({ total: 2, parsed: 2, enqueued: 2, enqueue_errors: [] });
    // Story 4.8-amend (content-only): NO doc-repo POST for a concept — the concepts
    // stay at index_status='parsed' for the worker; the ONLY doc-repo artifact is
    // the 4g bundle-zip store (is_bundle) — the zip itself as a file doc.
    const postCalls = authedAxios.post.mock.calls;
    expect(postCalls).toHaveLength(1); // only the bundle-zip store
    const bundleCall = postCalls[0];
    expect(bundleCall[1]).toMatchObject({
      is_bundle: true,
      graph_name: `OKF_${REPO}`,
      bundle: b64,
      originalFileName: 'repo-bundle.zip'
    });
    // the parser receives the ENTRY'S OWN markdown (frontmatter intact, not re-serialized)
    const firstMarkdown = parserService.parseConcept.mock.calls[0][0];
    expect(firstMarkdown).toContain('title: Government Services KB');
    expect(firstMarkdown).toContain('# Government Services KB');
    // the concept bodies + labels are persisted on the meta row (4b) for the worker
    const opts = conceptMeta.upsertConceptMeta.mock.calls[0][2];
    expect(opts.ingest_labels).toBeDefined();
  });

  test('zip junk filtered: directories, __MACOSX/, dotfiles, non-.md entries ignored', async () => {
    const b64 = zipB64({
      'concepts/': '',
      'ok.md': mdEntry('ok', 'Ok'),
      '__MACOSX/junk.md': 'junk',
      '.DS_Store': 'junk',
      'image.png': 'junk',
      'notes.txt': 'junk'
    });
    const summary = await ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR);
    expect(summary.total).toBe(1);
    expect(summary.enqueued).toBe(1);
  });

  test('zip with NO .md entries → 400 VALIDATION_ERROR', async () => {
    const b64 = zipB64({ 'a.png': 'x', 'b.txt': 'y' });
    await expect(ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });

  test('corrupt zip base64 → 400 BAD_ZIP', async () => {
    await expect(ingestService.ingestRepoConcepts(REPO, { zip: 'aGVsbG8=' }, ACTOR)).rejects.toMatchObject({
      code: 'BAD_ZIP',
      status: 400
    });
  });

  test('DUPLICATE .md entry paths are detected (input integrity — ambiguous bundle)', () => {
    // adm-zip's own writer dedups same-name adds, so crafted duplicates come
    // from FOREIGN zip tools' central directories — the guard is pure logic,
    // tested directly (the service rejects with VALIDATION_ERROR when it fires).
    expect(ingestService.findDuplicateEntryNames(['a.md', 'b.md', 'a.md', 'b.md', 'c.md'])).toEqual(['a.md', 'b.md']);
    expect(ingestService.findDuplicateEntryNames(['a.md', 'b.md'])).toEqual([]);
    expect(ingestService.findDuplicateEntryNames([])).toEqual([]);
  });

  test('zip above the entry cap → 400 TOO_MANY_CONCEPTS', async () => {
    const files = {};
    for (let i = 0; i < 3; i += 1) files[`c${i}.md`] = mdEntry(`c${i}`, `C${i}`);
    await expect(ingestService._ingestWithCap(REPO, { zip: zipB64(files) }, ACTOR, 2)).rejects.toMatchObject({
      code: 'TOO_MANY_CONCEPTS',
      status: 400
    });
  });

  test('zip above the decompressed-size cap → 400 ZIP_TOO_LARGE', async () => {
    process.env.OKF_INGEST_MAX_ZIP_BYTES = '10';
    try {
      const b64 = zipB64({ 'big.md': mdEntry('big', 'x'.repeat(200)) });
      await expect(ingestService.ingestRepoConcepts(REPO, { zip: b64 }, ACTOR)).rejects.toMatchObject({
        code: 'ZIP_TOO_LARGE',
        status: 400
      });
    } finally {
      delete process.env.OKF_INGEST_MAX_ZIP_BYTES;
    }
  });
});
