const NodeClam = require('clamscan');
const { Readable } = require('stream');

const appConfig = require('../config/appConfig');
const { logger } = require('../../shared-lib');
const { dbService } = require('../../shared-lib');

class SecurityService {
  constructor() {
    this.clamAVOptions = {
      removeInfected: appConfig.clamscan.removeInfected,
      quarantineInfected: appConfig.clamscan.quarantineInfected,
      debugMode: appConfig.clamscan.debugMode,
      clamdscan: {
        socket: appConfig.clamscan.socket,
        port: appConfig.clamscan.port,
        timeout: parseInt(appConfig.clamscan.timeout, 10) || 60000,
        localFallback: appConfig.clamscan.localFallback,
        path: appConfig.clamscan.path,
        active: appConfig.clamscan.active
      },
      preference: 'clamdscan'
    };

    this.clamscan = null;
    this.isInitialized = false;
    this.maxBufferSize = 50 * 1024 * 1024; // 50MB — must match MAX_FILE_SIZE
  }

  async getDb() {
    return await dbService.getConnection('default');
  }

  /*
   * Converts a buffer to a stream
   * @param {Buffer} buffer - Buffer to convert
   * @returns {Readable} Stream
   */
  _convertToStream(buffer) {
    const bufferStream = new Readable();
    bufferStream.push(buffer);
    bufferStream.push(null);
    return bufferStream;
  }

  /**
   * Initialize the ClamAV scanner
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized && this.clamscan) {
      return;
    }

    logger.debug(`[SECURITY-SERVICE] Initializing...`);
    try {
      if (appConfig.virusScanning) {
        logger.debug(`[SECURITY-SERVICE] Initializing ClamAV scanner`);
        this.clamscan = await new NodeClam().init(this.clamAVOptions);
      }
    } catch (error) {
      throw new Error(`Failed to initialize ClamAV: ${error.message}`, { cause: error });
    }

    this.isInitialized = true;
  }

  /**
   * Ensures the scanner is initialized before use
   * @returns {Promise<void>}
   */
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Scans a buffer for viruses using ClamAV
   * @param {Buffer} buffer - File buffer to scan
   * @returns {Promise<Object>} Scan result
   */
  async scanBuffer(buffer) {
    logger.debug(`[SECURITY-SERVICE] Scanning buffer of size ${buffer.length} bytes`);
    try {
      // Validate input
      if (!Buffer.isBuffer(buffer)) {
        throw new Error('Input must be a Buffer');
      }

      if (buffer.length === 0) {
        throw new Error('Buffer is empty');
      }

      if (buffer.length > this.maxBufferSize) {
        throw new Error(`Buffer size exceeds maximum allowed size of ${this.maxBufferSize} bytes`);
      }
      await this.ensureInitialized();

      if (!this.clamscan) {
        logger.debug('[SECURITY-SERVICE] Virus scanning disabled, skipping scan');
        return { isInfected: false };
      }

      // Scan the buffer using stream scanning
      return await this.clamscan.scanStream(this._convertToStream(buffer));
    } catch (error) {
      throw new Error(`Buffer scan failed: ${error.message}`, { cause: error });
    }
  }
}

module.exports = new SecurityService();
