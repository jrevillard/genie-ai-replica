// components/shared/lib/melt/victorialogs-client.js
'use strict';

/**
 * MELT adapter — VictoriaLogs HTTP wire implementation.
 *
 * Concrete adapter for {@link LogQueryRepository} (the abstract MELT
 * port defined in `./index.js`). Translates the vendor-neutral port
 * contract into VictoriaLogs LogSQL HTTP calls:
 *
 *   - `query` → `GET /select/logsql/query?q=...&start=...&end=...
 *                 &limit=...&fields=...`
 *   - `hits`  → `GET /select/logsql/hits?field=...&q=...&start=...
 *                 &end=...`
 *
 * VL 1.50+ canonical tenant headers `AccountID` + `ProjectID` (NOT
 * the legacy `VL-Tenant`) are derived from the constructor `tenantId`
 * (or the `VICTORIALOGS_TENANT_ID` env, default `0:0`) by splitting on
 * `:`. Multi-tenant deployment is out of scope for this rollout; the
 * seam exists for future extension.
 *
 * Health probe is **lazy**, NOT constructor-blocking:
 * triggered on the first `query` / `hits` call, retries 3×5 s against
 * `${baseURL}/health`. Test fixtures pass `{ skipHealthProbe: true }`
 * to bypass the probe entirely. On probe failure (after retries), a
 * typed `VictoriaLogsHealthError` is thrown — `VL_FAIL_OPEN`
 * recognises `ECONNREFUSED` / `ENOTFOUND` / timeout / 5xx uniformly
 * and degrades gracefully.
 *
 * `_normalizeRows` (private) maps the VL wire shape
 * `{_msg, _stream, _time, ...rest}` to the canonical
 * {@link VictoriaLogsRow} 8-sub-shape. `level` defaults to
 * `INFO` (uppercase), `service` to `unknown`, and `fields` excludes
 * the three reserved VL keys (`_msg`, `_stream`, `_time`).
 *
 * CommonJS only: `require`/`module.exports`
 * — NO ES `import`/`export`. `axios` is a runtime dependency declared
 * in `components/shared/lib/package.json`.
 *
 * @module shared/lib/melt/victorialogs-client
 */

const axios = require('axios');
const { LogQueryRepository } = require('./index');

/** VL reserved field names stripped from the `fields` projection. */
const RESERVED_FIELDS = new Set(['_msg', '_stream', '_time']);

/** Default tenant when `VICTORIALOGS_TENANT_ID` is unset. */
const DEFAULT_TENANT_ID = '0:0';

/** Default axios query timeout in ms. */
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

/** Health probe retry policy. */
const HEALTH_PROBE_ATTEMPTS = 3;
const HEALTH_PROBE_BACKOFF_MS = 5000;

/** Default log level when `_stream.level` and `fields.level` are absent. */
const DEFAULT_LEVEL = 'INFO';

/** Default service when `_stream.service` is absent. */
const DEFAULT_SERVICE = 'unknown';

/**
 * Typed error thrown by `_ensureHealth()` after the retry budget is
 * exhausted. Carries the last axios error (if any) so callers
 * (`VL_FAIL_OPEN`) can pattern-match on `code` /
 * `response.status` / `cause` for `ECONNREFUSED` / `ENOTFOUND` /
 * timeout / 5xx.
 */
class VictoriaLogsHealthError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'VictoriaLogsHealthError';
    this.code = 'VL_HEALTH_FAILED';
    if (cause) this.cause = cause;
  }
}

/**
 * MELT adapter — VictoriaLogs wire implementation.
 *
 * Constructs an axios HTTP client bound to a single VL endpoint +
 * tenant. Tenant headers are baked in at construction time so every
 * outbound request carries `AccountID` / `ProjectID`.
 *
 * The lazy health probe (`_ensureHealth`) gates the first `query` /
 * `hits` call only; subsequent calls short-circuit on the cached
 * `_healthProbed` flag. This satisfies the "NOT constructor-blocking"
 * invariant (test fixtures must be able to construct without an
 * endpoint reachable).
 */
