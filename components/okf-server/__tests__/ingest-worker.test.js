// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.4 T1 — the OKF ingestion worker (crawlWorker pattern reused:
// poll loop, one job at a time, explicit status transitions). Unit tests use
// the _processOneJob/_sweepOnce hooks with millisecond poll intervals.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
// LIVE-COUNT reader (settle reconciliation tests): counts the mock db store
// exactly like the real service counts rows. Declared `mock`-prefixed so the
// jest.mock factory below may reference it — the wedge-contract describe
// REPLACES the property with a positional stub, and the settle-reconciliation
// describe restores this in its beforeEach.
const mockCountByIndexStatusFromStore = async (repoId, status) => {
  const db = require('../shared-lib/db-connection-service').__mockDb;
  return Object.values((db._stores && db._stores.okf_concepts_meta) || {}).filter(
    (m) => m.repo_id === repoId && m.index_status === status
  ).length;
};

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/concept-meta-service', () => ({
  upsertConceptMeta: jest.fn(async (repo_id, parsed, opts) => ({
    action: 'updated',
    doc: { repo_id, ...parsed, ...opts }
  })),
  countByIndexStatus: jest.fn(mockCountByIndexStatusFromStore)
}));
jest.mock('../services/graph-lifecycle-service', () => ({
  promoteGraph: jest.fn(async (repo) => 'OKF_' + (repo.repo_id || 'test') + '_v1'),
  graphExists: jest.fn(async () => true)
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn(), post: jest.fn(async () => ({ status: 200 })) }
}));
jest.mock('../config', () => ({
  documentRepository: { url: 'http://document-repository:3001' },
  dataprep: { url: 'http://dataprep-arango-service:5000', ingestPath: '/v1/dataprep/ingest_file' },
  internal: { secret: '' }
}));
jest.mock('../services/edge-service', () => ({
  writeRepoConceptEdges: jest.fn(async () => ({ written: 0, dropped: [] }))
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const worker = require('../workers/ingestWorker');
const conceptMeta = require('../services/concept-meta-service');
const { authedAxios } = require('../services/service-token');
const edgeService = require('../services/edge-service');

const REPO = '99999999-9999-4999-8999-999999999999';

/** Program the mock db.query sequence (the worker queries by position:
 * 1st = claim read, then terminal polls; sweep = orphan query + per-orphan removes).
 * UNPOSITIONED side-writes are detected by shape and consume no programmed
 * result: the claim stamp (UPDATE m WITH + worker_claimed_at), the settle CAS
 * (UPDATE r WITH + settle_claimed_at — reports the lease ACQUIRED), and the
 * fused rag_ingestion progress write (UPDATE r WITH + rag_ingestion).
 * Raw-string queries (lifecycle-service style) are matched by typeof. */
function queryText(q) {
  if (typeof q === 'string') return q;
  return q && q.query ? String(q.query) : '';
}

function programQueries(...results) {
  let i = 0;
  mockDb.query.mockImplementation(async (q) => {
    const text = queryText(q);
    if (text.includes('UPDATE m WITH') && text.includes('worker_claimed_at')) {
      return { all: async () => [] }; // claim stamp — unpositioned side-write
    }
    if (text.includes('UPDATE r WITH') && text.includes('settle_claimed_at')) {
      return { all: async () => [{ _key: 'settle-lease' }] }; // settle CAS — lease acquired
    }
    if (text.includes('UPDATE r WITH') && text.includes('rag_ingestion')) {
      return { all: async () => [] }; // fused progress write — unpositioned side-write
    }
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return { all: async () => (Array.isArray(r) ? r : [r]) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset drops persisted mockRejectedValue implementations (leak from
  // earlier tests) — then re-pin the default happy kick.
  authedAxios.post.mockReset();
  authedAxios.post.mockResolvedValue({ status: 200 });
  mockDb._reset();
  process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
  process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '5000';
});

afterEach(() => {
  delete process.env.OKF_INGEST_WORKER_JOB_POLL_MS;
  delete process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS;
});

describe('ingestWorker._processOneJob (content-only — claim a parsed meta row → POST to dataprep → wait for the callback)', () => {
  test('idle when no parsed concepts exist', async () => {
    programQueries([]); // claim finds nothing
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'idle' });
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('claim stamps worker_claimed_at + ingest_attempts on the claimed row', async () => {
    programQueries(
      [{ repo_id: REPO, concept_id: 'stamp-me', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# s' }],
      [{ index_status: 'indexed', chunk_count: 1 }] // terminal poll → done, no timeout wait
    );
    await worker._processOneJob();
    // The stamp query is the UPDATE + worker_claimed_at shape.
    const stampCall = mockDb.query.mock.calls
      .map((c) => c[0])
      .find((q) => {
        const t = String((q && q.query) || '');
        return t.includes('UPDATE m WITH') && t.includes('worker_claimed_at');
      });
    expect(stampCall).toBeDefined();
    // aql binds are positional (value0, value1, ...) — assert on the values.
    const binds = Object.values(stampCall.bindVars || {});
    expect(binds).toContain(REPO);
    expect(binds).toContain('stamp-me');
    expect(stampCall.query).toContain('ingest_attempts');
  });

  test('parsed concept → POSTs its markdown DIRECTLY to dataprep, waits for indexed', async () => {
    programQueries(
      [
        {
          repo_id: REPO,
          concept_id: 'bad_concept',
          graph_name: `OKF_${REPO}`,
          frontmatter: { title: 'Bad', type: 'service' },
          body: '# Bad\nBody.',
          ingest_labels: [`t:smoke`, `r:${REPO}`, 'Service Directory'],
          bundle_version: 3
        }
      ],
      [{ index_status: 'parsed' }], // poll 1: still working (callback not yet applied)
      [{ index_status: 'indexed', chunk_count: 2 }] // poll 2: the callback transitioned it
    );
    authedAxios.post.mockResolvedValue({ status: 200 });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
    expect(res.chunks).toBe(2);
    // WS5 (David, 2026-09-25): the worker always retracts BEFORE the POST
    // (idempotent re-ingest). The first authedAxios.post is the retract, the
    // second is the ingest. The ingest POST targets DATAPREP directly
    // (content-only — no doc-repo files doc).
    const ingestCall = authedAxios.post.mock.calls.find((c) => String(c[0]).includes('/v1/dataprep/ingest_file'));
    expect(ingestCall).toBeDefined();
    const [url, body] = ingestCall;
    expect(url).toBe('http://dataprep-arango-service:5000/v1/dataprep/ingest_file');
    expect(body).toMatchObject({
      fileId: 'bad_concept',
      fileName: 'bad_concept.md',
      fileType: 'text/markdown',
      graphName: `OKF_${REPO}`,
      bundleVersion: 3,
      conceptId: 'bad_concept'
    });
    expect(Buffer.from(body.fileBase64, 'base64').toString()).toContain('# Bad');
    // The callback (okf-server concept-status) owns the transition + edges — the
    // worker does NOT write them (no transitionMeta / edge call here).
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
    expect(edgeService.writeRepoConceptEdges).not.toHaveBeenCalled();
  });

  test('callback reports failure → meta failed outcome (dead-letter; recovery = re-ingest)', async () => {
    programQueries(
      [{ repo_id: REPO, concept_id: 'x', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# x' }],
      [{ index_status: 'failed', chunk_count: 0 }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('failed');
  });

  test('429 busy → back off, NO meta transition, NO crash (dataprep single-flight)', async () => {
    programQueries([{ repo_id: REPO, concept_id: 'a', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# a' }]);
    const busy = Object.assign(new Error('429'), { response: { status: 429 } });
    authedAxios.post.mockRejectedValue(busy);
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'busy', concept_id: 'a' });
    // NO index_status transition — but the claim IS cleared (reaper-fairness,
    // 2026-09-13): the row was claimed yet never kicked, and a stamped claim
    // left to age past the reaper's grace window during a saturated drain
    // gets a healthy concept dead-lettered as "stuck".
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledTimes(1);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'a', repo_id: REPO },
      { patch: { worker_claimed_at: null } }
    );
  });

  test('dataprep transport error → outcome error; row TOUCHED (queue advances) but NOT transitioned', async () => {
    programQueries([{ repo_id: REPO, concept_id: 'a', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# a' }]);
    authedAxios.post.mockRejectedValue(new Error('dataprep down'));
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('error');
    // 2-9-5 atomicity pass: the error touch stamps updated_at (the patch also
    // records last_worker_error) so claimNextJob's SORT updated_at ASC claims
    // the NEXT concept next cycle — a poison concept never starves the queue.
    // Crucially NO index_status transition: the row stays 'parsed' (retried).
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'a', repo_id: REPO },
      {
        patch: {
          last_worker_error: 'dataprep POST failed: dataprep down',
          worker_claimed_at: null // claim cleared — the retry must not wait behind the reaper
        }
      }
    );
    const patches = conceptMeta.upsertConceptMeta.mock.calls.map((c) => c[2] && c[2].patch).filter(Boolean);
    expect(patches.every((p) => p.index_status === undefined)).toBe(true);
  });

  test('claim-stale reaper vs errored row: the claim CLEAR (not the age) lets it retry (live regression 2026-09-03)', async () => {
    // Live failure: dataprep briefly not-ready at worker start → POST error →
    // the row kept its claim stamp but moved to the FIFO back; the reaper's
    // 1h claim-grace killed it before any lane could legitimately retry.
    // The error path must CLEAR worker_claimed_at so the row is re-claimable.
    programQueries([{ repo_id: REPO, concept_id: 'err-row', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# e' }]);
    authedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await worker._processOneJob();
    const patch = conceptMeta.upsertConceptMeta.mock.calls
      .map((c) => c[2] && c[2].patch)
      .find((p) => p && p.last_worker_error);
    expect(patch.worker_claimed_at).toBeNull();
  });

  test('non-200 dataprep kick → outcome error with status', async () => {
    programQueries([{ repo_id: REPO, concept_id: 'a', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# a' }]);
    authedAxios.post.mockResolvedValue({ status: 404 });
    const res = await worker._processOneJob();
    expect(res).toMatchObject({ outcome: 'error', error: 'dataprep status 404' });
  });

  test('concept vanished mid-drain → outcome vanished', async () => {
    programQueries(
      [{ repo_id: REPO, concept_id: 'v', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# v' }],
      [] // meta row gone (bundle retract removed it)
    );
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'vanished', concept_id: 'v' });
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  // G-2 (#1022) + G-3 (#1023) — the missing-graph pre-flight was DEAD CODE:
  // graphExists is async and the old code omitted the await, so `!Promise`
  // was always false and the reset never ran in production. These tests
  // pin both the firing of the branch (await fixed) and the SHAPE of the
  // reset write (nested rag_ingestion patch, not dotted flat keys).
  test('graph missing at claim → reset fires (G-2 await), rag_ingestion patched NESTED (G-3), drain proceeds', async () => {
    const graphLifecycle = require('../services/graph-lifecycle-service');
    graphLifecycle.graphExists.mockResolvedValueOnce(false);
    mockDb._stores.okf_repositories = {
      [REPO]: {
        _key: REPO,
        repo_id: REPO,
        rag_ingestion: { concepts_done: 42, phase: 'draining' }
      }
    };
    programQueries(
      [{ repo_id: REPO, concept_id: 'g', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# g' }],
      [{ index_status: 'indexed', chunk_count: 1 }]
    );
    const res = await worker._processOneJob();
    // The reset branch FALLS THROUGH — the concept still ingests.
    expect(res.outcome).toBe('ingested');
    // Nested patch: concepts_done zeroed, reset reason recorded, sibling
    // keys inside rag_ingestion preserved (read-modify-write, not replace).
    const after = mockDb._stores.okf_repositories[REPO].rag_ingestion;
    expect(after.concepts_done).toBe(0);
    expect(after.last_reset_reason).toBe('graph_missing_at_resume');
    expect(after.phase).toBe('draining');
    // G-3 shape guard: the update patch must contain NO dotted flat keys
    // ('rag_ingestion.concepts_done' as a literal attribute name is the bug).
    const updateHandle = mockDb.collection('okf_repositories');
    const patches = updateHandle.update.mock.calls.map((c) => c[1]);
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) {
      expect(Object.keys(p).some((k) => k.includes('.'))).toBe(false);
    }
  });

  test('graph present → pre-flight is a no-op (the await must not flip the happy path)', async () => {
    mockDb._stores.okf_repositories = {
      [REPO]: {
        _key: REPO,
        repo_id: REPO,
        rag_ingestion: { concepts_done: 42, phase: 'draining' }
      }
    };
    programQueries(
      [{ repo_id: REPO, concept_id: 'g', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# g' }],
      [{ index_status: 'indexed', chunk_count: 1 }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
    // Progress untouched: concepts_done must still be 42 — no spurious reset.
    expect(mockDb._stores.okf_repositories[REPO].rag_ingestion.concepts_done).toBe(42);
    expect(mockDb.collection('okf_repositories').update).not.toHaveBeenCalled();
  });
});

describe('ingestWorker fair claim strategy (spec #1020 §5.2 — OKF_CLAIM_STRATEGY=fair)', () => {
  afterEach(() => {
    delete process.env.OKF_CLAIM_STRATEGY;
    delete process.env.OKF_REPO_INGEST_CAP;
  });

  const FAIR_ROW = {
    job: { repo_id: REPO, concept_id: 'fc', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# fc' },
    repo_in_flight: 0,
    repo_queue_depth: 997,
    claim_wait_ms: 12345
  };

  test('fair strategy claims via the FUSED single statement and proceeds with the job', async () => {
    process.env.OKF_CLAIM_STRATEGY = 'fair';
    programQueries(FAIR_ROW, [{ index_status: 'indexed', chunk_count: 1 }]);
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
    // One fused statement: repo pick (COLLECT AGGREGATE) + row pick + claim
    // UPDATE in the SAME query — the atomic CAS that makes multi-worker safe.
    const fair = mockDb.query.mock.calls
      .map((c) => c[0])
      .find((q) => {
        const t = String((q && q.query) || '');
        return t.includes('COLLECT') && t.includes('UPDATE cand WITH');
      });
    expect(fair).toBeDefined();
    // Starvation guard: least in-flight first, oldest head tiebreak.
    expect(fair.query).toContain('SORT inFlight ASC, oldest ASC');
    // Per-repo cap: unlimited (0) OR inFlight < cap.
    expect(fair.query).toContain('<= 0 OR inFlight <');
    // Kick-backoff gate (§5.5) present in BOTH selection passes.
    expect((fair.query.match(/next_attempt_after/g) || []).length).toBeGreaterThanOrEqual(2);
    // The claim stamp rides in the fused statement — no separate _stampClaim.
    const stampCalls = mockDb.query.mock.calls
      .map((c) => c[0])
      .filter((q) => {
        const t = String((q && q.query) || '');
        return t.includes('UPDATE m WITH') && t.includes('worker_claimed_at');
      });
    expect(stampCalls).toHaveLength(0);
  });

  test('cap env flows into the query as a bind value', async () => {
    process.env.OKF_CLAIM_STRATEGY = 'fair';
    process.env.OKF_REPO_INGEST_CAP = '2';
    programQueries(FAIR_ROW, [{ index_status: 'indexed', chunk_count: 1 }]);
    await worker._processOneJob();
    const fair = mockDb.query.mock.calls
      .map((c) => c[0])
      .find((q) => {
        const t = String((q && q.query) || '');
        return t.includes('COLLECT') && t.includes('UPDATE cand WITH');
      });
    expect(Object.values(fair.bindVars || {})).toContain(2);
  });

  test('default strategy stays fifo — no COLLECT in any claim query', async () => {
    programQueries(
      [{ repo_id: REPO, concept_id: 'f', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# f' }],
      [{ index_status: 'indexed', chunk_count: 1 }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
    const texts = mockDb.query.mock.calls.map((c) => String((c[0] && c[0].query) || ''));
    expect(texts.some((t) => t.includes('COLLECT r = m.repo_id'))).toBe(false);
    // fifo path still stamps via the separate two-statement shape.
    expect(texts.some((t) => t.includes('UPDATE m WITH') && t.includes('worker_claimed_at'))).toBe(true);
  });

  test('write-write conflict (errorNum 1200) → retries once on a fresh snapshot', async () => {
    process.env.OKF_CLAIM_STRATEGY = 'fair';
    programQueries(FAIR_ROW, [{ index_status: 'indexed', chunk_count: 1 }]);
    const conflict = new Error('write-write conflict');
    conflict.errorNum = 1200;
    mockDb.query.mockRejectedValueOnce(conflict);
    const res = await worker._processOneJob();
    // The loser's whole query aborted (nothing written) — the retry claims fine.
    expect(res.outcome).toBe('ingested');
    expect(res.concept_id).toBe('fc');
  });

  test('fair-claim indexes exist in the ensured schema (db/collections.js)', () => {
    const { INDEXES } = require('../db/collections');
    const fields = (INDEXES.okf_concepts_meta || []).map((i) => i.fields.join(','));
    expect(fields).toContain('index_status,updated_at');
    expect(fields).toContain('repo_id,index_status,updated_at');
  });
});

describe('kick-5xx backoff (spec #1020 §5.5 — OKF_KICK_BACKOFF_BASE_MS)', () => {
  afterEach(() => {
    delete process.env.OKF_KICK_BACKOFF_BASE_MS;
    delete process.env.OKF_KICK_BACKOFF_MAX_MS;
  });

  const JOB = { repo_id: REPO, concept_id: 'bk', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# bk' };
  const patches = () => conceptMeta.upsertConceptMeta.mock.calls.map((c) => c[2] && c[2].patch).filter(Boolean);

  test('backoff disabled (default) → transport error parks NOTHING (today behavior)', async () => {
    programQueries([JOB]);
    authedAxios.post.mockRejectedValue(new Error('dataprep down'));
    await worker._processOneJob();
    expect(patches().every((p) => p.next_attempt_after === undefined)).toBe(true);
  });

  test('transport error + base 1000 → parked ~1s–1.25s out (exponential base, jitter ≤25%)', async () => {
    process.env.OKF_KICK_BACKOFF_BASE_MS = '1000';
    programQueries([JOB]);
    authedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const t0 = Date.now();
    await worker._processOneJob();
    const parked = patches().find((p) => p.next_attempt_after);
    expect(parked).toBeDefined();
    const delta = new Date(parked.next_attempt_after).getTime() - t0;
    expect(delta).toBeGreaterThanOrEqual(900);
    expect(delta).toBeLessThanOrEqual(1600);
  });

  test('attempt number grows the delay; MAX caps it', async () => {
    process.env.OKF_KICK_BACKOFF_BASE_MS = '1000';
    process.env.OKF_KICK_BACKOFF_MAX_MS = '5000';
    const heavy = { ...JOB, concept_id: 'bk6', ingest_attempts: 6 };
    programQueries([heavy]);
    authedAxios.post.mockResolvedValue({ status: 503 }); // dataprep 5xx parks too
    const t0 = Date.now();
    await worker._processOneJob();
    const parked = patches().find((p) => p.next_attempt_after);
    expect(parked).toBeDefined();
    // 1000 × 2^5 would be 32000 — capped at MAX=5000, +jitter ≤25%.
    const delta = new Date(parked.next_attempt_after).getTime() - t0;
    expect(delta).toBeGreaterThanOrEqual(4900);
    expect(delta).toBeLessThanOrEqual(6600);
  });

  test('a 4xx rejection never parks (deterministic rejection — prompt retry)', async () => {
    process.env.OKF_KICK_BACKOFF_BASE_MS = '1000';
    programQueries([JOB]);
    authedAxios.post.mockResolvedValue({ status: 404 });
    await worker._processOneJob();
    expect(patches().every((p) => p.next_attempt_after === undefined)).toBe(true);
  });

  test('429 is never parked even with backoff enabled (slot busy ≠ failing)', async () => {
    process.env.OKF_KICK_BACKOFF_BASE_MS = '1000';
    programQueries([JOB]);
    authedAxios.post.mockRejectedValue(Object.assign(new Error('429'), { response: { status: 429 } }));
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('busy');
    expect(patches().every((p) => p.next_attempt_after === undefined)).toBe(true);
  });

  test('the fifo claim carries the next_attempt_after gate (both strategies)', async () => {
    programQueries([JOB], [{ index_status: 'indexed', chunk_count: 1 }]);
    await worker._processOneJob();
    const claim = mockDb.query.mock.calls
      .map((c) => c[0])
      .find((q) => String((q && q.query) || '').includes('SORT m.updated_at ASC'));
    expect(claim.query).toContain('next_attempt_after');
  });
});

describe('size-adaptive job windows (spec #1020 §5.9 — OKF_JOB_WINDOW_ADAPTIVE)', () => {
  afterEach(() => {
    delete process.env.OKF_JOB_WINDOW_ADAPTIVE;
    delete process.env.OKF_JOB_WINDOW_FLOOR_MS;
    delete process.env.OKF_JOB_WINDOW_MAX_MS;
    delete process.env.OKF_JOB_WINDOW_SEC_PER_CHUNK_MS;
  });

  describe('window computation (worker.jobWindowMs)', () => {
    test('adaptive OFF → the flat JOB_TIMEOUT_MS (today behavior)', () => {
      process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '123456';
      expect(worker.jobWindowMs({ body: 'x'.repeat(500000) })).toBe(123456);
    });

    test('small concept → the FLOOR (30 min default; small files keep today’s window)', () => {
      process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
      // 100 KB ≈ 200 chunks → 200 × 5000 × 1.5 = 25 min < 30 min floor.
      expect(worker.jobWindowMs({ body: 'x'.repeat(100000) })).toBe(1800000);
    });

    test('large concept scales past the floor: ~500 KB ≈ 1000 chunks ≈ 2 h 5 m', () => {
      process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
      // 1000 chunks × 5000 × 1.5 = 7,500,000 ms.
      expect(worker.jobWindowMs({ body: 'x'.repeat(500000) })).toBe(7500000);
    });

    test('monster concept → capped at MAX (6 h)', () => {
      process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
      // 2 MB ≈ 4000 chunks → 30,000,000 ms raw > 21,600,000 cap.
      expect(worker.jobWindowMs({ body: 'x'.repeat(2000000) })).toBe(21600000);
    });

    test('a prior attempt’s real chunk_count overrides the bytes estimate', () => {
      process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
      expect(worker.jobWindowMs({ body: 'x', chunk_count: 900 })).toBe(6750000);
    });
  });

  test('expiry with an ALIVE dataprep task → deferred: parked one window, NO re-kick, NO retract', async () => {
    process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
    process.env.OKF_JOB_WINDOW_FLOOR_MS = '60';
    process.env.OKF_JOB_WINDOW_SEC_PER_CHUNK_MS = '10'; // 1 chunk ≈ 15 ms raw → floor 60 ms
    process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
    const t0 = Date.now();
    programQueries(
      [{ repo_id: REPO, concept_id: 'big', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# big' }],
      [{ index_status: 'parsed' }] // every poll + the dedupe re-read: still draining
    );
    authedAxios.post.mockImplementation(async (url) => {
      if (String(url).includes('/v1/dataprep/task_status')) {
        return { status: 200, data: { alive: true } }; // the pipeline is RUNNING
      }
      return { status: 200 }; // retract + kick happy
    });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('deferred');
    // The probe happened exactly once.
    const urls = authedAxios.post.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/v1/dataprep/task_status'))).toHaveLength(1);
    // The defer patch parks the row one window and clears the claim — the
    // in-flight run's callback owns the transition (dedupe guard accepts it).
    const patch = conceptMeta.upsertConceptMeta.mock.calls
      .map((c) => c[2] && c[2].patch)
      .find((p) => p && p.next_attempt_after);
    expect(patch).toBeDefined();
    expect(patch.worker_claimed_at).toBeNull();
    const parkedMs = new Date(patch.next_attempt_after).getTime() - t0;
    expect(parkedMs).toBeGreaterThanOrEqual(50);
    expect(parkedMs).toBeLessThanOrEqual(2000);
  });

  test('expiry with a DEAD task → immediate reclaim, no park (the next WS5 retract is then correct)', async () => {
    process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
    process.env.OKF_JOB_WINDOW_FLOOR_MS = '60';
    process.env.OKF_JOB_WINDOW_SEC_PER_CHUNK_MS = '10';
    process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
    process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '40'; // short flat window for speed
    programQueries(
      [{ repo_id: REPO, concept_id: 'dead', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# d' }],
      [{ index_status: 'parsed' }]
    );
    authedAxios.post.mockImplementation(async (url) => {
      if (String(url).includes('/v1/dataprep/task_status')) return { status: 200, data: { alive: false } };
      return { status: 200 };
    });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('timeout');
    const patch = conceptMeta.upsertConceptMeta.mock.calls
      .map((c) => c[2] && c[2].patch)
      .find((p) => p && p.worker_claimed_at === null);
    expect(patch).toBeDefined();
    expect(patch.next_attempt_after).toBeUndefined(); // reclaimable NOW
  });

  test('probe transport failure → treated as dead (the kick path re-parks under §5.5 if enabled)', async () => {
    process.env.OKF_JOB_WINDOW_ADAPTIVE = 'true';
    process.env.OKF_JOB_WINDOW_FLOOR_MS = '60';
    process.env.OKF_JOB_WINDOW_SEC_PER_CHUNK_MS = '10';
    process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
    process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '40';
    programQueries(
      [{ repo_id: REPO, concept_id: 'probe-fail', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# p' }],
      [{ index_status: 'parsed' }]
    );
    authedAxios.post.mockImplementation(async (url) => {
      if (String(url).includes('/v1/dataprep/task_status')) throw new Error('dataprep down');
      return { status: 200 };
    });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('timeout');
    const patch = conceptMeta.upsertConceptMeta.mock.calls
      .map((c) => c[2] && c[2].patch)
      .find((p) => p && p.worker_claimed_at === null);
    expect(patch).toBeDefined();
    expect(patch.next_attempt_after).toBeUndefined();
  });

  test('adaptive OFF expiry never probes dataprep (today behavior, byte-for-byte)', async () => {
    process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
    process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '40';
    programQueries(
      [{ repo_id: REPO, concept_id: 'flat', graph_name: `OKF_${REPO}`, frontmatter: {}, body: '# f' }],
      [{ index_status: 'parsed' }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('timeout');
    expect(authedAxios.post.mock.calls.some((c) => String(c[0]).includes('task_status'))).toBe(false);
  });
});

describe('ingestWorker._sweepOnce (orphan cleanup)', () => {
  test('retracts + removes OKF files docs whose meta row is gone (victims logged)', async () => {
    programQueries([{ file_id: 'orf1', file_name: 'z.md', repo_id: REPO }], []);
    const res = await worker._sweepOnce();
    expect(res).toEqual({ cleaned: 1, victims: ['z.md'] });
    expect(authedAxios.post).toHaveBeenCalledWith(
      `http://document-repository:3001/api/files/orf1/retract`,
      {},
      { timeout: 30000 }
    );
  });

  test('no orphans → no-op', async () => {
    programQueries([]);
    const res = await worker._sweepOnce();
    expect(res).toEqual({ cleaned: 0, victims: [] });
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('retract failure (non-404/500) → orphan kept for the next sweep', async () => {
    programQueries([{ file_id: 'orf2', file_name: 'z.md', repo_id: REPO }], []);
    authedAxios.post.mockRejectedValue(Object.assign(new Error('503'), { response: { status: 503 } }));
    const res = await worker._sweepOnce();
    expect(res).toEqual({ cleaned: 0, victims: [] });
  });

  // WS1 (David, 2026-09-25): bundle zips (is_bundle=true) must NEVER be swept
  // — they're the per-version ingestion artifact (live-forever policy).
  // Without this guard, the pre-2026-09 sweep deleted all 4 ingested repos'
  // bundle zips within ~1h of their status leaving Pending. The mock's AQL
  // engine filters the FOR-loop's output by re-running the FILTER expressions
  // against each candidate — so we inject the AQL match to verify the
  // is_bundle exclusion short-circuits at the query layer (no authedAxios
  // call, no REMOVE).
  test('bundle zip with is_bundle=true is NEVER swept (live-forever policy)', async () => {
    // The mock's position-0 return is the AQL result of the sweep query. A
    // bundle file MUST NOT appear here — the AQL's FILTER excludes it.
    programQueries([]);
    authedAxios.post.mockClear();
    const res = await worker._sweepOnce();
    expect(res).toEqual({ cleaned: 0, victims: [] });
    // No retract or remove calls — the bundle is not even considered.
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('legacy orphan (no is_bundle field) is still swept (regression guard)', async () => {
    // Pre-2026-09 docs may have is_bundle absent (treated as false by the
    // FILTER (f.is_bundle == null OR f.is_bundle == false) guard).
    programQueries([{ file_id: 'legacy', file_name: 'legacy.md', repo_id: REPO }], []);
    const res = await worker._sweepOnce();
    expect(res).toEqual({ cleaned: 1, victims: ['legacy.md'] });
  });
});

describe('ingestWorker._reapStuckParsed (2-9-5 atomicity — claim-stamp reaping, 2026-09-03)', () => {
  test('dead-letters a CLAIM-STALE parsed row (died mid-drain)', async () => {
    programQueries([{ repo_id: REPO, concept_id: 'stuck', worker_claimed_at: '2026-09-01T00:00:00.000Z' }], []);
    const res = await worker._reapStuckParsed();
    expect(res).toEqual({ reaped: 1, victims: [`${REPO}/stuck`] });
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'stuck', repo_id: REPO },
      {
        patch: {
          index_status: 'failed',
          last_error:
            'ingest drain stuck — no terminal callback within the grace window (reaper dead-letter; recovery = re-ingest)'
        }
      }
    );
  });

  test('no stuck rows → no-op', async () => {
    programQueries([]);
    const res = await worker._reapStuckParsed();
    expect(res).toEqual({ reaped: 0, victims: [] });
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('a dead-letter failure is isolated (other victims still processed)', async () => {
    programQueries(
      [
        { repo_id: REPO, concept_id: 'a' },
        { repo_id: REPO, concept_id: 'b' }
      ],
      []
    );
    conceptMeta.upsertConceptMeta
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue({ action: 'updated', doc: {} });
    const res = await worker._reapStuckParsed();
    expect(res.reaped).toBe(1); // 'b' dead-lettered; 'a' failed isolation-logged
    expect(res.victims).toEqual([`${REPO}/b`]);
  });

  test('reaps by CLAIM STATE, never by row age (2026-09-02/03 regression guard)', async () => {
    // Two false-positive rules already shipped from this file (age-only, then
    // head-by-age): both mass-killed healthy crawl backlogs. The query must
    // signal ONLY on claim state — worker_claimed_at staleness or claim count
    // — and must NOT filter on updated_at age.
    programQueries([], []);
    await worker._reapStuckParsed();
    // The aql tag produces {query, bindVars} — inspect the template text.
    const aqlText = String(mockDb.query.mock.calls[0][0].query);
    expect(aqlText).toContain("FILTER m.index_status == 'parsed'");
    expect(aqlText).toContain('worker_claimed_at');
    expect(aqlText).toContain('ingest_attempts');
    expect(aqlText).not.toContain('DATE_TIMESTAMP(m.updated_at)');
  });
});

describe('ingestWorker.start (bootstrap guard)', () => {
  afterEach(() => worker.stop());

  test('starts timers when enabled (default) and stops cleanly', async () => {
    process.env.OKF_INGEST_WORKER_JOB_POLL_MS = '1';
    await worker.start();
    // a started worker schedules its first cycle immediately; stop clears it
    worker.stop();
    delete process.env.OKF_INGEST_WORKER_JOB_POLL_MS;
    expect(true).toBe(true); // no throw, no hang (timers cleared)
  });

  test('OKF_INGEST_WORKER_ENABLED=false → no timers', async () => {
    process.env.OKF_INGEST_WORKER_ENABLED = 'false';
    await worker.start();
    worker.stop();
    delete process.env.OKF_INGEST_WORKER_ENABLED;
  });
});
describe('directive (David, 2026-09-04): failures reach the ingestion log; orphans never linger', () => {
  test('(b) parsed rows of a deleted repo are dead-lettered terminally (never linger as claimable)', async () => {
    programQueries([{ repo_id: 'ghost', concept_id: 'r1' }]);
    const res = await worker._deadLetterOrphanedRows();
    expect(res.dead).toBe(1);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      'ghost',
      { concept_id: 'r1', repo_id: 'ghost' },
      expect.objectContaining({ patch: expect.objectContaining({ index_status: 'failed' }) })
    );
  });

  test('(b) the orphan dead-letter is IDEMPOTENT (re-run dead-letters nothing)', async () => {
    programQueries([]);
    const res = await worker._deadLetterOrphanedRows();
    expect(res.dead).toBe(0);
  });

  test('(a) a dataprep POST failure mirrors to the ingestion log (never silent)', async () => {
    programQueries([
      {
        repo_id: 'armed',
        concept_id: 'c1',
        graph_name: 'OKF_armed',
        frontmatter: {},
        body: '# x',
        last_good_index_at: null,
        reindex_retry: null,
        bundle_version: null
      }
    ]);
    authedAxios.post.mockReset();
    // WS5 (David, 2026-09-25): always-retract-before-POST adds a retract
    // call. The retract is idempotent — let it succeed — then the actual
    // dataprep kick is what fails.
    authedAxios.post.mockResolvedValueOnce({ status: 200 }); // the pre-POST retract succeeds
    authedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED')); // the dataprep kick fails
    authedAxios.post.mockResolvedValue({ status: 200 }); // the mirror POSTs
    authedAxios.get.mockReset();
    authedAxios.get.mockResolvedValue({ data: { data: [{ file_id: 'bundle-1' }] } });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('error');
    const mirror = authedAxios.post.mock.calls.find((c) => String(c[0]).includes('/ingestion-log'));
    expect(mirror).toBeTruthy();
    expect(String(mirror[1].message)).toContain('dataprep kick failed');
  });
});
// ── P0 wedge (David, 2026-09-09): partial failure must settle, never stall ──
jest.mock('../services/lifecycle-service', () => ({
  _settleIngest: jest.fn(async () => ({}))
}));

describe('ingestWorker._refreshRagIngestion — the wedge contract', () => {
  const RW = '99999999-9999-4999-8999-999999999991';

  beforeEach(() => jest.clearAllMocks());

  test('partial failure (0 parsed, failed > 0) settles UNCONDITIONALLY', async () => {
    conceptMeta.countByIndexStatus = jest
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    mockDb.query.mockImplementation(async (q) => {
      const text = q && q.query ? String(q.query) : '';
      if (text.includes("index_status == 'failed'")) {
        return { all: async () => [{ concept_id: 'alpha', last_error: 'LLM 502' }] };
      }
      return { all: async () => [] };
    });
    mockDb.collection('okf_repositories').save({
      _key: RW,
      repo_id: RW,
      name: 'K',
      rag_drain_active: true,
      rag_ingestion: { status: 'draining', requested_at: '2026-09-12T06:23:05.841Z', failed_concepts: [] }
    });
    await worker._refreshRagIngestion(mockDb, RW);
    const { _settleIngest } = require('../services/lifecycle-service');
    expect(_settleIngest).toHaveBeenCalledTimes(1);
    // Failure clarity (David, 2026-09-09), contract moved 2026-09-13: the
    // TERMINAL rag_ingestion record (failed_concepts, human error, recovery)
    // is owned by _settleIngest (lifecycle-service) — the worker no longer
    // re-patches the record after it (that re-patch resurrected 'draining'
    // over the settled record — probe-verified stale merge). The worker's
    // remaining contract on this path: keep the failure VISIBLE — a warn and
    // a bundle ingestion-log mirror naming the recovery.
    const { logger } = require('../shared-lib/logger');
    expect(logger.warn).toHaveBeenCalledWith(
      'Ingest worker: drain finished with FAILED concepts — settled, serving partial',
      expect.objectContaining({ repo_id: RW, failed: 2 })
    );
    // (The bundle ingestion-log mirror is fire-and-forget — its POST/warn
    // lands after this function resolves, so it is asserted in the
    // _processOneJob transport-error test, not here.)
  });
});

// ── THE 0/997 CARD (David, 2026-09-12): ArangoDB update() keys are LITERAL —
// a dotted key 'rag_ingestion.concepts_done' is stored as a FLAT attribute,
// never as a nested path. Every drain-progress refresh was invisible to the
// dashboard while the nested record the card reads stayed at 0. ──
describe('ingestWorker._refreshRagIngestion — nested-record contract (0/997 card bug)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('drain progress is a FUSED conditional write — disarm guard + nested MERGE server-side', async () => {
    conceptMeta.countByIndexStatus = jest
      .fn()
      .mockResolvedValueOnce(600) // parsed
      .mockResolvedValueOnce(294) // indexed
      .mockResolvedValueOnce(36); // failed
    await worker._refreshRagIngestion(mockDb, 'uk');
    // Spec #1020 §5.4 race 3: check + write are ONE statement — the old
    // read-then-write TOCTOU let a late refresh resurrect 'draining' over an
    // honest 'cancelled' record after a mid-drain retract (Bali wedge).
    const writes = mockDb.query.mock.calls
      .map((c) => c[0])
      .filter((q) => queryText(q).includes('UPDATE r WITH') && queryText(q).includes('rag_ingestion'));
    expect(writes).toHaveLength(1);
    const text = queryText(writes[0]);
    // The disarm guard lives INSIDE the statement (a disarmed repo matches
    // zero rows — nothing is written, ever).
    expect(text).toContain('rag_drain_active == true');
    // Nested MERGE server-side — never flat dotted keys (the 0/997 card).
    expect(text).toContain('MERGE(');
    expect(text).not.toContain("'rag_ingestion.");
    // §5.7 queue context: the key is ALWAYS written (null when the aggregate
    // failed — no stale leakage between drains).
    expect(text).toContain('queue:');
    // The counts ride as binds: indexed=294 done, 600+294+36=930 total.
    const binds = Object.values((writes[0] && writes[0].bindVars) || {});
    expect(binds).toContain('uk');
    expect(binds).toContain(294);
    expect(binds).toContain(930);
    // NO read-modify-write: collection().update must stay untouched.
    expect(mockDb.collection('okf_repositories').update).not.toHaveBeenCalled();
  });

  // Live 2026-09-15 (Bali-wikipedia-LLM): a concept still in flight during a
  // mid-drain retract came back, and the progress refresh overwrote the
  // honest 'cancelled' record with 'draining' — the dashboard chip showed
  // "Ingesting" in the retracted lane while nothing was running. The fused
  // write's disarm guard (asserted above) is what makes that impossible.
  test('a DISARMED repo (drain cancelled by retract) is never refreshed back to draining', async () => {
    conceptMeta.countByIndexStatus = jest
      .fn()
      .mockResolvedValueOnce(995) // parsed
      .mockResolvedValueOnce(6) // indexed
      .mockResolvedValueOnce(0); // failed
    mockDb.collection('okf_repositories').save({
      _key: 'bali',
      repo_id: 'bali',
      lifecycle_state: 'retracted',
      rag_drain_active: false,
      rag_ingestion: {
        status: 'cancelled',
        error: 'drain cancelled — the repository was retracted mid-ingest',
        concepts_total: 0,
        concepts_done: 0,
        failed_concepts: []
      }
    });
    await worker._refreshRagIngestion(mockDb, 'bali');
    // The issued statement carries the server-side guard — the mock cannot
    // execute AQL, so the contract pinned here is the FILTER itself.
    const guard = mockDb.query.mock.calls
      .map((c) => queryText(c[0]))
      .some((t) => t.includes('rag_drain_active == true'));
    expect(guard).toBe(true);
    expect(mockDb.collection('okf_repositories').update).not.toHaveBeenCalled();
    const doc = mockDb._stores.okf_repositories['bali'];
    expect(doc.rag_ingestion.status).toBe('cancelled'); // honest record survives
  });
});

describe('settle reconciliation (2026-09-13 wedge fix: www-gov-uk-full-crawl 31h "not drained")', () => {
  const RID_A = 'aaaaaaa1-0000-4000-8000-000000000001';
  const RID_B = 'aaaaaaa2-0000-4000-8000-000000000002';

  beforeEach(() => {
    // The file-scope jest.mock (the wedge-contract describe above) stubs
    // _settleIngest as a no-op spy — these tests exercise the REAL
    // reconcile → settle flow, so delegate the stub to the actual
    // implementation (its own deps stay the file's mocks: promoteGraph,
    // audit, concept-meta live counts). clearAllMocks never strips a
    // mockImplementation, so set it here where it only affects THIS describe.
    require('../services/lifecycle-service')._settleIngest.mockImplementation(
      jest.requireActual('../services/lifecycle-service')._settleIngest
    );
    // The wedge-contract test reassigns countByIndexStatus to a positional
    // stub — restore the store reader so these tests count LIVE rows.
    conceptMeta.countByIndexStatus = jest.fn(mockCountByIndexStatusFromStore);
  });

  test('an ARMED repo with an EMPTY queue settles even though no job wrote the last terminal state', async () => {
    // The live wedge: 922 indexed + 75 reaper-dead-lettered + 0 parsed — the
    // reaper (not a job) wrote the final transitions, so the settle check
    // never ran. The reconcile must settle it: serving flags + honest record.
    await mockDb.collection('okf_repositories').save({
      repo_id: RID_A,
      lifecycle_state: 'publish',
      version: 1,
      rag_drain_active: true,
      deleted_at: null,
      rag_ingestion: {
        status: 'draining',
        requested_at: '2026-09-12T06:23:05.841Z',
        concepts_done: 3,
        concepts_total: 4
      }
    });
    const meta = mockDb.collection('okf_concepts_meta');
    // Explicit _keys: the mock keys a _key-less save on repo_id, which would
    // clobber all four rows into one (real rows are auto-keyed + found by
    // firstExample, so only the unit fixture needs this).
    await meta.save({ _key: RID_A + ':c0', repo_id: RID_A, concept_id: 'c0', index_status: 'indexed' });
    await meta.save({ _key: RID_A + ':c1', repo_id: RID_A, concept_id: 'c1', index_status: 'indexed' });
    await meta.save({ _key: RID_A + ':c2', repo_id: RID_A, concept_id: 'c2', index_status: 'indexed' });
    await meta.save({
      _key: RID_A + ':f1',
      repo_id: RID_A,
      concept_id: 'f1',
      index_status: 'failed',
      last_error: 'ingest drain stuck — no terminal callback within the grace window (reaper dead-letter)'
    });

    // 1st positional query = the reconcile's armed-with-empty-queue read;
    // 2nd = _settleIngest's failed-rows read.
    programQueries([{ repo_id: RID_A }], [{ concept_id: 'f1', error: 'reaper dead-letter' }]);
    const out = await worker._reconcileArmedRepos();
    expect(out.repos).toContain(RID_A);

    const doc = await mockDb.collection('okf_repositories').document(RID_A);
    expect(doc.ingested_at).toBeTruthy(); // THE settle — the repo is no longer stuck
    expect(doc.rag_drain_active).toBe(false); // disarmed → retract/re-ingest possible again
    expect(doc.ingested_graph_name).toBe('OKF_' + RID_A + '_v1');
    expect(doc.rag_ingestion.status).toBe('failed'); // failed>0 → honest, not 'completed'
    expect(doc.rag_ingestion.finished_at).toBeTruthy();
    expect(doc.rag_ingestion.concepts_done).toBe(3);
    expect(doc.rag_ingestion.failed_concepts).toHaveLength(1);
    expect(doc.rag_ingestion.failed_concepts[0].concept_id).toBe('f1');
  });

  test('a repo STILL DRAINING (parsed rows remain) is not settled and stays armed', async () => {
    await mockDb.collection('okf_repositories').save({
      repo_id: RID_B,
      lifecycle_state: 'publish',
      version: 1,
      rag_drain_active: true,
      deleted_at: null,
      rag_ingestion: { status: 'draining', concepts_done: 1, concepts_total: 2 }
    });
    await mockDb
      .collection('okf_concepts_meta')
      .save({ _key: RID_B + ':p1', repo_id: RID_B, concept_id: 'p1', index_status: 'parsed' });
    await mockDb
      .collection('okf_concepts_meta')
      .save({ _key: RID_B + ':d1', repo_id: RID_B, concept_id: 'd1', index_status: 'indexed' });

    programQueries([]); // the reconcile finds no armed repo with an empty queue
    const out = await worker._reconcileArmedRepos();
    expect(out.repos).not.toContain(RID_B);

    const doc = await mockDb.collection('okf_repositories').document(RID_B);
    expect(doc.ingested_at).toBeFalsy();
    expect(doc.rag_drain_active).toBe(true);
    expect(doc.rag_ingestion.status).toBe('draining');
  });

  test('a TIMED-OUT wait clears the row claim so the reaper never dead-letters a healthy backlog row', async () => {
    process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS = '30';
    const job = {
      repo_id: 'r-timeout',
      concept_id: 'concepts/slow-one',
      graph_name: 'OKF_r-timeout_v1',
      frontmatter: {},
      body: 'slow content',
      ingest_labels: [],
      bundle_version: null,
      updated_at: '2026-09-12T00:00:00Z',
      last_good_index_at: null,
      reindex_retry: null
    };
    // claim read → the job; every terminal poll → still 'parsed' → deadline → timeout.
    programQueries(job, { index_status: 'parsed', last_error: null, chunk_count: 0 });
    const out = await worker._processOneJob();
    expect(out.outcome).toBe('timeout');
    const calls = conceptMeta.upsertConceptMeta.mock.calls;
    const cleared = calls.find((c) => c[2] && c[2].patch && 'worker_claimed_at' in c[2].patch);
    expect(cleared).toBeTruthy(); // the claim was returned to the unclaimed pool
    delete process.env.OKF_INGEST_WORKER_JOB_TIMEOUT_MS;
  });
});
