// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// WS2 (David, 2026-09-25): bundle zips (is_bundle=true) are OKF per-version
// ingestion artifacts. They live forever, governed by the OKF lifecycle, NOT
// by the document management tab. Only the okf-service service account may
// delete them; Admin / steward roles get an explicit 403 BUNDLE_PROTECTED.
// This test file locks down that contract for both single-file DELETE and
// batch DELETE, and verifies the okf-service account is NOT blocked.
// DW-426 (review 2026-10-29 round 3): bundleProtectedIds answers from ONE
// IN-list AQL now, so the mocks program dbService.getConnection's query
// instead of per-file metadataService.getMetadataById.

'use strict';

jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

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
      jest.doMock('../../services/fileService', () => ({
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
      jest.doMock('../../services/fileService', () => ({
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
      jest.doMock('../../services/fileService', () => ({
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
      jest.doMock('../../services/fileService', () => ({
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
      const { dbService } = require('../../../shared-lib');
      protectedDb = makeProtectedDb(['bundleInBatch']);
      dbService.getConnection.mockResolvedValue(protectedDb);
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('Admin caller batch-deleting with a bundle → 403 BUNDLE_PROTECTED, batch aborted', async () => {
      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['docInBatch', 'bundleInBatch'] });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BUNDLE_PROTECTED');
      // ONE query for the whole batch (DW-426), carrying every requested id
      expect(protectedDb.query).toHaveBeenCalledWith(expect.stringContaining('is_bundle == true'), {
        ids: ['docInBatch', 'bundleInBatch']
      });
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
