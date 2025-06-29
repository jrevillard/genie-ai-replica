/*
 * @Author: ScarlettSun9 53145308+ScarlettSun9@users.noreply.github.com
 * @Date: 2025-06-16 11:46:56
 * @LastEditors: ScarlettSun9 53145308+ScarlettSun9@users.noreply.github.com
 * @LastEditTime: 2025-06-19 15:22:46
 * @FilePath: /genie-ai/components/document-repository/src/routes/fileRoutes.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const express = require('express');
const fileController = require('../controllers/fileController');
const { uploadSingle, uploadMultiple } = require('../middlewares/fileUpload');
const { authenticate, authorizeRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// apply authentication to all endpoints 
router.use(authenticate);

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
router.post('/upload', authorizeRole(['Admin']), uploadSingle, fileController.uploadFile);

/**
 * @route POST /api/files/uploads
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
router.get('/:metadata', fileController.getMetadata);

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
router.patch('/:fileId', fileController.updateFile);

// Update file metadata by fileId
// This endpoint has similar functionality to the one above (PATCH /:fileId)
// So this one and related functionalities are commented out and can be modified later if needed
// router.patch('/metadata/:fileId', fileController.updateMetadataController);

router.post('/:fileId/ingest', fileController.ingestFile);
router.post('/:fileId/retract', fileController.retractFile);

module.exports = router;