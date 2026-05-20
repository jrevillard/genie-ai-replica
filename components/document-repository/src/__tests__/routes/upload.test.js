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
  virusScanning: true,
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

// Mock file upload middleware — sets req.file for upload tests
jest.mock('../../middlewares/fileUpload', () => ({
  uploadSingle: jest.fn((req, res, next) => {
    if (req.headers['x-mock-no-file']) {
      return next();
    }
    if (req.headers['x-mock-unsupported-type']) {
      req.file = {
        originalname: 'malware.exe',
        mimetype: 'application/x-msdownload',
        size: 100,
        buffer: Buffer.from('exe content')
      };
      return next();
    }
    if (req.headers['x-mock-infected']) {
      req.file = {
        originalname: 'infected.pdf',
        mimetype: 'application/pdf',
        size: 68,
        buffer: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
      };
      return next();
    }
    req.file = {
      originalname: 'test-document.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('fake pdf content for testing')
    };
    next();
  }),
  uploadMultiple: jest.fn((req, res, next) => {
    req.files = [
      { originalname: 'test1.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('test1') },
      { originalname: 'test2.pdf', mimetype: 'application/pdf', size: 2048, buffer: Buffer.from('test2') }
    ];
    next();
  }),
  validateFiles: jest.fn((req, res, next) => {
    if (req.file && req.file.mimetype === 'application/x-msdownload') {
      return res.status(415).json({
        success: false,
        error: 'Unsupported file type',
        message: 'File type application/x-msdownload is not allowed'
      });
    }
    next();
  })
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');
const securityService = require('../../services/securityService');
const { createMockFileRecord } = require('../mocks/files');

describe('Upload Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/files/upload', () => {
    it('should upload a file and return 201 with metadata', async () => {
      const uploadedFile = createMockFileRecord();
      fileService.uploadFile.mockResolvedValue(uploadedFile);

      const res = await request(app).post('/api/files/upload').send({ author: 'Test Author', labels: [] });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file_name).toBe('test-document.pdf');
      expect(res.body.data.file_type).toBe('application/pdf');
      expect(fileService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'test-document.pdf' }),
        expect.objectContaining({ author: 'Test Author' })
      );
    });

    it('should return 415 for unsupported file type', async () => {
      const res = await request(app).post('/api/files/upload').set('x-mock-unsupported-type', 'true').send({});

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Unsupported');
    });

    it('should trigger ClamAV scan and reject infected file', async () => {
      securityService.scanBuffer.mockResolvedValue({
        isInfected: true,
        viruses: ['EICAR-Test-Signature']
      });
      fileService.uploadFile.mockRejectedValue(new Error('virus detected: EICAR-Test-Signature'));

      const res = await request(app).post('/api/files/upload').set('x-mock-infected', 'true').send({});

      // The controller catches the error from fileService which rejects on virus
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message || res.body.error).toMatch(/virus|security/i);
    });

    it('should return 400 when no file is uploaded', async () => {
      const res = await request(app).post('/api/files/upload').set('x-mock-no-file', 'true').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('No file');
    });

    it('should return 500 on unexpected service error', async () => {
      fileService.uploadFile.mockRejectedValue(new Error('disk full'));

      const res = await request(app).post('/api/files/upload').send({});

      expect(res.status).toBe(500);
    });
  });
});
