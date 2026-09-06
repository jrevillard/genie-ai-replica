// components/shared/lib/melt/index.js
'use strict';

/**
 * MELT hexagonal layer — port + application seam (AD-3, AD-15).
 *
 * Exports:
 *   - `LogQueryRepository`  — port (abstract base class). Defines the
 *     read-side contract every MELT adapter must satisfy.
 *   - `VictoriaLogsAdapter` — concrete adapter (axios HTTP wire +
 *     `_normalizeRows` + AccountID/ProjectID headers + lazy health
 *     probe + `VL_QUERY_TIMEOUT_MS`). Defined in `./victorialogs-client`
 *     (Story 4.3); re-exported here so consumers reach it through the
 *     hexagonal seam rather than importing the internal file directly.
 *   - `VictoriaLogsClient`  — application service. Thin wrapper around
 *     the adapter exposing the consumer-facing seam. Adds the
 *     `MELT_PROVIDER` discriminator (today: `'victorialogs'` only).
 *   - `MELT_PROVIDER`       — current backend discriminator constant.
 *
 * Application consumers (`LogsService`, `securityScanService`) MUST go
 * through `require('shared/lib/melt').VictoriaLogsClient` — NOT through
 * raw axios. Any change to `VictoriaLogsRow` breaks the CAP-3 / CAP-4
 * contract-test gates.
 *
 * Depends on Story 4.3 (`./victorialogs-client`): the require below is
 * intentionally unconditional so a missing adapter fails LOUDLY at
 * module load with `Error: Cannot find module './victorialogs-client'`
 * (code `MODULE_NOT_FOUND`) — Epic 5 imports that bypass this seam
 * crash the same way, surfacing the dependency on 4.3 immediately
 * rather than silently re-exporting `undefined` from a deferred
 * lookup.
 *
 * @module shared/lib/melt
 */

const VictoriaLogsAdapter = require('./victorialogs-client');

const MELT_PROVIDER = 'victorialogs';

/**
 * MELT port — abstract read-side contract every backend adapter implements.
 *
 * Vendor-neutral: defines the contract that any log backend (today:
 * VictoriaLogs; tomorrow: ELK, Loki, etc.) must satisfy. Concrete
 * adapters translate this contract into backend-specific wire formats
 * and headers.
 *
 * The constructor accepts `{baseURL, tenantId}` so the port is
 * multi-tenant-ready. `baseURL` identifies the backend endpoint;
 * `tenantId` is an opaque string the adapter maps to whatever tenant
 * isolation mechanism the backend supports (header pair, query param,
 * path prefix, etc.). Direct instantiation of `LogQueryRepository`
 * throws — subclasses MUST override `query()` and `hits()`.
 */
class LogQueryRepository {
  /**
   * @param {object} [options]
   * @param {string} [options.baseURL]   Base URL for the backend HTTP API.
   * @param {string} [options.tenantId]  Tenant identifier, e.g. `"0:0"`.
   */
  constructor({ baseURL, tenantId } = {}) {
    if (new.target === LogQueryRepository) {
      throw new TypeError(
        'LogQueryRepository is an abstract port; instantiate a concrete adapter (e.g. VictoriaLogsAdapter) instead.'
      );
    }
    this.baseURL = baseURL;
    this.tenantId = tenantId;
  }

  /**
   * Run a LogSQL query and return normalized rows.
   *
   * @param {import('./types').LogQuery} query
   * @returns {Promise<import('./types').VictoriaLogsRow[]>}
   */
  async query(query) {
    throw new TypeError('LogQueryRepository.query() must be implemented by a concrete adapter.');
  }

  /**
   * Bucket-hit count for a field (e.g. counts per `level`, per `_msg`).
   *
   * @param {object} query
   * @param {string} query.q
   * @param {string} query.start
   * @param {string} query.end
   * @param {string} query.field
   * @returns {Promise<Record<string, number>>}
   */
  async hits(query) {
    throw new TypeError('LogQueryRepository.hits() must be implemented by a concrete adapter.');
  }
}

/**
 * MELT application service — consumer-facing seam.
 *
 * Thin wrapper around `VictoriaLogsAdapter`. Construction is
 * pass-through: `new VictoriaLogsClient(options)` forwards `{baseURL,
 * tenantId, skipHealthProbe, timeout, ...}` to the underlying adapter
 * (AD-16 lazy health probe + `VL_QUERY_TIMEOUT_MS` are adapter
 * concerns, re-exported as-is here).
 *
 * Adds:
 *   - `provider` field carrying the active `MELT_PROVIDER` value, so
 *     downstream services can introspect the active backend without
 *     re-reading the env.
 *   - Optional dependency injection via `options.adapter` (used by
 *     test fixtures to substitute a mock without touching the
 *     production constructor path).
 *
 * Future ELK / Loki adapters extend `LogQueryRepository`; the
 * constructor (or a factory) will dispatch on `MELT_PROVIDER`
 * (deferred — see deferred-work.md).
 */
class VictoriaLogsClient extends LogQueryRepository {
  /**
   * @param {object} [options]
   * @param {string} [options.baseURL]
   * @param {string} [options.tenantId]
   * @param {boolean} [options.skipHealthProbe]
   * @param {number} [options.timeout]
   * @param {import('./victorialogs-client')} [options.adapter]  Inject a custom adapter (test fixture path).
   */
  constructor(options) {
    if (options === null || typeof options === 'undefined') {
      throw new TypeError('VictoriaLogsClient: options is required (use {} for defaults).');
    }
    super(options);
    this._adapter = options.adapter || new VictoriaLogsAdapter(options);
    this.provider = MELT_PROVIDER;
  }

  async query(query) {
    return this._adapter.query(query);
  }

  async hits(query) {
    return this._adapter.hits(query);
  }
}

module.exports = {
  LogQueryRepository,
  VictoriaLogsAdapter,
  VictoriaLogsClient,
  MELT_PROVIDER
};
