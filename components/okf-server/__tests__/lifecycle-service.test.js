// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story #978 lifecycle — the 100%-defined state machine (David, 2026-08-28):
// submit/approve/publish/ingest/retract transitions, the publish side effects
// (mint + bundle export + serving cleared), the guards, and the delete block
// for an ingested repository. Red-green: FAILS before
// services/lifecycle-service.js exists.

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
  countByIndexStatus: jest.fn().mockResolvedValue(0),
  requeueRepoForRedrain: jest.fn().mockResolvedValue(0),
  stampRepoGraphName: jest.fn().mockResolvedValue(0)
}));
jest.mock('../services/version-service', () => ({
  mintVersion: jest.fn().mockResolvedValue({ bundle_version: 1, okf_tag: 'okf:v1' })
}));
jest.mock('../services/bundle-export-service', () => ({
  slugFor: (name) =>
    String(name || 'repo')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'repo',
  exportBundle: jest.fn().mockResolvedValue({
    file_id: 'file-bundle-1',
    file_name: 'demo-v1.zip',
    bundle_version: 1,
    stored_at: '2026-08-28T10:00:00Z',
    concept_count: 2
  })
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const lifecycleService = require('../services/lifecycle-service');
const { mintVersion } = require('../services/version-service');
const { exportBundle } = require('../services/bundle-export-service');
const repoService = require('../services/repository-service');
const { writeAudit } = require('../services/audit-service');

const REPO = 'aaaa1111-bbbb-4ccc-8ddd-eeeeeeee0001';

function seedRepo(extra = {}) {
  return mockDb.collection('okf_repositories').save({
    _key: REPO,
    repo_id: REPO,
    name: 'Demo',
    domain: 'smoke',
    graph_name: `OKF_${REPO}`,
    lifecycle_state: 'draft',
    version: null,
    deleted_at: null,
    ...extra
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations — re-pin the default (empty repo) so a
  // previous test's countByIndexStatus mock (e.g. parsed=41) cannot leak into
  // the ingest tests and flip them onto the async-drain branch.
  require('../services/concept-meta-service').countByIndexStatus.mockResolvedValue(0);
  mockDb._reset();
});

describe('lifecycle transitions — the machine, exhaustively', () => {
  test('submit: draft | register → review', async () => {
    for (const from of ['draft', 'register']) {
      mockDb._reset();
      seedRepo({ lifecycle_state: from });
      const res = await lifecycleService.transition(REPO, 'submit', { sub: 'steward-1' });
      expect(res).toMatchObject({ ok: true, action: 'submit', lifecycle_state: 'review' });
      expect(mockDb._stores.okf_repositories[REPO].lifecycle_state).toBe('review');
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'repo.submit', repo_id: REPO, actor: 'steward-1' })
      );
    }
  });

  test('submit from review is REFUSED (409 INVALID_TRANSITION) — no state is skipped', async () => {
    seedRepo({ lifecycle_state: 'review' });
    await expect(lifecycleService.transition(REPO, 'submit', {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 409
    });
  });

  test('INVALID_TRANSITION carries STRUCTURED details (wizard renders only valid actions — David, 2026-09-04)', async () => {
    seedRepo({ lifecycle_state: 'review' });
    await lifecycleService.transition(REPO, 'submit', {}).catch((e) => {
      expect(e.details).toEqual({ current_state: 'review', allowed: ['draft', 'register', 'validate', 'retracted'] });
    });
  });

  test('approve: review → approve', async () => {
    seedRepo({ lifecycle_state: 'review' });
    const res = await lifecycleService.transition(REPO, 'approve', {});
    expect(res.lifecycle_state).toBe('approve');
    expect(mockDb._stores.okf_repositories[REPO].lifecycle_state).toBe('approve');
  });

  test('unknown action → 400 VALIDATION_ERROR', async () => {
    seedRepo();
    await expect(lifecycleService.transition(REPO, 'deploy', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });

  test('BUILDING GATE: an active conversion blocks submit with BUILD_IN_PROGRESS (David, 2026-09-02)', async () => {
    seedRepo({
      lifecycle_state: 'draft',
      conversion: { status: 'splitting', stage: 'splitting', pages_done: 12, batches_done: 2 }
    });
    await expect(lifecycleService.transition(REPO, 'submit', {})).rejects.toMatchObject({
      code: 'BUILD_IN_PROGRESS',
      status: 409
    });
    const { countByIndexStatus } = require('../services/concept-meta-service');
    expect(countByIndexStatus).not.toHaveBeenCalled(); // conversion check short-circuits
  });

  test('BUILDING GATE: a terminal conversion (done) does NOT block (the peer-contract bug)', async () => {
    seedRepo({ lifecycle_state: 'draft', conversion: { status: 'done', pages_done: 340, batches_done: 9 } });
    await expect(lifecycleService.transition(REPO, 'submit', {})).resolves.toMatchObject({
      ok: true,
      lifecycle_state: 'review'
    });
  });

  test('IMPORT ≠ RAG: parsed rows NEVER block submit (import is RAG-free — David, 2026-09-04)', async () => {
    seedRepo({ lifecycle_state: 'draft' });
    const { countByIndexStatus } = require('../services/concept-meta-service');
    countByIndexStatus.mockResolvedValue(41);
    await expect(lifecycleService.transition(REPO, 'submit', {})).resolves.toMatchObject({
      ok: true,
      lifecycle_state: 'review'
    });
  });

  test('ingest ARMS the RAG drain when concepts are pending (async; nothing chunked before ingest)', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    const { countByIndexStatus } = require('../services/concept-meta-service');
    countByIndexStatus.mockImplementation(async (_repoId, status) => (status === 'parsed' ? 7 : 13));
    const res = await lifecycleService.transition(REPO, 'ingest', { sub: 'steward-1' });
    expect(res.ingesting).toBe(true);
    expect(res.lifecycle_state).toBe('publish'); // stays publish until the drain completes
    const doc = mockDb._stores.okf_repositories[REPO];
    expect(doc.rag_drain_active).toBe(true);
    expect(doc.rag_ingestion).toMatchObject({
      status: 'draining',
      concepts_total: 20,
      concepts_done: 13,
      error: null
    });
    expect(doc.ingested_at).toBeUndefined(); // NOT serving yet — the worker settles
  });

  test('ingest with zero pending settles immediately (disarms + serving flags)', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      name: 'Demo Repo',
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    const res = await lifecycleService.transition(REPO, 'ingest', {});
    expect(res).toMatchObject({ ok: true, lifecycle_state: 'publish', ingested_version: 1 });
    const doc = mockDb._stores.okf_repositories[REPO];
    expect(doc.rag_drain_active).toBe(false); // disarmed by the settle
    expect(doc.rag_ingestion.status).toBe('completed');
    expect(doc.ingested_graph_name).toBe('OKF_demo-repo_v1');
  });

  // ── DRAIN FREEZE (David, 2026-09-12): while the RAG drain is in flight ──
  // ── NOTHING may modify the repo — transitions, content, PII state.     ──
  describe('drain freeze (rag_drain_active)', () => {
    test('transitions are frozen mid-drain → 409 DRAIN_IN_PROGRESS', async () => {
      for (const action of ['submit', 'approve', 'publish', 'ingest']) {
        seedRepo({ lifecycle_state: 'publish', version: 1, rag_drain_active: true });
        await expect(lifecycleService.transition(REPO, action, {})).rejects.toMatchObject({
          code: 'DRAIN_IN_PROGRESS',
          status: 409
        });
      }
    });

    test('retract stays AVAILABLE mid-drain (the wedge-recovery escape hatch)', async () => {
      seedRepo({
        lifecycle_state: 'publish',
        version: 1,
        ingested_at: 'x',
        ingested_version: 1,
        ingested_graph_name: 'OKF_demo-repo_v1',
        rag_drain_active: true
      });
      const res = await lifecycleService.transition(REPO, 'retract', {});
      expect(res).toMatchObject({ ok: true, lifecycle_state: 'retracted' });
      // Retract disarms the drain (the requeue path) — the freeze lifts.
      expect(mockDb._stores.okf_repositories[REPO].rag_drain_active).toBe(false);
    });

    // Live 2026-09-15 (Bali-wikipedia-LLM): the drain died at 6/1001 concepts
    // — NEVER settled (ingested_at null) — and the NOT_INGESTED guard refused
    // the teardown while 6 concepts sat indexed and the drain stayed armed.
    // The guard must accept the mid-FIRST-drain shape too; only a repo with
    // neither a settled ingest nor an armed drain has nothing to retract.
    test('retract tears down a MID-FIRST-DRAIN repo (never settled, drain armed)', async () => {
      seedRepo({
        lifecycle_state: 'publish',
        version: 2,
        ingested_at: null,
        ingested_version: null,
        ingested_graph_name: null,
        rag_drain_active: true,
        rag_ingestion: { status: 'draining', concepts_total: 1001, concepts_done: 6 }
      });
      const res = await lifecycleService.transition(REPO, 'retract', {});
      expect(res).toMatchObject({ ok: true, lifecycle_state: 'retracted' });
      const doc = mockDb._stores.okf_repositories[REPO];
      expect(doc.rag_drain_active).toBe(false);
      expect(doc.rag_ingestion.status).toBe('cancelled');
      expect(doc.rag_ingestion.concepts_total).toBe(0);
      expect(doc.ingested_version).toBeNull();
    });

    test('retract with nothing to tear down stays 409 NOT_INGESTED', async () => {
      seedRepo({ lifecycle_state: 'publish', version: 2, rag_drain_active: false });
      await expect(lifecycleService.transition(REPO, 'retract', {})).rejects.toMatchObject({
        code: 'NOT_INGESTED',
        status: 409
      });
    });

    test('assertWritable freezes PII/content mutations mid-drain', () => {
      expect(() => lifecycleService.assertWritable({ rag_drain_active: true })).toThrow(
        expect.objectContaining({ code: 'DRAIN_IN_PROGRESS', status: 409 })
      );
      // Non-draining repo is untouched by the freeze.
      expect(() => lifecycleService.assertWritable({ rag_drain_active: false })).not.toThrow();
    });
  });

  test('submit from retracted re-enters the loop (Retract → Edit → Review — David, 2026-09-04)', async () => {
    seedRepo({ lifecycle_state: 'retracted', version: 1 });
    await expect(lifecycleService.transition(REPO, 'submit', {})).resolves.toMatchObject({
      ok: true,
      lifecycle_state: 'review'
    });
  });

  test('BUILDING GATE: retract is exempt (a serving repo can never be building)', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      ingested_at: 'x',
      ingested_version: 1,
      ingested_graph_name: 'OKF_demo-repo_v1',
      name: 'Demo Repo'
    });
    const res = await lifecycleService.transition(REPO, 'retract', {});
    expect(res).toMatchObject({ ok: true, lifecycle_state: 'retracted' });
  });

  test('missing repo → 404 REPO_NOT_FOUND', async () => {
    await expect(lifecycleService.transition('nope', 'submit', {})).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });
});

