const NodeClam = require('clamscan');
const { Readable } = require('stream');
const { execFileSync } = require('child_process');

const appConfig = require('../config/appConfig');
const { logger } = require('../../shared-lib');
const { dbService } = require('../../shared-lib');

// AD-20 — cached ClamAV signature version.
// Query `clamdscan --version` once at module load and cache the trimmed
// stdout. The daemon is co-located in the doc-repo container so the call
// is cheap, but emitting one process spawn per file scan would still
// dominate scan latency for sub-millisecond scans. ENOENT / spawn
// failures / empty output all fall back to 'unknown' so a missing daemon
// during boot never breaks the upload path.
const clamavSignatureVersion = (() => {
  try {
    const raw = execFileSync('clamdscan', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    });
    const out = raw && raw.length ? raw.toString().trim() : '';
    return out || 'unknown';
  } catch {
    return 'unknown';
  }
})();

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

  /**
   * Scans a buffer for viruses and emits AD-20 ClamAV observability events.
   *
   * Emits exactly one terminal event per call: `clamav.scan.complete` on
   * success, `clamav.scan.timeout` when the underlying scanner rejects
   * with an ETIMEDOUT-class error, or `clamav.scan.failed` for any
   * other failure. The `clamav.scan.start` event is emitted before the
   * scan begins so latency can be measured end-to-end.
   *
   * Emitted `clamav_result` values are the AD-20 4-value enum
   * (`OK` / `FOUND` / `ERROR` / `TIMEOUT`) — supersedes the story AC's
   * 3-value enum (`clean` / `infected` / `error`) which AD-20 explicitly
   * replaces (binding architecture decision).
   *
   * @param {string} fileId - Opaque file ID for correlation with admin dashboard
   * @param {Buffer} buffer - File buffer to scan
   * @returns {Promise<Object>} Scan result with `{isInfected, viruses}` shape
   */
  async scanFile(fileId, buffer) {
    const fileSizeBytes = buffer.length;

    // No `clamav_result` / `clamav_duration_ms` on start: outcome is unknown
    // at this point. Stamping `OK` would double-count clean scans and skew
    // VL aggregations (the same defect as logging `ERROR` before the scan
    // runs). Per AD-20 the start event is a latency marker only.
    logger.info('clamav.scan.start', {
      file_id: fileId,
      file_size_bytes: fileSizeBytes,
      clamav_signature_version: clamavSignatureVersion
    });

    const startedAt = Date.now();
    try {
      const result = await this.scanBuffer(buffer);
      const durationMs = Math.max(0, Date.now() - startedAt);
      logger.info('clamav.scan.complete', {
        file_id: fileId,
        file_size_bytes: fileSizeBytes,
        clamav_signature_version: clamavSignatureVersion,
        clamav_duration_ms: durationMs,
        clamav_result: result && result.isInfected ? 'FOUND' : 'OK'
      });
      return result;
    } catch (error) {
      const message = (error && error.message) || '';
      const isTimeout = Boolean(
        error &&
        (error.code === 'ETIMEDOUT' ||
          (error.cause && error.cause.code === 'ETIMEDOUT') ||
          /timed\s*out|ETIMEDOUT/i.test(message))
      );
      const durationMs = Math.max(0, Date.now() - startedAt);
      const fields = {
        file_id: fileId,
        file_size_bytes: fileSizeBytes,
        clamav_signature_version: clamavSignatureVersion,
        clamav_duration_ms: durationMs,
        clamav_result: isTimeout ? 'TIMEOUT' : 'ERROR'
      };
      // Failure paths use warn/error so Grafana alert rules (error-rate,
      // timeout-rate) can fire. info-level silent failures would never
      // trigger an alert and would defeat the AD-20 latency-drift
      // / silent-failure surface the event exists to provide.
      if (isTimeout) {
        logger.warn('clamav.scan.timeout', fields);
      } else {
        logger.error('clamav.scan.failed', fields);
      }
      throw error;
    }
  }
}

module.exports = new SecurityService();
