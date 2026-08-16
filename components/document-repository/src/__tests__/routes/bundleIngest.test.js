'use strict';

// Story 2.5 — Tests for POST /api/files/ingest-bundle (OKF bundle ingest route)
// Copyright (c) 2024-2026 International Telecommunication Union (ITU)

// Mock shared-lib before anything else
jest.mock('../../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() }
}));

// Set true in a test to make authorizeRole reject with 403 (the middleware
// closure is created at route registration, so a per-test mockImplementation
// cannot change it — this flag can). "mock"-prefix keeps jest happy.
let mockDenyAuth = false;

// Mock auth middleware to bypass Keycloak
jest.mock('../../middlewares/keycloak-auth-middleware', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = { sub: 'test-user', preferred_username: 'testuser', realm_access: { roles: ['admin'] } };
    next();
  }),
  authorizeRole: jest.fn(() => (req, res, next) => {
    if (mockDenyAuth) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    return next();
  }),
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
  clamscan: {},
  dataprep: { host: 'http://dataprep', port: '5000', ingestPath: '/v1/dataprep', retractPath: '/v1/dataprep/retract' },
  allowedOrigins: ['http://localhost:3000']
}));

// Mock fileService — includes uploadBundle (Story 2.5)
jest.mock('../../services/fileService', () => ({
  uploadFile: jest.fn(),
  uploadBundle: jest.fn(),
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

// Mock file upload middleware (not used by ingest-bundle, but required by the route module)
jest.mock('../../middlewares/fileUpload', () => ({
  uploadSingle: jest.fn((req, res, next) => next()),
  uploadMultiple: jest.fn((req, res, next) => next()),
  validateFiles: jest.fn((req, res, next) => next())
}));

const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');
const fileController = require('../../controllers/fileController');

describe('POST /api/files/ingest-bundle (Story 2.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (app.close) app.close();
  });

  const repoId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const validBody = {
    bundle: Buffer.from('# Test OKF concept\nHello world').toString('base64'),
    graph_name: `OKF_${repoId}`,
    repo_id: repoId,
    originalFileName: 'concept.md'
  };

  it('should accept a valid bundle and return 202', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'new-file-id',
      file_name: 'concept.md',
      storage_path: '/uploads/new-file-id.md'
    });

    const res = await request(app).post('/api/files/ingest-bundle').send(validBody);

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.file_id).toBe('new-file-id');
    expect(res.body.graph_name).toBe(`OKF_${repoId}`);
    expect(fileService.uploadBundle).toHaveBeenCalledTimes(1);
    // graph_name + repo_id must be passed to uploadBundle
    const callArgs = fileService.uploadBundle.mock.calls[0][1];
    expect(callArgs.graph_name).toBe(`OKF_${repoId}`);
    expect(callArgs.repo_id).toBe(repoId);
  });

  it('should reject malware with 400 and not store anything', async () => {
    fileService.uploadBundle.mockRejectedValue(new Error('File contains virus: EICAR'));

    const res = await request(app).post('/api/files/ingest-bundle').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MALWARE_DETECTED');
    expect(res.body.message).toContain('virus');
  });

  it('should return 400 when graph_name is missing', async () => {
    const res = await request(app).post('/api/files/ingest-bundle').send({ bundle: validBody.bundle, repo_id: repoId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when graph_name does not match OKF_{repo_id}', async () => {
    const res = await request(app).post('/api/files/ingest-bundle').send({
      bundle: validBody.bundle,
      graph_name: 'OKF_11111111-2222-3333-4444-555555555555', // valid format, WRONG repo
      repo_id: repoId,
      originalFileName: 'concept.md'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OWNERSHIP_MISMATCH');
  });

  it('should return 400 when graph_name format is invalid (not OKF_{uuid})', async () => {
    const res = await request(app).post('/api/files/ingest-bundle').send({
      bundle: validBody.bundle,
      graph_name: 'GRAPH',
      repo_id: repoId,
      originalFileName: 'concept.md'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('should return 403 for a non-Admin caller', async () => {
    mockDenyAuth = true;
    try {
      const res = await request(app).post('/api/files/ingest-bundle').send(validBody);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(fileService.uploadBundle).not.toHaveBeenCalled();
    } finally {
      mockDenyAuth = false;
    }
  });

  it('should kick off ingestion fire-and-forget after storing (202 contract)', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'kick-file-id',
      file_name: 'concept.md',
      storage_path: '/uploads/kick-file-id.md'
    });
    const ingestSpy = jest.spyOn(fileController, '_ingestFileById').mockResolvedValue({ success: true });

    await request(app).post('/api/files/ingest-bundle').send(validBody);

    // Wait for the setImmediate fire-and-forget kick to run
    await new Promise((resolve) => setImmediate(resolve));
    expect(ingestSpy).toHaveBeenCalledWith('kick-file-id');
    ingestSpy.mockRestore();
  });

  it('should accept selected hierarchy labels and pass them to uploadBundle', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'labeled-file-id',
      file_name: 'concept.md',
      storage_path: '/uploads/labeled-file-id.md'
    });

    const res = await request(app)
      .post('/api/files/ingest-bundle')
      .send({ ...validBody, labels: ['Digital Government Services', 'Service Directory'] });

    expect(res.status).toBe(202);
    const callArgs = fileService.uploadBundle.mock.calls[0][1];
    expect(callArgs.labels).toEqual(['Digital Government Services', 'Service Directory']);
  });

  it('should default labels to an empty array when not provided', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'unlabeled-file-id',
      file_name: 'concept.md',
      storage_path: '/uploads/unlabeled-file-id.md'
    });

    const res = await request(app).post('/api/files/ingest-bundle').send(validBody);

    expect(res.status).toBe(202);
    const callArgs = fileService.uploadBundle.mock.calls[0][1];
    expect(callArgs.labels).toEqual([]);
  });

  it('should reject non-string label entries with 400', async () => {
    const res = await request(app)
      .post('/api/files/ingest-bundle')
      .send({ ...validBody, labels: ['Valid Label', 42] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(fileService.uploadBundle).not.toHaveBeenCalled();
  });

  it('should log (not crash) when the fire-and-forget ingestion fails', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'failing-file-id',
      file_name: 'concept.md',
      storage_path: '/uploads/failing-file-id.md'
    });
    const ingestSpy = jest.spyOn(fileController, '_ingestFileById').mockRejectedValue(new Error('dataprep down'));

    const res = await request(app).post('/api/files/ingest-bundle').send(validBody);

    // The 202 has already been sent — the ingestion failure must not turn it into a 500
    expect(res.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    ingestSpy.mockRestore();
  });
});

