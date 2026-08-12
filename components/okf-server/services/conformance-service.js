// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF conformance validation + quality metrics. validateConcept is a PURE
// function (no DB); persistConformanceIssues + getRepoMetrics use the shared
// db-connection-service. All issues are WARNING (non-blocking) at ingest.
// MELT: withSpan + shared logger + okf_conformance_operations_total counter.

const { DateTime } = require('luxon');
const { aql } = require('arangojs');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');

const COLLECTION = 'okf_concepts_meta';
const VALID_ACTOR_PREFIXES = ['agent/', 'agent:', 'human:', 'process:'];
const VALID_STATUS_ENUMS = ['draft', 'stable', 'deprecated'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const meter = getMeter();
const opsCounter = meter.createCounter('okf_conformance_operations_total', {
  description: 'OKF conformance validation + metrics operations'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* no-op when observability off */
  }
}

let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

// ─── PURE VALIDATION (no DB) ──────────────────────────────────────────────

/**
 * Validate a parsed concept (from parser-service.parseConcept output) against
 * OKF §11 + v0.2 family rules. Returns { issues, valid }. All WARNING (non-blocking).
 * @param {object} parsed — the parseConcept() output
 * @returns {{ issues: Array<{code:string,severity:string,message:string,field_path:string|null}>, valid: boolean }}
 */
function validateConcept(parsed) {
  const fm = (parsed && parsed.frontmatter) || {};
  const issues = [];

  // B2: MISSING_TYPE
  if (!fm.type || !String(fm.type).trim()) {
    issues.push({
      code: 'MISSING_TYPE',
      severity: 'warning',
      message: 'Concept is missing a non-empty "type" field',
      field_path: 'frontmatter.type'
    });
  }

  // V2: INVALID_STATUS_ENUM
  if (parsed.status !== undefined && !VALID_STATUS_ENUMS.includes(parsed.status)) {
    issues.push({
      code: 'INVALID_STATUS_ENUM',
      severity: 'warning',
      message: `Status "${parsed.status}" is not one of: ${VALID_STATUS_ENUMS.join(', ')}`,
      field_path: 'frontmatter.status'
    });
  }

  // V1: BAD_ACTOR_PREFIX (check generated.by + each verified[].by)
  const checkActor = (by, fieldPath) => {
    if (by && typeof by === 'string' && !VALID_ACTOR_PREFIXES.some((p) => by.startsWith(p))) {
      issues.push({
        code: 'BAD_ACTOR_PREFIX',
        severity: 'warning',
        message: `Actor "${by}" does not start with a recognized prefix (${VALID_ACTOR_PREFIXES.join(', ')})`,
        field_path: fieldPath
      });
    }
  };
  if (parsed.generated && parsed.generated.by) checkActor(parsed.generated.by, 'frontmatter.generated.by');
  if (Array.isArray(parsed.verified)) {
    parsed.verified.forEach((v, i) => {
      if (v && v.by) checkActor(v.by, `frontmatter.verified[${i}].by`);
    });
  }

  // V3: UNPARSEABLE_STALE_AFTER
  if (parsed.stale_after !== undefined && !DATE_RE.test(String(parsed.stale_after))) {
    issues.push({
      code: 'UNPARSEABLE_STALE_AFTER',
      severity: 'warning',
      message: `stale_after "${parsed.stale_after}" is not a valid YYYY-MM-DD date`,
      field_path: 'frontmatter.stale_after'
    });
  }

  // V4: SOURCE_MISSING_RESOURCE
  if (Array.isArray(parsed.sources)) {
    parsed.sources.forEach((s, i) => {
      if (!s || !s.resource || !String(s.resource).trim()) {
        issues.push({
          code: 'SOURCE_MISSING_RESOURCE',
          severity: 'warning',
          message: `Source entry ${i} is missing a non-empty "resource" field`,
          field_path: `frontmatter.sources[${i}].resource`
        });
      }
    });
  }

  return { issues, valid: issues.length === 0 };
}

// ─── DB OPERATIONS (shared db-connection-service) ──────────────────────────

/**
 * Persist conformance issues onto a concept's okf_concepts_meta doc.
 * Uses AQL filter-and-update (key-agnostic; filters by [repo_id, concept_id]).
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {Array} issues
 */
async function persistConformanceIssues(repo_id, concept_id, issues) {
  return withSpan('okf.conformance.persist', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const db = await getDb();
    await db.query(aql`
      FOR d IN ${db.collection(COLLECTION)}
        FILTER d.repo_id == ${repo_id} AND d.concept_id == ${concept_id}
        UPDATE d WITH { conformance_issues: ${issues} } IN ${db.collection(COLLECTION)}
    `);
    logger.info('Conformance issues persisted', { repo_id, concept_id, issue_count: issues.length });
    recordOp('persist', 'success');
  });
}

/**
 * Aggregate per-repo quality metrics from okf_concepts_meta (read-time).
 * @param {string} repo_id
 * @returns {object} { concept_count, conformance_issue_count, broken_link_count, stale_concept_count, pii_hit_count, has_reserved_index }
 */
async function getRepoMetrics(repo_id) {
  return withSpan('okf.conformance.metrics', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.operation', 'metrics');
    const db = await getDb();
    const today = DateTime.now().toUTC().toISODate();

    const cursor = await db.query(aql`
      LET docs = (FOR d IN ${db.collection(COLLECTION)} FILTER d.repo_id == ${repo_id} RETURN d)
      RETURN {
        concept_count: LENGTH(docs),
        conformance_issue_count: SUM(FOR d IN docs RETURN LENGTH(d.conformance_issues) || 0),
        stale_concept_count: SUM(FOR d IN docs FILTER d.stale_after != null AND d.stale_after <= ${today} RETURN 1),
        has_reserved_index: LENGTH(FOR d IN docs FILTER d.concept_id == 'index' RETURN 1) > 0,
        broken_link_count: 0,
        pii_hit_count: 0
      }
    `);
    const result = await cursor.all();
    const metrics = (result && result[0]) || {
      concept_count: 0,
      conformance_issue_count: 0,
      stale_concept_count: 0,
      has_reserved_index: false,
      broken_link_count: 0,
      pii_hit_count: 0
    };
    recordOp('metrics', 'success');
    logger.info('Repo metrics computed', { repo_id, ...metrics });
    return metrics;
  });
}

module.exports = { validateConcept, persistConformanceIssues, getRepoMetrics };
