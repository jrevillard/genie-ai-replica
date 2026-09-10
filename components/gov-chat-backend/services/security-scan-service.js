const fsPromises = require('fs').promises;
const path = require('path');
const nodeCrypto = require('crypto');
const Ajv = require('ajv');
const { logger } = require('../shared-lib');
const { DateTime } = require('luxon');
const axios = require('axios');
const config = require('../config');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const DAYS_TO_PROCESS = 10;
const SHA1_SLICE_LEN = 16;
const VL_QUERY_LIMIT = 100000;
const MAX_NEEDLE_LEN = 80;

/**
 * Strict JSON Schema covering the full `vulnerabilities.{critical,medium,low}[]`
 * shape written by `saveScanResults()` (AD-12 — no hand-rolled `typeof`
 * checks; AJV 8.17+ is the canonical validator). Any deviation (missing
 * keys, wrong severity values, malformed `details[]`) classifies the
 * cache as a miss and triggers a fresh scan.
 */
const SCAN_CACHE_SCHEMA = {
  type: 'object',
  required: [
    'scanTime',
    'vulnerabilities',
    'vulnerabilityDetails',
    'failedLoginDetails',
    'suspiciousDetails',
    'status',
    'message',
    'skipped',
    'reason'
  ],
  additionalProperties: true,
  properties: {
    scanTime: { type: 'string' },
    vulnerabilities: {
      type: 'object',
      required: ['critical', 'medium', 'low', 'details'],
      properties: {
        critical: { type: 'integer', minimum: 0 },
        medium: { type: 'integer', minimum: 0 },
        low: { type: 'integer', minimum: 0 },
        details: { type: 'array' }
      }
    },
    vulnerabilityDetails: {
      type: 'object',
      required: ['critical', 'medium', 'low'],
      properties: {
        critical: { type: 'array' },
        medium: { type: 'array' },
        low: { type: 'array' }
      }
    },
    failedLoginDetails: { type: 'array' },
    suspiciousDetails: { type: 'array' },
    status: { type: 'string', enum: ['completed', 'skipped'] },
    message: { type: 'string' },
    skipped: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    degraded: { type: 'boolean' },
    error: { type: ['string', 'null'] }
  }
};

/**
 * Vulnerability patterns.
 * Each entry pairs a canonical `regex` (used to bucket matched VL rows)
 * with one or more LogSQL `_msg:"needle"` strings used to narrow the
 * candidate set at the VL query layer. The 14 entries match the
 * historical file-based scanner contract.
 */
