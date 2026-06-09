'use strict';

// Mock shared-lib
jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// Mock auth middleware
jest.mock('../../middlewares/keycloak-auth-middleware', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      sub: '12345678-1234-1234-1234-123456789012',
      preferred_username: 'testuser',
      realm_access: { roles: ['admin'] }
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
    allowedMimeTypes: ['application/pdf'],
    allowedExtensions: ['.pdf'],
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
const labelService = require('../../services/labelService');

describe('Label Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/labels', () => {
    it('should return all labels', async () => {
      const labels = [{ _key: '1', name: 'Category A', level: 'Category' }];
      labelService.getLabels = jest.fn().mockResolvedValue(labels);

      const res = await request(app).get('/api/labels');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(labels);
    });

    it('should pass filter params to service', async () => {
      labelService.getLabels = jest.fn().mockResolvedValue([]);

      await request(app).get('/api/labels?level=Category&status=Active');

      expect(labelService.getLabels).toHaveBeenCalledWith({
        level: 'Category',
        status: 'Active',
        name: undefined,
        parentId: undefined,
        publish: undefined
      });
    });

    it('should handle service errors with 500', async () => {
      labelService.getLabels = jest.fn().mockRejectedValue(new Error('DB down'));

      const res = await request(app).get('/api/labels');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/labels/:labelId', () => {
    it('should return a label by ID', async () => {
      const label = { _key: '1', name: 'Test Label' };
      labelService.getLabelById = jest.fn().mockResolvedValue(label);

      const res = await request(app).get('/api/labels/1');

      expect(res.status).toBe(200);
      expect(res.body._key).toBe('1');
    });

    it('should return 500 when label not found', async () => {
      labelService.getLabelById = jest.fn().mockRejectedValue(new Error('not found'));

      const res = await request(app).get('/api/labels/nonexistent');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/labels', () => {
    it('should create a label and return 201', async () => {
      const newLabel = { _key: '2', name: 'New Label', level: 'Subcategory', status: 'Active' };
      labelService.createLabel = jest.fn().mockResolvedValue(newLabel);

      const res = await request(app)
        .post('/api/labels')
        .send({ name: 'New Label', level: 'Subcategory', status: 'Active' });

      expect(res.status).toBe(201);
      expect(res.body._key).toBe('2');
      expect(labelService.createLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Label', level: 'Subcategory', status: 'Active' })
      );
    });

    it('should handle creation errors with 500', async () => {
      labelService.createLabel = jest.fn().mockRejectedValue(new Error('Parent must be a category'));

      const res = await request(app)
        .post('/api/labels')
        .send({ name: 'Bad', level: 'Topic', status: 'Active', parentId: 'invalid' });

      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /api/labels/:labelId', () => {
    it('should update a label', async () => {
      const updated = { _key: '1', name: 'Updated Label' };
      labelService.updateLabel = jest.fn().mockResolvedValue(updated);

      const res = await request(app).patch('/api/labels/1').send({ name: 'Updated Label' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Label');
    });
  });

  describe('DELETE /api/labels/:labelId', () => {
    it('should delete a label', async () => {
      labelService.deleteLabel = jest.fn().mockResolvedValue();

      const res = await request(app).delete('/api/labels/1');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Label deleted successfully');
    });

    it('should handle delete errors with 500', async () => {
      labelService.deleteLabel = jest.fn().mockRejectedValue(new Error('has children'));

      const res = await request(app).delete('/api/labels/1');
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/labels/:labelId/with-children', () => {
    it('should delete label and children', async () => {
      labelService.deleteCategoryWithChildren = jest.fn().mockResolvedValue();

      const res = await request(app).delete('/api/labels/1/with-children');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('children');
      expect(labelService.deleteCategoryWithChildren).toHaveBeenCalledWith('1');
    });
  });

  describe('GET /api/labels/:labelId/related', () => {
    it('should return related labels', async () => {
      const related = [{ _key: '2', name: 'Child' }];
      labelService.getRelatedLabels = jest.fn().mockResolvedValue(related);

      const res = await request(app).get('/api/labels/1/related');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(labelService.getRelatedLabels).toHaveBeenCalledWith('1');
    });
  });
});
