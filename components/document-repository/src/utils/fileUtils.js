// NOTE: this shared functionality is not called by any other file at the moment
// TODO: [NORMAL] Move common funtion related to file to this utils folder
// - some file operation implementation in fileService.js should be moved here

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// const { getFileCategory } = require('./mimeTypes');

/**
 * Generate unique filename
 */
const generateUniqueFilename = (originalFilename) => {
  const extension = path.extname(originalFilename);
  const baseName = path.basename(originalFilename, extension);
  const timestamp = Date.now();
  const uuid = uuidv4().split('-')[0];
  
  return `${baseName}_${timestamp}_${uuid}${extension}`;
};

/**
 * Ensure directory exists
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
  }
};

/**
 * Save file to disk
 */
const saveFileToDisk = async (buffer, filename, uploadDir) => {
  try {
    await ensureDirectoryExists(uploadDir);
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);
    return filePath;
  } catch (error) {
    throw new Error(`Failed to save file: ${error.message}`);
  }
};

/**
 * Delete file from disk
 */
const deleteFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
    return false;
  }
};

/**
 * Get file size
 */
const getFileSize = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (error) {
    throw new Error(`Failed to get file size: ${error.message}`);
  }
};

/**
 * Get file metadata
 */
const getFileMetadata = async (filePath, originalFilename, mimeType) => {
  try {
    const stats = await fs.stat(filePath);
    
    return {
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      originalName: originalFilename,
      mimeType: mimeType
      // category: getFileCategory(mimeType)
    };
  } catch (error) {
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
};

/**
 * Get metadata file path for a given file
 * It appends "_meta.json" to the original filename.
 */
function getMetadataFilePath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `${base}_meta.json`);
};

/**
 * Count lines in a text file
 */
const getTxtLineCount = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return null; // Return null if file reading fails
  }
};

/**
 * Count words in a text file
 */
const getTxtWordCount = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }
  catch {
    return null; // Return null if file reading fails
  }
};

const getPdfPageCount = async (filePath) => {
  try {
    const pdf = require('pdf-parse');
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer);
    return data.numpages || null;
  } catch (error) {
    console.error(`Failed to extract PDF page count: ${error.message}`);
    return null; // Return null if extraction fails
  }
};

const getDocxWordCount = async (filePath) => {
  try {
    const docx = require('docx-parser');
    const content = await docx.parseDocx(filePath);
    return content.split(/\s+/).filter(word => word.length > 0).length;
  } catch (error) {
    console.error(`Failed to extract DOCX word count: ${error.message}`);
    return null; // Return null if extraction fails
  }
};





module.exports = {
  generateUniqueFilename,
  ensureDirectoryExists,
  saveFileToDisk,
  deleteFile,
  getFileSize, // To be edited
  getFileMetadata, // To be edited
  getMetadataFilePath,
  getTxtLineCount,
  getTxtWordCount,
  getPdfPageCount,
  getDocxWordCount
};