const ingestionProgressService = require('../services/ingestionProgressService');
const metadataService = require('../services/metadataService');
const Joi = require('joi');
const { logger } = require('../../shared-lib');

// Schema for PATCH request body validation
const updateProgressSchema = Joi.object({
  current_stage: Joi.string().valid('Extraction', 'Chunking', 'Guardrail', 'Labeling', 'Graph', 'Completed').optional(),
  stage_progress_percent: Joi.number().integer().min(0).max(100).optional(),
  stages_completed: Joi.number().integer().min(0).max(5).optional(),
  status: Joi.string().valid('in_progress', 'completed', 'error').optional(),
  message: Joi.string().max(500).optional().allow('', null)
}).min(1); // At least one field required

class IngestionProgressController {
  constructor() {
    this.getProgress = this.getProgress.bind(this);
    this.updateProgress = this.updateProgress.bind(this);
  }

  /**
   * GET /api/files/:fileId/ingestion-progress
   * Returns the current ingestion progress record for a file.
   */
  async getProgress(req, res) {
    try {
      const { fileId } = req.params;

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      // Check if the file exists
      const file = await metadataService.getMetadataById(fileId);
      if (!file) {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }

      // Get progress record
      const progress = await ingestionProgressService.getByFileId(fileId);
      if (!progress) {
        return res.status(404).json({
          success: false,
          message: 'No ingestion progress found for file'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          file_id: progress.file_id,
          current_stage: progress.current_stage,
          stage_progress_percent: progress.stage_progress_percent,
          stages_completed: progress.stages_completed,
          total_stages: progress.total_stages,
          status: progress.status,
          started_at: progress.started_at,
          updated_at: progress.updated_at,
          finished_at: progress.finished_at
        }
      });
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS-CTRL] Error in getProgress: ${error.message}`, error);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve ingestion progress',
        message: 'An error occurred while retrieving ingestion progress'
      });
    }
  }

  /**
   * PATCH /api/files/:fileId/ingestion-progress
   * Updates the ingestion progress record for a file.
   * Delegates to the appropriate service method based on body content.
   */
  async updateProgress(req, res) {
    try {
      const { fileId } = req.params;

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      // Validate request body
      const { error, value } = updateProgressSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      const { current_stage, stage_progress_percent, stages_completed, status, message } = value;

      // Determine which service method to call based on body content
      let result;

      if (status === 'completed') {
        // Mark as completed
        result = await ingestionProgressService.markCompleted(fileId);
      } else if (status === 'error') {
        // Mark as error
        result = await ingestionProgressService.markError(fileId);
      } else if (current_stage !== undefined && stages_completed !== undefined) {
        // Stage transition
        result = await ingestionProgressService.updateStageTransition(fileId, current_stage, stages_completed);
      } else if (stage_progress_percent !== undefined) {
        // Sub-step progress update
        result = await ingestionProgressService.updateProgress(fileId, stage_progress_percent, message);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'Request body must include a valid update: status (completed/error), current_stage with stages_completed, or stage_progress_percent'
        });
      }

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`[INGESTION-PROGRESS-CTRL] Error in updateProgress: ${error.message}`, error);

      // Handle document not found errors from ArangoDB
      if (error.errorNum === 1202 || error.code === 404) {
        return res.status(404).json({
          success: false,
          message: 'No ingestion progress found for file'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to update ingestion progress',
        message: 'An error occurred while updating ingestion progress'
      });
    }
  }
}

module.exports = new IngestionProgressController();
