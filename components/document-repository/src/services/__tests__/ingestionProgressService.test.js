/**
 * Unit tests for IngestionProgressService
 * Requirements: 1.1, 1.2, 1.4, 1.5
 */

// The shared-lib module is mapped via jest.config.js moduleNameMapper
// to our manual mock at __mocks__/shared-lib.js
const { dbService } = require('../../shared-lib');
const ingestionProgressService = require('../ingestionProgressService');

describe('IngestionProgressService', () => {
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

  describe('createOrReset', () => {
    it('should produce correct initial record shape', async () => {
      const fileId = 'test-file-123';
      const expectedRecord = {
        _key: fileId,
        file_id: fileId,
        current_stage: 'Extraction',
        stage_progress_percent: 0,
        stages_completed: 0,
        total_stages: 5,
        status: 'in_progress',
        started_at: expect.any(String),
        updated_at: expect.any(String),
        finished_at: null,
      };

      mockCursor.next.mockResolvedValue(expectedRecord);

      const result = await ingestionProgressService.createOrReset(fileId);

      expect(result).toMatchObject({
        _key: fileId,
        file_id: fileId,
        current_stage: 'Extraction',
        stage_progress_percent: 0,
        stages_completed: 0,
        total_stages: 5,
        status: 'in_progress',
        finished_at: null,
      });
      expect(result.started_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });

    it('should use UPSERT query to overwrite existing records', async () => {
      const fileId = 'existing-file';
      mockCursor.next.mockResolvedValue({ _key: fileId, file_id: fileId });

      await ingestionProgressService.createOrReset(fileId);

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const [query, bindVars] = mockDb.query.mock.calls[0];
      expect(query).toContain('UPSERT');
      expect(query).toContain('INSERT');
      expect(query).toContain('UPDATE');
      expect(bindVars.key).toBe(fileId);
      expect(bindVars.record._key).toBe(fileId);
      expect(bindVars['@collection']).toBe('ingestion_progress');
    });

    it('should set started_at and updated_at to current UTC timestamp', async () => {
      const fileId = 'timestamp-test';
      const beforeTime = new Date().toISOString();

      mockCursor.next.mockImplementation(() => {
        // Return the record passed to the query
        const record = mockDb.query.mock.calls[0][1].record;
        return Promise.resolve(record);
      });

      const result = await ingestionProgressService.createOrReset(fileId);
      const afterTime = new Date().toISOString();

      expect(result.started_at >= beforeTime).toBe(true);
      expect(result.started_at <= afterTime).toBe(true);
      expect(result.updated_at >= beforeTime).toBe(true);
      expect(result.updated_at <= afterTime).toBe(true);
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.createOrReset('')).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.createOrReset(null)).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.createOrReset(undefined)).rejects.toThrow('fileId is required');
    });

    it('should propagate database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('DB connection failed'));

      await expect(ingestionProgressService.createOrReset('file-1')).rejects.toThrow('DB connection failed');
    });
  });

  describe('updateStageTransition', () => {
    it('should update to the new stage and reset progress to 0', async () => {
      const fileId = 'transition-file';
      const newStage = 'Chunking';
      const stagesCompleted = 1;
      const updatedRecord = {
        _key: fileId,
        current_stage: newStage,
        stages_completed: stagesCompleted,
        stage_progress_percent: 0,
        updated_at: expect.any(String),
      };

      mockCollection.update.mockResolvedValue({ new: updatedRecord });

      const result = await ingestionProgressService.updateStageTransition(fileId, newStage, stagesCompleted);

      expect(result).toEqual(updatedRecord);
      expect(mockCollection.update).toHaveBeenCalledWith(
        fileId,
        expect.objectContaining({
          current_stage: 'Chunking',
          stages_completed: 1,
          stage_progress_percent: 0,
        }),
        { returnNew: true }
      );
    });

    it('should increment stages_completed correctly for each stage', async () => {
      const stages = ['Chunking', 'Guardrail', 'Labeling', 'Graph'];

      for (let i = 0; i < stages.length; i++) {
        const stagesCompleted = i + 1;
        mockCollection.update.mockResolvedValue({
          new: { current_stage: stages[i], stages_completed: stagesCompleted, stage_progress_percent: 0 },
        });

        const result = await ingestionProgressService.updateStageTransition('file-1', stages[i], stagesCompleted);

        expect(result.stages_completed).toBe(stagesCompleted);
        expect(result.stage_progress_percent).toBe(0);
        expect(result.current_stage).toBe(stages[i]);
      }
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.updateStageTransition('', 'Chunking', 1)).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.updateStageTransition(null, 'Chunking', 1)).rejects.toThrow('fileId is required');
    });

    it('should throw error when newStage is missing', async () => {
      await expect(ingestionProgressService.updateStageTransition('file-1', '', 1)).rejects.toThrow('newStage is required');
      await expect(ingestionProgressService.updateStageTransition('file-1', null, 1)).rejects.toThrow('newStage is required');
    });

    it('should throw error when stagesCompleted is not a number', async () => {
      await expect(ingestionProgressService.updateStageTransition('file-1', 'Chunking', 'one')).rejects.toThrow('stagesCompleted must be a number');
      await expect(ingestionProgressService.updateStageTransition('file-1', 'Chunking', NaN)).rejects.toThrow('stagesCompleted must be a number');
    });
  });

  describe('markCompleted', () => {
    it('should set terminal completed fields correctly', async () => {
      const fileId = 'completed-file';
      const completedRecord = {
        _key: fileId,
        current_stage: 'Completed',
        stages_completed: 5,
        stage_progress_percent: 100,
        status: 'completed',
        finished_at: expect.any(String),
        updated_at: expect.any(String),
      };

      mockCollection.update.mockResolvedValue({ new: completedRecord });

      const result = await ingestionProgressService.markCompleted(fileId);

      expect(result.current_stage).toBe('Completed');
      expect(result.stages_completed).toBe(5);
      expect(result.stage_progress_percent).toBe(100);
      expect(result.status).toBe('completed');
      expect(result.finished_at).toBeDefined();
    });

    it('should call collection.update with correct terminal values', async () => {
      mockCollection.update.mockResolvedValue({ new: {} });

      await ingestionProgressService.markCompleted('file-1');

      expect(mockCollection.update).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({
          current_stage: 'Completed',
          stages_completed: 5,
          stage_progress_percent: 100,
          status: 'completed',
          finished_at: expect.any(String),
          updated_at: expect.any(String),
        }),
        { returnNew: true }
      );
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.markCompleted('')).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.markCompleted(null)).rejects.toThrow('fileId is required');
    });
  });

  describe('markError', () => {
    it('should set status to error and finished_at timestamp', async () => {
      const fileId = 'error-file';
      const errorRecord = {
        _key: fileId,
        current_stage: 'Labeling', // preserved from before error
        status: 'error',
        finished_at: '2025-01-15T10:05:00.000Z',
        updated_at: '2025-01-15T10:05:00.000Z',
      };

      mockCollection.update.mockResolvedValue({ new: errorRecord });

      const result = await ingestionProgressService.markError(fileId);

      expect(result.status).toBe('error');
      expect(result.finished_at).toBeDefined();
      expect(result.finished_at).not.toBeNull();
    });

    it('should preserve current_stage (not overwrite it)', async () => {
      // markError only updates status and finished_at, NOT current_stage
      mockCollection.update.mockResolvedValue({ new: { status: 'error' } });

      await ingestionProgressService.markError('file-1');

      const updateData = mockCollection.update.mock.calls[0][1];
      expect(updateData).not.toHaveProperty('current_stage');
      expect(updateData.status).toBe('error');
      expect(updateData.finished_at).toBeDefined();
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.markError('')).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.markError(null)).rejects.toThrow('fileId is required');
    });
  });

  describe('updateProgress', () => {
    it('should reject non-numeric stageProgressPercent', async () => {
      await expect(ingestionProgressService.updateProgress('file-1', 'fifty')).rejects.toThrow('stageProgressPercent must be a number');
      await expect(ingestionProgressService.updateProgress('file-1', undefined)).rejects.toThrow('stageProgressPercent must be a number');
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.updateProgress('', 50)).rejects.toThrow('fileId is required');
      await expect(ingestionProgressService.updateProgress(null, 50)).rejects.toThrow('fileId is required');
    });

    it('should clamp percentage to [0, 100]', async () => {
      mockCollection.update.mockResolvedValue({ new: {} });

      await ingestionProgressService.updateProgress('file-1', 150);
      expect(mockCollection.update.mock.calls[0][1].stage_progress_percent).toBe(100);

      mockCollection.update.mockClear();
      await ingestionProgressService.updateProgress('file-1', -10);
      expect(mockCollection.update.mock.calls[0][1].stage_progress_percent).toBe(0);

      mockCollection.update.mockClear();
      await ingestionProgressService.updateProgress('file-1', 55.7);
      expect(mockCollection.update.mock.calls[0][1].stage_progress_percent).toBe(55);
    });
  });

  describe('getByFileId', () => {
    it('should return the document when found', async () => {
      const fileId = 'existing-file';
      const doc = { _key: fileId, file_id: fileId, current_stage: 'Extraction' };
      mockCollection.document.mockResolvedValue(doc);

      const result = await ingestionProgressService.getByFileId(fileId);

      expect(result).toEqual(doc);
      expect(mockDb.collection).toHaveBeenCalledWith('ingestion_progress');
      expect(mockCollection.document).toHaveBeenCalledWith(fileId);
    });

    it('should return null when document is not found', async () => {
      const notFoundError = new Error('document not found');
      notFoundError.errorNum = 1202;
      mockCollection.document.mockRejectedValue(notFoundError);

      const result = await ingestionProgressService.getByFileId('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for 404 error code', async () => {
      const notFoundError = new Error('not found');
      notFoundError.code = 404;
      mockCollection.document.mockRejectedValue(notFoundError);

      const result = await ingestionProgressService.getByFileId('missing');

      expect(result).toBeNull();
    });

    it('should throw error when fileId is missing', async () => {
      await expect(ingestionProgressService.getByFileId('')).rejects.toThrow('fileId is required');
    });

    it('should propagate unexpected errors', async () => {
      mockCollection.document.mockRejectedValue(new Error('unexpected DB error'));

      await expect(ingestionProgressService.getByFileId('file-1')).rejects.toThrow('unexpected DB error');
    });
  });

  describe('clampPercent', () => {
    it('should return 0 for non-number values', () => {
      expect(ingestionProgressService.clampPercent('hello')).toBe(0);
      expect(ingestionProgressService.clampPercent(NaN)).toBe(0);
      expect(ingestionProgressService.clampPercent(null)).toBe(0);
      expect(ingestionProgressService.clampPercent(undefined)).toBe(0);
    });

    it('should clamp values below 0 to 0', () => {
      expect(ingestionProgressService.clampPercent(-1)).toBe(0);
      expect(ingestionProgressService.clampPercent(-100)).toBe(0);
    });

    it('should clamp values above 100 to 100', () => {
      expect(ingestionProgressService.clampPercent(101)).toBe(100);
      expect(ingestionProgressService.clampPercent(999)).toBe(100);
    });

    it('should floor non-integer values', () => {
      expect(ingestionProgressService.clampPercent(50.9)).toBe(50);
      expect(ingestionProgressService.clampPercent(99.99)).toBe(99);
      expect(ingestionProgressService.clampPercent(0.5)).toBe(0);
    });

    it('should pass through valid integers unchanged', () => {
      expect(ingestionProgressService.clampPercent(0)).toBe(0);
      expect(ingestionProgressService.clampPercent(50)).toBe(50);
      expect(ingestionProgressService.clampPercent(100)).toBe(100);
    });
  });
});
