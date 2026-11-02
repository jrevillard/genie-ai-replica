/**
 * Property-Based Tests for IngestionProgressService
 *
 * Uses fast-check to validate correctness properties from the design document.
 * Tests mock ArangoDB interactions via the shared-lib moduleNameMapper and
 * focus on service logic and state transitions.
 */
const fc = require('fast-check');

// The shared-lib module is mapped via jest.config.js moduleNameMapper
// to our manual mock at __mocks__/shared-lib.js
const { dbService } = require('../../shared-lib');
const ingestionProgressService = require('../ingestionProgressService');

const STAGES = ['Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph'];

let mockDb;
let mockCollection;
let mockCursor;

beforeEach(() => {
  jest.clearAllMocks();

  mockCursor = {
    next: jest.fn(),
  };

  mockCollection = {
    document: jest.fn(),
    update: jest.fn(),
  };

  mockDb = {
    query: jest.fn().mockResolvedValue(mockCursor),
    collection: jest.fn().mockReturnValue(mockCollection),
  };

  dbService.getConnection.mockResolvedValue(mockDb);
});

/**
 * Feature: ingestion-progress-feedback, Property 1: Stage transition state machine
 * Validates: Requirements 1.2, 6.1
 *
 * For any valid stage transition, after applying the transition:
 * - stages_completed equals the provided stagesCompleted value
 * - stage_progress_percent resets to 0
 * - current_stage matches the new stage name
 */
