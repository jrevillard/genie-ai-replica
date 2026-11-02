/**
 * Unit tests for ingestionProgressController and ingestion-progress routes.
 * Tests HTTP response codes and response shapes using supertest.
 *
 * Requirements validated: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

const request = require('supertest');
const express = require('express');

// shared-lib is mocked via jest.config.js moduleNameMapper → __mocks__/shared-lib.js

// Mock the services
jest.mock('../../services/ingestionProgressService');
jest.mock('../../services/metadataService');

const ingestionProgressService = require('../../services/ingestionProgressService');
const metadataService = require('../../services/metadataService');
const ingestionProgressController = require('../ingestionProgressController');

// --- Test app setup ---

/**
 * Creates a mini express app with the ingestion-progress routes for testing.
 * Auth middleware is configurable to simulate authenticated/unauthenticated/unauthorized states.
 */
function createTestApp({ authenticated = true, userRole = 'Admin' } = {}) {
  const app = express();
  app.use(express.json());

  // Simulated authenticateToken middleware
  const authenticateToken = (req, res, next) => {
    if (!authenticated) {
      return res.status(401).json({ success: false, message: 'Authorization header missing' });
    }
    req.user = { userId: 'test-user-id', role: userRole, _key: 'test-user-key' };
    next();
  };

  // Simulated authorizeRole middleware
  const authorizeRole = (allowedRoles) => {
    return (req, res, next) => {
      if (!req.user || !req.user.role) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      const hasAllowedRole = allowedRoles.some(
        (role) => role.toLowerCase() === String(req.user.role).toLowerCase()
      );
      if (!hasAllowedRole) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. User does not have sufficient role',
        });
      }
      next();
    };
  };

  // Mount the routes matching fileRoutes.js pattern
  const router = express.Router();
  router.use(authenticateToken);
  router.get(
    '/:fileId/ingestion-progress',
    authorizeRole(['Admin', 'Manager', 'AI Engineer']),
    ingestionProgressController.getProgress
  );
  router.patch(
    '/:fileId/ingestion-progress',
    authorizeRole(['Admin', 'Manager', 'AI Engineer']),
    ingestionProgressController.updateProgress
  );
  app.use('/api/files', router);

  return app;
}

// --- Test data ---

const mockProgressRecord = {
  file_id: 'file-123',
  current_stage: 'Labeling',
  stage_progress_percent: 45,
  stages_completed: 3,
  total_stages: 5,
  status: 'in_progress',
  started_at: '2025-01-15T10:00:00.000Z',
  updated_at: '2025-01-15T10:05:30.000Z',
  finished_at: null,
};

const mockFileMetadata = {
  file_id: 'file-123',
  file_name: 'test-document.pdf',
  dataprep: { status: 'Ingesting' },
};

// --- Tests ---

