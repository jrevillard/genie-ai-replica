// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 4.8-amend — the internal concept-status callback (dataprep → okf-server)
// that owns a concept's indexed|failed transition + the post-index edge write
// under content-only chunking. Guarded by a shared internal secret (fail-closed).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/concept-meta-service', () => ({
  upsertConceptMeta: jest.fn(async () => ({ action: 'updated' })),
  getConceptMetaFromAnyRepo: jest.fn(async () => ({ repo_id: 'r1', concept_id: 'index', bundle_version: 1 })),
  getConceptMeta: jest.fn(async () => ({ repo_id: 'r1', concept_id: 'index', bundle_version: 1 })),
  countByIndexStatus: jest.fn(async (repo, st) => (st === 'parsed' ? 0 : 0))
}));
jest.mock('../services/edge-service', () => ({
  writeRepoConceptEdges: jest.fn(async () => ({ written: 1, dropped: [] }))
}));
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn(), post: jest.fn(), patch: jest.fn(async () => ({ status: 200 })) }
}));
jest.mock('../workers/ingestWorker', () => ({
  getBundleFileId: jest.fn(async () => 'bundle-file-1')
}));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../config', () => ({
  piiService: { url: 'http://pii-service:8000', timeoutMs: 10000, retries: 2, scanPath: '/v1/pii/scan' },
  documentRepository: { url: 'http://document-repository:3001' },
  dataprep: { url: 'http://dataprep-arango-service:5000', ingestPath: '/v1/dataprep/ingest_file' },
  internal: { secret: 'test-secret' }
}));

const request = require('supertest');
const { createApp } = require('../index');
const conceptMeta = require('../services/concept-meta-service');
const edgeService = require('../services/edge-service');

describe('POST /api/okf/internal/concepts/:concept_id/status (Story 4.8-amend)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Ingested → meta indexed + last_good_index_at + edges written', async () => {
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/bad_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'bad_concept', status: 'Ingested', chunk_count: 2 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      'r1',
      { concept_id: 'bad_concept', repo_id: 'r1' },
      expect.objectContaining({ patch: expect.objectContaining({ index_status: 'indexed' }) })
    );
    expect(edgeService.writeRepoConceptEdges).toHaveBeenCalledWith(
      'r1',
      'bad_concept',
      expect.objectContaining({ file_id: 'bad_concept', bundle_version: 1 })
    );
  });

  test('Ingestion Error → meta failed + last_error, NO edge write', async () => {
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/bad_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'bad_concept', status: 'Ingestion Error', chunk_count: 0 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      'r1',
      { concept_id: 'bad_concept', repo_id: 'r1' },
      expect.objectContaining({ patch: expect.objectContaining({ index_status: 'failed' }) })
    );
    expect(edgeService.writeRepoConceptEdges).not.toHaveBeenCalled();
  });

  // #1389 — dataprep's degraded-but-stored verdict used to fall through both
  // dispatch arms: no transition, a misleading "callback applied" INFO, then a
  // 30-min lane spin, a re-kick that re-ingested the same concept, and a
  // reaper dead-letter at 8 attempts (live: Quran Core EN froze at 6321/6352
  // while six lanes churned). The warning verdict is SUCCESS: indexed + edges
  // + the warning carried on the row.
  test('Ingested with Warnings → indexed + index_warning + edges written (#1389)', async () => {
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/warn_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'warn_concept', status: 'Ingested with Warnings', chunk_count: 1 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      'r1',
      { concept_id: 'warn_concept', repo_id: 'r1' },
      expect.objectContaining({
        patch: expect.objectContaining({ index_status: 'indexed', index_warning: 'Ingested with Warnings' })
      })
    );
    expect(edgeService.writeRepoConceptEdges).toHaveBeenCalledWith('r1', 'warn_concept', expect.objectContaining({ file_id: 'warn_concept' }));
  });

  test('a later clean Ingested clears index_warning', async () => {
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/warn_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'warn_concept', status: 'Ingested', chunk_count: 3 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).toHaveBeenCalledWith(
      'r1',
      { concept_id: 'warn_concept', repo_id: 'r1' },
      expect.objectContaining({ patch: expect.objectContaining({ index_status: 'indexed', index_warning: null }) })
    );
  });

  test('an UNMAPPED status warns loudly naming the status and writes NO transition (#1389 contract-drift guard)', async () => {
    const { logger } = require('../shared-lib/logger');
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/odd_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'odd_concept', status: 'Partially Digestested', chunk_count: 0 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
    expect(edgeService.writeRepoConceptEdges).not.toHaveBeenCalled();
    const warnText = logger.warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnText).toContain("UNMAPPED status 'Partially Digestested'");
    expect(warnText).toContain('Contract drift');
  });

  test('Retracted mid-re-drive stays a quiet no-op (no transition, no unmapped WARN)', async () => {
    const { logger } = require('../shared-lib/logger');
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/rx_concept/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'rx_concept', status: 'Retracted', chunk_count: 0 });
    expect(res.status).toBe(200);
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
    const warnText = logger.warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnText).not.toContain('UNMAPPED status');
    expect(edgeService.writeRepoConceptEdges).not.toHaveBeenCalled();
  });

  test('missing/invalid internal secret → 401 (fail-closed)', async () => {
    const noHeader = await request(createApp())
      .post('/api/okf/internal/concepts/x/status')
      .send({ file_id: 'x', status: 'Ingested' });
    expect(noHeader.status).toBe(401);
    const badSecret = await request(createApp())
      .post('/api/okf/internal/concepts/x/status')
      .set('x-okf-internal-secret', 'wrong')
      .send({ file_id: 'x', status: 'Ingested' });
    expect(badSecret.status).toBe(401);
    expect(conceptMeta.upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('missing status → 400 VALIDATION_ERROR', async () => {
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/x/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'x' });
    expect(res.status).toBe(400);
  });

  test('unknown concept → 404 CONCEPT_NOT_FOUND', async () => {
    conceptMeta.getConceptMetaFromAnyRepo.mockResolvedValueOnce(null);
    const res = await request(createApp())
      .post('/api/okf/internal/concepts/ghost/status')
      .set('x-okf-internal-secret', 'test-secret')
      .send({ file_id: 'ghost', status: 'Ingested' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CONCEPT_NOT_FOUND');
  });
});
