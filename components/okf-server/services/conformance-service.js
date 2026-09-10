// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF conformance validation + quality metrics. validateConcept is a PURE
// function (no DB); persistConformanceIssues delegates to the canonical
// okf_concepts_meta UPSERT writer (concept-meta-service, Story 2.9.2 G9);
// getRepoMetrics reads the collection. Hard errors (MISSING_TYPE, BAD_ACTOR_PREFIX)
// BLOCK ingestion; the rest are advisory WARNINGS (recorded + gated at publish).
// MELT: withSpan + shared logger + okf_conformance_operations_total counter.

const { DateTime } = require('luxon');
const { aql } = require('arangojs');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const conceptMetaService = require('./concept-meta-service');

const COLLECTION = 'okf_concepts_meta';
const VALID_ACTOR_PREFIXES = ['agent/', 'agent:', 'human:', 'process:'];
const VALID_STATUS_ENUMS = ['draft', 'stable', 'deprecated'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Story 4.8-amend (2026-08-19): structural HARD errors block ingestion (a concept
// carrying one is rejected at ingest — never chunked). The rest are advisory
// WARNINGS (recorded + gated at publish). `type` is required (MISSING_TYPE) and a
// provenance actor must carry a recognized prefix (BAD_ACTOR_PREFIX) — both are
// integrity violations, not style nits.
const HARD_ERROR_CODES = new Set(['MISSING_TYPE', 'BAD_ACTOR_PREFIX']);

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
 * OKF §11 + v0.2 family rules. Returns { issues, hardErrors, valid }. hardErrors
 * are the structural violations that BLOCK ingestion (MISSING_TYPE, BAD_ACTOR_PREFIX);
 * the remaining issues are advisory WARNINGS (recorded + gated at publish).
 * @param {object} parsed — the parseConcept() output
 * @returns {{ issues: Array<{code:string,severity:string,message:string,field_path:string|null}>, hardErrors: Array, valid: boolean }}
 */
function validateConcept(parsed) {
  const p = parsed || {}; // guard against null/undefined input
  const fm = p.frontmatter || {};
  const issues = [];
  // severity is derived from the code via HARD_ERROR_CODES (single source of truth).
  const push = (code, message, fieldPath) => {
    issues.push({
      code,
      severity: HARD_ERROR_CODES.has(code) ? 'error' : 'warning',
      message,
      field_path: fieldPath
    });
  };

  // B2: MISSING_TYPE (hard)
  if (!fm.type || !String(fm.type).trim()) {
    push('MISSING_TYPE', 'Concept is missing a non-empty "type" field', 'frontmatter.type');
  }

  // V2: INVALID_STATUS_ENUM (warning)
  if (p.status !== undefined && !VALID_STATUS_ENUMS.includes(p.status)) {
    push(
      'INVALID_STATUS_ENUM',
      `Status "${p.status}" is not one of: ${VALID_STATUS_ENUMS.join(', ')}`,
      'frontmatter.status'
    );
  }

  // V1: BAD_ACTOR_PREFIX (hard; check generated.by + each verified[].by)
  const checkActor = (by, fieldPath) => {
    if (by && typeof by === 'string' && !VALID_ACTOR_PREFIXES.some((p) => by.startsWith(p))) {
      push(
        'BAD_ACTOR_PREFIX',
        `Actor "${by}" does not start with a recognized prefix (${VALID_ACTOR_PREFIXES.join(', ')})`,
        fieldPath
      );
    }
  };
  if (p.generated && p.generated.by) checkActor(p.generated.by, 'frontmatter.generated.by');
  if (Array.isArray(p.verified)) {
    p.verified.forEach((v, i) => {
      if (v && v.by) checkActor(v.by, `frontmatter.verified[${i}].by`);
    });
  }

  // V3: UNPARSEABLE_STALE_AFTER (warning)
  if (p.stale_after !== undefined && !DATE_RE.test(String(p.stale_after))) {
    push(
      'UNPARSEABLE_STALE_AFTER',
      `stale_after "${p.stale_after}" is not a valid YYYY-MM-DD date`,
      'frontmatter.stale_after'
    );
  }

  // V4: SOURCE_MISSING_RESOURCE (warning)
  if (Array.isArray(p.sources)) {
    p.sources.forEach((s, i) => {
      if (!s || !s.resource || !String(s.resource).trim()) {
        push(
          'SOURCE_MISSING_RESOURCE',
          `Source entry ${i} is missing a non-empty "resource" field`,
          `frontmatter.sources[${i}].resource`
        );
      }
    });
  }

  const hardErrors = issues.filter((i) => i.severity === 'error');
  return { issues, hardErrors, valid: issues.length === 0 };
}

// ─── DB OPERATIONS (shared db-connection-service) ──────────────────────────

/**
 * Persist conformance issues onto a concept's okf_concepts_meta doc.
 * Story 2.9.2 (G9): uses the canonical UPSERT writer (concept-meta-service) —
 * the previous filter-and-UPDATE wrote ZERO rows when no doc existed (silent
 * no-op: nothing ever created okf_concepts_meta docs). The writer creates the
 * doc if absent and merges conformance_issues.
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {Array} issues
 */
async function persistConformanceIssues(repo_id, concept_id, issues) {
  return withSpan('okf.conformance.persist', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    // Defensive default: an undefined issues array would be JSON-dropped by
    // real arangojs (silent no-op — the exact G9 failure class) and then crash
    // the log line below AFTER the write. (2026-08-15 review fix.)
    const safeIssues = Array.isArray(issues) ? issues : [];
    await conceptMetaService.upsertConceptMeta(
      repo_id,
      { concept_id, repo_id }, // minimal — the writer creates the doc if absent and patches ONLY these fields
      { patch: { conformance_issues: safeIssues } }
    );
    logger.info('Conformance issues persisted', { repo_id, concept_id, issue_count: safeIssues.length });
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

module.exports = { validateConcept, persistConformanceIssues, getRepoMetrics, HARD_ERROR_CODES };
