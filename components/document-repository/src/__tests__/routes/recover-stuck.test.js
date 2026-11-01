'use strict';

// Tests for POST /api/files/ingest/recover-stuck (#610): dataprep calls this
// once at startup to release files it left stuck in 'Ingesting' when the
// ingestion service restarted mid-ingest.
//
// metadataService is kept REAL (only the shared-lib db handle is mocked) so
// the AQL contract — the actual release behavior — is pinned, not a mock's
// idea of it.

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

// Mock auth middleware to bypass Keycloak — but keep the authorizeRole mock
// observable so the route's SERVICE_CALLBACK gate itself can be asserted.
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

// metadataService stays REAL (no jest.mock) — only the shared-lib db handle
// above is mocked, so the AQL contract asserted below is the actual query
// the service sends, not a mock's idea of it.

const request = require('supertest');
const app = require('../../app');
const { dbService, logger } = require('../../../shared-lib');
const fileService = require('../../services/fileService');
const { SERVICE_CALLBACK } = require('../../config/rolePolicy');

// A db whose query resolves to the given recovered file ids.
function mockDb(recovered) {
  const query = jest.fn().mockResolvedValue({ all: jest.fn().mockResolvedValue(recovered) });
  dbService.getConnection.mockResolvedValue({ query });
  return { query };
}

describe('POST /api/files/ingest/recover-stuck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('releases stuck files to Pending and logs each one', async () => {
    const { query } = mockDb(['file-1', 'file-2']);
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
    // The AQL contract: only non-bundle rows with a file_id, exclusion-aware,
    // tolerant of a row deleted mid-scan.
    const aql = query.mock.calls[0][0];
    expect(aql).toContain("LOWER(file.dataprep.status) == 'ingesting'");
    expect(aql).toContain('file.file_id != null');
    expect(aql).toContain('file.is_bundle != true');
    expect(aql).toContain('file.file_id NOT IN @excludeFileIds');
    expect(aql).toContain('OPTIONS { ignoreErrors: true }');
    expect(query.mock.calls[0][1]).toEqual({ excludeFileIds: [] });
  });

  it('passes the caller exclusion list through to the query', async () => {
    const { query } = mockDb([]);
    await request(app)
      .post('/api/files/ingest/recover-stuck')
      .send({ excludeFileIds: ['live-1', 'live-2'] });

    expect(query.mock.calls[0][1]).toEqual({ excludeFileIds: ['live-1', 'live-2'] });
  });

  it('rejects a malformed body with 400 instead of reaching the query', async () => {
    // Joi returns the ORIGINAL input on error: an unchecked malformed body
    // used to reach the AQL bind as a string and surface as a 500, which
    // dataprep then retried 30 times.
    const { query } = mockDb([]);

    const res = await request(app).post('/api/files/ingest/recover-stuck').send({ excludeFileIds: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an empty recovery when nothing is stuck', async () => {
    mockDb([]);

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, recovered: [], count: 0 });
    expect(fileService.addIngestionLog).not.toHaveBeenCalled();
  });

  it('still succeeds when the log write for one file fails', async () => {
    // The status flip already happened; a lost log line must not report a
    // failed recovery — dataprep would only retry the whole call for nothing.
    // But the loss is reported: a rejected write is the only place a dropped
    // WARN recovery entry becomes visible to an operator.
    mockDb(['file-1', 'file-2']);
    fileService.addIngestionLog.mockRejectedValueOnce(new Error('log write failed'));
    fileService.addIngestionLog.mockResolvedValueOnce({});

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to log recovery for file-1'));
  });

  it('returns 500 when the recovery query fails', async () => {
    const { query } = mockDb([]);
    query.mockRejectedValue(new Error('arangodb down'));

    const res = await request(app).post('/api/files/ingest/recover-stuck');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('gates the route behind the SERVICE_CALLBACK role', async () => {
    // The unit middleware mock bypasses role checks, so assert the
    // registration instead: a refactor that drops the gate stays red here.
    // The router is re-required in isolation because beforeEach wipes the
    // call history recorded when the app was first loaded.
    let layer;
    let calls;
    let results;
    jest.isolateModules(() => {
      const freshRouter = require('../../routes/fileRoutes');
      const freshAuth = require('../../middlewares/keycloak-auth-middleware');
      layer = freshRouter.stack.find(
        (l) => l.route && l.route.path === '/ingest/recover-stuck' && l.route.methods.post
      );
      calls = freshAuth.authorizeRole.mock.calls;
      results = freshAuth.authorizeRole.mock.results;
    });

    expect(layer).toBeTruthy();
    // authorizeRole(...) returns a fresh handler per call — the one guarding
    // this route must be among the values it returned for SERVICE_CALLBACK.
    const serviceCallbackReturnValues = calls
      .map((call, i) => (JSON.stringify(call[0]) === JSON.stringify(SERVICE_CALLBACK) ? results[i].value : null))
      .filter(Boolean);
    expect(serviceCallbackReturnValues.length).toBeGreaterThan(0);

    const routeHandlers = layer.route.stack.map((s) => s.handle);
    expect(routeHandlers.some((handler) => serviceCallbackReturnValues.includes(handler))).toBe(true);
  });
});
