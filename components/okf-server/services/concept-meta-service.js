// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Canonical okf_concepts_meta UPSERT writer (Story 2.9.2, gap G9). Creates/
// updates each concept's metadata row with first-class, indexable fields so
// conformance metrics, PII state, trust/provenance, and the Graph Router's
// selection signals are actually written — replacing the previous
// filter-and-UPDATE in conformance-service that silently wrote ZERO rows when
// no doc existed. The (repo_id, concept_id) unique index (collections.js) is
// the race guard; a concurrent-create violation retries as an update (pattern
// proven in pii-service.upsertPiiState). Direct AQL, shared db-connection.
//
// Update semantics (2026-08-15 review fixes):
//  - MINIMAL input (no frontmatter AND no body — e.g. conformance's
//    {concept_id, repo_id} persist) writes ONLY the caller's patch fields:
//    it must never clobber the first-class fields a full upsert wrote
//    (ADR-021 write-path order: 4b full upsert → 4c conformance persist).
//  - A FULL re-ingest never downgrades pii_state back to 'unknown', never
//    clears last_good_index_at, and never downgrades index_status from
//    'indexed' back to 'parsed' — the fail-closed publish gate (2.8) must not
//    be silently un-blocked without a rescan, and indexed|failed transitions
//    belong to the 2.9.4 worker alone.

const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const matter = require('gray-matter');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const config = require('../config');
const modelCache = require('./vllm-model-cache');

const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const { isArangoNotFound, isArangoUniqueViolation } = require('./arango-errors');
const { aql } = require('arangojs');
const parserService = require('./parser-service');

const COLLECTION = 'okf_concepts_meta';

const LIFECYCLE_STATUSES = require('./okf-vocabulary').STATUS_VALUES;

const meter = getMeter();
const opsCounter = meter.createCounter('okf_concepts_meta_operations_total', {
  description: 'OKF concepts-meta UPSERT operations (create/update)'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
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

function nowIso() {
  return DateTime.now().toUTC().toISO();
}

/** firstExample that treats a not-found as null (real arangojs throws; the
 * unit mock returns null). STRICT classifier — see arango-errors.js. */
async function findConceptDoc(col, repo_id, concept_id) {
  try {
    return await col.firstExample({ repo_id, concept_id });
  } catch (err) {
    if (!isArangoNotFound(err)) throw err; // transient — surface, don't mask
    return null;
  }
}

/** sha256 hex of the concept body — the 2.9.1/2.9.5 content-hash dedup key.
 * CANONICAL (2026-08-16, live-caught run 11): hashed on the TRIMMED body —
 * different input modes (zip entry vs concepts[] vs stored file) round-trip
 * markdown with differing trailing/leading whitespace, and the dedup key
 * must be mode-invariant (identity = the content, not its edge whitespace). */
function contentHash(body) {
  return createHash('sha256')
    .update(String(body || '').trim())
    .digest('hex');
}

/** True iff the parsed input carries no concept payload (no frontmatter AND
 * no body) — a partial persist (e.g. conformance issues), not a re-ingest. */
function isMinimalInput(parsed) {
  const p = parsed || {};
  return p.frontmatter == null && p.body == null;
}

/** AUTHOR-GRAPH LINK DEDUPE (2026-09-08 audit): the parser emits one entry
 * per OCCURRENCE (conformance counts per-occurrence) and composes from three
 * sources — body .md links, frontmatter links[], relations — so one target
 * commonly lands twice (real anchor from the body scan + an empty-label copy
 * from the converter's frontmatter list; live: EVERY crawl page carried the
 * duplicate pair). The STORED author graph keeps ONE entry per target,
 * preferring the labeled copy. Pure — no DB. */
function dedupeLinksForStorage(links) {
  const byTarget = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || !l.to_concept_id) continue;
    const prev = byTarget.get(l.to_concept_id);
    if (!prev || (!prev.label && l.label)) byTarget.set(l.to_concept_id, { ...l });
  }
  return [...byTarget.values()];
}

/**
 * Build the first-class okf_concepts_meta doc from a parseConcept output
 * (parser-service.js:182+). Pure mapping — no DB. Null-safe (guard BEFORE
 * deref — review fix for the dead null guard).
 */
