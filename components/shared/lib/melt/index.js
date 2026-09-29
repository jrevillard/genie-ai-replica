// components/shared/lib/melt/index.js
'use strict';

/**
 * MELT hexagonal layer — port + application seam.
 *
 * Exports:
 *   - `LogQueryRepository`  — port (abstract base class). Defines the
 *     read-side contract every MELT adapter must satisfy.
 *   - `VictoriaLogsAdapter` — concrete adapter (axios HTTP wire +
 *     `_normalizeRows` + AccountID/ProjectID headers + lazy health
 *     probe + `VL_QUERY_TIMEOUT_MS`). Defined in `./victorialogs-client`
 *     re-exported here so consumers reach it through the hexagonal
 *     seam rather than importing the internal file directly.
 *   - `VictoriaLogsClient`  — application service. Thin wrapper around
 *     the adapter exposing the consumer-facing seam. Adds the
 *     `MELT_PROVIDER` discriminator (today: `'victorialogs'` only).
 *   - `MELT_PROVIDER`       — current backend discriminator constant.
 *
 * Application consumers (`LogsService`, `securityScanService`) MUST go
 * through `require('shared/lib/melt').VictoriaLogsClient` — NOT through
 * raw axios. Any change to `VictoriaLogsRow` breaks the contract tests
 * that deep-equal this seam's envelope against the callers' expectations.
 *
 * The require of `./victorialogs-client` below is intentionally
 * unconditional so a missing adapter fails LOUDLY at module load with
 * `Error: Cannot find module './victorialogs-client'` (code
 * `MODULE_NOT_FOUND`) rather than silently re-exporting `undefined`
 * from a deferred lookup.
 *
 * @module shared/lib/melt
 */

const MELT_PROVIDER = 'victorialogs';

// The port lives in its own module so the adapter and this barrel can
// both depend on it without requiring each other. They used to: the
// adapter reached the port through `require('./index')`, and this file
// reached the adapter through `require('./victorialogs-client')` — a
// cycle whose resolution depended on which file Node loaded first.
// Requiring the adapter before the barrel gave
// `TypeError: VictoriaLogsAdapter is not a constructor`, because the
// adapter had captured this module's exports object before the later
// `module.exports = {…}` replaced it with a new literal.
const { LogQueryRepository } = require('./log-query-repository');

// Unconditional: a missing adapter must fail LOUDLY at module load with
// `Error: Cannot find module './victorialogs-client'` rather than silently
// re-exporting `undefined` from a deferred lookup.
const { VictoriaLogsAdapter, VictoriaLogsHealthError, VictoriaLogsResponseError } = require('./victorialogs-client');

/**
 * MELT application service — consumer-facing seam.
 *
 * Thin wrapper around `VictoriaLogsAdapter`. Construction is
 * pass-through: `new VictoriaLogsClient(options)` forwards `{baseURL,
 * tenantId, skipHealthProbe, timeout, ...}` to the underlying adapter
 * (the lazy health probe and `VL_QUERY_TIMEOUT_MS` are adapter
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

  /**
   * Run a LogSQL query and return normalized rows.
   *
   * @param {import('./types').LogQuery} query
   * @returns {Promise<import('./types').VictoriaLogsRow[]>}
   */
  async query(query) {
    return this._adapter.query(query);
  }

  /**
   * Bucket-hit count for a field (e.g. counts per `service.name`, per `level`).
   *
   * @param {object} query
   * @param {string} query.q
   * @param {string} query.start
   * @param {string} query.end
   * @param {string} query.field
   * @returns {Promise<Record<string, number>>}
   */
  async hits(query) {
    return this._adapter.hits(query);
  }

  /**
   * Match count for a filter — no rows.
   *
   * @param {object} query
   * @param {string} query.q
   * @param {string} query.start
   * @param {string} query.end
   * @returns {Promise<number>}
   */
  async count(query) {
    return this._adapter.count(query);
  }
}

module.exports = {
  LogQueryRepository,
  VictoriaLogsAdapter,
  VictoriaLogsClient,
  // Typed adapter errors, re-exported so a consumer can branch on them
  // without importing the adapter file directly (which is the import
  // order the cycle in this module makes unsafe — see F3).
  VictoriaLogsHealthError,
  VictoriaLogsResponseError,
  MELT_PROVIDER
};