class VictoriaLogsAdapter extends LogQueryRepository {
  /**
   * @param {object} [options]
   * @param {string} [options.baseURL]            Base URL for the VL HTTP API.
   * @param {string} [options.tenantId]           Tenant id (e.g. `"0:0"`); defaults to `VICTORIALOGS_TENANT_ID` env.
   * @param {boolean} [options.skipHealthProbe]   Test-fixture escape hatch.
   * @param {number} [options.timeout]            axios timeout in ms (overrides `VL_QUERY_TIMEOUT_MS`).
   */
  constructor({ baseURL, tenantId, skipHealthProbe, timeout } = {}) {
    // Production default: the VL compose service is named `victorialogs`
    // and listens on 9428 (the standard VL port). Callers can still
    // override via `VICTORIALOGS_URL` env or an explicit `baseURL` option.
    // The previous behaviour — axios with `baseURL: undefined` — produced
    // `TypeError: Invalid URL` because the relative path
    // `/select/logsql/query` had no base to resolve against.
    const resolvedBaseURL = baseURL || process.env.VICTORIALOGS_URL || 'http://victorialogs:9428';
    super({ baseURL: resolvedBaseURL, tenantId });

    const resolvedTenant = tenantId || process.env.VICTORIALOGS_TENANT_ID || DEFAULT_TENANT_ID;
    const tenantParts = String(resolvedTenant).split(':');
    const accountId = tenantParts[0] || '0';
    const projectId = tenantParts[1] || '0';

    const parsedEnvTimeout = parseInt(process.env.VL_QUERY_TIMEOUT_MS || String(DEFAULT_QUERY_TIMEOUT_MS), 10);
    const resolvedTimeout =
      typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : Number.isFinite(parsedEnvTimeout)
          ? parsedEnvTimeout
          : DEFAULT_QUERY_TIMEOUT_MS;

    this._axios = axios.create({
      baseURL: resolvedBaseURL,
      timeout: resolvedTimeout,
      headers: {
        AccountID: accountId,
        ProjectID: projectId
      }
    });

    this._skipHealthProbe = Boolean(skipHealthProbe);
    this._healthProbed = false;
  }

  /**
   * Run a LogSQL query and return normalized rows.
   *
   * @param {import('./types').LogQuery} query
   * @returns {Promise<import('./types').VictoriaLogsRow[]>}
   */
  async query({ q, start, end, limit, fields }) {
    await this._ensureHealth();

    // VL's `/select/logsql/query` endpoint expects the LogsQL expression
    // in the `query` URL parameter — NOT `q`. Earlier revisions of this
    // adapter sent `q`; VL rejected with `query arg cannot be empty`
    // (warn-level log per request). Rename at the boundary so callers
    // keep the short `{q: ...}` shape.
    const params = { query: q, start, end };
    if (limit !== undefined && limit !== null) params.limit = limit;
    if (Array.isArray(fields) && fields.length > 0) params.fields = fields.join(',');

    // VL serves `/select/logsql/query` as `application/stream+json`
    // (one JSON object per line — JSONL). Axios auto-parser only fires for
    // `application/json`; for other types it returns the raw body string.
    // Parse the stream+json manually here so callers always see an array.
    const response = await this._axios.get('/select/logsql/query', {
      params,
      // Force text response so we can split on newlines regardless of
      // what VL sends (axios would otherwise try to JSON.parse the
      // entire body for `application/json` and fail on multi-line JSONL).
      responseType: 'text',
      transformResponse: [(data) => data]
    });
    return this._normalizeRows(this._parseJsonlResponse(response.data));
  }

  /**
   * Bucket-hit count for a field (e.g. counts per `service.name`, per `level`).
   *
   * VL `/select/logsql/hits` returns
   *   `{"hits":[{"fields":{"<field>":"<value>"},"timestamps":[...],"values":[N],"total":N}, ...]}`
   * when the request includes the mandatory `step` parameter (the API
   * rejects calls without it with `cannot parse duration from the arg
   * 'step='`). We reshape to `Record<string, number>` per the port
   * contract. The `step` is auto-sized to the requested window so single
   * buckets span the entire query range — callers asking for a day's
   * worth of hits get one bucket per distinct field value.
   *
   * @param {object} query
   * @param {string} query.q
   * @param {string} query.start
   * @param {string} query.end
   * @param {string} query.field
   * @returns {Promise<Record<string, number>>}
   */
  async hits({ q, start, end, field }) {
    await this._ensureHealth();

    const params = {
      query: q,
      start,
      end,
      field,
      // `step` is mandatory for VL hits; use the request span so the
      // series collapses to one bucket per field value (no time-axis
      // breakdown). Falls back to 1h if the span can't be computed
      // (defensive — caller's `start`/`end` are always ISO strings).
      step: this._stepForSpan(start, end) || '1h'
    };
    const response = await this._axios.get('/select/logsql/hits', {
      params,
      responseType: 'text',
      transformResponse: [(data) => data]
    });

    // VL returns a single JSON object — not JSONL. Tolerate empty body.
    let parsed;
    try {
      parsed = response.data ? JSON.parse(response.data) : null;
    } catch {
      return {};
    }
    if (!parsed || !Array.isArray(parsed.hits)) return {};

    const result = {};
    for (const entry of parsed.hits) {
      if (!entry || !entry.fields || typeof entry.fields !== 'object') continue;
      // The bucket key is the requested field's value (`fields[field]`).
      // For grouped queries VL may return several fields — pick the one
      // we asked for; the others (if any) are ignored.
      const value = entry.fields[field];
      if (value === undefined || value === null) continue;
      // `total` is the sum across the time series for this bucket.
      const count = Number(
        entry.total ?? (Array.isArray(entry.values) ? entry.values.reduce((a, b) => a + (Number(b) || 0), 0) : 0)
      );
      if (!Number.isFinite(count)) continue;
      result[String(value)] = count;
    }
    return result;
  }