function buildMetaDoc(repo_id, parsed, opts = {}) {
  const p = parsed || {};
  const fm = p.frontmatter || {};
  const path = p.path || '';
  const title = (fm.title && String(fm.title).trim()) || path.split('/').pop().replace(/\.md$/, '') || p.concept_id;
  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? [fm.tags] : [];
  const labels = Array.isArray(fm.labels) ? fm.labels : typeof fm.labels === 'string' ? [fm.labels] : [];
  const summary = (fm.description && String(fm.description).trim()) || (fm.summary && String(fm.summary).trim()) || '';
  const lifecycleStatus = LIFECYCLE_STATUSES.includes(p.status) ? p.status : 'draft'; // enum-validated
  const staleAfter = p.stale_after || null;
  // Story 2.9.3 (AC2): persist the parser's structural links so the post-index
  // edge writer can read them (additive — no consumer depends on the absence).
  // AUTHOR-GRAPH DEDUPE (2026-09-08 audit): the parser emits one entry per
  // OCCURRENCE (conformance counts per-occurrence) composed from three
  // sources — body .md links, frontmatter links[], relations — so one target
  // commonly lands twice (real anchor from the body scan + an empty-label
  // copy from the converter's frontmatter list; live: EVERY crawl page). The
  // stored author graph keeps ONE entry per target, preferring the labeled one.
  const links = dedupeLinksForStorage(Array.isArray(p.links) ? p.links : []);
  return {
    repo_id,
    concept_id: p.concept_id,
    path,
    // Born-right (David, 2026-08-31): the enqueueing ingest passes the repo's
    // CURRENT versioned graph name so the worker drains into the SAME graph
    // dataprep writes. The OKF_{repo_id} default is the legacy anchor only.
    graph_name: opts.graph_name || `OKF_${repo_id}`,
    bundle_version: p.bundle_version != null ? p.bundle_version : (opts.bundle_version ?? null),
    title,
    type: fm.type || '',
    // D-G (#985): curation provenance — how this concept's type/labels were
    // decided ({method, resolved_by, label_source}, attached by the import
    // pipeline when a classification strategy was requested). Null on paths
    // that never curate (e.g. minimal persists, editor fm patches ride the
    // existing merge without re-classifying).
    curation: p.curation || null,
    // Story 4.8-amend (2026-08-19): index.md is the bundle ROOT/discovery entry —
    // `type: index` is the reserved marker. Persisted first-class so traversal has
    // a seed and serving can enumerate the entry point without string-matching.
    // D-A (#979, David's Stage-1 reject): the flag must NOT hinge on the authorial
    // type literal — David's bundle root carries type "BundleRoot", which imports
    // correctly refuse to clobber, yet it IS the index (path index.md / reserved
    // concept_id). Flag by identity; the authorial type never blocks detection.
    is_index: fm.type === 'index' || path === 'index.md' || p.concept_id === 'index',
    tags,
    labels,
    summary,
    links,
    frontmatter: fm,
    content_hash: contentHash(p.body),
    lifecycle_status: lifecycleStatus,
    index_status: 'parsed', // orchestrator/worker transitions to indexed|failed (2.9.1/2.9.4)
    trust_tier: p.trust_tier || 'unverified',
    stale_after: staleAfter,
    verified: p.verified ?? null,
    sources: Array.isArray(p.sources) ? p.sources : [],
    pii_state: 'unknown', // superseded on scan (2.8 pii-service); never downgraded on update
    last_good_index_at: null,
    // Story 4.8-amend (2026-08-19): content-only chunking — the concept's raw
    // markdown BODY + the orchestrator's ingest labels (ACL + KH + okf:v tag) are
    // persisted on the meta doc so the worker can POST directly to dataprep
    // WITHOUT a doc-repo files doc. The body is the content to chunk; ingest_labels
    // is what dataprep's LLM labeler selects from.
    body: p.body || '',
    ingest_labels: Array.isArray(opts.ingest_labels) ? opts.ingest_labels : [],
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/**
 * Single update path (was three copy-pasted blocks). `minimal` writes ONLY
 * the caller's patch (no clobber); a full update additionally protects
 * pii_state/last_good_index_at from downgrades.
 */
async function applyUpdate(col, existing, repo_id, conceptId, parsed, opts, minimal, span) {
  let patch;
  if (minimal) {
    patch = { ...(opts.patch || {}) }; // ONLY caller-provided fields — never clobber
  } else {
    patch = { ...buildMetaDoc(repo_id, parsed, opts), ...(opts.patch || {}) };
    delete patch.created_at; // keep the original created_at on update
    // Fail-closed protection: a re-ingest must not silently un-block the PII
    // gate, erase indexing provenance, or downgrade an indexed concept back to
    // 'parsed' — indexed|failed transitions belong to the 2.9.4 worker alone
    // (2026-08-16 review fix; mirrors the pii_state rule).
    // AMENDED (2026-08-23, live-caught in the two-repo smoke): a MODIFIED
    // concept (content_hash CHANGED) MUST be allowed back to 'parsed' — that
    // is the re-index path. The unconditional block stranded modified
    // concepts at 'indexed' with stale chunks (the worker never re-claimed
    // them; version threading died silently). The protection now keeps the
    // terminal state only when the content is UNCHANGED (the dedup case).
    // AMENDED (2026-09-01, live-caught in the lifecycle E2E): the conformance
    // gate reads FRONTMATTER (title/type), so a rejection fix is often
    // frontmatter-only — while content_hash covers the BODY only. Keying the
    // escape purely on the body hash left rejected concepts at 'rejected'
    // forever (the steward fixed `type:`, nothing else could un-reject it).
    // A conformance-relevant frontmatter change (title/type) therefore counts
    // as a content change too (it also feeds the embedding context, so
    // re-indexing is correct, not wasteful).
    const conformanceFm = (fm) => JSON.stringify(fm ? { title: fm.title, type: fm.type } : null);
    const contentChanged =
      (patch.content_hash != null && existing.content_hash != null && patch.content_hash !== existing.content_hash) ||
      conformanceFm(existing.frontmatter) !== conformanceFm(parsed.frontmatter);
    if (existing.pii_state && existing.pii_state !== 'unknown' && patch.pii_state === 'unknown') {
      delete patch.pii_state;
    }
    if (existing.last_good_index_at != null && patch.last_good_index_at == null) {
      delete patch.last_good_index_at;
    }
    if (existing.index_status === 'indexed' && patch.index_status === 'parsed' && !contentChanged) {
      delete patch.index_status;
    }
    // Story 4.8-amend (2026-08-19): a REJECTED concept (hard conformance error)
    // must not be silently un-rejected back to 'parsed' by a re-ingest of the
    // SAME content — the steward fixes the frontmatter first, then the next
    // ingest re-validates. Fixed content (hash changed) re-enters validation.
    if (existing.index_status === 'rejected' && patch.index_status === 'parsed' && !contentChanged) {
      delete patch.index_status;
    }
  }
  patch.updated_at = nowIso();
  try {
    await col.update(existing._key, patch);
  } catch (err) {
    recordOp('update', 'error');
    logger.error('Concepts-meta UPSERT update failed', { repo_id, concept_id: conceptId, error: err.message });
    throw err;
  }
  recordOp('update', 'success');
  logger.info('Concepts-meta UPSERT (update)', { repo_id, concept_id: conceptId });
  span.setAttribute('okf.meta.action', 'updated');
  return { action: 'updated', doc: { ...existing, ...patch, _key: existing._key, _id: existing._id } };
}

/**
 * Canonical UPSERT of a concept's okf_concepts_meta doc. Creates when absent,
 * updates when present, idempotent. Race-guarded against the unique
 * (repo_id, concept_id) index. Accepts an optional `patch` of extra fields
 * (e.g. { conformance_issues }) merged onto the doc.
 * @param {string} repo_id — required (falsy rejected: a repo-wide lookup hazard)
 * @param {object} parsed — parseConcept output (or a minimal {concept_id})
 * @param {object} [opts] { bundle_version?, patch?: object }
 * @returns {Promise<{action: 'created'|'updated', doc: object}>}
 */
async function upsertConceptMeta(repo_id, parsed, opts = {}) {
  const p = parsed || {};
  if (!repo_id || !p.concept_id) {
    // Guard: on real arangojs an undefined bind key is JSON-dropped, which
    // degrades firstExample to repo-wide (arbitrary-doc overwrite). The unit
    // mock's strict equality can never catch this — reject at the boundary.
    throw new Error(
      `upsertConceptMeta requires repo_id and concept_id (got repo_id=${String(repo_id)}, concept_id=${String(p.concept_id)})`
    );
  }
  return withSpan('okf.meta.upsert', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', p.concept_id);
    const db = await getDb();
    const col = db.collection(COLLECTION);
    const minimal = isMinimalInput(p);

    const existing = await findConceptDoc(col, repo_id, p.concept_id);
    if (existing) {
      try {
        return await applyUpdate(col, existing, repo_id, p.concept_id, p, opts, minimal, span);
      } catch (err) {
        if (isArangoNotFound(err)) {
          // TOCTOU: the doc vanished between find and update → create instead.
          logger.warn('Concepts-meta UPSERT: doc deleted mid-flight — retrying as create', {
            repo_id,
            concept_id: p.concept_id
          });
        } else {
          throw err;
        }
      }
    }

    try {
      // Create: a minimal persist seeds the doc with defaults (the G9 fix);
      // a full upsert writes the complete first-class field set.
      const merged = { ...buildMetaDoc(repo_id, p, opts), ...(opts.patch || {}) };
      const saved = await col.save(merged);
      recordOp('create', 'success');
      logger.info('Concepts-meta UPSERT (create)', { repo_id, concept_id: p.concept_id });
      span.setAttribute('okf.meta.action', 'created');
      return { action: 'created', doc: { ...merged, ...(saved || {}) } }; // keep save's _key/_id/_rev
    } catch (err) {
      if (isArangoUniqueViolation(err)) {
        // Concurrent create lost the race → retry as update (unique index guard).
        const again = await findConceptDoc(col, repo_id, p.concept_id);
        if (again) {
          return applyUpdate(col, again, repo_id, p.concept_id, p, opts, minimal, span);
        }
      }
      recordOp('create', 'error');
      logger.error('Concepts-meta UPSERT create failed', { repo_id, concept_id: p.concept_id, error: err.message });
      throw err;
    }
  });
}

/** Read one concept's meta doc (null when absent). The orchestrator's 4e
 * PRE-upsert read — the stored content_hash + index_status is the dedup basis
 * (2026-08-16 review fix: the post-upsert doc always carries the new hash). */
async function getConceptMeta(repo_id, concept_id) {
  if (!repo_id || !concept_id) return null;
  const db = await getDb();
  return findConceptDoc(db.collection(COLLECTION), repo_id, concept_id);
}

/**
 * P0 hot-fix (David's re-test 2026-09-08): requeue EVERY meta row of a repo
 * for a full re-drain. Called on RETRACT (the serving graph was just DROPPED —
 * 'indexed' is meaningless once nothing serves; retract→ingest must rebuild)
 * and on PUBLISH (a new version's content — incl. fm/label edits — must reach
 * chunks; population was always a side effect of INDEXING, never of promote).
 * Clears the drain-lane claim stamps so lanes can claim immediately (a stale
 * claim would stall the requeue for JOB_TIMEOUT). The PII state is untouched —
 * this re-runs the DRAIN, not the import (efficiency mandate intact).
 * @param {string} repo_id
 * @returns {Promise<number>} rows requeued
 */
async function requeueRepoForRedrain(repo_id, opts = {}) {
  if (!repo_id) return 0;
  const db = await getDb();
  const rows = await (
    await db.query(
      `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid
       UPDATE m WITH {
         index_status: 'parsed',
         graph_name: @gname != null ? @gname : m.graph_name,
         worker_claimed_at: null,
         ingest_attempts: 0,
         reindex_retry: 0,
         last_good_index_at: null,
         last_error: null,
         next_attempt_after: null,
         updated_at: DATE_ISO8601(DATE_NOW())
       } IN okf_concepts_meta
       RETURN NEW.index_status`,
      { rid: repo_id, gname: opts.graphName || null }
    )
  ).all();
  return rows.length;
}

/**
 * RE-INGEST FAILED CONCEPTS (David, 2026-10-14). The recovery path the product
 * already PROMISES but never built: the drain's dead-letter text says
 * "recovery = re-ingest" (ingestWorker.js:1237) and "failed concepts stay
 * recoverable via re-ingest (D4-b)" (:1269), yet nothing could reach it —
 * retracting the whole repo was the only way, which drops the serving graph and
 * re-ingests every concept.
 *
 * SCOPE: FAILED ONLY. Rows already 'indexed' are healthy and must not churn; the
 * drain would re-chunk and re-vectorize all of them for nothing. Rows 'rejected'
 * are excluded by the ingest hard-gate and are terminal by design.
 *
 * ingest_attempts: 0 IS LOAD-BEARING, not a tidy-up. The claim stamp increments
 * it and NOTHING decrements it — not the worker, not a successful index. The
 * reaper (_reapStuckParsed, ingestWorker.js:1212) dead-letters any 'parsed' row
 * with ingest_attempts >= OKF_INGEST_WORKER_MAX_CLAIMS (default 8), on an hourly
 * sweep. Requeue WITHOUT the reset and the rows are killed again within the
 * hour, which is exactly the failure mode re-ingest is meant to end.
 *
 * graph_name is deliberately PRESERVED (as requeueRepoForRedrain does): the
 * caller stamps it to the versioned serving name via stampRepoGraphName before
 * arming. Blanking it would let dataprep resurrect a dropped graph.
 *
 * @param {string} repo_id
 * @param {object} [opts]
 * @param {string} [opts.conceptId] scope to ONE concept (per-concept retry);
 *   omitted = every failed concept in the repo
 * @returns {Promise<{requeued: number, conceptIds: string[]}>}
 */
async function requeueFailedForReingest(repo_id, opts = {}) {
  if (!repo_id) return { requeued: 0, conceptIds: [] };
  const conceptId = opts.conceptId || null;
  const db = await getDb();
  const rows = await (
    await db.query(
      `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status == 'failed'
       ${conceptId ? 'FILTER m.concept_id == @cid' : ''}
       UPDATE m WITH {
         index_status: 'parsed',
         worker_claimed_at: null,
         ingest_attempts: 0,
         reindex_retry: 0,
         last_good_index_at: null,
         last_error: null,
         next_attempt_after: null,
         updated_at: DATE_ISO8601(DATE_NOW())
       } IN okf_concepts_meta
       RETURN NEW.concept_id`,
      // BIND PARAMS MUST MATCH THE QUERY EXACTLY. ArangoDB rejects ANY bind
      // value the query does not reference ("bind parameter 'cid' was not
      // declared in the query") — passing `cid: null` unconditionally made the
      // REPO-WIDE call 500, because that query never mentions @cid. Caught live
      // on the first button click, not by a test: the original falsifier only
      // asserted the AQL string and never the binds, which is the half that was
      // broken.
      conceptId ? { rid: repo_id, cid: conceptId } : { rid: repo_id }
    )
  ).all();
  const conceptIds = Array.isArray(rows) ? rows.map((r) => (r && r.concept_id ? r.concept_id : r)).filter(Boolean) : [];
  return { requeued: conceptIds.length, conceptIds };
}

/** NAME AUTHORITY (David's v9 wedge, 2026-09-08): stamp every meta row's
 * graph_name to the drain's born-right serving name. Stale stamps made the
 * drain write into the OLD version's name — dataprep's ensure-graph then
 * RESURRECTED the graph retract had just dropped. The ingest-arm calls this
 * right before arming, so the drain target and the serving name can never
 * disagree.
 *
 * CAP-1 (chat-source resolution, 2026-11-04): the same stamp carries the
 * drained VERSION onto every row (bundle_version) — the retrieval-side
 * enrichment join reads it to give each citation its identity. The graph
 * name embeds the version but the rows must carry it as FIRST-CLASS data
 * (no graph-name parsing downstream — the spec's dirty-hack ban). Import
 * rows are born with bundle_version null (no version exists before mint);
 * this stamp is the single writer that binds rows to the drained version. */
async function stampRepoGraphName(repo_id, graph_name, bundle_version = null) {
  if (!repo_id || !graph_name) return 0;
  const db = await getDb();
  const rows = await (
    await db.query(
      `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND (m.graph_name != @gn OR m.bundle_version != @bv)
       UPDATE m WITH { graph_name: @gn, bundle_version: @bv, updated_at: DATE_ISO8601(DATE_NOW()) }
       IN okf_concepts_meta
       RETURN NEW.graph_name`,
      { rid: repo_id, gn: graph_name, bv: bundle_version === undefined ? null : bundle_version }
    )
  ).all();
  return rows.length;
}

/** Story #978 — list a repo's concept meta rows for the Studio editor's left
 * rail. KEEP the fields the UI consumes (no body — that rides on the
 * per-concept GET). Sorted: failed first (needs attention), then parsed
 * (pending index), then the rest; title ascending within each band.
 *
 * NON-BLOCKING LOAD (David, 2026-09-12): a large repo returned as ONE payload
 * blocked the editor until the browser complained. With { limit } the query
 * pages (LIMIT offset, limit) and returns { total, offset, limit, concepts }
 * so the client can fetch in chunks with a REAL progress bar; without opts
 * the legacy full-array shape is returned (all other callers unchanged). */
async function listConceptsMeta(repo_id, opts = {}) {
  if (!repo_id) return [];
  const db = await getDb();
  // limit: ONLY clamp when the caller actually passed one — a bare call must
  // stay on the legacy full-array branch (limit 0), never paginate to 1 row.
  const hasLimit = opts.limit !== undefined && opts.limit !== null && opts.limit !== '';
  const limit = hasLimit ? Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 1)) : 0;
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const KEEP = `RETURN KEEP(m, ["repo_id", "concept_id", "path", "title", "type", "labels", "tags", "summary",
         "is_index", "index_status", "content_hash", "trust_tier", "sources", "chunk_count",
         "lifecycle_status", "pii_state", "pii_hits_summary", "pii_scanned_at",
         "conformance_issues", "created_at", "updated_at",
         "last_error", "last_worker_error", "ingest_attempts"])`;
  const SORT = `SORT (m.index_status == 'failed' ? 0 : (m.index_status == 'parsed' ? 1 : 2)), m.title`;
  if (!limit) {
    return await (
      await db.query(`FOR m IN okf_concepts_meta FILTER m.repo_id == @rid ${SORT} ${KEEP}`, {
        rid: repo_id
      })
    ).all();
  }
  const totalRows = await (
    await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid COLLECT WITH COUNT INTO n RETURN n', {
      rid: repo_id
    })
  ).all();
  const concepts = await (
    await db.query(`FOR m IN okf_concepts_meta FILTER m.repo_id == @rid ${SORT} LIMIT @offset, @limit ${KEEP}`, {
      rid: repo_id,
      offset,
      limit
    })
  ).all();
  return { total: totalRows[0] || 0, offset, limit, concepts };
}

