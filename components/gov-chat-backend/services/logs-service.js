// components/gov-chat-backend/services/logs-service.js
//
// VictoriaLogs single-channel rewrite (T0-T8): every public log API
// (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`,
// outages are surfaced as a typed `VlUnavailableError` (503
// `vl_unreachable`) so the route layer renders the standard
// `{error, message}` envelope — no silent fallback, no
// `VL_FAIL_OPEN` graceful-degradation envelope, no file-source
// escape hatch.
'use strict';

const { runInBackgroundSpan } = require('../shared-lib/tracing-background');

const { logger } = require('../shared-lib');
const { isValidDateStr } = require('./path-sanitizer');

// Canonical log-type patterns used by `_getLogsSummaryFromVL()` to
// project a summary rollup. Hoisted to module scope so the constant
// can be reused / unit-tested without re-allocating per call. Frozen
// so accidental mutation in a consumer doesn't corrupt the next call.
const SUMMARY_PATTERNS = Object.freeze([
  Object.freeze({ regex: /connection timeout/i, type: 'connectionTimeout' }),
  Object.freeze({ regex: /database query failed/i, type: 'databaseFailed' }),
  Object.freeze({ regex: /authentication failure/i, type: 'authFailed' }),
  Object.freeze({ regex: /invalid token/i, type: 'invalidToken' }),
  Object.freeze({ regex: /disk space below threshold/i, type: 'lowDiskSpace' }),
  Object.freeze({ regex: /slow query performance/i, type: 'slowQuery' }),
  Object.freeze({ regex: /rate limit approaching/i, type: 'rateLimit' }),
  Object.freeze({ regex: /ENOENT: no such file or directory/i, type: 'fileNotFound' })
]);

/**
 * Typed error raised when the VictoriaLogs adapter throws a
 * connection-class failure (ECONNREFUSED / ENOTFOUND / ETIMEDOUT /
 * ECONNABORTED / `VictoriaLogsHealthError` after retry exhaustion /
 * 5xx upstream). Carries the standard `{error: 'vl_unreachable',
 * message}` body the global error middleware at `index.js` renders as
 * a 503 response via `err.statusCode` + `err.body`.
 *
 * ECONNABORTED is the axios-specific code raised on request timeout
 * (see `axios/lib/adapters/http.js` AxiosError.ECONNABORTED + the
 * "timeout of <ms>ms exceeded" message) — without it the `VL_QUERY_TIMEOUT_MS`
 * budget falls through to the generic 500 path.
 */
class VlUnavailableError extends Error {
  constructor(message = 'VictoriaLogs is currently unreachable') {
    super(message);
    this.name = 'VlUnavailableError';
    this.statusCode = 503;
    this.body = {
      error: 'vl_unreachable',
      message
    };
  }
}

/**
 * A caller-supplied filter (`level`, `service`) failed validation.
 *
 * Distinct from `VlUnavailableError`: this is a 400 — the request itself
 * is wrong, not the backend. Carrying `statusCode` + `body` lets the
 * global error middleware render it verbatim, the same contract the
 * 503 uses. Without it a bad `?level=` produced a zero-row 200, which
 * the admin UI renders as "no logs", indistinguishable from a quiet
 * system.
 */
class InvalidFilterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidFilterError';
    this.statusCode = 400;
    this.body = {
      error: 'invalid_filter',
      message
    };
  }
}

/**
 * VictoriaLogs answered, but not with a LogSQL verdict: the endpoint
 * itself is wrong, or the request was throttled.
 *
 * Distinct from both neighbours. `InvalidFilterError` (400) means the
 * query was rejected as malformed and VL said why — the operator typed
 * something unparseable. `VlUnavailableError` (503) means the request
 * never got an answer. This sits between: a 404 is a deployment fault
 * (wrong `VICTORIALOGS_URL`, a path the version no longer serves, a proxy
 * in front), and reporting that as an invalid filter sends the operator
 * to debug their level/service dropdown, which is not where the problem
 * is.
 *
 * 502 because the backend is a gateway to a store that misbehaved and
 * the caller did nothing wrong.
 */
class VlEndpointError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'VlEndpointError';
    this.statusCode = 502;
    this.vlStatus = status;
    this.body = {
      error: 'vl_endpoint',
      message
    };
  }
}