describe('publish — mint + bundle export + serving cleared', () => {
  test('approve → publish: mints, exports the bundle, stamps the registry', async () => {
    seedRepo({ lifecycle_state: 'approve', version: null });
    mockDb.query.mockResolvedValueOnce({ all: async () => [7] }); // concept-count gate
    const res = await lifecycleService.transition(REPO, 'publish', { sub: 'steward-1' });

    expect(mintVersion).toHaveBeenCalledWith(REPO, { trigger: 'publish', acknowledgePii: false }, { sub: 'steward-1' });
    expect(exportBundle).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, action: 'publish', lifecycle_state: 'publish', bundle_version: 1 });

    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.lifecycle_state).toBe('publish');
    expect(repo.bundle).toMatchObject({ file_id: 'file-bundle-1', file_name: 'demo-v1.zip', bundle_version: 1 });
    expect(repo.ingested_at).toBeNull(); // the new version is NOT serving yet
    expect(repo.ingested_version).toBeNull();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.publish', bundle_version: 1, bundle_file_name: 'demo-v1.zip' })
    );
  });

  test('publish from publish (new version of a published repo) is legal', async () => {
    seedRepo({ lifecycle_state: 'publish', version: 1 });
    mockDb.query.mockResolvedValueOnce({ all: async () => [3] });
    await expect(lifecycleService.transition(REPO, 'publish', {})).resolves.toMatchObject({ ok: true });
  });

  test('publish from retracted is INVALID — a pulled repo re-enters via submit (David, 2026-09-11)', async () => {
    seedRepo({ lifecycle_state: 'retracted', version: 2 });
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 409,
      details: { current_state: 'retracted', allowed: ['approve', 'publish'] }
    });
    expect(mintVersion).not.toHaveBeenCalled();
  });

  test('ingest from retracted is INVALID — reuse of the retired version is forbidden (Kenya v11 incident)', async () => {
    seedRepo({ lifecycle_state: 'retracted', version: 2 });
    await expect(lifecycleService.transition(REPO, 'ingest', {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 409,
      details: { current_state: 'retracted', allowed: ['publish'] }
    });
  });

  test('submit from retracted is the ONLY exit (Retract → Review → Approve → Publish → Ingest)', async () => {
    seedRepo({ lifecycle_state: 'retracted', version: 2 });
    await expect(lifecycleService.transition(REPO, 'submit', {})).resolves.toMatchObject({
      ok: true,
      lifecycle_state: 'review'
    });
  });

  test('EMPTY repo refuses to publish (PUBLISH_EMPTY)', async () => {
    seedRepo({ lifecycle_state: 'approve' });
    mockDb.query.mockResolvedValueOnce({ all: async () => [0] });
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({
      code: 'PUBLISH_EMPTY',
      status: 409
    });
    expect(mintVersion).not.toHaveBeenCalled();
  });

  test('the mint publish gates pass through untouched (PUBLISH_GATE_BLOCKED)', async () => {
    seedRepo({ lifecycle_state: 'approve' });
    mockDb.query.mockResolvedValueOnce({ all: async () => [3] });
    const { LifecycleError } = lifecycleService;
    // Rejection shape comes from version-service; the lifecycle layer must not swallow it.
    mintVersion.mockRejectedValueOnce(new LifecycleError('PUBLISH_GATE_BLOCKED', '1 concept(s) not indexed: x', 409));
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({
      code: 'PUBLISH_GATE_BLOCKED',
      status: 409
    });
    expect(exportBundle).not.toHaveBeenCalled();
    expect(mockDb._stores.okf_repositories[REPO].lifecycle_state).toBe('approve'); // unchanged
  });

  test('bundle export failure fails the publish and leaves the state untouched', async () => {
    seedRepo({ lifecycle_state: 'approve' });
    mockDb.query.mockResolvedValueOnce({ all: async () => [3] });
    exportBundle.mockRejectedValueOnce(
      Object.assign(new Error('doc-repo down'), { code: 'EXPORT_FAILED', status: 502 })
    );
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    expect(mockDb._stores.okf_repositories[REPO].lifecycle_state).toBe('approve');
  });

  test('a recorded pii_ack waives the PII hit gate (acknowledgePii passthrough)', async () => {
    seedRepo({
      lifecycle_state: 'approve',
      pii_ack: { by: 'steward-1', at: '2026-08-30T00:00:00Z', flagged_concepts: 5 }
    });
    mockDb.query.mockResolvedValueOnce({ all: async () => [3] });
    await lifecycleService.transition(REPO, 'publish', { sub: 'steward-1' });
    expect(mintVersion).toHaveBeenCalledWith(REPO, { trigger: 'publish', acknowledgePii: true }, { sub: 'steward-1' });
  });

  test('publish from review is REFUSED — approve first', async () => {
    seedRepo({ lifecycle_state: 'review' });
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION'
    });
  });
});

