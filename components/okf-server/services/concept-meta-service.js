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

const axios = require('axios');
const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const config = require('../config');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const { isArangoNotFound, isArangoUniqueViolation } = require('./arango-errors');
const { aql } = require('arangojs');

const COLLECTION = 'okf_concepts_meta';

const LIFECYCLE_STATUSES = ['draft', 'stable', 'deprecated'];

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
  const links = Array.isArray(p.links) ? p.links : [];
  return {
    repo_id,
    concept_id: p.concept_id,
    path,
    graph_name: `OKF_${repo_id}`,
    bundle_version: p.bundle_version != null ? p.bundle_version : (opts.bundle_version ?? null),
    title,
    type: fm.type || '',
    // Story 4.8-amend (2026-08-19): index.md is the bundle ROOT/discovery entry —
    // `type: index` is the reserved marker. Persisted first-class so traversal has
    // a seed and serving can enumerate the entry point without string-matching.
    is_index: fm.type === 'index',
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
    const contentChanged =
      patch.content_hash != null && existing.content_hash != null && patch.content_hash !== existing.content_hash;
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

/** Count a repo's meta rows at a given index_status (bundle completion
 * check — the internal controller asks "are any concepts still parsed?"). */
async function countByIndexStatus(repo_id, index_status) {
  if (!repo_id || !index_status) return 0;
  const db = await getDb();
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status == @st COLLECT WITH COUNT INTO n RETURN n',
      { rid: repo_id, st: index_status }
    )
  ).all();
  return rows[0] || 0;
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
 * model to produce a 2-4 sentence bundle description. The model id matches
 * VLLM_MODEL_ID (configurable). Result is cached on the manifest doc so
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
 * (summaries永远 null). Also normalizes the base: VLLM_ENDPOINT in this
 * stack conventionally ends in `/v1`, so appending `/v1/chat/completions`
 * verbatim produced `/v1/v1/...`. Short timeout — best-effort, off the
 * ingestion hot path. */
async function runLlmSummary(prompt, { timeoutMs = 5000 } = {}) {
  const rawBase = config?.llm?.endpoint || process.env.VLLM_ENDPOINT;
  if (!rawBase) return null;
  const model = config?.llm?.model || process.env.VLLM_MODEL_ID;
  if (!model) return null;
  // Normalize: strip a trailing /v1 (and any trailing slash) so the
  // /v1/chat/completions append is exactly right for both endpoint shapes.
  const base = rawBase.replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = {};
  const apiKey = process.env.VLLM_API_KEY || config?.llm?.apiKey;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await axios.post(
    `${base}/v1/chat/completions`,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.0
    },
    { timeout: timeoutMs, headers }
  );
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
    links: Array.isArray(parsed.links) ? parsed.links : existing.links || [],
    status: parsed.status || existing.status,
    stale_after: parsed.stale_after || null,
    trust_tier: parsed.trust_tier || existing.trust_tier,
    content_hash: newHash,
    // Hash change → reset to 'parsed' so the worker re-indexes. Otherwise
    // leave index_status alone — preserving 'indexed' when only frontmatter
    // (e.g. labels) changed avoids re-embedding unnecessarily.
    index_status: hashChanged ? 'parsed' : existing.index_status,
    updated_at: nowIso()
  };
  await col.update(existing._key, patch);
  return { ...existing, ...patch };
}

// ─────────────────────────────────────────────────────────────────────────────
// Story #978 — Editor "Autocorrect" (frontmatter-only, per David Q8)
// ─────────────────────────────────────────────────────────────────────────────

const AUTOCORRECT_TYPE_ENUM = ['topic', 'entity', 'process', 'event', 'source'];
const AUTOCORRECT_STATUS_ENUM = ['active', 'draft', 'retired'];

/** Plan an autocorrect pass for one concept's frontmatter. Pure — no DB. */
function planAutocorrectForConcept(meta) {
  const changes = [];
  const warnings = [];
  const fm = meta.frontmatter || {};

  // 1. type — set 'topic' if missing; warn (don't change) if outside enum.
  if (!fm.type) {
    changes.push({ field: 'type', before: null, after: 'topic', reason: 'MISSING_TYPE' });
  } else if (!AUTOCORRECT_TYPE_ENUM.includes(fm.type)) {
    warnings.push({ rule: 'INVALID_TYPE', severity: 'warning', message: `type "${fm.type}" not in ${AUTOCORRECT_TYPE_ENUM.join('|')}` });
  }

  // 2. title — derive from first H1 in body or path.
  if (!fm.title) {
    const derived = deriveTitleFromBody(meta.body || '') || (meta.path || '').replace(/\.md$/, '').split('/').pop() || meta.concept_id;
    changes.push({ field: 'title', before: null, after: derived, reason: 'MISSING_TITLE' });
  }

  // 3. sources — ensure array exists (empty is fine; OKF spec doesn't require sources).
  if (!Array.isArray(fm.sources)) {
    changes.push({ field: 'sources', before: null, after: [], reason: 'MISSING_SOURCES' });
  }

  // 4. status — default 'draft'; warn if outside enum.
  if (!meta.status) {
    changes.push({ field: 'status', before: null, after: 'draft', reason: 'MISSING_STATUS' });
  } else if (!AUTOCORRECT_STATUS_ENUM.includes(meta.status)) {
    warnings.push({ rule: 'INVALID_STATUS', severity: 'warning', message: `status "${meta.status}" not in ${AUTOCORRECT_STATUS_ENUM.join('|')}` });
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
 * @returns {Promise<{changes, warnings, applied}>}
 */
async function autocorrectRepo(repo_id, dry_run = true) {
  const db = await getDb();
  const col = db.collection(COLLECTION);
  const cursor = await db.query(aql`FOR m IN ${col} FILTER m.repo_id == ${repo_id} RETURN m`);
  const concepts = await cursor.all();
  const allChanges = [];
  const allWarnings = [];
  let appliedCount = 0;
  for (const meta of concepts) {
    const { changes, warnings } = planAutocorrectForConcept(meta);
    if (changes.length > 0) {
      allChanges.push({ concept_id: meta.concept_id, changes });
    }
    if (warnings.length > 0) {
      allWarnings.push({ concept_id: meta.concept_id, warnings });
    }
    if (!dry_run && changes.length > 0) {
      const patch = { updated_at: nowIso() };
      for (const c of changes) {
        if (c.field === 'sources') patch.frontmatter = { ...(meta.frontmatter || {}), sources: c.after };
        else patch.frontmatter = { ...(meta.frontmatter || {}), [c.field]: c.after };
      }
      await col.update(meta._key, patch);
      appliedCount += 1;
    }
  }
  return { changes: allChanges, warnings: allWarnings, applied: appliedCount, total_concepts: concepts.length };
}

module.exports = {
  upsertConceptMeta,
  getConceptMeta,
  getConceptMetaFromAnyRepo,
  patchConceptMeta,
  autocorrectRepo,
  buildMetaDoc,
  contentHash,
  countByIndexStatus,
  // Bundle manifest (Story: multi-domain discovery + author structural graph)
  writeManifest,
  readManifest,
  ensureSummary,
  discoverRepos
};
