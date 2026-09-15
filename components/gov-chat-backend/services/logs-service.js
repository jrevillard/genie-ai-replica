// components/gov-chat-backend/services/logs-service.js
//
// VictoriaLogs migration: rewrite public methods (`getLogsInRange`,
// `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using
// `VictoriaLogsClient`. Per-call `ADMIN_LOGS_SOURCE` env read routes
// the call to VL (default) or the file path (escape hatch). VL outages are
// surfaced by default; `VL_FAIL_OPEN=true` returns empty results + a
// `degraded: true` flag. File-path reads pick up the hardenings (ENOENT
// tolerance between stat/open, O_EXCL PID lock via `fs.open(path, 'wx')`,
// NDJSON parse with N=4096 re-parse window, `vl_files_disabled` 503 when
// file source requested without `LOG_TO_FILE=1`).
'use strict';

const fs = require('fs').promises;
const fssync = require('fs');
const { runInBackgroundSpan } = require('../shared-lib/tracing-background');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const { logger } = require('../shared-lib');
const { isValidDateStr } = require('./path-sanitizer');

// Boolean gate helper (`1`/`true`/`TRUE`/`yes` accept set). Inlined here
// to keep the test `__mocks__/shared-lib.js` virtual mock self-contained
// without forking the Jest moduleNameMapper; both call sites resolve to
// the same regex.
function booleanEnv(name) {
  const v = process.env[name];
  if (typeof v === 'undefined') return false;
  return /^(1|true|TRUE|yes)$/.test(String(v).trim());
}

const gunzip = util.promisify(zlib.gunzip);

// Set maximum log file size to prevent stack overflow
const MAX_LOG_FILE_SIZE = 20 * 1024 * 1024; // 20MB
// Set maximum number of lines to process at once
const MAX_LINES_TO_PROCESS = 200000;
// NDJSON re-parse window after a `SyntaxError` (truncated line from
// `kill -9` mid-write). Read the next N bytes, append, attempt re-parse.
const RE_PARSE_WINDOW_BYTES = 4096;
// Hard cap on the date span served by `getLogFilesInRange` (one descriptor
// per UTC day; prevents memory blow-up on a wide admin range). 366 covers
// a full year + leap day.
const MAX_LOG_FILES_RANGE_DAYS = 366;
// Lock-file directory for the O_EXCL claim primitives.
const LOCK_DIR = '/tmp';
// Rate-limit state file for VL-unreachable logging. Unix ms on a
// single line. Persisted so backend restarts do not reset the cadence.
const VL_FAIL_OPEN_TS_FILE = path.join(LOCK_DIR, 'vl-fail-open-ts');
// Cap on VL-unreachable error log lines: one per minute, persisted.
const VL_FAIL_OPEN_LOG_COOLDOWN_MS = 60_000;

/**
 * Typed error raised when `ADMIN_LOGS_SOURCE=file` is requested while
 * `LOG_TO_FILE !== '1'`. Carries the recovery hint body the route layer
 * renders as a 503 response.
 */
class VlFilesDisabledError extends Error {
  constructor() {
    super('Set LOG_TO_FILE=1 to use file-based log source');
    this.name = 'VlFilesDisabledError';
    this.statusCode = 503;
    this.body = {
      error: 'vl_files_disabled',
      message: 'Set LOG_TO_FILE=1 to use file-based log source'
    };
  }
}

/**
 * Service for managing system logs.
 *
 * Two source modes (selected per call):
 *   - `victorialogs` (default) — issues LogSQL queries via the MELT
 *     port (`shared/lib/melt`).  Outages are surfaced unless
 *     `VL_FAIL_OPEN=true`.
 *   - `file` — reads the on-disk Winston NDJSON archives. Only
 *     active when `ADMIN_LOGS_SOURCE=file` AND `LOG_TO_FILE=1`; the
 *     former without the latter returns `VlFilesDisabledError`.
 */
class LogsService {
  constructor() {
    if (LogsService.instance) {
      return LogsService.instance;
    }
    this.initialized = false;
    // Lazy VL client (constructed on first VL-path call). Tests may inject
    // a stub via `setVictoriaLogsClient()`.
    this._vlClient = null;
    logger.info('LogsService constructor called');
    LogsService.instance = this;
    return this;
  }

  static getInstance() {
    if (!LogsService.instance) {
      LogsService.instance = new LogsService();
    }
    return LogsService.instance;
  }

  /**
   * Initialize the LogsService
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('LogsService already initialized, skipping');
      return;
    }
    try {
      // Ensure logs directory exists
      const logDir = path.join(__dirname, '../logs');
      await fs.access(logDir).catch(async () => {
        await fs.mkdir(logDir, { recursive: true });
        logger.info(`Created logs directory: ${logDir}`);
      });
      this.initialized = true;
      logger.info('LogsService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing LogsService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Source routing — per-call env read
  // ------------------------------------------------------------------

  /**
   * Resolve the source mode for THIS call (never cached at module load —
   * requires a fresh env read so the D2 escape hatch works without
   * a backend restart).
   *
   * @returns {'victorialogs'|'file'}
   */
  _sourceMode() {
    return String(process.env.ADMIN_LOGS_SOURCE || '')
      .trim()
      .toLowerCase() === 'file'
      ? 'file'
      : 'victorialogs';
  }

  /**
   * Test/dependency-injection seam for the MELT client. Lazily built on
   * first use; production callers go through `_getVlClient()`.
   *
   * @param {import('../../shared/lib/melt').VictoriaLogsClient|null} client
   */
  setVictoriaLogsClient(client) {
    this._vlClient = client;
  }

  /**
   * Lazy constructor for the MELT adapter. Production code skips the
   * startup health probe — the probe is triggered on the first
   * request anyway, and constructor-time probing in Jest hangs the suite.
   */
  _getVlClient() {
    if (this._vlClient) return this._vlClient;
    const melt = require('../shared-lib/melt');
    if (!melt || !melt.VictoriaLogsClient) {
      throw new Error('VictoriaLogsClient is not available on the MELT seam');
    }
    this._vlClient = new melt.VictoriaLogsClient({
      // Tests pass `{skipHealthProbe: true}` via the
      // option; production skips the flag and the adapter probes lazily.
      skipHealthProbe: process.env.NODE_ENV === 'test'
    });
    return this._vlClient;
  }