/** W9 (concept tree browse, 2026-11-08) — the PAGINATED TREE INDEX the
 * citizen's modal browser walks. One page of the repo's concepts, each as
 * {concept_id, title, links[]} where links are the OUTGOING AUTHOR edges
 * ONLY (source=='author' on the repo graph's _LINKS_TO). This is the
 * scale-safe split the spec freezes: author edges are ~13-16k per large
 * repo and are the structure the settle path materialized deliberately;
 * the raw parser edge set reaches 483k rows (Bali) and the meta rows' own
 * links[] stay on the per-concept CAP-2 fetch, never in this index.
 *
 * Contract mirrors listConceptsMeta's paginated branch (offset/limit, clamp
 * 1..500, default 200) so the client assembles with the same guards:
 *   { total, offset, limit, concepts } — out-of-range offset yields an
 * empty page with total still true (AQL LIMIT past the end), so a walker
 * can never over-read the corpus and the whole repo needs ≤ ceil(total/200)
 * pages, never one payload.
 *
 * Graph naming borrows the EDGE WRITER's own authority (edge-service
 * graphNameForRepo — registry-derived, versioned; the OKF_${repo_id} string
 * is its legacy fallback, never invented here). A repo whose graph was
 * never drained (a steward reading a draft) has no _LINKS_TO collection:
 * the index degrades to links: [] instead of erroring — the walk is
 * content-complete through the list, the links are an affordance. */
/** W9 perf fix (David, 2026-11-08 — "optimized for handling large
 * repositories"): the first tree page must never gateway-timeout. Live
 * evidence: the original per-row correlated join (200 subqueries × an
 * un-indexed 483k-row _LINKS_TO scan) took >300 s per page on Bali — the
 * dialog 504'd before anything rendered. Two-part fix:
 *   1. LAZY PERSISTENT INDEXES — `okf_concepts_meta` on `repo_id` and each
 *      graph's `_LINKS_TO` on `from_concept_id`, ensured on first read,
 *      cached per process, NON-FATAL on failure (the batched scan below
 *      still serves). This also heals repos already drained before the
 *      index existed — no re-ingest needed.
 *   2. BATCHED JOIN — the page's links come from ONE filtered edges scan
 *      (`from_concept_id IN <page ids>`, index-served) collected per from,
 *      instead of one correlated scan PER ROW. */
const treeIndexReady = new Set();

/** Ensure a persistent index exists on [fields]; cache the verdict per
 * collection so steady-state reads pay nothing. Never throws. */
