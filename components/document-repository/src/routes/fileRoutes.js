const express = require('express');
const fileController = require('../controllers/fileController');
const { uploadSingle, uploadMultiple } = require('../middlewares/fileUpload');
const { authenticateToken, authorizeRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// apply authentication to all endpoints 
router.use(authenticateToken);

/**
 * @route POST /api/files/upload
 * @desc Upload a single file
 * @access Public
 * @body {File} file - The file to upload
 * @body {string} [description] - File description
 * @body {string} [category] - File category (general, data, reports, documents)
 * @body {string[]} [tags] - Array of tags
 */
router.post('/upload', authorizeRole(['Admin']), uploadSingle, fileController.uploadFile);
// router.post('/upload', uploadSingle, fileController.uploadFile);

/**
 * @route POST /api/files/uploads
 * @desc Upload multiple files
 * @access Public
 * @body {File[]} files - Array of files to upload (max 5)
 * @body {string} [description] - Description for all files
 * @body {string} [category] - Category for all files (general, data, reports, documents)
 * @body {string[]} [tags] - Array of tags for all files
 */
router.post('/uploads', authorizeRole(['Admin']), uploadMultiple, fileController.uploadMultipleFiles);


/**
 * @route POST /api/files/upload-link
 * @desc Upload a link (webpage), crawl the content and save as a file
 * @access Public
 * @body {string} url - The URL to crawl and save
 */
router.post('/upload-link', authorizeRole(['Admin']), fileController.uploadLink);


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
 * Search files by metadata 
 * @route GET /api/files/search
 * @desc Search files
 * @access Public
 * @query {string} q - Search query (required, min: 2 chars, max: 100)
 * @query {number} limit - Number of results (default: 10, max: 50)
 * @query {string} category - Filter by category
 * @query {string} mimeType - Filter by MIME type
 */
router.get('/search', fileController.searchMetadata);

/**
 * Get file metadata by ID
 * @route GET /api/files/:metadata
 * @desc Get file by ID
 * @access Public
 * @param {string} id - File ID
 */
router.get('/:fileId', fileController.getMetadata);

/**
 * @route GET /api/files/:id/view
 * @desc Get file as base64 for viewing
 * @access Public
 * @param {string} fileId - File ID
 */
router.get('/:fileId/view', fileController.viewFile);

/**
 * @route GET /api/files/:id/viewbrowser
 * @desc View file in browser (if supported)
 * @access Public
 * @param {string} fileId - File ID
 */
router.get('/:fileId/viewbrowser', fileController.viewFileInBrowser);

/**
 * @route GET /api/files/:id/download
 * @desc Download file by ID
 * @access Public
 * @param {string} fileId - File ID
 */
router.get('/:fileId/download', fileController.downloadFile);

/**
 * @route POST /api/files/downloads
 * @desc Download multiple files as a ZIP archive
 * @access Public
 * @body {string[]} fileIds - Array of file IDs to download
 */
router.post('/downloads', fileController.downloadMultipleFiles);

/**
 * @route DELETE /api/files/:id
 * @desc Delete file by ID
 * @access Public
 * @param {string} id - File ID
 */
router.delete('/:fileId', fileController.deleteFile);

/**
 * @route DELETE /api/files
 * @desc Delete multiple files by IDs
 * @access Public
 * @body {string[]} fileIds - Array of file IDs to delete
 */
router.delete('/', fileController.deleteMultipleFiles);

/**
 * Update file metadata
 * @route PATCH /api/files/:fileId
 * @desc Update file metadata
 * @access Public
 * @param {string} fileId - File ID
 * @body {Object} updates - JSON object with the fields to update
 */
router.patch('/:fileId', authorizeRole(['Admin']), fileController.updateFile);

// Update file metadata by fileId
// This endpoint has similar functionality to the one above (PATCH /:fileId)
// So this one and related functionalities are commented out and can be modified later if needed
// router.patch('/metadata/:fileId', fileController.updateMetadataController);

router.post('/:fileId/ingest', authorizeRole(['Admin']), fileController.ingestFile);
router.post('/:fileId/retract', authorizeRole(['Admin']), fileController.retractFile);
router.post('/ingest', authorizeRole(['Admin']), fileController.ingestMultipleFiles);
router.post('/retract', authorizeRole(['Admin']), fileController.retractMultipleFiles);

module.exports = router;