  /**
   * Pick a `step` value larger than the query span so VL returns a
   * single bucket per field value. Returns `null` when the span can't
   * be parsed (caller should fall back to its own default).
   *
   * @param {string} start
   * @param {string} end
   * @returns {string|null}
   * @private
   */
  _stepForSpan(start, end) {
    if (!start || !end) return null;
    const t0 = Date.parse(start);
    const t1 = Date.parse(end);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
    const ms = t1 - t0;
    // Pick the next-larger canonical step. Doubles the bucket size to
    // be safely above the span (e.g. span 1h → step 2h).
    if (ms <= 60_000) return '2m';
    if (ms <= 3_600_000) return '2h';
    if (ms <= 86_400_000) return '2d';
    if (ms <= 7 * 86_400_000) return '14d';
    return '60d';
  }

  /**
   * Lazily run the VL health probe.
   *
   * First-call-only: subsequent calls short-circuit on `_healthProbed`.
   * No-op when `_skipHealthProbe` is true (test fixtures). Retries 3×5 s;
   * surfaces a `VictoriaLogsHealthError` after the budget is exhausted so
   * callers can pattern-match via `VL_FAIL_OPEN`.
   *
   * @returns {Promise<void>}
   */
  /**
   * Parse a VL JSONL response body into an array of objects.
   *
   * VL serves `/select/logsql/query` and `/select/logsql/hits` as
   * `application/stream+json` — one JSON object per line. A blank line
   * (or whitespace-only line) is tolerated; a malformed line is
   * silently dropped (the canonical "skip noisy entry" behaviour for
   * the adapter — VL occasionally emits status lines that aren't rows).
   *
   * @param {unknown} body
   * @returns {Array<object|Array>}
   */
  _parseJsonlResponse(body) {
    if (Array.isArray(body)) return body;
    if (typeof body !== 'string') return [];
    const out = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines (status lines, keep-alives, etc.).
      }
    }
    return out;
  }

  async _ensureHealth() {
    if (this._healthProbed === true || this._skipHealthProbe) return;
    if (this._healthProbePromise) return this._healthProbePromise;
    if (!this.baseURL) return;

    this._healthProbePromise = (async () => {
      let lastError;
      for (let attempt = 1; attempt <= HEALTH_PROBE_ATTEMPTS; attempt++) {
        try {
          await this._axios.get('/health', { timeout: HEALTH_PROBE_BACKOFF_MS });
          this._healthProbed = true;
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw new VictoriaLogsHealthError(
        `VictoriaLogs health probe failed after ${HEALTH_PROBE_ATTEMPTS} attempts at ${this.baseURL}/health`,
        { cause: lastError }
      );
    })();

    try {
      await this._healthProbePromise;
    } finally {
      this._healthProbePromise = null;
    }
  }

  /**
   * Map VL wire format to the canonical `VictoriaLogsRow` 8-sub-shape.
   *
   * Mapping:
   *  - `timestamp` : ISO 8601 string from `_time` (via `new Date`).
   *  - `message`   : parsed `.message` from `_msg` JSON envelope
   *                  (fallback to the raw `_msg` string when not JSON).
   *  - `stream`    : `{service, environment}` projection of the source
   *                  of truth (top-level OTel fields first, then
   *                  `_msg` JSON, then VL `_stream`).
   *  - `fields`    : `...rest` keys EXCEPT `_msg`/`_stream`/`_time`.
   *  - `date`      : UTC `YYYY-MM-DD` portion of `_time`.
   *  - `time`      : UTC `HH:MM:SS` portion of `_time`.
   *  - `level`     : uppercase — `severity_text` (OTel canonical) first,
   *                  then `_msg.level`, then `fields.level` /
   *                  `_stream.level` / `INFO`.
   *  - `service`   : `service.name` (OTel canonical top-level field),
   *                  then `_msg.service`, then `_stream.service`,
   *                  then `unknown`.
   *
   * The fluentd-sourced rows (the dominant path today) carry the real
   * service + level INSIDE the `_msg` JSON envelope, not on top-level
   * OTel fields nor on `_stream` — the previous implementation read
   * only those and returned `unknown` / `INFO` for every row, breaking
   * the admin panel filters.
   *
   * @param {Array<object>} rawRows VL wire rows (`{_msg, _stream, _time, ...rest}`).
   * @returns {import('./types').VictoriaLogsRow[]} Normalized rows.
   */
  _normalizeRows(rawRows) {
    if (!Array.isArray(rawRows)) return [];
    return rawRows.map((raw) => this._normalizeRow(raw));
  }

  /**
   * @private
   * @param {object} raw VL wire row.
   * @returns {import('./types').VictoriaLogsRow}
   */
  _normalizeRow(raw) {
    const _time = raw && raw._time;
    const _msg = raw && raw._msg;
    const _stream = raw && raw._stream;
    const fields = {};

    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        if (!RESERVED_FIELDS.has(key)) fields[key] = raw[key];
      }
    }

    let timestamp = '';
    let date = '';
    let time = '';
    if (typeof _time === 'string' && _time.length > 0) {
      const parsed = new Date(_time);
      if (!Number.isNaN(parsed.getTime())) {
        const iso = parsed.toISOString();
        timestamp = iso;
        date = iso.slice(0, 10);
        time = iso.slice(11, 19);
      }
    }

    // `_stream` from VL is a logfmt-ish string like `{service.name="x"}`
    // — it's stream-shard metadata, NOT a structured object. Guard
    // against the earlier `typeof _stream === 'object'` check, which
    // matched `String` (always truthy in JS) and returned `"unknown"` for
    // every fluentd row.
    const _streamIsString = typeof _stream === 'string';
    const _streamIsObject = _stream && typeof _stream === 'object' && !_streamIsString;
    const streamService = _streamIsObject ? _stream.service : undefined;
    const streamEnv = _streamIsObject ? _stream.environment : undefined;
    const streamLevel = _streamIsObject ? _stream.level : undefined;

    // OTel canonical: `severity_text` is stamped at the LogRecord
    // top-level by the OTel SDK LoggingHandler path AND by the
    // `transform/stamp_log_metadata_from_msg` collector transform
    // for the fluentd path. No fallback to `_msg` JSON envelope fields
    // is needed — the producer guarantees a clean top-level value.
    let rawLevel = raw && raw.severity_text;
    if (rawLevel === undefined || rawLevel === null || String(rawLevel).toUpperCase() === 'UNSPECIFIED') {
      rawLevel = fields.level;
    }
    if (rawLevel === undefined || rawLevel === null) rawLevel = streamLevel;
    const level =
      rawLevel !== undefined && rawLevel !== null && String(rawLevel).length > 0
        ? String(rawLevel).toUpperCase()
        : DEFAULT_LEVEL;

    // `service.name` follows the same producer-stamped path as
    // `severity_text`. The `_stream.service` legacy fallback covers
    // pre-stamp records (rolled-over partitions, manually-imported
    // data) but no `_msg` JSON envelope parsing — that's a fluentd
    // workaround the transform now obviates.
    let rawService = raw && raw['service.name'];
    if (rawService === undefined || rawService === null || String(rawService).length === 0) {
      rawService = streamService;
    }
    const service =
      rawService !== undefined && rawService !== null && String(rawService).length > 0
        ? String(rawService)
        : DEFAULT_SERVICE;

    // `message` is the raw `_msg` string verbatim — the producer
    // (collector transform + app-side `service` injection) keeps it
    // human-readable. For uvicorn access logs `_msg` is the format
    // string; for OTel SDK logs it is the actual message text.
    const message = _msg !== undefined && _msg !== null ? String(_msg) : '';

    return {
      timestamp,
      message,
      stream: {
        service,
        environment: streamEnv !== undefined && streamEnv !== null ? String(streamEnv) : ''
      },
      fields,
      date,
      time,
      level,
      service
    };
  }
}

module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError };
