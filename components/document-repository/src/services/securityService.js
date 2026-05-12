const NodeClam = require('clamscan');
const { Readable } = require('stream');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

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
        host: appConfig.clamscan.host,
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
    this.scanQueue = Promise.resolve();
    this.execFileAsync = promisify(execFile);
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

  async resetScanner() {
    this.isInitialized = false;
    this.clamscan = null;
    await this.ensureInitialized();
  }

  _isRecoverableStreamError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('instream size limit exceeded') ||
      message.includes('write epipe') ||
      message.includes('broken pipe') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('invalid information provided to connect to clamav service')
    );
  }

  async _scanFileWithCli(tempPath) {
    const args = ['--no-summary', tempPath];
    const timeoutMs = parseInt(appConfig.clamscan.timeout, 10) || 60000;
    try {
      await this.execFileAsync(appConfig.clamscan.path || '/usr/bin/clamdscan', args, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024
      });
      return { isInfected: false };
    } catch (error) {
      // clamdscan returns exit code 1 when infected; parse stdout/stderr to confirm.
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.toLowerCase();
      if (error?.code === 1 || output.includes('found')) {
        return { isInfected: true };
      }
      throw error;
    }
  }

  /**
   * Scans a buffer for viruses using ClamAV
   * @param {Buffer} buffer - File buffer to scan
   * @returns {Promise<Object>} Scan result
   */
  async scanBuffer(buffer) {
    // Serialize scans to reduce clamd stream/socket pressure under bulk uploads.
    const run = async () => {
      logger.debug(`[SECURITY-SERVICE] Scanning buffer of size ${buffer.length} bytes`);
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

      const tryStreamScan = async () => this.clamscan.scanStream(this._convertToStream(buffer));
      try {
        return await tryStreamScan();
      } catch (scanError) {
        if (!this._isRecoverableStreamError(scanError)) {
          throw scanError;
        }

        // One recovery attempt: reinitialize scanner and retry stream once.
        logger.warn(`[SECURITY-SERVICE] Recoverable stream scan error, retrying after scanner reset: ${scanError.message}`);
        await this.resetScanner();
        try {
          return await tryStreamScan();
        } catch (retryError) {
          if (!this._isRecoverableStreamError(retryError) || !appConfig.clamscan.localFallback) {
            throw retryError;
          }
          // Final fallback to file scan for stream/socket failures.
          const tempPath = path.join(os.tmpdir(), `clam-fallback-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
          logger.warn(`[SECURITY-SERVICE] Stream scan failed twice; falling back to file scan at ${tempPath}`);
          try {
            await fs.writeFile(tempPath, buffer);
            if (this.clamscan && typeof this.clamscan.scanFile === 'function') {
              return await this.clamscan.scanFile(tempPath);
            }
            return await this._scanFileWithCli(tempPath);
          } finally {
            await fs.unlink(tempPath).catch(() => {});
          }
        }
      }
    };

    const next = this.scanQueue.then(run);
    this.scanQueue = next.catch(() => {});
    try {
      return await next;
    } catch (error) {
      throw new Error(`Buffer scan failed: ${error.message}`, { cause: error });
    }
  }
}

module.exports = new SecurityService();
