const express = require('express');
const fileController = require('../controllers/fileController');
const { uploadSingle, uploadMultiple, validateFiles } = require('../middlewares/fileUpload');
const { authenticateToken, authorizeRole } = require('../middlewares/keycloak-auth-middleware');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Upload a single file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file to upload
 *               description:
 *                 type: string
 *                 description: File description
 *               category:
 *                 type: string
 *                 enum: [general, data, reports, documents]
 *                 description: File category
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of tags
 *     responses:
 *       '200':
 *         description: File uploaded successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/upload', authorizeRole(['Admin']), uploadSingle, validateFiles, fileController.uploadFile);

/**
 * @swagger
 * /api/files/uploads:
 *   post:
 *     summary: Upload multiple files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Array of files to upload (max 5)
 *               description:
 *                 type: string
 *                 description: Description for all files
 *               category:
 *                 type: string
 *                 enum: [general, data, reports, documents]
 *                 description: Category for all files
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of tags for all files
 *     responses:
 *       '200':
 *         description: Files uploaded successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/uploads', authorizeRole(['Admin']), uploadMultiple, validateFiles, fileController.uploadMultipleFiles);

/**
 * @swagger
 * /api/files/upload-link:
 *   post:
 *     summary: Upload a link (webpage), crawl the content and save as a file (Synchronous/Single Page)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 description: The URL to crawl and save
 *     responses:
 *       '200':
 *         description: Link uploaded and processed successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/upload-link', authorizeRole(['Admin']), fileController.uploadLink);

/**
 * @swagger
 * /api/files/crawl/schedule:
 *   post:
 *     summary: Schedule a new asynchronous site crawl (Full Site)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - depth
 *             properties:
 *               url:
 *                 type: string
 *                 description: The target URL to crawl
 *               depth:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 20
 *                 description: The crawl depth (1-20)
 *               config:
 *                 type: object
 *                 properties:
 *                   followExternalLinks:
 *                     type: boolean
 *                   maxExternalDepth:
 *                     type: integer
 *                   contentSelector:
 *                     type: string
 *                   excludePatterns:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       '202':
 *         description: Crawl scheduled successfully
 *       '400':
 *         description: Invalid input
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/crawl/schedule', authorizeRole(['Admin']), fileController.scheduleSiteCrawl);

/**
 * @swagger
 * /api/files:
 *   get:
 *     summary: Get all files with pagination and filtering
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: mimeType
 *         schema:
 *           type: string
 *         description: Filter by MIME type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in file names and descriptions
 *     responses:
 *       '200':
 *         description: List of files
 *       '401':
 *         description: Unauthorized
 */
router.get('/', fileController.getFiles);

/**
 * @swagger
 * /api/files/search:
 *   get:
 *     summary: Search files by metadata
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 100
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Number of results
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: mimeType
 *         schema:
 *           type: string
 *         description: Filter by MIME type
 *     responses:
 *       '200':
 *         description: Search results
 *       '401':
 *         description: Unauthorized
 */
router.get('/search', fileController.searchMetadata);

/**
 * @swagger
 * /api/files/search/files:
 *   get:
 *     summary: Search files by text query
 *     description: Full-text search across file names, source URLs, and authors
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 100
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Maximum number of results
 *       - in: query
 *         name: mimeType
 *         schema:
 *           type: string
 *         description: Filter by MIME type
 *     responses:
 *       '200':
 *         description: Search results
 *       '401':
 *         description: Unauthorized
 */
router.get('/search/files', fileController.searchFiles);

/**
 * @swagger
 * /api/files/{fileId}:
 *   get:
 *     summary: Get file metadata by ID
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File metadata
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: File not found
 */
router.get('/:fileId', fileController.getMetadata);

/**
 * @swagger
 * /api/files/{fileId}/crawl-job:
 *   get:
 *     summary: Get the crawl job status for a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: Crawl job details
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: Job not found
 */
router.get('/:fileId/crawl-job', authorizeRole(['Admin']), fileController.getCrawlJob);