const VULNERABILITY_PATTERNS = [
  {
    type: 'token_issue',
    severity: 'critical',
    needles: ['invalid token'],
    regex: /invalid token/i,
    description: 'Invalid or expired token usage detected',
    recommendation: 'Review token expiration policies.',
    service: 'auth'
  },
  {
    type: 'attack_attempt',
    severity: 'critical',
    needles: ['SQL injection', 'XSS', 'CSRF'],
    regex: /SQL injection|XSS|CSRF/i,
    description: 'Potential attack attempt detected',
    recommendation: 'Implement WAF and input sanitization.',
    service: 'http'
  },
  {
    type: 'command_injection',
    severity: 'critical',
    needles: ['sleep', '__import__', 'execSync'],
    regex:
      /(sleep\s+\d+|__import__\(\s*['"]subprocess['"]\)|execSync\(\s*['"]sleep\s+\d+['"]\)|%x\(\s*sleep\s+\d+\s*\))/i,
    description: 'Command injection attempt detected in token or request',
    recommendation: 'Sanitize all inputs and implement strict validation.',
    service: 'auth'
  },
  {
    type: 'sensitive_file_access',
    severity: 'medium',
    needles: ['Blocked access to sensitive path'],
    regex:
      /Blocked access to sensitive path:\s*((?:\/api\/)?(?:\.env|\.git\/config|\.gitignore|\.npmrc|node_modules\/\.package-lock\.json|\.well-known\/security\.txt))/i,
    description: 'Attempt to access sensitive file detected',
    recommendation: 'Ensure sensitive files are not exposed and access is blocked.',
    service: 'http'
  },
  {
    type: 'ip_blocked',
    severity: 'medium',
    needles: ['IP Blocked'],
    regex: /IP Blocked/i,
    description: 'IP blocked due to suspicious activity',
    recommendation: 'Review blocked IPs for false positives and enhance rate limiting.',
    service: 'system'
  },
  {
    type: 'auth_failure_401',
    severity: 'medium',
    needles: ['Authentication Failure - 401'],
    regex: /Authentication Failure - 401/i,
    description: 'HTTP 401 unauthorized access attempt detected',
    recommendation: 'Monitor for brute force and review access controls.',
    service: 'system'
  },
  {
    type: 'db_error',
    severity: 'medium',
    needles: ['collection.save failed'],
    regex: /collection\.save failed.*expecting both `_from` and `_to` attributes/i,
    description: 'Database operation failed due to misconfiguration',
    recommendation: 'Review ArangoDB edge document configuration.',
    service: 'database'
  },
  {
    type: 'non_critical_file_access',
    severity: 'low',
    needles: ['com.chrome.devtools.json'],
    regex: /Blocked access to sensitive path:\s*(\/\.well-known\/appspecific\/com\.chrome\.devtools\.json)/i,
    description: 'Attempt to access non-critical configuration file detected',
    recommendation: 'Verify if access to such files should be blocked.',
    service: 'http'
  },
  {
    type: 'unauthorized_access',
    severity: 'medium',
    needles: ['not authorized'],
    regex: /not authorized/i,
    description: 'Unauthorized access attempt detected',
    recommendation: 'Check access control policies.',
    service: 'auth'
  },
  {
    type: 'brute_force',
    severity: 'medium',
    needles: ['brute force'],
    regex: /brute force/i,
    description: 'Brute force attempt detected',
    recommendation: 'Implement rate limiting.',
    service: 'auth'
  },
  {
    type: 'failed_login',
    severity: 'low',
    needles: ['Invalid credentials', 'failed login'],
    regex: /Invalid credentials|failed login/i,
    description: 'Failed login attempt detected',
    recommendation: 'Monitor for suspicious activity.',
    service: 'auth'
  },
  {
    type: 'not_found_404',
    severity: 'low',
    needles: ['404 Not Found'],
    regex: /404 Not Found: (GET|POST|PUT|DELETE)\s+\/api\/api\//i,
    description: 'Invalid API endpoint access attempt detected',
    recommendation: 'Review for probing attempts and ensure proper routing.',
    service: 'http'
  },
  {
    type: 'registration_failure',
    severity: 'low',
    needles: ['already exists', 'Registration failed'],
    regex: /(Email|Username) already exists|Registration failed/i,
    description: 'Registration attempt failed due to existing credentials',
    recommendation: 'Monitor for automated registration attempts.',
    service: 'system'
  },
  {
    type: 'log_limit_exceeded',
    severity: 'low',
    needles: ['Too many log lines'],
    regex: /Too many log lines.*limiting to/i,
    description: 'Log file exceeds processing limit',
    recommendation: 'Optimize log rotation or increase scan limits.',
    service: 'system'
  }
];

/**
 * Security-scan service built on the MELT port (AD-3, AD-12, AD-19, AD-6).
 *
 * The pipeline runs a single VictoriaLogs LogSQL query that OR-joins
 * the 14 vulnerability needles and classifies every returned row in
 * process via each pattern's canonical `regex`. Each row is bucketed
 * by sha1(timestamp + '|' + service + '|' + message) per AD-19 so a
 * single record contributes to at most one vulnerability bucket.
 *
 * Cache read (`/app/data/security/last-scan-results.json`) is
 * schema-validated by AJV 8.17+ (AD-12) — invalid shape is treated as
 * cache miss.
 */
class SecurityScanService {
  constructor() {
    this._vlClient = null;
    this._ajv = null;
    this._validateCache = null;
    logger.info('SecurityScanService constructor called');
  }

  /**
   * Dependency-injection seam for the MELT client. Idempotent — every
   * call replaces the reference (mirrors the LogsService setter, the
   * AdminDashboardService setter pattern, and the other 6 setter
   * injection blocks in `index.js:1167-1215`).
   *
   * @param {import('../shared-lib/melt').VictoriaLogsClient|null} client
   */
  setVictoriaLogsClient(client) {
    this._vlClient = client;
    logger.debug('SecurityScanService.setVictoriaLogsClient completed');
  }

  /**
   * Lazy constructor for the MELT adapter. Production callers skip the
   * startup health probe (AD-16); test fixtures inject a mock via
   * `setVictoriaLogsClient()` (test isolation is required by Jest).
   */
  _getVlClient() {
    if (this._vlClient) return this._vlClient;
    const melt = require('../shared-lib/melt');
    if (!melt || !melt.VictoriaLogsClient) {
      throw new Error('VictoriaLogsClient is not available on the MELT seam');
    }
    this._vlClient = new melt.VictoriaLogsClient({
      skipHealthProbe: process.env.NODE_ENV === 'test'
    });
    return this._vlClient;
  }

  /**
   * Lazy AJV 8.17+ validator (AD-12). Compiles the `SCAN_CACHE_SCHEMA`
   * strict schema on first access and reuses it on subsequent calls.
   * Returning `null` from `checkCachedResults` on validation failure is
   * the canonical "treat as cache miss" path.
   *
   * @returns {Object} an object exposing `.validateCache(data)` (AJV
   *   `validate` bound to the compiled schema — returns `true`/`false`,
   *   with `.errors` populated when `false`).
   */
  _getAjv() {
    if (!this._ajv) {
      this._ajv = new Ajv({ allErrors: true, strict: false });
    }
    if (!this._validateCache) {
      this._validateCache = this._ajv.compile(SCAN_CACHE_SCHEMA);
    }
    return {
      validateCache: (data) => this._validateCache(data),
      errors: () => this._validateCache.errors
    };
  }

  /**
   * Parse a VL/OTLP retention string (`"30d"`, `"24h"`, `"60m"`,
   * `"90s"`) to milliseconds. Returns `null` for unparseable input
   * (AD-19 keeps the original `30d` format and forbids the legacy
   * `_DAYS` suffix).
   *
   * @param {string|undefined|null} retentionStr
   * @returns {number|null} milliseconds, or `null` if unparseable.
   */
  _parseRetentionToMs(retentionStr) {
    if (!retentionStr || typeof retentionStr !== 'string') return null;
    const match = /^(\d+)\s*([dhms])$/i.exec(retentionStr.trim());
    if (!match) return null;
    const n = parseInt(match[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = match[2].toLowerCase();
    const factor = { d: 86400000, h: 3600000, m: 60000, s: 1000 }[unit];
    return Number.isFinite(factor) ? n * factor : null;
  }

  /**
   * AD-6: a single env `true|1|TRUE|yes` check, used for VL escape
   * hatches (mirrors `components/shared/lib/boolean-env.js` future
   * shared helper — local fallback to avoid coupling until the helper
   * lands in this worktree).
   *
   * @param {string|undefined} value
   * @returns {boolean}
   */
  _isTruthyEnv(value) {
    if (value === undefined || value === null) return false;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  /**
   * Classify a thrown error as a VL outage: matches AD-16's full list
   * (`ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` / `ECONNABORTED` /
   * `ECONNRESET` / 5xx). Used to gate `VL_FAIL_OPEN`.
   *
   * @param {Error & {code?: string, response?: {status?: number}}} err
   * @returns {boolean}
   */
  _isVlUnavailable(err) {
    if (!err) return false;
    const code = err.code;
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'EAI_AGAIN' ||
      code === 'EHOSTUNREACH'
    ) {
      return true;
    }
    const status = err.response && err.response.status;
    if (status !== undefined && status >= 500 && status < 600) return true;
    return false;
  }

  /**
   * Build the LogSQL `q` parameter for the bulk scan: one
   * `_msg:"needle"` per pattern, OR-joined, with a leading `service:*`
   * filter (AD-19). Needles longer than `MAX_NEEDLE_LEN` are skipped to
   * avoid surprising LogSQL tokenisation; backslashes and double-quotes
   * inside needles are escaped.
   *
   * @returns {string} LogSQL `_msg:( ... ) AND service:*` query.
   */
  _buildVlScanQuery() {
    const clauses = [];
    for (const pattern of VULNERABILITY_PATTERNS) {
      for (const rawNeedle of pattern.needles) {
        const needle = String(rawNeedle || '')
          .slice(0, MAX_NEEDLE_LEN)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        if (needle.length === 0) continue;
        clauses.push(`_msg:"${needle}"`);
      }
    }
    if (clauses.length === 0) return '_msg:*';
    return `(${clauses.join(' OR ')}) AND service:*`;
  }

  /**
   * Read the message string from a VL row, accepting both the wire shape
   * (`{_msg: "..."}`) and the adapter-normalized shape (`{message: "..."}`,
   * `VictoriaLogsRow` per AD-3). Returns `''` when no message is present.
   *
   * @param {object} row
   * @returns {string}
   */
  _rowMessage(row) {
    if (!row || typeof row !== 'object') return '';
    if (typeof row.message === 'string') return row.message;
    if (typeof row._msg === 'string') return row._msg;
    return '';
  }

  /**
   * Read the ISO timestamp from a VL row, accepting both wire (`_time`)
   * and normalized (`timestamp`) shapes.
   *
   * @param {object} row
   * @returns {string} ISO 8601 timestamp or `''`.
   */
  _rowTimestamp(row) {
    if (!row || typeof row !== 'object') return '';
    if (typeof row.timestamp === 'string' && row.timestamp.length > 0) return row.timestamp;
    if (typeof row._time === 'string' && row._time.length > 0) return row._time;
    return '';
  }

  /**
   * Read the service name from a VL row, accepting both wire
   * (`_stream.service`) and normalized (`stream.service` / `service`)
   * shapes. Falls back to `'unknown'`.
   *
   * @param {object} row
   * @returns {string}
   */
  _rowService(row) {
    if (!row || typeof row !== 'object') return 'unknown';
    if (row.stream && typeof row.stream === 'object' && typeof row.stream.service === 'string') {
      return row.stream.service;
    }
    if (row._stream && typeof row._stream === 'object' && typeof row._stream.service === 'string') {
      return row._stream.service;
    }
    if (typeof row.service === 'string') return row.service;
    return 'unknown';
  }

  /**
   * Read the log level from a VL row, accepting both wire
   * (`fields.level` / `_stream.level`) and normalized (`level`) shapes.
   * Returns `'INFO'` when no level is present (mirrors `VictoriaLogsAdapter`).
   *
   * @param {object} row
   * @returns {string} uppercase level.
   */
  _rowLevel(row) {
    if (!row || typeof row !== 'object') return 'INFO';
    if (typeof row.level === 'string' && row.level.length > 0) return row.level.toUpperCase();
    if (row.fields && typeof row.fields.level === 'string') return row.fields.level.toUpperCase();
    if (row._stream && typeof row._stream === 'object' && typeof row._stream.level === 'string') {
      return row._stream.level.toUpperCase();
    }
    return 'INFO';
  }

  /**
   * Extract a URL fragment from a log message. First looks for an explicit
   * `http(s)://` URL; falls back to a `(METHOD) /path` pair. Returns
   * `'N/A'` when no URL-shaped substring is found.
   *
   * @param {string} message
   * @returns {string}
   */
  _extractUrl(message) {
    if (typeof message !== 'string' || message.length === 0) return 'N/A';
    const urlMatch = message.match(/https?:\/\/[^\s]+|(GET|POST|PUT|DELETE)\s+([^\s]+)/i);
    if (!urlMatch) return 'N/A';
    return urlMatch[2] || urlMatch[0];
  }

  /**
   * AD-19 dedupe key: 16 hex chars of sha1(timestamp + '|' + service +
   * '|' + message). Accepts both wire (`_time` / `_stream.service` /
   * `_msg`) and normalized (`timestamp` / `stream.service` /
   * `message`) row shapes via the row-helper getters. The `|`
   * separator ensures needle content containing any single character
   * never collides with itself.
   *
   * @param {object} row VL row (wire or normalized).
   * @returns {string} 16-char hex digest prefix.
   */
  _rowBucketKey(row) {
    const time = this._rowTimestamp(row);
    const svc = this._rowService(row);
    const msg = this._rowMessage(row);
    return nodeCrypto.createHash('sha1').update(`${time}|${svc}|${msg}`).digest('hex').slice(0, SHA1_SLICE_LEN);
  }

  /**
   * Map a VL row to the first matching vulnerability pattern
   * (deterministic: patterns are listed in `VULNERABILITY_PATTERNS`
   * in author order). A `null` return means the row matched a needle
   * but no full-regex.
   *
   * @param {object} row VL row (wire or normalized).
   * @returns {object|null} matched pattern or `null`.
   */
  _matchPattern(row) {
    const msg = this._rowMessage(row);
    if (msg.length === 0) return null;
    for (const pattern of VULNERABILITY_PATTERNS) {
      if (pattern.regex.test(msg)) return pattern;
    }
    return null;
  }

  async isGzipValid(file) {
    try {
      await execPromise(`gunzip -t "${file}"`);
      return true;
    } catch (err) {
      logger.warn(`Gzip validation failed for ${file}: ${err.message}`);
      return false;
    }
  }

  async getDescriptorCount() {
    try {
      const { stdout } = await execPromise(`lsof -p ${process.pid} | wc -l`);
      return parseInt(stdout.trim(), 10);
    } catch (err) {
      logger.warn(`Error getting descriptor count: ${err.message}`);
      return 0;
    }
  }

  async closeWinstonTransports() {
    try {
      for (const transport of logger.transports) {
        if (transport.close) {
          await new Promise((resolve) => transport.close(resolve));
        }
      }
    } catch (err) {
      logger.warn(`Error closing Winston transports: ${err.message}`);
    }
  }

  async reopenWinstonTransports() {
    try {
      // Re-initialization logic for winston transports if needed
    } catch (err) {
      logger.warn(`Error reopening Winston transports: ${err.message}`);
    }
  }

  async checkCachedResults() {
    try {
      const scanResultsFile = '/app/data/security/last-scan-results.json';
      const stats = await fsPromises.stat(scanResultsFile);
      const now = DateTime.now();
      const fileTime = DateTime.fromJSDate(stats.mtime);
      if (now.diff(fileTime, 'hours').hours < 1) {
        const data = await fsPromises.readFile(scanResultsFile, 'utf8');
        const parsed = JSON.parse(data);
        const ajv = this._getAjv();
        const ok = ajv.validateCache(parsed);
        if (!ok) {
          logger.warn('Security-scan cache failed AJV schema validation (AD-12); treating as cache miss', {
            errors: ajv.errors()
          });
          return null;
        }
        logger.info('Returning cached security scan results');
        return parsed;
      }
    } catch {
      console.debug('No valid cached results found');
    }
    return null;
  }

  async runSecurityScan(logsService) {
    const startTime = Date.now();
    try {
      logger.info('Running security scan');
      if (!logsService) throw new Error('LogsService is required for security scan');

      const result = await this.processLogsInParallel(logsService);

      const vulnerabilities = result.vulnerabilities || { critical: [], medium: [], low: [] };
      const degraded = result.degraded === true;
      const error = result.error || null;

      const scanResult = {
        scanTime: new Date().toISOString(),
        vulnerabilities: {
          critical: vulnerabilities.critical.length,
          medium: vulnerabilities.medium.length,
          low: vulnerabilities.low.length,
          details: [...vulnerabilities.critical, ...vulnerabilities.medium, ...vulnerabilities.low]
        },
        vulnerabilityDetails: vulnerabilities,
        failedLoginDetails: result.failedLogins || [],
        suspiciousDetails: result.suspiciousActivities || [],
        status: result.skipped ? 'skipped' : 'completed',
        message: result.skipped ? `Security scan skipped: ${result.reason}` : 'Security scan completed successfully',
        skipped: result.skipped === true,
        reason: result.reason || null,
        degraded,
        error
      };

      await this.saveScanResults(scanResult);
      logger.info(`Security scan completed in ${(Date.now() - startTime) / 1000}s`);
      return scanResult;
    } catch (error) {
      logger.error(`Error in runSecurityScan: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // VL bulk query, sha1 bucketing, truncation guard, retention check
  // (AD-19). The 14 patterns' needles are OR-joined into a single
  // LogSQL `_msg:(needle1 OR needle2 OR ...) AND service:*` query; VL
  // returns at most `VL_QUERY_LIMIT` (100 000) rows; truncated response
  // sets `degraded:true`. The 10-day window is capped to
  // `VICTORIALOGS_RETENTION` when retention is shorter (sets
  // `degraded:true`). Each row is bucketed by sha1 of its timestamp +
  // service + message triple so the same record contributes to at
  // most one vulnerability bucket. The same row stream feeds the
  // failed-login and suspicious-activity arrays — duplicates collapsed
  // by `removeDuplicateLogEntries` so each (timestamp, message) pair
  // appears at most once.
  async processLogsInParallel(logsService) {
    if (!logsService) {
      throw new Error('LogsService is required for security scan');
    }
    // AD-6 escape hatch: SECURITY_SCAN_BACKEND=file returns a result that
    // does NOT touch VictoriaLogs (no scan-window, retention, or VL query).
    // Read per-call (not at module load) so the rollback matrix works
    // without a restart.
    if (process.env.SECURITY_SCAN_BACKEND === 'file') {
      const cached = await this.checkCachedResults();
      if (cached) {
        logger.info('SECURITY_SCAN_BACKEND=file; returning cached scan results (no VL query)');
        const vd = cached.vulnerabilityDetails || {};
        const arr = (v) => (Array.isArray(v) ? v : []);
        return {
          vulnerabilities: {
            critical: arr(vd.critical),
            medium: arr(vd.medium),
            low: arr(vd.low)
          },
          failedLogins: Array.isArray(cached.failedLoginDetails) ? cached.failedLoginDetails : [],
          suspiciousActivities: Array.isArray(cached.suspiciousDetails) ? cached.suspiciousDetails : [],
          skipped: false,
          reason: 'file_backend_cache_hit',
          degraded: false,
          error: null
        };
      }
      logger.warn('SECURITY_SCAN_BACKEND=file; no valid cache available, returning skipped result');
      return {
        vulnerabilities: { critical: [], medium: [], low: [] },
        failedLogins: [],
        suspiciousActivities: [],
        skipped: true,
        reason: 'file_backend_no_cache',
        degraded: false,
        error: null
      };
    }

    const startTime = Date.now();
    const today = DateTime.now();
    const scanEnd = today.toISO();
    let scanStart = today.minus({ days: DAYS_TO_PROCESS }).toISO();

    const retentionStr = process.env.VICTORIALOGS_RETENTION;
    const retentionMs = this._parseRetentionToMs(retentionStr);
    const windowMs = DAYS_TO_PROCESS * 86400000;
    let degraded = false;
    if (retentionMs !== null && retentionMs > 0 && retentionMs < windowMs) {
      const cappedStart = new Date(Date.now() - retentionMs).toISOString();
      logger.warn(
        `VICTORIALOGS_RETENTION=${retentionStr} (${retentionMs}ms) is shorter than the ${DAYS_TO_PROCESS}-day scan window; capping scan start to ${cappedStart} and setting degraded:true`
      );
      scanStart = cappedStart;
      degraded = true;
    }

    const q = this._buildVlScanQuery();
    logger.info(
      `Starting VL bulk security scan from ${scanStart} to ${scanEnd}; window=${(
        (Date.now() - startTime) /
        1000
      ).toFixed(1)}s`
    );

    let rows = [];
    let vlError = null;
    try {
      const vlClient = this._getVlClient();
      rows = await vlClient.query({ q, start: scanStart, end: scanEnd, limit: VL_QUERY_LIMIT });
    } catch (err) {
      vlError = err;
    }

    if (vlError) {
      const failOpen = this._isTruthyEnv(process.env.VL_FAIL_OPEN);
      if (failOpen && this._isVlUnavailable(vlError)) {
        logger.warn(
          `VictoriaLogs unreachable in security scan; VL_FAIL_OPEN=true, returning degraded result: ${vlError.message}`
        );
        return {
          vulnerabilities: { critical: [], medium: [], low: [] },
          failedLogins: [],
          suspiciousActivities: [],
          degraded: true,
          error: 'vl_unreachable'
        };
      }
      logger.error(`Error in processLogsInParallel (VL bulk query): ${vlError.message}`, {
        stack: vlError.stack
      });
      throw vlError;
    }

    if (Array.isArray(rows) && rows.length === VL_QUERY_LIMIT) {
      degraded = true;
      logger.warn(
        `VictoriaLogs returned ${VL_QUERY_LIMIT} rows (the query limit); setting degraded:true — possible under-count`
      );
    }

    const FAILED_LOGIN_REGEX = /Invalid credentials|failed login/i;
    const SUSPICIOUS_REGEX = /SQL injection|XSS|CSRF|brute force|command injection|threat detection|ip blocked/i;

    const finalIssueMap = new Map();
    const failedLoginsRaw = [];
    const suspiciousRaw = [];
    for (const row of rows || []) {
      const pattern = this._matchPattern(row);
      const message = this._rowMessage(row);
      const service = this._rowService(row);
      const timestamp = this._rowTimestamp(row) || scanEnd;
      const level = this._rowLevel(row);

      if (pattern) {
        const key = this._rowBucketKey(row);
        if (!key) continue;
        const bucketKey = `${key}_${pattern.type}`;
        if (finalIssueMap.has(bucketKey)) {
          const existing = finalIssueMap.get(bucketKey);
          existing.instanceCount += 1;
          if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
        } else {
          finalIssueMap.set(bucketKey, {
            type: pattern.type,
            severity: pattern.severity,
            description: pattern.description,
            recommendation: pattern.recommendation,
            matchedTerm: pattern.regex.source,
            timestamp,
            service,
            url: this._extractUrl(message),
            firstSeen: timestamp,
            lastSeen: timestamp,
            instanceCount: 1
          });
        }
      }

      if (message.length > 0) {
        if (FAILED_LOGIN_REGEX.test(message)) {
          failedLoginsRaw.push({ timestamp, level, message, service });
        }
        if (SUSPICIOUS_REGEX.test(message)) {
          suspiciousRaw.push({ timestamp, level, message, service });
        }
      }
    }

    const vulnerabilities = { critical: [], medium: [], low: [] };
    for (const issue of finalIssueMap.values()) {
      if (vulnerabilities[issue.severity]) {
        vulnerabilities[issue.severity].push(issue);
      }
    }

    const failedLogins = this.removeDuplicateLogEntries(failedLoginsRaw);
    const suspiciousActivities = this.removeDuplicateLogEntries(suspiciousRaw);

    const result = {
      vulnerabilities,
      failedLogins,
      suspiciousActivities,
      degraded,
      error: null
    };

    logger.debug(
      `VL bulk scan completed; rows=${(rows || []).length} vulnerabilities=${finalIssueMap.size} failedLogins=${failedLogins.length} suspiciousActivities=${suspiciousActivities.length} degraded=${degraded} time=${(
        (Date.now() - startTime) /
        1000
      ).toFixed(1)}s`
    );

    return result;
  }

  async checkLogsForIssues(logsService) {
    logger.info('Legacy checkLogsForIssues called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.vulnerabilityDetails;
    const results = await this.runSecurityScan(logsService);
    return results.vulnerabilityDetails;
  }

  async checkFailedLogins(logsService) {
    logger.info('Legacy checkFailedLogins called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.failedLoginDetails;
    const results = await this.runSecurityScan(logsService);
    return results.failedLoginDetails;
  }

  async checkSuspiciousActivities(logsService) {
    logger.info('Legacy checkSuspiciousActivities called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.suspiciousDetails;
    const results = await this.runSecurityScan(logsService);
    return results.suspiciousDetails;
  }

  deduplicateVulnerabilities(vulnerabilities) {
    const deduplicated = { critical: [], medium: [], low: [] };
    const seen = new Set();
    for (const severity of ['critical', 'medium', 'low']) {
      for (const vuln of vulnerabilities[severity]) {
        const key = `${vuln.type}_${vuln.service}_${vuln.matchedTerm}_${vuln.timestamp}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated[severity].push(vuln);
        }
      }
    }
    return deduplicated;
  }

  parseLogLine(line, file, lineNumber, invalidLogStream) {
    function extractUrl(message) {
      const urlMatch = message.match(/https?:\/\/[^\s]+|(GET|POST|PUT|DELETE)\s+([^\s]+)/i);
      return urlMatch ? urlMatch[2] || urlMatch[0] : 'N/A';
    }
    const standardMatch = line.match(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+([^\s]+(?:\s+[^\s]+)*)\s+(.+)$/
    );
    if (standardMatch) {
      const [, date, time, level, service, message] = standardMatch;
      const timestamp = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
      if (!timestamp.isValid) {
        if (invalidLogStream)
          invalidLogStream.write(
            `[${DateTime.now().toISO()}] Invalid timestamp in ${file} at line ${lineNumber}: ${line}\n`
          );
        return null;
      }
      return { timestamp: timestamp.toISO(), level, service, message, url: extractUrl(message) };
    }
    try {
      const jsonLog = JSON.parse(line);
      if (jsonLog.timestamp && jsonLog.level && jsonLog.message) {
        const timestamp = DateTime.fromISO(jsonLog.timestamp, { zone: 'utc' });
        if (!timestamp.isValid) {
          if (invalidLogStream)
            invalidLogStream.write(
              `[${DateTime.now().toISO()}] Invalid JSON timestamp in ${file} at line ${lineNumber}: ${line}\n`
            );
          return null;
        }
        return {
          timestamp: timestamp.toISO(),
          level: jsonLog.level.toUpperCase(),
          service: jsonLog.service || 'unknown',
          message: jsonLog.message,
          url: jsonLog.url || extractUrl(jsonLog.message)
        };
      }
    } catch {
      // Ignore parsing errors for non-standard log formats
    }
    const fallbackMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+)$/);
    if (fallbackMatch) {
      const [, datetime, message] = fallbackMatch;
      const timestamp = DateTime.fromFormat(datetime, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
      if (!timestamp.isValid) {
        if (invalidLogStream)
          invalidLogStream.write(
            `[${DateTime.now().toISO()}] Invalid fallback timestamp in ${file} at line ${lineNumber}: ${line}\n`
          );
        return null;
      }
      return { timestamp: timestamp.toISO(), level: 'UNKNOWN', service: 'unknown', message, url: extractUrl(message) };
    }
    if (invalidLogStream)
      invalidLogStream.write(
        `[${DateTime.now().toISO()}] Unrecognized log format in ${file} at line ${lineNumber}: ${line}\n`
      );
    return null;
  }

  async getLastScanDetails() {
    try {
      console.log('Fetching last scan details');
      const scanResultsFile = '/app/data/security/last-scan-results.json';
      let scanDetails = {
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: []
      };

      try {
        const data = await fsPromises.readFile(scanResultsFile, 'utf8');
        scanDetails = JSON.parse(data);
      } catch (error) {
        logger.warn(`No previous scan results found: ${error.message}`);
      }

      return scanDetails;
    } catch (error) {
      logger.error(`Error in getLastScanDetails: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  async scanForVulnerabilities() {
    const vulnerabilities = { critical: [], medium: [], low: [] };
    try {
      console.log('Starting HTTP header vulnerability scan');
      const response = await axios.get('http://localhost:3000', { validateStatus: () => true });
      const headers = response.headers;
      const headerChecks = [
        {
          header: 'content-security-policy',
          type: 'missing_csp',
          severity: 'medium',
          description: 'Missing Content-Security-Policy header',
          recommendation: 'Implement a strict CSP to prevent XSS attacks.'
        },
        {
          header: 'strict-transport-security',
          type: 'missing_hsts',
          severity: 'medium',
          description: 'Missing Strict-Transport-Security header',
          recommendation: 'Enable HSTS to enforce HTTPS.'
        },
        {
          header: 'x-frame-options',
          type: 'missing_frame_options',
          severity: 'medium',
          description: 'Missing X-Frame-Options header',
          recommendation: 'Set X-Frame-Options to prevent clickjacking.'
        }
      ];

      const now = DateTime.now().toISO();
      headerChecks.forEach((check) => {
        if (!headers[check.header]) {
          vulnerabilities[check.severity].push({
            type: check.type,
            severity: check.severity,
            description: check.description,
            recommendation: check.recommendation,
            matchedTerm: check.header,
            timestamp: now,
            service: 'http',
            lineNumber: 0,
            url: 'http://localhost:3000',
            firstSeen: now,
            lastSeen: now,
            instanceCount: 1,
            lineNumbers: [0]
          });
        }
      });

      console.log(
        `Detected header vulnerabilities: Critical=${vulnerabilities.critical.length}, Medium=${vulnerabilities.medium.length}, Low=${vulnerabilities.low.length}`
      );
      return vulnerabilities;
    } catch (error) {
      logger.error(`Error in scanForVulnerabilities: ${error.message}`, { stack: error.stack });
      return vulnerabilities;
    }
  }

  async checkSecurityHeaders() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios.get(fullUrl);
      const headers = response.headers;
      const missingHeaders = [];

      if (!headers['content-security-policy'])
        missingHeaders.push({
          type: 'content_security_policy_header_missing',
          severity: 'medium',
          description: 'CSP header not set, increasing risk of XSS attacks',
          recommendation: 'Implement CSP header with appropriate directives'
        });

      if (!headers['strict-transport-security'])
        missingHeaders.push({
          type: 'strict_transport_security_header_missing',
          severity: 'medium',
          description: 'HSTS header not set, increasing risk of protocol downgrade attacks',
          recommendation: 'Add Strict-Transport-Security header with appropriate max-age'
        });

      if (!headers['x-content-type-options'])
        missingHeaders.push({
          type: 'x_content_type_options_header_missing',
          severity: 'medium',
          description: 'X-Content-Type-Options header not set, increasing risk of MIME type confusion attacks',
          recommendation: 'Add X-Content-Type-Options: nosniff header'
        });

      if (!headers['x-frame-options'])
        missingHeaders.push({
          type: 'x_frame_options_header_missing',
          severity: 'medium',
          description: 'X-Frame-Options header not set, increasing risk of clickjacking attacks',
          recommendation: 'Add X-Frame-Options: SAMEORIGIN header'
        });

      if (!headers['referrer-policy'])
        missingHeaders.push({
          type: 'referrer_policy_header_missing',
          severity: 'low',
          description: 'Referrer-Policy header not set, potentially leaking referrer information',
          recommendation: 'Add Referrer-Policy: no-referrer-when-downgrade header'
        });

      console.debug(`Missing headers found: ${missingHeaders.length}`);
      return missingHeaders;
    } catch (error) {
      logger.error(`Error checking security headers: ${error.message}`);
      return [];
    }
  }

  async checkServerLeakage() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios.get(fullUrl);
      const headers = response.headers;
      const leakageIssues = [];

      if (headers['x-powered-by'])
        leakageIssues.push({
          type: 'server_leaks_x_powered_by',
          severity: 'medium',
          description: `X-Powered-By header reveals server technology: ${headers['x-powered-by']}`,
          recommendation: 'Remove X-Powered-By header in server configuration'
        });

      if (headers['server'] && headers['server'].includes('/'))
        leakageIssues.push({
          type: 'server_leaks_version',
          severity: 'medium',
          description: `Server header reveals version information: ${headers['server']}`,
          recommendation: 'Configure server to remove version information from Server header'
        });

      console.debug(`Server leakage issues found: ${leakageIssues.length}`);
      return leakageIssues;
    } catch (error) {
      logger.error(`Error checking server information leakage: ${error.message}`);
      return [];
    }
  }

  async checkTimestampDisclosure() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpointsToCheck = config.api.endpoints || ['/api/users', '/api/logs', '/api/status'];
      const disclosureIssues = [];

      for (const endpoint of endpointsToCheck) {
        try {
          const response = await axios.get(`${apiUrl}${endpoint}`);
          const responseText = JSON.stringify(response.data);
          const timestampRegex = /\b\d{10}\b/g;
          const matches = responseText.match(timestampRegex);
          if (matches && matches.length > 0) {
            disclosureIssues.push({
              type: 'timestamp_disclosure',
              severity: 'medium',
              description: `Unix timestamps exposed in ${endpoint} response`,
              count: matches.length,
              recommendation: 'Format timestamps as ISO strings or human-readable dates before sending to client'
            });
          }
        } catch (err) {
          console.debug(`Skipping timestamp check for ${endpoint}: ${err.message}`);
          continue;
        }
      }

      console.debug(`Timestamp disclosure issues found: ${disclosureIssues.length}`);
      return disclosureIssues;
    } catch (error) {
      logger.error(`Error checking timestamp disclosure: ${error.message}`);
      return [];
    }
  }

  async checkCorsConfiguration() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios({
        method: 'options',
        url: fullUrl,
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      const headers = response.headers;
      const corsIssues = [];

      if (headers['access-control-allow-origin'] === '*') {
        corsIssues.push({
          type: 'cross_domain_misconfiguration',
          severity: 'medium',
          description: 'CORS allows requests from any origin (*)',
          recommendation: 'Configure CORS to allow only specific trusted domains'
        });
      }

      console.debug(`CORS issues found: ${corsIssues.length}`);
      return corsIssues;
    } catch (error) {
      logger.error(`Error checking CORS configuration: ${error.message}`);
      return [];
    }
  }

  async checkHiddenFiles() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const hiddenFiles = [
        '/.env',
        '/.git/config',
        '/.gitignore',
        '/.npmrc',
        '/node_modules/.package-lock.json',
        '/.well-known/security.txt',
        '/.well-known/appspecific/com.chrome.devtools.json'
      ];
      const foundFiles = [];

      for (const file of hiddenFiles) {
        try {
          const response = await axios.get(`${apiUrl}${file}`);
          if (response.status !== 404) {
            foundFiles.push({
              type: 'hidden_file_found',
              severity: 'medium',
              description: `Hidden file accessible: ${file}`,
              recommendation: 'Block access to hidden files and development artifacts'
            });
          }
        } catch (err) {
          if (err.response && err.response.status !== 404) {
            foundFiles.push({
              type: 'potential_hidden_file',
              severity: 'low',
              description: `Unusual response for hidden file: ${file} (${err.response?.status})`,
              recommendation: 'Verify server configuration for handling hidden files'
            });
          }
        }
      }

      console.debug(`Hidden file issues found: ${foundFiles.length}`);
      return foundFiles;
    } catch (error) {
      logger.error(`Error checking hidden files: ${error.message}`);
      return [];
    }
  }

  removeDuplicateLogEntries(logEntries) {
    const seen = new Set();
    logEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return logEntries.filter((entry) => {
      const key = `${entry.timestamp}|${entry.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async loginIssues(logsService) {
    if (!logsService) throw new Error('LogsService is required for loginIssues');
    try {
      const loginKeywords = [
        'login',
        'failed',
        'unauthorized',
        'disabled',
        'expired',
        'invalid',
        'access denied',
        'account'
      ];
      const suspiciousKeywords = [
        'suspicious',
        'brute force',
        'injection',
        'attack',
        'breach',
        'security',
        'vulnerability',
        'exploit',
        'ip blocked',
        'threat detection'
      ];
      const allKeywords = [...new Set([...loginKeywords, ...suspiciousKeywords])];
      console.debug(`Checking logs with keywords: ${allKeywords.join(', ')}`);

      const loginIssues = [];
      const suspiciousIssues = [];

      const today = new Date();
      const daysAgo = new Date(today);
      daysAgo.setDate(today.getDate() - DAYS_TO_PROCESS);

      try {
        const results = await logsService.searchLogs({
          term: allKeywords.join('|'),
          dateRange: 'custom',
          startDate: daysAgo.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
          includeArchived: true
        });
        console.debug(`Found ${results.logs?.length || 0} logs matching keywords`);

        if (results.logs && results.logs.length > 0) {
          for (const log of results.logs) {
            const messageLower = log.message.toLowerCase();
            const timestamp = `${log.date} ${log.time}`;
            const loginMatch = loginKeywords.find((keyword) => messageLower.includes(keyword.toLowerCase()));
            const suspiciousMatch = suspiciousKeywords.find((keyword) => messageLower.includes(keyword.toLowerCase()));

            if (loginMatch) {
              loginIssues.push({
                timestamp,
                level: log.level,
                message: log.message,
                service: log.service,
                type: 'authentication_issue',
                matchedTerm: loginMatch
              });
            }

            if (suspiciousMatch && !loginMatch) {
              suspiciousIssues.push({
                timestamp,
                level: log.level,
                message: log.message,
                service: log.service,
                type: 'suspicious',
                matchedTerm: suspiciousMatch
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Error searching logs: ${error.message}`, { stack: error.stack });
      }

      const uniqueLoginIssues = this.removeDuplicateLogEntries(loginIssues);
      const uniqueSuspiciousIssues = this.removeDuplicateLogEntries(suspiciousIssues);

      return {
        loginIssues: { count: uniqueLoginIssues.length, details: uniqueLoginIssues },
        suspiciousActivities: { count: uniqueSuspiciousIssues.length, details: uniqueSuspiciousIssues }
      };
    } catch (error) {
      logger.error(`Error checking logs: ${error.message}`, { stack: error.stack });
      return {
        loginIssues: { count: 0, details: [] },
        suspiciousActivities: { count: 0, details: [] }
      };
    }
  }

  generateRecommendations(loginIssues, suspiciousActivities, vulnerabilities) {
    const recommendations = [];

    if (loginIssues.count > 0) {
      const disabledAccountCount = loginIssues.details.filter((issue) => issue.message.includes('disabled')).length;
      if (disabledAccountCount > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Review Disabled Accounts',
          description: `${disabledAccountCount} login attempts to disabled accounts detected`,
          action: 'Review account status in user management and verify if account disabling is legitimate'
        });
      }
      recommendations.push({
        severity: 'medium',
        title: 'Improve Authentication Security',
        description: `${loginIssues.count} authentication issues detected`,
        action: 'Consider implementing account lockout policies and multi-factor authentication'
      });
    }

    if (vulnerabilities.critical.length > 0) {
      recommendations.push({
        severity: 'critical',
        title: 'Fix Critical Server Errors',
        description: `${vulnerabilities.critical.length} critical server errors detected`,
        action:
          'Investigate and fix server errors immediately to prevent service disruption and potential security breaches'
      });
    }

    if (vulnerabilities.medium.length > 0) {
      const sensitiveFileAccess = vulnerabilities.medium.filter((v) => v.type === 'sensitive_file_access');
      if (sensitiveFileAccess.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Secure Sensitive File Access',
          description: `${sensitiveFileAccess.length} attempts to access sensitive files detected`,
          action:
            'Ensure .env, .git, and other sensitive files are not exposed; implement stricter access controls and consider IP blocking for repeated attempts'
        });
      }

      const dbIssues = vulnerabilities.medium.filter((v) => v.type.includes('database') || v.type === 'db_error');
      if (dbIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Resolve Database Issues',
          description: `${dbIssues.length} database-related issues detected`,
          action: 'Review database configuration, connections, and query handling'
        });
      }

      const jwtIssues = vulnerabilities.medium.filter((v) => v.type.includes('jwt') || v.type === 'token_issue');
      if (jwtIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix Authentication Token Issues',
          description: 'JWT token verification failures detected',
          action: 'Review token expiration settings and refresh token implementation'
        });
      }

      const headerIssues = vulnerabilities.medium.filter((v) => v.type.includes('header'));
      if (headerIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Implement Security Headers',
          description: `${headerIssues.length} missing security headers detected`,
          action: 'Configure server to add proper security headers for all responses'
        });
      }

      const leakageIssues = vulnerabilities.medium.filter(
        (v) => v.type.includes('leaks') || v.type.includes('disclosure')
      );
      if (leakageIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Prevent Information Leakage',
          description: `${leakageIssues.length} instances of information leakage detected`,
          action: 'Configure server to prevent leaking version information and hide internal details'
        });
      }

      const corsIssues = vulnerabilities.medium.filter((v) => v.type.includes('cross_domain'));
      if (corsIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix CORS Configuration',
          description: 'Cross-Origin Resource Sharing (CORS) is too permissive',
          action: 'Restrict CORS to only allow trusted domains instead of wildcard (*) origin'
        });
      }

      const ipBlockedIssues = vulnerabilities.medium.filter((v) => v.type === 'ip_blocked');
      if (ipBlockedIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Review IP Blocking Events',
          description: `${ipBlockedIssues.length} IP blocking events detected`,
          action: 'Investigate blocked IPs for malicious activity and review rate limiting policies'
        });
      }

      const authFailureIssues = vulnerabilities.medium.filter((v) => v.type === 'auth_failure_401');
      if (authFailureIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Address Unauthorized Access Attempts',
          description: `${authFailureIssues.length} 401 unauthorized access attempts detected`,
          action: 'Enhance authentication mechanisms and monitor for brute force attacks'
        });
      }
    }

    if (vulnerabilities.low.length > 0) {
      const nonCriticalFileAccess = vulnerabilities.low.filter((v) => v.type === 'non_critical_file_access');
      if (nonCriticalFileAccess.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Review Non-Critical File Access',
          description: `${nonCriticalFileAccess.length} attempts to access non-critical configuration files detected`,
          action: 'Verify if these files need to be publicly accessible or should be blocked'
        });
      }

      const missingResources = vulnerabilities.low.filter(
        (v) => v.type === 'missing_resource' || v.type === 'not_found_404'
      );
      if (missingResources.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Fix Missing Resources',
          description: `${missingResources.length} endpoints returning 404 errors`,
          action: 'Update application to remove references to non-existent endpoints or implement the missing resources'
        });
      }

      const registrationIssues = vulnerabilities.low.filter((v) => v.type === 'registration_failure');
      if (registrationIssues.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Monitor Registration Attempts',
          description: `${registrationIssues.length} failed registration attempts detected`,
          action: 'Implement CAPTCHA or rate limiting to prevent automated registration abuse'
        });
      }

      const logLimitIssues = vulnerabilities.low.filter((v) => v.type === 'log_limit_exceeded');
      if (logLimitIssues.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Optimize Log Processing',
          description: `${logLimitIssues.length} log files exceeded processing limits`,
          action: 'Adjust log rotation policies or increase scan capacity'
        });
      }
    }

    recommendations.push({
      severity: 'low',
      title: 'Regular Security Maintenance',
      description: 'Proactive security measures',
      action: 'Implement regular security audits, keep dependencies updated, and consider penetration testing'
    });

    console.debug(`Generated recommendations: ${recommendations.length}`);
    return recommendations;
  }

  async saveScanResults(results) {
    logger.info('*** SAVE_SCAN_RESULTS_START ***');
    try {
      const dataDir = '/app/data/security';
      const resultsPath = path.join(dataDir, 'last-scan-results.json');
      console.log(`Saving scan results to directory: ${dataDir}, file: ${resultsPath}`);
      await fsPromises.mkdir(dataDir, { recursive: true });
      await fsPromises.writeFile(resultsPath, JSON.stringify(results, null, 2), { mode: 0o666 });
      logger.info(`Security scan results saved successfully to ${resultsPath}`);
    } catch (error) {
      logger.error(`Error saving scan results: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

const securityScanService = new SecurityScanService();
module.exports = securityScanService;
module.exports.SecurityScanService = SecurityScanService;
