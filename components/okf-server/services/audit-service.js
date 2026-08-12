// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Append-only audit writer for the okf_audit collection (Architecture §4 schema),
// via the SHARED db-connection-service. Full schema (incl. concept_id/version) is
// accepted now so Story 4.1+ concept CRUD doesn't reshape the writer. trace_id is
// read from the active OTel span context; source_ip is passed in (req.ip).
// Best-effort: a storage failure is logged and never fails the main operation.

const { trace, context } = require('@opentelemetry/api');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const COLLECTION = 'okf_audit';

let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = dbService.getConnection('default');
  return _dbPromise;
}

/**
 * Append an audit row. Traced + logged + best-effort.
 * @param {object} entry
 * @param {string} entry.actor   - sub of the acting principal
 * @param {string} entry.action  - e.g. 'repo.create' | 'repo.update' | 'repo.delete'
 * @param {string} entry.repo_id
 * @param {string} [entry.concept_id]
 * @param {string} [entry.version]
 * @param {string} [entry.source_ip]
 */
async function writeAudit({ actor, action, repo_id, concept_id = null, version = null, source_ip = null }) {
  return withSpan('okf.audit.write', async (span) => {
    span.setAttribute('okf.action', action);
    span.setAttribute('okf.repo_id', repo_id);
    try {
      const activeSpan = trace.getSpan(context.active());
      const trace_id = activeSpan ? activeSpan.spanContext().traceId : null;
      const ts = DateTime.now().toUTC().toISO();
      const db = await getDb();
      await db.collection(COLLECTION).save({ actor, action, repo_id, concept_id, version, ts, source_ip, trace_id });
      logger.info('OKF audit row written', { action, repo_id, actor, trace_id });
      return { action, repo_id, ts };
    } catch (err) {
      // Audit is best-effort: a storage failure must NOT fail the main operation.
      logger.error('OKF audit write failed (non-fatal)', { action, repo_id, actor, error: err.message });
      return null;
    }
  });
}

module.exports = { writeAudit };
