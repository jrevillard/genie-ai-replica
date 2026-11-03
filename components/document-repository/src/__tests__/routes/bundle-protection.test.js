// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// WS2 (David, 2026-09-25): bundle zips (is_bundle=true) are OKF per-version
// ingestion artifacts. They live forever, governed by the OKF lifecycle, NOT
// by the document management tab. Only the okf-service service account may
// delete them; Admin / steward roles get an explicit 403 BUNDLE_PROTECTED on
// the single DELETE. Batch DELETE is a PER-FILE refusal now (#1350 round-28 review, the
// client partial-refusal contract): a mixed selection deletes the deletable subset and
// reports the bundle rows as per-file failures, instead of aborting the whole
// batch — this file locks down that contract for both handlers, and verifies
// the okf-service account is NOT blocked.
// DW-426 (review 2026-10-29 round 3): bundleProtectedIds answers from ONE
// IN-list AQL now, so the mocks program dbService.getConnection's query
// instead of per-file metadataService.getMetadataById.

'use strict';

const { createMockFileRecord } = require('../mocks/files');

jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// ONE owner for the fileService mock surface (review 84593): a new fileService
// export is added HERE, not in the five doMock copies that used to repeat it.
function makeFileServiceMock() {
  return {
    uploadFile: jest.fn(),
    uploadLink: jest.fn(),
    getFiles: jest.fn(),
    deleteFile: jest.fn().mockResolvedValue(true),
    searchFiles: jest.fn(),
    getFileStats: jest.fn(),
    getDb: jest.fn(),
    scheduleSiteCrawl: jest.fn(),
    getCrawlJobByFileId: jest.fn(),
    getCrawlMetrics: jest.fn(),
    getCrawlLogs: jest.fn(),
    killCrawlTask: jest.fn(),
    addIngestionLog: jest.fn(),
    getIngestionLogs: jest.fn()
  };
}
const makeAuthMock = (roles) => () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      sub: '11111111-1111-1111-1111-111111111111',
      preferred_username: 'tester',
      roles: roles
    };
    next();
  }),
  authorizeRole: jest.fn(() => (req, res, next) => next()),
  isPublicRoute: jest.fn(() => false),
  mapRole: jest.fn()
});

jest.mock('../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: ['application/pdf'],
    allowedExtensions: ['.pdf'],
    maxFileSize: 52428800,
    bundleMaxBodyMb: 100,
    maxFilesUpload: 5
  },
  labels: { allowedLevels: [], allowedStatuses: [] },
  virusScanning: false,
  crawler: { maxPages: 100 },
  clamscan: {},
  dataprep: { host: 'http://dataprep', port: '5000' },
  allowedOrigins: ['http://localhost:3000']
}));

jest.mock('../../services/fileService', () => ({
  uploadFile: jest.fn(),
  uploadLink: jest.fn(),
  getFiles: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(true),
  searchFiles: jest.fn(),
  getFileStats: jest.fn(),
  getDb: jest.fn(),
  scheduleSiteCrawl: jest.fn(),
  getCrawlJobByFileId: jest.fn(),
  getCrawlMetrics: jest.fn(),
  getCrawlLogs: jest.fn(),
  killCrawlTask: jest.fn(),
  addIngestionLog: jest.fn(),
  getIngestionLogs: jest.fn()
}));

// NOTE: fileService and the shared-lib mock are required INSIDE the tests
// after jest.resetModules() + doMock — top-level requires here would be stale
// (and ESLint-dead) because each beforeEach rebuilds the module registry.

// Builds a db mock whose single AQL query returns `ids` as the protected set.
const makeProtectedDb = (ids) => ({
  query: jest.fn().mockResolvedValue({ all: jest.fn().mockResolvedValue(ids) })
});

const mockAdminAuth = () => {
  jest.doMock('../../middlewares/keycloak-auth-middleware', makeAuthMock(['Admin']));
};
const mockOkfServiceAuth = () => {
  jest.doMock('../../middlewares/keycloak-auth-middleware', makeAuthMock(['Admin', 'okf-service']));
};

const request = require('supertest');

