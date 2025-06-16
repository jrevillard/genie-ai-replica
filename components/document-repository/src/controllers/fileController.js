const fileService = require('../services/fileService');
const config = require('../config/appConfig');
const Joi = require('joi');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../shared-lib/logger');

// Constants
const MAX_FILES_UPLOAD = config.upload.maxFilesUpload; // Maximum number of files that can be uploaded at once

// Validation schemas
const uploadSchema = Joi.object({
  author: Joi.string().max(200).optional(),
  labels: Joi.array().items(Joi.string().max(50)).max(10).default(['general']),
  crawlDate: Joi.date().optional(),
  sourceUrl: Joi.string().uri().optional()
});

const searchSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
  limit: Joi.number().integer().min(1).max(50).default(10),
  category: Joi.string().valid('general', 'data', 'reports', 'documents').optional(),
  mimeType: Joi.string().optional()
});

const getFilesSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  category: Joi.string().valid('general', 'data', 'reports', 'documents').optional(),
  mimeType: Joi.string().optional(),
  search: Joi.string().max(100).optional()
});

class FileController {
  constructor() {
    // Bind methods to preserve 'this' context
    this.downloadFile = this.downloadFile.bind(this);
    this.viewFile = this.viewFile.bind(this);
    this.uploadFile = this.uploadFile.bind(this);
    this.uploadMultipleFiles = this.uploadMultipleFiles.bind(this);
    this.getFiles = this.getFiles.bind(this);
    this.getFileById = this.getFileById.bind(this);
    this.deleteFile = this.deleteFile.bind(this);
    this.processFile = this.processFile.bind(this);
    this.searchFiles = this.searchFiles.bind(this);
  }

  /**
   * Process and validate labels from request body
   * @private
   * @param {Object} body - Request body
   * @returns {Array} Processed labels array
   */
  _processLabels(body) {
    if (!body.labels) return [];
    
    try {
      let labels = body.labels;
      
      // Handle string input
      if (typeof labels === 'string') {
        try {
          // Try to parse as JSON first
          labels = JSON.parse(labels);
        } catch (e) {
          // If JSON parsing fails, treat as comma-separated string
          labels = labels.split(',').map(label => label.trim());
        }
      }
      
      // Ensure we have an array
      if (!Array.isArray(labels)) {
        labels = [labels];
      }
      
      // Filter out empty labels and ensure all labels are strings
      return labels
        .map(label => String(label).trim())
        .filter(label => label.length > 0);
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Error processing labels:', error);
      return [];
    }
  }

  /**
   * Validate request body against upload schema
   * @private
   * @param {Object} body - Request body
   * @returns {Object} Validation result
   */
  _validateUploadRequest(body) {
    const { error, value } = uploadSchema.validate(body);
    if (error) {
      throw {
        status: 400,
        error: 'Validation error',
        message: error.details[0].message
      };
    }
    return value;
  }

  /**
   * Handle upload errors
   * @private
   * @param {Error} error - Error object
   * @returns {Object} Error response
   */
  _handleUploadError(error) {
    logger.error('Upload error:', error);
    
    if (error.status) {
      return {
        status: error.status,
        response: {
          success: false,
          error: error.error,
          message: error.message
        }
      };
    }
    
    if (error.message.includes('File type') && error.message.includes('not allowed')) {
      return {
        status: 400,
        response: {
          success: false,
          error: 'Invalid file type',
          message: error.message
        }
      };
    }
    
    if (error.message.includes('File size exceeds')) {
      return {
        status: 400,
        response: {
          success: false,
          error: 'File too large',
          message: error.message
        }
      };
    }
    
    if (error.message.includes('virus')) {
      return {
        status: 400,
        response: {
          success: false,
          error: 'Security threat detected',
          message: 'File failed security scan'
        }
      };
    }

    return {
      status: 500,
      response: {
        success: false,
        error: 'Upload failed',
        message: 'An error occurred while uploading the file(s)'
      }
    };
  }

