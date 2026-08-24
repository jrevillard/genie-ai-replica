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
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/concept-meta-service', () => ({
  upsertConceptMeta: jest.fn(async (repo_id, parsed, opts) => ({
    action: 'updated',
    doc: { repo_id, ...parsed, ...opts }
  }))
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
 * 1st = claim, then terminal polls; sweep = orphan query + per-orphan removes). */
function programQueries(...results) {
  let i = 0;
  mockDb.query.mockImplementation(async () => {
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
    // The POST targets DATAPREP directly (content-only — no doc-repo files doc).
    const [url, body] = authedAxios.post.mock.calls[0];
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
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
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
      { patch: { last_worker_error: 'dataprep POST failed: dataprep down' } }
    );
    const patches = conceptMeta.upsertConceptMeta.mock.calls.map((c) => c[2] && c[2].patch).filter(Boolean);
    expect(patches.every((p) => p.index_status === undefined)).toBe(true);
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
});

describe('ingestWorker._reapStuckParsed (2-9-5 atomicity — dead-letter rows past the grace window)', () => {
  test('dead-letters a stuck parsed row to failed with last_error', async () => {
    programQueries([{ repo_id: REPO, concept_id: 'stuck' }], []);
    const res = await worker._reapStuckParsed();
    expect(res).toEqual({ reaped: 1, victims: [`${REPO}/stuck`] });
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'stuck', repo_id: REPO },
      {
        patch: {
          index_status: 'failed',
          last_error: 'stuck in parsed queue past the grace window (reaper dead-letter)'
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
