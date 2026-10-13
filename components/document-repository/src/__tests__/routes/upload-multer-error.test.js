'use strict';

// REGRESSION GUARD — mounts the REAL router with the REAL multer middleware.
//
// Why this file exists (2026-10-12 production incident): a user uploaded a
// .csv to POST /api/files/upload. doc-repo rejected it correctly (csv is not
// in the allowlist by design), but answered 500 Internal Server Error instead
// of 400 with the reason. Root cause: handleMulterError
// (middlewares/fileUpload.js) was fully implemented and unit-tested but
// mounted in ZERO routes, so the fileFilter error fell through to app.js's
// global errorHandler, which has no branch for it.
//
// The six pre-existing handleMulterError tests in
// __tests__/unit/middlewares/fileUpload.test.js all call the function
// DIRECTLY with hand-built req/res/next objects. That is exactly why an
// entirely unreachable middleware stayed green for so long: a direct-function
// test cannot observe whether anything mounted it.
//
// THIS file therefore does NOT mock ../../middlewares/fileUpload. It drives a
// genuine multipart/form-data request through supertest → the real multer
// instance → the real async fileFilter → the real handleMulterError, and
// asserts on the HTTP status. A 500 here means the wiring is missing again,
// and the six direct-function tests will all still be green.
//
// Everything that does not need to be real IS mocked: auth (Keycloak),
// services (ArangoDB / ClamAV), config, and the magic-byte validator.

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

// Auth is mocked so the request reaches the multer stack; the role gate itself
// is not what regressed, and hitting real Keycloak would make this a
// credential test rather than a wiring test.
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

// The allowlist is asserted by the test below, so it must be the REAL shape:
// text/csv and .csv are absent, exactly as in config/appConfig.js.
jest.mock('../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/markdown',
      'text/plain',
      'text/html',
      'application/zip',
      'application/x-zip-compressed'
    ],
    allowedExtensions: ['.pdf', '.docx', '.xlsx', '.md', '.html', '.txt'],
    maxFileSize: 52428800,
    bundleMaxBodyMb: 100,
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
  uploadMultipleFiles: jest.fn(),
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
  scanBuffer: jest.fn().mockResolvedValue({ isInfected: false, viruses: [] })
}));

// Magic-byte sniffing is the SECOND line of defence and is not what regressed;
// stub it so the accepted-file control case below stays hermetic and does not
// depend on a real file signature parser.
jest.mock('../../utils/mimeTypeValidator', () => ({
  validateFileType: jest.fn().mockResolvedValue({ isValid: true })
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');

// The controller's _formatFileRecord reads fileRecord.dataprep.*, so the
// fixture needs the nested object or the happy-path assertion below fails in
// the controller's own catch block (500 'Upload failed') for an unrelated
// reason. 201 is the controller's success code.
const UPLOADED_RECORD = {
  _key: 'docrepo_file_1',
  file_name: 'test-document.pdf',
  file_type: 'application/pdf',
  status: 'Pending',
  dataprep: { status: 'Pending', ingest_date: null, retract_date: null }
};

const CSV_BUFFER = Buffer.from('name,value\nalpha,1\nbeta,2\n', 'utf8');
const PDF_BUFFER = Buffer.from('%PDF-1.4 fake pdf content for testing', 'utf8');

// A CSV given the exact mimetype the browser sends. Passing contentType
// explicitly rather than relying on busboy's extension inference keeps the
// assertion about OUR wiring rather than about a MIME lookup table.
const csvPart = () => ({ filename: 'data.csv', contentType: 'text/csv' });

describe('fileFilter rejection must answer 400, not 500 (routes/fileRoutes.js wiring)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileService.uploadFile.mockResolvedValue(UPLOADED_RECORD);
  });

  describe('POST /api/files/upload', () => {
    it('answers 400 with the rejection reason when the mimetype is not allowlisted', async () => {
      const res = await request(app).post('/api/files/upload').attach('file', CSV_BUFFER, csvPart());

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // The message the user actually needs: which type, and that it is rejected.
      expect(res.body.error).toContain('text/csv');
      expect(res.body.error).toContain('not allowed');
      // Proof the request never reached the business layer.
      expect(fileService.uploadFile).not.toHaveBeenCalled();
    });

    it('still accepts an allowlisted file (guards against the handler eating valid uploads)', async () => {
      const res = await request(app)
        .post('/api/files/upload')
        .attach('file', PDF_BUFFER, { filename: 'test-document.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(201);
      expect(fileService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'test-document.pdf', mimetype: 'application/pdf' }),
        expect.anything()
      );
    });
  });

  describe('POST /api/files/uploads', () => {
    // The multi-file route had the identical gap; a fix on /upload alone would
    // leave the same 500 one endpoint over.
    it('answers 400 when one file in the batch is not allowlisted', async () => {
      const res = await request(app)
        .post('/api/files/uploads')
        .attach('files', PDF_BUFFER, { filename: 'ok.pdf', contentType: 'application/pdf' })
        .attach('files', CSV_BUFFER, csvPart());

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not allowed');
      // uploadMultipleFiles delegates per file to fileService.uploadFile —
      // asserting on the wrong mock here would pass even if the batch reached
      // the business layer, so assert on the function the controller calls.
      expect(fileService.uploadFile).not.toHaveBeenCalled();
    });
  });
});
