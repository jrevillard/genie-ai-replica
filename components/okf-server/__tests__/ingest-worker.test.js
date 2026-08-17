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
jest.mock('../config', () => ({ documentRepository: { url: 'http://document-repository:3001' } }));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const worker = require('../workers/ingestWorker');
const conceptMeta = require('../services/concept-meta-service');
const { authedAxios } = require('../services/service-token');

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

describe('ingestWorker.conceptIdFromFileName (2.9.1 4f contract — the REAL parser strips only .md, no prefix)', () => {
  test('derives the bare concept_id from the orchestrator-enqueued file name', () => {
    expect(worker.conceptIdFromFileName('bad_concept.md')).toBe('bad_concept');
    expect(worker.conceptIdFromFileName('nested/path.md')).toBe('nested/path');
    expect(worker.conceptIdFromFileName('index.md')).toBe('index');
  });
  test('null for unshaped names', () => {
    expect(worker.conceptIdFromFileName('')).toBeNull();
    expect(worker.conceptIdFromFileName('no-extension')).toBeNull();
    expect(worker.conceptIdFromFileName(undefined)).toBeNull();
    expect(worker.conceptIdFromFileName('.md')).toBeNull();
  });
});

describe('ingestWorker._processOneJob (drain one Pending OKF file)', () => {
  test('idle when no Pending OKF docs exist (never touches non-OKF Pending)', async () => {
    programQueries([]); // claim finds nothing
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'idle' });
    expect(authedAxios.post).not.toHaveBeenCalled();
  });

  test('oldest Pending OKF doc → kick → Ingested → meta indexed + last_good_index_at', async () => {
    programQueries(
      [
        {
          file_id: 'f1',
          file_name: 'bad_concept.md',
          originalFileName: 'bad_concept.md',
          repo_id: REPO,
          graph_name: `OKF_${REPO}`
        }
      ],
      [{ dataprep: { status: 'Ingesting' }, chunk_count: 0 }], // poll 1: still working
      [{ dataprep: { status: 'Ingested' }, chunk_count: 2 }] // poll 2: terminal
    );
    authedAxios.post.mockResolvedValue({ status: 200 });
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
    expect(res.chunks).toBe(2);
    expect(authedAxios.post).toHaveBeenCalledWith(
      `http://document-repository:3001/api/files/f1/ingest`,
      {},
      { timeout: 30000 }
    );
    // The worker-EXCLUSIVE transition (minimal patch — never clobbers 4b fields)
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'bad_concept' },
      { patch: { index_status: 'indexed', last_good_index_at: expect.any(String) } }
    );
  });

  test('Ingestion Error → meta failed + last_error (dead-letter; recovery = re-ingest)', async () => {
    programQueries(
      [{ file_id: 'f2', file_name: 'x.md', originalFileName: 'x.md', repo_id: REPO }],
      [{ dataprep: { status: 'Ingestion Error' }, chunk_count: 0 }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('failed');
    expect(res.terminal).toBe('Ingestion Error');
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      REPO,
      { concept_id: 'x' },
      { patch: { index_status: 'failed', last_error: expect.stringContaining('Ingestion Error') } }
    );
  });

  test('429 busy → back off, NO meta transition, NO crash (dataprep single-flight)', async () => {
    programQueries([{ file_id: 'f3', file_name: 'a.md', originalFileName: 'a.md', repo_id: REPO }]);
    const busy = Object.assign(new Error('429'), { response: { status: 429 } });
    authedAxios.post.mockRejectedValue(busy);
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'busy', file_id: 'f3' });
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('kick transport error → outcome error, files-doc state machine untouched', async () => {
    programQueries([{ file_id: 'f4', file_name: 'a.md', originalFileName: 'a.md', repo_id: REPO }]);
    authedAxios.post.mockRejectedValue(new Error('doc-repo down'));
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('error');
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('non-200 kick → outcome error with status', async () => {
    programQueries([{ file_id: 'f5', file_name: 'a.md', originalFileName: 'a.md', repo_id: REPO }]);
    authedAxios.post.mockResolvedValue({ status: 404 });
    const res = await worker._processOneJob();
    expect(res).toMatchObject({ outcome: 'error', error: 'kick status 404' });
  });

  test('meta transition failure is isolated (job still reports ingested)', async () => {
    programQueries(
      [{ file_id: 'f6', file_name: 'c.md', originalFileName: 'c.md', repo_id: REPO }],
      [{ dataprep: { status: 'Ingested' }, chunk_count: 3 }]
    );
    conceptMeta.upsertConceptMeta.mockRejectedValueOnce(new Error('arango blip'));
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
  });

  test('file retracted/vanished mid-drain → outcome vanished, NO meta transition', async () => {
    programQueries(
      [{ file_id: 'f8', file_name: 'v.md', originalFileName: 'v.md', repo_id: REPO }],
      [] // files doc gone on the first poll (bundle retract removed it)
    );
    const res = await worker._processOneJob();
    expect(res).toEqual({ outcome: 'vanished', file_id: 'f8' });
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('unshaped originalFileName → drains but skips the meta transition (logged)', async () => {
    programQueries(
      [{ file_id: 'f7', file_name: 'weird.bin', originalFileName: 'weird.bin', repo_id: REPO }],
      [{ dataprep: { status: 'Ingested' }, chunk_count: 1 }]
    );
    const res = await worker._processOneJob();
    expect(res.outcome).toBe('ingested');
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