describe('ingest / retract — the serving flag', () => {
  test('ingest: sets ingested_at + ingested_version (the Ingested lane)', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    const res = await lifecycleService.transition(REPO, 'ingest', {});
    expect(res).toMatchObject({ ok: true, ingested_version: 1 });
    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.ingested_at).toBeTruthy();
    expect(repo.ingested_version).toBe(1);
  });

  test('ingest without a published bundle → 409 NO_BUNDLE', async () => {
    seedRepo({ lifecycle_state: 'publish', version: 1 });
    await expect(lifecycleService.transition(REPO, 'ingest', {})).rejects.toMatchObject({
      code: 'NO_BUNDLE',
      status: 409
    });
  });

  test('ingest is IDEMPOTENT when the current version already serves', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      ingested_at: '2026-08-28T09:00:00Z',
      ingested_version: 1,
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    const res = await lifecycleService.transition(REPO, 'ingest', {});
    expect(res.already).toBe(true);
    expect(mockDb._stores.okf_repositories[REPO].ingested_at).toBe('2026-08-28T09:00:00Z');
  });

  test('retract: publish+serving → retracted (a pulled repo stays VISIBLE)', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      ingested_at: '2026-08-28T09:00:00Z',
      ingested_version: 1
    });
    const res = await lifecycleService.transition(REPO, 'retract', {});
    expect(res).toMatchObject({ ok: true, lifecycle_state: 'retracted', retracted_version: 1 });
    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.lifecycle_state).toBe('retracted');
    expect(repo.ingested_at).toBeNull();
    expect(repo.ingested_version).toBeNull();
  });

  test('retract without a serving version → 409 NOT_INGESTED', async () => {
    seedRepo({ lifecycle_state: 'publish', version: 1 });
    await expect(lifecycleService.transition(REPO, 'retract', {})).rejects.toMatchObject({
      code: 'NOT_INGESTED',
      status: 409
    });
  });

  test('ingest PROMOTES the graph: working → OKF_<slug>_v<N>, registry records it', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      name: 'Demo Repo',
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    const res = await lifecycleService.transition(REPO, 'ingest', {});
    expect(res.graph_name).toBe('OKF_demo-repo_v1');
    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.ingested_graph_name).toBe('OKF_demo-repo_v1');
    expect(repo.ingested_version).toBe(1);
  });

  test('retract DROPS the serving graph (D-C #981) — registry flags cleared, meta rows KEPT', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      name: 'Demo Repo',
      ingested_at: 'x',
      ingested_version: 1,
      ingested_graph_name: 'OKF_demo-repo_v1',
      graph_name: 'OKF_demo-repo_v2'
    });
    // A concept meta row that MUST survive the retract (retract ≠ delete).
    mockDb.collection('okf_concepts_meta').save({ _key: 'm1', repo_id: REPO, concept_id: 'index' });
    await lifecycleService.transition(REPO, 'retract', {});
    const repo = mockDb._stores.okf_repositories[REPO];
    expect(repo.ingested_graph_name).toBeNull();
    expect(repo.ingested_at).toBeNull();
    expect(repo.lifecycle_state).toBe('retracted');
    // The graph teardown ran: gharial cascade drops for BOTH candidate names.
    const dropPaths = mockDb.route.mock.calls.map((c) => c[0]).filter((p) => p.includes('_api/gharial/'));
    expect(dropPaths.some((p) => p.includes('OKF_demo-repo_v1'))).toBe(true);
    expect(dropPaths.some((p) => p.includes('OKF_demo-repo_v2'))).toBe(true);
    // The concept meta rows survive (retract ≠ delete cascade).
    expect(Object.keys(mockDb._stores.okf_concepts_meta || {}).length).toBe(1);
  });

  test('publish while SERVING → 409 REPO_READ_ONLY', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      ingested_at: 'x',
      ingested_version: 1,
      ingested_graph_name: 'OKF_demo-repo_v1'
    });
    await expect(lifecycleService.transition(REPO, 'publish', {})).rejects.toMatchObject({
      code: 'REPO_READ_ONLY',
      status: 409
    });
  });

  test('EVERY transition writes an audit row with user, timestamp and description (David, 2026-08-31)', async () => {
    const actor = { sub: 'steward-9', name: 'Steward Nine' };
    seedRepo({
      lifecycle_state: 'publish',
      version: 1,
      name: 'Demo Repo',
      bundle: { file_id: 'f1', file_name: 'demo-v1.zip', bundle_version: 1 }
    });
    await lifecycleService.transition(REPO, 'ingest', actor);
    await lifecycleService.transition(REPO, 'retract', actor);
    // audit-service is a jest mock in this file — assert the PAYLOADS it received.
    const { writeAudit } = require('../services/audit-service');
    const calls = writeAudit.mock.calls.map((c) => c[0]);
    const ingestRow = calls.find((r) => r.action === 'repo.ingest');
    const retractRow = calls.find((r) => r.action === 'repo.retract');
    for (const row of [ingestRow, retractRow]) {
      expect(row).toBeTruthy();
      expect(row.actor).toBe('steward-9');
      expect(row.actor_name).toBe('Steward Nine');
      expect(typeof row.description).toBe('string');
      expect(row.description.length).toBeGreaterThan(5);
    }
    expect(ingestRow.description).toContain('version 1');
    expect(ingestRow.description).toContain('OKF_demo-repo_v1');
    expect(retractRow.description).toContain('Retracted version 1');
  });
});