/**
 * Service for managing system logs.
 *
 * Single channel: every public log API routes through
 * `VictoriaLogsClient`. Outages are surfaced as `VlUnavailableError`
 * (503 `vl_unreachable`) — no silent fallback, no
 * `VL_FAIL_OPEN` graceful-degradation envelope, no file-source
 * escape hatch. The legacy file-source code path is removed (the
 * `ADMIN_LOGS_SOURCE` env var is now ignored).
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
  // Test seams + VL client
  // ------------------------------------------------------------------

  /**
   * Test/dependency-injection seam for the MELT client. Lazily built on
   * first use; production callers go through `_getVlClient()`.
   *
   * @param {import('../../shared/lib/melt').VictoriaLogsClient|null} client
   */
  setVictoriaLogsClient(client) {
    this._vlClient = client;
    // Clear the cached single-flight promise so the next caller after a
    // swap does not await a stale rejection from the previous VL outage.
    // Without this, `setVictoriaLogsClient(null)` followed by a real
    // VL outage retries the previously-cached rejection instead of
    // building a fresh client.
    this._vlClientPromise = null;
  }

  /**
   * Lazy constructor for the MELT adapter. Production code skips the
   * startup health probe — the probe is triggered on the first
   * request anyway, and constructor-time probing in Jest hangs the suite.
   *
   * The constructor is wrapped in a single-flight promise so concurrent
   * first-callers (Express handles N parallel /api/admin/logs requests)
   * construct exactly one client — without this guard, three parallel
   * callers build three clients, each runs the 3-attempt health probe
   * for a total of 9 outbound probes during a VL outage (3 callers ×
   * 3 attempts), and the axios pool fragments across the three
   * independent adapters.
   */
  _getVlClient() {
    if (this._vlClient) return this._vlClient;
    if (this._vlClientPromise) return this._vlClientPromise;
    const melt = require('../shared-lib/melt');
    if (!melt || !melt.VictoriaLogsClient) {
      throw new Error('VictoriaLogsClient is not available on the MELT seam');
    }
    this._vlClientPromise = (async () => {
      const client = new melt.VictoriaLogsClient({
        // Tests pass `{skipHealthProbe: true}` via the
        // option; production skips the flag and the adapter probes lazily.
        skipHealthProbe: process.env.NODE_ENV === 'test'
      });
      // First reference completes the assignment; subsequent callers
      // see `_vlClient` set and skip the construction path entirely.
      this._vlClient = client;
      this._vlClientPromise = null;
      return client;
    })().catch((err) => {
      // Reset on rejection so next call retries (no pod restart).
      this._vlClientPromise = null;
      throw err;
    });
    return this._vlClientPromise;
  }

  /**
   * Classify a thrown error as a VL outage (connection / 5xx) and
   * re-throw as a typed `VlUnavailableError`. Validation and
   * programmer errors propagate unchanged so the route layer keeps
   * its existing 400 / 500 semantics.
   *
   * Static so non-LogsService callers (e.g. `AdminDashboardService`)
   * can reuse the same classification without instantiating a
   * LogsService.
   *
   * @param {Error & {code?: string, response?: {status?: number}}} err
   */
  static _isVlUnavailable(err) {
    return Boolean(
      err &&
      (err.name === 'VictoriaLogsHealthError' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.code === 'EHOSTUNREACH' ||
        // node-fetch / undici message-form failures (e.g. "socket hang up")
        (typeof err.message === 'string' && /socket hang up/i.test(err.message)) ||
        (err.response &&
          typeof err.response.status === 'number' &&
          err.response.status >= 500 &&
          err.response.status < 600))
    );
  }

  static _vlOrThrow(err) {
    if (LogsService._isVlUnavailable(err)) {
      throw new VlUnavailableError();
    }
    // A 4xx from VictoriaLogs is the query being rejected, not the query
    // service being down: a LogSQL expression it cannot parse answers 400
    // with a message naming the offending fragment. Surfacing that as
    // `InvalidFilterError` returns VL's own text, so the operator sees
    // what to fix. Left unclassified it reached the global handler with no
    // `.statusCode` and became a bare 500 "An unexpected error occurred",
    // which is what a multi-word search term used to produce.
    if (LogsService._isVlBadRequest(err)) {
      throw new InvalidFilterError(LogsService._vlParseMessage(err));
    }
    if (LogsService._isVlEndpointFault(err)) {
      throw new VlEndpointError(
        LogsService._vlStatusOf(err),
        `VictoriaLogs answered ${LogsService._vlStatusOf(err)} to the admin log query. That is an endpoint fault, not a filter problem — check VICTORIALOGS_URL points at the VictoriaLogs root and not at a stale sub-path.`
      );
    }
    // 429 is capacity rather than a fault, and the operator action is the
    // same as for any transient: come back later. The 503 keeps it in the
    // outage family for monitoring while the body names the real cause.
    if (LogsService._isVlThrottled(err)) {
      throw new VlUnavailableError('VictoriaLogs is rate-limiting admin log queries; retry shortly.');
    }
    throw err;
  }

  /**
   * True when VictoriaLogs rejected the query rather than failing to
   * answer it. 4xx only — 401/403 would be a tenant/credential problem,
   * which is a configuration fault an operator still needs to see
   * distinctly, so they are excluded here and surface as 500.
   */
  static _vlStatusOf(err) {
    const status = err && err.response && err.response.status;
    return typeof status === 'number' ? status : null;
  }

  /**
   * A 400 is the only status that means "LogSQL rejected this query".
   * The other 4xx each mean something else and are routed separately in
   * `_vlOrThrow` — see there for why.
   */
  static _isVlBadRequest(err) {
    return LogsService._vlStatusOf(err) === 400;
  }

  /** 429 — the store answered, it simply has no capacity right now. */
  static _isVlThrottled(err) {
    return LogsService._vlStatusOf(err) === 429;
  }

  /**
   * 404 / 405 and any other non-400, non-credential, non-throttle 4xx:
   * the address we queried is not one VictoriaLogs serves. Deployment
   * fault, not caller fault.
   */
  static _isVlEndpointFault(err) {
    const status = LogsService._vlStatusOf(err);
    return (
      status !== null &&
      status >= 400 &&
      status < 500 &&
      status !== 400 &&
      status !== 401 &&
      status !== 403 &&
      status !== 429
    );
  }

  /**
   * Extract whatever VictoriaLogs said was wrong with the query.
   *
   * VL answers a parse failure with a JSON body whose message names the
   * fragment and the position. That text is the whole value here: it is
   * the only thing that tells the operator which of their filters to
   * edit. Falls back to a generic line when the body is absent or
   * unparseable, so the caller always gets a 400 with a message rather
   * than a 500 with nothing.
   */
  static _vlParseMessage(err) {
    const data = err && err.response && err.response.data;
    if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 500);
    if (data && typeof data === 'object') {
      const msg = data.error || data.message || (Array.isArray(data.errors) && data.errors[0]);
      if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 500);
    }
    return 'VictoriaLogs rejected the query. Check the log level and service filters.';
  }

  // ------------------------------------------------------------------
  // Public API — log search (VL-first)
  // ------------------------------------------------------------------

  /**
   * Fetch logs for a time window, returning the canonical envelope.
   *
   * VL path is the only path: issues a LogSQL query via
   * `VictoriaLogsClient.query` and slices the result for the
   * requested offset/limit window. Outages from VL are surfaced
   * as a typed `VlUnavailableError` (503 `vl_unreachable`) so
   * the route layer renders the standard `{error, message}` envelope.
   *
   * Note on pagination: VictoriaLogs' `/_internal/logsql/query` endpoint
   * accepts only a `limit` parameter — there is **no native offset**. The
   * adapter passes `limit = limit + offset` (the "window") and this
   * method then slices `[offset, offset + limit)` client-side. Wide
   * ranges therefore download the full window every call; an explicit
   * `q` filter and a tight window are how we keep the payload bounded.
   *
   * Envelope shape — reviewers will reject future drift from this contract:
   * ```
   * {
   *   logs:  VictoriaLogsRow[],
   *   total: number,
   *   limit: number,
   *   offset: number
   * }
   * ```
   *
   * @param {Object} options
   * @param {string} [options.start]    ISO 8601 lower bound.
   * @param {string} [options.end]      ISO 8601 upper bound.
   * @param {string} [options.q]        LogSQL query. Default '*'.
   * @param {number} [options.limit=100]  Effective page size.
   * @param {number} [options.offset=0]   Page offset for pagination.
   * @param {string} [options.dateRange]  'today' | 'yesterday' | 'week' |
   *                                      'month' | 'custom'.
   * @returns {Promise<{
   *   logs: import('../../shared/lib/melt/types').VictoriaLogsRow[],
   *   total: number,
   *   limit: number,
   *   offset: number
   * }>}
   */
  async getLogsInRange(options = {}) {
    try {
      // ``start`` / ``end`` are the ISO window inputs the VL adapter speaks
      // natively. ``startDate`` / ``endDate`` are the admin UI's aliases
      // (date-only strings forwarded by AdminDashboardService.getLogs); they
      // always win over the named ``dateRange`` derivation, so a Custom picker
      // does not silently fall into ``_defaultStartIso('custom')`` (which
      // throws) when the picker has already populated both bounds.
      // ``service`` / ``level`` are pushed to VL as filter clauses — the
      // service dropdown must have a visible effect on the rows returned,
      // not be silently dropped here.
      const { start, end, startDate, endDate, q = '*', limit = 100, offset = 0, service, level } = options;
      const parsedLimit = parseInt(limit, 10);
      const parsedOffset = parseInt(offset, 10);
      const limitN = Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 10000));
      const offsetN = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);

      // ``startDate`` / ``endDate`` take precedence when present (admin "Custom"
      // picker), then explicit ISO ``start`` / ``end`` (programmatic callers),
      // then the named-range default.
      const startIso = startDate || start || this._defaultStartIso(options.dateRange);
      const endIso = endDate || end || this._defaultEndIso(options.dateRange);

      // Sanitize `q` before forwarding to VictoriaLogs LogSQL. Internal callers
      // are expected to pre-build a safe `q` (see `_escapeLogSql` consumers
      // like `searchLogs` and the service.name filter), but a future route
      // forwarding user input here would be an injection sink — a free-text
      // term containing `_msg:` or a stray quote would re-anchor the query.
      // The `*` sentinel is the only LogSQL token we let through unescaped;
      // every other value gets wrapped as an escaped phrase on `_msg`.
      // All-special-character input falls through `_escapeLogSql` to an
      // empty fragment — wrap that as `*` (return all rows) so the
      // `_msg:""` syntax never reaches VL (which would reject with a
      // parse error and surface as 503 + `vl_unreachable`).
      const escapedQ = q === '*' || q === undefined || q === null || q === '' ? '' : this._escapeLogSql(q);
      const msgTerm = !escapedQ.trim() ? '' : `_msg:"${escapedQ}"`;

      // Build the per-row filter: free-text term ANDed with optional
      // service.name / severity_text clauses. service.name + severity_text
      // are top-level VL fields for every fluentd-sourced log (the OTel
      // collector transform `stamp_log_metadata_from_msg` lifts them).
      const filterParts = [msgTerm].filter(Boolean);
      if (!LogsService._isAbsentFilter(service)) {
        const safeService = this._escapeLogSql(String(service).trim());
        // A service that is nothing but LogSQL punctuation (`***`, `?`, a
        // run of spaces) escapes to whitespace. Dropping the clause —
        // which is what `.trim()` guarding used to do — silently removed
        // the ONLY filter, turning a degenerate filter into "return the
        // entire log stream": a large `total` and an operator who has
        // narrowed to one service looking at everything. Say so instead.
        if (!safeService.trim()) {
          throw new InvalidFilterError(
            'service filter contains no searchable characters — drop it or pass a real service name'
          );
        }
        filterParts.push(`service.name:"${safeService}"`);
      }
      if (!LogsService._isAbsentFilter(level)) {
        // Validate against the allowlist before interpolating. An
        // unrecognised level used to build `severity_text:"GARBAGE"`,
        // which VL answered with zero rows and a 200 — the admin UI
        // showed an empty logs panel and the operator read it as "the
        // system was quiet" rather than "your filter is wrong".
        // Throws InvalidFilterError → 400 with the allowed set.
        filterParts.push(`severity_text:"${this._normalizeLevelFilter(level)}"`);
      }
      const safeQ = filterParts.length === 0 ? '*' : filterParts.join(' AND ');
      const client = await this._getVlClient();
      const window = limitN + offsetN;
      // Run the page fetch + the total-count fetch in parallel — both
      // hit the same VL query body so the cost is one extra round-trip,
      // and the `total` envelope field must reflect VL's match count
      // (not the row slice) for pagination to tell "fits one page"
      // from "truncated".
      //
      // The count() call is wrapped in a try-catch (not just
      // `.catch()`) so a SYNC throw — e.g. `client.count` is undefined
      // because a test mock didn't stub it — doesn't propagate before
      // the promise chain attaches. A missing total is less critical
      // than a missing page; fall back to the page length.
      const countPromise = (async () => {
        try {
          return await client.count({ q: safeQ, start: startIso, end: endIso });
        } catch {
          return null;
        }
      })();
      const [rows, totalRaw] = await Promise.all([
        client.query({ q: safeQ, start: startIso, end: endIso, limit: window }),
        countPromise
      ]);
      const pageRows = Array.isArray(rows) ? rows.slice(offsetN, offsetN + limitN) : [];
      const total = typeof totalRaw === 'number' ? totalRaw : Array.isArray(rows) ? rows.length : 0;
      return {
        logs: pageRows,
        total,
        limit: limitN,
        offset: offsetN
      };
    } catch (err) {
      LogsService._vlOrThrow(err);
    }
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
    throw new InvalidFilterError(
      dateRange === 'custom'
        ? "dateRange 'custom' requires both startDate and endDate. Accepted values: today, yesterday, week, month, custom."
        : `unknown dateRange ${JSON.stringify(dateRange)}. Accepted values: today, yesterday, week, month, custom.`
    );
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
    throw new InvalidFilterError(
      dateRange === 'custom'
        ? "dateRange 'custom' requires both startDate and endDate. Accepted values: today, yesterday, week, month, custom."
        : `unknown dateRange ${JSON.stringify(dateRange)}. Accepted values: today, yesterday, week, month, custom.`
    );
  }

  // ------------------------------------------------------------------
  // Public API — log summary (VL-first)
  // ------------------------------------------------------------------

  /**
   * Local-calendar-day window for a `YYYY-MM-DD` string. The date is
   * interpreted in the host's local zone and returned as ISO instants,
   * so every endpoint that names a calendar day agrees on which 24 hours
   * it means.
   */
  _localDayWindow(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  /**
   * Get logs summary grouped by type and service for the given date.
   *
   * Single channel: post-F11 fires ONE `query()` per level bucket
   * (2 round-trips for the default ERROR+WARN set) instead of
   * the previous dual `hits()+query()` design. The service list derives
   * from the union of bucket rows grouped by `service.name` — no
   * separate `hits()` call.
   *
   * Failure handling:
   * - Partial outage (one requested bucket fails): the outer response
   *   carries `degraded: true` with whatever data is available.
   * - Complete outage (every REQUESTED bucket fails): throws
   *   `VlUnavailableError` so the route renders 503 instead of
   *   200 + empty arrays + degraded:true (which masked the outage
   *   from monitoring and left the admin panel silent). Counting the
   *   requested buckets matters: a bucket skipped by a level filter
   *   resolves to a `degraded: false` stand-in, so testing all buckets
   *   would never fire for a single-level request.
   *
   * Two buckets only: ERROR (plus FATAL) and WARN. INFO is deliberately
   * NOT summarised — it is the bulk of the log volume and nothing in a
   * dashboard tile is actionable from it. Querying it cost a full VL
   * round-trip on every dashboard load whose rows the UI then discarded.
   * Use the log list / search endpoints to inspect INFO.
   *
   * @param {Object} options
   * @param {string} [options.date]    YYYY-MM-DD.
   * @param {string} [options.level]  Optional level filter. Only levels
   *   with a bucket (ERROR, WARN, FATAL) are accepted; anything else
   *   throws InvalidFilterError rather than returning an empty summary.
   * @returns {Promise<{errors: Array, warnings: Array, services: Array, date: string, degraded?: boolean}>}
   */

  async getLogsSummary(options = {}) {
    try {
      const { date, level } = options;
      const targetDate = date || new Date().toISOString().split('T')[0];
      if (!isValidDateStr(targetDate)) {
        return { errors: [], warnings: [], services: [], date: targetDate };
      }
      // `date` names a CALENDAR day, so the window is that day in local
      // time — the same boundary `_defaultStartIso`/`_defaultEndIso` use
      // for the list and search endpoints. Building it as
      // `T00:00:00.000Z` made the summary describe a different 24 hours
      // than the list beside it on any host that is not UTC. The
      // containers run UTC, which is why this never surfaced in the
      // deployed stack.
      const { start: startIso, end: endIso } = this._localDayWindow(targetDate);

      // Honour the documented `level` filter: when provided, restrict to
      // that level only; otherwise bucket ERROR + WARN.
      //
      // The comparison runs against the CANONICAL level, so the legacy
      // `WARNING` synonym and lower-case input resolve the same way they
      // do in the two list endpoints. Comparing the raw string meant
      // `level=WARNING` matched no bucket at all: every flag went false,
      // all three queries were skipped, and the caller got a successful
      // but empty response — indistinguishable from a day with no logs.
      //
      // The allowlist has six levels but the response has three buckets.
      // FATAL is an error and DEBUG/TRACE are informational, so each maps
      // onto the bucket an operator means. Without this they were
      // allowlisted-but-unbucketed: a valid level that returned nothing.
      const canonicalLevel = LogsService._isAbsentFilter(level) ? null : this._normalizeLevelFilter(level);
      // This summary has exactly two buckets. A level that maps to neither
      // is rejected rather than silently returning an empty summary —
      // `level=INFO` previously skipped every query and answered 200 with
      // nothing, which reads as "a quiet day" instead of "no such bucket".
      if (
        canonicalLevel !== null &&
        canonicalLevel !== 'ERROR' &&
        canonicalLevel !== 'WARN' &&
        canonicalLevel !== 'FATAL'
      ) {
        throw new InvalidFilterError(
          `the summary only covers ERROR, WARN and FATAL (got ${JSON.stringify(level)}). ` +
            `Use /api/admin/logs?level=${JSON.stringify(level)} to list that level.`
        );
      }
      // FATAL is an error, so it shares the error bucket.
      const bucket = canonicalLevel === 'FATAL' ? 'ERROR' : canonicalLevel;
      const wantError = bucket === null || bucket === 'ERROR';
      const wantWarn = bucket === null || bucket === 'WARN';

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
      // A leading timestamp must never become the event category.
      //
      // `extractType` falls back to `message.split(':')[0]`, and for a
      // syslog-shaped line the first colon falls INSIDE the clock:
      // `Mon Sep 28 14:03:18 2026 -> Can't download daily.cvd` produced
      // the category "Mon Sep 28 14" — a timestamp presented as an error
      // type, which is what the admin panel was showing.
      //
      // Deliberately NOT a table of timestamp formats. Enumerating them
      // leaves the bug one line-1 rotation away: a localised syslog
      // (`lun. 28 sept. 14:03:18`), an ISO offset (`...+02:00`) or a
      // slash date (`2026/09/28 14:03:18`) all slip past a pattern list
      // and reintroduce a bare clock fragment. Instead the rule anchors
      // on the one thing every human-readable timestamp has — the clock
      // — and cuts the message just after the last clock token that
      // STARTS inside the leading region. The start anchor matters: a
      // message may legitimately contain a time further along
      // (`... failed: timeout after 3s at 10:00:00`) and cutting there
      // would amputate the real category.
      const CLOCK = /\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
      const CLOCK_WINDOW = 40;
      const CLOCK_ANCHOR = 20;
      const startsWithTimestamp = (text) =>
        /\d{1,2}:\d{2}/.test(text.slice(0, CLOCK_WINDOW)) ||
        /^\s*\d{8,}/.test(text) ||
        /^.{0,12}?\d{4}[-/]\d{2}[-/]\d{2}/.test(text);

      // The clock's POSITION cannot tell a leading timestamp from a time
      // mentioned inside the message: `Mon Sep 28 14:03:18` and
      // `Job abc at 14:03:18` put the clock at the same index. What
      // separates them is the prefix — a date before the clock, prose
      // after it. So the cut is gated on the prefix being date-shaped,
      // which keeps every message that merely mentions a time exactly as
      // it was before this rule existed. Without that gate, every
      // `… at HH:MM:SS failed` collapsed into one row named `failed`.
      const MONTH_OR_DAY =
        /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|f[eé]vr|mars|avr|mai|juin|juil|ao[uû]t|sept?|octo|novem|d[eé]c|mon|tue|wed|thu|fri|sat|sun|lun|mer|jeu|ven|sam|dim)/i;
      const prefixIsDateShaped = (prefix) => {
        // Purely numeric/separatorial: `2026-09-28T`, `2026/09/28 `, epoch.
        if (/^[\s0-9T:+\-.,/]*$/.test(prefix)) return true;
        if (/\b\d{4}[-/]\d{2}[-/]\d{2}/.test(prefix)) return true;
        // Otherwise a month or weekday name has to be present. A closed
        // list, not a pattern: month names are the one part of a
        // timestamp that is genuinely a finite vocabulary.
        return prefix.split(/[\s.]+/).some((token) => MONTH_OR_DAY.test(token));
      };

      const stripLeadingTimestamp = (text) => {
        const lead = text.slice(0, CLOCK_WINDOW);
        let cut = 0;
        const scan = new RegExp(CLOCK.source, 'g');
        let match;
        while ((match = scan.exec(lead)) !== null) {
          if (match.index >= CLOCK_ANCHOR) break;
          if (prefixIsDateShaped(lead.slice(0, match.index))) cut = match.index + match[0].length;
        }
        if (cut === 0 && /^\s*\d{8,}/.test(text)) {
          cut = text.match(/^\s*\d{8,}/)[0].length; // epoch-seconds prefix
        }
        if (cut === 0) return text;
        // Drop the punctuation and any bare year the timestamp left behind
        // (`-> 2026 ->`) so the head starts on real content.
        return text.slice(cut).replace(/^[\s.,;:>|>-]*(\d{4}[\s->]*)?/, '');
      };

      const extractType = (message) => {
        if (!message || typeof message !== 'string' || !message.split) {
          return 'Generic Event';
        }
        for (const pattern of summaryPatterns) {
          if (pattern.regex.test(message)) {
            return pattern.type;
          }
        }
        // A message that is nothing but a timestamp strips to empty; the
        // category is then 'Generic Event', never the timestamp itself.
        const stripped = startsWithTimestamp(message) ? stripLeadingTimestamp(message).trim() : message;
        const head = stripped ? stripped.split(':')[0] : 'Generic Event';
        if (head.length > 50) {
          return `${head.substring(0, 50)}...`;
        }
        return head;
      };

      /**
       * Bucket raw VL rows for the requested level by `(type, service)`.
       * Post-F11 the walker no longer calls `hits(field=service.name)`
       * — buckets are populated from query rows only, and the
       * service list derives from the union of bucket rows at the
       * outer level. Row fetch capped at 10 000 (matches
       * getLogsInRange bound) to bound the surface in case of a
       * runaway emit.
       */
      const bucketForLevel = async (levelConst, q, typeKey) => {
        const client = await this._getVlClient();
        // Single VL round-trip per bucket. The previous design fired
        // `hits()` + `query()` in parallel and used the `hits` result
        // ONLY to detect rejection status — its payload was discarded
        // (the row grouping reads `query` rows). Dropping `hits`
        // halves VL load on the most-hit admin endpoint (2 buckets =
        // 2 round-trips instead of 4). Rejection status from `query`
        // alone is sufficient: a query 5xx is what `hits` would have
        // surfaced, and we already log + flag `degraded:true` on any
        // query failure.
        const queryResult = await client
          .query({ q, start: startIso, end: endIso, limit: 10000, fields: ['service.name', '_msg'] })
          .catch((err) => {
            logger.warn(`VL /query failed for ${levelConst} bucket: ${err && err.message}`);
            return { __degraded: true, error: err };
          });
        const degraded = queryResult && queryResult.__degraded === true;
        const rows = degraded ? [] : queryResult;
        const grouped = new Map();
        // Group ONLY the observed rows by (messageHead, service). The
        // previous seed loop (one entry per service from hits(), typed
        // as the level itself) was removed because it added nothing
        // actionable: for a service with sampled rows, the bare
        // "ERROR | backend | 86" duplicate inflated the count without
        // telling the operator WHICH error pattern was missed. For a
        // service with no observed rows (sample truncated by the 10k
        // limit), surfacing "ERROR | svc | N" without a head is also
        // unactionable — the admin can't filter for it, can't drill
        // into it. The total-per-service count for the dropdown comes
        // from the union of bucket rows grouped by `service.name`
        // (see the outer `serviceCounts` Map below) — NOT from a
        // separate `hits()` call.
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
          } else {
            grouped.set(key, {
              type: head,
              typeKey,
              service,
              count: 1,
              messageHead: head
            });
          }
        }
        const result = [];
        for (const v of grouped.values()) {
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
        return { rows: result.sort((a, b) => b.count - a.count), degraded };
      };

      // Service list derives from the union of bucket rows (group by
      // service.name across the ERROR and WARN buckets) instead of a
      // separate `client.hits({q:'*', field:'service.name'})` call.
      // Saves 1 round-trip per dashboard render. Trade-off: the
      // service list covers the levels the caller asked for, not the
      // whole window — a service that only ever emits INFO never
      // reaches this dropdown.
      const [errorsP, warningsP] = [
        wantError
          ? // FATAL is bundled into the error bucket for the summary view
            // (line 498 mapping), but the underlying VL query must catch
            // BOTH severities — Python `logging.fatal()` + the OTel
            // collector's stamp_log_metadata transform write severity_text
            // = 'FATAL' (NOT 'ERROR'). The previous `severity_text:ERROR`
            // clause returned 0 rows for any day with FATAL-only traffic,
            // making the errors bucket silently lie to operators. Use an
            // OR clause to include both.
            bucketForLevel('ERROR', 'severity_text:ERROR OR severity_text:FATAL', 'error')
          : Promise.resolve({ rows: [], degraded: false }),
        // WARN: include WARNING synonym too. The collector's
        // stamp_log_metadata transform preserves Python's `WARNING`
        // (capitalised) as `severity_text=WARNING` — but the backend
        // search/getLogsInRange filters normalise `WARNING`→`WARN`
        // before querying, so this summary tile (which currently
        // queries `severity_text:WARN` only) silently missed every
        // Python WARN row. Match either form.
        wantWarn
          ? bucketForLevel('WARN', 'severity_text:WARN OR severity_text:WARNING', 'warn')
          : Promise.resolve({ rows: [], degraded: false })
      ];
      // Promise.allSettled — one bucket failing (e.g. `errors` query 5xx)
      // must not collapse `warnings`. The previous `Promise.all`
      // rejected fast and dropped every bucket on the floor during partial
      // VL outages, leaving the admin/logs panel with zero rows.
      //
      // `wanted` records which buckets were actually REQUESTED. The
      // skipped ones resolve to a stand-in with `degraded: false`, so
      // they must not count towards the "everything failed" test below —
      // otherwise a single-level request would never be recognised as an
      // outage.
      const wanted = [wantError, wantWarn].filter(Boolean).length;
      const [errorsResult, warningsResult] = await Promise.allSettled([errorsP, warningsP]);
      const errorsOut = errorsResult.status === 'fulfilled' ? errorsResult.value : { rows: [], degraded: true };
      const warningsOut = warningsResult.status === 'fulfilled' ? warningsResult.value : { rows: [], degraded: true };
      // Roll-up: response carries degraded:true if ANY requested bucket
      // had a partial VL outage — operator sees the outage banner instead
      // of a green dashboard with empty buckets.
      const degraded = errorsOut.degraded || warningsOut.degraded;
      // Complete outage (every REQUESTED bucket failed) — re-throw as
      // VlUnavailableError so the route handler renders the typed
      // 503 + {error:'vl_unreachable', message}. Without this,
      // VL being completely down would return 200 + empty arrays
      // + degraded:true, masking the outage from monitoring +
      // leaving the admin panel silent. Partial outages still
      // return degraded:true 200 (the other bucket may have data).
      const failed = Number(errorsOut.degraded) + Number(warningsOut.degraded);
      if (wanted > 0 && failed === wanted) {
        throw new VlUnavailableError();
      }
      // Union rows across buckets to build the service list. Empty
      // service.name (collector-tagged logs without a container name)
      // are filtered out so the dropdown never shows a blank entry.
      //
      // Each row is one (messageHead, service) pair carrying the number
      // of log lines behind it, so the roll-up adds `row.count`. Adding
      // 1 per row counted how many DISTINCT message heads a service
      // emitted, not how much it logged — the dropdown sorted by
      // categorical diversity and a chatty service with one repeated
      // message ranked below a quiet one with many.
      // The dropdown is a FILTER over the log stream, so its source has to
      // be the whole stream. Deriving it from the ERROR/WARN buckets made
      // it a list of services that had something wrong today: a healthy
      // nginx or kong was unselectable, and the operator reading "no
      // entries" after picking one could not tell an empty filter from an
      // impossible one. One extra `hits()` on `service.name` over the same
      // window costs a single round-trip and returns the true per-service
      // volume, which is also what the "(44)" next to each option means.
      const serviceCounts = new Map();
      for (const bucket of [errorsOut.rows, warningsOut.rows]) {
        for (const row of bucket) {
          const name = row.service;
          if (!name) continue;
          serviceCounts.set(name, (serviceCounts.get(name) || 0) + (row.count || 1));
        }
      }
      try {
        const client = await this._getVlClient();
        const allServices = await client.hits({
          q: '*',
          field: 'service.name',
          start: startIso,
          end: endIso
        });
        for (const [name, count] of Object.entries(allServices || {})) {
          if (!name || name === 'all') continue;
          // Bucket roll-ups stay authoritative for services that logged
          // errors; the stream query only adds the ones that did not.
          if (!serviceCounts.has(name)) serviceCounts.set(name, Number(count) || 0);
        }
      } catch (hitsErr) {
        // The dropdown degrades to "services that logged errors" rather
        // than failing the whole summary. A filter list that is short is
        // a far smaller problem than a 500 on the dashboard.
        logger.warn(`VL /hits(service.name) failed for the service filter: ${hitsErr && hitsErr.message}`);
      }

      return {
        errors: errorsOut.rows,
        warnings: warningsOut.rows,
        services: Array.from(serviceCounts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        date: targetDate,
        degraded
      };
    } catch (err) {
      LogsService._vlOrThrow(err);
    }
  }

  // ------------------------------------------------------------------
  // Public API — search (VL-first)
  // ------------------------------------------------------------------

  /**
   * Free-text / level / service search.
   *
   * Single channel: builds a LogSQL query from `term`, `level`,
   * `service` and delegates to `VictoriaLogsClient.query`. Returns
   * the canonical `{logs, total, limit, offset}` envelope. Outages
   * from VL surface as a typed `VlUnavailableError` (503
   * `vl_unreachable`).
   *
   * @param {Object} options
   * @returns {Promise<{logs: Array, total: number, limit: number, offset: number}>}
   */
  async searchLogs(options = {}) {
    try {
      // Run client.query (page rows) AND client.count (total match count) in
      // parallel below — `total` must reflect VL's match count, not the row
      // slice (which under-reports when offset > 0).
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
          // A multi-word term MUST be quoted inside the wildcard. Verified
          // against a live VictoriaLogs v1.50.0: the `*` wrap is greedy from
          // the left, so `_msg:*pool exhausted*` opens a substring filter on
          // `pool` that never closes and the query fails to parse —
          //   400 cannot parse `query` arg: missing ending '*' in the
          //       *"pool"* filter
          // A 400 is not classified as an outage, so it fell through to a
          // generic 500: every free-text search containing a space failed,
          // with an error that named nothing the user typed. The quoted
          // form parses and matches.
          filterParts.push(/\s/.test(fragment) ? `_msg:*"${fragment}"*` : `_msg:*${fragment}*`);
        } else if (fragment.length === 1) {
          // Single-char term: fall back to exact-word match (`_msg:D`)
          // so VL still tokenises; a both-sides wildcard would scan
          // an unbounded slice of the corpus.
          filterParts.push(`_msg:${fragment}`);
        }
        // Empty fragment (all-special-character input): skip the term
        // filter entirely so `_msg:` never reaches VL. The remaining
        // filters (level, service) still apply; the caller sees the
        // rows they asked for, not a 400 from a parse error.
      }
      // `_isAbsentFilter` so `?level=ALL` means "no filter" here exactly
      // as it does in `getLogsInRange` and `getLogsSummary`. Without it
      // the three endpoints on this route family disagreed: `ALL` threw
      // a 400 from the allowlist, and a `service=all` built the literal
      // clause `service.name:"all"` and matched zero rows.
      if (!LogsService._isAbsentFilter(level)) {
        // Validate the allowlist up-front so a hostile caller gets a
        // 400-ish error, not a silent zero-result page. The allowlist is
        // enforced by `_normalizeLevelFilter` (throws on anything outside
        // `TRACE|DEBUG|INFO|WARN|ERROR|FATAL`).
        const normalizedLevel = this._normalizeLevelFilter(level);
        filterParts.push(`severity_text:${normalizedLevel}`);
      }
      if (!LogsService._isAbsentFilter(service)) {
        const normalizedService = String(service).trim();
        // Escape any quotes in the service name (defensive — service
        // identifiers from the dropdown are produced by the OTel
        // collector / Compose labels, but a hostile caller could send
        // arbitrary input).
        const safeService = this._escapeLogSql(normalizedService);
        if (!safeService.trim()) {
          throw new InvalidFilterError(
            'service filter contains no searchable characters — drop it or pass a real service name'
          );
        }
        filterParts.push(`service.name:"${safeService}"`);
      }
      const q = filterParts.length > 0 ? filterParts.join(' AND ') : '*';

      // Derive the window with the SAME helpers `getLogsInRange` uses, so
      // the two endpoints agree on what "today" means.
      //
      // The previous path went through `getDateRange`, which took local
      // midnight and returned `toISOString().split('T')[0]` — a UTC date.
      // This caller then re-anchored that string as UTC midnight. On a
      // host east of Greenwich the two round trips cancel into the
      // previous day, so "today" silently became yesterday; west of it
      // the window started late and dropped the morning. A search for
      // "today" and the logs list for "today" could disagree on the same
      // request.
      const startIso = options.startDate
        ? `${options.startDate}T00:00:00.000Z`
        : this._defaultStartIso(options.dateRange);
      const endIso = options.endDate ? `${options.endDate}T23:59:59.999Z` : this._defaultEndIso(options.dateRange);

      const client = await this._getVlClient();
      const window = limitN + offsetN;
      // Run query + count in parallel — VL match count drives the `total`
      // envelope field (not the row slice length, which only reflects the
      // downloaded window and would under-report when offset > 0). Same
      // `q` body hits the same VL query plan, so the second call is the
      // only extra round-trip.
      //
      // count() is wrapped in try-catch so a SYNC throw (e.g. an older
      // adapter version where `client.count` is undefined) doesn't tear
      // down the page fetch — fall back to the row slice so the UI still
      // renders what it has.
      const countPromise = (async () => {
        try {
          return await client.count({ q, start: startIso, end: endIso });
        } catch {
          return null;
        }
      })();
      const [rows, countResult] = await Promise.all([
        client.query({
          q,
          start: startIso,
          end: endIso,
          // Honour the caller's window exactly — VL filters at the
          // source so the round-trip is already the post-filter page.
          limit: window
        }),
        countPromise
      ]);
      const allRows = Array.isArray(rows) ? rows : [];
      const pageRows = allRows.slice(offsetN, offsetN + limitN);
      return {
        logs: pageRows,
        total: typeof countResult === 'number' ? countResult : allRows.length,
        limit: limitN,
        offset: offsetN
      };
    } catch (err) {
      LogsService._vlOrThrow(err);
    }
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
   *       - A LEADING run of `-` (VL's NOT operator) — internal
   *         hyphens are preserved, since every real OTel service name
   *         is hyphenated and stripping them silently broke the
   *         service filter.
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
    // 1. Drop every LogSQL-significant character (ASCII punctuation +
    //    `!` negation + `|` pipe + `&` intersect + `<>` range + `[]`
    //    sequence — every char that VL tokenises as operator syntax
    //    instead of a literal byte of the indexed term). Without
    //    stripping `!`, an input like `!!!` survives and the wildcard
    //    wrap `_msg:*!!!*` becomes a VL syntax error rather than a
    //    benign zero-result query).
    //
    //    `-` is deliberately NOT in this class. It is a literal byte
    //    inside both wrapping strategies used here (a double-quoted
    //    `service.name:"..."` and the both-sides `*<term>*` wildcard),
    //    and every real OTel service name is hyphenated —
    //    `genieai-chatqna`, `document-repository`, `otel-collector`.
    //    Stripping it here rewrote `genieai-chatqna` to
    //    `genieai chatqna` before interpolation, so the service
    //    dropdown matched zero rows for every service except the
    //    hyphen-free `backend`. A leading run of hyphens is still
    //    removed in step 5, where it would open VL's NOT operator.
    const sanitized = text.replace(/[*?:\\"\n\r\t`(){}=,;!|&<>[\]]/g, ' ');
    // 2. Drop Unicode homoglyphs (curly quotes) by REPLACING them with a
    //    space, not with their ASCII equivalent. Mapping `“”` → `"` here
    //    re-introduces the very byte step 1 just stripped, so
    //    `abc“def` became `service.name:"abc"def"` — a LogSQL parse error
    //    (400) for any text pasted from a word processor or a PDF, which
    //    is precisely the input this step exists to neutralise. A space
    //    removes the character without reintroducing a terminator.
    const noHomoglyphs = sanitized.replace(/[‘’“”]/g, ' ');
    // 3. Strip LogSQL clause keywords so a non-quoted caller cannot
    //    attach `AND level:ERROR` to the filter. Whole-word match,
    //    case-insensitive.
    const noKeywords = noHomoglyphs.replace(/\b(AND|OR|NOT)\b/gi, ' ');
    // 4. Strip ALL single quotes — they survive the wrap today (they
    //    are not LogSQL string terminators) but a future call site may
    //    switch to single-quoted wrapping.
    const noQuotes = noKeywords.replace(/'/g, ' ');
    // 5. Strip hyphens sitting at the START OF A TOKEN, keeping the ones
    //    that join two word characters. A leading run (`-foo`) and an
    //    interior token-start run (`foo -bar`) are both removed. A hyphen
    //    BETWEEN word characters survives, which is what
    //    `genieai-chatqna` and `document-repository` need.
    //
    //    Why the boundary matters: in LogsQL a hyphen opening a token is
    //    the NOT operator, so leaving one in changes the meaning of the
    //    filter rather than its spelling. It cannot silently do so here —
    //    the `*<term>*` call site emits `*foo -bar*`, and VictoriaLogs
    //    rejects that outright ("missing ending '*'"), which surfaced as
    //    an unexplained 500. Stripping the operator is what keeps a
    //    hyphenated search a search instead of an error.
    return noQuotes.replace(/(^|\s)-+/g, '$1');
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
      throw new InvalidFilterError('level filter must be a non-empty string');
    }
    const upper = level.trim().toUpperCase();
    // Map the legacy `WARNING` synonym onto `WARN` so existing
    // callers stay compatible while the underlying level remains
    // allowlisted.
    const canonical = upper === 'WARNING' ? 'WARN' : upper;
    if (!this.ALLOWED_LEVELS.includes(canonical)) {
      throw new InvalidFilterError(
        `level filter must be one of ${this.ALLOWED_LEVELS.join(', ')} (got ${JSON.stringify(level)})`
      );
    }
    return canonical;
  }

  /**
   * The "no filter" sentinel a UI sends when a dropdown is reset. Matched
   * case-insensitively — `?level=ALL` used to fall through to the
   * allowlist check and surface as a 400 on what is really "no filter".
   *
   * @param {unknown} value
   * @returns {boolean}
   */
  static _isAbsentFilter(value) {
    if (value === undefined || value === null) return true;
    const trimmed = String(value).trim();
    return trimmed === '' || trimmed.toLowerCase() === 'all';
  }

  // ------------------------------------------------------------------
  // Public API — yesterday debug (VL-first)
  // ------------------------------------------------------------------

  /**
   * Debug endpoint used by admin UI to verify yesterday's records can
   * be reached.
   *
   * Single channel: tiny `_msg:*` query bounded to yesterday's UTC
   * window, returning a `{success, lines, sample}` payload. Outages
   * surface as `VlUnavailableError` (503 `vl_unreachable`).
   *
   * @returns {Promise<{success: boolean, lines: number, sample: string[]}>}
   */
  async debugYesterdayLogs() {
    try {
      // Same local-calendar-day window as `getLogsInRange` /
      // `searchLogs` / the admin dashboard's error-rate tile, so the two
      // `yesterday` debug endpoints and the list return the same rows.
      const startIso = this._defaultStartIso('yesterday');
      const endIso = this._defaultEndIso('yesterday');
      const client = await this._getVlClient();
      const rows = await client.query({ q: '*', start: startIso, end: endIso, limit: 5 });
      const sample = (rows || []).slice(0, 5).map((row) => (row.message || row._msg || '').slice(0, 120));
      return {
        success: true,
        lines: (rows || []).length,
        sample
      };
    } catch (err) {
      LogsService._vlOrThrow(err);
    }
  }

  // ------------------------------------------------------------------
  // Deprecated public method — kept for backward compat
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
// Export shape — `module.exports` is set ONCE with all named exports
// inlined on the singleton instance, then never mutated. The previous
// `module.exports.LogsService = LogsService` post-assignment was a
// jest.doMock race: jest captures the export snapshot at the moment
// the test calls `jest.doMock('./services/logs-service', ...)`, and
// the post-assignment was sometimes applied AFTER the snapshot — so
// `require('./services/logs-service').LogsService` resolved to
// `undefined` in some test files. Setting every named export in the
// initial object literal eliminates the race (the snapshot always
// sees the complete shape).
module.exports = Object.assign(logsService, {
  LogsService,
  VlUnavailableError,
  InvalidFilterError,
  VlEndpointError
});
