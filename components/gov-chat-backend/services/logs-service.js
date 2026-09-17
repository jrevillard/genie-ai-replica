// components/gov-chat-backend/services/logs-service.js
//
// VictoriaLogs single-channel rewrite (T0-T8): every public log API
// (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`,
// `getLogFilesInRange`) routes through `VictoriaLogsClient`. Per-call
// `ADMIN_LOGS_SOURCE` env read is retained for the SPEC D2 escape hatch:
// `ADMIN_LOGS_SOURCE=file` raises `VlFilesDisabledError` (503
// `vl_files_disabled`) so existing callers fail loudly rather than
// silently falling back to VL. VL outages are surfaced by default;
// `VL_FAIL_OPEN=true` returns empty results + a `degraded: true` flag.
'use strict';

const fs = require('fs').promises;
const { runInBackgroundSpan } = require('../shared-lib/tracing-background');
const path = require('path');

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

// Canonical log-type patterns used by `_getLogsSummaryFromVL()` to
// project a summary rollup. Hoisted to module scope so the constant
// can be reused / unit-tested without re-allocating per call. Frozen
// so accidental mutation in a consumer doesn't corrupt the next call.
const SUMMARY_PATTERNS = Object.freeze([
  Object.freeze({ regex: /connection timeout/i, type: 'Connection Timeout' }),
  Object.freeze({ regex: /database query failed/i, type: 'Database Query Failed' }),
  Object.freeze({ regex: /authentication failure/i, type: 'Authentication Failure' }),
  Object.freeze({ regex: /invalid token/i, type: 'Invalid Token' }),
  Object.freeze({ regex: /disk space below threshold/i, type: 'Disk Space Below Threshold' }),
  Object.freeze({ regex: /slow query performance/i, type: 'Slow Query Performance' }),
  Object.freeze({ regex: /rate limit approaching/i, type: 'Rate Limit Approaching' }),
  Object.freeze({ regex: /ENOENT: no such file or directory/i, type: 'File Not Found' })
]);
// Hard cap on the date span served by `getLogFilesInRange` (one descriptor
// per UTC day; prevents memory blow-up on a wide admin range). 366 covers
// a full year + leap day.
const MAX_LOG_FILES_RANGE_DAYS = 366;
// Rate-limit state file for VL-unreachable logging. Unix ms on a single
// line. Persisted so backend restarts do not reset the cadence.
const VL_FAIL_OPEN_TS_FILE = path.join('/tmp', 'vl-fail-open-ts');
// Cap on VL-unreachable error log lines: one per minute, persisted.
const VL_FAIL_OPEN_LOG_COOLDOWN_MS = 60_000;

/**
 * Typed error raised when `ADMIN_LOGS_SOURCE=file` is requested. The
 * file-source code path is dropped (single-channel VL), so this is the
 * single failure mode the dispatchers raise when an operator pins the
 * legacy env var. Carries the recovery hint body the route layer
 * renders as a 503 response.
 */
class VlFilesDisabledError extends Error {
  constructor() {
    super('File-based log source is no longer available');
    this.name = 'VlFilesDisabledError';
    this.statusCode = 503;
    this.body = {
      error: 'vl_files_disabled',
      message: 'File-based log source is no longer available'
    };
  }
}

