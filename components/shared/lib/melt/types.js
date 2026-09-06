// components/shared/lib/melt/types.js
'use strict';

/**
 * MELT hexagonal layer — domain core (AD-3).
 *
 * Pure type definitions for the VictoriaLogs read-side port. Zero runtime
 * dependencies: this module loads under `require()` with no other modules
 * required. JSDoc `@typedef` blocks are the authoritative shape contract;
 * the stub `module.exports` below exists only so Node CommonJS consumers
 * receive a defined symbol (not `undefined`) when they reference these
 * names — and so downstream port / adapter code (Stories 4.2, 4.3) can
 * inherit the contract via `require('./types').VictoriaLogsRow` etc.
 *
 * @module shared/lib/melt/types
 */

/**
 * Query input shape consumed by `LogQueryRepository.query()`.
 *
 * Mirrors the VL LogSQL `query?` endpoint parameters (AD-3):
 *  - `q`      : LogSQL query string (already escape-safe; the adapter
 *              passes it through verbatim).
 *  - `start`  : ISO 8601 lower bound (inclusive). String form keeps
 *              timezone semantics exact and matches how `LogsService`
 *              builds date windows upstream.
 *  - `end`    : ISO 8601 upper bound (exclusive). Same string form.
 *  - `limit`  : Optional max row count. Adapter defaults when omitted.
 *  - `fields` : Optional whitelist of fields to project server-side.
 *
 * @typedef {Object} LogQuery
 * @property {string} q         LogSQL query body.
 * @property {string} start     ISO 8601 lower bound (inclusive).
 * @property {string} end       ISO 8601 upper bound (exclusive).
 * @property {number} [limit]   Optional max rows to return.
 * @property {string[]} [fields] Optional field whitelist for projection.
 */

/**
 * Canonical VictoriaLogs row shape — the contract every consumer
 * (LogsService, securityScanService) reads from the port.
 *
 * Produced by `VictoriaLogsAdapter._normalizeRows` (Story 4.3) from VL
 * wire format `{_msg, _stream, _time, ...rest}`.
 *
 *  - `timestamp`: ISO 8601 string derived from `_time`.
 *  - `message`  : `_msg` content as a string.
 *  - `stream`   : `{service, environment}` projection of `_stream`.
 *  - `fields`   : every `...rest` key EXCEPT `_msg`, `_stream`, `_time`.
 *  - `date`     : UTC `YYYY-MM-DD` portion of `_time`.
 *  - `time`     : UTC `HH:MM:SS` portion of `_time`.
 *  - `level`    : uppercase log level (defaults to `INFO`).
 *  - `service`  : stream service name (defaults to `unknown`).
 *
 * The `level` / `service` defaults are the adapter's responsibility
 * (applied during normalization), not the type's — the type only
 * documents the contract.
 *
 * @typedef {Object} VictoriaLogsRow
 * @property {string} timestamp                          ISO 8601 string (e.g. `2026-08-31T12:00:00.000Z`).
 * @property {string} message                            Log message body (`_msg`).
 * @property {{service: string, environment: string}} stream Stream projection of `_stream`.
 * @property {Object<string, *>} fields                  Arbitrary structured attributes minus `_msg`/`_stream`/`_time`.
 * @property {string} date                               UTC `YYYY-MM-DD` portion of `_time`.
 * @property {string} time                               UTC `HH:MM:SS` portion of `_time`.
 * @property {string} [level]                            Uppercase log level; defaults to `INFO`.
 * @property {string} [service]                          Stream service name; defaults to `unknown`.
 */

/**
 * Envelope returned to application consumers (e.g. Story 5.3
 * `LogsService.getLogsInRange` JSDoc). Matches the pre-migration file
 * path shape so contract tests (CAP-3 gate) can deep-equal between
 * the file path and the VL path.
 *
 *  - `logs`  : rows normalized to {@link VictoriaLogsRow}.
 *  - `total` : total matching rows (server-side count, may exceed
 *              `logs.length` when `limit` truncates).
 *  - `limit` : effective limit applied to this response.
 *  - `offset`: zero-based offset applied to this response.
 *
 * @typedef {Object} LogQueryResult
 * @property {VictoriaLogsRow[]} logs    Normalized rows.
 * @property {number} total              Total matching rows before pagination.
 * @property {number} limit              Effective limit applied.
 * @property {number} offset             Effective offset applied.
 */

module.exports = {
  LogQuery: undefined,
  VictoriaLogsRow: undefined,
  LogQueryResult: undefined
};
