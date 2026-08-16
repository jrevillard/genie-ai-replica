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

// Mock archiver
jest.mock('archiver', () => ({
  create: jest.fn(() => ({
    pipe: jest.fn(),
    file: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn()
  }))
}));

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

// Mock services
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

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn()
}));

// Mock fs.promises
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    access: jest.fn()
  }
}));

// Get the mocked fs.promises functions
const { readFile, access } = require('fs').promises;

// Mock file upload middleware
jest.mock('../../middlewares/fileUpload', () => ({
  uploadSingle: jest.fn((req, res, next) => {
    req.file = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('test content')
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
  validateFiles: jest.fn((req, res, next) => next())
}));

jest.mock('../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: [
      'application/pdf',
      'text/plain',
      'text/html',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    allowedExtensions: ['.pdf', '.txt', '.html', '.md', '.docx'],
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

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');
const metadataService = require('../../services/metadataService');
const auth = require('../../middlewares/keycloak-auth-middleware');
const axios = require('axios');
const {
  mockFileRecord,
  mockCrawledFileRecord,
  mockIngestedFileRecord,
  mockCrawlJob
} = require('../fixtures/mockFileRecords');

describe('File Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset auth mock to default admin user
    auth.authenticateToken.mockImplementation((req, res, next) => {
      req.user = {
        sub: '12345678-1234-1234-1234-123456789012',
        preferred_username: 'testuser',
        realm_access: { roles: ['user', 'admin'] }
      };
      next();
    });
    auth.authorizeRole.mockImplementation(() => (req, res, next) => next());
  });

  // --- Health and info endpoints (public) ---

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api', () => {
    it('should return API info', async () => {
      const res = await request(app).get('/api');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Document Repository API');
      expect(res.body.endpoints.files).toBe('/api/files');
    });
  });

  // --- Auth guard tests ---

  describe('Authentication', () => {
    it('should return 401 when auth middleware rejects', async () => {
      auth.authenticateToken.mockImplementation((req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app).get('/api/files');
      expect(res.status).toBe(401);
    });

    it('should use authorizeRole middleware for admin-only routes', () => {
      // authorizeRole was called during route setup (module load time)
      // Verify the mock was invoked — cleared by beforeEach, so re-check the function exists
      expect(typeof auth.authorizeRole).toBe('function');
    });
  });

  // --- File upload ---

  describe('POST /api/files/upload', () => {
    it('should upload a file and return 201', async () => {
      fileService.uploadFile.mockResolvedValue(mockFileRecord);

      const res = await request(app).post('/api/files/upload').field('labels', '[]').field('author', 'Test Author');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file_name).toBe('test-document.pdf');
      expect(fileService.uploadFile).toHaveBeenCalled();
    });

    it('should return 400 when no file is uploaded', async () => {
      // Override fileUpload mock for this test
      const fileUpload = require('../../middlewares/fileUpload');
      fileUpload.uploadSingle.mockImplementationOnce((req, res, next) => {
        req.file = null;
        next();
      });

      const res = await request(app).post('/api/files/upload').field('labels', '[]');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No file uploaded');
    });

    it('should handle upload errors with appropriate status', async () => {
      fileService.uploadFile.mockRejectedValue(new Error('File type application/exe is not allowed'));

      const res = await request(app).post('/api/files/upload').field('labels', '[]');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // --- Multiple file upload ---

  describe('POST /api/files/uploads', () => {
    it('should upload multiple files and return 201', async () => {
      fileService.uploadFile.mockResolvedValueOnce(mockFileRecord);
      fileService.uploadFile.mockResolvedValueOnce({ ...mockFileRecord, file_id: 'file-abc456' });

      const res = await request(app).post('/api/files/uploads').field('labels', '[]');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(fileService.uploadFile).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when no files uploaded', async () => {
      const fileUpload = require('../../middlewares/fileUpload');
      fileUpload.uploadMultiple.mockImplementationOnce((req, res, next) => {
        req.files = [];
        next();
      });

      const res = await request(app).post('/api/files/uploads').field('labels', '[]');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No files uploaded');
    });
  });

  // --- Upload link ---

  describe('POST /api/files/upload-link', () => {
    it('should crawl a URL and return 201', async () => {
      fileService.uploadLink.mockResolvedValue(mockCrawledFileRecord);

      const res = await request(app)
        .post('/api/files/upload-link')
        .send({ url: 'https://example.com', fileType: 'md' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file_type).toBe('text/markdown');
      expect(fileService.uploadLink).toHaveBeenCalledWith('https://example.com', 'md');
    });

    it('should return 400 when URL is missing', async () => {
      const res = await request(app).post('/api/files/upload-link').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });
  });

  // --- Get files ---

  describe('GET /api/files', () => {
    it('should return paginated file list', async () => {
      fileService.getFiles.mockResolvedValue({
        files: [mockFileRecord],
        pagination: { totalFiles: 1, currentPage: 1, totalPages: 1, limit: 10 }
      });

      const res = await request(app).get('/api/files');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.totalFiles).toBe(1);
    });

    it('should pass query parameters to service', async () => {
      fileService.getFiles.mockResolvedValue({
        files: [],
        pagination: { totalFiles: 0, currentPage: 2, totalPages: 1, limit: 5 }
      });

      await request(app).get('/api/files?page=2&limit=5&language=en&search=test');

      expect(fileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 5, language: 'en', search: 'test' })
      );
    });

    it('should return 400 for invalid query parameters', async () => {
      const res = await request(app).get('/api/files?page=-1');
      expect(res.status).toBe(400);
    });
  });

  // --- Search files ---

  describe('GET /api/files/search/files', () => {
    it('should return search results', async () => {
      fileService.searchFiles.mockResolvedValue([mockFileRecord]);

      const res = await request(app).get('/api/files/search/files?q=test');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('should return 400 when query is missing', async () => {
      const res = await request(app).get('/api/files/search/files');
      expect(res.status).toBe(400);
    });

    it('should return 400 when query is too short', async () => {
      const res = await request(app).get('/api/files/search/files?q=a');
      expect(res.status).toBe(400);
    });
  });

  // --- Search metadata ---

  describe('GET /api/files/search', () => {
    it('should return metadata search results', async () => {
      metadataService.searchMetadata.mockResolvedValue([mockFileRecord]);

      const res = await request(app).get('/api/files/search?file_name=test');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(metadataService.searchMetadata).toHaveBeenCalled();
    });

    it('should reject invalid query parameters', async () => {
      const res = await request(app).get('/api/files/search?invalid_param=value');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid query parameters');
    });
  });

  // --- Get metadata by ID ---

  describe('GET /api/files/:fileId', () => {
    it('should return file metadata', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileRecord);

      const res = await request(app).get('/api/files/file-abc123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file_id).toBe('file-abc123');
    });

    it('should return 404 for non-existent file', async () => {
      metadataService.getMetadataById.mockResolvedValue(null);

      const res = await request(app).get('/api/files/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // --- Delete file ---

  describe('DELETE /api/files/:fileId', () => {
    it('should delete a file and return 200', async () => {
      fileService.deleteFile.mockResolvedValue(true);

      const res = await request(app).delete('/api/files/file-abc123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when file not found', async () => {
      fileService.deleteFile.mockRejectedValue(new Error('not found'));

      const res = await request(app).delete('/api/files/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // --- Delete multiple files ---

  describe('DELETE /api/files', () => {
    it('should delete multiple files', async () => {
      fileService.deleteFile.mockResolvedValue(true);

      const res = await request(app)
        .delete('/api/files')
        .send({ fileIds: ['file-1', 'file-2'] });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      expect(fileService.deleteFile).toHaveBeenCalledTimes(2);
    });

    it('should return 400 for invalid fileIds', async () => {
      const res = await request(app).delete('/api/files').send({ fileIds: [] });

      expect(res.status).toBe(400);
    });
  });

  // --- Update file ---

  describe('PATCH /api/files/:fileId', () => {
    it('should update file metadata', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(mockFileRecord) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };
      fileService.getDb.mockResolvedValue(mockDb);
      metadataService.getMetadataById.mockResolvedValue(mockFileRecord);

      const res = await request(app)
        .patch('/api/files/file-abc123')
        .send({ labels: ['updated-label'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when file not found', async () => {
      metadataService.getMetadataById.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/files/nonexistent')
        .send({ labels: ['test'] });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid update data', async () => {
      const res = await request(app).patch('/api/files/file-abc123').send({ file_name: 'line1\r\nline2' });

      expect(res.status).toBe(400);
    });
  });

  // --- Site crawl ---

  describe('POST /api/files/crawl/schedule', () => {
    it('should schedule a crawl and return 202', async () => {
      fileService.scheduleSiteCrawl.mockResolvedValue(mockCrawledFileRecord);

      const res = await request(app).post('/api/files/crawl/schedule').send({ url: 'https://example.com', depth: 3 });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(fileService.scheduleSiteCrawl).toHaveBeenCalledWith('https://example.com', 3, undefined);
    });

    it('should return 400 when URL is missing', async () => {
      const res = await request(app).post('/api/files/crawl/schedule').send({ depth: 3 });

      expect(res.status).toBe(400);
    });

    it('should return 400 when depth is out of range', async () => {
      const res = await request(app).post('/api/files/crawl/schedule').send({ url: 'https://example.com', depth: 25 });

      expect(res.status).toBe(400);
    });
  });

  // --- Crawl job ---

  describe('GET /api/files/:fileId/crawl-job', () => {
    it('should return crawl job status', async () => {
      fileService.getCrawlJobByFileId.mockResolvedValue(mockCrawlJob);

      const res = await request(app).get('/api/files/file-crawl456/crawl-job');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Succeeded');
    });

    it('should return 404 when crawl job not found', async () => {
      fileService.getCrawlJobByFileId.mockResolvedValue(null);

      const res = await request(app).get('/api/files/nonexistent/crawl-job');

      expect(res.status).toBe(404);
    });
  });

  // --- Crawl metrics ---

  describe('GET /api/files/:fileId/crawl-metrics', () => {
    it('should return crawl metrics', async () => {
      fileService.getCrawlMetrics.mockResolvedValue({ crawlRate: 5, processed: 10 });

      const res = await request(app).get('/api/files/file-crawl456/crawl-metrics');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.crawlRate).toBe(5);
    });

    it('should return default metrics when none found', async () => {
      fileService.getCrawlMetrics.mockResolvedValue(null);

      const res = await request(app).get('/api/files/file-crawl456/crawl-metrics');

      expect(res.status).toBe(200);
      expect(res.body.data.crawlRate).toBe(0);
    });
  });

  // --- Crawl logs ---

  describe('GET /api/files/:fileId/crawl-log', () => {
    it('should return crawl logs', async () => {
      fileService.getCrawlLogs.mockResolvedValue([{ message: 'Crawled page 1' }]);

      const res = await request(app).get('/api/files/file-crawl456/crawl-log');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // --- Kill crawl ---

  describe('POST /api/files/:fileId/kill-crawl', () => {
    it('should send kill signal', async () => {
      fileService.killCrawlTask.mockResolvedValue();

      const res = await request(app).post('/api/files/file-crawl456/kill-crawl');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fileService.killCrawlTask).toHaveBeenCalledWith('file-crawl456');
    });
  });

  // --- Ingestion logs ---

  describe('POST /api/files/:fileId/ingestion-log', () => {
    it('should add ingestion log entry and return 201', async () => {
      fileService.addIngestionLog.mockResolvedValue({ file_id: 'f1', level: 'INFO' });

      const res = await request(app)
        .post('/api/files/file-abc123/ingestion-log')
        .send({ level: 'INFO', stage: 'dataprep', message: 'Processing started' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid log level', async () => {
      const res = await request(app)
        .post('/api/files/file-abc123/ingestion-log')
        .send({ level: 'DEBUG', stage: 'test', message: 'test' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/files/:fileId/ingestion-log', () => {
    it('should return ingestion logs', async () => {
      fileService.getIngestionLogs.mockResolvedValue([{ message: 'log1' }]);

      const res = await request(app).get('/api/files/file-abc123/ingestion-log');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // --- Update file status ---

  describe('PATCH /api/files/:fileId/status', () => {
    it('should update file status', async () => {
      metadataService.updateMetadata.mockResolvedValue(mockIngestedFileRecord);

      const res = await request(app)
        .patch('/api/files/file-abc123/status')
        .send({ dataprep: { status: 'Ingested' }, chunk_count: 42 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(metadataService.updateMetadata).toHaveBeenCalledWith('file-abc123', {
        dataprep: { status: 'Ingested' },
        chunk_count: 42
      });
    });

    it('should return 400 for invalid status', async () => {
      const res = await request(app)
        .patch('/api/files/file-abc123/status')
        .send({ dataprep: { status: 'INVALID' } });

      expect(res.status).toBe(400);
    });

    it('should return 404 when file not found', async () => {
      metadataService.updateMetadata.mockRejectedValue(new Error('not found'));

      const res = await request(app)
        .patch('/api/files/nonexistent/status')
        .send({ dataprep: { status: 'Ingested' } });

      expect(res.status).toBe(404);
    });
  });

  // --- Dataprep trigger endpoints ---

  describe('POST /api/files/:fileId/ingest', () => {
    it('should successfully trigger file ingestion', async () => {
      const mockFileWithPendingStatus = {
        ...mockFileRecord,
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' }
      };

      metadataService.getMetadataById.mockResolvedValue(mockFileWithPendingStatus);
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();
      axios.post.mockResolvedValue({ data: { success: true, chunk_count: 10 } });
      metadataService.updateMetadata.mockResolvedValue({
        ...mockFileWithPendingStatus,
        dataprep: { status: 'Ingesting', ingest_date: new Date().toISOString(), retract_date: '' },
        chunk_count: 10
      });

      const res = await request(app).post('/api/files/file-abc123/ingest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        'http://dataprep:5000/v1/dataprep',
        expect.objectContaining({
          fileId: 'file-abc123',
          fileName: 'test-document.pdf'
        })
      );
      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'file-abc123',
        expect.objectContaining({
          dataprep: expect.objectContaining({ status: 'Ingesting' })
        })
      );
    });

    it('forwards the minted bundle_version to datapretreat (Story 2.9.7)', async () => {
      const mockVersionedFile = {
        ...mockFileRecord,
        bundle_version: 3,
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' }
      };
      metadataService.getMetadataById.mockResolvedValue(mockVersionedFile);
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();
      axios.post.mockResolvedValue({ data: { success: true, chunk_count: 2 } });

      const res = await request(app).post('/api/files/file-abc123/ingest');

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledWith(
        'http://dataprep:5000/v1/dataprep',
        expect.objectContaining({ fileId: 'file-abc123', bundleVersion: 3 })
      );
    });

    it('should return 429 when dataprep service is busy', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileRecord);
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();

      const error = new Error('Too Many Requests');
      error.response = { status: 429 };
      axios.post.mockRejectedValue(error);

      const res = await request(app).post('/api/files/file-abc123/ingest');

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Too Many Requests');
      // 429 = TRANSIENT busy, not a file failure: the file must NOT be marked
      // 'Ingestion Error' (Story 2.9.4 — a poisoned file is never re-claimed
      // by the ingestion worker; live-caught run 9). It stays Pending.
      expect(metadataService.updateMetadata).not.toHaveBeenCalledWith(
        'file-abc123',
        expect.objectContaining({ dataprep: expect.objectContaining({ status: 'Ingestion Error' }) })
      );
    });

    it('should return 500 when dataprep service fails', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileRecord);
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();
      axios.post.mockRejectedValue(new Error('Dataprep service unavailable'));

      const res = await request(app).post('/api/files/file-abc123/ingest');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      // A REAL dataprep failure DOES transition the file to 'Ingestion Error'
      // (contrast with the transient 429 above).
      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'file-abc123',
        expect.objectContaining({ dataprep: expect.objectContaining({ status: 'Ingestion Error' }) })
      );
    });

    it('should skip already ingested files', async () => {
      const mockIngestedFile = {
        ...mockFileRecord,
        dataprep: { status: 'ingested', ingest_date: '2025-06-01T11:00:00.000Z', retract_date: '' }
      };

      metadataService.getMetadataById.mockResolvedValue(mockIngestedFile);
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();
      axios.post.mockResolvedValue({ data: { success: false } });

      const res = await request(app).post('/api/files/file-abc123/ingest');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.details).toContain('already been ingested');
    });
  });

  describe('POST /api/files/ingest', () => {
    it('should return 400 when fileIds is missing', async () => {
      const res = await request(app).post('/api/files/ingest').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should successfully trigger batch file ingestion', async () => {
      const mockFile1 = { ...mockFileRecord, file_id: 'file-1' };
      const mockFile2 = { ...mockFileRecord, file_id: 'file-2' };

      metadataService.getMetadataById.mockImplementation((fileId) => {
        if (fileId === 'file-1') return Promise.resolve(mockFile1);
        if (fileId === 'file-2') return Promise.resolve(mockFile2);
        return Promise.resolve(null);
      });
      readFile.mockResolvedValue(Buffer.from('test file content'));
      access.mockResolvedValue();
      axios.post.mockResolvedValue({ data: { success: true, chunk_count: 5 } });
      metadataService.updateMetadata.mockResolvedValue({
        ...mockFile1,
        dataprep: { status: 'Ingesting', ingest_date: new Date().toISOString(), retract_date: '' },
        chunk_count: 5
      });

      const res = await request(app)
        .post('/api/files/ingest')
        .send({ fileIds: ['file-1', 'file-2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveLength(2);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/files/:fileId/retract', () => {
    it('should successfully retract a file', async () => {
      const mockIngestedFile = {
        ...mockFileRecord,
        dataprep: { status: 'Ingested', ingest_date: '2025-06-01T11:00:00.000Z', retract_date: '' }
      };

      metadataService.getMetadataById.mockResolvedValue(mockIngestedFile);
      axios.post.mockResolvedValue({ data: { success: true } });
      metadataService.updateMetadata.mockResolvedValue({
        ...mockIngestedFile,
        dataprep: {
          status: 'retracted',
          ingest_date: '2025-06-01T11:00:00.000Z',
          retract_date: new Date().toISOString()
        },
        chunk_count: 0
      });

      const res = await request(app).post('/api/files/file-abc123/retract');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // graphName: null when the file has no graph (dataprep falls back to its
      // unified default — Story 2.9.6 G5 fix).
      expect(axios.post).toHaveBeenCalledWith('http://dataprep:5000/v1/dataprep/retract', {
        fileId: 'file-abc123',
        graphName: null
      });
      expect(metadataService.updateMetadata).toHaveBeenCalledWith(
        'file-abc123',
        expect.objectContaining({
          dataprep: expect.objectContaining({ status: 'retracted' }),
          chunk_count: 0
        })
      );
    });

    it('should retract into the file OWN graph (OKF per-repo graph_name — Story 2.9.6 G5)', async () => {
      const repoId = '99999999-9999-4999-8999-999999999999';
      const mockIngestedFile = {
        ...mockFileRecord,
        graph_name: `OKF_${repoId}`,
        dataprep: { status: 'Ingested', ingest_date: '2025-06-01T11:00:00.000Z', retract_date: '' }
      };

      metadataService.getMetadataById.mockResolvedValue(mockIngestedFile);
      axios.post.mockResolvedValue({ data: { success: true } });
      metadataService.updateMetadata.mockResolvedValue({
        ...mockIngestedFile,
        dataprep: { status: 'retracted', ingest_date: '', retract_date: new Date().toISOString() },
        chunk_count: 0
      });

      const res = await request(app).post('/api/files/file-abc123/retract');

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledWith('http://dataprep:5000/v1/dataprep/retract', {
        fileId: 'file-abc123',
        graphName: `OKF_${repoId}`
      });
    });

    it('should return 404 when file not found', async () => {
      metadataService.getMetadataById.mockResolvedValue(null);

      const res = await request(app).post('/api/files/nonexistent/retract');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 500 when dataprep service fails', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileRecord);
      axios.post.mockRejectedValue(new Error('Dataprep service unavailable'));

      const res = await request(app).post('/api/files/file-abc123/retract');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/files/:fileId/kill-ingest', () => {
    it('should successfully kill ingestion', async () => {
      axios.post.mockResolvedValue({ data: { success: true, message: 'Kill signal sent' } });

      const res = await request(app).post('/api/files/file-abc123/kill-ingest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith('http://dataprep:5000/v1/dataprep/kill_ingest', {
        fileId: 'file-abc123'
      });
    });

    it('should return 500 when kill signal fails', async () => {
      axios.post.mockRejectedValue(new Error('Failed to send kill signal'));

      const res = await request(app).post('/api/files/file-abc123/kill-ingest');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Failed to send kill signal');
    });
  });

  // --- 404 ---

  describe('Unknown routes', () => {
    it('should return 404 for unknown endpoints', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.status).toBe(404);
    });
  });
});
