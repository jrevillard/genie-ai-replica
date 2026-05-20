'use strict';

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
      preferred_username: 'testuser',
      realm_access: { roles: ['user', 'admin'] }
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

jest.mock('../../services/fileService', () => ({
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

jest.mock('../../services/metadataService', () => ({
  addMetadata: jest.fn(),
  searchMetadata: jest.fn(),
  getMetadataById: jest.fn(),
  deleteMetadata: jest.fn(),
  updateMetadata: jest.fn()
}));

jest.mock('../../services/securityService', () => ({
  initialize: jest.fn(),
  scanBuffer: jest.fn()
}));

jest.mock('../../middlewares/fileUpload', () => ({
  uploadSingle: jest.fn((req, res, next) => next()),
  uploadMultiple: jest.fn((req, res, next) => next()),
  validateFiles: jest.fn((req, res, next) => next())
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');

describe('Delete Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DELETE /api/files/:fileId', () => {
    it('should delete a file and return 200', async () => {
      fileService.deleteFile.mockResolvedValue(true);

      const res = await request(app).delete('/api/files/file-abc123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deleted');
      expect(fileService.deleteFile).toHaveBeenCalledWith('file-abc123');
    });

    it('should return 404 when file not found', async () => {
      fileService.deleteFile.mockResolvedValue(false);

      const res = await request(app).delete('/api/files/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });

    it('should return 404 when service throws not found error', async () => {
      fileService.deleteFile.mockRejectedValue(new Error('File not found in database'));

      const res = await request(app).delete('/api/files/missing-file');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 500 on unexpected service error', async () => {
      fileService.deleteFile.mockRejectedValue(new Error('disk I/O error'));

      const res = await request(app).delete('/api/files/file-abc123');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
