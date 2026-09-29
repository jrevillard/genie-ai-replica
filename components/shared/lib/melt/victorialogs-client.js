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
 * typed `VictoriaLogsHealthError` is thrown — the caller
 * (`LogsService._vlOrThrow`) recognises `ECONNREFUSED` / `ENOTFOUND`
 * / `ETIMEDOUT` / `ECONNABORTED` / 5xx uniformly and re-throws as
 * `VlUnavailableError` (503 `vl_unreachable`).
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
const { LogQueryRepository } = require('./log-query-repository');

/** VL reserved field names stripped from the `fields` projection. */
const RESERVED_FIELDS = new Set(['_msg', '_stream', '_time']);

/** Default tenant when `VICTORIALOGS_TENANT_ID` is unset. */
const DEFAULT_TENANT_ID = '0:0';

/** Default axios query timeout in ms. */
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

/** Health probe retry policy. */
const HEALTH_PROBE_ATTEMPTS = 3;
/** Per-attempt HTTP timeout (how long the probe waits for one request). */
const HEALTH_PROBE_TIMEOUT_MS = 5000;
/** Inter-attempt delay (separate from timeout — without it, 3 attempts
 *  back-to-back amplify a 2-second VL blip into a 10-second probe, and
 *  after the budget is exhausted `_healthProbed` stays false so the
 *  next call retries from scratch). */
const HEALTH_PROBE_BACKOFF_MS = 500;
/** Negative-cache TTL after the probe budget is exhausted. Short enough
 *  that a transient VL outage clears quickly, long enough to amortize
 *  the 3×5s probe cost across concurrent admin-dashboard requests
 *  during the outage. Without this, every dashboard hit during an
 *  outage burns another 15s probe budget. */
const HEALTH_PROBE_NEG_CACHE_MS = 5000;

/** Default log level when `_stream.level` and `fields.level` are absent. */
const DEFAULT_LEVEL = 'INFO';

/** Default service when `_stream.service` is absent. */
const DEFAULT_SERVICE = 'unknown';

/**
 * Typed error thrown by `_ensureHealth()` after the retry budget is
 * exhausted. Carries the last axios error (if any) so callers
 * (`LogsService._vlOrThrow`) can pattern-match on `code` /
 * `response.status` / `cause` for `ECONNREFUSED` / `ENOTFOUND` /
 * `ETIMEDOUT` / `ECONNABORTED` / 5xx and re-throw as
 * `VlUnavailableError` (503).
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
 * Typed error thrown when VictoriaLogs answers `/select/logsql/hits` with
 * a body the adapter cannot read as a bucket set.
 *
 * Distinct from `VictoriaLogsHealthError`: the endpoint is reachable and
 * answered, so this is not an outage — it is a contract change. Callers
 * must not degrade it to "zero", because zero is a real answer and
 * conflating the two reports a busy day as a clean one.
 */