describe('delete guard — an ingested repository cannot be deleted', () => {
  test('repository-service.remove refuses while serving (INGESTED_DELETE_BLOCKED)', async () => {
    seedRepo({ lifecycle_state: 'publish', ingested_at: '2026-08-28T09:00:00Z', ingested_version: 1 });
    await expect(repoService.remove(REPO, { sub: 'steward-1' })).rejects.toMatchObject({
      code: 'INGESTED_DELETE_BLOCKED',
      status: 409
    });
  });

  test('remove is still allowed for a retracted repo (not serving)', async () => {
    seedRepo({ lifecycle_state: 'retracted', ingested_at: null, ingested_version: null });
    // The cascade retract (graph drop) runs best-effort; the registry row is removed.
    await expect(repoService.remove(REPO, { sub: 'steward-1' })).resolves.toMatchObject({ status: 'deleted' });
    expect(mockDb._stores.okf_repositories[REPO]).toBeUndefined();
  });
});

describe('delete idempotency — a racing double-fire DELETE must not 500 (David, 2026-09-06)', () => {
  // Live-verified 2026-09-05 17:57: two DELETEs for the same repo raced; the
  // loser 500'd ("Unhandled OKF error") on the registry remove AFTER the
  // winner had fully deleted the repo. The cascade drops were already
  // idempotent — the registry entry remove was the one seam that was not.
  test('loser of the race (registry doc already gone) still resolves {status: deleted}', async () => {
    seedRepo({ lifecycle_state: 'draft' });
    // Both requests passed the existence check; the winner removed the doc by
    // the time the loser reaches its registry remove — 404-class error.
    mockDb
      .collection('okf_repositories')
      .remove.mockRejectedValueOnce(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202, statusCode: 404 })
      );
    await expect(repoService.remove(REPO, { sub: 'steward-1' })).resolves.toMatchObject({
      status: 'deleted',
      repo_id: REPO
    });
  });

  test('a draft that never built a graph deletes cleanly (cascade no-op, no 500)', async () => {
    seedRepo({ lifecycle_state: 'draft', graph_name: null, ingested_at: null });
    await expect(repoService.remove(REPO, { sub: 'steward-1' })).resolves.toMatchObject({ status: 'deleted' });
    expect(mockDb._stores.okf_repositories[REPO]).toBeUndefined();
  });

  test('a genuinely broken registry remove (connectivity) still throws', async () => {
    seedRepo({ lifecycle_state: 'draft' });
    mockDb
      .collection('okf_repositories')
      .remove.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8529'), { code: 'ECONNREFUSED' })
      );
    await expect(repoService.remove(REPO, { sub: 'steward-1' })).rejects.toThrow(/ECONNREFUSED/);
  });
});

