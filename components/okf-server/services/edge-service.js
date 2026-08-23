// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Structural concept→concept edge writer (Story 2.9.3, gaps G7/G22 — ADR-021,
// ADR-022 D4, ADR-028). The parser extracts `links: [{ to_concept_id, label }]`
// (parser-service extractLinks); the orchestrator persists them on the meta doc
// at 4b (Story 2.9.3 AC2); this service writes the concept's OUTGOING edges
// into the per-repo graph POST-INDEX (the 2.9.4 worker's hook).
//
// G22 (within-repo): a link target that is NOT a concept of the same repo is
// DROPPED + logged — a cross-repo edge can never be materialized. The graph's
// `_LINKS_TO` is ENTITY→ENTITY, so BOTH the source and every target concept get
// an ENTITY vertex (idempotent upsert) — otherwise the edges would dangle (the
// collections are edge-typed but NOT graph-bound, so ArangoDB enforces no
// referential integrity).
//
// Replace semantics: re-indexing a changed concept replaces its outgoing edges
// (delete-then-insert) — INCLUDING the N→0 case where the last link is removed.
// Unchanged concepts are dedup-skipped by 4e and keep their edges. Deterministic
// keys make the write idempotent. Never throws into the ingest path (the caller
// isolates).

const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const auditService = require('./audit-service');

const meter = getMeter();
const edgesCounter = meter.createCounter('okf_edges_written_total', {
  description: 'OKF concept->concept edges written'
});
function recordEdges(n) {
  try {
    edgesCounter.add(n || 0, {});
  } catch {
    /* meter no-op when observability off */
  }
}

let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

/** REVIEW FIX (P1, 2026-08-17): canonical concept_id — a `concepts/` prefix is
 * a legacy artifact that leaks in from subdirectory bundles; the worker and the
 * link targets use the bare form. Normalize so the G22 set and the meta read
 * compare like-for-like (never silently drop edges). */
