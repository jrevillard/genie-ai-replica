const express = require('express');
const fileController = require('../controllers/fileController');
const { uploadSingle, uploadMultiple } = require('../middlewares/fileUpload');

const router = express.Router();

// NOTE: only file upload endpoint is implemented and tested for now

/**
 * @route POST /api/files/upload
 * @desc Upload a single file
 * @access Public
 * @body {File} file - The file to upload
 * @body {string} [description] - File description
 * @body {string} [category] - File category (general, data, reports, documents)
 * @body {string[]} [tags] - Array of tags
 */
router.post('/upload', uploadSingle, fileController.uploadFile);

/**
 * @route POST /api/files/uploas
 * @desc Upload multiple files
 * @access Public
 * @body {File[]} files - Array of files to upload (max 5)
 * @body {string} [description] - Description for all files
 * @body {string} [category] - Category for all files (general, data, reports, documents)
 * @body {string[]} [tags] - Array of tags for all files
 */
router.post('/uploads', uploadMultiple, fileController.uploadMultipleFiles);

/**
 * @route GET /api/files
 * @desc Get all files with pagination and filtering
 * @access Public
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 10, max: 50)
 * @query {string} category - Filter by category
 * @query {string} mimeType - Filter by MIME type
 * @query {string} search - Search in file names and descriptions
 */
router.get('/', fileController.getFiles);

/**
 * @route GET /api/files/search
 * @desc Search files
 * @access Public
 * @query {string} q - Search query (required, min: 2 chars, max: 100)
 * @query {number} limit - Number of results (default: 10, max: 50)
 * @query {string} category - Filter by category
 * @query {string} mimeType - Filter by MIME type
 */
router.get('/search', fileController.searchFiles);

/**
 * @route GET /api/files/stats
 * @desc Get file statistics
 * @access Public
 */
router.get('/stats', fileController.getFileStats);

/**
 * @route GET /api/files/:id
 * @desc Get file by ID
 * @access Public
 * @param {string} id - File ID
 */
router.get('/:id', fileController.getFileById);

/**
 * @route GET /api/files/:id/view
 * @desc Get file as base64 for viewing
 * @access Public
 * @param {string} id - File ID
 */
router.get('/:id/view', fileController.getFileAsBase64);

/**
 * @route GET /api/files/:id/download
 * @desc Download file by ID
 * @access Public
 * @param {string} id - File ID
 */
router.get('/:id/download', fileController.downloadFile);

/**
 * @route POST /api/files/:id/process
 * @desc Process file with dataprep service
 * @access Public
 * @param {string} id - File ID
 */
router.post('/:id/process', fileController.processFile);

/**
 * @route DELETE /api/files/:id
 * @desc Delete file by ID
 * @access Public
 * @param {string} id - File ID
 */
router.delete('/:id', fileController.deleteFile);

module.exports = router;