// ─── Story 2.9.1: defer_kick (per-concept enqueues must not race the lock) ────

describe('defer_kick (Story 2.9.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const repoId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const validBody = {
    bundle: Buffer.from('# Test OKF concept\nHello world').toString('base64'),
    graph_name: `OKF_${repoId}`,
    repo_id: repoId,
    originalFileName: 'concept.md'
  };

  it('DEFAULT (no flag) still fires the ingestion kick (legacy behavior)', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'kick-default',
      file_name: 'concept.md',
      storage_path: '/uploads/kick-default.md'
    });
    const ingestSpy = jest.spyOn(fileController, '_ingestFileById').mockResolvedValue({ success: true });

    await request(app).post('/api/files/ingest-bundle').send(validBody);

    await new Promise((resolve) => setImmediate(resolve));
    expect(ingestSpy).toHaveBeenCalledWith('kick-default');
    ingestSpy.mockRestore();
  });

  it('defer_kick: true stores the Pending doc WITHOUT kicking (the 2.9.4 worker owns draining)', async () => {
    fileService.uploadBundle.mockResolvedValue({
      file_id: 'no-kick',
      file_name: 'concept.md',
      storage_path: '/uploads/no-kick.md'
    });
    const ingestSpy = jest.spyOn(fileController, '_ingestFileById').mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/files/ingest-bundle')
      .send({ ...validBody, defer_kick: true });

    expect(res.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(fileService.uploadBundle).toHaveBeenCalledTimes(1);
    ingestSpy.mockRestore();
  });

  it('rejects a non-boolean defer_kick with 400', async () => {
    const res = await request(app)
      .post('/api/files/ingest-bundle')
      .send({ ...validBody, defer_kick: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
