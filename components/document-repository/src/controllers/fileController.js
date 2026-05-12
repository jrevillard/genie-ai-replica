const fileService = require('../services/fileService');
const metadataService = require('../services/metadataService');
const config = require('../config/appConfig');
const Joi = require('joi');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared-lib');
const archiver = require('archiver');
const axios = require('axios');

// Constants
const MAX_FILES_UPLOAD = config.upload.maxFilesUpload; // Maximum number of files that can be uploaded at once

/**
 * Sanitize a filename for use in Content-Disposition headers.
 * Strips CRLF characters to prevent header injection and applies
 * RFC 5987 encoding for non-ASCII characters.
 * @param {string} filename
 * @returns {string} Sanitized header value (e.g. `attachment; filename="..."; filename*=UTF-8''...`)
 */
function buildContentDisposition(disposition, filename) {
  // Strip CRLF to prevent header injection
  const sanitized = filename.replace(/[\r\n]/g, '');

  // Check for non-ASCII characters without using control characters in regex
  const hasNonAscii = sanitized.split('').some((char) => char.charCodeAt(0) > 127);
  if (hasNonAscii) {
    const encoded = encodeURIComponent(sanitized).replace(/['()]/g, escape);
    return `${disposition}; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
  }
  return `${disposition}; filename="${sanitized}"`;
}

/**
 * Normalize dataprep / ingest error bodies for HTTP JSON clients.
 * @param {*} raw
 * @returns {{ message: string, details: *|undefined }}
 */
function ingestFailurePayload(raw) {
  if (raw == null) {
    return { message: 'Ingest failed', details: undefined };
  }
  if (typeof raw === 'string') {
    return { message: raw, details: undefined };
  }
  if (typeof raw === 'object') {
    if (typeof raw.detail === 'string') {
      return { message: raw.detail, details: raw };
    }
    if (typeof raw.message === 'string') {
      return { message: raw.message, details: raw };
    }
    try {
      const s = JSON.stringify(raw);
      return { message: s.length > 1800 ? `${s.slice(0, 1800)}…` : s, details: raw };
    } catch {
      return { message: 'Ingest failed', details: raw };
    }
  }
  return { message: String(raw), details: undefined };
}

// Maximum items allowed in batch fileIds operations
const MAX_BATCH_SIZE = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polling while waiting for dataprep to PATCH terminal status (single-flight dataprep lock). */
const INGEST_POLL_INTERVAL_MS = parseInt(process.env.INGEST_POLL_INTERVAL_MS || '2500', 10);
const INGEST_MAX_WAIT_MS = parseInt(process.env.INGEST_MAX_WAIT_MS || String(2 * 60 * 60 * 1000), 10);
const INGEST_BUSY_RETRY_MS = parseInt(process.env.INGEST_BUSY_RETRY_MS || '3000', 10);

/** Normalize dataprep.status for comparisons (Arango stores Title Case: Ingested, Pending, …) */
function dataprepStatusNorm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function isTerminalIngestedStatus(status) {
  const n = dataprepStatusNorm(status);
  return n === 'ingested' || n === 'ingested with warnings';
}

function isIngestionInProgressStatus(status) {
  return dataprepStatusNorm(status) === 'ingesting';
}

function isRetractedStatus(status) {
  return dataprepStatusNorm(status) === 'retracted';
}

function isQueuedStatus(status) {
  return dataprepStatusNorm(status) === 'queued';
}

/** Terminal dataprep states (ingestion finished or document no longer active in index). */
function isDataprepTerminalStatus(status) {
  const n = dataprepStatusNorm(status);
  return (
    n === 'ingested' ||
    n === 'ingested with warnings' ||
    n === 'ingestion error' ||
    n === 'killed' ||
    n === 'retracted'
  );
}

/**
 * Build labels for API responses: upload-time `labels` plus agricultural meta tags from `taxonomyMetadata`.
 * Stored document is unchanged; this is display-only merging for admin / client UIs.
 * @param {object} fileRecord - Raw file document from Arango
 * @returns {string[]}
 */
function buildDisplayLabels(fileRecord) {
  const seen = new Set();
  const ordered = [];

  const pushUnique = (val) => {
    if (val === null || val === undefined) {
      return;
    }
    const s = String(val).trim();
    if (!s.length || seen.has(s)) {
      return;
    }
    seen.add(s);
    ordered.push(s);
  };

  (fileRecord.labels || []).forEach(pushUnique);

  const tax = fileRecord.taxonomyMetadata;
  if (!tax || typeof tax !== 'object') {
    return ordered;
  }

  const sections = [
    ['Agriculture', ['CropName', 'CropCategory', 'Varietal', 'Livestock', 'FarmingSystem', 'Season']],
    ['Content', ['Topic', 'SubTopic', 'DocumentType', 'UseCase']],
    ['Location', ['Country', 'Region', 'District', 'GeoScope']],
    ['Environment', ['Climate', 'Soil', 'AgroEcologicalZone']],
    ['Risk', ['Pest', 'Disease']],
    ['Economics', ['MarketFocus', 'ValueChainStage']],
    ['Governance', ['Programs', 'PolicyMentioned']]
  ];

  for (const [section, keys] of sections) {
    const block = tax[section];
    if (!block || typeof block !== 'object') {
      continue;
    }
    for (const key of keys) {
      const arr = block[key];
      if (Array.isArray(arr)) {
        arr.forEach(pushUnique);
      }
    }
  }

  return ordered.slice(0, 24);
}

// Schema for batch fileIds validation
const batchFileIdsSchema = Joi.object({
  fileIds: Joi.array().items(Joi.string().min(1)).min(1).max(MAX_BATCH_SIZE).required()
});

// Schema for file upload validation
const uploadSchema = Joi.object({
  author: Joi.string().max(200).optional(),
  labels: Joi.array().items(Joi.string()).default([]),
  crawlDate: Joi.date().optional(),
  sourceUrl: Joi.string().uri().optional(),
  language: Joi.string().optional().allow('', null) // Allow language to be passed
});

const searchSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
  limit: Joi.number().integer().min(1).max(50).default(10),
  mimeType: Joi.string().optional()
});

// UPDATED: Added 'killed' to validation per state machine spec
const getFilesSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  language: Joi.string().min(2).max(5).optional(),
  mimeType: Joi.string().optional(),
  search: Joi.string().max(100).optional(),
  dataprepStatus: Joi.string()
    .valid('pending', 'queued', 'ingesting', 'ingested', 'ingested with warnings', 'ingestion error', 'retracted', 'killed')
    .optional()
});

const updateFileSchema = Joi.object({
  file_name: Joi.string()
    .max(255)
    .pattern(/^[^\r\n]*$/)
    .optional(),
  labels: Joi.array().items(Joi.string()).optional(),
  author: Joi.string().max(200).optional(),
  create_date: Joi.date().optional(),
  crawl_date: Joi.date().optional(),
  source_url: Joi.string().uri().optional(),
  language: Joi.string().min(2).max(5).optional()
});

// --- NEW SCHEMAS ADDED ---

// Schema for new log entry
const ingestionLogSchema = Joi.object({
  level: Joi.string().valid('INFO', 'WARN', 'ERROR').required(),
  stage: Joi.string().required(),
  message: Joi.string().required()
});

// Schema for status update from OPEA
// UPDATED: Added 'Killed' to supported statuses
const updateStatusSchema = Joi.object({
  dataprep: Joi.object({
    status: Joi.string()
      .valid('Pending', 'Queued', 'Ingesting', 'Ingested', 'Ingested with Warnings', 'Ingestion Error', 'Retracted', 'Killed')
      .required(),
    ingest_date: Joi.string().isoDate().optional().allow(null, ''),
    retract_date: Joi.string().isoDate().optional().allow(null, '')
  }).required(),
  chunk_count: Joi.number().integer().min(0).optional()
});

const ingestionMetadataSchema = Joi.object({
  taxonomyMetadata: Joi.object().unknown(true).optional(),
  metadataExtractionVersion: Joi.string().max(64).optional().allow(null, ''),
  metadataExtractionTimestamp: Joi.string().isoDate().optional().allow(null, ''),
  metadataConfidenceScore: Joi.number().min(0).max(1).optional().allow(null),
  taxonomyVersion: Joi.string().max(32).optional().allow(null, ''),
  isRelevant: Joi.boolean().optional().allow(null),
  taxonomyExtractionTelemetry: Joi.object().unknown(true).optional()
})
  .min(1)
  .unknown(false);

// Schema for scheduling a site crawl
const scheduleCrawlSchema = Joi.object({
  url: Joi.string().uri().required(),
  depth: Joi.number().integer().min(1).max(20).required(),
  config: Joi.object({
    followExternalLinks: Joi.boolean().optional(),
    maxExternalDepth: Joi.number().integer().min(0).max(5).optional(),
    contentSelector: Joi.string().max(200).optional(),
    excludePatterns: Joi.array().items(Joi.string()).optional()
  }).optional()
});

class FileController {
  constructor() {
    /** Prevents two concurrent batch-ingest workers (would corrupt sequential queue semantics). */
    this._batchIngestWorkerRunning = false;
    this._ingestQueueWorkerRunning = false;
    this._ingestQueue = [];
    this._ingestQueueSet = new Set();

    // Bind methods to preserve 'this' context
    this.downloadFile = this.downloadFile.bind(this);
    this.downloadMultipleFiles = this.downloadMultipleFiles.bind(this);
    this.viewFile = this.viewFile.bind(this);
    this.viewFileInBrowser = this.viewFileInBrowser.bind(this);
    this.uploadFile = this.uploadFile.bind(this);
    this.uploadMultipleFiles = this.uploadMultipleFiles.bind(this);
    this.uploadLink = this.uploadLink.bind(this);
    this.getFiles = this.getFiles.bind(this);
    this.deleteFile = this.deleteFile.bind(this);
    this.searchFiles = this.searchFiles.bind(this);
    this.updateFile = this.updateFile.bind(this);
    this.searchMetadata = this.searchMetadata.bind(this);
    this.getMetadata = this.getMetadata.bind(this);
    this.ingestFile = this.ingestFile.bind(this);
    this.retractFile = this.retractFile.bind(this);
    this.ingestMultipleFiles = this.ingestMultipleFiles.bind(this);
    this.retractMultipleFiles = this.retractMultipleFiles.bind(this);

    // --- NEW BINDS ---
    this.addIngestionLog = this.addIngestionLog.bind(this);
    this.getIngestionLogs = this.getIngestionLogs.bind(this);
    this.updateFileStatus = this.updateFileStatus.bind(this);
    this.updateIngestionMetadata = this.updateIngestionMetadata.bind(this);
    this.reextractTaxonomy = this.reextractTaxonomy.bind(this);
    this.killIngestion = this.killIngestion.bind(this);

    // --- CRAWLER BINDS ---
    this.scheduleSiteCrawl = this.scheduleSiteCrawl.bind(this);
    this.getCrawlJob = this.getCrawlJob.bind(this);
    this.getCrawlMetrics = this.getCrawlMetrics.bind(this);
    this.getCrawlLogs = this.getCrawlLogs.bind(this);
    this.killCrawlTask = this.killCrawlTask.bind(this);

    // Recover queued ingestion items after process/container restart.
    setTimeout(() => {
      this._recoverQueuedIngestAfterRestart().catch((err) => {
        logger.error('[FILE-CONTROLLER] Failed to recover queued ingest jobs after restart:', err);
      });
    }, 3000);
  }

  async _recoverQueuedIngestAfterRestart() {
    if (this._ingestQueueWorkerRunning) {
      return;
    }
    const queued = await metadataService.searchMetadata(
      null,
      null,
      null,
      null,
      null,
      null,
      [],
      null,
      'Queued',
      null
    );
    const fileIds = (queued || []).map((f) => f?.file_id).filter(Boolean);
    if (fileIds.length === 0) {
      return;
    }

    logger.warn(
      `[FILE-CONTROLLER] Recovery: found ${fileIds.length} queued files after restart; resuming sequential ingestion worker.`
    );
    await this._queueFilesForIngest(fileIds, { markQueued: false });
    await this._startIngestQueueWorker();
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

      if (typeof labels === 'string') {
        try {
          labels = JSON.parse(labels);
        } catch {
          labels = labels.split(',').map((label) => label.trim());
        }
      }

      // Ensure we have an array
      if (!Array.isArray(labels)) {
        labels = [labels];
      }

      // Filter out empty labels and ensure all labels are strings
      return labels.map((label) => String(label).trim()).filter((label) => label.length > 0);
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

    // --- UPDATED: Added specific check for language error ---
    if (
      error.message.includes('documents are supported for ingestion') ||
      error.message.includes('conflicting languages')
    ) {
      return {
        status: 400,
        response: {
          success: false,
          error: 'Language not supported or conflict',
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

    if (error.message.includes('INSTREAM size limit exceeded')) {
      return {
        status: 413,
        response: {
          success: false,
          error: 'File scan size limit exceeded',
          message:
            'The antivirus stream scanner rejected this file size. Please retry upload; fallback scanning is enabled. ' +
            'If the issue persists, reduce file size or adjust ClamAV stream limits.'
        }
      };
    }

    if (error.message.includes('Buffer scan failed')) {
      return {
        status: 500,
        response: {
          success: false,
          error: 'File security scan failed',
          message: error.message
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
    const dp = fileRecord.dataprep || {};
    const st = dataprepStatusNorm(dp.status);
    const knowledge_base_ready = st === 'ingested' || st === 'ingested with warnings';
    const out = {
      file_id: fileRecord.file_id,
      file_name: fileRecord.file_name,
      file_size: fileRecord.file_size,
      file_type: fileRecord.file_type,
      storage_path: fileRecord.storage_path,
      file_hash: fileRecord.file_hash,
      labels: buildDisplayLabels(fileRecord),
      author: fileRecord.author,
      upload_date: fileRecord.uploaded_date,
      create_date: fileRecord.create_date,
      crawl_date: fileRecord.crawl_date,
      source_url: fileRecord.source_url,
      language: fileRecord.language,
      chunk_count: fileRecord.chunk_count,
      dataprep: {
        status: dp.status || 'Pending',
        ingest_date: dp.ingest_date || '',
        retract_date: dp.retract_date ?? null
      },
      knowledge_base_ready
    };
    if (Object.prototype.hasOwnProperty.call(fileRecord, 'crawl_job')) {
      out.crawl_job = fileRecord.crawl_job;
    }
    if (fileRecord._key) {
      out._key = fileRecord._key;
    }
    return out;
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
    logger.debug(`[FILE-CONTROLLER] Retrieved file: ${JSON.stringify(file, null, 2)}`);

    if (!file) {
      throw {
        status: 404,
        error: 'File not found',
        message: 'File metadata not found in database'
      };
    }

    const fileExtension = path.extname(file.file_name).slice(1);
    logger.debug(`[FILE-CONTROLLER] File extension: ${fileExtension}`);
    const fileNameOnDisk = file.file_id + '.' + fileExtension;
    const filePath = file.storage_path || path.join(config.upload.uploadDir, fileNameOnDisk);
    const resolvedPath = path.resolve(filePath);
    const allowedDir = path.resolve(config.upload.uploadDir);
    if (!resolvedPath.startsWith(allowedDir + path.sep) && resolvedPath !== allowedDir) {
      throw {
        status: 400,
        error: 'Invalid file path',
        message: 'File path is outside the allowed upload directory'
      };
    }
    logger.debug(`[FILE-CONTROLLER] filePath: ${resolvedPath}`);

    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw {
        status: 404,
        error: 'File not found',
        message: 'The physical file does not exist'
      };
    }
    return { file, filePath: resolvedPath };
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

      if (config.upload.autoIngestOnUpload && fileRecord && fileRecord.file_id) {
        const fid = fileRecord.file_id;
        setImmediate(() => {
          (async () => {
            await this._queueFilesForIngest([fid], { markQueued: true });
            await this._startIngestQueueWorker();
          })().catch(async (err) => {
            logger.error(`[FILE-CONTROLLER] Auto-ingest queue failed for ${fid}: ${err.message}`);
            await this._markIngestionErrorIfStillNonTerminal(fid);
          });
        });
      }

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: this._formatFileRecord(fileRecord),
        autoIngestScheduled: Boolean(
          config.upload.autoIngestOnUpload && fileRecord && fileRecord.file_id
        )
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Upload process error:', error);
      const { status, response } = this._handleUploadError(error);
      res.status(status).json(response);
    }
  };

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
      const uploadPromises = req.files.map((file) => fileService.uploadFile(file, validatedData));
      const fileRecords = await Promise.all(uploadPromises);

      if (config.upload.autoIngestOnUpload) {
        const ids = fileRecords.map((r) => (r && r.file_id ? r.file_id : null)).filter(Boolean);
        if (ids.length > 0) {
          setImmediate(() => {
            (async () => {
              await this._queueFilesForIngest(ids, { markQueued: true });
              await this._startIngestQueueWorker();
            })().catch((err) => {
              logger.error('[FILE-CONTROLLER] Auto-ingest queue worker failed:', err);
            });
          });
        }
      }

      res.status(201).json({
        success: true,
        message: 'Files uploaded successfully',
        data: fileRecords.map((record) => this._formatFileRecord(record)),
        autoIngestScheduled: Boolean(
          config.upload.autoIngestOnUpload &&
            fileRecords.some((r) => r && r.file_id)
        )
      });
    } catch (error) {
      const { status, response } = this._handleUploadError(error);
      res.status(status).json(response);
    }
  };

  uploadLink = async (req, res) => {
    try {
      const { url, fileType = 'md' } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
      }

      // Call fileService to handle crawling and saving
      const fileRecord = await fileService.uploadLink(url, fileType);

      logger.debug(`[FILE-CONTROLLER] fileRecord: ${fileRecord}`);

      res.status(201).json({
        success: true,
        message: 'URL crawled and html file saved successfully',
        data: this._formatFileRecord(fileRecord)
      });
    } catch (error) {
      const { status, response } = this._handleUploadError(error);
      res.status(status).json(response);
    }
  };

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
        data: result.files.map((record) => this._formatFileRecord(record)),
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
   * Download file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async downloadFile(req, res) {
    try {
      const { fileId } = req.params;
      const { file, filePath } = await this._getFileAndPath(fileId);

      // Set appropriate headers, use file_name as the filename
      res.setHeader('Content-Disposition', buildContentDisposition('attachment', file.file_name));
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
      const { error, value } = batchFileIdsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }
      const { fileIds } = value;

      // Set response headers for ZIP
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="files.zip"');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      for (const fileId of fileIds) {
        try {
          const { file, filePath } = await this._getFileAndPath(fileId);
          archive.file(filePath, { name: file.file_name });
        } catch {
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

      // construct response with file information and base64 string
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
      res.setHeader('Content-Disposition', buildContentDisposition('inline', file.file_name));
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
          message: 'File deleted successfully'
        });
      } else {
        return res.status(404).json({
          success: false,
          error: 'File not found'
        });
      }
    } catch (error) {
      logger.error('Delete file error:', error);

      if (error.message.includes('not found')) {
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
   * Delete multiple files
   */
  async deleteMultipleFiles(req, res) {
    try {
      const { error, value } = batchFileIdsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }
      const { fileIds } = value;

      const results = [];
      for (const fileId of fileIds) {
        try {
          // Avoid request timeout on large batches: do slow dataprep cleanup in background.
          const deleted = await fileService.deleteFile(fileId, { cleanupMode: 'background' });
          results.push({ fileId, success: !!deleted });
        } catch (error) {
          results.push({ fileId, success: false, error: error.message });
        }
      }

      res.json({
        success: true,
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

      logger.debug(`[FILE-CONTROLLER] Update File Request: ${JSON.stringify(req.body, null, 2)}`);

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
      const updatedFile = await db
        .query(
          `
        FOR file IN files
        FILTER file.file_id == @fileId
        UPDATE file WITH @updates IN files
        RETURN NEW
      `,
          {
            fileId,
            updates: value
          }
        )
        .then((cursor) => cursor.next());

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

      if (error.message.includes('not found')) {
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
        data: results.map((record) => this._formatFileRecord(record)),
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
        uploaded_date_from,
        uploaded_date_to,
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
        'uploaded_date_from',
        'uploaded_date_to',
        'create_date_from',
        'create_date_to',
        'labels',
        'author',
        'status',
        'language'
      ];

      const invalidFields = Object.keys(req.query).filter((key) => !allowedFields.includes(key));
      if (invalidFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          message: `Invalid query parameters: ${invalidFields.join(', ')}`
        });
      }

      // Parse labels if present (comma-separated string to array)
      const labelsArray = labels ? (Array.isArray(labels) ? labels : labels.split(',').map((l) => l.trim())) : [];

      const results = await metadataService.searchMetadata(
        file_name,
        file_type,
        uploaded_date_from,
        uploaded_date_to,
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
        error: error.message || 'Search failed'
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

      const formatted = this._formatFileRecord(metadata);
      res.json({
        success: true,
        message: 'Metadata retrieved successfully',
        data: {
          ...metadata,
          ...formatted
        }
      });
    } catch (error) {
      logger.error('Get metadata by ID error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve metadata'
      });
    }
  }

  // --- Helper for ingesting a single file ---

  /**
   * POST ingest to dataprep. Returns { success, busy } instead of throwing on HTTP 429 (single-flight lock).
   */
  async _postDataprepIngest(file, base64String) {
    const dataprepUrl = `${config.buildDataprepBaseUrl()}${config.dataprep.ingestPath}`;
    logger.debug(`[FILE-CONTROLLER] Sending file to dataprep service at ${dataprepUrl}`);
    try {
      const response = await axios.post(dataprepUrl, {
        fileId: file.file_id,
        fileName: file.file_name,
        fileType: file.file_type,
        fileLabels: file.labels,
        uploadDate: file.uploaded_date,
        storagePath: file.storage_path,
        fileBase64: base64String
      });
      if (response.data.success) {
        return { success: true, chunkCount: response.data.chunk_count, data: response.data };
      }
      return { success: false, error: response.data };
    } catch (error) {
      if (error.response && error.response.status === 429) {
        return { success: false, busy: true };
      }
      throw error;
    }
  }

  async _waitUntilDataprepTerminal(fileId) {
    const deadline = Date.now() + INGEST_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const meta = await metadataService.getMetadataById(fileId);
      const st = meta?.dataprep?.status;
      if (isDataprepTerminalStatus(st)) {
        return;
      }
      await sleep(INGEST_POLL_INTERVAL_MS);
    }
    logger.warn(
      `[FILE-CONTROLLER] Ingest wait timeout for ${fileId} after ${INGEST_MAX_WAIT_MS}ms (status may remain Ingesting if dataprep cannot PATCH doc-repo)`
    );
  }

  /**
   * One file in a batch: retry on dataprep 429 until accepted, then wait until terminal dataprep status.
   */
  async _ingestOneFileWithRetryAndWait(fileId) {
    const meta = await metadataService.getMetadataById(fileId);
    if (!meta) {
      throw new Error('File not found');
    }
    if (isTerminalIngestedStatus(meta.dataprep?.status)) {
      return;
    }
    if (isRetractedStatus(meta.dataprep?.status)) {
      return;
    }
    if (isIngestionInProgressStatus(meta.dataprep?.status)) {
      await this._waitUntilDataprepTerminal(fileId);
      return;
    }

    let accepted = false;
    while (!accepted) {
      const latestMeta = await metadataService.getMetadataById(fileId);
      if (!latestMeta) {
        throw new Error('File not found');
      }
      if (isTerminalIngestedStatus(latestMeta.dataprep?.status) || isRetractedStatus(latestMeta.dataprep?.status)) {
        return;
      }
      if (isIngestionInProgressStatus(latestMeta.dataprep?.status)) {
        await this._waitUntilDataprepTerminal(fileId);
        return;
      }

      const { file, base64String } = await this._getFileBase64(fileId);
      const post = await this._postDataprepIngest(file, base64String);
      if (post.busy) {
        await sleep(INGEST_BUSY_RETRY_MS);
        continue;
      }
      if (!post.success) {
        const errMsg =
          typeof post.error === 'object' && post.error !== null
            ? JSON.stringify(post.error)
            : String(post.error || 'Dataprep ingest failed');
        throw new Error(errMsg);
      }
      await metadataService.updateMetadata(fileId, {
        chunk_count: post.chunkCount ?? file.chunk_count ?? 0,
        dataprep: {
          status: 'Ingesting',
          ingest_date: new Date().toISOString(),
          retract_date: file.dataprep?.retract_date || null
        }
      });
      await this._waitUntilDataprepTerminal(fileId);
      accepted = true;
    }
  }

  async _markIngestionErrorIfStillNonTerminal(fileId) {
    try {
      const m = await metadataService.getMetadataById(fileId);
      if (!m || isTerminalIngestedStatus(m.dataprep?.status)) {
        return;
      }
      await metadataService.updateMetadata(fileId, {
        dataprep: {
          ...m.dataprep,
          status: 'Ingestion Error'
        }
      });
    } catch (e) {
      logger.warn(`[FILE-CONTROLLER] Could not mark ingestion error for ${fileId}:`, e.message);
    }
  }

  async _runSequentialBatchIngest(fileIds) {
    for (const fileId of fileIds) {
      try {
        await this._ingestOneFileWithRetryAndWait(fileId);
      } catch (error) {
        logger.error(`[FILE-CONTROLLER] Batch ingest failed for ${fileId}:`, error);
        await this._markIngestionErrorIfStillNonTerminal(fileId);
      }
    }
  }

  async _queueFilesForIngest(fileIds, { markQueued = true } = {}) {
    for (const fileId of fileIds) {
      try {
        const meta = await metadataService.getMetadataById(fileId);
        if (!meta) {
          continue;
        }
        if (isTerminalIngestedStatus(meta.dataprep?.status) || isRetractedStatus(meta.dataprep?.status)) {
          continue;
        }
        if (isIngestionInProgressStatus(meta.dataprep?.status)) {
          continue;
        }
        if (markQueued) {
          await metadataService.updateMetadata(fileId, {
            dataprep: {
              ...(meta.dataprep || {}),
              status: 'Queued',
              ingest_date: meta.dataprep?.ingest_date || '',
              retract_date: meta.dataprep?.retract_date ?? null
            }
          });
        }
        if (!this._ingestQueueSet.has(fileId)) {
          this._ingestQueue.push(fileId);
          this._ingestQueueSet.add(fileId);
        }
      } catch (e) {
        logger.warn(`[FILE-CONTROLLER] Could not queue file ${fileId} for ingestion:`, e.message);
      }
    }
  }

  async _startIngestQueueWorker() {
    if (this._ingestQueueWorkerRunning) {
      return;
    }
    this._ingestQueueWorkerRunning = true;
    this._batchIngestWorkerRunning = true;
    logger.info(`[FILE-CONTROLLER] Ingest queue worker started with ${this._ingestQueue.length} item(s).`);
    try {
      while (this._ingestQueue.length > 0) {
        const fileId = this._ingestQueue.shift();
        this._ingestQueueSet.delete(fileId);
        logger.debug(`[FILE-CONTROLLER] Ingest queue worker processing ${fileId}.`);
        try {
          await this._ingestOneFileWithRetryAndWait(fileId);
        } catch (error) {
          logger.error(`[FILE-CONTROLLER] Queue ingest failed for ${fileId}:`, error);
          await this._markIngestionErrorIfStillNonTerminal(fileId);
        }
      }
    } finally {
      this._ingestQueueWorkerRunning = false;
      this._batchIngestWorkerRunning = false;
      logger.info('[FILE-CONTROLLER] Ingest queue worker finished.');
    }
  }

  async _ingestFileById(fileId) {
    const { file, base64String } = await this._getFileBase64(fileId);
    if (file.dataprep) {
      if (isTerminalIngestedStatus(file.dataprep.status)) {
        return { success: false, httpStatus: 409, error: 'File has already been ingested' };
      }
      if (isQueuedStatus(file.dataprep.status)) {
        return {
          success: false,
          httpStatus: 409,
          error:
            'This file is already in the ingestion queue. Wait for the batch to finish, then refresh the list if needed.'
        };
      }
      if (isIngestionInProgressStatus(file.dataprep.status)) {
        return {
          success: false,
          httpStatus: 409,
          error: 'Ingestion is already in progress for this file'
        };
      }
    }
    const post = await this._postDataprepIngest(file, base64String);
    if (post.busy) {
      const err = new Error('Dataprep busy');
      err.response = { status: 429 };
      throw err;
    }
    if (!post.success) {
      return { success: false, httpStatus: 502, error: post.error };
    }
    await metadataService.updateMetadata(fileId, {
      chunk_count: post.chunkCount ?? file.chunk_count ?? 0,
      dataprep: {
        status: 'Ingesting',
        ingest_date: new Date().toISOString(),
        retract_date: file.dataprep?.retract_date || null
      }
    });
    return { success: true };
  }

  // --- Single file ingest ---
  async ingestFile(req, res) {
    try {
      const { fileId } = req.params;
      const result = await this._ingestFileById(fileId);
      if (result.success) {
        return res.json({ success: true, message: 'File ingested successfully' });
      }
      const httpStatus =
        typeof result.httpStatus === 'number' && result.httpStatus >= 400 && result.httpStatus < 600
          ? result.httpStatus
          : 500;
      const payload = ingestFailurePayload(result.error);
      return res.status(httpStatus).json({
        success: false,
        error: payload.message,
        details: payload.details
      });
    } catch (error) {
      logger.error('Ingest file error:', error);

      if (error.response && error.response.status >= 400 && error.response.status !== 429) {
        const upstream = ingestFailurePayload(error.response.data);
        return res.status(502).json({
          success: false,
          error: upstream.message || `Dataprep error (${error.response.status})`,
          details: upstream.details
        });
      }

      if (error.isAxiosError && error.request && !error.response) {
        return res.status(503).json({
          success: false,
          error: 'Cannot reach dataprep service. Check DATAPREP_HOST, DATAPREP_PORT, networking, and that dataprep is running.',
          message: error.message
        });
      }

      // --- FIXED: Check for 429 Busy status from Dataprep ---
      if (error.response && error.response.status === 429) {
        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message:
            'Only a single dataprep job can be run at any given time. Wait until the current job finishes before submitting new jobs'
        });
      }

      if (typeof error.status === 'number') {
        return res.status(error.status).json({
          success: false,
          error: error.error || 'Request failed',
          message: error.message || error.error
        });
      }

      res.status(500).json({ success: false, error: error.message });
    }
  }

  // --- Multiple file ingest ---
  async ingestMultipleFiles(req, res) {
    try {
      const { error, value } = batchFileIdsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ success: false, error: 'Validation error', message: error.details[0].message });
      }
      const { fileIds } = value;

      if (this._ingestQueueWorkerRunning) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'A batch ingestion is already running. Wait for it to finish before starting another.'
        });
      }
      await this._queueFilesForIngest(fileIds, { markQueued: true });

      res.status(202).json({
        success: true,
        message: 'Batch ingestion queued. Files are processed one at a time.',
        count: fileIds.length
      });

      setImmediate(() => {
        (async () => {
          await this._startIngestQueueWorker();
        })().catch((err) => {
          logger.error('[FILE-CONTROLLER] Batch ingest queue worker failed:', err);
        });
      });
    } catch (error) {
      logger.error('Ingest multiple files error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // --- Helper for retracting a single file ---
  async _retractFileById(fileId) {
    const file = await metadataService.getMetadataById(fileId);
    if (!file) return { success: false, error: 'File not found' };
    if (!file.dataprep || isRetractedStatus(file.dataprep.status)) {
      return { success: false, error: 'File has already been retracted' };
    }
    const dataprepUrl = `${config.buildDataprepBaseUrl()}${config.dataprep.retractPath}`;
    const response = await axios.post(dataprepUrl, { fileId: file.file_id });
    if (response.data.success) {
      await metadataService.updateMetadata(fileId, {
        chunk_count: 0, // Reset chunk count on retract
        dataprep: {
          status: 'Retracted',
          ingest_date: file.dataprep.ingest_date || null,
          retract_date: new Date().toISOString()
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
      const { error, value } = batchFileIdsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ success: false, error: 'Validation error', message: error.details[0].message });
      }
      const { fileIds } = value;
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

  // --- NEW METHODS ---

  /**
   * Add an ingestion log entry
   */
  async addIngestionLog(req, res) {
    try {
      const { fileId } = req.params;
      const { error, value } = ingestionLogSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      const logEntry = await fileService.addIngestionLog(fileId, value);
      res.status(201).json({
        success: true,
        message: 'Log entry created',
        data: logEntry
      });
    } catch (error) {
      logger.error('Add ingestion log error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add log entry',
        message: error.message
      });
    }
  }

  /**
   * Get all ingestion logs for a file
   */
  async getIngestionLogs(req, res) {
    try {
      const { fileId } = req.params;
      const logs = await fileService.getIngestionLogs(fileId);
      res.json({
        success: true,
        message: 'Logs retrieved successfully',
        data: logs,
        resultCount: logs.length
      });
    } catch (error) {
      logger.error('Get ingestion logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve logs',
        message: error.message
      });
    }
  }

  /**
   * Update file status (called by OPEA service)
   */
  async updateFileStatus(req, res) {
    try {
      const { fileId } = req.params;
      const { error, value } = updateStatusSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      // Use metadataService.updateMetadata to safely update allowed fields
      const updatedFile = await metadataService.updateMetadata(fileId, value);

      res.json({
        success: true,
        message: 'File status updated successfully',
        data: updatedFile
      });
    } catch (error) {
      logger.error('Update file status error:', error);
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      res.status(500).json({
        success: false,
        error: 'Failed to update file status',
        message: error.message
      });
    }
  }

  /**
   * Update taxonomy / extraction metadata (called by dataprep service account)
   */
  async updateIngestionMetadata(req, res) {
    try {
      const { fileId } = req.params;
      const { error, value } = ingestionMetadataSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }
      const updated = await metadataService.updateIngestionMetadataFields(fileId, value);
      return res.json({ success: true, data: updated });
    } catch (error) {
      logger.error('updateIngestionMetadata error:', error);
      if (error.message && error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Admin: re-run agricultural taxonomy extraction via dataprep (does not update graph chunks).
   */
  async reextractTaxonomy(req, res) {
    try {
      const { fileId } = req.params;
      const { file, base64String } = await this._getFileBase64(fileId);
      const dataprepUrl = `${config.buildDataprepBaseUrl()}${config.dataprep.reextractTaxonomyPath}`;
      const response = await axios.post(dataprepUrl, {
        fileId: file.file_id,
        fileName: file.file_name,
        fileType: file.file_type,
        fileLabels: file.labels,
        uploadDate: file.uploaded_date,
        storagePath: file.storage_path,
        fileBase64: base64String
      });
      return res.json({ success: true, data: response.data });
    } catch (error) {
      logger.error('reextractTaxonomy error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Kill ingestion for a specific file
   */
  async killIngestion(req, res) {
    try {
      const { fileId } = req.params;
      // Triggers the signal in genieai_dataprep_microservice.py
      const dataprepUrl = `${config.buildDataprepBaseUrl()}/v1/dataprep/kill_ingest`;

      const response = await axios.post(dataprepUrl, { fileId });
      res.json(response.data);
    } catch (error) {
      logger.error('Kill ingestion error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // --- NEW CRAWLER METHODS ---

  /**
   * Schedule a new site crawl
   */
  async scheduleSiteCrawl(req, res) {
    try {
      const { error, value } = scheduleCrawlSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.details[0].message
        });
      }

      const { url, depth, config } = value;

      // Delegate to service (passing config)
      const fileRecord = await fileService.scheduleSiteCrawl(url, depth, config);

      res.status(202).json({
        success: true,
        message: 'Site crawl scheduled successfully',
        data: this._formatFileRecord(fileRecord)
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Schedule crawl error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to schedule crawl',
        message: error.message
      });
    }
  }

  /**
   * Get the status of a crawl job
   */
  async getCrawlJob(req, res) {
    try {
      const { fileId } = req.params;
      if (!fileId) {
        return res.status(400).json({ success: false, error: 'File ID required' });
      }

      const job = await fileService.getCrawlJobByFileId(fileId);

      if (!job) {
        return res.status(404).json({ success: false, error: 'Crawl job not found' });
      }

      res.json({
        success: true,
        message: 'Crawl job retrieved',
        data: job
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Get crawl job error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get live crawl metrics
   */
  async getCrawlMetrics(req, res) {
    try {
      const { fileId } = req.params;
      if (!fileId) {
        return res.status(400).json({ success: false, error: 'File ID required' });
      }

      // Call service
      const metrics = await fileService.getCrawlMetrics(fileId);

      if (!metrics) {
        // Return defaults if no metrics found yet
        return res.json({ success: true, data: { crawlRate: 0, processed: 0 } });
      }

      res.json({
        success: true,
        message: 'Crawl metrics retrieved',
        data: metrics
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Get crawl metrics error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get crawl logs
   */
  async getCrawlLogs(req, res) {
    try {
      const { fileId } = req.params;
      if (!fileId) {
        return res.status(400).json({ success: false, error: 'File ID required' });
      }

      const logs = await fileService.getCrawlLogs(fileId);

      res.json({
        success: true,
        message: 'Crawl logs retrieved',
        data: logs,
        count: logs.length
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Get crawl logs error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Send a kill signal to a crawl job
   */
  async killCrawlTask(req, res) {
    try {
      const { fileId } = req.params;
      if (!fileId) {
        return res.status(400).json({ success: false, error: 'File ID required' });
      }

      await fileService.killCrawlTask(fileId);

      res.json({
        success: true,
        message: 'Kill signal sent to crawl task'
      });
    } catch (error) {
      logger.error('[FILE-CONTROLLER] Kill crawl error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new FileController();