  /**
   * Format file record for response
   * @private
   * @param {Object} fileRecord - File record from service
   * @returns {Object} Formatted file record
   */
  _formatFileRecord(fileRecord) {
    return {
      file_id: fileRecord.file_id,
      file_name: fileRecord.file_name,
      file_size: fileRecord.file_size,
      file_type: fileRecord.file_type,
      labels: fileRecord.labels,
      author: fileRecord.author,
      uploaded_date: fileRecord.uploaded_date,
      created_date: fileRecord.created_date,
      crawl_date: fileRecord.crawl_date,
      source_url: fileRecord.source_url,
      language: fileRecord.language,
      chunk_count: fileRecord.chunk_count,
      dataprep_status: fileRecord.dataprep.status,
      dataprep_ingested_date: fileRecord.dataprep.ingested_date,
      dataprep_retracted_date: fileRecord.dataprep.retracted_date,
    };
  }

  /**
   * Get file record and physical file path
   * @private
   * @param {string} fileId - File ID
   * @returns {Object} Object containing file record and file path
   * @throws {Error} If file not found or invalid fileId
   */
  async _getFileAndPath(fileId) {
    if (!fileId) {
      throw {
        status: 400,
        error: 'Missing file ID',
        message: 'File ID is required'
      };
    }

    // retrieve file from database and search actual file on disk
    const file = await fileService.getFileById(fileId);
    const fileExtension = path.extname(file.file_name).slice(1);
    const fileNameOnDisk = file.file_id + '.' + fileExtension;
    const filePath = path.join(__dirname, '..', '..', 'uploads', fileNameOnDisk);
    logger.debug(`[FILE-CONTROLLER] filePath: ${filePath}`);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw {
        status: 404,
        error: 'File not found',
        message: 'The physical file does not exist'
      };
    }

