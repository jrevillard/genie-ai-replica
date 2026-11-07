'use strict';

// D4 (chat-source resolution, W4 story 2) — the serve-path refusal for files
// stamped okf_restricted (okf-server's LOCAL snapshot of the repo's 6-1c
// restriction). A caller who is neither Admin nor okf-service is refused on
// ALL four serve paths (download / view / viewbrowser / batch-download) with
// 403 OKF_RESTRICTED; Admin and okf-service pass; unrestricted files are
// unchanged for everyone. The snapshot is stamped by the okf-server import
// (producer-service.stampSources) and re-propagated by the Access-panel
// toggle (propagateRestrictedToSources).

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

// Mock auth middleware to bypass Keycloak. The IMPLEMENTATION is per-test
// replaceable: okf-restricted tests override authenticateToken to inject the
// caller's role set (the citizen / okf-service distinction is the subject).
const keycloakAuth = require('../../middlewares/keycloak-auth-middleware');
jest.mock('../../middlewares/keycloak-auth-middleware', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      sub: '12345678-1234-1234-1234-123456789012',
      preferred_username: 'testuser',
      roles: ['Admin']
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
  handleMulterError: jest.fn((err, req, res, next) => next(err))
}));

// Archiver mock WITH append — the batch-download refusal surfaces as an
// appended error entry, so the suite asserts on it. finalize ENDS the piped
// response: the route streams the zip through the archive and the supertest
// request only completes when the stream ends.
jest.mock('archiver', () => {
  const state = { res: null };
  const fn = jest.fn(() => ({
    pipe: jest.fn((s) => {
      state.res = s;
    }),
    file: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn(() => {
      if (state.res && typeof state.res.end === 'function') state.res.end();
    })
  }));
  fn.__state = state;
  return fn;
});

// Mock fs so the controller's _getFileAndPath can succeed
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: {
    access: jest.fn(),
    readFile: jest.fn()
  }
}));

const archiver = require('archiver');
const path = require('path');
const fs = require('fs').promises;
const request = require('supertest');
const app = require('../../app');
const fileService = require('../../services/fileService');
const metadataService = require('../../services/metadataService');
const { createMockFileRecord } = require('../mocks/files');

// Inject the caller's role set — the subject of the refusal matrix. okfScopes
// mirrors the middleware's D4 addition (the token's okf_scopes claim).
function asCaller(roles, okfScopes) {
  keycloakAuth.authenticateToken.mockImplementation((req, res, next) => {
    req.user = { sub: 'caller-1', preferred_username: 'caller', roles, okfScopes: okfScopes || [] };
    next();
  });
}

function restrictedRecord(over = {}) {
  const storagePath = path.join('uploads', 'restricted-file.pdf');
  return createMockFileRecord({
    file_name: 'restricted-source.pdf',
    file_type: 'application/pdf',
    storage_path: storagePath,
    okf_repo_id: 'repo-1',
    okf_restricted: true,
    ...over
  });
}