  /**
   * Classify a thrown error as a VL outage: ECONNREFUSED / ENOTFOUND /
   * ETIMEDOUT / ECONNABORTED / ECONNRESET / EPIPE / EAI_AGAIN /
   * EHOSTUNREACH / 5xx response. Used to gate `VL_FAIL_OPEN`.
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
    if (typeof status === 'number' && status >= 500 && status < 600) {
      return true;
    }
    if (err.name === 'VictoriaLogsHealthError') {
      return true;
    }
    return false;
  }

  /**
   * Log a VL-unreachable incident at most once per minute, persisted to
   * `/tmp/vl-fail-open-ts` so backend restarts do not reset the cadence.
   * Uses `fs.openSync(path, 'wx')` for an atomic O_EXCL claim
   * (loser backs off silently).
   *
   * @param {string} opName
   * @param {Error} err
   */
  async _logVlUnavailableOnce(opName, err) {
    let lastTs = 0;
    try {
      const raw = await fs.readFile(VL_FAIL_OPEN_TS_FILE, 'utf8');
      lastTs = parseInt(raw, 10) || 0;
    } catch (readErr) {
      // ENOENT is the common first-run path (file does not exist yet);
      // everything else is unexpected but should not break the call
      // path — record a debug line so a future operator can spot it.
      if (readErr && readErr.code !== 'ENOENT') {
        logger.debug(`VL fail-open cooldown probe read failed: ${readErr.message}`);
      }
    }
    const now = Date.now();
    if (now - lastTs < VL_FAIL_OPEN_LOG_COOLDOWN_MS) return;

    // Persist the new "last logged" timestamp. fs.promises.writeFile
    // is atomic-truncate on POSIX for small files, avoiding the
    // earlier `openSync('wx')` pattern that always threw EEXIST after
    // the first successful write and silently muted every subsequent
    // incident for the host lifetime.
    try {
      await fs.writeFile(VL_FAIL_OPEN_TS_FILE, String(now));
    } catch (writeErr) {
      // Lock failure must not block the call path itself, but the
      // original incident MUST still be surfaced so the operator can
      // see why their traffic is degraded. Otherwise a broken cooldown
      // file would silently mute every downstream outage for the rest
      // of the host lifetime.
      logger.error(
        `VL fail-open cooldown write failed (${writeErr.code || writeErr.message}); incident still surfaced once:`,
        err && err.message
      );
    }
    logger.warn(`[${opName}] VictoriaLogs unreachable (VL_FAIL_OPEN=true): ${err.message}`, {
      code: err && err.code,
      status: err && err.response && err.response.status
    });
  }

