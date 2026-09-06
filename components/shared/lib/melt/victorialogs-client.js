// components/shared/lib/melt/victorialogs-client.js
'use strict';

/**
 * MELT adapter — VictoriaLogs HTTP wire implementation (AD-3, AD-15, AD-16).
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
 * seam exists for future extension (spine §AD-15).
 *
 * Health probe is **lazy**, NOT constructor-blocking (spine §AD-16):
 * triggered on the first `query` / `hits` call, retries 3×5 s against
 * `${baseURL}/health`. Test fixtures pass `{ skipHealthProbe: true }`
 * to bypass the probe entirely. On probe failure (after retries), a
 * typed `VictoriaLogsHealthError` is thrown — `VL_FAIL_OPEN` (CAP-5)
 * recognises `ECONNREFUSED` / `ENOTFOUND` / timeout / 5xx uniformly
 * and degrades gracefully.
 *
 * `_normalizeRows` (private) maps the VL wire shape
 * `{_msg, _stream, _time, ...rest}` to the canonical
 * {@link VictoriaLogsRow} 8-sub-shape per AD-3. `level` defaults to
 * `INFO` (uppercase), `service` to `unknown`, and `fields` excludes
 * the three reserved VL keys (`_msg`, `_stream`, `_time`).
 *
 * CommonJS only (C-1 / project-context.md): `require`/`module.exports`
 * — NO ES `import`/`export`. `axios` is a runtime dependency declared
 * in `components/shared/lib/package.json`.
 *
 * @module shared/lib/melt/victorialogs-client
 */

const axios = require('axios');
const { LogQueryRepository } = require('./index');

/** VL reserved field names stripped from the `fields` projection (AD-3). */
const RESERVED_FIELDS = new Set(['_msg', '_stream', '_time']);

/** Default tenant when `VICTORIALOGS_TENANT_ID` is unset (spine §AD-15). */
const DEFAULT_TENANT_ID = '0:0';

/** Default axios query timeout in ms (spine §AD-16 / env-vars.md). */
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

/** Health probe retry policy (spine §AD-16). */
const HEALTH_PROBE_ATTEMPTS = 3;
const HEALTH_PROBE_BACKOFF_MS = 5000;

/** Default log level when `_stream.level` and `fields.level` are absent. */
const DEFAULT_LEVEL = 'INFO';

/** Default service when `_stream.service` is absent. */
const DEFAULT_SERVICE = 'unknown';

/**
 * Typed error thrown by `_ensureHealth()` after the retry budget is
 * exhausted. Carries the last axios error (if any) so callers
 * (`VL_FAIL_OPEN`, CAP-5) can pattern-match on `code` /
 * `response.status` / `cause` for `ECONNREFUSED` / `ENOTFOUND` /
 * timeout / 5xx — exactly the signals AD-16 enumerates.
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
 * outbound request carries `AccountID` / `ProjectID` (AD-15).
 *
 * The lazy health probe (`_ensureHealth`) gates the first `query` /
 * `hits` call only; subsequent calls short-circuit on the cached
 * `_healthProbed` flag. This satisfies AD-16's "NOT constructor-blocking"
 * invariant (test fixtures must be able to construct without an
 * endpoint reachable).
 */
class VictoriaLogsAdapter extends LogQueryRepository {
  /**
   * @param {object} [options]
   * @param {string} [options.baseURL]            Base URL for the VL HTTP API.
   * @param {string} [options.tenantId]           Tenant id (e.g. `"0:0"`); defaults to `VICTORIALOGS_TENANT_ID` env.
   * @param {boolean} [options.skipHealthProbe]   Test-fixture escape hatch (AD-16).
   * @param {number} [options.timeout]            axios timeout in ms (overrides `VL_QUERY_TIMEOUT_MS`).
   */
  constructor({ baseURL, tenantId, skipHealthProbe, timeout } = {}) {
    super({ baseURL, tenantId });

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
      baseURL,
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

    const params = { q, start, end };
    if (limit !== undefined && limit !== null) params.limit = limit;
    if (Array.isArray(fields) && fields.length > 0) params.fields = fields.join(',');

    const response = await this._axios.get('/select/logsql/query', { params });
    const rows = Array.isArray(response.data) ? response.data : [];
    return this._normalizeRows(rows);
  }

  /**
   * Bucket-hit count for a field (e.g. counts per `level`, per `_msg`).
   *
   * VL `/select/logsql/hits` returns an array of `[fieldValue, count]`
   * tuples; we reshape to `Record<string, number>` per the port
   * contract.
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

    const params = { q, start, end, field };
    const response = await this._axios.get('/select/logsql/hits', { params });
    const tuples = Array.isArray(response.data) ? response.data : [];
    const result = {};
    for (const entry of tuples) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [value, count] = entry;
      if (value === undefined || value === null) continue;
      const n = Number(count);
      if (!Number.isFinite(n)) continue;
      result[String(value)] = n;
    }
    return result;
  }

  /**
   * Lazily run the VL health probe (AD-16).
   *
   * First-call-only: subsequent calls short-circuit on `_healthProbed`.
   * No-op when `_skipHealthProbe` is true (test fixtures). Retries 3×5 s;
   * surfaces a `VictoriaLogsHealthError` after the budget is exhausted so
   * callers can pattern-match via `VL_FAIL_OPEN`.
   *
   * @returns {Promise<void>}
   */
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
   * Map VL wire format to the canonical `VictoriaLogsRow` 8-sub-shape
   * per AD-3.
   *
   * Mapping:
   *  - `timestamp` : ISO 8601 string from `_time` (via `new Date`).
   *  - `message`   : string from `_msg`.
   *  - `stream`    : `{service, environment}` projection of `_stream`.
   *  - `fields`    : `...rest` keys EXCEPT `_msg`/`_stream`/`_time`.
   *  - `date`      : UTC `YYYY-MM-DD` portion of `_time`.
   *  - `time`      : UTC `HH:MM:SS` portion of `_time`.
   *  - `level`     : uppercase — `fields.level` || `_stream.level` || `INFO`.
   *  - `service`   : `_stream.service` || `unknown`.
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

    const streamService = _stream && typeof _stream === 'object' ? _stream.service : undefined;
    const streamEnv = _stream && typeof _stream === 'object' ? _stream.environment : undefined;
    const streamLevel = _stream && typeof _stream === 'object' ? _stream.level : undefined;

    const fieldsLevel = fields.level;
    const rawLevel = fieldsLevel !== undefined ? fieldsLevel : streamLevel;
    const level =
      rawLevel !== undefined && rawLevel !== null && String(rawLevel).length > 0
        ? String(rawLevel).toUpperCase()
        : DEFAULT_LEVEL;

    const service =
      streamService !== undefined && streamService !== null && String(streamService).length > 0
        ? String(streamService)
        : DEFAULT_SERVICE;

    return {
      timestamp,
      message: _msg !== undefined && _msg !== null ? String(_msg) : '',
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
