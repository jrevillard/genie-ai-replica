// NOTE: this shared functionality is not called by any other file at the moment
// TODO: [NORMAL] Move common funtion related to file to this utils folder
// - some file operation implementation in fileService.js should be moved here

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto'); // For generating unique IDs and file hashes
const { logger } = require('../../shared-lib');

/**
 * Generate unique filename
 */
const generateUniqueFileId = () => {
  logger.debug('Entering generateUniqueFileId...');
  const timestamp = Date.now();
  const uuid = uuidv4().split('-')[0];
  const fileId = `${timestamp}_${uuid}`;
  
  logger.debug(`Generated unique file ID: ${fileId}`);
  return fileId;
};

/**
 * Ensure directory exists
 */
const ensureDirectoryExists = async (dirPath) => {
  logger.debug(`Entering ensureDirectoryExists for path: ${dirPath}`);
  try {
    await fs.access(dirPath);
    logger.debug(`Directory ${dirPath} already exists.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info(`Directory ${dirPath} does not exist. Creating...`);
      try {
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`Successfully created directory: ${dirPath}`);
      } catch (mkdirError) {
        logger.error(`Failed to create directory ${dirPath}: ${mkdirError.message}`, mkdirError);
        throw mkdirError;
      }
    } else {
      logger.error(`Error checking directory ${dirPath}: ${error.message}`, error);
      throw error;
    }
  }
};

/**
 * Save file to disk
 */
const saveFileToDisk = async (buffer, filename, uploadDir) => {
  logger.debug(`Entering saveFileToDisk for filename: ${filename} in dir: ${uploadDir}`);
  try {
    await ensureDirectoryExists(uploadDir);
    const filePath = path.join(uploadDir, filename);
    
    logger.debug(`Writing file to ${filePath}`);
    await fs.writeFile(filePath, buffer);
    
    logger.info(`Successfully saved file to ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error(`Failed to save file ${filename} to ${uploadDir}: ${error.message}`, error);
    throw new Error(`Failed to save file: ${error.message}`);
  }
};

/**
 * Delete file from disk
 */
const deleteFile = async (filePath) => {
  logger.debug(`Entering deleteFile for path: ${filePath}`);
  try {
    await fs.unlink(filePath);
    logger.info(`Successfully deleted file: ${filePath}`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Failed to delete file ${filePath}: ${error.message}`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
    logger.warn(`File not found during delete (ENOENT): ${filePath}. Returning false.`);
    return false;
  }
};

/**
 * Get file size
 */
const getFileSize = async (filePath) => {
  logger.debug(`Entering getFileSize for path: ${filePath}`);
  try {
    const stats = await fs.stat(filePath);
    logger.debug(`File size for ${filePath}: ${stats.size}`);
    return stats.size;
  } catch (error) {
    logger.error(`Failed to get file size for ${filePath}: ${error.message}`, error);
    throw new Error(`Failed to get file size: ${error.message}`);
  }
};

/**
 * Get file metadata
 */
const getFileMetadata = async (filePath, originalFilename, mimeType) => {
  logger.debug(`Entering getFileMetadata for path: ${filePath}`);
  try {
    const stats = await fs.stat(filePath);
    
    const metadata = {
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      originalName: originalFilename,
      mimeType: mimeType
      // category: getFileCategory(mimeType)
    };
    logger.debug(`Successfully retrieved metadata for ${filePath}`, metadata);
    return metadata;
  } catch (error) {
    logger.error(`Failed to get file metadata for ${filePath}: ${error.message}`, error);
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
};

/**
 * Get metadata file path for a given file
 * It appends "_meta.json" to the original filename.
 */
function getMetadataFilePath(filePath) {
  logger.debug(`Entering getMetadataFilePath for: ${filePath}`);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const metaPath = path.join(dir, `${base}_meta.json`);
  logger.debug(`Metadata file path resolved to: ${metaPath}`);
  return metaPath;
};

// Utility function to compute SHA-256 hash of a file
const getFileHash = async (filePath) => {
  logger.debug(`Entering getFileHash for: ${filePath}`);
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    
    stream.on('end', () => {
      const fileHash = hash.digest('hex');
      logger.info(`Successfully generated SHA-256 hash for ${filePath}`);
      resolve(fileHash);
    });
    
    stream.on('error', (error) => {
      logger.error(`Error streaming file for hash ${filePath}: ${error.message}`, error);
      reject(error);
    });
  });
}

module.exports = {
  generateUniqueFileId,
  ensureDirectoryExists,
  saveFileToDisk,
  deleteFile,
  getFileSize,
  getFileMetadata,
  getMetadataFilePath,
  getFileHash
};