/**
 * @swagger
 * /api/files/{fileId}/crawl-metrics:
 *   get:
 *     summary: Get the live crawl metrics for a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: Crawl metrics
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.get('/:fileId/crawl-metrics', authorizeRole(['Admin']), fileController.getCrawlMetrics);

/**
 * @swagger
 * /api/files/{fileId}/crawl-log:
 *   get:
 *     summary: Get all crawl log entries for a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: List of crawl log entries
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.get('/:fileId/crawl-log', authorizeRole(['Admin']), fileController.getCrawlLogs);

/**
 * @swagger
 * /api/files/{fileId}/kill-crawl:
 *   post:
 *     summary: Triggers the kill signal for a crawl task
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: Kill signal sent successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: Job not found
 */
router.post('/:fileId/kill-crawl', authorizeRole(['Admin']), fileController.killCrawlTask);

/**
 * @swagger
 * /api/files/{fileId}/kill-ingest:
 *   post:
 *     summary: Triggers the kill signal for a ingestion task
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: Kill signal sent successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: Job not found
 */
router.post('/:fileId/kill-ingest', authorizeRole(['Admin']), fileController.killIngestion);

/**
 * @swagger
 * /api/files/{fileId}/view:
 *   get:
 *     summary: Get file as base64 for viewing
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File content in base64
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: File not found
 */
router.get('/:fileId/view', fileController.viewFile);

/**
 * @swagger
 * /api/files/{fileId}/viewbrowser:
 *   get:
 *     summary: View file in browser (if supported)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File content for browser viewing
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: File not found
 */
router.get('/:fileId/viewbrowser', fileController.viewFileInBrowser);

/**
 * @swagger
 * /api/files/{fileId}/download:
 *   get:
 *     summary: Download file by ID
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File downloaded successfully
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: File not found
 */
router.get('/:fileId/download', fileController.downloadFile);

/**
 * @swagger
 * /api/files/downloads:
 *   post:
 *     summary: Download multiple files as a ZIP archive
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileIds
 *             properties:
 *               fileIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of file IDs to download
 *     responses:
 *       '200':
 *         description: ZIP archive downloaded successfully
 *       '401':
 *         description: Unauthorized
 */
router.post('/downloads', fileController.downloadMultipleFiles);

/**
 * @swagger
 * /api/files/{fileId}:
 *   delete:
 *     summary: Delete file by ID
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File deleted successfully
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: File not found
 */
router.delete('/:fileId', authorizeRole(['Admin']), fileController.deleteFile);

/**
 * @swagger
 * /api/files:
 *   delete:
 *     summary: Delete multiple files by IDs
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileIds
 *             properties:
 *               fileIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of file IDs to delete
 *     responses:
 *       '200':
 *         description: Files deleted successfully
 *       '401':
 *         description: Unauthorized
 */
router.delete('/', authorizeRole(['Admin']), fileController.deleteMultipleFiles);

/**
 * @swagger
 * /api/files/{fileId}:
 *   patch:
 *     summary: Update file metadata
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               updates:
 *                 type: object
 *                 description: JSON object with the fields to update
 *     responses:
 *       '200':
 *         description: File metadata updated successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: File not found
 */
router.patch('/:fileId', authorizeRole(['Admin']), fileController.updateFile);

/**
 * @swagger
 * /api/files/{fileId}/ingest:
 *   post:
 *     summary: Ingest a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File ingested successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: File not found
 */
// okf-service allowed (Story 2.9.6/2.9.4): the OKF orchestrator's worker owns
// draining per-concept Pending files — it authenticates as the okf-server
// service client (okf-service role), same as the enqueue route below.
router.post('/:fileId/ingest', authorizeRole(['Admin', 'okf-service']), fileController.ingestFile);

/**
 * @swagger
 * /api/files/{fileId}/retract:
 *   post:
 *     summary: Retract a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: File retracted successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 *       '404':
 *         description: File not found
 */
// okf-service allowed: the 2.9.4 orphan sweeper retracts chunks via the service
// client; retracts carry the file's graph_name (G5 — never the wrong graph).
router.post('/:fileId/retract', authorizeRole(['Admin', 'okf-service']), fileController.retractFile);

