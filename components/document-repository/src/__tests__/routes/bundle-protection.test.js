// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// WS2 (David, 2026-09-25): bundle zips (is_bundle=true) are OKF per-version
// ingestion artifacts. They live forever, governed by the OKF lifecycle, NOT
// by the document management tab. Only the okf-service service account may
// delete them; Admin / steward roles get an explicit 403 BUNDLE_PROTECTED.
// This test file locks down that contract for both single-file DELETE and
// batch DELETE, and verifies the okf-service account is NOT blocked.

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

// NOTE: fileService/metadataService are required INSIDE the tests after
// jest.resetModules() + doMock — top-level requires here would be stale
// (and ESLint-dead) because each beforeEach rebuilds the module registry.

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
    beforeEach(() => {
      mockAdminAuth();
      // rebuild app + fileService mock with the Admin-auth middleware
      jest.doMock('../../services/fileService', () => ({
        uploadFile: jest.fn(), uploadLink: jest.fn(), getFiles: jest.fn(),
        deleteFile: jest.fn().mockResolvedValue(true), searchFiles: jest.fn(), getFileStats: jest.fn(),
        getDb: jest.fn(), scheduleSiteCrawl: jest.fn(), getCrawlJobByFileId: jest.fn(),
        getCrawlMetrics: jest.fn(), getCrawlLogs: jest.fn(), killCrawlTask: jest.fn(),
        addIngestionLog: jest.fn(), getIngestionLogs: jest.fn()
      }));
      jest.doMock('../../services/metadataService', () => ({
        addMetadata: jest.fn(),
        searchMetadata: jest.fn(),
        getMetadataById: jest.fn().mockResolvedValue({ file_id: 'bundle1', is_bundle: true }),
        deleteMetadata: jest.fn(),
        updateMetadata: jest.fn()
      }));
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('Admin caller deleting a bundle → 403 BUNDLE_PROTECTED', async () => {
      const res = await request(app).delete('/api/files/bundle1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BUNDLE_PROTECTED');
    });

    test('Admin caller deleting a NON-bundle → 200 (no protection)', async () => {
      // Override getMetadataById to return a non-bundle
      const meta = require('../../services/metadataService');
      meta.getMetadataById.mockResolvedValueOnce({ file_id: 'doc1', is_bundle: false });
      const fs = require('../../services/fileService');
      fs.deleteFile.mockResolvedValueOnce(true);

      const res = await request(app).delete('/api/files/doc1');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/files/:fileId (okf-service caller)', () => {
    beforeEach(() => {
      mockOkfServiceAuth();
      jest.doMock('../../services/fileService', () => ({
        uploadFile: jest.fn(), uploadLink: jest.fn(), getFiles: jest.fn(),
        deleteFile: jest.fn().mockResolvedValue(true), searchFiles: jest.fn(), getFileStats: jest.fn(),
        getDb: jest.fn(), scheduleSiteCrawl: jest.fn(), getCrawlJobByFileId: jest.fn(),
        getCrawlMetrics: jest.fn(), getCrawlLogs: jest.fn(), killCrawlTask: jest.fn(),
        addIngestionLog: jest.fn(), getIngestionLogs: jest.fn()
      }));
      jest.doMock('../../services/metadataService', () => ({
        addMetadata: jest.fn(),
        searchMetadata: jest.fn(),
        getMetadataById: jest.fn().mockResolvedValue({ file_id: 'bundle2', is_bundle: true }),
        deleteMetadata: jest.fn(),
        updateMetadata: jest.fn()
      }));
      app = require('../../app');
    });

    afterEach(() => {
      jest.resetModules();
    });

    test('okf-service caller deleting a bundle → 200 (protection does NOT block)', async () => {
      const res = await request(app).delete('/api/files/bundle2');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/files (batch delete with bundle in list, Admin caller)', () => {
    beforeEach(() => {
      mockAdminAuth();
      jest.doMock('../../services/fileService', () => ({
        uploadFile: jest.fn(), uploadLink: jest.fn(), getFiles: jest.fn(),
        deleteFile: jest.fn().mockResolvedValue(true), searchFiles: jest.fn(), getFileStats: jest.fn(),
        getDb: jest.fn(), scheduleSiteCrawl: jest.fn(), getCrawlJobByFileId: jest.fn(),
        getCrawlMetrics: jest.fn(), getCrawlLogs: jest.fn(), killCrawlTask: jest.fn(),
        addIngestionLog: jest.fn(), getIngestionLogs: jest.fn()
      }));
      jest.doMock('../../services/metadataService', () => ({
        addMetadata: jest.fn(),
        searchMetadata: jest.fn(),
        getMetadataById: jest.fn().mockImplementation(async (fileId) => {
          if (fileId === 'bundleInBatch') return { file_id: fileId, is_bundle: true };
          return { file_id: fileId, is_bundle: false };
        }),
        deleteMetadata: jest.fn(),
        updateMetadata: jest.fn()
      }));
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
    });

    test('Admin caller batch-deleting NON-bundles → 200', async () => {
      const fs = require('../../services/fileService');
      fs.deleteFile.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['docA', 'docB'] });
      expect(res.status).toBe(200);
    });
  });
});
