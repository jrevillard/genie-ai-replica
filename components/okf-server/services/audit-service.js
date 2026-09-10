// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Append-only audit writer for the okf_audit_logs collection (David,
// 2026-08-31: "every state transition and every modification must be tracked
// and auditable" — each row carries the user, date/time, action and a
// human-readable description; linked to okf_repositories by repo_id).
// Via the SHARED db-connection-service. trace_id is read from the active OTel
// span context; source_ip is passed in (req.ip).
// Best-effort: a storage failure is logged and never fails the main operation.
//
// COLLECTION RENAME (David, 2026-08-31): 'okf_audit' → 'okf_audit_logs'. The
// old collection keeps existing legacy rows; all new writes land here.

const { trace, context } = require('@opentelemetry/api');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const COLLECTION = 'okf_audit_logs';

// Shared DB connection — cache the RESOLVED proxy (not the promise); retries on failure.
let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

/**
 * Append an audit row. Traced + logged + best-effort.
 * @param {object} entry
 * @param {string} entry.actor        - sub of the acting principal
 * @param {string} [entry.actor_name] - display name (Keycloak name / preferred_username)
 * @param {string} entry.action       - e.g. 'repo.create' | 'repo.publish' | 'concept.patch'
 * @param {string} entry.repo_id      - link to okf_repositories
 * @param {string} [entry.concept_id]
 * @param {string} [entry.version]
 * @param {string} [entry.description] - human-readable description of the action/change
 * @param {object} [entry.details]    - structured action details (totals, ids, diffs)
 * @param {string} [entry.source_ip]
 */
async function writeAudit({
  actor,
  actor_name = null,
  action,
  repo_id,
  concept_id = null,
  version = null,
  description = null,
  details = null,
  source_ip = null
}) {
  return withSpan('okf.audit.write', async (span) => {
    span.setAttribute('okf.action', action);
    span.setAttribute('okf.repo_id', repo_id);
    try {
      const activeSpan = trace.getSpan(context.active());
      const trace_id = activeSpan ? activeSpan.spanContext().traceId : null;
      const ts = DateTime.now().toUTC().toISO();
      const db = await getDb();
      await db.collection(COLLECTION).save({
        actor,
        actor_name,
        action,
        repo_id,
        concept_id,
        version,
        description,
        details,
        ts,
        source_ip,
        trace_id
      });
      logger.info('OKF audit row written', { action, repo_id, actor, description });
      return { action, repo_id, ts };
    } catch (err) {
      // Audit is best-effort: a storage failure must NOT fail the main operation.
      logger.error('OKF audit write failed (non-fatal)', { action, repo_id, actor, error: err.message });
      return null;
    }
  });
}

/**
 * Newest-first audit rows for ONE repository (the Studio editor's Logs
 * viewer). Capped (200 default, 500 max) — a repository log is a recent-
 * history view, not a forensic export.
 * @returns {Promise<Array<{ts, actor, actor_name, action, description, details, concept_id?}>>}
 */
async function listRepoLogs(repo_id, { limit = 200 } = {}) {
  return withSpan('okf.audit.list', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const capped = Math.max(1, Math.min(500, Number(limit) || 200));
    const db = await getDb();
    return (
      await db.query(
        'FOR l IN ' +
          COLLECTION +
          ' FILTER l.repo_id == @rid SORT l.ts DESC LIMIT @limit ' +
          'RETURN KEEP(l, ["ts", "actor", "actor_name", "action", "description", "details", "concept_id", "version", "trace_id"])',
        { rid: repo_id, limit: capped }
      )
    ).all();
  });
}

module.exports = { writeAudit, listRepoLogs };