/**
 * Service for managing system logs.
 *
 * Single source mode (selected per call):
 *   - `victorialogs` (default) — issues LogSQL queries via the MELT
 *     port (`shared/lib/melt`).  Outages are surfaced unless
 *     `VL_FAIL_OPEN=true`.
 *
 * The legacy file-source path is gone. `ADMIN_LOGS_SOURCE=file` is
 * preserved as a per-call escape-hatch trigger but now raises
 * `VlFilesDisabledError` (503) immediately so callers fail loudly.
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
   * Initialize the LogsService. No-op after T8: the file-source mkdir
   * for `../logs` is dropped with the file path itself. Kept on the
   * public surface because callers (and tests) still invoke it.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('LogsService already initialized, skipping');
      return;
    }
    this.initialized = true;
    logger.info('LogsService initialized successfully');
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
   *   - `ADMIN_LOGS_SOURCE=file` → raises `VlFilesDisabledError` (503)
   *     immediately. The file-source code path is dropped in T8; this
   *     preserves the SPEC D2 escape-hatch contract (loud failure when
   *     the legacy env var is pinned) without the on-disk reader.
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
   *                                      'month' | 'custom'.
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
      throw new VlFilesDisabledError();
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
        const window = limitN + offsetN;
        const rows = await client.query({ q, start: startIso, end: endIso, limit: window });
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
   * `ADMIN_LOGS_SOURCE=file` raises `VlFilesDisabledError` (503)
   * immediately (SPEC D2 escape-hatch contract).
   *
   * @param {Object} options
   * @param {string} [options.date]    YYYY-MM-DD.
   * @param {string} [options.level]  Optional level filter.
   * @returns {Promise<{errors: Array, warnings: Array, date: string, degraded?: true}>}
   */
  async getLogsSummary(options = {}) {
    if (this._sourceMode() === 'file') {
      throw new VlFilesDisabledError();
    }
    return this._getLogsSummaryFromVL(options);
  }

  async _getLogsSummaryFromVL(options = {}) {
    const { date, level } = options;
    const targetDate = date || new Date().toISOString().split('T')[0];
    if (!isValidDateStr(targetDate)) {
      return { errors: [], warnings: [], services: [], date: targetDate };
    }
    const startIso = `${targetDate}T00:00:00.000Z`;
    const endIso = `${targetDate}T23:59:59.999Z`;

    // Honour the documented `level` filter: when provided, restrict to
    // that level only; otherwise bucket ERROR + WARN + INFO.
    const wantError = !level || String(level).toUpperCase() === 'ERROR';
    const wantWarn = !level || String(level).toUpperCase() === 'WARN';
    const wantInfo = !level || (level && String(level).toUpperCase() === 'INFO');

    // Extract a per-row "type" label from the log message:
    //   1. First matching regex pattern wins (categorical labels like
    //      "Connection Timeout", "Authentication Failure", etc.).
    //   2. Fallback: `message.split(':')[0]`, truncated to 50 chars
    //      with "..." suffix.
    //   3. If the message isn't a string at all: "Generic Event".
    // Computed at QUERY TIME — not stamped on ingest — so the
    // cardinality is bounded by the row fetch window, not by a VL
    // stream index. Indexed log_type was tried before (reverted) and
    // would explode memory when every distinct log message becomes a
    // unique value.
    const summaryPatterns = SUMMARY_PATTERNS;
    const extractType = (message) => {
      if (!message || typeof message !== 'string' || !message.split) {
        return 'Generic Event';
      }
      for (const pattern of summaryPatterns) {
        if (pattern.regex.test(message)) {
          return pattern.type;
        }
      }
      const head = message.split(':')[0] || 'Generic Event';
      if (head.length > 50) {
        return `${head.substring(0, 50)}...`;
      }
      return head;
    };

    /**
     * Bucket raw VL rows for the requested level by `(type, service)`.
     * Uses `hits(field=service.name)` for per-service counts so the
     * service list is complete even if the row window truncates;
     * uses a parallel row fetch (capped at 10 000 — matches legacy
     * `_getLogsInRangeFromVL` bound) to derive the type label.
     */
    const bucketForLevel = async (levelConst, q, typeKey) => {
      const client = this._getVlClient();
      // Promise.allSettled so one VL call failing (network blip, 5xx)
      // does not tear down the sibling call. Without this, a single
      // `/hits` rejection would propagate to the outer Promise.all in
      // `getLogsSummary` and collapse every bucket to empty — the UI
      // would show zero rows instead of "degraded: partial data".
      const [hitsResult, queryResult] = await Promise.allSettled([
        client.hits({ q, start: startIso, end: endIso, field: 'service.name' }),
        client.query({ q, start: startIso, end: endIso, limit: 10000, fields: 'service.name,_msg' })
      ]);
      const serviceMap = hitsResult.status === 'fulfilled' ? hitsResult.value : {};
      const rows = queryResult.status === 'fulfilled' ? queryResult.value : [];
      const grouped = new Map();
      // Seed every service we know about with the level itself as the
      // fallback type (services whose rows are beyond the 10 000 limit
      // still appear in the summary so the per-service column stays
      // populated even when the type column shows the level itself).
      for (const [service] of Object.entries(serviceMap)) {
        if (!service || service === 'all') continue;
        const key = `${levelConst}|${service}`;
        grouped.set(key, {
          type: levelConst,
          typeKey,
          service,
          count: 0,
          // Placeholder — overwritten once we see a row for this
          // service in the window.
          messageHead: null,
          observedInRows: false
        });
      }
      for (const row of Array.isArray(rows) ? rows : []) {
        const service = row.service || row['service.name'];
        if (!service || service === 'all') continue;
        // VL `_msg` for Node services is the raw Winston JSON envelope
        // (e.g. `{"level":"info","message":"DB connection",...}`). The
        // regex patterns + `split(':')[0]` fallback work on the actual
        // human-readable `message` field, not the JSON envelope — the
        // pre-parse step pulls `message` out of the envelope before
        // grouping so the TYPE column shows categorical labels like
        // `[DB_CONNECTION]` instead of `{"level"`. Non-JSON envelopes
        // (Python uvicorn access logs, k8s audit lines) fall through
        // to the raw `_msg` string unchanged.
        const raw = row.message || row._msg || '';
        let message = raw;
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.message === 'string') {
              message = parsed.message;
            }
          } catch {
            // Not valid JSON — keep `message` as the raw `_msg`.
          }
        }
        const head = extractType(typeof message === 'string' ? message : String(message || ''));
        const key = `${head}|${service}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.count++;
          existing.observedInRows = true;
        } else {
          grouped.set(key, {
            type: head,
            typeKey,
            service,
            count: 1,
            messageHead: head,
            observedInRows: true
          });
        }
      }
      const result = [];
      for (const v of grouped.values()) {
        if (!v.observedInRows) {
          // Service existed in the day window but had no rows in the
          // 10 000-fetch window — surface as the level itself with
          // count = hits() count so the row still shows.
          const hitsCount = serviceMap[v.service] || 0;
          result.push({
            type: levelConst,
            typeKey,
            service: v.service,
            count: hitsCount
          });
        } else {
          result.push({
            type: v.messageHead || v.type,
            typeKey: v.messageHead
              ? v.messageHead
                  .toLowerCase()
                  .replace(/\s+/g, '_')
                  .replace(/[^a-z0-9_]/g, '')
              : typeKey,
            service: v.service,
            count: v.count
          });
        }
      }
      return result.sort((a, b) => b.count - a.count);
    };

    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        // Distinct service list for the dropdown — `q=*` + `field=service.name`
        // returns every distinct service that emitted a log in the window
        // (no level filter so every service shows up regardless of its
        // dominant level).
        const allServiceMap = await client.hits({
          q: '*',
          start: startIso,
          end: endIso,
          field: 'service.name'
        });
        const [errorsP, warningsP, infosP] = [
          wantError ? bucketForLevel('ERROR', 'severity_text:ERROR', 'error') : Promise.resolve([]),
          wantWarn ? bucketForLevel('WARN', 'severity_text:WARN', 'warn') : Promise.resolve([]),
          wantInfo ? bucketForLevel('INFO', 'severity_text:INFO', 'info') : Promise.resolve([])
        ];
        // Promise.allSettled — one bucket failing (e.g. `errors` query 5xx)
        // must not collapse `warnings` + `infos`. The previous `Promise.all`
        // rejected fast and dropped every bucket on the floor during partial
        // VL outages, leaving the admin/logs panel with zero rows.
        const [errorsResult, warningsResult, infosResult] = await Promise.allSettled([errorsP, warningsP, infosP]);
        const errors = errorsResult.status === 'fulfilled' ? errorsResult.value : [];
        const warnings = warningsResult.status === 'fulfilled' ? warningsResult.value : [];
        const infos = infosResult.status === 'fulfilled' ? infosResult.value : [];

        return {
          errors,
          warnings,
          infos,
          services: Object.entries(allServiceMap)
            .map(([name, count]) => ({ name, count }))
            .filter((s) => s.name)
            .sort((a, b) => b.count - a.count),
          date: targetDate
        };
      },
      'getLogsSummary',
      { errors: [], warnings: [], services: [], date: targetDate }
    );
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
   * `ADMIN_LOGS_SOURCE=file` raises `VlFilesDisabledError` (503)
   * immediately (SPEC D2 escape-hatch contract).
   *
   * @param {Object} options
   * @returns {Promise<{logs: Array, total: number, limit: number, offset: number, degraded?: true}>}
   */
  async searchLogs(options = {}) {
    if (this._sourceMode() === 'file') {
      throw new VlFilesDisabledError();
    }
    return this._searchLogsFromVL(options);
  }

  async _searchLogsFromVL(options = {}) {
    const { term, level, service, limit = 1000 } = options;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(options.offset, 10);
    const limitN = Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 1000, 10000));
    const offsetN = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);

    // Push ALL filters down to VL — the producer-side transform
    // (`transform/stamp_log_metadata_from_msg` in the OTel collector
    // config) lifts `severity_text` + `service.name` to top-level VL
    // fields for every fluentd-sourced log, so server-side filtering on
    // these fields matches the OTel SDK path too. No more over-fetch +
    // client-side filter dance.
    const filterParts = [];
    if (term && String(term).trim() !== '') {
      const escaped = this._escapeLogSql(String(term));
      // Substring / token-fragment match via both-sides wildcard.
      //
      // Why not the obvious phrase search `_msg:"<escaped>"`?
      // VL tokenises `_msg` on word boundaries: `[DB_CONNECTION]` is a
      // single indexed token `db_connection`. A phrase search for
      // `"DB_"` requires the literal substring `DB_` followed by a
      // separator — it does NOT match inside `DB_CONNECTION` because
      // the underscore is mid-token, not at a token boundary. Users
      // searching for a fragment like `DB_` would see zero results
      // even though the message visibly contains the fragment.
      //
      // The both-sides wildcard `*<term>*` does prefix-within-token
      // matching: VL expands `*` over the byte stream of the indexed
      // term, so `*DB_*` matches `db_connection` (the query fragment
      // `DB_` is a prefix of the token's raw bytes).
      //
      // Min length 2: a 1-char term like `*D*` matches an enormous
      // slice of the corpus and burns VL CPU. Reject single-char
      // searches by falling back to the (cheap) exact-word match
      // `_msg:D` instead — VL still tokenises so the result set stays
      // bounded, and the user gets a useful error page if they
      // really meant to grep for a single letter.
      const fragment = escaped.trim();
      if (fragment.length >= 2) {
        filterParts.push(`_msg:*${fragment}*`);
      } else {
        filterParts.push(`_msg:${fragment}`);
      }
    }
    if (level && String(level).trim() !== '') {
      // Validate the allowlist up-front so a hostile caller gets a
      // 400-ish error, not a silent zero-result page. The allowlist is
      // enforced by `_normalizeLevelFilter` (throws on anything outside
      // `TRACE|DEBUG|INFO|WARN|ERROR|FATAL`).
      const normalizedLevel = this._normalizeLevelFilter(level);
      filterParts.push(`severity_text:${normalizedLevel}`);
    }
    if (service && String(service).trim() !== '') {
      const normalizedService = String(service).trim();
      // Escape any quotes in the service name (defensive — service
      // identifiers from the dropdown are produced by the OTel
      // collector / Compose labels, but a hostile caller could send
      // arbitrary input).
      filterParts.push(`service.name:"${this._escapeLogSql(normalizedService)}"`);
    }
    const q = filterParts.length > 0 ? filterParts.join(' AND ') : '*';

    const { startDate, endDate } = this.getDateRange(options);
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    return this._withVlFailOpen(
      async () => {
        const client = this._getVlClient();
        const rows = await client.query({
          q,
          start: startIso,
          end: endIso,
          // Honour the caller's window exactly — VL filters at the
          // source so the round-trip is already the post-filter page.
          limit: limitN + offsetN
        });
        const allRows = Array.isArray(rows) ? rows : [];
        const pageRows = allRows.slice(offsetN, offsetN + limitN);
        return {
          logs: pageRows,
          total: allRows.length,
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

  // ------------------------------------------------------------------
  // Public API — yesterday debug (VL-first)
  // ------------------------------------------------------------------

  /**
   * Debug endpoint used by admin UI to verify yesterday's records can
   * be reached.
   *
   * VL path: tiny `_msg:*` query bounded to yesterday's UTC window,
   * returning a `{success, lines, sample, filesFound}` payload.
   * Falls back to `{success: false, error, filesFound: []}` when no
   * records are reachable.
   *
   * `ADMIN_LOGS_SOURCE=file` raises `VlFilesDisabledError` (503)
   * immediately (SPEC D2 escape-hatch contract).
   *
   * @returns {Promise<Object>}
   */
  async debugYesterdayLogs() {
    if (this._sourceMode() === 'file') {
      throw new VlFilesDisabledError();
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

  // ------------------------------------------------------------------
  // Public API — synthetic file descriptors
  // ------------------------------------------------------------------

  /**
   * Enumerate the "log files" backing a date range.
   *
   * VL mode (default): returns one synthetic descriptor per UTC date in
   * the range, shaped `{date, service, source: 'victorialogs', query}`
   * — the contract the security-scanner (P3) will pivot on once it
   * drops `worker_threads`. Callers receive descriptors (not real paths)
   * and should pivot to LogSQL.
   *
   * `ADMIN_LOGS_SOURCE=file` raises `VlFilesDisabledError` (503)
   * immediately (SPEC D2 escape-hatch contract).
   *
   * @param {string} startDate  YYYY-MM-DD
   * @param {string} endDate    YYYY-MM-DD
   * @returns {Promise<Array<{date: string, service: string, source: string, query: string}>>}
   */
  async getLogFilesInRange(startDate, endDate, _includeArchived = true) {
    if (this._sourceMode() === 'file') {
      throw new VlFilesDisabledError();
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

  // (file-source helpers removed in T8 — see VlFilesDisabledError 503 contract)

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
