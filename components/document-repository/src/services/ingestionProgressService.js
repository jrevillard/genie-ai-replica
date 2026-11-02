const { logger } = require('../../shared-lib');
const { dbService } = require('../../shared-lib');

/**
 * Service for managing ingestion progress records.
 * Tracks the current stage, sub-step progress, and terminal state
 * for each file being ingested through the 5-stage pipeline.
 */
class IngestionProgressService {
  constructor() {
    this.collectionName = 'ingestion_progress';
    this.STAGES = ['Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph'];
    this.TOTAL_STAGES = 5;

    // Ensure collection exists on startup
    this._ensureCollection();
  }

  /**
   * Ensures the ingestion_progress collection exists in the database.
   * Creates it if missing. Non-blocking — logs errors but doesn't throw.
   */
  async _ensureCollection() {
    try {
      const db = await this.getDb();
      const collection = db.collection(this.collectionName);
      const exists = await collection.exists();
      if (!exists) {
        await collection.create();
        logger.info(`[INGESTION-PROGRESS] Created missing collection: ${this.collectionName}`);
      }
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to ensure collection exists: ${error.message}`);
    }
  }

  /**
   * Get database connection
   */
  async getDb() {
    return await dbService.getConnection('files');
  }

  /**
   * Clamps a progress percentage to the integer range [0, 100].
   * Values < 0 are stored as 0, values > 100 are stored as 100,
   * non-integer values are floored to the nearest integer.
   * @param {number} value - The raw percentage value
   * @returns {number} Clamped integer in [0, 100]
   */
  clampPercent(value) {
    if (typeof value !== 'number' || isNaN(value)) {
      return 0;
    }
    const floored = Math.floor(value);
    if (floored < 0) return 0;
    if (floored > 100) return 100;
    return floored;
  }

  /**
   * Creates a fresh ingestion progress record or resets an existing one.
   * Overwrites any existing record with fresh initial values.
   * @param {string} fileId - The file identifier
   * @returns {Object} The created/reset progress record
   */
  async createOrReset(fileId) {
    if (!fileId) {
      throw new Error('fileId is required');
    }

    const db = await this.getDb();
    const now = new Date().toISOString();

    const record = {
      _key: fileId,
      file_id: fileId,
      current_stage: 'Extraction',
      stage_progress_percent: 0,
      stages_completed: 0,
      total_stages: this.TOTAL_STAGES,
      status: 'in_progress',
      started_at: now,
      updated_at: now,
      finished_at: null
    };

    try {
      // Use UPSERT to overwrite any existing record with fresh values
      const query = `
        UPSERT { _key: @key }
        INSERT @record
        UPDATE @record
        IN @@collection
        RETURN NEW
      `;
      const cursor = await db.query(query, {
        key: fileId,
        record: record,
        '@collection': this.collectionName
      });
      const result = await cursor.next();
      logger.info(`[INGESTION-PROGRESS] Created/reset progress record for file ${fileId}`);
      return result;
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to create/reset progress for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetches the current ingestion progress record for a file.
   * @param {string} fileId - The file identifier
   * @returns {Object|null} The progress record or null if not found
   */
  async getByFileId(fileId) {
    if (!fileId) {
      throw new Error('fileId is required');
    }

    const db = await this.getDb();

    try {
      const collection = db.collection(this.collectionName);
      const doc = await collection.document(fileId);
      return doc;
    } catch (error) {
      if (error.errorNum === 1202 || error.code === 404) {
        // Document not found
        return null;
      }
      logger.error(`[INGESTION-PROGRESS] Failed to get progress for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Updates the progress record when transitioning between pipeline stages.
   * Increments stages_completed and resets stage_progress_percent to 0.
   * @param {string} fileId - The file identifier
   * @param {string} newStage - The new stage name
   * @param {number} stagesCompleted - The new stages_completed count
   * @returns {Object} The updated progress record
   */
  async updateStageTransition(fileId, newStage, stagesCompleted) {
    if (!fileId) {
      throw new Error('fileId is required');
    }
    if (!newStage) {
      throw new Error('newStage is required');
    }
    if (typeof stagesCompleted !== 'number' || isNaN(stagesCompleted)) {
      throw new Error('stagesCompleted must be a number');
    }

    const db = await this.getDb();
    const now = new Date().toISOString();

    try {
      const collection = db.collection(this.collectionName);
      const result = await collection.update(fileId, {
        current_stage: newStage,
        stages_completed: stagesCompleted,
        stage_progress_percent: 0,
        updated_at: now
      }, { returnNew: true });
      logger.info(`[INGESTION-PROGRESS] Stage transition for file ${fileId}: ${newStage} (${stagesCompleted} completed)`);
      return result.new;
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to update stage transition for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Updates the sub-step progress within the current stage.
   * Clamps the percentage to [0, 100] as a floored integer.
   * @param {string} fileId - The file identifier
   * @param {number} stageProgressPercent - The progress percentage (will be clamped)
   * @param {string} [message] - Optional progress message
   * @returns {Object} The updated progress record
   */
  async updateProgress(fileId, stageProgressPercent, message) {
    if (!fileId) {
      throw new Error('fileId is required');
    }
    if (typeof stageProgressPercent !== 'number') {
      throw new Error('stageProgressPercent must be a number');
    }

    const db = await this.getDb();
    const now = new Date().toISOString();
    const clampedPercent = this.clampPercent(stageProgressPercent);

    const updateData = {
      stage_progress_percent: clampedPercent,
      updated_at: now
    };

    if (message !== undefined && message !== null) {
      updateData.message = message;
    }

    try {
      const collection = db.collection(this.collectionName);
      const result = await collection.update(fileId, updateData, { returnNew: true });
      logger.debug(`[INGESTION-PROGRESS] Progress update for file ${fileId}: ${clampedPercent}%`);
      return result.new;
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to update progress for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Marks ingestion as successfully completed.
   * Sets current_stage to "Completed", stages_completed to total_stages,
   * stage_progress_percent to 100, status to "completed", finished_at to now.
   * @param {string} fileId - The file identifier
   * @returns {Object} The updated progress record
   */
  async markCompleted(fileId) {
    if (!fileId) {
      throw new Error('fileId is required');
    }

    const db = await this.getDb();
    const now = new Date().toISOString();

    try {
      const collection = db.collection(this.collectionName);
      const result = await collection.update(fileId, {
        current_stage: 'Completed',
        stages_completed: this.TOTAL_STAGES,
        stage_progress_percent: 100,
        status: 'completed',
        finished_at: now,
        updated_at: now
      }, { returnNew: true });
      logger.info(`[INGESTION-PROGRESS] Marked file ${fileId} as completed`);
      return result.new;
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to mark file ${fileId} as completed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Marks ingestion as failed with an error.
   * Preserves the current_stage (where failure occurred),
   * sets status to "error" and finished_at to now.
   * @param {string} fileId - The file identifier
   * @returns {Object} The updated progress record
   */
  async markError(fileId) {
    if (!fileId) {
      throw new Error('fileId is required');
    }

    const db = await this.getDb();
    const now = new Date().toISOString();

    try {
      const collection = db.collection(this.collectionName);
      const result = await collection.update(fileId, {
        status: 'error',
        finished_at: now,
        updated_at: now
      }, { returnNew: true });
      logger.info(`[INGESTION-PROGRESS] Marked file ${fileId} as error`);
      return result.new;
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS] Failed to mark file ${fileId} as error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new IngestionProgressService();
