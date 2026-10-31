'use strict';

// Tests for POST /api/files/ingest/recover-stuck (#610): dataprep calls this
// once at startup to release files it left stuck in 'Ingesting' when the
// ingestion service restarted mid-ingest.

// Mock shared-lib before anything else
jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// Mock auth middleware to bypass Keycloak
jest.mock('../../middlewares/keycloak-auth-middleware', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      sub: '12345678-1234-1234-1234-123456789012',
      preferred_username: 'dataprep-service',
      realm_access: { roles: ['dataprep-service'] }
    };
    next();
  }),
  authorizeRole: jest.fn(() => (req, res, next) => next()),
  isPublicRoute: jest.fn(() => false),
  mapRole: jest.fn()
}));

jest.mock('../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: ['application/pdf', 'text/plain', 'text/html'],
    allowedExtensions: ['.pdf', '.txt', '.html'],
    maxFileSize: 52428800,
    bundleMaxBodyMb: 100,
    maxFilesUpload: 5
  },
  labels: {
    allowedLevels: ['Category', 'Subcategory', 'Topic'],
    allowedStatuses: ['Active', 'Inactive']
  },
  virusScanning: false,
  crawler: { maxPages: 100 },
  clamscan: {},
  dataprep: { host: 'http://dataprep', port: '5000', ingestPath: '/v1/dataprep', retractPath: '/v1/dataprep/retract' },
  allowedOrigins: ['http://localhost:3000']
}));

jest.mock('../../middlewares/fileUpload', () => ({
  uploadSingle: jest.fn((req, res, next) => next()),
  uploadMultiple: jest.fn((req, res, next) => next()),
  validateFiles: jest.fn((req, res, next) => next()),
  handleMulterError: jest.fn((err, req, res, next) => next(err))
}));

jest.mock('../../services/fileService', () => ({
  addIngestionLog: jest.fn(),
  getFiles: jest.fn(),
  searchFiles: jest.fn()
}));

jest.mock('../../services/metadataService', () => ({
  recoverStuckIngests: jest.fn(),
  searchMetadata: jest.fn(),
  getMetadataById: jest.fn(),
  updateMetadata: jest.fn()
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');
const metadataService = require('../../services/metadataService');

describe('POST /api/files/ingest/recover-stuck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('releases stuck files to Pending and logs each one', async () => {
    metadataService.recoverStuckIngests.mockResolvedValue(['file-1', 'file-2']);
    fileService.addIngestionLog.mockResolvedValue({});

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recovered).toEqual(['file-1', 'file-2']);
    expect(res.body.count).toBe(2);
    expect(fileService.addIngestionLog).toHaveBeenCalledTimes(2);
    expect(fileService.addIngestionLog).toHaveBeenCalledWith(
      'file-1',
      expect.objectContaining({ level: 'WARN', stage: 'dataprep' })
    );
  });

  it('returns an empty recovery when nothing is stuck', async () => {
    metadataService.recoverStuckIngests.mockResolvedValue([]);

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, recovered: [], count: 0 });
    expect(fileService.addIngestionLog).not.toHaveBeenCalled();
  });

  it('still succeeds when the log write for one file fails', async () => {
    // The status flip already happened; a lost log line must not report a
    // failed recovery — dataprep would only retry the whole call for nothing.
    metadataService.recoverStuckIngests.mockResolvedValue(['file-1', 'file-2']);
    fileService.addIngestionLog.mockRejectedValueOnce(new Error('log write failed'));
    fileService.addIngestionLog.mockResolvedValueOnce({});

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('returns 500 when the recovery query fails', async () => {
    metadataService.recoverStuckIngests.mockRejectedValue(new Error('arangodb down'));

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
