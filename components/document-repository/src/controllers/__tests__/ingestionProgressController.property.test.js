/**
 * Property-Based Tests for Ingestion Progress Controller - GET endpoint round-trip
 *
 * Feature: ingestion-progress-feedback, Property 9: GET endpoint round-trip
 * Validates: Requirements 2.1
 *
 * For any valid Ingestion_Progress record stored in the database, a GET request
 * to /api/files/{fileId}/ingestion-progress SHALL return a response body where
 * every field (file_id, current_stage, stage_progress_percent, stages_completed,
 * total_stages, started_at, updated_at, finished_at) matches the stored record exactly.
 */
const fc = require('fast-check');
const request = require('supertest');
const express = require('express');

// Mock the auth middleware before requiring routes
jest.mock('../../middlewares/keycloak-auth-middleware', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { userId: 'test-user', role: 'Admin' };
    next();
  },
  authorizeRole: () => (req, res, next) => next(),
}));

// Mock the services used by the controller
jest.mock('../../services/ingestionProgressService');
jest.mock('../../services/metadataService');

const ingestionProgressService = require('../../services/ingestionProgressService');
const metadataService = require('../../services/metadataService');

// Create a minimal express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json());
  const ingestionProgressController = require('../ingestionProgressController');
  const { authenticateToken, authorizeRole } = require('../../middlewares/keycloak-auth-middleware');

  app.get(
    '/api/files/:fileId/ingestion-progress',
    authenticateToken,
    authorizeRole(['Admin', 'Manager', 'AI Engineer']),
    ingestionProgressController.getProgress
  );
  return app;
}

const STAGES = ['Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph', 'Completed'];
const STATUSES = ['in_progress', 'completed', 'error'];

/**
 * Generate a valid ISO 8601 timestamp string from a random integer (epoch ms).
 */
const arbIsoTimestamp = fc
  .integer({ min: 1704067200000, max: 1767225600000 }) // 2024-01-01 to 2026-01-01
  .map(ms => new Date(ms).toISOString());

/**
 * Arbitrary generator for valid Ingestion_Progress records.
 * Produces records with all required fields as they would be stored in the DB.
 */
const arbIngestionProgressRecord = fc.record({
  file_id: fc.stringMatching(/^[a-zA-Z0-9_-]{1,30}$/),
  current_stage: fc.constantFrom(...STAGES),
  stage_progress_percent: fc.integer({ min: 0, max: 100 }),
  stages_completed: fc.integer({ min: 0, max: 5 }),
  total_stages: fc.constant(5),
  status: fc.constantFrom(...STATUSES),
  started_at: arbIsoTimestamp,
  updated_at: arbIsoTimestamp,
  finished_at: fc.oneof(
    fc.constant(null),
    arbIsoTimestamp
  ),
});

describe('Feature: ingestion-progress-feedback, Property 9: GET endpoint round-trip', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/files/:fileId/ingestion-progress returns all fields matching the stored record exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbIngestionProgressRecord,
        async (record) => {
          // Mock metadataService to indicate the file exists
          metadataService.getMetadataById.mockResolvedValue({ _key: record.file_id, name: 'test-file.pdf' });

          // Mock ingestionProgressService.getByFileId to return the generated record
          ingestionProgressService.getByFileId.mockResolvedValue(record);

          const res = await request(app)
            .get(`/api/files/${record.file_id}/ingestion-progress`)
            .set('Authorization', 'Bearer test-token')
            .expect(200);

          // Verify the response structure
          expect(res.body.success).toBe(true);
          expect(res.body.data).toBeDefined();

          const data = res.body.data;

          // Property: every field in the response matches the stored record exactly
          expect(data.file_id).toBe(record.file_id);
          expect(data.current_stage).toBe(record.current_stage);
          expect(data.stage_progress_percent).toBe(record.stage_progress_percent);
          expect(data.stages_completed).toBe(record.stages_completed);
          expect(data.total_stages).toBe(record.total_stages);
          expect(data.status).toBe(record.status);
          expect(data.started_at).toBe(record.started_at);
          expect(data.updated_at).toBe(record.updated_at);
          expect(data.finished_at).toBe(record.finished_at);
        }
      ),
      { numRuns: 100 }
    );
  });
});
