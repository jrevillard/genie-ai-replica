const fileService = require('../services/fileService');
const metadataService = require('../services/metadataService');
const config = require('../config/appConfig');
const Joi = require('joi');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../shared-lib/logger');
const { log, error } = require('console');
const archiver = require('archiver');
const axios = require('axios');

// Constants
const MAX_FILES_UPLOAD = config.upload.maxFilesUpload; // Maximum number of files that can be uploaded at once

// Validation schemas
const uploadSchema = Joi.object({
  author: Joi.string().max(200).optional(),
  labels: Joi.array().items(Joi.string()).default([]), // Joi.array().items(Joi.string().max(50)).max(10).default([])
  crawlDate: Joi.date().optional(),
  sourceUrl: Joi.string().uri().optional()
}); // Schema for file upload validation
// This schema validates the request body for file uploads, ensuring required fields are present and correctly formatted
// It includes optional fields for author, labels, crawl date, and source URL.
// Labels are processed to ensure they are an array of strings, with a maximum of 10 labels allowed.
// The schema also allows for a default label of 'general' if no labels are provided.
// The author field is optional and can be a string up to 200 characters.
// The crawl date is optional and must be a valid date if provided.
// The source URL is optional and must be a valid URI if provided.

const searchSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
  limit: Joi.number().integer().min(1).max(50).default(10),
  category: Joi.string().valid('general', 'data', 'reports', 'documents').optional(),
  mimeType: Joi.string().optional()
});

const getFilesSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  language: Joi.string().min(2).max(5).optional(), // Joi.string().valid('en', 'fr', 'de', 'es', 'it', 'zh', 'ja', 'ko').optional(),
  mimeType: Joi.string().optional(),
  search: Joi.string().max(100).optional(),
  dataprepStatus: Joi.string().valid('pending', 'ingested', 'retracted').optional(),
});

const updateFileSchema = Joi.object({
  file_name: Joi.string().max(255).optional(),
  labels: Joi.array().items(Joi.string()).optional(), // Joi.array().items(Joi.string().max(50)).max(10).optional()
  author: Joi.string().max(200).optional(),
  create_date: Joi.date().optional(),
  crawl_date: Joi.date().optional(),
  source_url: Joi.string().uri().optional(),
  language: Joi.string().min(2).max(5).optional() // Joi.string().valid('en', 'fr', 'de', 'es', 'it', 'zh', 'ja', 'ko').optional(),
});