async function ensureTreeIndex(db, collection, fields) {
  const key = `${collection}:${fields.join(',')}`;
  if (treeIndexReady.has(key)) return;
  try {
    const col = db.collection(collection);
    const existing = await col.indexes();
    if (!existing.some((i) => i.type === 'persistent' && (i.fields || []).join(',') === fields.join(','))) {
      await col.ensureIndex({ type: 'persistent', fields });
      logger.info(`okf.tree index created (large-repo read path)`, { collection, fields });
    }
    treeIndexReady.add(key);
  } catch (err) {
    // Non-fatal by design: the batched IN-join full scan still serves the
    // page; the index is a scale optimization. NOT cached on failure — the
    // next call retries.
    logger.warn(`okf.tree index check failed (non-fatal)`, { collection, fields, error: err.message });
  }
}

async function listConceptTree(repo_id, opts = {}) {
  if (!repo_id) return { total: 0, offset: 0, limit: 200, concepts: [] };
  const db = await getDb();
  // Page size: default 200, clamp 1..500 — identical to listConceptsMeta.
  const hasLimit = opts.limit !== undefined && opts.limit !== null && opts.limit !== '';
  const limit = hasLimit ? Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 1)) : 200;
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  return withSpan('okf.concept_tree.list', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.tree.offset', offset);
    span.setAttribute('okf.tree.limit', limit);
    const totalRows = await (
      await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid COLLECT WITH COUNT INTO n RETURN n', {
        rid: repo_id
      })
    ).all();
    const total = totalRows[0] || 0;
    // The graph name is the EDGE WRITER's derivation, not a local copy
    // (lazy require — the edge service owns the naming rule; no import
    // cycle: edge-service never imports this module).
    const { graphNameForRepo } = require('./edge-service');
    const graph = await graphNameForRepo(db, repo_id);
    const edgeName = `${graph}_LINKS_TO`;
    // House precedent (graph-lifecycle-service.js): .exists() is called BARE —
    // an absent collection returns false (the no-graph degrade below), while a
    // transient DB fault THROWS and surfaces as a 500 instead of silently
    // serving a link-less index for a drained repo (review r0).
    const edgesReady = await db.collection(edgeName).exists();
    // Scale indexes (see the helper above): always the meta lookup, the
    // edges lookup only when this repo's graph was actually drained.
    await ensureTreeIndex(db, 'okf_concepts_meta', ['repo_id']);
    if (edgesReady) await ensureTreeIndex(db, edgeName, ['from_concept_id']);
    const PAGEQ =
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid SORT m.title, m.concept_id LIMIT @offset, @limit';
    const rows = edgesReady
      ? await (
          await db.query(
            // Batched join: ONE edges scan for the whole page (index-served on
            // from_concept_id once ensured), collected per from — never a
            // correlated subquery per row (the >300 s Bali failure mode).
            `LET ids = (${PAGEQ} RETURN m.concept_id)
             LET grouped = (FOR e IN \`${edgeName}\` FILTER e.source == 'author' AND e.from_concept_id IN ids COLLECT from = e.from_concept_id INTO hits RETURN { from, tos: hits[*].e.to_concept_id })
             ${PAGEQ} LET g = FIRST(FOR x IN grouped FILTER x.from == m.concept_id RETURN x)
             RETURN { concept_id: m.concept_id, title: m.title, links: g ? g.tos : [] }`,
            { rid: repo_id, offset, limit }
          )
        ).all()
      : await (
          await db.query(`${PAGEQ} RETURN { concept_id: m.concept_id, title: m.title, links: [] }`, {
            rid: repo_id,
            offset,
            limit
          })
        ).all();
    span.setAttribute('okf.tree.returned', (rows || []).length);
    return { total, offset, limit, concepts: rows || [] };
  });
}

/** Resolve a concept's meta row by concept_id across ALL repos (the dataprep
 * completion callback knows only the concept_id — Story 4.8-amend content-only
 * chunking). null when absent or ambiguous. */
async function getConceptMetaFromAnyRepo(concept_id) {
  if (!concept_id) return null;
  const db = await getDb();
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.concept_id == @cid LIMIT 2 RETURN KEEP(m, ["repo_id", "concept_id", "bundle_version", "index_status"])',
      { cid: concept_id }
    )
  ).all();
  if (!rows || rows.length !== 1) return null; // absent OR ambiguous (2 repos, same concept_id)
  return rows[0];
}

/**
 * W8 (EPIC-8 slice 1): purge the repo's concept-keyed ingestion_log rows on
 * repo DELETE. dataprep's _write_ingestion_log keys per-concept progress rows
 * on file_id == concept_id (content-only chunking has no files doc, so
 * doc-repo's file DELETE — which does purge per-FILE rows — never reaches
 * them); a deleted repo left them orphaned forever, polluting the collection
 * the admin UI and log queries read.
 *
 * 1:1 SAFETY — the one rule this query exists for: a row carries NO repo
 * stamp, so a concept_id held by more than one repository (clone /
 * shared-slug cases, the same ambiguity getConceptMetaFromAnyRepo treats as
 * null) shares its rows across those repos. The purge removes a concept's
 * rows only when the deleting repo is its SOLE live holder; the other
 * holder's drain history must survive the delete.
 *
 * Must run BEFORE the graph retract sweeps the repo's okf_concepts_meta rows
 * (that enumeration is the source of `mine`). NOT wired on retract — W7's D3
 * reversal made retract an unpublish that deliberately keeps history (bundle
 * zips survive; so does the ingestion history of the versions they carry).
 * Repo DELETE remains the only hard purge.
 */
async function purgeConceptIngestionLogs(repo_id) {
  if (!repo_id) return { repo_id, purged: [] };
  return withSpan('okf.concept_meta.purge_ingestion_logs', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    const purged = await (
      await db.query(
        'LET mine = (FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id AND m.concept_id != null RETURN DISTINCT m.concept_id) ' +
          'LET shared = (FOR m IN okf_concepts_meta FILTER m.repo_id != @repo_id AND m.concept_id IN mine RETURN DISTINCT m.concept_id) ' +
          'LET sole = (FOR cid IN mine FILTER cid NOT IN shared RETURN cid) ' +
          'FOR log IN ingestion_log FILTER log.file_id IN sole REMOVE log IN ingestion_log RETURN OLD.file_id',
        { repo_id }
      )
    ).all();
    span.setAttribute('okf.purged_count', (purged || []).length);
    logger.info('W8 ingestion_log purge: concept-keyed rows removed on repo delete', {
      repo_id,
      purged_count: (purged || []).length,
      concept_ids: (purged || []).slice(0, 20)
    });
    return { repo_id, purged: purged || [] };
  });
}

/** Story #978 — remove ONE concept's meta row. Returns the removed doc (or
 * null when absent → 404 at the controller). The graph/content sweep lives in
 * ingest-service.deleteConcept (which owns the repositoryService import). */
async function deleteConceptMeta(repo_id, concept_id) {
  if (!repo_id || !concept_id) return null;
  const db = await getDb();
  const doc = await findConceptDoc(db.collection(COLLECTION), repo_id, concept_id);
  if (!doc) return null;
  await db.collection(COLLECTION).remove(doc._key);
  return doc;
}

/** THE CONCEPT-DOCUMENT CEILING — the repo's over-ceiling concepts.
 *
 * The publish gate's backstop (the plan's §7): "no oversized concept may
 * persist by any path". A concept can reach the corpus by an import that
 * predates the ceiling, by a re-ingest of a legacy document, or by a future
 * write path that bypasses the editor's guard — so the PUBLISH boundary
 * checks the corpus itself.
 *
 * The query lives HERE, beside the other `okf_concepts_meta` reads, because
 * this module owns that collection. The publish path used to query it
 * directly, which put a second, differently-shaped AQL call in the middle of
 * the transition — and the lifecycle suite's mock queue is positional, so an
 * extra query there silently shifted every later expectation.
 *
 * `FILTER m.body != null` matters: a row with no body has `LENGTH(null)`,
 * which compares as null rather than as a number.
 *
 * @param {string} repo_id
 * @param {number} ceiling the effective ceiling in characters
 * @param {number} limit how many offenders to name
 * @returns {Promise<{count: number, offenders: Array<{concept_id: string, chars: number}>}>}
 */
async function listOverCeiling(repo_id, ceiling, limit = 10) {
  if (!repo_id || !Number.isFinite(ceiling) || ceiling <= 0) return { count: 0, offenders: [] };
  const db = await getDb();
  const countRows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.body != null ' +
        'FILTER LENGTH(m.body) > @ceiling COLLECT WITH COUNT INTO n RETURN n',
      { rid: repo_id, ceiling }
    )
  ).all();
  const count = countRows[0] || 0;
  if (!count) return { count: 0, offenders: [] };
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.body != null ' +
        'FILTER LENGTH(m.body) > @ceiling LIMIT @limit ' +
        'RETURN { concept_id: m.concept_id, chars: LENGTH(m.body) }',
      { rid: repo_id, ceiling, limit }
    )
  ).all();
  return { count, offenders: rows || [] };
}

