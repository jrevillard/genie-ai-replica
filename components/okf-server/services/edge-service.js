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
// `_LINKS_TO` is ENTITY→ENTITY, so each concept also gets an ENTITY vertex
// (idempotent upsert) — otherwise the edges would dangle.
//
// Replace semantics: re-indexing a changed concept replaces its outgoing edges
// (delete-then-insert) so removed links vanish; unchanged concepts are dedup-
// skipped by 4e and keep their edges. Deterministic keys make the write
// idempotent. Never throws into the ingest path (the caller isolates).

const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');

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

    // 1. The concept's persisted links (from the 4b meta doc).
    let meta = null;
    try {
      const rows = await (
        await db.query(
          'FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id AND m.concept_id == @concept_id LIMIT 1 ' +
            'RETURN KEEP(m, ["concept_id", "title", "labels", "links", "bundle_version"])',
          { repo_id, concept_id }
        )
      ).all();
      meta = rows[0] || null;
    } catch (err) {
      logger.warn('Edge write: meta read failed', { repo_id, concept_id, error: err.message });
      return { repo_id, concept_id, written: 0, dropped };
    }
    const links = Array.isArray(meta && meta.links) ? meta.links.filter((l) => l && l.to_concept_id) : [];
    if (links.length === 0) {
      // Still ensure the ENTITY node exists (a concept with no links is a vertex).
      const entityKey = safeKey('c', concept_id);
      await entityCol
        .save(
          {
            _key: entityKey,
            concept_id,
            repo_id,
            title: (meta && meta.title) || null,
            labels: (meta && meta.labels) || [],
            bundle_version: (meta && meta.bundle_version) ?? ctx.bundle_version ?? null
          },
          { overwrite: true }
        )
        .catch((err) => logger.warn('Edge write: ENTITY upsert failed', { repo_id, concept_id, error: err.message }));
      return { repo_id, concept_id, written: 0, dropped };
    }

    // 2. The repo's concept-id set — the within-repo boundary (G22).
    let repoConceptIds = new Set();
    try {
      const rows = await (
        await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id RETURN m.concept_id', { repo_id })
      ).all();
      repoConceptIds = new Set(rows);
    } catch (err) {
      logger.warn('Edge write: repo concept-set read failed — dropping all links', { repo_id, error: err.message });
      return { repo_id, concept_id, written: 0, dropped: links.map((l) => l.to_concept_id) };
    }

    const sourceEntity = `${graph}_ENTITY/${safeKey('c', concept_id)}`;
    // 3. Replace: remove this concept's existing outgoing edges (by key), then
    // insert the current set — removed links vanish on re-index.
    try {
      const existing = await (
        await db.query('FOR e IN `' + graph + '_LINKS_TO` FILTER e._from == @src RETURN e._key', { src: sourceEntity })
      ).all();
      for (const key of existing) {
        await edgeCol.remove(key).catch(() => {});
      }
    } catch (err) {
      logger.warn('Edge write: outgoing-edge cleanup failed', { repo_id, concept_id, error: err.message });
    }

    let written = 0;
    for (const link of links) {
      if (!repoConceptIds.has(link.to_concept_id)) {
        dropped.push(link.to_concept_id);
        logger.info('Edge write: cross-repo/missing target dropped (G22)', {
          repo_id,
          from: concept_id,
          to: link.to_concept_id
        });
        continue;
      }
      const targetEntity = `${graph}_ENTITY/${safeKey('c', link.to_concept_id)}`;
      const edgeKey = safeKey('e', `${concept_id}->${link.to_concept_id}`);
      try {
        await edgeCol.save(
          {
            _key: edgeKey,
            _from: sourceEntity,
            _to: targetEntity,
            label: link.label || '',
            file_id: ctx.file_id || null,
            repo_id,
            bundle_version: (meta && meta.bundle_version) ?? ctx.bundle_version ?? null,
            created_at: DateTime.now().toUTC().toISO()
          },
          { overwrite: true }
        );
        written += 1;
      } catch (err) {
        logger.warn('Edge write: edge insert failed', {
          repo_id,
          concept_id,
          to: link.to_concept_id,
          error: err.message
        });
      }
    }
    // Ensure the source ENTITY vertex exists (edges may reference it).
    try {
      await entityCol
        .save(
          {
            _key: safeKey('c', concept_id),
            concept_id,
            repo_id,
            title: (meta && meta.title) || null,
            labels: (meta && meta.labels) || [],
            bundle_version: (meta && meta.bundle_version) ?? ctx.bundle_version ?? null
          },
          { overwrite: true }
        )
        .catch(() => {});
    } catch {
      /* entity upsert is best-effort */
    }

    span.setAttribute('okf.edges.written', written);
    span.setAttribute('okf.edges.dropped', dropped.length);
    recordEdges(written);
    logger.info('OKF concept edges written', { repo_id, concept_id, written, dropped: dropped.length });
    return { repo_id, concept_id, written, dropped };
  });
}

module.exports = { writeRepoConceptEdges };
