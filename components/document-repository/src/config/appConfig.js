/*
 * This object is used to read and load all of the configurations and make them available to the other components
 */
require('dotenv').config();

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
};

const parseSocket = value => {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  if (['false', '0', 'no', 'off', 'none', 'null'].includes(lowered)) {
    return false;
  }
  if (['true', '1', 'yes', 'on'].includes(lowered)) {
    return '/var/run/clamav/clamd.ctl';
  }
  return normalized;
};

const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database configuration
  database: {
    url: process.env.ARANGO_URL || 'http://arangodb:8529',
    username: process.env.ARANGO_USER || 'root',
    password: process.env.ARANGO_PASSWORD, // Required - no default for security
    databaseName: process.env.ARANGO_DB || 'genie-ai'
  },

  // Dataprep service configuration
  dataprep: {
    host: process.env.DATAPREP_HOST || 'http://dataprep-arango-service',
    port: process.env.DATAPREP_PORT || '5000',

    // This needs to be changed as it cannot be deployed on Kubernetes like this; David F
    ingestPath: '/v1/dataprep/ingest_file',
    retractPath: '/v1/dataprep/retract_file',
    reextractTaxonomyPath: '/v1/dataprep/reextract_taxonomy'
  },

  // File upload configuration
  upload: {
    // Queue dataprep ingestion immediately after upload (async; upload API still returns 201 quickly).
    // Default: enabled. Set DOC_REPO_AUTO_INGEST_ON_UPLOAD=false to require manual "Ingest" from admin UI.
    autoIngestOnUpload: process.env.DOC_REPO_AUTO_INGEST_ON_UPLOAD !== 'false',
    maxFilesUpload: parseInt(process.env.MAX_FILES_UPLOAD) || 10, // Maximum number of files that can be uploaded at once
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    allowedMimeTypes: [
      'application/pdf', // pdf files .pdf
      'application/msword', // word files .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // word files .docx
      'application/vnd.ms-excel', // excel files .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // excel files .xlsx
      'text/markdown', // markdown files .md, .markdown
      'text/plain', // text files .txt (also sent by some browsers for .md)
      'text/html', // html files .html
      'application/zip', // browsers sometimes report .docx/.xlsx as zip
      'application/x-zip-compressed' // Windows browsers sometimes report Office files as this
    ],
    allowedExtensions: ['.pdf', '.docx', '.xlsx', '.md', '.html', '.txt'],
    requiredIngestionLanguage: process.env.DOCUMENT_INGESTION_LANGUAGE || 'en',
    enforceIngestionLanguage: process.env.DOCUMENT_INGESTION_ENFORCE_LANGUAGE !== 'false'
  },

  // Crawler configuration (NEW)
  crawler: {
    // Hard limit on pages to crawl per job to prevent OOM
    maxPages: parseInt(process.env.CRAWLER_MAX_PAGES) || 1000,
    // How often the worker polls for new jobs (in ms)
    pollIntervalMs: parseInt(process.env.CRAWLER_POLL_INTERVAL_MS) || 5000,
    // Number of concurrent page fetches
    workerConcurrency: parseInt(process.env.CRAWLER_WORKER_CONCURRENCY) || 10
  },

  //Labeling configuration
  labels: {
    allowedLevels: ['category', 'service'], // Allowed levels for labels
    allowedStatuses: ['pending', 'active'] // Allowed statuses for labels - not sure what this is for; David F
  },

  // Security configuration
  security: {
    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakRealm: process.env.KC_REALM,
    keycloakClientId: process.env.KC_CLIENT_ID,
  },

  //Controls whether or not the clamav service is used for uploaded documents
  virusScanning: parseBoolean(process.env.VIRUS_SCANNING, false),

  // ClamAV configuration using clamscan library
  clamscan: {
    removeInfected: parseBoolean(process.env.CLAMSCAN_REMOVE_INFECTED, false),

    // FIX: Check for the string 'false' or use the env var as a path
    quarantineInfected:
      process.env.CLAMSCAN_QUARANTINE_INFECTED === 'false' ? false : process.env.CLAMSCAN_QUARANTINE_INFECTED || false,

    debugMode: parseBoolean(process.env.CLAMSCAN_DEBUG_MODE, false),

    // FIX: Use a strict === 'true' check, as 'false' string is truthy
    socket: parseSocket(process.env.CLAMSCAN_SOCKET),

    host: process.env.CLAMSCAN_HOST || '127.0.0.1',

    // FIX: Convert port string to a number
    port: parseInt(process.env.CLAMSCAN_PORT, 10) || 3310,

    // FIX: Convert timeout string to a number
    timeout: parseInt(process.env.CLAMSCAN_TIMEOUT, 10) || 60000,

    localFallback: parseBoolean(process.env.CLAMSCAN_LOCAL_FALLBACK, true),
    path: process.env.CLAMSCAN_PATH || '/usr/bin/clamdscan',
    active: parseBoolean(process.env.CLAMSCAN_ACTIVE, true)
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'app.log'
  }
};

/**
 * Base URL for dataprep HTTP calls. If DATAPREP_HOST already includes a port,
 * avoids appending DATAPREP_PORT again (fixes http://host:5000 plus port 5000).
 * @returns {string}
 */
config.buildDataprepBaseUrl = function () {
  const hostRaw = String(this.dataprep.host || 'http://dataprep-arango-service').trim().replace(/\/+$/, '');
  const portStr = String(this.dataprep.port || '5000').trim().replace(/^:/, '');
  const withScheme = /^https?:\/\//i.test(hostRaw) ? hostRaw : `http://${hostRaw}`;
  try {
    const u = new URL(withScheme);
    if (!u.port) {
      u.port = portStr;
    }
    return u.origin;
  } catch {
    return `${withScheme}:${portStr}`;
  }
};

/**
 * Returns a formatted string representation of the configuration object for logging.
 * Sensitive keys (like 'password' or 'jwtSecret') are redacted.
 * @returns {string} A formatted string of the loaded configuration.
 */
config.getFormattedConfiguration = function () {
  // Add any other sensitive keys here in lowercase and they will be redacted
  const sensitiveKeys = ['password', 'arango_password'];

  /**
   * Recursively formats an object for logging.
   * @param {object} obj - The object to format.
   * @param {string} indent - The current indentation level.
   * @returns {string} A formatted string representation of the object.
   */
  const formatRecursive = (obj, indent = '  ') => {
    const lines = [];
    for (const [key, value] of Object.entries(obj)) {
      // Skip logging this function itself
      if (key === 'getFormattedConfiguration') {
        continue;
      }

      // 1. Check for sensitive keys (case-insensitive)
      if (sensitiveKeys.includes(key.toLowerCase())) {
        lines.push(`${indent}${key}: [REDACTED]`);
        continue;
      }

      // 2. Handle nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${indent}${key}:`);
        lines.push(formatRecursive(value, indent + '  '));
      }
      // 3. Handle arrays
      else if (Array.isArray(value)) {
        // Truncate long arrays for readability
        if (value.length > 10) {
          lines.push(`${indent}${key}: [${value.slice(0, 10).join(', ')}... (and ${value.length - 10} more)]`);
        } else {
          lines.push(`${indent}${key}: [${value.join(', ')}]`);
        }
      }
      // 4. Handle primitives (string, number, boolean, null)
      else {
        lines.push(`${indent}${key}: ${value}`);
      }
    }
    return lines.join('\n');
  };

  // Using 'this' refers to the 'config' object itself
  return `\n--- Loaded Environment Configuration ---\n${formatRecursive(this)}\n----------------------------------------`;
};

module.exports = config;
