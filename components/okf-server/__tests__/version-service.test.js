// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.7 T2 — version mint (ADR-031): repo-level monotonic counter +
// immutable okf_versions manifest + okf:v{N} tag. Red-green: FAILS before
// services/version-service.js exists.

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
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));
jest.mock('../services/concept-meta-service', () => ({
  writeManifest: jest.fn().mockResolvedValue(null)
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const versionService = require('../services/version-service');
const { writeAudit } = require('../services/audit-service');
const { writeManifest } = require('../services/concept-meta-service');

const REPO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function seedRepo(extra = {}) {
  return mockDb.collection('okf_repositories').save({
    _key: REPO,
    repo_id: REPO,
    name: 'Versioned Repo',
    domain: 'smoke',
    graph_name: `OKF_${REPO}`,
    version: null,
    deleted_at: null,
    pii_scan_status: 'complete', // publish gate pre-requisite (Story 4.8-amend)
    ...extra
  });
}
function seedMeta(concept_id, content_hash) {
  return mockDb.collection('okf_concepts_meta').save({
    _key: `${REPO}_${concept_id}`,
    repo_id: REPO,
    concept_id,
    title: `Title ${concept_id}`,
    content_hash,
    index_status: 'indexed'
  });
}

/** The service queries via db.query (AQL strings) — program the cursor.
 * The mint's FIRST TWO queries are the D1 drain gates (Pending bundle-zip
 * files doc, then meta rows at index_status='parsed' — WP-C queue) —
 * auto-prepend [] [] so every programmed row goes to the snapshot query. */
function programQuery(rows) {
  mockDb.query.mockResolvedValueOnce({ all: async () => [] }); // gate 1: no pending files
  mockDb.query.mockResolvedValueOnce({ all: async () => [] }); // gate 2: no parsed meta rows
  mockDb.query.mockResolvedValueOnce({ all: async () => rows });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('versionService.mintVersion (ADR-031: repo-level, monotonic, INSERT-only)', () => {
  test('first mint: null → 1, manifest snapshotted with stored hashes, repo bumped + tagged', async () => {
    seedRepo();
    seedMeta('index', 'hash-index');
    seedMeta('bad_concept', 'hash-bad');
    programQuery([
      { concept_id: 'bad_concept', title: 'Title bad_concept', content_hash: 'hash-bad', index_status: 'indexed' },
      { concept_id: 'index', title: 'Title index', content_hash: 'hash-index', index_status: 'indexed' }
    ]);
    const result = await versionService.mintVersion(
      REPO,
      { trigger: 'crawl', source_ref: 'https://example.gov' },
      { sub: 'steward-1' }
    );
    expect(result).toMatchObject({
      repo_id: REPO,
      bundle_version: 1,
      okf_tag: 'okf:v1',
      concept_count: 2,
      manifest_key: `${REPO}_1`
    });
    // Manifest: immutable shape, hashes READ from meta (never recomputed)
    const manifest = mockDb._stores.okf_versions[`${REPO}_1`];
    expect(manifest).toMatchObject({
      repo_id: REPO,
      bundle_version: 1,
      okf_tag: 'okf:v1',
      trigger: 'crawl',
      source_ref: 'https://example.gov',
      curator: 'steward-1',
      concept_count: 2
    });
    expect(manifest.concepts).toEqual([
      { concept_id: 'bad_concept', title: 'Title bad_concept', content_hash: 'hash-bad', index_status: 'indexed' },
      { concept_id: 'index', title: 'Title index', content_hash: 'hash-index', index_status: 'indexed' }
    ]);
    // Repo doc: version + tag stamped (mint is the SOLE writer)
    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.version).toBe(1);
    expect(repo.okf_tag).toBe('okf:v1');
    expect(repo.version_minted_at).toEqual(manifest.minted_at);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repo.version_mint',
        actor: 'steward-1',
        repo_id: REPO,
        version: 1,
        okf_tag: 'okf:v1'
      })
    );
  });

  test('subsequent mint: 1 → 2 (re-crawl ⇒ N+1 of the SAME repo — D-V4)', async () => {
    seedRepo({ version: 1, okf_tag: 'okf:v1' });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    const result = await versionService.mintVersion(REPO, { trigger: 'crawl' });
    expect(result.bundle_version).toBe(2);
    expect(result.okf_tag).toBe('okf:v2');
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(2);
  });

  test('unknown repo → 404 REPO_NOT_FOUND', async () => {
    await expect(versionService.mintVersion('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });

  test('soft-deleted repo → 404 (no minting tombstones)', async () => {
    seedRepo({ deleted_at: '2026-08-16T00:00:00Z' });
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({ code: 'REPO_NOT_FOUND', status: 404 });
  });

  test('invalid trigger → 400 VALIDATION_ERROR', async () => {
    seedRepo();
    await expect(versionService.mintVersion(REPO, { trigger: 'oops' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });

  test('concurrent-mint race → self-heals: manifest-first collision reconciles the counter and mints N+2', async () => {
    seedRepo({ version: 4 });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    // First save collides; the ledger ALREADY holds manifest 5 (a concurrent
    // winner OR a crashed mint that committed before the counter bump). The
    // mint must reconcile to 5 and mint 6 — never throw raw.
    const versionsHandle = mockDb.collection('okf_versions');
    const realSave = versionsHandle.save.getMockImplementation();
    let collided = false;
    versionsHandle.save.mockImplementation(async (doc) => {
      if (!collided) {
        collided = true;
        await mockDb.collection('okf_versions').save({
          _key: REPO + '_5',
          repo_id: REPO,
          bundle_version: 5,
          okf_tag: 'okf:v5',
          concept_count: 1,
          concepts: []
        });
        const e = new Error('unique constraint violated');
        e.errorNum = 1210;
        e.code = 409;
        throw e;
      }
      return realSave(doc);
    });
    const result = await versionService.mintVersion(REPO);
    expect(result.bundle_version).toBe(6);
    expect(result.okf_tag).toBe('okf:v6');
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(6);
  });
});

describe('versionService.mintVersion — review fixes (2026-08-17)', () => {
  test('D1 (re-scoped): refuses mint while the PARSED queue is in flight → 409 DRAIN_IN_PROGRESS', async () => {
    seedRepo({ version: 2 });
    mockDb.query.mockResolvedValueOnce({ all: async () => [1] }); // parsed rows exist
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'DRAIN_IN_PROGRESS',
      status: 409
    });
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(2); // no bump
  });

  test('D1 (re-scoped): a Pending zip with an EMPTY queue is stale — mint proceeds (reconcile is best-effort)', async () => {
    seedRepo({ version: 2 });
    mockDb.query.mockResolvedValueOnce({ all: async () => [] }); // parsed queue empty
    mockDb.query.mockResolvedValueOnce({ all: async () => [1] }); // Pending zip present
    // The stale-zip reconcile runs outside the gate; its doc-repo PATCH is
    // best-effort (no config in unit tests → caught + logged).
    programQuery([]);
    programQuery([]);
    const result = await versionService.mintVersion(REPO, { trigger: 'manual' });
    expect(result.bundle_version).toBe(3);
  });

  test('D1: mint proceeds when no Pending files exist', async () => {
    seedRepo({ version: 2 });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]); // gates [](auto) + snapshot
    const result = await versionService.mintVersion(REPO);
    expect(result.bundle_version).toBe(3);
  });

  test('D1 (WP-C): refuses mint while a meta row sits at index_status=parsed (the content-only queue) → 409', async () => {
    seedRepo({ version: 2 });
    // The parsed-queue gate is the FIRST query (re-scoped 2026-08-30).
    mockDb.query.mockResolvedValueOnce({
      all: async () => [{ repo_id: REPO, concept_id: 'stuck', index_status: 'parsed' }]
    });
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'DRAIN_IN_PROGRESS',
      status: 409
    });
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(2); // no bump
  });

  test('B+C+E follow-up: mint REFRESHES okf_bundle_manifest with the minted version', async () => {
    seedRepo({ version: 1, cloned_from: { repo_id: 'src', version: 1 } });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    const result = await versionService.mintVersion(REPO, { trigger: 'publish' });
    expect(result.bundle_version).toBe(2);
    expect(writeManifest).toHaveBeenCalledWith(REPO, 2, { repo_id: 'src', version: 1 });
  });

  test('B+C+E follow-up: a manifest refresh failure does NOT fail the mint (isolated)', async () => {
    seedRepo({ version: 1 });
    writeManifest.mockRejectedValueOnce(new Error('manifest store down'));
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    const result = await versionService.mintVersion(REPO, { trigger: 'publish' });
    expect(result.bundle_version).toBe(2); // mint succeeded despite the refresh failure
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(2);
  });

  test('PUBLISH GATE: refuses mint while a concept is non-indexed (rejected) → 409 PUBLISH_GATE_BLOCKED', async () => {
    seedRepo({ version: 1 });
    programQuery([
      {
        concept_id: 'bad',
        title: 'Bad',
        content_hash: 'h',
        index_status: 'rejected',
        conformance_issues: [{ code: 'MISSING_TYPE' }],
        pii_state: 'clean'
      }
    ]);
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'PUBLISH_GATE_BLOCKED',
      status: 409
    });
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(1); // no bump
  });

  test('PUBLISH GATE: refuses mint while a concept carries conformance issues → 409', async () => {
    seedRepo({ version: 1 });
    programQuery([
      {
        concept_id: 'warn',
        title: 'Warn',
        content_hash: 'h',
        index_status: 'indexed',
        conformance_issues: [{ code: 'INVALID_STATUS_ENUM' }],
        pii_state: 'clean'
      }
    ]);
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'PUBLISH_GATE_BLOCKED',
      status: 409
    });
  });

  test('PUBLISH GATE: refuses mint when the repo PII scan is incomplete → 409', async () => {
    seedRepo({ version: 1, pii_scan_status: 'pending' });
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'PUBLISH_GATE_BLOCKED',
      status: 409
    });
  });

  test('PII GATE (split, 2026-08-30): a pii_state hit refuses with PII_GATE_BLOCKED', async () => {
    seedRepo({ version: 1 });
    programQuery([
      { concept_id: 'ok', title: 'Ok', content_hash: 'h', index_status: 'indexed', pii_state: 'clean' },
      { concept_id: 'flagged', title: 'F', content_hash: 'h2', index_status: 'indexed', pii_state: 'hit' }
    ]);
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'PII_GATE_BLOCKED',
      status: 409
    });
  });

  test('PII GATE: acknowledgePii waives a reviewed hit and stamps the manifest', async () => {
    seedRepo({ version: 1 });
    programQuery([
      { concept_id: 'ok', title: 'Ok', content_hash: 'h', index_status: 'indexed', pii_state: 'clean' },
      { concept_id: 'flagged', title: 'F', content_hash: 'h2', index_status: 'indexed', pii_state: 'hit' }
    ]);
    programQuery([
      { concept_id: 'ok', title: 'Ok', content_hash: 'h', index_status: 'indexed', pii_state: 'clean' },
      { concept_id: 'flagged', title: 'F', content_hash: 'h2', index_status: 'indexed', pii_state: 'hit' }
    ]);
    const result = await versionService.mintVersion(REPO, { acknowledgePii: true });
    expect(result.bundle_version).toBe(2);
    const manifest = mockDb._stores.okf_versions[REPO + '_2'];
    expect(manifest.pii_acknowledged).toBe(true);
  });

  test('PII GATE: a pii_state ERROR hard-blocks even with acknowledgePii (fail-closed)', async () => {
    seedRepo({ version: 1 });
    programQuery([
      { concept_id: 'broken', title: 'B', content_hash: 'h', index_status: 'indexed', pii_state: 'error' }
    ]);
    await expect(versionService.mintVersion(REPO, { acknowledgePii: true })).rejects.toMatchObject({
      code: 'PII_GATE_BLOCKED',
      status: 409
    });
  });

  test('P3: self-heal after a CRASHED mint — manifest committed but counter never bumped', async () => {
    // repo.version=3, but manifest 4 already exists (crash before the bump).
    seedRepo({ version: 3 });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    const versionsHandle = mockDb.collection('okf_versions');
    const realSave = versionsHandle.save.getMockImplementation();
    let collided = false;
    versionsHandle.save.mockImplementation(async (doc) => {
      if (!collided) {
        collided = true;
        await mockDb.collection('okf_versions').save({
          _key: REPO + '_4',
          repo_id: REPO,
          bundle_version: 4,
          okf_tag: 'okf:v4',
          concept_count: 1,
          concepts: []
        });
        const e = new Error('unique constraint violated');
        e.errorNum = 1210;
        e.code = 409;
        throw e;
      }
      return realSave(doc);
    });
    const result = await versionService.mintVersion(REPO);
    expect(result.bundle_version).toBe(5); // healed: 4 existed, mints 5
    expect(mockDb._stores.okf_repositories[REPO].version).toBe(5);
  });

  test('P2: a SECOND unique collision surfaces the designed MINT_RACE 409 (never raw)', async () => {
    seedRepo({ version: 4 });
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    programQuery([{ concept_id: 'x', title: 'X', content_hash: 'h', index_status: 'indexed' }]);
    const versionsHandle = mockDb.collection('okf_versions');
    let call = 0;
    versionsHandle.save.mockImplementation(async () => {
      call += 1;
      if (call <= 2) {
        // collide twice; the self-heal still cannot advance
        const e = new Error('unique constraint violated');
        e.errorNum = 1210;
        e.code = 409;
        throw e;
      }
      throw new Error('should not reach a third save');
    });
    await expect(versionService.mintVersion(REPO)).rejects.toMatchObject({
      code: 'MINT_RACE',
      status: 409
    });
  });

  test('P4: isNotFound is STRUCTURAL — an infrastructure error is NOT masked as 404', async () => {
    // collection-not-found (errorNum 1203) is NOT document-not-found (1204):
    // the getVersion path must surface it, not convert it to VERSION_NOT_FOUND.
    const doc = mockDb.collection('okf_versions').document;
    doc.mockRejectedValueOnce(Object.assign(new Error('collection or view not found'), { errorNum: 1203 }));
    await expect(versionService.getVersion(REPO, 1)).rejects.not.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});

describe('versionService.list/get (4.5 diff/list backing)', () => {
  test('list returns manifests newest-first', async () => {
    seedRepo();
    // listVersions makes a SINGLE query — program it directly (no gate prepend).
    mockDb.query.mockResolvedValueOnce({
      all: async () => [
        { bundle_version: 2, okf_tag: 'okf:v2' },
        { bundle_version: 1, okf_tag: 'okf:v1' }
      ]
    });
    const list = await versionService.listVersions(REPO);
    expect(list.map((v) => v.bundle_version)).toEqual([2, 1]);
  });

  test('get returns the full manifest by deterministic key', async () => {
    seedRepo();
    await mockDb.collection('okf_versions').save({
      _key: `${REPO}_1`,
      repo_id: REPO,
      bundle_version: 1,
      okf_tag: 'okf:v1',
      concepts: [{ concept_id: 'x' }]
    });
    const manifest = await versionService.getVersion(REPO, 1);
    expect(manifest.concepts).toEqual([{ concept_id: 'x' }]);
  });

  test('get unknown version → 404 VERSION_NOT_FOUND', async () => {
    await expect(versionService.getVersion(REPO, 9)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND', status: 404 });
  });
});
