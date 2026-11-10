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
    // Synthetic fixture shape (the real middleware sets userId / role /
    // roles / iss / sub / okfScopes); nothing in this suite reads it.
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
  validateFiles: jest.fn((req, res, next) => next()),
  // Mounted in fileRoutes.js between the multer middleware and validateFiles
  // (2026-10-12). Express throws at router-registration time if a layer is not
  // a function, so every suite that replaces this whole module must provide it.
  handleMulterError: jest.fn((err, req, res, next) => next(err))
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');

describe('GET /api/files (list) — the bundle lookup contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileService.getFiles.mockResolvedValue({ files: [], pagination: { totalFiles: 0, currentPage: 1 } });
  });

  // The OKF ingest worker resolves the repo's CURRENT bundle with
  // `GET /api/files?repo_id=..&is_bundle=true&limit=1` — ONE row, so the
  // filter must actually apply (the service's bundle branch keys on
  // `is_bundle === true`, a strict comparison). A query param arrives as the
  // STRING 'true'; only the route's Joi schema turns it into the boolean the
  // service branch tests. If that coercion breaks, the filter is dropped
  // silently and the worker takes whatever file is newest for the repo.
  it("coerces is_bundle='true' to the boolean the bundle filter needs", async () => {
    const res = await request(app).get('/api/files?repo_id=repo-1&is_bundle=true&limit=1');

    expect(res.status).toBe(200);
    expect(fileService.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ repo_id: 'repo-1', is_bundle: true, limit: 1 })
    );
    expect(typeof fileService.getFiles.mock.calls[0][0].is_bundle).toBe('boolean');
  });

  // The other direction of the same contract: the admin Documents list sends
  // `is_bundle=false` and the service's strict `is_bundle === false` branch
  // (bundle zips excluded, everything else included) is what keeps a bundle
  // zip out of the list — losing it re-opens the WS2 leak (a bundle rendered
  // as a document with a Delete affordance the server refuses).
  it("coerces is_bundle='false' to the boolean the non-bundle filter needs", async () => {
    const res = await request(app).get('/api/files?is_bundle=false');

    expect(res.status).toBe(200);
    expect(fileService.getFiles).toHaveBeenCalledWith(expect.objectContaining({ is_bundle: false }));
    expect(typeof fileService.getFiles.mock.calls[0][0].is_bundle).toBe('boolean');
  });
});
