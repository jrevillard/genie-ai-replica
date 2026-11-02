// A5: token verification moved to middlewares/keycloak-auth-middleware.js (jose/JWKS).
// This service is ClamAV virus scanning only — matches upstream v2.0.1 securityService.
const NodeClam = require('clamscan');
const { Readable } = require('stream');

const appConfig= require('../config/appConfig');
const { logger } = require('../../shared-lib');


class SecurityService {
  constructor() {
    this.clamAVOptions = {
      removeInfected: appConfig.clamscan.removeInfected,
      quarantineInfected: appConfig.clamscan.quarantineInfected,
      debugMode: appConfig.clamscan.debugMode,
      clamdscan: {
        // F3 review: host lives HERE (clamscan v2.4 reads options.clamdscan.host only —
        // top-level is a no-op); without it the lib execs a nonexistent LOCAL clamdscan.
        host: appConfig.clamscan.host,
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
    if (this.isInitialized && this.clamscan) {
      return;
    }

    logger.debug(`[SECURITY-SERVICE] Initializing...`);
    try {
      if (appConfig.virusScanning) {
        // F3: braces added — the missing block ran init even when scanning was disabled
        logger.debug(`[SECURITY-SERVICE] Initializing ClamAV scanner`);
        this.clamscan = await new NodeClam().init(this.clamAVOptions);
      }
    } catch (error) {
      throw new Error(`Failed to initialize ClamAV: ${error.message}`);
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

      // Scan the buffer using stream scanning
      return await this.clamscan.scanStream(this._convertToStream(buffer));

    } catch (error) {
      throw new Error(`Buffer scan failed: ${error.message}`);
    }
  }
}

module.exports = new SecurityService();