/** Count a repo's meta rows at a given index_status (bundle completion
 * check — the internal controller asks "are any concepts still parsed?"). */
async function countByIndexStatus(repo_id, index_status) {
  if (!repo_id || !index_status) return 0;
  const db = await getDb();
  // #1647 ride-along: the FILTER m.repo_id read is index-served on large
  // repos (same lazy index the W9 tree join uses; cached per process).
  await ensureTreeIndex(db, 'okf_concepts_meta', ['repo_id']);
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status == @st COLLECT WITH COUNT INTO n RETURN n',
      { rid: repo_id, st: index_status }
    )
  ).all();
  return rows[0] || 0;
}

/** Author-stated link edges for the EDITOR graph projection (David,
 * 2026-09-04: the editor's graph is a projection of the repository's
 * markdown links — NEVER the ArangoDB serving graph, which only exists
 * post-drain). Reads the per-concept links[] the orchestrator persists at
 * import time (4b) — the LIVE truth during curation, unlike the settled
 * manifest which exists only post-settle and goes stale between edits.
 * Dangling/cross-repo targets are returned as-is; the view filters them
 * against the node set (same rule as the manifest path). */
async function getRepoLinks(repo_id) {
  if (!repo_id) return { repo_id, links: [], concept_count: 0 };
  const db = await getDb();
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid SORT m.concept_id RETURN KEEP(m, ["concept_id","links"])',
      { rid: repo_id }
    )
  ).all();
  const norm = (id) => String(id || '').replace(/^concepts\//, '');
  const links = [];
  for (const m of rows) {
    const from = norm(m.concept_id);
    for (const l of Array.isArray(m.links) ? m.links : []) {
      if (!l || !l.to_concept_id) continue;
      links.push({
        from_concept_id: from,
        to_concept_id: norm(l.to_concept_id),
        label: l.label || '',
        source: 'author'
      });
    }
  }
  return { repo_id, links, concept_count: rows.length };
}

/** Build the bundle manifest doc (Story: multi-domain discovery + author
 * structural graph). Computed from the persisted meta rows + the parsed
 * links[] array each concept already carries. Deterministic metadata only —
 * the LLM-generated summary (summary_text + concept_summaries) is computed
 * lazily on the first discovery read (see ensureSummary) and cached on the
 * manifest doc so subsequent reads are O(repos). The steward can pin the
 * summary via a manifest override (kept verbatim). Idempotent: same _key. */