    return { file, filePath };
  }

  /**
   * Upload a file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  uploadFile = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
          message: 'Please select a file to upload'
        });
      }

      req.body.labels = this._processLabels(req.body);
      const validatedData = this._validateUploadRequest(req.body);
      const fileRecord = await fileService.uploadFile(req.file, validatedData);

      logger.debug(`[FILE-CONTROLLER] fileRecord: ${fileRecord}`);

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: this._formatFileRecord(fileRecord)
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Upload process error:', error);
      const { status, response } = this._handleUploadError(error);
      res.status(status).json(response);
    }
  }

  /**
   * Upload multiple files
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  uploadMultipleFiles = async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded',
          message: 'Please select at least one file to upload'
        });
      }

      if (req.files.length > MAX_FILES_UPLOAD) {
        return res.status(400).json({
          success: false,
          error: 'Too many files',
          message: `Maximum ${MAX_FILES_UPLOAD} files can be uploaded at once`
        });
      }

      req.body.labels = this._processLabels(req.body);
      const validatedData = this._validateUploadRequest(req.body);
      const uploadPromises = req.files.map(file => fileService.uploadFile(file, validatedData));
      const fileRecords = await Promise.all(uploadPromises);

      res.status(201).json({
        success: true,
        message: 'Files uploaded successfully',
        data: fileRecords.map(record => this._formatFileRecord(record))
      });
    } catch (error) {
      const { status, response } = this._handleUploadError(error);
      res.status(status).json(response);
    }
  }

  /**
   * Get all files with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFiles(req, res) {
    try {
      // Validate query parameters
      const { error, value } = getFilesSchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      const result = await fileService.getFiles(value);

      res.json({
        success: true,
        message: 'Files retrieved successfully',
        data: result.files,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get files error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve files',
        message: 'An error occurred while retrieving files'
      });
    }
  }

  /**
   * Get file by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getFileById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      const file = await fileService.getFileById(id);

      res.json({
        success: true,
        message: 'File retrieved successfully',
        data: file
      });
    } catch (error) {
      logger.error('Get file by ID error:', error);
      
      if (error.message === 'File not found') {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve file',
        message: 'An error occurred while retrieving the file'
      });
    }
  }

  /**
   * Download file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async downloadFile(req, res) {
    try {
      const { fileId } = req.params;
      const { file, filePath } = await this._getFileAndPath(fileId);

      // Set appropriate headers, use file_name as the filename
      res.setHeader('Content-Disposition', `attachment; filename="${file.file_name}"`);
      res.setHeader('Content-Type', file.file_type);

      // Send file
      res.sendFile(path.resolve(filePath));
    } catch (error) {
      logger.error('Download file error:', error);
      
      if (error.status) {
        return res.status(error.status).json({
          success: false,
          error: error.error,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Download failed',
        message: 'An error occurred while downloading the file'
      });
    }
  }

  /**
   * Get file as base64
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async viewFile(req, res) {
    try {
      const { fileId } = req.params;
      const { file, filePath } = await this._getFileAndPath(fileId);

      // Read file and convert to base64
      const fileBuffer = await fs.readFile(filePath);
      const base64String = fileBuffer.toString('base64');

      // construct response with file file information and base64 string
      res.json({
        success: true,
        message: 'File retrieved successfully',
        data: {
          id: file.file_id,
          file_name: file.file_name,
          file_size: file.file_size,
          file_type: file.file_type,
          base64: base64String
        }
      });
    } catch (error) {
      logger.error('Get file as base64 error:', error);
      
      if (error.status) {
        return res.status(error.status).json({
          success: false,
          error: error.error,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve file',
        message: 'An error occurred while retrieving the file'
      });
    }
  }

  /**
   * Delete file by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteFile(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      await fileService.deleteFile(id);

      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      logger.error('Delete file error:', error);
      
      if (error.message === 'File not found') {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Delete failed',
        message: 'An error occurred while deleting the file'
      });
    }
  }

  /**
   * Process file with dataprep service
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async processFile(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      // NOTE: file processing is not implemented yet
      // TODO: [HIGH] Implement file processing
      // const result = await fileService.processFile(id);

      res.json({
        success: true,
        message: 'File processed successfully',
        data: {
          id: id,
          status: 'processed',
          processedAt: new Date().toISOString(),
          processingResult: 'not implemented yet' // response from data prep service
        }
      });
    } catch (error) {
      logger.error('Process file error:', error);
      
      if (error.message === 'File not found') {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      }
      
      if (error.message === 'File has already been processed') {
        return res.status(400).json({
          success: false,
          error: 'File already processed',
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Processing failed',
        message: 'An error occurred while processing the file'
      });
    }
  }

  /**
   * Search files
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchFiles(req, res) {
    try {
      // Validate query parameters
      const { error, value } = searchSchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      const { q, ...options } = value;
      const results = await fileService.searchFiles(q, options);

      res.json({
        success: true,
        message: 'Search completed successfully',
        data: results,
        query: q,
        resultCount: results.length
      });
    } catch (error) {
      logger.error('Search files error:', error);
      res.status(500).json({
        success: false,
        error: 'Search failed',
        message: 'An error occurred while searching files'
      });
    }
  }

  // /**
  //  * Get file statistics
  //  * @param {Object} req - Express request object
  //  * @param {Object} res - Express response object
  //  */
  // async getFileStats(req, res) {
  //   try {
  //     const stats = await fileService.getFileStats();

  //     res.json({
  //       success: true,
  //       message: 'Statistics retrieved successfully',
  //       data: stats
  //     });
  //   } catch (error) {
  //     logger.error('Get file stats error:', error);
  //     res.status(500).json({
  //       success: false,
  //       error: 'Failed to retrieve statistics',
  //       message: 'An error occurred while retrieving file statistics'
  //     });
  //   }
  // }

  
}

module.exports = new FileController();