test('P0: retract REQUEUES the meta rows (the drain queue reset)', async () => {
  seedRepo({
    lifecycle_state: 'publish',
    version: 1,
    ingested_at: 'x',
    ingested_version: 1,
    ingested_graph_name: 'OKF_demo-repo_v1'
  });
  await lifecycleService.transition(REPO, 'retract', {});
  // v9-wedge fix: the requeue re-stamps rows to the NEXT draft name, so the
  // re-drain can never write into a dropped graph's name again.
  expect(require('../services/concept-meta-service').requeueRepoForRedrain).toHaveBeenCalledWith(REPO, {
    graphName: 'OKF_demo_v2'
  });
});

test('v9-wedge: ingest-arms stamps every row to the drain serving name', async () => {
  seedRepo({
    lifecycle_state: 'publish',
    version: 3,
    bundle: { file_id: 'f1' },
    rag_drain_active: false
  });
  const meta = require('../services/concept-meta-service');
  meta.countByIndexStatus.mockResolvedValueOnce(2).mockResolvedValueOnce(0); // parsed, then indexed
  await lifecycleService.transition(REPO, 'ingest', { sub: 'steward-1' });
  expect(meta.stampRepoGraphName).toHaveBeenCalledWith(REPO, 'OKF_demo_v3');
});