class FileController {
  constructor() {
    // Bind methods to preserve 'this' context
    this.downloadFile = this.downloadFile.bind(this);
    this.downloadMultipleFiles = this.downloadMultipleFiles.bind(this);
    this.viewFile = this.viewFile.bind(this);
    this.viewFileInBrowser = this.viewFileInBrowser.bind(this);
    this.uploadFile = this.uploadFile.bind(this);
    this.uploadMultipleFiles = this.uploadMultipleFiles.bind(this);
    this.getFiles = this.getFiles.bind(this);
    // this.getFileById = this.getFileById.bind(this);
    this.deleteFile = this.deleteFile.bind(this);
    this.processFile = this.processFile.bind(this);
    this.searchFiles = this.searchFiles.bind(this);
    this.updateFile = this.updateFile.bind(this);
    this.searchMetadata = this.searchMetadata.bind(this);
    this.getMetadata = this.getMetadata.bind(this);
    // this.updateMetadataController = this.updateMetadataController.bind(this);
    this.ingestFile = this.ingestFile.bind(this);
    this.retractFile = this.retractFile.bind(this);
    this.ingestMultipleFiles = this.ingestMultipleFiles.bind(this);
    this.retractMultipleFiles = this.retractMultipleFiles.bind(this);
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
          message: `File failed security scan. ${error.message}`
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
      storage_path: fileRecord.storage_path,
      file_hash: fileRecord.file_hash,
      labels: fileRecord.labels,
      author: fileRecord.author,
      upload_date: fileRecord.uploade_date,
      create_date: fileRecord.create_date,
      crawl_date: fileRecord.crawl_date,
      source_url: fileRecord.source_url,
      language: fileRecord.language,
      chunk_count: fileRecord.chunk_count,
      dataprep : {
        status: fileRecord.dataprep.status,
        ingest_date: fileRecord.dataprep.ingest_date,
        retract_date: fileRecord.dataprep.retract_date,
      }
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
    const file = await metadataService.getMetadataById(fileId);
    logger.debug(`🧪 [FILE-CONTROLLER] Retrieved file: ${JSON.stringify(file, null, 2)}`);
    const fileExtension = path.extname(file.file_name).slice(1);
    logger.debug(`🧪 [FILE-CONTROLLER] File extension: ${fileExtension}`);
    const fileNameOnDisk = file.file_id + '.' + fileExtension;
    const filePath = file.storage_path || path.join(config.upload.uploadDir, fileNameOnDisk);
    logger.debug(`🧪 [FILE-CONTROLLER] filePath: ${filePath}`);

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



  uploadLink = async (req, res) => {
  try {
    const { url, fileType = 'html' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Call fileService to handle crawling and saving
    const fileRecord = await fileService.uploadLink(url, fileType);
    logger.debug(`[FILE-CONTROLLER] fileRecord: ${fileRecord}`);
    res.status(201).json({
      success: true,
      message: 'URL crawled and html file saved successfully',
      data: this._formatFileRecord(fileRecord)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

  // /**
  //  * Get file by ID
  //  * @param {Object} req - Express request object
  //  * @param {Object} res - Express response object
  //  */
  // async getFileById(req, res) {
  //   try {
  //     const { id } = req.params;

  //     if (!id) {
  //       return res.status(400).json({
  //         success: false,
  //         error: 'Missing file ID',
  //         message: 'File ID is required'
  //       });
  //     }

  //     const file = await fileService.getFileById(id);

  //     res.json({
  //       success: true,
  //       message: 'File retrieved successfully',
  //       data: file
  //     });
  //   } catch (error) {
  //     logger.error('Get file by ID error:', error);
      
  //     if (error.message === 'File not found') {
  //       return res.status(404).json({
  //         success: false,
  //         error: 'File not found',
  //         message: 'The requested file does not exist'
  //       });
  //     }

  //     res.status(500).json({
  //       success: false,
  //       error: 'Failed to retrieve file',
  //       message: 'An error occurred while retrieving the file'
  //     });
  //   }
  // }

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

  async downloadMultipleFiles(req, res) {
    try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No file IDs provided',
        message: 'Please provide an array of file IDs to download'
      });
    }

    // Set response headers for ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="files.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const fileId of fileIds) {
      try {
        const { file, filePath } = await this._getFileAndPath(fileId);
        archive.file(filePath, { name: file.file_name });
      } catch (error) {
        // Optionally, add a text file with error info for missing files
        archive.append(`Error: Could not find file with ID ${fileId}\n`, { name: `ERROR_${fileId}.txt` });
      }
    }

    archive.finalize();
    } catch (error) {
      logger.error('Download multiple files error:', error);
      res.status(500).json({
        success: false,
        error: 'Batch download failed',
        message: 'An error occurred while downloading multiple files'
      });
    }
  }


  async _getFileBase64(fileId) {
    const { file, filePath } = await this._getFileAndPath(fileId);
    const fileBuffer = await fs.readFile(filePath);
    const base64String = fileBuffer.toString('base64');
    return { file, base64String };
  }


  /**
   * Get file as base64
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async viewFile(req, res) {
    try {
      const { fileId } = req.params;
      const { file, base64String } = await this._getFileBase64(fileId);

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

  async viewFileInBrowser(req, res) {
    try {
      const { fileId } = req.params;
      const { file, filePath } = await this._getFileAndPath(fileId);

      // Set appropriate headers for viewing in browser
      res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);
      res.setHeader('Content-Type', file.file_type);

      // Send file
      res.sendFile(path.resolve(filePath));
    } catch (error) {
      logger.error('View file in browser error:', error);
      
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
      const { fileId } = req.params;

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      const deleted = await fileService.deleteFile(fileId);
      if (deleted) {
        res.json({
          success: true,
          message: 'File deleted successfully',
          // TODO: [LOW] return deleted file information
          // data: this._formatFileRecord(deletedFile)
          // Currently page count or word count is also part of metadata for certain file types. 
          // We need to fix the metadata schema so that the deleted metadata can be checked and returned here.
        });
      } else {
        return res.status(404).json({
          success: false,
          error: error.message || 'An error occurred',
        });
      }
    } catch (error) {
      logger.error('Delete file error:', error);
    
      if (error.message === 'File not found') {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      };

      res.status(500).json({
        success: false,
        error: 'Delete failed',
        message: 'An error occurred while deleting the file'
      })
    }
  }

  /**
   * Delete multiple files
   */
  async deleteMultipleFiles(req, res) {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No file IDs provided',
          message: 'Please provide an array of file IDs to delete'
        });
      }

      const results = [];
      for (const fileId of fileIds) {
        try {
          const deleted = await fileService.deleteFile(fileId);
          results.push({ fileId, success: !!deleted });
        } catch (error) {
          results.push({ fileId, success: false, error: error.message });
        }
      }

      res.json({
        message: 'Batch delete completed',
        results
      });
    } catch (error) {
      logger.error('Delete multiple files error:', error);
      res.status(500).json({
        success: false,
        error: 'Batch delete failed',
        message: 'An error occurred while deleting multiple files'
      });
    }
  }

  /**
   * Update file metadata
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateFile(req, res) {
    try {
      const { fileId } = req.params;

      logger.debug(`[FILE-CONTROLLER] Update File Request: ${JSON.stringify(req.body, null, 2)}`); // Log the request body for debugging

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      // Validate request body
      const { error, value } = updateFileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }
      logger.debug(`[FILE-CONTROLLER] Update request data: ${JSON.stringify(value, null, 2)}`);

      // Process labels if provided
      if (value.labels) {
        value.labels = this._processLabels({ labels: value.labels });
      }

      // Get current file record
      const currentFile = await metadataService.getMetadataById(fileId);
      if (!currentFile) {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      }

      // Update file record in database
      const db = await fileService.getDb();
      const updatedFile = await db.query(`
        FOR file IN files
        FILTER file.file_id == @fileId
        UPDATE file WITH @updates IN files
        RETURN NEW
      `, { 
        fileId,
        updates: value
      }).then(cursor => cursor.next());

      if (!updatedFile) {
        throw new Error('Failed to update file record');
      }

      res.json({
        success: true,
        message: 'File updated successfully',
        data: this._formatFileRecord(updatedFile)
      });
    } catch (error) {
      logger.error('Update file error:', error);
      
      if (error.message === 'File not found') {
        return res.status(404).json({
          success: false,
          error: 'File not found',
          message: 'The requested file does not exist'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Update failed',
        message: 'An error occurred while updating the file'
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

  /**
   * Search file by metadata
   */
  async searchMetadata(req, res) {
    try {
      const {
          file_name,
          file_type,
          upload_date_from,
          upload_date_to,
          create_date_from,
          create_date_to,
          labels,
          author,
          status,
          language
        } = req.query;
      
      const allowedFields = [
        'file_name',
        'file_type',
        'upload_date_from',
        'upload_date_to',
        'create_date_from',
        'create_date_to',
        'labels',
        'author',
        'status',
        'language'
      ];

      const invalidFields = Object.keys(req.query).filter(
        key => !allowedFields.includes(key)
      );
      if (invalidFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          message: `Invalid query parameters: ${invalidFields.join(', ')}`
        });
      }

      // Parse labels if present (comma-separated string to array)
      const labelsArray = labels
        ? Array.isArray(labels)
          ? labels
          : labels.split(',').map(l => l.trim())
        : [];

      const results = await metadataService.searchMetadata(
        file_name,
        file_type,
        upload_date_from,
        upload_date_to,
        create_date_from,
        create_date_to,
        labelsArray,
        author,
        status,
        language
      );

      res.json({
        success: true,
        message: 'Metadata search completed successfully',
        data: results,
        query: req.query,
        resultCount: results.length
      });
    } catch (error) {
      logger.error('Search metadata error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Search failed',
      });
    }
  }

  /**
   * Get file metadata by file_id
   */
  async getMetadata(req, res) {
    try {
      const { fileId } = req.params;

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: 'Missing file ID',
          message: 'File ID is required'
        });
      }

      const metadata = await metadataService.getMetadataById(fileId);
      if (!metadata) {
        return res.status(404).json({
          success: false,
          error: 'Metadata not found',
          message: 'No metadata found for the specified file ID'
        });
      }

      res.json({
        success: true,
        message: 'Metadata retrieved successfully',
        data: metadata
      });
    } catch (error) {
      logger.error('Get metadata by ID error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve metadata',
      });
    }
  }

  //   /**