describe('IngestionProgressController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/files/:fileId/ingestion-progress', () => {
    it('should return 200 with correct record shape when file and progress exist', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileMetadata);
      ingestionProgressService.getByFileId.mockResolvedValue(mockProgressRecord);

      const app = createTestApp();
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        file_id: 'file-123',
        current_stage: 'Labeling',
        stage_progress_percent: 45,
        stages_completed: 3,
        total_stages: 5,
        status: 'in_progress',
        started_at: '2025-01-15T10:00:00.000Z',
        updated_at: '2025-01-15T10:05:30.000Z',
        finished_at: null,
      });
    });

    it('should return 404 when file does not exist', async () => {
      metadataService.getMetadataById.mockResolvedValue(null);

      const app = createTestApp();
      const res = await request(app).get('/api/files/nonexistent-file/ingestion-progress');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('File not found');
    });

    it('should return 404 when file exists but no progress record found', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileMetadata);
      ingestionProgressService.getByFileId.mockResolvedValue(null);

      const app = createTestApp();
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('No ingestion progress found for file');
    });

    it('should return 500 when service throws an error', async () => {
      metadataService.getMetadataById.mockRejectedValue(new Error('Database connection failed'));

      const app = createTestApp();
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /api/files/:fileId/ingestion-progress', () => {
    it('should return 200 for valid stage transition body', async () => {
      const updatedRecord = { ...mockProgressRecord, current_stage: 'Graph', stages_completed: 4 };
      ingestionProgressService.updateStageTransition.mockResolvedValue(updatedRecord);

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ current_stage: 'Graph', stages_completed: 4 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(updatedRecord);
      expect(ingestionProgressService.updateStageTransition).toHaveBeenCalledWith('file-123', 'Graph', 4);
    });

    it('should return 200 for valid progress percent update', async () => {
      const updatedRecord = { ...mockProgressRecord, stage_progress_percent: 75 };
      ingestionProgressService.updateProgress.mockResolvedValue(updatedRecord);

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: 75, message: 'Processing chunk 75/100' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ingestionProgressService.updateProgress).toHaveBeenCalledWith(
        'file-123',
        75,
        'Processing chunk 75/100'
      );
    });

    it('should return 200 for status=completed update', async () => {
      const completedRecord = {
        ...mockProgressRecord,
        status: 'completed',
        current_stage: 'Completed',
        stages_completed: 5,
        stage_progress_percent: 100,
        finished_at: '2025-01-15T10:10:00.000Z',
      };
      ingestionProgressService.markCompleted.mockResolvedValue(completedRecord);

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ingestionProgressService.markCompleted).toHaveBeenCalledWith('file-123');
    });

    it('should return 200 for status=error update', async () => {
      const errorRecord = {
        ...mockProgressRecord,
        status: 'error',
        finished_at: '2025-01-15T10:10:00.000Z',
      };
      ingestionProgressService.markError.mockResolvedValue(errorRecord);

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ status: 'error' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ingestionProgressService.markError).toHaveBeenCalledWith('file-123');
    });

    it('should return 400 for empty body', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation error');
    });

    it('should return 400 for invalid current_stage value', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ current_stage: 'InvalidStage', stages_completed: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation error');
    });

    it('should return 400 for stage_progress_percent out of range', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: 150 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation error');
    });

    it('should return 400 for negative stage_progress_percent', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: -5 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation error');
    });

    it('should return 400 for invalid status value', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for stages_completed > 5', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ current_stage: 'Graph', stages_completed: 10 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when progress record not found during update', async () => {
      const notFoundError = new Error('Document not found');
      notFoundError.errorNum = 1202;
      ingestionProgressService.markCompleted.mockRejectedValue(notFoundError);

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ status: 'completed' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('No ingestion progress found for file');
    });

    it('should return 500 when service throws an unexpected error', async () => {
      ingestionProgressService.updateProgress.mockRejectedValue(new Error('Unexpected DB error'));

      const app = createTestApp();
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: 50 });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Authentication - 401 for unauthenticated requests', () => {
    it('GET should return 401 when no auth token provided', async () => {
      const app = createTestApp({ authenticated: false });
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('PATCH should return 401 when no auth token provided', async () => {
      const app = createTestApp({ authenticated: false });
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: 50 });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Authorization - 403 for unauthorized roles', () => {
    it('GET should return 403 for User role', async () => {
      const app = createTestApp({ userRole: 'User' });
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Access denied');
    });

    it('PATCH should return 403 for User role', async () => {
      const app = createTestApp({ userRole: 'User' });
      const res = await request(app)
        .patch('/api/files/file-123/ingestion-progress')
        .send({ stage_progress_percent: 50 });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Access denied');
    });

    it('GET should return 403 for Viewer role', async () => {
      const app = createTestApp({ userRole: 'Viewer' });
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('GET should return 200 for Manager role', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileMetadata);
      ingestionProgressService.getByFileId.mockResolvedValue(mockProgressRecord);

      const app = createTestApp({ userRole: 'Manager' });
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(200);
    });

    it('GET should return 200 for AI Engineer role', async () => {
      metadataService.getMetadataById.mockResolvedValue(mockFileMetadata);
      ingestionProgressService.getByFileId.mockResolvedValue(mockProgressRecord);

      const app = createTestApp({ userRole: 'AI Engineer' });
      const res = await request(app).get('/api/files/file-123/ingestion-progress');

      expect(res.status).toBe(200);
    });
  });
});