/**
 * @swagger
 * /api/files/ingest:
 *   post:
 *     summary: Ingest multiple files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Files ingested successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/ingest', authorizeRole(['Admin']), fileController.ingestMultipleFiles);

/**
 * @swagger
 * /api/files/ingest-bundle:
 *   post:
 *     summary: Ingest an OKF bundle (bypasses upload allowlist; ClamAV scanned; threads graph_name)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bundle
 *               - graph_name
 *               - repo_id
 *             properties:
 *               bundle:
 *                 type: string
 *                 format: byte
 *                 description: Base64-encoded bundle content
 *               graph_name:
 *                 type: string
 *                 description: The OKF graph name (OKF_{repo_id})
 *               repo_id:
 *                 type: string
 *                 description: The OKF repository ID
 *               originalFileName:
 *                 type: string
 *                 description: Original file name for the stored file
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Selected knowledge-hierarchy labels (persisted on the files doc; scopes chunk labeling)
 *     responses:
 *       '202':
 *         description: Bundle accepted for async ingestion
 *       '400':
 *         description: Invalid input or malware detected
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/ingest-bundle', authorizeRole(['Admin', 'okf-service']), fileController.bundleIngest);

/**
 * @swagger
 * /api/files/retract:
 *   post:
 *     summary: Retract multiple files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Files retracted successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin role required
 */
router.post('/retract', authorizeRole(['Admin']), fileController.retractMultipleFiles);

/**
 * @swagger
 * /api/files/{fileId}/ingestion-log:
 *   post:
 *     summary: Add an ingestion log entry for a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - level
 *               - message
 *             properties:
 *               level:
 *                 type: string
 *                 enum: [info, warn, error, debug]
 *                 description: Log level
 *               message:
 *                 type: string
 *                 description: The log message
 *               stage:
 *                 type: string
 *                 description: The ingestion stage (e.g., 'dataprep', 'embedding')
 *     responses:
 *       '201':
 *         description: Log entry added successfully
 *       '401':
 *         description: Unauthorized
 *       '403':
 *         description: Forbidden - Admin or dataprep-service role required
 *       '404':
 *         description: File not found
 */
// Story 4.8-amend: the OKF ingest worker mirrors per-concept ingestion
// progress to the bundle zip's ingestion log (David's 3rd-time directive
// 2026-08-20). The okf-server service-account client holds the bootstrap
// `tools-admin` super-role (see genie-realm.yaml client role mapping) so
// the worker's mirror POSTs succeed.
router.post(
  '/:fileId/ingestion-log',
  authorizeRole(['Admin', 'dataprep-service', 'okf-service', 'tools-admin']),
  fileController.addIngestionLog
);

/**
 * @swagger
 * /api/files/{fileId}/ingestion-log:
 *   get:
 *     summary: Get all ingestion log entries for a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     responses:
 *       '200':
 *         description: List of log entries
 *       '401':
 *         description: Unauthorized
 */
router.get('/:fileId/ingestion-log', authorizeRole(['Admin', 'dataprep-service']), fileController.getIngestionLogs);

/**
 * @swagger
 * /api/files/{fileId}/status:
 *   patch:
 *     summary: Update file ingestion status and chunk count (for internal/OPEA use)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *         description: File ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dataprep:
 *                 type: object
 *                 properties:
 *                   status:
 *                     type: string
 *                     enum: [Pending, Ingesting, Ingested, Ingested with Warnings, Ingestion Error, Retracted]
 *                   chunk_count:
 *                     type: integer
 *     responses:
 *       '200':
 *         description: File status updated successfully
 *       '401':
 *         description: Unauthorized
 */
router.patch(
  '/:fileId/status',
  // Story 4.8-amend: the okf-server service client drives the BUNDLE state
  // machine (Pending → Ingesting → Ingested|Error) through this route.
  authorizeRole(['Admin', 'dataprep-service', 'okf-service', 'tools-admin']),
  fileController.updateFileStatus
);

module.exports = router;
