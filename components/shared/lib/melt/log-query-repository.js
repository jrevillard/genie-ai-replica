// components/shared/lib/melt/log-query-repository.js
'use strict';

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
   * @param {import('./types').LogQuery} _query
   * @returns {Promise<import('./types').VictoriaLogsRow[]>}
   */
  async query(_query) {
    throw new TypeError('LogQueryRepository.query() must be implemented by a concrete adapter.');
  }

  /**
   * Bucket-hit count for a field (e.g. counts per `level`, per `_msg`).
   *
   * @param {object} _query
   * @param {string} _query.q
   * @param {string} _query.start
   * @param {string} _query.end
   * @param {string} _query.field
   * @returns {Promise<Record<string, number>>}
   */
  async hits(_query) {
    throw new TypeError('LogQueryRepository.hits() must be implemented by a concrete adapter.');
  }

  /**
   * Total match count for a query window — used by paginated list
   * endpoints to compute `total` rows that match a filter without
   * fetching the full result set. Adapters that don't have a separate
   * count endpoint (some LogQL backends only support row-level pagination)
   * may override with `query({...query, limit: 0})` + length, but the
   * port contract requires the method to be present so a future
   * `ElkAdapter extends LogQueryRepository` doesn't TypeError at runtime.
   *
   * @param {object} _query
   * @param {string} _query.q
   * @param {string} _query.start
   * @param {string} _query.end
   * @returns {Promise<number>}
   */
  async count(_query) {
    throw new TypeError('LogQueryRepository.count() must be implemented by a concrete adapter.');
  }
}

module.exports = { LogQueryRepository };