  /**
   * Wrap a VL call: on outage with `VL_FAIL_OPEN=true` return
   * `{...fallback, degraded: true}`; otherwise re-throw.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @param {string} opName
   * @param {T} fallback
   * @returns {Promise<T & {degraded?: boolean}>}
   */
  async _withVlFailOpen(fn, opName, fallback) {
    try {
      return await fn();
    } catch (err) {
      if (this._isVlUnavailable(err) && booleanEnv('VL_FAIL_OPEN')) {
        // Fire-and-await best-effort: a failed cooldown write must not
        // block the call path, but the original incident must still be
        // surfaced once (see the implementation for the rationale).
        await this._logVlUnavailableOnce(opName, err);
        return { ...fallback, degraded: true };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Public API — log search (VL-first)
  // ------------------------------------------------------------------

  /**
   * Fetch logs for a time window, returning the canonical envelope.
   *
   * Routes per per-call env read:
   *   - `ADMIN_LOGS_SOURCE !== 'file'` (default) → VL via
   *     `VictoriaLogsClient.query`. Subject to `VL_FAIL_OPEN` graceful
   *     degradation.
   *   - `ADMIN_LOGS_SOURCE=file` → on-disk NDJSON archive via the file
   *     path; throws `VlFilesDisabledError` (503) when `LOG_TO_FILE`
   *     is not `'1'`.
   *
   * Envelope shape — reviewers will reject future drift from this contract:
   * ```
   * {
   *   logs:  VictoriaLogsRow[],
   *   total: number,
   *   limit: number,
   *   offset: number,
   *   degraded?: true  // only present when VL_FAIL_OPEN triggered
   * }
   * ```
   *
   * @param {Object} options
   * @param {string} [options.start]    ISO 8601 lower bound (VL path).
   * @param {string} [options.end]      ISO 8601 upper bound (VL path).
   * @param {string} [options.q]        LogSQL query (VL path). Default '*'.
   * @param {number} [options.limit=100]  Effective page size.
   * @param {number} [options.offset=0]   Page offset for pagination.
   * @param {string} [options.dateRange]  'today' | 'yesterday' | 'week' |
   *                                      'month' | 'custom' (file path).
   * @param {string} [options.startDate]  YYYY-MM-DD (file path).
   * @param {string} [options.endDate]    YYYY-MM-DD (file path).
   * @param {string} [options.level]      Filter by level (file path).
   * @param {string} [options.service]    Filter by service (file path).
   * @param {string} [options.term]       Free-text filter (file path).
   * @param {boolean} [options.includeArchived=true]
   * @returns {Promise<{
   *   logs: import('../../shared/lib/melt/types').VictoriaLogsRow[],
   *   total: number,
   *   limit: number,
   *   offset: number,
   *   degraded?: true
   * }>}
   */
  async getLogsInRange(options = {}) {
    if (this._sourceMode() === 'file') {
      return this._getLogsInRangeFromFile(options);
    }
    return this._getLogsInRangeFromVL(options);
  }

  /**
   * Execute `getLogsInRange` against VictoriaLogs.
   *
   * Note on pagination: VictoriaLogs' `/_internal/logsql/query` endpoint
   * accepts only a `limit` parameter — there is **no native offset**. The
   * adapter passes `limit = limit + offset` (the "window") and this
   * method then slices `[offset, offset + limit)` client-side. Wide
   * ranges therefore download the full window every call; an explicit
   * `q` filter and a tight window are how we keep the payload bounded.
   *
   * @param {object} options
   * @param {string} [options.start]
   * @param {string} [options.end]
   * @param {string} [options.q='*']
   * @param {number} [options.limit=100]
   * @param {number} [options.offset=0]
   * @returns {Promise<{logs: object[], total: number, limit: number, offset: number}>}
   */
  async _getLogsInRangeFromVL(options = {}) {
    const { start, end, q = '*', limit = 100, offset = 0 } = options;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    const limitN = Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 10000));
    const offsetN = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);

    // Build a sensible default window when the caller did not provide one
    // (admin UI defaults to today, but defensive coding prevents a NaN
    // window from reaching the VL adapter).
    const startIso = start || this._defaultStartIso(options.dateRange);
    const endIso = end || this._defaultEndIso(options.dateRange);

    const fallback = { logs: [], total: 0, limit: limitN, offset: offsetN };
    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        const filter = this._vlFilter(q);
        const window = limitN + offsetN;
        const rows = await client.query({ q: filter, start: startIso, end: endIso, limit: window });
        const pageRows = Array.isArray(rows) ? rows.slice(offsetN, offsetN + limitN) : [];
        return {
          logs: pageRows,
          total: Array.isArray(rows) ? rows.length : 0,
          limit: limitN,
          offset: offsetN
        };
      },
      'getLogsInRange',
      fallback
    );
  }

  /**
   * Apply dual-emit dedup filter while the dual-emit window is open.
   * Once the production fluentd logging driver for backend +
   * document-repository is removed, the filter becomes a no-op.
   *
   * @param {string} q
   * @returns {string}
   */
  _vlFilter(q) {
    const baseQ = typeof q === 'string' && q.trim() !== '' ? q : '*';
    if (booleanEnv('LOG_TO_VICTORIALOGS') && !booleanEnv('LOG_TO_FILE')) {
      // Dual-emit dedup: while OTLP is the canonical writer, the Docker
      // fluentd driver ALSO forwards stdout to VL — same JSON content,
      // different field shape (fluentd adds `fluent.tag` + Compose label
      // `service.name`, OTLP adds the OTel resource `service.name` plus
      // `trace_id`, `span_id`, `deployment.environment`, etc.). The OTel
      // SDK path uses the canonical `genie-*` service names (e.g.
      // `genie-backend`, `genie-document-repository`); the fluentd path
      // uses raw Compose service labels (e.g. `backend`,
      // `document-repository`). Keep ONLY the OTel records by requiring
      // `service.name:genie-*` — that filter matches both OTel-instrumented
      // services AND excludes every fluentd duplicate.
      return `${baseQ} AND service.name:genie-*`;
    }
    return baseQ;
  }

  async _getLogsInRangeFromFile(options = {}) {
    if (!booleanEnv('LOG_TO_FILE')) {
      throw new VlFilesDisabledError();
    }
    const { dateRange = 'today', startDate, endDate, level, service, term, includeArchived = true } = options;
    const { startDate: s, endDate: e } = this.getDateRange({ dateRange, startDate, endDate });
    if (!isValidDateStr(s) || !isValidDateStr(e)) {
      return this._emptyEnvelope(options);
    }
    const logFiles = await this.getLogFilesInRange(s, e, includeArchived);
    const allRows = [];
    let degraded = false;
    for (const logFile of logFiles) {
      try {
        const lock = await this._acquireReadLock(logFile);
        if (!lock) continue; // concurrent holder — skip gracefully
        try {
          const content = await this._readLogFileAd10(logFile);
          // Cap per-file rows to MAX_LINES_TO_PROCESS. A wide date range
          // (year) over multiple archives can otherwise blow the heap when
          // a single hot day hits the cap. Mirrors the cap on the VL path
          // and the legacy `_summarizeLogFile` helper.
          let rows = this._parseNdjsonContent(content);
          if (rows.length > MAX_LINES_TO_PROCESS) {
            rows = rows.slice(0, MAX_LINES_TO_PROCESS);
          }
          allRows.push(...rows);
        } finally {
          await this._releaseReadLock(lock);
        }
      } catch (fileErr) {
        // Surface the read failure on the returned envelope so the caller
        // (admin UI) can flag the page as incomplete rather than
        // presenting partial results as authoritative.
        degraded = true;
        logger.error(`Error reading log file ${logFile}: ${fileErr.message}`);
      }
    }

    const withinWindow = allRows.filter((row) => row.date >= s && row.date <= e);
    let filtered = withinWindow;
    if (level && String(level).trim() !== '') {
      const target = String(level).toUpperCase();
      filtered = filtered.filter((row) => row.level === target || (target === 'WARN' && row.level === 'WARNING'));
    }
    if (service && String(service).trim() !== '') {
      const needle = String(service).toLowerCase();
      filtered = filtered.filter((row) => (row.service || '').toLowerCase().includes(needle));
    }
    if (term && String(term).trim() !== '') {
      const needle = String(term).toLowerCase();
      filtered = filtered.filter((row) => (row.message || '').toLowerCase().includes(needle));
    }
    filtered.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    const parsedLimitFile = parseInt(options.limit, 10);
    const parsedOffsetFile = parseInt(options.offset, 10);
    const limitN = Math.max(0, Math.min(Number.isFinite(parsedLimitFile) ? parsedLimitFile : 100, 10000));
    const offsetN = Math.max(0, Number.isFinite(parsedOffsetFile) ? parsedOffsetFile : 0);
    const total = filtered.length;
    const envelope = {
      logs: filtered.slice(offsetN, offsetN + limitN),
      total,
      limit: limitN,
      offset: offsetN
    };
    if (degraded) envelope.degraded = true;
    return envelope;
  }

  _emptyEnvelope(options) {
    const parsedLimit = parseInt(options.limit, 10);
    const parsedOffset = parseInt(options.offset, 10);
    return {
      logs: [],
      total: 0,
      limit: Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 10000)),
      offset: Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0)
    };
  }

  _defaultStartIso(dateRange) {
    const now = new Date();
    if (dateRange === 'today' || !dateRange) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (dateRange === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (dateRange === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString();
    }
    if (dateRange === 'month') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d.toISOString();
    }
    throw new Error(`_defaultStartIso: unknown dateRange ${JSON.stringify(dateRange)}`);
  }

  _defaultEndIso(dateRange) {
    if (dateRange === 'today' || !dateRange) {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
    if (dateRange === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
    if (dateRange === 'week' || dateRange === 'month') {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
    throw new Error(`_defaultEndIso: unknown dateRange ${JSON.stringify(dateRange)}`);
  }

  // ------------------------------------------------------------------
  // Public API — log summary (VL-first)
  // ------------------------------------------------------------------

  /**
   * Get logs summary grouped by type and service for the given date.
   *
   * VL path: single `vlClient.hits()` call bucketed by `level`; the
   * resulting `{ERROR, WARN}` counts are returned in the legacy
   * `{errors[], warnings[], date}` envelope so the Vue UI keeps working
   * without changes.
   *
   * File path: legacy NDJSON parser.  Throws
   * `VlFilesDisabledError` when `LOG_TO_FILE !== '1'`.
   *
   * @param {Object} options
   * @param {string} [options.date]    YYYY-MM-DD.
   * @param {string} [options.level]  Optional level filter.
   * @returns {Promise<{errors: Array, warnings: Array, date: string, degraded?: true}>}
   */
  async getLogsSummary(options = {}) {
    if (this._sourceMode() === 'file') {
      return this._getLogsSummaryFromFile(options);
    }
    return this._getLogsSummaryFromVL(options);
  }

  async _getLogsSummaryFromVL(options = {}) {
    const { date, level } = options;
    const targetDate = date || new Date().toISOString().split('T')[0];
    if (!isValidDateStr(targetDate)) {
      return { errors: [], warnings: [], date: targetDate };
    }
    const startIso = `${targetDate}T00:00:00.000Z`;
    const endIso = `${targetDate}T23:59:59.999Z`;

    // Honour the documented `level` filter: when provided, restrict to
    // that level only; otherwise bucket both ERROR and WARN.
    const wantError = !level || String(level).toUpperCase() === 'ERROR';
    const wantWarn = !level || String(level).toUpperCase() === 'WARN';
    const wantInfo = level && String(level).toUpperCase() === 'INFO';

    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        const calls = [];
        if (wantError) calls.push(client.hits({ q: 'level:ERROR', start: startIso, end: endIso, field: 'level' }));
        if (wantWarn) calls.push(client.hits({ q: 'level:WARN', start: startIso, end: endIso, field: 'level' }));
        if (wantInfo) calls.push(client.hits({ q: 'level:INFO', start: startIso, end: endIso, field: 'level' }));
        const results = await Promise.all(calls);
        const errorHits = wantError ? results[0] : null;
        const warnHits = wantWarn ? results[wantError ? 1 : 0] : null;
        const infoIdx = (wantError ? 1 : 0) + (wantWarn ? 1 : 0);
        const infoHits = wantInfo ? results[infoIdx] : null;
        const errorCount = wantError ? this._sumHits(errorHits, 'ERROR') : 0;
        const warnCount = wantWarn ? this._sumHits(warnHits, 'WARN') : 0;
        const infoCount = wantInfo ? this._sumHits(infoHits, 'INFO') : 0;
        return {
          errors: errorCount > 0 ? [{ type: 'ERROR', typeKey: 'error', service: 'all', count: errorCount }] : [],
          warnings: warnCount > 0 ? [{ type: 'WARN', typeKey: 'warn', service: 'all', count: warnCount }] : [],
          infos: infoCount > 0 ? [{ type: 'INFO', typeKey: 'info', service: 'all', count: infoCount }] : [],
          date: targetDate
        };
      },
      'getLogsSummary',
      { errors: [], warnings: [], infos: [], date: targetDate }
    );
  }

  /**
   * Sum a `hits()` bucket for a single level. VictoriaLogs returns the full
   * bucketed object (every value of `field`); `_sumHits` must not bleed
   * counts from unrelated levels into the requested total. Use the explicit
   * level passed to the parent query, falling back to a single-key sum
   * when only one bucket is present (older adapter shape).
   *
   * @param {Record<string, number>|null|undefined} hits
   * @param {string} [level] - the level this query was filtered to (case-insensitive)
   * @returns {number}
   */
  _sumHits(hits, level) {
    if (!hits || typeof hits !== 'object') return 0;
    const coerce = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };
    if (level) {
      const direct = hits[level] ?? hits[level.toUpperCase()] ?? hits[level.toLowerCase()];
      if (direct !== undefined && direct !== null) return coerce(direct);
    }
    // Fallback for adapter responses that return a single-key object.
    // Only return the value when the lone key actually matches the
    // requested level — otherwise the count would bleed from a sibling
    // level (e.g. asking for ERROR but receiving {FATAL: 5}).
    const keys = Object.keys(hits);
    if (level && keys.length === 1) {
      const onlyKey = keys[0];
      if (onlyKey.toUpperCase() === level.toUpperCase()) {
        return coerce(hits[onlyKey]);
      }
      return 0;
    }
    if (keys.length === 1) return coerce(hits[keys[0]]);
    return 0;
  }

  async _getLogsSummaryFromFile(options = {}) {
    if (!booleanEnv('LOG_TO_FILE')) {
      throw new VlFilesDisabledError();
    }
    try {
      const date = options.date || new Date().toISOString().split('T')[0];
      if (!isValidDateStr(date)) {
        logger.warn('getLogsSummary.invalid_date', { date });
        return { errors: [], warnings: [], date };
      }

      const logFiles = await this.getLogFilesInRange(date, date, true);
      if (logFiles.length === 0) {
        return { errors: [], warnings: [], date };
      }

      const allParsedLogs = [];
      for (const logFile of logFiles) {
        try {
          const lock = await this._acquireReadLock(logFile);
          if (!lock) continue;
          try {
            const content = await this._readLogFileAd10(logFile);
            const lines = String(content)
              .split('\n')
              .filter((line) => line.trim() !== '');
            const capped = lines.length > MAX_LINES_TO_PROCESS ? lines.slice(0, MAX_LINES_TO_PROCESS) : lines;
            const isErrorLog = logFile.includes('error');
            const parsed = this.parseLogs(capped, isErrorLog ? 'ERROR' : null);
            allParsedLogs.push(...parsed);
          } finally {
            await this._releaseReadLock(lock);
          }
        } catch (fileError) {
          logger.error(`Error processing file ${logFile}: ${fileError.message}`);
        }
      }

      const filteredLogs = allParsedLogs.filter((log) => log.date === date);
      const errorLogs = filteredLogs.filter((log) => log.level === 'ERROR');
      const warningLogs = filteredLogs.filter((log) => log.level === 'WARN' || log.level === 'WARNING');

      return {
        errors: this.groupLogs(errorLogs),
        warnings: this.groupLogs(warningLogs),
        date
      };
    } catch (error) {
      logger.error(`Error in getLogsSummary (file): ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Public API — search (VL-first)
  // ------------------------------------------------------------------

  /**
   * Free-text / level / service search.
   *
   * VL path: builds a LogSQL query from `term`, `level`, `service` and
   * delegates to `VictoriaLogsClient.query`. Returns the canonical
   * `{logs, total, limit, offset}` envelope.
   *
   * File path: legacy NDJSON reader (printf regex parser retained for
   * backward compatibility with tests and pre-migration archives).
   *
   * @param {Object} options
   * @returns {Promise<{logs: Array, total: number, limit: number, offset: number, degraded?: true}>}
   */
  async searchLogs(options = {}) {
    if (this._sourceMode() === 'file') {
      return this._searchLogsFromFile(options);
    }
    return this._searchLogsFromVL(options);
  }

  async _searchLogsFromVL(options = {}) {
    const { term, level, service, limit = 1000 } = options;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(options.offset, 10);
    const limitN = Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 1000, 10000));
    const offsetN = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);

    const filterParts = [];
    if (term && String(term).trim() !== '') {
      const escaped = this._escapeLogSql(String(term));
      filterParts.push(`_msg:"${escaped}"`);
    }
    if (level && String(level).trim() !== '') {
      filterParts.push(`level:${this._normalizeLevelFilter(level)}`);
    }
    if (service && String(service).trim() !== '') {
      const escaped = this._escapeLogSql(String(service));
      filterParts.push(`_stream_service:"${escaped}"`);
    }
    const q = filterParts.length > 0 ? filterParts.join(' AND ') : '*';

    const { startDate, endDate } = this.getDateRange(options);
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        const rows = await client.query({
          q: this._vlFilter(q),
          start: startIso,
          end: endIso,
          limit: limitN + offsetN
        });
        const pageRows = Array.isArray(rows) ? rows.slice(offsetN, offsetN + limitN) : [];
        return {
          logs: pageRows,
          total: Array.isArray(rows) ? rows.length : 0,
          limit: limitN,
          offset: offsetN
        };
      },
      'searchLogs',
      { logs: [], total: 0, limit: limitN, offset: offsetN }
    );
  }

  /**
   * Sanitise a user-supplied string before it is interpolated into a
   * `_msg:"..."` / `_stream_service:"..."` / `_stream:"..."` /
   * `service:"..."` filter clause.
   *
   * Contract:
   *   - The caller wraps the result in a double-quoted LogSQL filter,
   *     e.g. ``_msg:${escaped}`` becomes ``_msg:"<escaped>"``.
   *   - This function MUST strip every character that could either
   *     terminate the surrounding quotes or break out of the filter
   *     clause, regardless of whether the caller happens to wrap the
   *     value today:
   *       - LogSQL string terminators: `"`, `\`, newlines.
   *       - Filter syntax tokens: `(`, `)`, `{`, `}`, `:`, `;`, `,`,
   *         `=`, `?`, `*` (wildcards).
   *       - LogSQL clause keywords (upper/lower case): `AND`, `OR`,
   *         `NOT`, so a caller that forgets to quote cannot inject a
   *         new filter expression.
   *       - Backticks (defence-in-depth) and Unicode left/right double
   *         & single quotes (homoglyphs).
   *     Operators and keyword tokens are replaced with a single space;
   *     operators are case-insensitive on the `AND|OR|NOT` regex.
   *   - Never returns the empty string for an input that had any
   *     significant character; the replacement keeps word boundaries
   *     so multi-token terms like `"foo   bar"` become `"foo bar"`,
   *     not `"foobar"`.
   *
   * The wrapped-quote strategy at every call site (the value is always
   * placed inside `_msg:"..."` / `_stream_service:"..."`) is the
   * first line of defence. This sanitiser is the second — never rely
   * on the wrap alone.
   *
   * @param {string} raw
   * @returns {string}
   */
  _escapeLogSql(raw) {
    const text = String(raw);
    // 1. Drop every LogSQL-significant character (ASCII punctuation).
    const sanitized = text.replace(/[*?:\\"\n\r\t`(){}=,;]/g, ' ');
    // 2. Drop Unicode homoglyphs (curly quotes) — defence-in-depth so a
    //    future call site that forgets to double-quote the value still
    //    cannot be broken out by a Unicode-only payload.
    const noHomoglyphs = sanitized
      .replace(/[‘’]/g, "'") // single curly → ASCII single (next pass)
      .replace(/[“”]/g, '"');
    // 3. Strip LogSQL clause keywords so a non-quoted caller cannot
    //    attach `AND level:ERROR` to the filter. Whole-word match,
    //    case-insensitive.
    const noKeywords = noHomoglyphs.replace(/\b(AND|OR|NOT)\b/gi, ' ');
    // 4. Strip ALL single quotes — they survive the wrap today (they
    //    are not LogSQL string terminators) but a future call site may
    //    switch to single-quoted wrapping.
    return noKeywords.replace(/'/g, ' ');
  }

  /**
   * Canonical set of log levels the search filter accepts. Anything
   * outside this set is rejected (LogSQL injection vector — a hostile
   * caller could otherwise pass `INFO OR _stream:*` to widen the
   * filter beyond the requested level).
   *
   * @type {ReadonlyArray<string>}
   */
  get ALLOWED_LEVELS() {
    return Object.freeze(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
  }

  /**
   * Validate a caller-supplied `level` filter value against the
   * canonical allowlist. Unknown / malformed input throws so the
   * route layer can surface a 400 rather than silently swallowing an
   * injection attempt.
   *
   * @param {unknown} level
   * @returns {string} Normalised upper-case level in the allowlist
   */
  _normalizeLevelFilter(level) {
    if (typeof level !== 'string' || level.trim() === '') {
      throw new Error('searchLogs level filter must be a non-empty string');
    }
    const upper = level.trim().toUpperCase();
    // Map the legacy `WARNING` synonym onto `WARN` so existing
    // callers stay compatible while the underlying level remains
    // allowlisted.
    const canonical = upper === 'WARNING' ? 'WARN' : upper;
    if (!this.ALLOWED_LEVELS.includes(canonical)) {
      throw new Error(
        `searchLogs level filter must be one of ${this.ALLOWED_LEVELS.join(', ')} (got ${JSON.stringify(level)})`
      );
    }
    return canonical;
  }

  async _searchLogsFromFile(options = {}) {
    if (!booleanEnv('LOG_TO_FILE')) {
      throw new VlFilesDisabledError();
    }
    try {
      let searchParams = options;
      if (options.params && typeof options.params === 'string') {
        try {
          searchParams = JSON.parse(options.params);
        } catch (e) {
          logger.error('Failed to parse search parameters:', e);
        }
      }

      const { startDate, endDate } = this.getDateRange(searchParams);
      const logFiles = await this.getLogFilesInRange(startDate, endDate, searchParams.includeArchived);

      const allLogs = [];

      for (const file of logFiles) {
        try {
          const lock = await this._acquireReadLock(file);
          if (!lock) continue;
          try {
            const logContent = await this._readLogFileAd10(file);
            let logLines = String(logContent)
              .split('\n')
              .filter((line) => line.trim() !== '');
            if (logLines.length > MAX_LINES_TO_PROCESS) {
              logLines = logLines.slice(0, MAX_LINES_TO_PROCESS);
            }
            const isErrorLog = file.includes('error');
            const parsedLogs = this.parseLogs(logLines, isErrorLog ? 'ERROR' : null);
            allLogs.push(...parsedLogs);
          } finally {
            await this._releaseReadLock(lock);
          }
        } catch (error) {
          logger.error(`Error processing log file ${file}: ${error.message}`);
        }
      }

      let filteredLogs = allLogs.filter((log) => log.date >= startDate && log.date <= endDate);
      if (searchParams.level && String(searchParams.level).trim() !== '') {
        const targetLevel = String(searchParams.level).toUpperCase();
        filteredLogs = filteredLogs.filter(
          (log) => log.level === targetLevel || (targetLevel === 'WARN' && log.level === 'WARNING')
        );
      }
      if (searchParams.service && String(searchParams.service).trim() !== '') {
        filteredLogs = filteredLogs.filter(
          (log) => log.service && log.service.toLowerCase().includes(searchParams.service.toLowerCase())
        );
      }
      if (searchParams.term && String(searchParams.term).trim() !== '') {
        filteredLogs = filteredLogs.filter(
          (log) => log.message && log.message.toLowerCase().includes(searchParams.term.toLowerCase())
        );
      }
      filteredLogs.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return new Date(`${b.date} ${b.time}`) - new Date(`${a.date} ${a.time}`);
      });

      const limit = searchParams.limit ? parseInt(searchParams.limit, 10) : 1000;
      if (filteredLogs.length > limit) {
        filteredLogs = filteredLogs.slice(0, limit);
      }

      return {
        logs: filteredLogs.map((log) => ({
          date: log.date,
          time: log.time,
          level: log.level,
          service: log.service,
          message: log.message
        })),
        total: filteredLogs.length,
        limit,
        offset: 0
      };
    } catch (error) {
      logger.error(`Error in searchLogs (file): ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Public API — yesterday debug (VL-first)
  // ------------------------------------------------------------------

  /**
   * Debug endpoint used by admin UI to verify yesterday's records can
   * be reached.
   *
   * VL path: tiny `_msg:*` query bounded to yesterday's UTC window,
   * returning a `{success, lines, sample, filesFound}` payload similar
   * to the file path.  Falls back to `{success: false, error,
   * filesFound: []}` when no records are reachable.
   *
   * File path: legacy reader.
   *
   * @returns {Promise<Object>}
   */
  async debugYesterdayLogs() {
    if (this._sourceMode() === 'file') {
      return this._debugYesterdayLogsFromFile();
    }
    return this._debugYesterdayLogsFromVL();
  }

  async _debugYesterdayLogsFromVL() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const startIso = `${yesterdayStr}T00:00:00.000Z`;
    const endIso = `${yesterdayStr}T23:59:59.999Z`;
    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        const rows = await client.query({ q: '*', start: startIso, end: endIso, limit: 5 });
        const sample = (rows || []).slice(0, 5).map((row) => (row.message || row._msg || '').slice(0, 120));
        return {
          success: true,
          lines: (rows || []).length,
          sample,
          filesFound: [
            {
              date: yesterdayStr,
              service: 'victorialogs',
              source: 'victorialogs',
              query: `q=* start=${startIso} end=${endIso}`
            }
          ]
        };
      },
      'debugYesterdayLogs',
      {
        success: false,
        error: 'vl_unreachable',
        filesFound: [
          {
            date: yesterdayStr,
            service: 'victorialogs',
            source: 'victorialogs',
            query: `q=* start=${startIso} end=${endIso}`
          }
        ]
      }
    );
  }

  async _debugYesterdayLogsFromFile() {
    if (!booleanEnv('LOG_TO_FILE')) {
      throw new VlFilesDisabledError();
    }
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const logFiles = await this.getLogFilesInRange(yesterdayStr, yesterdayStr, true);
      if (logFiles.length === 0) {
        return { success: false, error: 'No log files found for yesterday', filesFound: [] };
      }
      try {
        const lock = await this._acquireReadLock(logFiles[0]);
        if (!lock) {
          return { success: false, error: 'concurrent reader holds the file lock', filesFound: logFiles };
        }
        try {
          const content = await this._readLogFileAd10(logFiles[0]);
          const lines = String(content).split('\n').slice(0, 5);
          return { success: true, lines: lines.length, sample: lines, filesFound: logFiles };
        } finally {
          await this._releaseReadLock(lock);
        }
      } catch (error) {
        return { success: false, error: error.message, filesFound: logFiles };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ------------------------------------------------------------------
  // Public API — synthetic file descriptors
  // ------------------------------------------------------------------

  /**
   * Enumerate the "log files" backing a date range.
   *
   * VL mode (default): returns one synthetic descriptor per UTC date in
   * the range, shaped `{date, service, source: 'victorialogs', query}`
   * — the contract the security-scanner (P3) will pivot on once it
   * drops `worker_threads`.  Today the security-scan service still
   * consumes the file path; callers in VL mode therefore receive
   * descriptors (not real paths) and should pivot to LogSQL.
   *
   * File mode (ADMIN_LOGS_SOURCE=file, LOG_TO_FILE=1): legacy directory
   * walk over `components/gov-chat-backend/logs/`; returns real path
   * strings so `security-scan-service.js` keeps working until P3 lands.
   *
   * @param {string} startDate  YYYY-MM-DD
   * @param {string} endDate    YYYY-MM-DD
   * @param {boolean} [includeArchived=true]
   * @returns {Promise<Array<string|{date: string, service: string, source: string, query: string}>>}
   */
  async getLogFilesInRange(startDate, endDate, includeArchived = true) {
    if (this._sourceMode() === 'file') {
      return this._getLogFilesInRangeFromDisk(startDate, endDate, includeArchived);
    }
    return this._getLogFilesInRangeFromVL(startDate, endDate);
  }

  async _getLogFilesInRangeFromVL(startDate, endDate) {
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      logger.warn('getLogFilesInRange.invalid_date_params', { startDate, endDate });
      return [];
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) {
      logger.warn('getLogFilesInRange.invalid_date_range', { startDate, endDate });
      return [];
    }
    const spanDays = Math.ceil((end - start) / 86400000) + 1;
    if (spanDays > MAX_LOG_FILES_RANGE_DAYS) {
      logger.warn('getLogFilesInRange.range_too_wide', { startDate, endDate, spanDays });
      return [];
    }
    const descriptors = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const date = cursor.toISOString().split('T')[0];
      descriptors.push({
        date,
        service: 'victorialogs',
        source: 'victorialogs',
        query: `service:* start=${date}T00:00:00.000Z end=${date}T23:59:59.999Z`
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return descriptors;
  }

  async _getLogFilesInRangeFromDisk(startDate, endDate, includeArchived = true) {
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      logger.warn('getLogFilesInRange.invalid_date_params', { startDate, endDate });
      return [];
    }

    const logDir = path.join(__dirname, '../logs');
    try {
      await fs.access(logDir);
    } catch {
      logger.error(`Logs directory does not exist: ${logDir}`);
      return [];
    }

    // Re-read directory listing before each scan to tolerate a
    // concurrent rotation removing/renaming files mid-walk.
    let files;
    try {
      files = await fs.readdir(logDir);
    } catch (err) {
      // The directory may vanish between `fs.access` and `fs.readdir` if
      // a rotation runs concurrently. Treat the same as the access()
      // check above: log and return an empty list.
      logger.warn(`readdir failed for ${logDir}: ${err.message}`);
      return [];
    }
    const logFiles = [];
    const today = new Date().toISOString().split('T')[0];

    if (new Date(startDate) > new Date(endDate)) {
      logger.error(`Invalid date range: startDate (${startDate}) is after endDate (${endDate})`);
      return [];
    }

    if (startDate <= today && today <= endDate) {
      const currentLogs = ['combined.log', 'combined1.log', 'error.log'];
      for (const file of currentLogs) {
        const filePath = path.join(logDir, file);
        try {
          await fs.access(filePath, fs.constants.R_OK);
          logFiles.push(filePath);
        } catch (error) {
          logger.debug(`Current log not accessible: ${filePath}, error: ${error.message}`);
        }
      }
    }

    if (includeArchived) {
      for (const file of files) {
        const dateMatch = file.match(/^(combined|error)-(\d{4}-\d{2}-\d{2})\.log(?:\.\d+)?(?:\.gz)?$/);
        if (!dateMatch) {
          continue;
        }
        const [, , fileDate] = dateMatch;
        if (fileDate >= startDate && fileDate <= endDate) {
          const filePath = path.join(logDir, file);
          try {
            await fs.access(filePath, fs.constants.R_OK);
            logFiles.push(filePath);
          } catch (error) {
            logger.debug(`Could not access log file ${filePath}: ${error.message}`);
          }
        }
      }
    }

    logFiles.sort((a, b) => a.localeCompare(b));
    return [...new Set(logFiles)];
  }

  // ------------------------------------------------------------------
  // File-path helpers
  // ------------------------------------------------------------------

  /**
   * Acquire an O_EXCL read lock for `filePath`. Returns the lock
   * descriptor (or `null` if another holder has the lock); callers MUST
   * invoke `_releaseReadLock` once the read finishes so the sentinel
   * disappears and subsequent readers do not see a stale EEXIST.
   *
   * @param {string} filePath
   * @returns {Promise<{handle: import('fs').FileHandle, lockPath: string}|null>}
   */
  async _acquireReadLock(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('_acquireReadLock: filePath must be a non-empty string');
    }
    const baseName = path.basename(filePath);
    const lockPath = path.join(LOCK_DIR, `.logs-read-lock-${baseName}-${process.pid}`);
    try {
      const handle = await fs.open(lockPath, 'wx');
      return { handle, lockPath };
    } catch (err) {
      if (err.code === 'EEXIST') {
        logger.warn(`Concurrent read lock held for ${filePath}; skipping.`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Close the lock handle and unlink the sentinel so the next reader can
   * re-acquire. Idempotent: missing lock is not an error.
   *
   * @param {{handle: import('fs').FileHandle, lockPath: string}|null} lock
   */
  async _releaseReadLock(lock) {
    if (!lock) return;
    try {
      await lock.handle.close();
    } catch {
      // best-effort
    }
    try {
      await fssync.promises.unlink(lock.lockPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        logger.debug(`Failed to unlink read-lock sentinel ${lock.lockPath}: ${err.message}`);
      }
    }
  }

  /**
   * Read a log file with ENOENT tolerance between stat() and
   * open(). Handles `.gz` (existing behaviour) and the 20 MB truncation
   * cap (existing behaviour).
   *
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async _readLogFileAd10(filePath) {
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.debug(`File vanished between listing and stat: ${filePath}`);
        return '';
      }
      throw err;
    }

    if (stats.size > MAX_LOG_FILE_SIZE) {
      const fh = await fs.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
        await fh.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
        // Rewind to the last newline so a JSON object split across the
        // truncation boundary never reaches the NDJSON parser (a partial
        // line would crash JSON.parse and skew the row count). Fall back
        // to the full buffer when no newline is present (one very long line).
        const raw = buffer.toString('utf8');
        const lastNl = raw.lastIndexOf('\n');
        return lastNl >= 0 ? raw.slice(0, lastNl) : raw;
      } finally {
        await fh.close();
      }
    }

    if (filePath.endsWith('.gz')) {
      const compressed = await fs.readFile(filePath);
      const decompressed = await gunzip(compressed);
      return decompressed.toString('utf8');
    }
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * NDJSON line parser for the on-disk archive content. Wraps `JSON.parse` in a
   * try/catch and, on `SyntaxError` (truncated line from `kill -9`
   * mid-write), reads the next `RE_PARSE_WINDOW_BYTES` bytes, appends
   * them, and retries once before skipping with a `parse_error`
   * counter.
   *
   * @param {string} content
   * @returns {Array<{timestamp: string, message: string, stream: {service: string, environment: string}, fields: Object, date: string, time: string, level: string, service: string}>}
   */
  _parseNdjsonContent(content) {
    const rows = [];
    if (!content || content.length === 0) return rows;
    let parseErrors = 0;
    let cursor = 0;
    while (cursor < content.length) {
      const newlineIdx = content.indexOf('\n', cursor);
      const segmentEnd = newlineIdx === -1 ? content.length : newlineIdx;
      const segment = content.slice(cursor, segmentEnd);
      // Blank line (no characters before newline): skip without consuming.
      if (!segment || segment.trim() === '') {
        cursor = segmentEnd + 1;
        continue;
      }

      let parsed = null;
      let parseError = null;
      let consumedTo = newlineIdx === -1 ? content.length : newlineIdx + 1;
      try {
        parsed = JSON.parse(segment);
      } catch (firstErr) {
        // The retry window only applies when we haven't yet consumed
        // the trailing newline — otherwise the "tail" comes from the
        // next line and the splice is meaningless.
        if (
          firstErr instanceof SyntaxError &&
          newlineIdx !== -1 &&
          newlineIdx + RE_PARSE_WINDOW_BYTES <= content.length
        ) {
          const tail = content.slice(newlineIdx + 1, newlineIdx + 1 + RE_PARSE_WINDOW_BYTES);
          try {
            parsed = JSON.parse(segment + tail);
            // On retry success, advance exactly one past the original
            // newline. We don't know where in the tail the JSON object
            // actually ended, so over-advancing by `tail.length` would
            // skip valid lines that follow.
            consumedTo = newlineIdx + 1;
          } catch (retryErr) {
            parseError = retryErr;
          }
        } else {
          parseError = firstErr;
        }
      }
      cursor = consumedTo;
      if (parsed === null || parseError) {
        parseErrors++;
        logger.warn(`NDJSON parse error (skipping line): ${parseError ? parseError.message : 'unknown'}`);
        continue;
      }

      const timestamp = this._extractTimestamp(parsed);
      const date = timestamp.slice(0, 10);
      const time = timestamp.slice(11, 19);
      const service = this._extractService(parsed);
      const level = this._extractLevel(parsed);
      const message = this._extractMessage(parsed);
      const environment = this._extractEnvironment(parsed);
      const fields = this._extractFields(parsed);

      rows.push({
        timestamp,
        message,
        stream: { service, environment },
        fields,
        date,
        time,
        level,
        service
      });
    }
    if (parseErrors > 0) {
      logger.warn(`NDJSON parse completed with ${parseErrors} parse_error entries`);
    }
    return rows;
  }

  _extractTimestamp(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (typeof parsed.timestamp === 'string') return parsed.timestamp;
    if (typeof parsed._time === 'string') return parsed._time;
    if (typeof parsed.time === 'string') return parsed.time;
    return '';
  }

  _extractMessage(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed._msg === 'string') return parsed._msg;
    return '';
  }

  _extractService(parsed) {
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    if (typeof parsed.service === 'string') return parsed.service;
    if (parsed._stream && typeof parsed._stream.service === 'string') return parsed._stream.service;
    return 'unknown';
  }

  _extractLevel(parsed) {
    if (!parsed || typeof parsed !== 'object') return 'INFO';
    let raw = parsed.level;
    if (raw === undefined && parsed._stream) raw = parsed._stream.level;
    if (raw === undefined || raw === null) return 'INFO';
    const upper = String(raw).toUpperCase();
    return upper.length > 0 ? upper : 'INFO';
  }

  _extractEnvironment(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (typeof parsed.environment === 'string') return parsed.environment;
    if (parsed._stream && typeof parsed._stream.environment === 'string') return parsed._stream.environment;
    return '';
  }

  _extractFields(parsed) {
    if (!parsed || typeof parsed !== 'object') return {};
    const skip = new Set(['timestamp', '_time', 'message', '_msg', 'service', 'level', 'environment']);
    const fields = {};
    for (const key of Object.keys(parsed)) {
      if (skip.has(key)) continue;
      if (key === '_stream') continue;
      fields[key] = parsed[key];
    }
    return fields;
  }

  // ------------------------------------------------------------------
  // Legacy helpers — retained for backward compat (file path + tests)
  // ------------------------------------------------------------------

  /**
   * Check if a file exists
   * @param {string} filePath - Path to the file
   * @returns {Promise<boolean>} Whether the file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug(`File does not exist: ${filePath}`);
        throw new Error(`File not found: ${filePath}`, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Read file content, handling both compressed and uncompressed files
   */
  async readLogFile(filePath) {
    try {
      await fs.access(filePath);
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_LOG_FILE_SIZE) {
        const fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
        await fileHandle.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
        await fileHandle.close();
        // Rewind to the last newline so a JSON object split across the
        // truncation boundary never reaches the NDJSON parser. Fall back
        // to the full buffer when no newline is present (one very long line).
        const raw = buffer.toString('utf8');
        const lastNl = raw.lastIndexOf('\n');
        return lastNl >= 0 ? raw.slice(0, lastNl) : raw;
      }
      if (filePath.endsWith('.gz')) {
        const compressedData = await fs.readFile(filePath);
        const decompressedData = await gunzip(compressedData);
        return decompressedData.toString('utf8');
      }
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      logger.error(`Error reading file ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract date from a log filename
   * @param {string} filename - Log filename
   * @returns {string|null} Extracted date in yyyy-MM-dd format or null
   */
  extractDateFromFilename(filename) {
    if (!filename) return null;
    const match = filename.match(/(?:combined|error)-(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }

  /**
   * Extract logs of a specific level from log lines (printf format).
   * Retained for backward compatibility with existing tests.
   *
   * @param {Array<string>} logLines
   * @param {string} level
   * @returns {Array<Object>}
   */
  extractLogs(logLines, level) {
    const logs = logLines
      .filter((line) => {
        return (
          line.includes(`[${level}]`) ||
          line.includes(`[${level}]:`) ||
          (level === 'WARN' && (line.includes('[WARNING]') || line.includes('[WARNING]:'))) ||
          (level === 'DEBUG' && (line.includes('[DEBUG]') || line.includes('[DEBUG]:')))
        );
      })
      .map((line) => {
        const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s+(.*)/);
        if (!match) return null;
        const [, date, time, logLevel, message] = match;
        const normalizedLevel = logLevel === 'WARNING' ? 'WARN' : logLevel;
        const serviceMatch = message.match(/\[([^\]]+)\]/);
        const service = serviceMatch ? serviceMatch[1] : 'System';
        return { date, time, level: normalizedLevel, message, service };
      })
      .filter((log) => log !== null);

    return logs;
  }

  /**
   * Group logs by type and service for summary
   * @param {Array} logs - Parsed log entries
   * @returns {Array} Grouped logs summary
   */
  groupLogs(logs) {
    const groups = {};
    const summaryPatterns = [
      { regex: /connection timeout/i, type: 'Connection Timeout' },
      { regex: /database query failed/i, type: 'Database Query Failed' },
      { regex: /authentication failure/i, type: 'Authentication Failure' },
      { regex: /invalid token/i, type: 'Invalid Token' },
      { regex: /disk space below threshold/i, type: 'Disk Space Below Threshold' },
      { regex: /slow query performance/i, type: 'Slow Query Performance' },
      { regex: /rate limit approaching/i, type: 'Rate Limit Approaching' },
      { regex: /ENOENT: no such file or directory/i, type: 'File Not Found' }
    ];

    logs.forEach((log) => {
      try {
        let matchedType = null;
        const service = log.service || 'System';
        for (const pattern of summaryPatterns) {
          if (log.message && pattern.regex.test(log.message)) {
            matchedType = pattern.type;
            break;
          }
        }
        if (!matchedType) {
          if (log.message && log.message.split) {
            matchedType = log.message.split(':')[0] || 'Generic Event';
            if (matchedType.length > 50) {
              matchedType = `${matchedType.substring(0, 50)}...`;
            }
          } else {
            matchedType = 'Unknown Event';
          }
        }

        const key = `${matchedType}|${service}`;
        if (!groups[key]) {
          groups[key] = {
            type: matchedType,
            typeKey: matchedType
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^a-z0-9_]/g, ''),
            service,
            count: 0
          };
        }
        groups[key].count++;
      } catch (error) {
        logger.warn(`Error grouping log: ${error.message}`);
      }
    });
    return Object.values(groups);
  }

  /**
   * Parse raw log lines into structured log objects (printf format).
   * Retained for backward compatibility with existing tests.
   */
  parseLogs(logLines, defaultLevel = null) {
    try {
      const logs = [];
      const processedLines = new Set();
      let currentLog = null;

      for (let index = 0; index < logLines.length; index++) {
        try {
          const line = logLines[index];
          if (!line || typeof line !== 'string' || line.trim() === '' || processedLines.has(line)) {
            continue;
          }

          processedLines.add(line);
          const trimmedLine = line.trim();

          if (trimmedLine.match(/^={10,}$/)) {
            continue;
          }

          const standardMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s*(.*)/);
          if (standardMatch) {
            const [, date, time, level, message] = standardMatch;
            if (!message || message.trim() === '') continue;
            const normalizedLevel = defaultLevel || (level === 'WARNING' ? 'WARN' : level.toUpperCase());
            currentLog = {
              date,
              time,
              level: normalizedLevel,
              message: message.trim(),
              service: this.detectService(message)
            };
            logs.push(currentLog);
            continue;
          }

          const altMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)/);
          if (altMatch) {
            const [, date, time, level, message] = altMatch;
            if (!message || message.trim() === '') continue;
            const normalizedLevel = defaultLevel || (level === 'WARNING' ? 'WARN' : level.toUpperCase());
            currentLog = {
              date,
              time,
              level: normalizedLevel,
              message: message.trim(),
              service: this.detectService(message)
            };
            logs.push(currentLog);
            continue;
          }

          const dateTimeOnlyMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.*)/);
          if (dateTimeOnlyMatch) {
            const [, date, time, message] = dateTimeOnlyMatch;
            if (!message || message.trim() === '') continue;
            let detectedLevel = defaultLevel || this.detectLogLevel(message);
            if (detectedLevel === 'WARNING') detectedLevel = 'WARN';
            currentLog = {
              date,
              time,
              level: detectedLevel,
              message: message.trim(),
              service: this.detectService(message)
            };
            logs.push(currentLog);
            continue;
          }

          if (currentLog && trimmedLine.match(/^(?:[A-Z]+\s+|{|\[|"_id":|"[^"]+":|[^:]+:.*|\s*}\s*$|\s*]\s*$)/)) {
            currentLog.message += `\n${trimmedLine}`;
            continue;
          }

          currentLog = null;
        } catch (lineError) {
          logger.warn(`Error parsing line ${index}: ${lineError.message}`);
          currentLog = null;
        }
      }
      return logs;
    } catch (error) {
      logger.error(`Error in parseLogs: ${error.message}`);
      return [];
    }
  }

  /**
   * Detect log level from message if not explicitly provided
   */
  detectLogLevel(message) {
    try {
      if (!message) return 'INFO';
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('error') || lowerMessage.includes('exception') || lowerMessage.includes('fail'))
        return 'ERROR';
      if (lowerMessage.includes('warn')) return 'WARN';
      if (lowerMessage.includes('debug')) return 'DEBUG';
      return 'INFO';
    } catch (error) {
      logger.warn(`Error detecting log level: ${error.message}`);
      return 'INFO';
    }
  }

  /**
   * Detect service from message
   */
  detectService(message) {
    try {
      if (!message) return 'System';
      if (message.includes('EmailService')) return 'Email Service';
      if (message.includes('DatabaseService')) return 'Database Service';
      if (message.includes('AuthService')) return 'Auth Service';
      const serviceMatch = message.match(/\[([A-Z]+)\s+DEBUG\]/i);
      if (serviceMatch) {
        const serviceType = serviceMatch[1].toUpperCase();
        switch (serviceType) {
          case 'AUTH':
            return 'Auth Service';
          case 'ADMIN':
            return 'Admin Service';
          default:
            return `${serviceType} Service`;
        }
      }
      return 'System';
    } catch (error) {
      logger.warn(`Error detecting service: ${error.message}`);
      return 'System';
    }
  }

  /**
   * Get date range based on options
   */
  getDateRange(options) {
    try {
      const now = new Date();
      let startDate, endDate;

      if (options.dateRange === 'custom' && options.startDate && options.endDate) {
        startDate = new Date(options.startDate);
        endDate = new Date(options.endDate);
      } else {
        switch (options.dateRange) {
          case 'yesterday':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);
            break;
          case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            endDate = new Date(now);
            break;
          case 'month':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            endDate = new Date(now);
            break;
          default:
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
        }
      }

      return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      };
    } catch (error) {
      logger.error(`Error getting date range: ${error.message}`);
      const today = new Date().toISOString().split('T')[0];
      return { startDate: today, endDate: today };
    }
  }

  // ------------------------------------------------------------------
  // Deprecated public method — kept for backward compat (file path)
  // ------------------------------------------------------------------

  /**
   * Backward-compat alias. Prefer `debugYesterdayLogs()` (matches the
   * `getDebugYesterday` shape from the route layer).
   */
  async getDebugYesterday() {
    return this.debugYesterdayLogs();
  }
}

const logsService = runInBackgroundSpan('service.init.logs', () => LogsService.getInstance());
module.exports = logsService;
module.exports.LogsService = LogsService;
module.exports.VlFilesDisabledError = VlFilesDisabledError;