describe('D4 serve-path refusal for okf_restricted files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.access.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue(Buffer.from('bytes'));
    // default caller: plain citizen with NO admin/service role
    asCaller(['user']);
  });

  describe('GET /api/files/:fileId/download', () => {
    it('refuses a restricted file to a plain user with 403 OKF_RESTRICTED', async () => {
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('OKF_RESTRICTED');
    });

    it('admits an Admin to the same restricted file', async () => {
      asCaller(['Admin']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
      expect(metadataService.getMetadataById).toHaveBeenCalledWith('f-1');
    });

    it('admits the okf-service pipeline account (the drain reads bytes)', async () => {
      asCaller(['okf-service']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });

    it('never refuses an UNRESTRICTED file to a plain user', async () => {
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord({ okf_restricted: false }));
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });

    // D4's letter: refused WITHOUT the okf scope — a scope holder is inside
    // the fence's exception. The scope rides the token (req.user.okfScopes).
    it('admits a caller holding THIS repo okf scope (read level)', async () => {
      asCaller(['user'], ['okf:t:repo-1:read']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });

    it('admits a caller holding the repo okf scope at ADMIN level', async () => {
      asCaller(['user'], ['okf:t:repo-1:admin']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });

    it('admits a WILDCARD okf scope holder', async () => {
      asCaller(['user'], ['okf:t:*:admin']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });

    it('refuses a caller scoped to a DIFFERENT repo', async () => {
      asCaller(['user'], ['okf:t:other-repo:read']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('OKF_RESTRICTED');
    });

    it('refuses a grammar-invalid scope level (typo grants nothing)', async () => {
      asCaller(['user'], ['okf:t:repo-1:write']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).toBe(403);
    });

    it('admits the tools-admin super-role without any scope', async () => {
      asCaller(['tools-admin']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/download');
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /api/files/:fileId/viewbrowser', () => {
    it('refuses a restricted file to a plain user', async () => {
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/viewbrowser');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('OKF_RESTRICTED');
    });
  });

  describe('GET /api/files/:fileId/view', () => {
    it('refuses a restricted file to a plain user — before the base64 copies', async () => {
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/view');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('OKF_RESTRICTED');
      // the byte reader must never have been paid for a refused file
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    // Review fix (2026-11-07): the refusal was the ONLY /view test — the D4
    // rewire (viewFile now goes through _getFileAndPath + assertServeAllowed
    // + _readFileBase64) had no admission test, so a rewiring slip (e.g. the
    // file id passed where the resolved path belongs) would 500 every /view
    // consumer — the okf-server PII pipeline and the Studio review surface —
    // with green gates. Pin the success shape on the rewired path.
    it('serves an UNRESTRICTED file with the base64 envelope (admission after the D4 rewire)', async () => {
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord({ okf_restricted: false }));
      const res = await request(app).get('/api/files/f-1/view');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        file_name: 'restricted-source.pdf',
        base64: Buffer.from('bytes').toString('base64')
      });
      // the rewire reads BYTES via the resolved storage path, not the id
      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('restricted-file.pdf'));
    });

    it('admits a THIS-repo okf scope holder to a restricted file on /view too', async () => {
      asCaller(['user'], ['okf:t:repo-1:read']);
      metadataService.getMetadataById.mockResolvedValue(restrictedRecord());
      const res = await request(app).get('/api/files/f-1/view');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/files/downloads (batch zip)', () => {
    it('the restricted member becomes an error entry naming the refusal — not a fake missing file', async () => {
      metadataService.getMetadataById.mockImplementation(async (id) =>
        id === 'restricted-1'
          ? restrictedRecord()
          : createMockFileRecord({ storage_path: path.join('uploads', 'open.pdf') })
      );
      const res = await request(app)
        .post('/api/files/downloads')
        .send({ fileIds: ['open-1', 'restricted-1'] });
      // the route streams; the assertions live on the archiver mock
      expect(res.status).toBe(200);
      const zip = archiver.mock.results[0].value;
      expect(zip.file).toHaveBeenCalledTimes(1); // only the open member zipped
      expect(zip.append).toHaveBeenCalledTimes(1);
      const [text, info] = zip.append.mock.calls[0];
      expect(text).toContain('OKF_RESTRICTED');
      expect(info.name).toBe('ERROR_restricted-1.txt');
    });
  });

  describe('PATCH /api/files/:fileId (the snapshot write)', () => {
    it('accepts okf_restricted beside okf_repo_id (the schema whitelist)', async () => {
      metadataService.getMetadataById.mockResolvedValue(createMockFileRecord({}));
      const record = createMockFileRecord({ okf_repo_id: 'repo-1', okf_restricted: true });
      const queryFn = jest.fn(async () => ({ next: async () => record }));
      fileService.getDb.mockResolvedValue({ query: queryFn });
      const res = await request(app).patch('/api/files/f-1').send({ okf_repo_id: 'repo-1', okf_restricted: true });
      // 200 = schema accepted + update ran; 400 would mean the whitelist
      // still rejects the D4 field. The response projection
      // (_formatFileRecord) predates D4 and whitelists its own fields — the
      // CONTRACT is the persisted update, asserted on the bind below.
      expect(res.status).toBe(200);
      const bind = queryFn.mock.calls[0][1];
      expect(bind.updates).toMatchObject({ okf_repo_id: 'repo-1', okf_restricted: true });
    });
  });
});