//    * Update file metadata
//    */
//   async updateMetadataController(req, res) {
//     try {
//       const { fileId } = req.params;

//       if (!fileId) {
//         return res.status(400).json({
//           success: false,
//           error: 'Missing file ID',
//           message: 'File ID is required'
//         });
//       }

//       const updatedMetadata = await metadataService.updateMetadata(fileId, req.body);

//       res.json({
//         success: true,
//         message: 'Metadata updated successfully',
//         data: updatedMetadata
//       });
//     } catch (error) {
//       logger.error('Update metadata error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message || 'Failed to update metadata',
//       });
//     }
//   }


  // --- Helper for ingesting a single file ---

  async _ingestFileById(fileId) {
    const { file, base64String } = await this._getFileBase64(fileId);
    if (file.dataprep && file.dataprep.status === 'ingested') {
      return { success: false, error: 'File has already been ingested' };
    }
    const dataprepUrl = `${config.dataprep.host}:${config.dataprep.port}${config.dataprep.ingestPath}`;
    logger.debug(`🤠 [FILE-CONTROLLER] Sending file to dataprep service at ${dataprepUrl}`);
    const response = await axios.post(dataprepUrl, {
      fileId: file.file_id,
      fileName: file.file_name,
      fileType: file.file_type,
      fileLabels:file.labels, // 🏷️🏷️🏷️🏷️🏷️🏷️
      uploadDate: file.upload_date,
      storagePath: file.storage_path, // 🗂️🗂️🗂️🗂️🗂️🗂️
      fileBase64: base64String,
    });
    if (response.data.success) {
      await metadataService.updateMetadata(fileId, {
        dataprep: {
          status: 'ingested',
          ingest_date: new Date().toISOString(),
          retract_date: file.dataprep.retract_date || null,
        }
      });
      return { success: true };
    } else {
      return { success: false, error: response.data };
    }
  }

  // --- Single file ingest ---
  async ingestFile(req, res) {
    try {
      const { fileId } = req.params;
      const result = await this._ingestFileById(fileId);
      if (result.success) {
        return res.json({ success: true, message: 'File ingested successfully' });
      } else {
        return res.status(500).json({ success: false, error: 'Data prep failed.', details: result.error });
      }
    } catch (error) {
      logger.error('Ingest file error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // --- Multiple file ingest ---
  async ingestMultipleFiles(req, res) {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ success: false, error: 'No file IDs provided' });
      }
      const results = [];
      for (const fileId of fileIds) {
        try {
          const result = await this._ingestFileById(fileId);
          results.push({ fileId, ...result });
        } catch (error) {
          results.push({ fileId, success: false, error: error.message });
        }
      }
      res.json({ success: true, results });
    } catch (error) {
      logger.error('Ingest multiple files error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // /**
  //  * Ingest file into dataprep service
  //  * @param {Object} req - Express request object
  //  * @param {Object} res - Express response object
  //  */
  // async ingestFile(req, res) {
  // try {
  //   const { fileId } = req.params;
  //   const { file, base64String } = await this._getFileBase64(fileId);

  //   // Send file info to dataprep microservice
  //   const dataprepUrl = `${config.dataprep.host}:${config.dataprep.port}${config.dataprep.ingestPath}`;
  //   logger.debug(`🤠 [FILE-CONTROLLER] Sending file to dataprep service at ${dataprepUrl}`);
  //   const response = await axios.post(dataprepUrl, {
  //     fileId: file.file_id,
  //     fileName: file.file_name,
  //     fileType: file.file_type,
  //     uploadDate: file.upload_date,
  //     fileBase64: base64String, // any other necessary file metadata can be added here? fileName, fileType, etc.
  //   });

  //   if (response.data.success) {
  //     // Update metadata
  //     await metadataService.updateMetadata(fileId, {
  //       dataprep: {
  //         status: 'ingested',
  //         ingest_date: new Date().toISOString(),
  //         retract_date: file.dataprep.retract_date || null // Preserve existing retract date if any
  //       }
  //     });
  //     return res.json({ success: true, message: 'File ingested successfully' });
  //   } else {
  //     logger.error('Dataprep ingest failed:', response.data);
  //     return res.status(500).json({ success: false, error: 'Data prep failed.', details: response.data });
  //   }
  // } catch (error) {
  //   logger.error('Ingest file error:', error);
  //   if (error.response) {
  //   logger.error('Response data:', error.response.data);
  //   logger.error('Response status:', error.response.status);
  //   }
  //   res.status(500).json({ success: false, error: error.message });
  // }
  // }
  

  // --- Helper for retracting a single file ---
  async _retractFileById(fileId) {
    const file = await metadataService.getMetadataById(fileId);
    if (!file) return { success: false, error: 'File not found' };
    if (!file.dataprep || file.dataprep.status === 'retracted') {
      return { success: false, error: 'File has already been retracted' };
    }
    const dataprepUrl = `${config.dataprep.host}:${config.dataprep.port}${config.dataprep.retractPath}`;
    const response = await axios.post(dataprepUrl, { fileId: file.file_id });
    if (response.data.success) {
      await metadataService.updateMetadata(fileId, {
        dataprep: {
          status: 'retracted',
          ingest_date: file.dataprep.ingest_date || null,
          retract_date: new Date().toISOString(),
        }
      });
      return { success: true };
    } else {
      return { success: false, error: response.data };
    }
  }


  // --- Single file retract ---
  async retractFile(req, res) {
    try {
      const { fileId } = req.params;
      const result = await this._retractFileById(fileId);
      if (result.success) {
        return res.json({ success: true, message: 'File retracted successfully' });
      } else if (result.error === 'File not found') {
        return res.status(404).json({ success: false, error: 'File not found' });
      } else {
        return res.status(500).json({ success: false, error: 'Dataprep retract failed', details: result.error });
      }
    } catch (error) {
      logger.error('Retract file error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }


  // --- Multiple file retract ---
  async retractMultipleFiles(req, res) {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ success: false, error: 'No file IDs provided' });
      }
      const results = [];
      for (const fileId of fileIds) {
        try {
          const result = await this._retractFileById(fileId);
          results.push({ fileId, ...result });
        } catch (error) {
          results.push({ fileId, success: false, error: error.message });
        }
      }
      res.json({ success: true, results });
    } catch (error) {
      logger.error('Retract multiple files error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }


  // /**
  //  * Retract file from dataprep service
  //  * @param {Object} req - Express request object
  //  * @param {Object} res - Express response object
  //  */
  // async retractFile(req, res) {
  // try {
  //   const { fileId } = req.params;
  //   const file = await metadataService.getMetadataById(fileId);
  //   if (!file) return res.status(404).json({ success: false, error: 'File not found' });

  //   // Send retract request to dataprep microservice
  //   const dataprepUrl = `${config.dataprep.host}:${config.dataprep.port}${config.dataprep.retractPath}`; // Replace with actual URL/port
  //   const response = await axios.post(dataprepUrl, { fileId: file.file_id });

  //   if (response.data.success) {
  //     // Update metadata
  //     await metadataService.updateMetadata(fileId, {
  //       dataprep: {
  //         status: 'retracted',
  //         ingest_date: file.dataprep.ingest_date || null, // Preserve existing ingest date if any
  //         retract_date: new Date().toISOString()
  //       }
  //     });
  //     return res.json({ success: true, message: 'File retracted successfully' });
  //   } else {
  //     return res.status(500).json({ success: false, error: 'Dataprep retract failed', details: response.data });
  //   }
  // } catch (error) {
  //   logger.error('Retract file error:', error);
  //   res.status(500).json({ success: false, error: error.message });
  // }
  // }
}


module.exports = new FileController();