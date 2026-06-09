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
const metadataService = require('../../services/metadataService');
const { createMockFileRecord } = require('../mocks/files');

describe('Search Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/files/search/files (full-text search)', () => {
    it('should return matching files for a valid query', async () => {
      const results = [
        createMockFileRecord({ file_name: 'report-2025.pdf' }),
        createMockFileRecord({ file_id: 'file-xyz789', file_name: 'report-draft.pdf' })
      ];
      fileService.searchFiles.mockResolvedValue(results);

      const res = await request(app).get('/api/files/search/files?q=report');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.query).toBe('report');
      expect(res.body.resultCount).toBe(2);
      expect(fileService.searchFiles).toHaveBeenCalledWith('report', expect.any(Object));
    });

    it('should return empty results for query with no matches', async () => {
      fileService.searchFiles.mockResolvedValue([]);

      const res = await request(app).get('/api/files/search/files?q=nonexistentxyz');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.resultCount).toBe(0);
    });

    it('should return 400 for empty query (too short)', async () => {
      const res = await request(app).get('/api/files/search/files?q=');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when query parameter is missing', async () => {
      const res = await request(app).get('/api/files/search/files');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should pass mimeType filter to service', async () => {
      fileService.searchFiles.mockResolvedValue([]);

      await request(app).get('/api/files/search/files?q=test&mimeType=application/pdf');

      expect(fileService.searchFiles).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ mimeType: 'application/pdf' })
      );
    });

    it('should return 500 on service error', async () => {
      fileService.searchFiles.mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app).get('/api/files/search/files?q=test');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/files/search (metadata search)', () => {
    it('should return matching files by metadata', async () => {
      const results = [createMockFileRecord({ file_name: 'report.pdf' })];
      metadataService.searchMetadata.mockResolvedValue(results);

      const res = await request(app).get('/api/files/search?file_name=report');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(metadataService.searchMetadata).toHaveBeenCalled();
    });

    it('should reject invalid query parameters', async () => {
      const res = await request(app).get('/api/files/search?invalid_param=value');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid query parameters');
    });
  });
});