function normalizeConceptId(id) {
  const s = String(id || '');
  return s.replace(/^concepts\//, '');
}

/** ArangoDB-safe deterministic key: `/` is illegal in _key, so we hash. */
function safeKey(prefix, value) {
  return `${prefix}_${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

/**
 * Write (or replace) ONE concept's outgoing edges into its per-repo graph.
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {object} [ctx] { file_id?, bundle_version? }
 * @returns {Promise<{repo_id, concept_id, written: number, dropped: string[]}>}
 */
async function writeRepoConceptEdges(repo_id, concept_id, ctx = {}) {
  return withSpan('okf.edges.write', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const db = await getDb();
    const graph = `OKF_${repo_id}`;
    const entityCol = db.collection(`${graph}_ENTITY`);
    const edgeCol = db.collection(`${graph}_LINKS_TO`);
    const dropped = [];
    const cid = normalizeConceptId(concept_id);

    // 1. The concept's persisted links (from the 4b meta doc). The meta read
    // matches BOTH the bare and the `concepts/`-prefixed stored form so a
    // subdirectory bundle never turns into a silent no-op.
    let meta;
    try {
      const rows = await (
        await db.query(
          'FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id AND (m.concept_id == @cid OR m.concept_id == @prefixed) LIMIT 1 ' +
            'RETURN KEEP(m, ["concept_id", "title", "labels", "links", "bundle_version"])',
          { repo_id, cid, prefixed: `concepts/${cid}` }
        )
      ).all();
      meta = rows[0] || null;
    } catch (err) {
      logger.warn('Edge write: meta read failed', { repo_id, concept_id: cid, error: err.message });
      return { repo_id, concept_id: cid, written: 0, dropped };
    }
    const links = Array.isArray(meta && meta.links) ? meta.links.filter((l) => l && l.to_concept_id) : [];

    // 2. The repo's concept-id set — the within-repo boundary (G22). Normalized
    // so prefixed stored ids match bare link targets.
    let repoConceptIds;
    try {
      const rows = await (
        await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id RETURN m.concept_id', { repo_id })
      ).all();
      repoConceptIds = new Set(rows.map(normalizeConceptId));
    } catch (err) {
      logger.warn('Edge write: repo concept-set read failed — dropping all links', { repo_id, error: err.message });
      return { repo_id, concept_id: cid, written: 0, dropped: links.map((l) => l.to_concept_id) };
    }

    const sourceEntity = `${graph}_ENTITY/${safeKey('c', cid)}`;

    // 3. Replace: remove this concept's existing outgoing edges (by key). Runs
    // for EVERY transition — including N→0 (REVIEW FIX P2: the old code skipped
    // cleanup when the new link set was empty, leaking stale edges).
    try {
      const existing = await (
        await db.query('FOR e IN `' + graph + '_LINKS_TO` FILTER e._from == @src RETURN e._key', { src: sourceEntity })
      ).all();
      for (const key of existing) {
        await edgeCol.remove(key).catch(() => {});
      }
    } catch (err) {
      logger.warn('Edge write: outgoing-edge cleanup failed', { repo_id, concept_id: cid, error: err.message });
    }

    // 4. Ensure BOTH the source and every valid target ENTITY vertex exist
    // (REVIEW FIX P3: the old code only ensured the source — a link to a
    // not-yet-drained / failed concept dangled on a missing `_to`).
    const ensureEntity = (id, title, labels, bundleVersion, isIndex) =>
      entityCol
        .save(
          {
            _key: safeKey('c', normalizeConceptId(id)),
            concept_id: normalizeConceptId(id),
            repo_id,
            // Minimal target upserts pass null title/labels — OMIT them there
            // so the merge never nulls the concept's own full write.
            ...(title != null ? { title } : {}),
            ...(labels != null ? { labels } : {}),
            bundle_version: bundleVersion ?? ctx.bundle_version ?? null,
            // Story 4.8-amend (2026-08-19): the bundle ROOT (index.md, type: index)
            // is persisted on its ENTITY vertex so graph-native traversal has a seed
            // without a meta join. Only set for the concept's OWN write (target
            // upserts below are minimal and are corrected when that concept drains).
            ...(isIndex === true ? { is_index: true } : {})
          },
          // PARTIAL-MERGE upsert (live-caught 2026-08-23): {overwrite: true}
          // REPLACES the whole doc, so a minimal target upsert from another
          // concept's drain WIPED is_index off the index root. 'update' merges —
          // the vertex is created when absent, existing fields survive.
          { overwriteMode: 'update' }
        )
        .catch((err) =>
          logger.warn('Edge write: ENTITY upsert failed', { repo_id, concept_id: id, error: err.message })
        );
    await ensureEntity(
      cid,
      (meta && meta.title) || null,
      (meta && meta.labels) || [],
      (meta && meta.bundle_version) ?? null,
      (meta && meta.is_index) === true
    );

    // 5. Write edges — dedup by target so a target listed twice is ONE edge and
    // `written`/the counter are accurate (REVIEW FIX P5).
    const seen = new Set();
    let written = 0;
    for (const link of links) {
      const target = normalizeConceptId(link.to_concept_id);
      if (!repoConceptIds.has(target)) {
        dropped.push(link.to_concept_id);
        logger.info('Edge write: cross-repo/missing target dropped (G22)', {
          repo_id,
          from: cid,
          to: link.to_concept_id
        });
        continue;
      }
      if (seen.has(target)) continue; // duplicate link to the same target
      seen.add(target);
      // Ensure the target ENTITY vertex exists (REVIEW FIX P3) — a link to a
      // not-yet-drained / failed concept must never dangle. Title/labels are
      // filled in by that concept's own write when it drains; this minimal
      // upsert guarantees the vertex.
      await ensureEntity(target, null, null, (meta && meta.bundle_version) ?? null);
      const targetEntity = `${graph}_ENTITY/${safeKey('c', target)}`;
      const edgeKey = safeKey('e', `${cid}->${target}`);
      try {
        // Preserve the original created_at on overwrite (REVIEW FIX P8): read
        // the existing edge first so re-indexing doesn't churn provenance.
        let created_at = DateTime.now().toUTC().toISO();
        try {
          const existingEdge = await edgeCol.document(edgeKey);
          if (existingEdge && existingEdge.created_at) created_at = existingEdge.created_at;
        } catch {
          /* first write */
        }
        await edgeCol.save(
          {
            _key: edgeKey,
            _from: sourceEntity,
            _to: targetEntity,
            label: link.label || '',
            file_id: ctx.file_id || null,
            repo_id,
            bundle_version: (meta && meta.bundle_version) ?? ctx.bundle_version ?? null,
            created_at
          },
          { overwrite: true }
        );
        written += 1;
      } catch (err) {
        logger.warn('Edge write: edge insert failed', { repo_id, concept_id: cid, to: target, error: err.message });
      }
    }

    span.setAttribute('okf.edges.written', written);
    span.setAttribute('okf.edges.dropped', dropped.length);
    recordEdges(written);
    logger.info('OKF concept edges written', { repo_id, concept_id: cid, written, dropped: dropped.length });
    // REVIEW FIX P4: the MELT audit row (AC1).
    auditService
      .writeAudit({
        actor: 'okf-worker',
        action: 'repo.edges_written',
        repo_id,
        source_ip: null,
        edges_written: written
      })
      .catch(() => {
        /* best-effort */
      });
    return { repo_id, concept_id: cid, written, dropped };
  });
}

module.exports = { writeRepoConceptEdges, normalizeConceptId };