async function buildManifestDoc(repo_id, version, cloned_from) {
  if (!repo_id) return null;
  const db = await getDb();
  const metaRows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid RETURN KEEP(m, ["_key","concept_id","title","type","labels","links","is_index","index_status","chunk_count"])',
      { rid: repo_id }
    )
  ).all();
  // Pull the repo's identifying fields (name/domain/okf_tag) from okf_repositories.
  const repoRows = await (
    await db.query(
      'FOR r IN okf_repositories FILTER r.repo_id == @rid RETURN KEEP(r, ["_key","name","domain","okf_tag","cloned_from","summary_override"])',
      { rid: repo_id }
    )
  ).all();
  const repo = repoRows[0] || {};
  const root_id = (metaRows.find((m) => m.type === 'index') || metaRows[0] || {}).concept_id || null;
  const linkMap = new Map();
  for (const m of metaRows) {
    if (Array.isArray(m.links)) {
      for (const l of m.links) {
        if (!l || !l.to_concept_id) continue;
        const key = `${m.concept_id}->${l.to_concept_id}`;
        if (!linkMap.has(key)) {
          linkMap.set(key, {
            from_concept_id: m.concept_id,
            to_concept_id: l.to_concept_id,
            weight: typeof l.weight === 'number' ? l.weight : 1.0,
            source: 'author'
          });
        }
      }
    }
  }
  const links = [...linkMap.values()];
  const summary_stats = {
    concept_count: metaRows.length,
    root_id,
    root_title: (metaRows.find((m) => m.concept_id === root_id) || {}).title || null,
    root_is_index: (metaRows.find((m) => m.concept_id === root_id) || {}).is_index === true,
    indexed_count: metaRows.filter((m) => m.index_status === 'indexed').length,
    rejected_count: metaRows.filter((m) => m.index_status === 'rejected').length,
    link_count: links.length
  };
  const concepts = metaRows
    .map((m) => ({
      id: m.concept_id,
      title: m.title || null,
      type: m.type || null,
      is_index: m.is_index === true,
      index_status: m.index_status || null,
      chunk_count: typeof m.chunk_count === 'number' ? m.chunk_count : 0,
      labels: Array.isArray(m.labels) ? m.labels : []
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    _key: repo_id,
    repo_id,
    name: repo.name || null,
    domain: repo.domain || null,
    version: typeof version === 'number' ? version : null,
    okf_tag: repo.okf_tag || null,
    root_id,
    concepts,
    links,
    summary_stats, // deterministic only; summary_text added lazily
    summary_text: repo.summary_override || null,
    summary_generated_at: null,
    summary_stale: false, // steward override OR lazy gen never yet done
    cloned_from: cloned_from || repo.cloned_from || null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/** Ensure the manifest has an LLM-generated summary (lazy, on first discovery
 * read). The summary is the retriever's tier-1 hook — without it the label
 * overlap score is meaningless against an empty summary field. Subsequent
 * reads use the cached value; on subsequent writes the cache is preserved
 * unless summary_stale is set (steward-controlled invalidation).
 *
 * The LLM is invoked with a compact prompt: the manifest's deterministic
 * metadata (concept titles, labels, root concept, link list) is enough for the
 * model to produce a 2-4 sentence bundle description. The model id follows
 * the !631 discovery policy (pin > /v1/models discovery — see
 * runLlmSummary). Result is cached on the manifest doc so
 * only one LLM call per bundle per cache-lifetime.
 *
 * Lazy semantics: if the LLM is unreachable (or times out), the manifest is
 * returned with summary_text=null and a discovery flag — label/token scoring
 * still works (it doesn't depend on summary_text). */
async function ensureSummary(repo_id, opts = {}) {
  const m = await readManifest(repo_id);
  if (!m) return null;
  // Review P4 (live-flagged): the stale flag must be honored BEFORE the
  // cached-text early return — the old order returned a stale-flagged summary
  // unchanged and the stale branch below was dead code. A summary is served
  // from cache only when it exists, is NOT stale-flagged, and force is unset.
  if (m.summary_text && !m.summary_stale && !opts.force) return m;
  const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000;
  const llmPrompt = buildSummaryPrompt(m);
  let summary_text = null;
  try {
    summary_text = await runLlmSummary(llmPrompt, { timeoutMs: timeout });
  } catch (err) {
    logger.warn('Manifest summary LLM failed (returning manifest with summary_text=null)', {
      repo_id,
      error: err.message
    });
  }
  if (!summary_text) return m;
  const db = await getDb();
  await db
    .collection('okf_bundle_manifest')
    .update(repo_id, { summary_text, summary_generated_at: nowIso(), summary_stale: false }, { keepNull: false });
  return { ...m, summary_text, summary_generated_at: nowIso(), summary_stale: false };
}

/** Compact LLM prompt — fits in <2k tokens for a 30-concept bundle. The
 * deterministic metadata is sufficient for an accurate description. */
function buildSummaryPrompt(m) {
  const conceptLines = m.concepts
    .map((c) => `${c.id}${c.is_index ? ' (root)' : ''} [${c.type || 'concept'}]: ${c.title || '(no title)'}`)
    .slice(0, 30)
    .join('\n');
  const linkLines = (m.links || [])
    .slice(0, 25)
    .map((l) => `  ${l.from_concept_id} -> ${l.to_concept_id}${l.weight !== 1.0 ? ` (weight=${l.weight})` : ''}`)
    .join('\n');
  return [
    `Summarize this OKF knowledge bundle in 2-4 sentences for a discovery index.`,
    `Bundle: ${m.name || '(unnamed)'} [domain=${m.domain || '?'}] version=${m.version || '?'}`,
    `Concepts (${m.summary_stats?.concept_count || m.concepts.length}):`,
    conceptLines,
    linkLines ? `Author links:\n${linkLines}` : '',
    'Output ONLY the 2-4 sentence summary, no preamble.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Out-of-process LLM call (vLLM-compatible chat/completions). Review P8
 * (live-flagged): vLLM's OpenAI-compatible server has NO token endpoint and
 * takes the STATIC VLLM_API_KEY bearer directly — the old client_credentials
 * dance against an invented `/v1/auth/token` 404'd silently on every call
 * (summaries stayed null forever). Also normalizes the base: VLLM_ENDPOINT in this
 * stack conventionally ends in `/v1`, so appending `/v1/chat/completions`
 * verbatim produced `/v1/v1/...`. Short timeout — best-effort, off the
 * ingestion hot path. */
async function runLlmSummary(prompt, { timeoutMs = 5000 } = {}) {
  // The opt-in gate: compose ships VLLM_ENDPOINT empty (the OKF LLM legs
  // stay off until a deployment names the endpoint).
  const rawBase = modelCache.optedInVllmBase();
  if (!rawBase) return null;
  // Model id under the !631 policy (services/vllm-model-cache.js): pin ->
  // /v1/models discovery -> loud. The probe budget stays inside the caller's
  // best-effort timeout. Resolution failure keeps the lazy-summary
  // semantics: summary stays null, discovery scoring is unaffected (#1181).
  let model;
  let chatTimeoutMs;
  try {
    const resolved = await modelCache.resolveDeploymentModel({
      baseUrl: rawBase,
      apiKey: modelCache.deploymentKey(),
      budgetMs: timeoutMs,
      // A best-effort summary: a slow probe must not eat half of its
      // answer window — the probe gets 1 s, the answer the rest.
      probeBudgetMs: Math.min(1000, timeoutMs)
    });
    model = resolved.model;
    chatTimeoutMs = resolved.remainingMs;
  } catch (err) {
    // Loud in the LOG even though the summary stays null (best-effort
    // surface): the operator must be able to tell "no model configured"
    // from "the endpoint is down" from "the model could not be discovered".
    logger.warn('concept_meta.summary_model_unresolved', { endpoint: rawBase, error: err.message });
    return null;
  }
  const headers = {};
  const apiKey = modelCache.deploymentKey(); // the same read the probe uses
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // ROUND 23 (review 81255): this was the LAST raw-axios sibling of the
  // adaptive client — the round-21 wave migrated topic-link-authoring with
  // the comment "the last named straggler", and this call (same
  // deploymentKey probe, same Authorization, same llm-url URL rule) was
  // missed. One client: reasoning-model 400s negotiate here too.
  const r = await require('./adaptive-llm-call').adaptiveChatCompletion({
    // Shared URL rule (services/llm-url.js): a versioned base keeps its
    // segment and takes /chat/completions; a bare host gets /v1 appended.
    url: require('./llm-url').openAiChatUrl(rawBase),
    headers,
    body: {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.0
    },
    timeoutMs: chatTimeoutMs
  });
  return (r.data?.choices?.[0]?.message?.content || '').trim() || null;
}

/** Write (overwrite) the manifest doc for a repo. Called from the controller's
 * settle path (see settleBundleIfComplete — may fire more than once per
 * lifecycle: re-settles after a re-index). Idempotent: same _key. The
 * deterministic body is overwritten; the LLM summary cache is PRESERVED
 * across re-settles (review P3, live-flagged: the unconditional replace
 * nulled summary_text on every re-settle, breaking the "one LLM call per
 * bundle" contract) unless the steward flagged it stale. */
async function writeManifest(repo_id, version, cloned_from) {
  const doc = await buildManifestDoc(repo_id, version, cloned_from);
  if (!doc) return null;
  const db = await getDb();
  // Carry the cached summary forward on re-settle (P3): if a previous
  // ensureSummary generated + cached one and it is not stale-flagged, keep it
  // (a fresh steward override on the repo row already wins via buildManifestDoc).
  const existing = await readManifest(repo_id);
  if (
    existing &&
    existing.summary_text &&
    !existing.summary_stale &&
    !doc.summary_text // no override in play
  ) {
    doc.summary_text = existing.summary_text;
    doc.summary_generated_at = existing.summary_generated_at;
  }
  await db.collection('okf_bundle_manifest').save(doc, { overwrite: true });
  return doc;
}

/** Read the manifest doc for a repo (null when absent / not yet settled). */
async function readManifest(repo_id) {
  if (!repo_id) return null;
  const db = await getDb();
  const rows = await (
    await db.query('FOR d IN okf_bundle_manifest FILTER d._key == @rid RETURN d', { rid: repo_id })
  ).all();
  return rows[0] || null;
}

/** Multi-domain discovery (Story: tier 1 of the retriever pre-filter).
 * Read every manifest, score each by label overlap + name/domain token
 * match against the query's normalized tokens + labels. Return the top-K
 * candidate repos ordered by score (desc). O(repos) per call — manifests are
 * the discovery index; tier 2 (chunk label scan) and tier 3 (graph walk)
 * are the per-repo drills that follow this pre-filter. */
async function discoverRepos(query, opts = {}) {
  const q = (query && query.tokens) || [];
  const qLabels = (query && query.labels) || [];
  // Review P10: clamp k — the old Number.isInteger check accepted 0, negatives
  // (slice(0,-3) silently drops the LAST 3), and unbounded values.
  const k = Math.min(Math.max(Number.isInteger(opts.k) ? opts.k : 5, 1), 50);
  const domainFilter = (query && query.domain) || null;
  const db = await getDb();
  const manifests = await (await db.query('FOR d IN okf_bundle_manifest RETURN d')).all();
  const scored = [];
  const qTokenSet = new Set(q.map((t) => String(t).toLowerCase()).filter(Boolean));
  const qLabelSet = new Set(qLabels.map((l) => String(l).toLowerCase()));
  for (const m of manifests) {
    // Review P9: a domain-scoped query excludes null-domain manifests — the
    // old `m.domain &&` guard let undomained repos bypass every filter.
    if (domainFilter && m.domain !== domainFilter) continue;
    let score = 0;
    // Label overlap is the dominant signal (matches the retriever's tier 2
    // discriminator — repos whose bundle labels match the query are most likely
    // to contain the answer chunks). Review P6: BOTH sides lowercased — the
    // old comparison lowercased the query but not the stored labels, so
    // mixed-case taxonomy labels never matched.
    const rLabels = new Set(
      (Array.isArray(m.concepts) ? m.concepts.flatMap((c) => (Array.isArray(c.labels) ? c.labels : [])) : []).map((l) =>
        String(l).toLowerCase()
      )
    );
    for (const ql of qLabelSet) if (rLabels.has(ql)) score += 3;
    // Name + domain token match (lower weight — covers queries that name the
    // domain explicitly).
    const text = `${m.name || ''} ${m.domain || ''}`.toLowerCase();
    for (const t of qTokenSet) if (text.includes(t)) score += 1;
    // Review P5: the manifest field is summary_text (m.summary was always undefined).
    scored.push({ repo_id: m.repo_id, name: m.name, domain: m.domain, summary_text: m.summary_text || null, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Story #978 (Editor / PATCH concept): update a single concept's meta row
 * with new frontmatter + body. Recomputes `content_hash` from the trimmed
 * body. If the hash CHANGED, resets `index_status='parsed'` so the worker
 * re-indexes the concept on the next poll (4e dedup re-runs against the new
 * hash; a previously 'indexed' concept becomes 'parsed' → enqueued).
 *
 * Idempotent — same body hash → noop + returns the existing doc. Concept_id
 * is immutable (path is path).
 *
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {{frontmatter: Object, body: string}} parsed  (parser-service output)
 * @returns {Promise<Object|null>} the updated meta doc, or null if absent
 */
async function patchConceptMeta(repo_id, concept_id, parsed) {
  if (!repo_id || !concept_id || !parsed) {
    const err = new Error('patchConceptMeta: repo_id, concept_id, parsed are required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  const col = db.collection(COLLECTION);
  const existing = await findConceptDoc(col, repo_id, concept_id);
  if (!existing) {
    return null; // 404 at the controller layer
  }
  const newHash = contentHash(parsed.body || '');
  const hashChanged = existing.content_hash && existing.content_hash !== newHash;
  const patch = {
    frontmatter: parsed.frontmatter || {},
    body: parsed.body || '',
    sources: Array.isArray(parsed.sources) ? parsed.sources : existing.sources || [],
    links: Array.isArray(parsed.links) ? dedupeLinksForStorage(parsed.links) : existing.links || [],
    status: parsed.status || existing.status,
    stale_after: parsed.stale_after || null,
    trust_tier: parsed.trust_tier || existing.trust_tier,
    content_hash: newHash,
    // Hash change → reset to 'parsed' so the worker re-indexes. Otherwise
    // leave index_status alone — preserving 'indexed' when only frontmatter
    // (e.g. labels) changed avoids re-embedding unnecessarily.
    index_status: hashChanged ? 'parsed' : existing.index_status,
    // REVIEW FIX #9 (#1020): a content change must be claimable NOW — a
    // stale park (§5.5 backoff up to 15 min, §5.9 defer up to 6 h) would
    // hide the edited concept from every lane until the park expired, and
    // a stale claim would age it toward the reaper. Both belong to the NEW
    // drain cycle, not the parked one.
    ...(hashChanged ? { next_attempt_after: null, worker_claimed_at: null } : {}),
    updated_at: nowIso()
  };

  // LABELS REACH RAG (David's 'right now' fix, 2026-09-05): recompose BOTH
  // label fields on every patch — the display `labels` (frontmatter
  // labels[]) and the FIRST-CLASS `ingest_labels` the worker POSTs to
  // dataprep as fileLabels. Without this, a post-import label edit was
  // invisible to RAG labeling (ingest_labels was written ONLY at import).
  // Composed via ingest-service's SINGLE authority (lazy require — this
  // module and ingest-service reference each other); the repo doc supplies
  // domain/okf_tag, the SAME source the import path uses. Fail-soft: a
  // missing repo doc leaves the previous labels in place. NO re-embed: the
  // fm merge keeps content_hash, so index_status stays untouched.
  let repoDoc = null;
  try {
    repoDoc = await db.collection('okf_repositories').document(repo_id);
  } catch (err) {
    if (!isArangoNotFound(err)) throw err;
  }
  if (repoDoc) {
    const { composeIngestLabels } = require('./ingest-service');
    patch.labels = Array.isArray(parsed.frontmatter && parsed.frontmatter.labels)
      ? parsed.frontmatter.labels
      : existing.labels || [];
    patch.ingest_labels = composeIngestLabels(repoDoc, patch.labels);
  }
  // CONFORMANCE RECOMPUTE (David, 2026-09-12): every meta patch re-validates
  // the concept, so an issue clears the moment its cause is fixed (metadata
  // edits, Autocorrect) instead of haunting the publish gate with a stale
  // row. Pure validation — no scanner call. Lazy require: conformance-service
  // imports THIS module (same cycle break as ingest-service above).
  const { validateConcept } = require('./conformance-service');
  patch.conformance_issues = validateConcept(parsed).issues;
  await col.update(existing._key, patch);
  return { ...existing, ...patch };
}

/**
 * Story #978 — field-scoped PATCH modes (labels write-through, 2026-09-05):
 * `{ frontmatterPatch }` merges onto the CURRENT stored frontmatter and
 * `{ body }` replaces the body — both composed into markdown SERVER-SIDE
 * from stored state and routed through patchConceptMeta. Clients stop
 * round-tripping a frontmatter snapshot, so a label write can never be
 * clobbered by a concurrent index-TOC append or editor autosave (and vice
 * versa). Exactly one of the two keys must be present. A body replace
 * recomputes content_hash → index_status resets to 'parsed' (re-index); a
 * frontmatter merge keeps the hash → a label write never re-embeds.
 *
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {{frontmatterPatch?: Object, body?: string}} fields
 * @returns {Promise<Object|null>} the updated meta doc, or null if absent
 */
/**
 * RFC 7386 JSON-Merge-Patch semantics for the {frontmatter} PATCH (D-F #984 —
 * David: ALL frontmatter must be editable, including removal). An explicit
 * null REMOVES the key; an absent key is untouched; a non-null value
 * overwrites; nested objects merge recursively (so a null INSIDE a nested
 * object deletes that nested key). Arrays are replaced whole (per RFC — no
 * element-wise merge; a null INSIDE an array is data, not deletion).
 * Verified before adopting (coordinator brief): no existing caller sends
 * explicit nulls expecting them stored.
 */
function mergeFrontmatter(target, patch) {
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) {
      delete out[key];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeFrontmatter(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function patchConceptFields(repo_id, concept_id, { frontmatterPatch, body } = {}) {
  if (!repo_id || !concept_id) {
    const err = new Error('patchConceptFields: repo_id and concept_id are required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const hasFm = frontmatterPatch !== undefined && frontmatterPatch !== null;
  const hasBody = typeof body === 'string';
  if (hasFm === hasBody) {
    const err = new Error('patchConceptFields: exactly one of frontmatterPatch or body is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  const col = db.collection(COLLECTION);
  const existing = await findConceptDoc(col, repo_id, concept_id);
  if (!existing) {
    return null; // 404 at the controller layer
  }
  const fm = hasFm ? mergeFrontmatter(existing.frontmatter, frontmatterPatch) : existing.frontmatter || {};
  const bodyText = hasBody ? body : existing.body || '';
  const parsed = await parserService.parseConcept(matter.stringify(bodyText, fm), {
    repo_id,
    path: `${concept_id}.md` // path determines concept_id (unchanged on patch)
  });
  return patchConceptMeta(repo_id, concept_id, parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Story #978 — Editor "Autocorrect" (frontmatter-only, per David Q8)
// ─────────────────────────────────────────────────────────────────────────────

// Vocabulary lives in okf-vocabulary so it cannot drift from what the product
// actually writes. `AUTOCORRECT_TYPE_ENUM` includes the reserved root type:
// the bundle root is written with type 'index' (crawl-conversion-service) and
// may carry the authorial 'BundleRoot', and is_index is determined by IDENTITY
// (see the comment at :154-157) — so flagging its own reserved page as
// INVALID_TYPE produced a dead end with no remedy. BUG-11 / !1077.
//
// `AUTOCORRECT_STATUS_ENUM` was 'active|draft|retired' — a list nothing in the
// product produces. The corpus carries draft/stable (2,860 / 5 of 2,979
// concepts) and the regression test at concept-meta-service.test.js:304
// asserts `retired' is invalid. Autocorrect was therefore rejecting the
// `stable' concepts really have and accepting values nothing writes. Same
// vocabulary the rest of the service validates against, BUG-11 / !1077.
const { ALL_TYPES, CONTENT_TYPES, STATUS_VALUES } = require('./okf-vocabulary');
const AUTOCORRECT_TYPE_ENUM = ALL_TYPES;
const AUTOCORRECT_STATUS_ENUM = STATUS_VALUES;

/** Plan an autocorrect pass for one concept's frontmatter. Pure — no DB.
 * `opts.docRepoBase` (optional) enables the #1651 fill tier: a sources entry
 * carrying only a `file_id` gets its own doc-repository file URL as the
 * resource — the same construction the import writers stamp (producer-service
 * baseResource), so the repair derives exactly what a born-right entry would
 * carry. */
function planAutocorrectForConcept(meta, opts = {}) {
  const docRepoBase = opts.docRepoBase || null;
  const changes = [];
  const warnings = [];
  const fm = meta.frontmatter || {};

  // 1. type — set 'topic' if missing; warn (don't change) if outside enum.
  if (!fm.type) {
    changes.push({ field: 'type', before: null, after: 'topic', reason: 'MISSING_TYPE' });
  } else if (!AUTOCORRECT_TYPE_ENUM.includes(fm.type)) {
    warnings.push({
      rule: 'INVALID_TYPE',
      severity: 'warning',
      // Name the content types, not the full list: the reserved root types are
      // recognised and must not read as "you should have used one of these".
      message: `type "${fm.type}" not in ${CONTENT_TYPES.join('|')}`
    });
  }

  // 2. title — derive from first H1 in body or path.
  if (!fm.title) {
    const derived =
      deriveTitleFromBody(meta.body || '') ||
      (meta.path || '').replace(/\.md$/, '').split('/').pop() ||
      meta.concept_id;
    changes.push({ field: 'title', before: null, after: derived, reason: 'MISSING_TITLE' });
  }

  // 3. sources — ensure array exists (empty is fine; OKF spec doesn't require sources).
  if (!Array.isArray(fm.sources)) {
    changes.push({ field: 'sources', before: null, after: [], reason: 'MISSING_SOURCES' });
  } else {
    // SOURCE_MISSING_RESOURCE fix (David, 2026-09-12: "automatically fix
    // conformance issues like this"): a sources[] entry with an empty
    // "resource" gets one determinately — (#1651 ladder, most precise first)
    // the entry's OWN file_id (the doc-repo file URL, the exact value a
    // born-right entry carries), then the concept's provenance (meta.sources,
    // stamped by the crawl conversion), then the first non-empty sibling
    // resource. When none can supply one the entry is surfaced as a WARNING —
    // the old `if (!fill) return s` declined silently, the sheet read
    // "Nothing to fix", and El Salvador's 50 issues sat unfixable behind a
    // false clean bill (measured live 2026-11-09).
    const provenance = (meta.sources || []).map((s) => s && s.resource).find((r) => r && String(r).trim());
    let sibling = null;
    for (const s of fm.sources) {
      if (s && s.resource && String(s.resource).trim()) {
        sibling = String(s.resource).trim();
        break;
      }
    }
    let touched = false;
    const unfillable = [];
    const fixed = fm.sources.map((s, i) => {
      if (s && (!s.resource || !String(s.resource).trim())) {
        const ownFileId = s.file_id && String(s.file_id).trim();
        const fill =
          ownFileId && docRepoBase
            ? `${docRepoBase}/api/files/${ownFileId}`
            : String(provenance || sibling || '').trim();
        if (!fill) {
          unfillable.push(i);
          return s;
        }
        touched = true;
        return { ...s, resource: fill };
      }
      return s;
    });
    for (const i of unfillable) {
      warnings.push({
        rule: 'SOURCE_UNFIXABLE',
        severity: 'warning',
        message: `Source entry ${i} has no resource and none can be derived (no file_id, no provenance) — fix it in the editor`
      });
    }
    if (touched) {
      const anyOwnFileId = docRepoBase && fm.sources.some((s) => s && s.file_id && String(s.file_id).trim());
      changes.push({
        field: 'sources',
        before: fm.sources,
        after: fixed,
        reason: 'SOURCE_MISSING_RESOURCE',
        note: `resource filled from ${anyOwnFileId ? "each entry's own file_id" : provenance ? 'concept provenance' : 'sibling source entry'}`
      });
    }
  }

  // 4. status — the rule manages the FM field it writes, so read fm.status
  // first (a present value is only validated, never clobbered). A row that
  // carries a status SOMEWHERE ELSE (lifecycle_status, or the legacy
  // top-level status) is left alone — its state is already recorded, and
  // re-proposing fm.status would re-list the whole corpus on every run (the
  // drain rewrites frontmatter from the bundle, wiping fm.status — the
  // 2026-11-02 Quran sheet listed 6,351 rows because of exactly that). Only
  // a row with NO status anywhere gets the 'draft' default. Frontmatter
  // status ABSENT is not a conformance issue (validateConcept only rejects a
  // present-and-invalid value) — this rule is hygiene, not gate repair.
  const declaredStatus = fm.status;
  if (declaredStatus !== undefined && declaredStatus !== null && declaredStatus !== '') {
    if (!AUTOCORRECT_STATUS_ENUM.includes(declaredStatus)) {
      warnings.push({
        rule: 'INVALID_STATUS',
        severity: 'warning',
        message: `status "${declaredStatus}" not in ${AUTOCORRECT_STATUS_ENUM.join('|')}`
      });
    }
  } else if (meta.status == null && meta.lifecycle_status == null) {
    changes.push({ field: 'status', before: null, after: 'draft', reason: 'MISSING_STATUS' });
  } else {
    const mirror = meta.status || meta.lifecycle_status;
    if (!AUTOCORRECT_STATUS_ENUM.includes(mirror)) {
      warnings.push({
        rule: 'INVALID_STATUS',
        severity: 'warning',
        message: `status "${mirror}" not in ${AUTOCORRECT_STATUS_ENUM.join('|')}`
      });
    }
  }

  // 5. stale_after — normalize any PARSEABLE date to the spec'd YYYY-MM-DD
  // (#1037): bundles commonly carry full ISO timestamps or YAML Date objects,
  // which import-time parsing tolerates but patch-time conformance (seeing
  // the raw frontmatter string) flags as UNPARSEABLE_STALE_AFTER — the one
  // issue class this panel could never fix. FORMAT-level rule only: any
  // parseable date normalizes, an unparseable value is CLEARED (the RFC
  // 7386 null patch deletes the key) with a visible warning. Nothing here
  // is specific to any bundle's content.
  if (fm.stale_after !== undefined && fm.stale_after !== null && fm.stale_after !== '') {
    const isSpecForm = typeof fm.stale_after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fm.stale_after.trim());
    if (!isSpecForm) {
      let normalized = null;
      if (fm.stale_after instanceof Date) {
        normalized = DateTime.fromJSDate(fm.stale_after).toUTC().toISODate();
      } else {
        const dt = DateTime.fromISO(String(fm.stale_after).trim());
        if (dt.isValid) normalized = dt.toUTC().toISODate();
      }
      if (normalized) {
        changes.push({
          field: 'stale_after',
          before: fm.stale_after,
          after: normalized,
          reason: 'STALE_AFTER_FORMAT',
          note: 'normalized to the YYYY-MM-DD spec form'
        });
      } else {
        changes.push({
          field: 'stale_after',
          before: fm.stale_after,
          after: null,
          reason: 'STALE_AFTER_UNPARSEABLE',
          note: 'unparseable date cleared'
        });
        warnings.push({
          rule: 'STALE_AFTER_CLEARED',
          severity: 'warning',
          message: `stale_after "${String(fm.stale_after)}" is not a parseable date — it will be cleared`
        });
      }
    }
  }

  return { changes, warnings };
}

function deriveTitleFromBody(body) {
  if (!body) return null;
  const m = body.match(/^#{1,2}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * Story #978 — Editor "Autocorrect" action. Scans every concept in this
 * repo, plans changes per the frontmatter rules, applies them when dry_run
 * is false. Atomic per-concept — partial failures don't roll back earlier
 * successes.
 *
 * @param {string} repo_id
 * @param {boolean} dry_run
 * @param {object} actor (unused — audit is per-concept in the patch path)
 * @returns {Promise<{changes, warnings, applied, failed, failures, total_concepts}>}
 *   failures names every concept whose patch did not land (per-concept retry
 *   included) — the caller must surface it; a silent skip is what made the
 *   2026-11-02 Quran apply look like a no-op.
 */
async function autocorrectRepo(repo_id, dry_run = true) {
  const db = await getDb();
  const col = db.collection(COLLECTION);
  const cursor = await db.query(aql`FOR m IN ${col} FILTER m.repo_id == ${repo_id} RETURN m`);
  const concepts = await cursor.all();
  // #1651: the doc-repo base enables the own-file_id fill tier — the URL a
  // born-right sources entry carries (producer-service baseResource shape).
  const docRepoBase = config.documentRepository && config.documentRepository.url;
  const allChanges = [];
  const allWarnings = [];
  const failures = [];
  let appliedCount = 0;
  let failedCount = 0;
  for (const meta of concepts) {
    const { changes, warnings } = planAutocorrectForConcept(meta, { docRepoBase });
    if (changes.length > 0) {
      allChanges.push({ concept_id: meta.concept_id, changes });
    }
    if (warnings.length > 0) {
      allWarnings.push({ concept_id: meta.concept_id, warnings });
    }
    if (!dry_run && changes.length > 0) {
      // APPLY through patchConceptFields (NOT a raw row update): the patch
      // re-parses the concept, so conformance_issues are RE-COMPUTED — the
      // whole point of an autocorrect for a conformance finding. The old raw
      // col.update fixed the frontmatter but left the stale issue sitting on
      // the meta row, so the publish gate kept seeing it.
      const patch = {};
      for (const c of changes) {
        patch[c.field] = c.after;
      }
      // One concept failing must not abort the run and one transient miss
      // must not vanish: a 6,351-concept apply on the live local build
      // (2026-11-02, Quran Core) silently skipped 785 consecutive rows when
      // the row lookup answered not-found mid-run — the very next request
      // applied 784 of the same rows with zero code changes between. The
      // lookup gets one immediate retry; whatever still fails is recorded
      // and returned so the panel can surface it instead of the sheet
      // silently disagreeing with the corpus.
      let updated = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2 && !updated; attempt += 1) {
        try {
          updated = await patchConceptFields(repo_id, meta.concept_id, { frontmatterPatch: patch });
          if (!updated) lastError = 'concept row not found';
        } catch (err) {
          updated = null;
          lastError = err && err.message ? err.message : String(err);
        }
      }
      if (updated) {
        appliedCount += 1;
      } else {
        failedCount += 1;
        failures.push({ concept_id: meta.concept_id, error: lastError || 'unknown error' });
      }
    }
  }
  return {
    changes: allChanges,
    warnings: allWarnings,
    applied: appliedCount,
    failed: failedCount,
    failures,
    total_concepts: concepts.length
  };
}

module.exports = {
  // Exported for the vocabulary guard (okf-vocabulary.test.js), which asserts
  // the reserved index type is never flagged INVALID_TYPE.
  planAutocorrectForConcept,
  upsertConceptMeta,
  getConceptMeta,
  getConceptMetaFromAnyRepo,
  purgeConceptIngestionLogs,
  listConceptsMeta,
  listConceptTree,
  ensureTreeIndex,
  patchConceptMeta,
  patchConceptFields,
  requeueRepoForRedrain,
  requeueFailedForReingest,
  stampRepoGraphName,
  deleteConceptMeta,
  autocorrectRepo,
  buildMetaDoc,
  contentHash,
  dedupeLinksForStorage,
  countByIndexStatus,
  // The concept-document ceiling — the publish gate's backstop (the plan's §7).
  listOverCeiling,
  // Bundle manifest (Story: multi-domain discovery + author structural graph)
  writeManifest,
  readManifest,
  ensureSummary,
  discoverRepos,
  // Editor graph projection (markdown-link edges, live — David 2026-09-04)
  getRepoLinks
};