class VictoriaLogsResponseError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'VictoriaLogsResponseError';
    this.code = 'VL_BAD_RESPONSE';
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

    // `parsedEnvTimeout > 0` guard matches the constructor-option branch
    // (line above): a non-positive env value (`0`, negative) falls through
    // to the default. axios interprets `timeout: 0` as "wait forever" —
    // an outage-bypass risk the guard explicitly closes.
    const parsedEnvTimeout = parseInt(process.env.VL_QUERY_TIMEOUT_MS || String(DEFAULT_QUERY_TIMEOUT_MS), 10);
    const resolvedTimeout =
      typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : Number.isFinite(parsedEnvTimeout) && parsedEnvTimeout > 0
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
    //
    // Field projection is via the LogsQL `| fields a,b` pipe — VL
    // does NOT honour a `fields` URL parameter (it is silently
    // dropped, returning every stored column). Apply the pipe here so
    // callers can pass `fields: [...]` and trust the result is projected.
    const safeFields = Array.isArray(fields) ? fields.filter((f) => typeof f === 'string' && f.trim() !== '') : [];
    const projectedQ = safeFields.length > 0 ? `${q} | fields ${safeFields.join(',')}` : q;
    const params = { query: projectedQ, start, end };
    if (limit !== undefined && limit !== null) params.limit = limit;

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

    // VL returns a single JSON object — not JSONL.
    //
    // An EMPTY body is a legitimate "no buckets for this window" and
    // yields `{}`. A body that is present but unusable — not JSON, or JSON
    // without a `hits` array — is a shape change (VL version bump, tenant
    // rotation) and must NOT be flattened into `{}`, because the callers
    // reduce that map into a count and would report a real day as zero.
    // Throwing routes it into their existing catch, which is the only
    // place that can say so.
    if (!response.data) return {};
    let parsed;
    try {
      parsed = JSON.parse(response.data);
    } catch (err) {
      throw new VictoriaLogsResponseError(
        `VictoriaLogs /select/logsql/hits returned a non-JSON body (length=${String(response.data).length}). The response shape has likely changed.`,
        { cause: err }
      );
    }
    if (!Array.isArray(parsed.hits)) {
      throw new VictoriaLogsResponseError(
        'VictoriaLogs /select/logsql/hits returned JSON without a `hits` array ' +
          `(top-level keys: ${Object.keys(parsed).join(', ') || 'none'}). The response shape has likely changed.`
      );
    }

    // Use a null-prototype map so field values named `__proto__`,
    // `constructor`, or `hasOwnProperty` are stored as ordinary string
    // keys instead of triggering the `__proto__` setter or shadowing
    // the inherited methods on `Object.prototype`.
    const result = Object.create(null);
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
   * Run a LogsQL query that returns ONLY the total match count for the
   * given filter — no rows. Used by callers that need a JSDoc-faithful
   * `total` field (the `total` of an envelope must reflect VL's match
   * count, not the row slice the caller asked for — see LogsService
   * getLogsInRange, which returns the page slice as `logs[]` but was
   * reporting `total: rows.length`).
   *
   * Implementation: append `| stats count() as total` to the filter
   * expression so VL collapses the result set to a single stats row.
   *
   * @param {object} query
   * @param {string} query.q
   * @param {string} query.start
   * @param {string} query.end
   * @returns {Promise<number>}
   */
  async count({ q, start, end }) {
    await this._ensureHealth();
    const projectedQ = `${q} | stats count() as total`;
    const response = await this._axios.get('/select/logsql/query', {
      params: { query: projectedQ, start, end },
      responseType: 'text',
      transformResponse: [(data) => data]
    });
    const rows = this._normalizeRows(this._parseJsonlResponse(response.data));
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const first = rows[0];
    // `_normalizeRow` projects every non-reserved VL key (anything other
    // than `_msg`/`_stream`/`_time`) into the `fields` object — so the
    // `total` from `| stats count() as total` lives at `first.fields.total`,
    // NOT at `first.total` directly. VL may return the field name verbatim
    // (`total`) or upper-cased (`Total`) depending on version — match both.
    const fields = first.fields || {};
    const v = fields.total ?? fields.Total ?? fields._total;
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
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
    // Throttle the malformed-line warn — a sustained VL tenant-rotation
    // or health-probe response can emit thousands of status lines per
    // second, and a warn per line floods the OTel pipeline. Coalesce
    // to one warn per call site per second.
    let warned = false;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch (err) {
        // Skip malformed lines (status lines, keep-alives, etc.) — but
        // warn so a sustained mismatch (VL version change, tenant
        // rotation, mid-flight response truncation) is visible in
        // operator logs. Without the warn, page indexing silently
        // shifts because the offset counter advances while no row
        // is appended.
        if (!warned) {
          warned = true;
          // Use `console.warn` instead of importing winston — the
          // shared MELT seam must not pull in a logger dependency
          // (the importing component owns logging). The message
          // includes the line length only (NOT the content — it may
          // contain PII per `redactAttributes` coverage).
          console.warn(
            `[victorialogs-client] malformed JSONL line dropped (length=${trimmed.length}, error=${err.message}). VL response shape may have changed.`
          );
        }
      }
    }
    return out;
  }

  /**
   * Lazily run the VL health probe.
   *
   * First-call-only: subsequent calls short-circuit on `_healthProbed`.
   * No-op when `_skipHealthProbe` is true (test fixtures). Retries 3×5 s;
   * surfaces a `VictoriaLogsHealthError` after the budget is exhausted so
   * callers (`LogsService._vlOrThrow`) can pattern-match on `code` /
   * `response.status` and re-throw as `VlUnavailableError` (503).
   *
   * A failed budget also arms a short negative cache
   * (`_healthNegCacheUntil`), so a dashboard hit landing mid-outage
   * re-throws immediately instead of re-running the retry budget. The
   * cache is cleared on the next successful probe.
   *
   * @returns {Promise<void>}
   */
  async _ensureHealth() {
    if (this._healthProbed === true || this._skipHealthProbe) return;
    // Negative cache: skip the probe for `HEALTH_PROBE_NEG_CACHE_MS`
    // after a failed budget. Without this, every concurrent dashboard
    // hit during a VL outage burns another 15s probe budget.
    if (typeof this._healthNegCacheUntil === 'number' && this._healthNegCacheUntil > Date.now()) {
      throw new VictoriaLogsHealthError(
        `VictoriaLogs health probe cached negative result (until ${new Date(this._healthNegCacheUntil).toISOString()}) at ${this.baseURL}/health`
      );
    }
    if (this._healthProbePromise) return this._healthProbePromise;
    if (!this.baseURL) return;

    this._healthProbePromise = (async () => {
      let lastError;
      for (let attempt = 1; attempt <= HEALTH_PROBE_ATTEMPTS; attempt++) {
        try {
          await this._axios.get('/health', { timeout: HEALTH_PROBE_TIMEOUT_MS });
          this._healthProbed = true;
          // Clear any stale negative cache on a successful probe.
          this._healthNegCacheUntil = undefined;
          return;
        } catch (err) {
          lastError = err;
        }
        // Inter-attempt delay so 3 attempts don't fire back-to-back.
        // Without this, a 2s VL blip amplifies to a 15s probe, and
        // after exhaustion `_healthProbed` stays false — every
        // subsequent call retries from scratch (no cached negative
        // answer). Skip the delay after the final attempt — saves
        // ~500ms on the cold-path probe.
        if (attempt < HEALTH_PROBE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_BACKOFF_MS));
        }
      }
      // Arm the negative cache BEFORE the throw so concurrent callers
      // observe the cached failure on the very next call (without
      // re-running the probe budget).
      this._healthNegCacheUntil = Date.now() + HEALTH_PROBE_NEG_CACHE_MS;
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
    // Object.create(null) — defends against prototype pollution. A VL row
    // whose JSON envelope contains "__proto__": {"polluted": true} cannot
    // mutate Object.prototype via bracket-assignment (a plain {} honours
    // the __proto__ setter; a null-proto object doesn't). Same protection
    // already used at line 223 for the hits() map.
    const fields = Object.create(null);

    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (!RESERVED_FIELDS.has(key)) fields[key] = raw[key];
      }
    }

    let timestamp = '';
    let date = '';
    let time = '';
    if (typeof _time === 'string' && _time.length > 0) {
      const parsed = new Date(_time);
      if (!Number.isNaN(parsed.getTime())) {
        // UTC-stable date/time fields (sliced from toISOString).
        // Display-side timezone conversion is the admin panel's
        // concern, not the row normalizer's — keeping the wire-side
        // contract deterministic across operator locales avoids
        // hidden drift in getLogsSummary day-bucketing, the
        // LogSearchDialog date-range filter, and any downstream
        // date-string parser.
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

    // `message` prefers the inner `.message` of a Winston JSON envelope
    // (`{"level":"info","message":"Failed login for admin"}`) when
    // `_msg` is a JSON string starting with `{` — security-scan regex
    // patterns then match against the human-readable string the producer
    // wrote, not the envelope shape. Plain strings pass through
    // verbatim (uvicorn access logs, kong stdout, db migrations).
    // Two-step unwrap: inner-`message` first (Winston + python-json-
    // logger shape), then outer-`message` as a fallback for envelopes
    // where the producer writes the body directly at the root.
    let message = _msg !== undefined && _msg !== null ? String(_msg) : '';
    if (typeof message === 'string' && message.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed && typeof parsed.message === 'string') {
          message = parsed.message;
        }
      } catch {
        // Not valid JSON — keep raw as message.
      }
    }

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

module.exports = { VictoriaLogsAdapter, VictoriaLogsHealthError, VictoriaLogsResponseError };
