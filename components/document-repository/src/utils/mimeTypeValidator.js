// NOTE: this validation is not used anywhere at the moment
// TODO: [NORMAL] validate file type and content in fileService.js by calling this function
// - all functions here are not tested yet
// - the code's file name should be changed to fileTypeValidator.js?? (not only validate mime type but also file content)

const mime = require('mime-types');
const { fromBuffer } = require('file-type');
const config = require('../config/appConfig');

/**
 * Validate file type based on MIME type and extension
 */
const validateFileType = async (file) => {
  try {
    // Check file extension
    const extension = getFileExtension(file.originalname);
    if (!config.upload.allowedExtensions.includes(extension)) {
      return {
        isValid: false,
        error: `File extension ${extension} is not allowed`
      };
    }

    // Check MIME type from multer
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      return {
        isValid: false,
        error: `MIME type ${file.mimetype} is not allowed`
      };
    }

    // Double-check MIME type by reading file buffer
    const detectedType = await fromBuffer(file.buffer);
    if (detectedType && !config.upload.allowedMimeTypes.includes(detectedType.mime)) {
      return {
        isValid: false,
        error: `Detected MIME type ${detectedType.mime} does not match allowed types`
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: `Error validating file type: ${error.message}`
    };
  }
};

/**
 * Get file extension from filename
 */
const getFileExtension = (filename) => {
  return filename.toLowerCase().substring(filename.lastIndexOf('.'));
};

/**
 * Get MIME type from file extension
 */
const getMimeType = (filename) => {
  return mime.lookup(filename) || 'application/octet-stream';
};

/**
 * Get file category based on MIME type
 */
const getFileCategory = (mimeType) => {
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
  if (mimeType.includes('excel') || mimeType.includes('sheet')) return 'spreadsheet';
  if (mimeType.includes('markdown')) return 'markdown';
  if (mimeType.includes('html')) return 'html';
  if (mimeType.includes('text')) return 'text';
  return 'other';
};

/**
 * Check if file type is supported for text extraction
 */
const isTextExtractable = (mimeType) => {
  const extractableMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown',
    'text/html',
    'text/plain'
  ];
  return extractableMimeTypes.includes(mimeType);
};

module.exports = {
  validateFileType,
  getFileExtension,
  getMimeType,
  getFileCategory,
  isTextExtractable
};