/*
 * @Author: ScarlettSun9 53145308+ScarlettSun9@users.noreply.github.com
 * @Date: 2025-06-15 19:41:49
 * @LastEditors: ScarlettSun9 53145308+ScarlettSun9@users.noreply.github.com
 * @LastEditTime: 2025-06-19 17:27:33
 * @FilePath: /genie-ai/components/document-repository/src/config/appConfig.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database configuration
  database: {
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    username: process.env.ARANGO_USERNAME || 'root',
    password: process.env.ARANGO_PASSWORD || 'test',
    databaseName: process.env.ARANGO_DB_NAME || 'document_repository'
  },

  dataprep: {
    host: process.env.DATAPREP_HOST || 'http://e2e-gpu', // to be replaced with the actual host
    port: process.env.DATAPREP_PORT || '5000', // to be replaced with the actual port
    ingestPath: '/ingest',
    retractPath: '/retract'
  },

  // File upload configuration
  upload: {
    maxFilesUpload: parseInt(process.env.MAX_FILES_UPLOAD) || 10, // Maximum number of files that can be uploaded at once
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    allowedMimeTypes: [
      'application/pdf',  // pdf files .pdf
      'application/msword', // word files .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // word files .docx
      'application/vnd.ms-excel', // excel files .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // excel files .xlsx
      'text/markdown',  // markdown files .md, .markdown
      'text/html',  // html files .html
      'text/plain',  // text files .txt
      'application/octet-stream' // generic binary files - temporary adding it to solve docx, xlsx, md upload issues
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.html', '.txt']
  },

  // Security configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtExpiration: process.env.JWT_EXPIRATION || '24h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limit each IP to 100 requests per windowMs
    }
  },

  virusScanning: process.env.VIRUS_SCANNING === 'true' || true,

  // ClamAV configuration using clamscan library
  clamscan: {
    removeInfected: process.env.CLAMSCAN_REMOVE_INFECTED === 'true' || false, // If true, removes infected files
    quarantineInfected: process.env.CLAMSCAN_QUARANTINE_INFECTED || false, // False: Don't quarantine, Path: Moves files to this place.
    debugMode: process.env.CLAMSCAN_DEBUG_MODE === 'true' || false, // Whether or not to log info/debug/error msgs to the console
    socket: process.env.CLAMSCAN_SOCKET || false, // Socket file for connecting via TCP
    host: process.env.CLAMSCAN_HOST || 'localhost', // IP of host to connect to TCP interface
    port: process.env.CLAMSCAN_PORT || 3310, // Port of host to use when connecting via TCP interface
    timeout: process.env.CLAMSCAN_TIMEOUT || 60000, // Timeout for scanning files
    localFallback: process.env.CLAMSCAN_LOCAL_FALLBACK === 'true' || true, // Use local preferred binary to scan if socket/tcp fails
    path: process.env.CLAMSCAN_PATH || '/usr/bin/clamdscan', // Path to the clamdscan binary on your server
    active: process.env.CLAMSCAN_ACTIVE === 'true' || true, // If true, this module will consider using the clamdscan binary
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'app.log'
  }
};

module.exports = config;