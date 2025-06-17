const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');
const fileUtils = require('../utils/fileUtils');
const metadataService = require('./metadataService');

// NOTE: securityService is not implemented yet
// - securityService is not implemented yet
// - dataprepClient is not implemented yet
// - securityService is not implemented yet

// Import services
// const securityService = require('./securityService');
// const dataprepClient = require('./dataprepClient');

// Import utils
const appConfig = require('../config/appConfig');
const { config } = require('dotenv');

class FileService {
  constructor() {
    this.uploadDir = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
    this.allowedMimeTypes = appConfig.upload.allowedMimeTypes;
    this.allowedExtensions = appConfig.upload.allowedExtensions;
  }

  /**
   * Get database connection for files
   */
  async getDb() {
    return await dbService.getConnection('files');
  }

  /**
   * Upload and process a file
   * @param {Object} fileData - File data from multer
   * @param {Object} fileInfo - Additional information about the file (provided by the user)
   * @returns {Object} File record
   */
  async uploadFile(fileData, fileInfo = {}) {
    
    let filePath;
    try {
      // Generate unique file ID
      const fileId = fileUtils.generateUniqueFileId();
      const originalFileName = fileData.originalname;
      const fileExtension = path.extname(originalFileName).toLowerCase();
      const savedFileName = `${fileId}${fileExtension}`;
      filePath = path.join(this.uploadDir, savedFileName);
      logger.debug(`[FILE-SERVICE] Save file ${originalFileName} into ${savedFileName}`);

      // Validate file type & extension
      const mimeType = mime.lookup(originalFileName) || fileData.mimetype;
      const isMimeAllowed = this.allowedMimeTypes.includes(mimeType);
      const isExtensionAllowed = this.allowedExtensions.includes(fileExtension);
      if (!(isMimeAllowed && isExtensionAllowed)) {
        throw new Error(`File type ${mimeType} or extension ${fileExtension} is not allowed`);
      }

      // Validate file size (default: 50MB)
      const maxFileSize = appConfig.upload.maxFileSize;
      if (fileData.size > maxFileSize) {
        throw new Error(`File size exceeds maximum allowed size of ${maxFileSize} bytes`);
      }

      // Ensure upload directory exists
      logger.debug(`[FILE-SERVICE]  Ensure upload directory exists: ${this.uploadDir}`);
      await fileUtils.ensureDirectoryExists(this.uploadDir);

      // Write file to disk (using buffer from memory storage)
      logger.debug(`[FILE-SERVICE]  Write file to disk: ${filePath}`);
      await fs.writeFile(filePath, fileData.buffer);

      // TODO: [HIGH] Implement virus scan
      // Perform virus scan if enabled
      // if (appConfig.virusScanning) {
      //   const scanResult = await securityService.scanFile(filePath);
      //   if (!scanResult.clean) {
      //     // Delete infected file
      //     await fs.unlink(filePath);
      //     throw new Error(`File contains virus: ${scanResult.virus}`);
      //   }
      // }

      // TODO: Review Fix createdDate
      // - the date is not correct, it's the date when the file was written to the disk in the server
      // - expected: the date when the file was created on the client side
      // - limitation: HTTP file uploads don't preserve filesystem metadata
      // - option 1: current solution, use the date when the file was written to the disk in the server
      // - option 2: frontend should provide the created_date by extracting it from the file metadata

      // Get file stats to determine creation date
      const stats = await fs.stat(filePath);
      const createdDate = stats.birthtime;
      logger.debug(`[FILE-SERVICE] File creation date: ${createdDate}`);
      
      // Create file record in database
      const fileRecord = {
        file_id: fileId,
        file_name: originalFileName,
        file_size: fileData.size,
        file_type: mimeType,
        storage_path : filePath,
        file_hash: await fileUtils.getFileHash(filePath), // Optional: calculate hash if needed
        labels: fileInfo.labels,
        author: fileInfo.author,
        uploaded_date: new Date().toISOString(),
        created_date: createdDate,
        crawl_date: fileInfo.crawlDate || null,
        source_url: fileInfo.sourceUrl || '',
        language: '',
        chunk_count: 0,
        dataprep: {
          status: 'pending',
          ingest_date: '',
          retract_date: ''
        }
      };

      try {
        await metadataService.addMetadata(filePath, fileRecord);
      } catch (error) {
        logger.error(`Failed to add metadata for file ${originalFileName}: ${error.message}`);
        // Cleanup file if metadata addition fails
        await fs.unlink(filePath);
      }

      return fileRecord;
    } catch (error) {
      logger.error(`Error uploading file: ${error}`);
      
      // Cleanup file if it exists
      if (filePath) {
        try {
          await fs.unlink(filePath);
        } catch (cleanupError) {
          logger.error(`Error cleaning up file: ${cleanupError}`);
        }
      }
      
      throw error;
    }
  }