test('retract refuses loudly when the graph teardown fails (no state flip)', async () => {
  seedRepo({
    lifecycle_state: 'publish',
    version: 1,
    ingested_at: 'x',
    ingested_version: 1,
    ingested_graph_name: 'OKF_demo-repo_v1'
  });
  const graphRetract = require('../services/graph-retract-service');
  const spy = jest.spyOn(graphRetract, 'dropRepoGraphsForRepo').mockRejectedValueOnce(new Error('db boom'));
  await expect(lifecycleService.transition(REPO, 'retract', {})).rejects.toMatchObject({
    code: 'GRAPH_TEARDOWN_FAILED'
  });
  spy.mockRestore();
  const doc = mockDb._stores.okf_repositories[REPO];
  expect(doc.lifecycle_state).toBe('publish'); // the state never flips on a half-drop
  expect(doc.ingested_version).toBe(1); // still serving — retry is safe
});
// ── Card-lies fix (David, 2026-09-09): stale failed_concepts must never ──
// ── survive into a fresh record — ArangoDB update() deep-merges nested ───
// ── objects, so every writer writes the COMPLETE shape, every time. ──────
describe('rag_ingestion.failed_concepts ownership (card-lies fix)', () => {
  test('the ingest ARM writes failed_concepts: [] — no carry-over from a prior failed drain', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 2,
      name: 'Demo Repo',
      bundle: { file_id: 'f1', file_name: 'demo-v2.zip', bundle_version: 2 },
      // The stale record from the PREVIOUS failed drain (what leaked before).
      rag_ingestion: {
        status: 'failed',
        requested_at: '2026-09-09T00:00:00Z',
        finished_at: '2026-09-09T00:05:00Z',
        concepts_total: 5,
        concepts_done: 4,
        error: '1 concept(s) failed to index — re-ingest them',
        failed_concepts: [{ concept_id: 'huduma-kenya', error: 'LLM 502' }]
      }
    });
    require('../services/concept-meta-service').countByIndexStatus.mockResolvedValue(0);
    await lifecycleService.transition(REPO, 'ingest', { sub: 'steward-1' });
    const rec = mockDb._stores.okf_repositories[REPO].rag_ingestion;
    expect(rec.failed_concepts).toEqual([]);
    expect(rec.status).toBe('completed'); // nothing pending → settled immediately
  });

  test('a completed settle writes failed_concepts [] — never the stale list', async () => {
    seedRepo({
      lifecycle_state: 'publish',
      version: 2,
      name: 'Demo Repo',
      bundle: { file_id: 'f1', file_name: 'demo-v2.zip', bundle_version: 2 }
    });
    require('../services/concept-meta-service').countByIndexStatus.mockResolvedValue(0);
    await lifecycleService.transition(REPO, 'ingest', { sub: 'steward-1' });
    const rec = mockDb._stores.okf_repositories[REPO].rag_ingestion;
    expect(rec.status).toBe('completed');
    expect(rec.failed_concepts).toEqual([]);
  });
});
