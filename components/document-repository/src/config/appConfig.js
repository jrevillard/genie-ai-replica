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

  // File upload configuration
  upload: {
    maxFilesUpload: parseInt(process.env.MAX_FILES_UPLOAD) || 10, // Maximum number of files that can be uploaded at once
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    allowedMimeTypes: [
      'application/pdf',  // pdf files .pdf
      'application/msword', // word files .doc, .docx
      'application/vnd.ms-excel', // excel files .xls, .xlsx
      'text/markdown',  // markdown files .md, .markdown
      'text/html',  // html files .html
      'text/plain'  // text files .txt
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

  virusScanning: process.env.VIRUS_SCANNING === 'true' || false,

  // ClamAV configuration
  antivirus: {
    enabled: process.env.ANTIVIRUS_ENABLED === 'true' || true,
    host: process.env.CLAMAV_HOST || 'localhost',
    port: parseInt(process.env.CLAMAV_PORT) || 3310,
    timeout: parseInt(process.env.CLAMAV_TIMEOUT) || 30000
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'app.log'
  }
};

module.exports = config;