  // /**
  //  * Get file by ID
  //  * @param {string} fileId - File ID
  //  * @returns {Object} File record
  //  */
  // async getFileById(fileId) {
  //   logger.debug(`[FILE-SERVICE] Getting file by ID: ${fileId}`);
  //   try {
  //     const db = await this.getDb();
  //     // const file = await db.collection('files').document(fileId);
  //     const file = await db.query(`
  //       FOR file IN files
  //       FILTER file.file_id == @fileId
  //       RETURN file
  //     `, { fileId }).then(cursor => cursor.next()); 
  //     return file;
  //   } catch (error) {
  //     if (error.code === 404) {
  //       throw new Error('File not found');
  //     }
  //     throw error;
  //   }
  // }

  /**
   * Get all files with pagination
   * @param {Object} options - Query options
   * @returns {Object} Files list with pagination
   */
  async getFiles(options = {}) {
    try {
      const { page = 1, limit = 10, language, mimeType, search, dataprepStatus} = options;
      const offset = (page - 1) * limit;

      // Build query
      let query = 'FOR file IN files';
      const bindVars = {};

      // Add filters
      const filters = [];
      if (language) {
        filters.push('file.language == @language');
        bindVars.category = category;
      }
      if (mimeType) {
        filters.push('file.file_type == @mimeType');
        bindVars.mimeType = mimeType;
      }
      if (search) {
        filters.push('CONTAINS(LOWER(file.file_name), LOWER(@search))');
        bindVars.search = search;
      }
      if (dataprepStatus) {
        const status = dataprepStatus.toLowerCase();
        filters.push('file.dataprep.status == @status');
        bindVars.status = status;
      }

      if (filters.length > 0) {
        query += ` FILTER ${filters.join(' AND ')}`;
      }

      query += ' SORT file.uploadedAt DESC';
      query += ` LIMIT ${offset}, ${limit}`;
      query += ' RETURN file';

      // Execute query
      const db = await this.getDb();
      const cursor = await db.query(query, bindVars);
      const files = await cursor.all();

      // Get total count
      const countQuery = 'RETURN LENGTH(files)';
      const totalCount = await db.query(countQuery).then(cursor => cursor.next());

      return {
        files,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalFiles: totalCount,
          limit
        }
      };
    } catch (error) {
      logger.error(`Error getting files: $ {error}`);
      throw error;
    }
  }

  /**
   * Delete file by ID
   * @param {string} fileId - File ID
   * @returns {boolean} Success status
   */
  async deleteFile(fileId) {
    try {
      // Get file record
      const file = await metadataService.getMetadataById(fileId);
      if (!file) {
        throw new Error(`File record not found in database: ${fileId}`);
      }
      
      // prepare file path for deletion
      const fileExtension = path.extname(file.file_name).slice(1);
      const fileNameOnDisk = file.file_id + '.' + fileExtension;
      const filePath = path.join(this.uploadDir, fileNameOnDisk);

      // Check if file exists on disk
      try {
        await fs.access(filePath);
        logger.info(`🗂️ File found on disk: ${filePath}`);
      } catch (error) {
        logger.warn(`🗂️ File not found on disk: ${filePath}`);
        throw new Error(`File not found on disk: ${filePath}`);
      }
      
      // Delete metadata first and keep a backup
      let deletedMetadata = false;
      let metadataBackup = null;
      try {
        metadataBackup = { ...file }; // Create a backup of the metadata
        deletedMetadata = await metadataService.deleteMetadata(fileId);
        logger.info(`🧪 Metadata deleted for file ${fileId}`);
      } catch (error) {
        logger.error(`Failed to delete metadata for file ${fileId}: ${error.message}`);
        throw new Error(`File deleted but failed to delete metadata for file ${fileId}`);
      }

      // Delete the physical file from disk
      try {
        await fs.unlink(filePath);
        logger.info(`🗑️ File deleted from disk: ${filePath}`);
        return true;
      } catch (error) {
        logger.error(`File deleted from metadata but failed to delete physical file: ${error.message}`);
        // attempt to restore metadata if file deletion fails
        if (deletedMetadata && metadataBackup) {
          try {
            await metadataService.addMetadata(filePath, metadataBackup);
            logger.info(`🔄 Metadata restored for file ${fileId}`);
          } catch (restoreError) {
            logger.error(`Failed to restore metadata for file ${fileId}: ${restoreError.message}`);
          }
        }
      }
      throw new Error('Metadata deleted but failed to delete file on disk: ${filePath}');
    } catch (error) {
      logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }

  /**
   * Process a file (sending file to data prep service)
   * @param {string} fileId - ID of the file to process
   * @returns {Promise<Object>} Processing result
   */
  async processFile(fileId) {
    try {
      const db = await this.getDb();
      const fileRecord = await db.collection('files').firstExample({ id: fileId });
      
      if (!fileRecord) {
        throw new Error(`File not found: ${fileId}`);
      }

      // Check if file exists
      try {
        await fs.access(fileRecord.filePath);
      } catch (error) {
        throw new Error(`File not found on disk: ${fileRecord.filePath}`);
      }

      // TODO: [HIGH] Send file to data prep service
      // - send file to data prep service
      // - wait for data prep service to process the file
 
      // Update file record
      const updates = {
        processed: true,
        processedAt: new Date().toISOString(),
      };

      await db.collection('files').update(fileRecord._key, updates);
      logger.info(`File processed successfully: ${fileId}`);

      return {
        ...fileRecord,
        ...updates
      };
    } catch (error) {
      logger.error(`Error processing file: ${error}`);
      throw error;
    }
  }

  /**
   * Search files
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array} Search results
   */
  async searchFiles(query, options = {}) {
    try {
      const { limit = 10, category, mimeType } = options;

      // Build search query
      let searchQuery = `
        FOR file IN files
        FILTER CONTAINS(LOWER(file.originalName), LOWER(@query)) 
            OR CONTAINS(LOWER(file.description), LOWER(@query))
            OR CONTAINS(LOWER(file.metadata.content), LOWER(@query))
      `;

      const bindVars = { query };

      // Add additional filters
      if (category) {
        searchQuery += ' AND file.category == @category';
        bindVars.category = category;
      }
      if (mimeType) {
        searchQuery += ' AND file.mimeType == @mimeType';
        bindVars.mimeType = mimeType;
      }

      searchQuery += ' SORT BM25(file) DESC';
      searchQuery += ` LIMIT ${limit}`;
      searchQuery += ' RETURN file';

      // Execute search
      const db = await this.getDb();
      const cursor = await db.query(searchQuery, bindVars);
      const results = await cursor.all();

      return results;
    } catch (error) {
      logger.error(`Error searching files: ${error}`);
      throw error;
    }
  }

    /**
   * Get file statistics
   * @returns {Object} File statistics
   */
  async getFileStats() {
    try {
      const db = await this.getDb();
      const stats = await db.query(`
        RETURN {
          totalFiles: LENGTH(files),
          totalSize: SUM(files[*].size),
          filesByType: (
            FOR file IN files
            COLLECT mimeType = file.mimeType WITH COUNT INTO count
            RETURN { mimeType, count }
          ),
          filesByCategory: (
            FOR file IN files
            COLLECT category = file.category WITH COUNT INTO count
            RETURN { category, count }
          )
        }
      `).then(cursor => cursor.next());

      return stats;
    } catch (error) {
      logger.error(`Error getting file stats: ${error}`);
      throw error;
    }
  }
}

module.exports = new FileService();