describe('WS2: Bundle zip delete protection', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('DELETE /api/files/:fileId (Admin caller)', () => {
    let protectedDb;

    beforeEach(() => {
      mockAdminAuth();
      // rebuild app + fileService mock with the Admin-auth middleware
      jest.doMock('../../services/fileService', () => makeFileServiceMock());
      const { dbService } = require('../../../shared-lib');
      protectedDb = makeProtectedDb(['bundle1']);
      dbService.getConnection.mockResolvedValue(protectedDb);
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('Admin caller deleting a bundle → 403 BUNDLE_PROTECTED', async () => {
      const res = await request(app).delete('/api/files/bundle1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BUNDLE_PROTECTED');
      // DW-426: the protection set comes from the single IN-list query
      expect(protectedDb.query).toHaveBeenCalledWith(expect.stringContaining('is_bundle == true'), {
        ids: ['bundle1']
      });
    });

    test('Admin caller deleting a NON-bundle → 200 (no protection)', async () => {
      // Override the AQL result to an empty protected set
      protectedDb.query.mockResolvedValue({ all: jest.fn().mockResolvedValue([]) });
      const fs = require('../../services/fileService');
      fs.deleteFile.mockResolvedValueOnce(true);

      const res = await request(app).delete('/api/files/doc1');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/files/:fileId (okf-service caller)', () => {
    let protectedDb;

    beforeEach(() => {
      mockOkfServiceAuth();
      jest.doMock('../../services/fileService', () => makeFileServiceMock());
      // The guard must actually RUN for the bypass to mean anything
      // (review !622 wave 2 / #78685: with the connection unprogrammed the
      // old fail-open catch answered [] and the test proved the mock).
      const { dbService } = require('../../../shared-lib');
      protectedDb = makeProtectedDb(['bundle2']);
      dbService.getConnection.mockResolvedValue(protectedDb);
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('okf-service caller deleting a bundle → 200 (protection does NOT block)', async () => {
      const res = await request(app).delete('/api/files/bundle2');
      expect(res.status).toBe(200);
      // The bypass is by ROLE, not by degradation: the guard never even ran
      // (the connection IS programmed, so an unprogrammed-catch pass-through
      // could no longer fake this — review !622 wave 2, #78685).
      expect(protectedDb.query).not.toHaveBeenCalled();
      const fs2 = require('../../services/fileService');
      expect(fs2.deleteFile).toHaveBeenCalledWith('bundle2');
    });
  });

  describe('DELETE /api/files/:fileId with a failing guard lookup (Admin caller)', () => {
    beforeEach(() => {
      mockAdminAuth();
      jest.doMock('../../services/fileService', () => makeFileServiceMock());
      // The guard CANNOT evaluate (transient Arango outage) — the delete must
      // be REFUSED, not waved through on the empty-set answer (fail-closed,
      // review !622 wave 2 / #78677).
      const { dbService } = require('../../../shared-lib');
      dbService.getConnection.mockRejectedValue(new Error('arango down'));
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('guard lookup failure → 503 BUNDLE_GUARD_UNAVAILABLE, file untouched', async () => {
      const res = await request(app).delete('/api/files/some-doc');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('BUNDLE_GUARD_UNAVAILABLE');
      const fs3 = require('../../services/fileService');
      expect(fs3.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/files (batch delete with bundle in list, Admin caller)', () => {
    let protectedDb;

    beforeEach(() => {
      mockAdminAuth();
      jest.doMock('../../services/fileService', () => makeFileServiceMock());
      const { dbService } = require('../../../shared-lib');
      protectedDb = makeProtectedDb(['bundleInBatch']);
      dbService.getConnection.mockResolvedValue(protectedDb);
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('Admin caller batch-deleting a MIXED selection → 200, deletable subset deleted, bundle refused per-file (#1350)', async () => {
      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['docInBatch', 'bundleInBatch'] });
      // Per-file outcomes, not a whole-batch 403: the deletable row is gone,
      // the bundle row rides back as a per-file refusal the client's existing
      // partial-refusal strip renders.
      expect(res.status).toBe(200);
      const fs = require('../../services/fileService');
      // ONLY the deletable id was deleted — never the bundle
      expect(fs.deleteFile).toHaveBeenCalledTimes(1);
      expect(fs.deleteFile).toHaveBeenCalledWith('docInBatch');
      expect(fs.deleteFile).not.toHaveBeenCalledWith('bundleInBatch');
      const byId = Object.fromEntries(res.body.results.map((r) => [r.fileId, r]));
      expect(byId.docInBatch.success).toBe(true);
      expect(byId.bundleInBatch.success).toBe(false);
      expect(byId.bundleInBatch.code).toBe('BUNDLE_PROTECTED');
      expect(byId.bundleInBatch.error).toContain('OKF lifecycle');
      // ONE query for the whole batch (DW-426), carrying every requested id
      expect(protectedDb.query).toHaveBeenCalledWith(expect.stringContaining('is_bundle == true'), {
        ids: ['docInBatch', 'bundleInBatch']
      });
    });

    test('Admin caller batch-deleting ONLY bundles → 200, nothing deleted, every row refused per-file', async () => {
      // Override the guard answer: BOTH ids are protected
      protectedDb.query.mockResolvedValue({ all: jest.fn().mockResolvedValue(['docA', 'docB']) });
      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['docA', 'docB'] });
      expect(res.status).toBe(200);
      const fs = require('../../services/fileService');
      expect(fs.deleteFile).not.toHaveBeenCalled();
      expect(res.body.results).toHaveLength(2);
      for (const row of res.body.results) {
        expect(row.success).toBe(false);
        expect(row.code).toBe('BUNDLE_PROTECTED');
      }
    });

    test('Admin caller batch-deleting NON-bundles → 200', async () => {
      protectedDb.query.mockResolvedValue({ all: jest.fn().mockResolvedValue([]) });
      const fs = require('../../services/fileService');
      fs.deleteFile.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['docA', 'docB'] });
      expect(res.status).toBe(200);
    });
  });
});

describe('#1350: ingest entries refuse bundle zips (the shared _ingestFileById guard)', () => {
  let app;
  let axiosMock;
  let metadataMock;
  let readFileMock;

  // createMockFileRecord deep-merges dataprep (review 84593): a partial
  // dataprep override used to REPLACE the whole object wholesale.
  const bundleDoc = (overrides = {}) =>
    createMockFileRecord({
      file_id: 'bundle1',
      file_name: 'bundle1.zip',
      storage_path: 'uploads/bundle1.zip',
      is_bundle: true,
      dataprep: { status: 'Pending' },
      ...overrides
    });
  const docDoc = (overrides = {}) =>
    createMockFileRecord({
      file_id: 'doc1',
      file_name: 'doc1.pdf',
      storage_path: 'uploads/doc1.pdf',
      is_bundle: false,
      dataprep: { status: 'Ingested' },
      ...overrides
    });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAdminAuth();
    // fs is required as `require('fs').promises` — keep the rest of the
    // module real, replace only the read the ingest path performs.
    readFileMock = jest.fn().mockResolvedValue(Buffer.from('PK-zip-bytes'));
    // The physical-file check is callback-API (existsSync/statSync) and runs
    // BEFORE the guard — a bundle doc must present a real-looking file so the
    // test reaches the is_bundle refusal, not a 404.
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => true),
      statSync: jest.fn(() => ({ size: 12, isFile: () => true })),
      promises: {
        ...jest.requireActual('fs').promises,
        readFile: readFileMock,
        access: jest.fn().mockResolvedValue(undefined)
      }
    }));
    axiosMock = { post: jest.fn() };
    jest.doMock('axios', () => ({ ...jest.requireActual('axios'), post: axiosMock.post }));
    metadataMock = { getMetadataById: jest.fn() };
    jest.doMock('../../services/metadataService', () => metadataMock);
    jest.doMock('../../services/fileService', () => ({
      uploadFile: jest.fn(),
      uploadLink: jest.fn(),
      getFiles: jest.fn(),
      deleteFile: jest.fn(),
      searchFiles: jest.fn(),
      getFileStats: jest.fn(),
      getDb: jest.fn(),
      scheduleSiteCrawl: jest.fn(),
      getCrawlJobByFileId: jest.fn(),
      getCrawlMetrics: jest.fn(),
      getCrawlLogs: jest.fn(),
      killCrawlTask: jest.fn(),
      addIngestionLog: jest.fn(),
      getIngestionLogs: jest.fn()
    }));
    const { dbService } = require('../../../shared-lib');
    dbService.getConnection.mockResolvedValue(makeProtectedDb([]));
    app = require('../../app');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('POST /:fileId/ingest on a Pending bundle zip → 403 BUNDLE_PROTECTED, dataprep never called', async () => {
    metadataMock.getMetadataById.mockResolvedValue(bundleDoc());

    const res = await request(app).post('/api/files/bundle1/ingest');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BUNDLE_PROTECTED');
    expect(res.body.success).toBe(false);
    // The corruption this guard exists to prevent: not one byte of the zip
    // reaches the chunking pipeline.
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  test('an INGESTED bundle zip still answers BUNDLE_PROTECTED — the guard precedes the status check', async () => {
    metadataMock.getMetadataById.mockResolvedValue(bundleDoc({ dataprep: { status: 'Ingested' } }));

    const res = await request(app).post('/api/files/bundle1/ingest');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BUNDLE_PROTECTED');
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  test('POST /ingest (batch) with a bundle in the selection → per-file refusal row carrying the code, no dataprep call', async () => {
    metadataMock.getMetadataById.mockImplementation((fileId) =>
      Promise.resolve(fileId === 'bundle1' ? bundleDoc() : docDoc())
    );

    const res = await request(app)
      .post('/api/files/ingest')
      .send({ fileIds: ['bundle1', 'doc1'] });

    expect(res.status).toBe(207);
    const bundleRow = res.body.results.find((row) => row.fileId === 'bundle1');
    const docRow = res.body.results.find((row) => row.fileId === 'doc1');
    expect(bundleRow.success).toBe(false);
    expect(bundleRow.bundleProtected).toBe(true);
    expect(bundleRow.code).toBe('BUNDLE_PROTECTED');
    // doc1 is already 'Ingested' — the row fails on status, not on dataprep,
    // so the whole batch proves no chunking POST left the process.
    expect(docRow.success).toBe(false);
    expect(docRow.error).toContain('already been ingested');
    expect(axiosMock.post).not.toHaveBeenCalled();
  });
});
