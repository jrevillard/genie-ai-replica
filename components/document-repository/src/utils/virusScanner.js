// TODO: [HIGH] Implement virus scan
// - still failed using clamscan, eventhough clamav and clamav-daemon are installed
// - read more about clamscan https://www.npmjs.com/package/clamscan

const NodeClam = require('clamscan');
const config = require('../config/appConfig');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: config.logging.file })
  ]
});

// Initialize ClamAV scanner with configuration
const clamClient = new NodeClam().init({
  removeInfected: false,
  quarantineInfected: false,
  scanLog: null,
  debugMode: config.logging.level === 'debug',
  fileList: null,
  scanRecursively: true,
  clamscan: {
    path: '/usr/bin/clamscan',
    db: null,
    scanArchives: true,
    active: true
  },
  clamdscan: {
    socket: false,
    host: config.antivirus.host,
    port: config.antivirus.port,
    timeout: config.antivirus.timeout || 60000,
    localFallback: true,
    path: '/usr/bin/clamdscan',
    configFile: null,
    multiscan: true,
    reloadDb: false,
    active: true,
    bypassTest: false
  },
  preference: 'clamdscan'
});

/**
 * Initialize ClamAV connection
 */
const initClamAV = async () => {
  try {
    if (!config.antivirus.enabled) {
      logger.info('ClamAV scanning is disabled');
      return { isAvailable: false };
    }

    if (!config.antivirus.host || !config.antivirus.port) {
      throw new Error('ClamAV host and port must be configured');
    }

    logger.info(`Initializing ClamAV connection to ${config.antivirus.host}:${config.antivirus.port}`);
    const version = await clamClient.getVersion();
    logger.info(`ClamAV initialized successfully: ${version}`);
    return { isAvailable: true, version };
  } catch (error) {
    logger.error('Failed to initialize ClamAV:', error);
    return { isAvailable: false, error: error.message };
  }
};

/**
 * Scan file buffer for viruses
 */
const scanBuffer = async (buffer, filename = 'unknown') => {
  try {
    if (!config.antivirus.enabled) {
      logger.info('Virus scanning is disabled, skipping scan');
      return {
        isClean: true,
        message: 'Scanning disabled'
      };
    }

    logger.info(`Starting virus scan for file: ${filename}`);
    
    const scanResult = await clamClient.scanStream(buffer);

    if (scanResult.isInfected) {
      logger.warn(`Virus detected in file ${filename}: ${scanResult.viruses.join(', ')}`);
      return {
        isClean: false,
        viruses: scanResult.viruses,
        message: `Virus detected: ${scanResult.viruses.join(', ')}`
      };
    }

    logger.info(`File ${filename} is clean`);
    return {
      isClean: true,
      message: 'File is clean'
    };
  } catch (error) {
    logger.error(`Error scanning file ${filename}:`, error);
    
    // In case of scanning error, decide whether to allow or block the file
    // For production, you might want to block files if scanning fails
    return {
      isClean: false,
      error: error.message,
      message: 'Scanning failed - file blocked for security'
    };
  }
};

/**
 * Scan file from filesystem
 */
const scanFile = async (filePath) => {
  try {
    if (!config.antivirus.enabled) {
      return {
        isClean: true,
        message: 'Scanning disabled'
      };
    }

    logger.info(`Starting virus scan for file: ${filePath}`);
    
    const scanResult = await clamClient.isInfected(filePath);

    if (scanResult.isInfected) {
      logger.warn(`Virus detected in file ${filePath}: ${scanResult.viruses.join(', ')}`);
      return {
        isClean: false,
        viruses: scanResult.viruses,
        message: `Virus detected: ${scanResult.viruses.join(', ')}`
      };
    }

    logger.info(`File ${filePath} is clean`);
    return {
      isClean: true,
      message: 'File is clean'
    };
  } catch (error) {
    logger.error(`Error scanning file ${filePath}:`, error);
    return {
      isClean: false,
      error: error.message,
      message: 'Scanning failed - file blocked for security'
    };
  }
};

/**
 * Get ClamAV daemon status
 */
const getStatus = async () => {
  try {
    if (!config.antivirus.enabled) {
      return {
        isAvailable: false,
        message: 'ClamAV scanning is disabled'
      };
    }

    const version = await clamClient.getVersion();
    return {
      isAvailable: true,
      version,
      message: 'ClamAV is running'
    };
  } catch (error) {
    return {
      isAvailable: false,
      error: error.message,
      message: 'ClamAV is not available'
    };
  }
};

// Initialize ClamAV on module load
initClamAV().catch(error => {
  logger.error('Failed to initialize ClamAV on startup:', error);
});

module.exports = {
  initClamAV,
  scanBuffer,
  scanFile,
  getStatus
};