describe('Feature: ingestion-progress-feedback, Property 1: Stage transition state machine', () => {
  it('stage transitions set correct state: stages_completed increments, progress resets to 0, current_stage matches new stage', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random stage index (0-4) for the new stage
        fc.integer({ min: 0, max: 4 }),
        // Generate a random previous stagesCompleted (0-4), new will be prev+1
        fc.integer({ min: 0, max: 4 }),
        // Generate a random fileId (alphanumeric to avoid edge cases with special chars)
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
        async (stageIndex, prevStagesCompleted, fileId) => {
          const newStage = STAGES[stageIndex];
          const newStagesCompleted = prevStagesCompleted + 1;

          // Mock the DB to return the written data
          mockCollection.update.mockResolvedValue({
            new: {
              _key: fileId,
              file_id: fileId,
              current_stage: newStage,
              stages_completed: newStagesCompleted,
              stage_progress_percent: 0,
              updated_at: new Date().toISOString(),
            },
          });

          const result = await ingestionProgressService.updateStageTransition(fileId, newStage, newStagesCompleted);

          // Verify the update was called with correct parameters
          const updateCall = mockCollection.update.mock.calls[mockCollection.update.mock.calls.length - 1];
          const updateData = updateCall[1];

          expect(updateData.current_stage).toBe(newStage);
          expect(updateData.stages_completed).toBe(newStagesCompleted);
          expect(updateData.stage_progress_percent).toBe(0);

          // Verify the result reflects the correct state
          expect(result.current_stage).toBe(newStage);
          expect(result.stages_completed).toBe(newStagesCompleted);
          expect(result.stage_progress_percent).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: ingestion-progress-feedback, Property 4: Re-trigger resets state
 * Validates: Requirements 1.7
 *
 * For any existing Ingestion_Progress record (regardless of its current_stage,
 * stages_completed, stage_progress_percent, or status values), when ingestion
 * is re-triggered, the resulting record has:
 * - current_stage = "Extraction"
 * - stages_completed = 0
 * - stage_progress_percent = 0
 * - status = "in_progress"
 * - finished_at = null
 */
describe('Feature: ingestion-progress-feedback, Property 4: Re-trigger resets state', () => {
  it('createOrReset always produces fresh initial state regardless of prior state', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random existing state to simulate any prior condition
        fc.record({
          fileId: fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
          current_stage: fc.constantFrom(...STAGES, 'Completed'),
          stages_completed: fc.integer({ min: 0, max: 5 }),
          stage_progress_percent: fc.integer({ min: 0, max: 100 }),
          status: fc.constantFrom('in_progress', 'completed', 'error'),
          finished_at: fc.constantFrom(null, '2025-01-01T00:00:00.000Z', '2025-06-15T12:30:00.000Z'),
        }),
        async (existingState) => {
          // Mock the DB - createOrReset uses UPSERT query
          let capturedRecord = null;
          mockDb.query.mockImplementation((query, bindVars) => {
            capturedRecord = bindVars.record;
            mockCursor.next.mockResolvedValue(capturedRecord);
            return Promise.resolve(mockCursor);
          });

          const result = await ingestionProgressService.createOrReset(existingState.fileId);

          // Property: regardless of prior state, output always has these exact values
          expect(capturedRecord.current_stage).toBe('Extraction');
          expect(capturedRecord.stages_completed).toBe(0);
          expect(capturedRecord.stage_progress_percent).toBe(0);
          expect(capturedRecord.status).toBe('in_progress');
          expect(capturedRecord.finished_at).toBeNull();

          // Verify file_id matches
          expect(capturedRecord.file_id).toBe(existingState.fileId);
          expect(capturedRecord._key).toBe(existingState.fileId);

          // Verify total_stages is 5
          expect(capturedRecord.total_stages).toBe(5);

          // Verify started_at is a valid ISO timestamp
          expect(capturedRecord.started_at).toBeDefined();
          expect(() => new Date(capturedRecord.started_at)).not.toThrow();
          expect(new Date(capturedRecord.started_at).toISOString()).toBe(capturedRecord.started_at);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: ingestion-progress-feedback, Property 5: Error state preserves failure stage
 * Validates: Requirements 1.5, 5.6
 *
 * For any valid current_stage value from the 5 pipeline stages, when an error
 * is recorded, the resulting Ingestion_Progress record:
 * - Preserves current_stage unchanged
 * - Sets status to "error"
 * - Sets finished_at to a non-null UTC timestamp
 */
describe('Feature: ingestion-progress-feedback, Property 5: Error state preserves failure stage', () => {
  it('markError preserves current_stage, sets status to error, and sets finished_at non-null', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random current_stage from the 5 pipeline stages
        fc.constantFrom(...STAGES),
        // Generate random fileId
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
        async (currentStage, fileId) => {
          // Mock the DB - markError calls collection.update
          let capturedUpdate = null;
          mockCollection.update.mockImplementation((key, updateData, opts) => {
            capturedUpdate = updateData;
            return Promise.resolve({
              new: {
                _key: fileId,
                file_id: fileId,
                current_stage: currentStage, // DB preserves existing value
                stages_completed: 2,
                stage_progress_percent: 45,
                status: updateData.status,
                finished_at: updateData.finished_at,
                updated_at: updateData.updated_at,
              },
            });
          });

          const result = await ingestionProgressService.markError(fileId);

          // Property: the update does NOT modify current_stage
          expect(capturedUpdate).not.toHaveProperty('current_stage');

          // Property: status is set to "error"
          expect(capturedUpdate.status).toBe('error');

          // Property: finished_at is non-null (a valid ISO string)
          expect(capturedUpdate.finished_at).not.toBeNull();
          expect(capturedUpdate.finished_at).toBeDefined();
          expect(new Date(capturedUpdate.finished_at).toISOString()).toBe(capturedUpdate.finished_at);

          // Property: returned result preserves current_stage unchanged
          expect(result.current_stage).toBe(currentStage);
          expect(result.status).toBe('error');
          expect(result.finished_at).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: ingestion-progress-feedback, Property 10: Progress percentage clamping
 * Validates: Requirements 1.3
 *
 * For any PATCH request containing a stage_progress_percent value, the stored
 * value is clamped to the integer range [0, 100]. Values < 0 are stored as 0,
 * values > 100 are stored as 100, and non-integer values are floored to the
 * nearest integer.
 */
describe('Feature: ingestion-progress-feedback, Property 10: Progress percentage clamping', () => {
  it('updateProgress clamps percentage to [0, 100] as floored integer', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random numbers including way out-of-range, floats, negatives
        fc.oneof(
          fc.integer({ min: -1000, max: 1000 }),
          fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
          fc.constant(0),
          fc.constant(100),
          fc.constant(-1),
          fc.constant(101)
        ),
        // Generate random fileId
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
        async (rawPercent, fileId) => {
          // Mock the DB
          let capturedUpdate = null;
          mockCollection.update.mockImplementation((key, updateData, opts) => {
            capturedUpdate = updateData;
            return Promise.resolve({
              new: {
                _key: fileId,
                file_id: fileId,
                stage_progress_percent: updateData.stage_progress_percent,
                updated_at: updateData.updated_at,
              },
            });
          });

          await ingestionProgressService.updateProgress(fileId, rawPercent);

          const storedPercent = capturedUpdate.stage_progress_percent;

          // Property: stored value is always an integer in [0, 100]
          expect(Number.isInteger(storedPercent)).toBe(true);
          expect(storedPercent).toBeGreaterThanOrEqual(0);
          expect(storedPercent).toBeLessThanOrEqual(100);

          // Property: clamping logic is correct
          const expectedFloored = Math.floor(rawPercent);
          if (expectedFloored < 0) {
            expect(storedPercent).toBe(0);
          } else if (expectedFloored > 100) {
            expect(storedPercent).toBe(100);
          } else {
            expect(storedPercent).toBe(expectedFloored);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('clampPercent helper directly clamps values to [0, 100] integers', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10000, max: 10000 }),
          fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
        ),
        (value) => {
          const result = ingestionProgressService.clampPercent(value);

          // Always an integer
          expect(Number.isInteger(result)).toBe(true);

          // Always in [0, 100]
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(100);

          // Correct clamping logic
          const floored = Math.floor(value);
          if (floored < 0) {
            expect(result).toBe(0);
          } else if (floored > 100) {
            expect(result).toBe(100);
          } else {
            expect(result).toBe(floored);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
