// src/utils/fileUtils.js - Shared file utility functions

/**
 * Format file size for display
 * @param {Number} bytes - File size in bytes
 * @returns {String} Formatted file size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  if (bytes < 1) return `${bytes} Bytes`
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const index = Math.min(i, sizes.length - 1)
  return parseFloat((bytes / Math.pow(k, index)).toFixed(2)) + ' ' + sizes[index]
}

/**
 * Check if a MIME type is an image
 * @param {String} mimeType - File MIME type
 * @returns {Boolean} True if the file is an image
 */
export function isImage(mimeType) {
  return mimeType && mimeType.startsWith('image/')
}

/**
 * Check if a MIME type is a document
 * @param {String} mimeType - File MIME type
 * @returns {Boolean} True if the file is a document
 */
export function isDocument(mimeType) {
  const documentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ]
  return documentTypes.includes(mimeType)
}

/**
 * Get file extension from a file name
 * @param {String} fileName - File name
 * @returns {String} File extension (lowercase)
 */
export function getFileExtension(fileName) {
  return fileName.split('.').pop().toLowerCase()
}
