const { logger } = require('../shared-lib/logger');
const NodeClam = require('clamscan');
const { Readable } = require('stream');
const appConfig= require('../config/appConfig');


class SecurityService {
  constructor() {
    this.clamAVOptions = {
      removeInfected: appConfig.clamscan.removeInfected,
      quarantineInfected: appConfig.clamscan.quarantineInfected,
      scanLog: appConfig.clamscan.scanLog,
      debugMode: appConfig.clamscan.debugMode,
      clamdscan: {
        socket: appConfig.clamscan.socket,
        port: appConfig.clamscan.port,
        timeout: appConfig.clamscan.timeout,
        localFallback: appConfig.clamscan.localFallback,
        path: appConfig.clamscan.path,
        active: appConfig.clamscan.active
      },
      preference: 'clamdscan'
    };
    
    this.clamscan = null;
    this.isInitialized = false;
    this.maxBufferSize = 100 * 1024 * 1024; // 100MB
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
    logger.debug(`[SECURITY-SERVICE] Initializing ClamAV scanner`);
    if (this.isInitialized && this.clamscan) {
      return;
    }

    try {
      this.clamscan = await new NodeClam().init(this.clamAVOptions);
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize ClamAV: ${error.message}`);
    }
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
      logger.debug(`[SECURITY-SERVICE] Ensuring ClamAV is initialized`);
      await this.ensureInitialized();

      // Scan the buffer using stream scanning
      logger.debug(`[SECURITY-SERVICE] Scanning buffer using stream scanning`);
      const result = await this.clamscan.scanStream(this._convertToStream(buffer));
      logger.debug(`[SECURITY-SERVICE] Scan result: ${JSON.stringify(result, null, 2)}`);

      return {
        isInfected: result.isInfected,
        viruses: result.viruses,
        message: result.isInfected 
          ? `Virus detected: ${result.viruses.join(', ')}` 
          : 'File is clean',
        file: null
      };
    } catch (error) {
      throw new Error(`Buffer scan failed: ${error.message}`);
    }
  }
}

module.exports = new SecurityService();