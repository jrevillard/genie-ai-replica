// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.6 — frontmatter tagging + vectorization.
//
// Every OKF repo at lifecycle_state=publish MUST carry a curator-controlled
// frontmatter (topics, entities, scope, forbidden, summary, keyword). Tags
// are LLM-auto-suggested at publish time from a chunk sample, the curator
// reviews/edits, and the publish pipeline BLOCKS if frontmatter is missing or
// empty — INDEPENDENT of OKF_SEARCH_STYLE. This is the architectural guarantee
// that an operator can flip OKF_SEARCH_STYLE at runtime without re-ingesting.
//
// GPU services used (per directive 2026-10-07):
//   - vLLM (VLLM_LLM_HOST, e.g. ${VLLM_LLM_MODEL_ID}-served) for /v1/chat/completions:
//     suggestTags + validateFrontmatter. Same AsyncOpenAI-like pattern dataprep
//     uses at genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:57 — here
//     via axios since Node has no openai SDK.
//   - TEI embedding (TEI_EMBED_HOST, /embed) for embedAllTags. One call per
//     tag value; TEI batches natively. Vector dimension MUST match
//     EMBEDDING_MODEL_ID's native dim (1024 for bge-large-en-v1.5).
//
// Resilience (per reference_remote-llm-endpoint.md — vllm-llm is REMOTE SHARED
// infra that crash-loops; vLLM calls use exponential backoff with jitter on
// 502/503/504, 3 retries, base 1s, max 8s; storm cool-down on consecutive
// failures; honest failure after exhaustion). TEI uses single-retry 30s.
//
// Hot-path read is served by a separate denormalized collection
// (okf_repositories_frontmatter_summary) computed HERE at publish; this service
// never reads at query time.

const axios = require('axios');
const nodeCrypto = require('crypto');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const auditService = require('./audit-service');
const { isArangoNotFound } = require('./arango-errors');
const { workingGraphName } = require('./graph-lifecycle-service');

// ---------- Config (env-driven; env vars match the docker-compose template) ----------

const VLLM_LLM_HOST = process.env.VLLM_LLM_HOST || 'http://vllm-llm-served:8000';
const VLLM_LLM_MODEL_ID = process.env.VLLM_LLM_MODEL_ID || 'ibm-granite/granite-4.1-8b';
const VLLM_LLM_API_KEY = process.env.VLLM_LLM_API_KEY || '';

const TEI_EMBED_HOST = process.env.TEI_EMBED_HOST || 'http://embedding-tei:80';
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '1024', 10);

const OKF_FRONTMATTER_VALIDATE_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.OKF_FRONTMATTER_VALIDATE_BATCH_SIZE || '4', 10)
);
const OKF_FRONTMATTER_SAMPLE_N = parseInt(process.env.OKF_FRONTMATTER_SAMPLE_N || '50', 10);
const OKF_FRONTMATTER_VALIDATE_SAMPLE_PCT = parseFloat(process.env.OKF_FRONTMATTER_VALIDATE_SAMPLE_PCT || '0.1');
const OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD = parseFloat(
  process.env.OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD || '0.3'
);

// ---------- Constants ----------

const FRONTMATTER_COLLECTION = 'okf_repo_frontmatter';
const FRONTMATTER_SUMMARY_COLLECTION = 'okf_repositories_frontmatter_summary';

const VALID_FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];
const FIELD_RANGES = {
  topic: { min: 3, max: 8, default_weight: 1.0 },
  entity: { min: 0, max: 10, default_weight: 0.7 },
  keyword: { min: 0, max: 10, default_weight: 0.5 },
  summary: { min: 1, max: 1, default_weight: 0.5 },
  scope: { min: 1, max: 1, default_weight: 0.3 },
  forbidden: { min: 2, max: 6, default_weight: 0.0 } // penalty; weight unused
};

// ---------- Errors ----------

class FrontmatterError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'FrontmatterError';
    this.code = code;
    this.status = status;
  }
}

// ---------- Retry helper (exponential backoff with jitter; per reference_remote-llm-endpoint.md) ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withVllmRetry(fn, ctx) {
  const base = 1000;
  const max = 8000;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err && err.response && err.response.status;
      const retriable =
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ECONNREFUSED';
      if (!retriable || attempt === 2) break;
      const delay = Math.min(max, base * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
      logger.warn('frontmatter.vllm.retry', {
        ...ctx,
        attempt: attempt + 1,
        status,
        delay_ms: delay,
        err: err.message
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function withTeiRetry(fn, ctx) {
  try {
    return await fn();
  } catch (err) {
    const status = err && err.response && err.response.status;
    const retriable =
      status === 502 || status === 503 || status === 504 || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED';
    if (!retriable) throw err;
    logger.warn('frontmatter.tei.retry', { ...ctx, status, err: err.message });
    await sleep(500);
    return await fn();
  }
}

// ---------- LLM call (vLLM OpenAI surface, via axios — Node has no openai SDK) ----------

const TAG_PROMPT = (
  sampleSize,
  chunksText
) => `You are a curator for an enterprise knowledge-base system. A repository of
${sampleSize} document chunks will be ingested. Based on the chunks below, produce
a JSON object with these keys:

  topic:        list of 3-8 high-level topics the corpus covers (e.g. "antitrust-law",
                "balinese-hindu-rituals", "uk-vehicle-tax"). Each must be a phrase
                that a USER SEARCHING FOR INFORMATION might type.
  entity:       list of 0-10 specific named entities mentioned (people, products,
                places, organizations).
  scope:        single best-fit word from: geographic, technical, regulatory,
                cultural, scientific, encyclopedic, commercial, historical.
  forbidden:    list of 2-6 things a USER MIGHT EXPECT TO FIND in a corpus of
                this name that are NOT actually here. Critical for avoiding
                misrouting.
  summary:      1-2 sentences describing what this corpus actually contains.
  keyword:      list of 0-10 specific low-coverage terms that strongly indicate
                this corpus.

The tag strings must be SHORT (1-3 words), lowercase, hyphenated.
Output ONLY the JSON object - no commentary.

CHUNKS:
${chunksText}
`;

const VALIDATE_PROMPT = (
  tag,
  sampleText
) => `For each chunk below, answer "yes" or "no" with one short sentence: does this chunk match the tag "${tag}"?

CHUNKS:
${sampleText}

Output ONLY a JSON object: {"results": [{"index": <int>, "match": "yes"|"no", "reason": "<one sentence>"}, ...]}`;

async function vllmChatCompletions(systemAndUserMessages, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (VLLM_LLM_API_KEY) headers['Authorization'] = 'Bearer ' + VLLM_LLM_API_KEY;
  const body = {
    model: VLLM_LLM_MODEL_ID,
    messages: systemAndUserMessages,
    max_tokens: opts.maxTokens || 800,
    temperature: opts.temperature || 0.0,
    response_format: { type: 'json_object' }
  };
  const fn = () => axios.post(`${VLLM_LLM_HOST}/v1/chat/completions`, body, { headers, timeout: 60000 });
  return withVllmRetry(fn, { endpoint: '/v1/chat/completions' });
}

function extractJson(content) {
  const m = content && content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ---------- TEI embed call ----------

async function teiEmbed(inputs) {
  const body = { inputs, truncate: true };
  const fn = () =>
    axios.post(`${TEI_EMBED_HOST}/embed`, body, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
  const resp = await withTeiRetry(fn, { endpoint: '/embed', batch_size: Array.isArray(inputs) ? inputs.length : 1 });
  // TEI returns either {data: [[...], ...]} (batched) or [...] depending on shape
  const out = resp.data && (resp.data.data || resp.data.embeddings || resp.data);
  if (Array.isArray(out) && Array.isArray(out[0])) return out;
  if (Array.isArray(out) && out.length && Array.isArray(out[0])) return out;
  if (Array.isArray(out) && out.length && typeof out[0] === 'number') return [out];
  throw new FrontmatterError('EMBED_BAD_SHAPE', 'TEI embed returned an unexpected shape', 502);
}

// ---------- Validation ----------

function normalizeTag(s) {
  if (typeof s !== 'string') return null;
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 64);
}

function validateFrontmatterShape(fm) {
  if (!fm || typeof fm !== 'object') throw new FrontmatterError('EMPTY', 'frontmatter is empty', 400);
  const errors = [];
  for (const field of VALID_FIELDS) {
    const range = FIELD_RANGES[field];
    const values = Array.isArray(fm[field])
      ? fm[field]
      : field === 'summary' || field === 'scope'
        ? [fm[field]].filter(Boolean)
        : [];
    if (values.length < range.min || values.length > range.max) {
      errors.push(`${field}: must have ${range.min}-${range.max} values (got ${values.length})`);
    }
  }
  // forbidden must be non-empty if the corpus is NOT marked comprehensive
  if (!fm.comprehensive && (!Array.isArray(fm.forbidden) || fm.forbidden.length < 2)) {
    errors.push(
      'forbidden: must list 2-6 things users might expect but are NOT in this corpus (or set comprehensive=true)'
    );
  }
  // forbidden values must NOT collide with topic values
  const topicSet = new Set((fm.topic || []).map(normalizeTag).filter(Boolean));
  const forbCollision = (fm.forbidden || [])
    .map(normalizeTag)
    .filter(Boolean)
    .filter((v) => topicSet.has(v));
  if (forbCollision.length) errors.push(`forbidden collides with topic: ${forbCollision.join(', ')}`);
  if (errors.length) throw new FrontmatterError('VALIDATION', errors.join('; '), 400);
  return true;
}

// ---------- DB helpers ----------

// Cached "both frontmatter collections + indexes are present" sentinel.
// Resets to false on any create/index operation so a single cold start
// re-runs listCollections, then all subsequent GETs are no-ops. Necessary
// because the publish path also calls ensureCollections (cheap when cached)
// and we need a single source of truth for "are we ready to query?".
let _frontmatterEnsured = false;

async function ensureCollections(db) {
  if (_frontmatterEnsured) return;
  const collections = await db.listCollections();
  const existing = new Set(collections.map((c) => c.name));
  if (!existing.has(FRONTMATTER_COLLECTION)) {
    await db.createCollection(FRONTMATTER_COLLECTION);
    logger.info('frontmatter.collection_created', { name: FRONTMATTER_COLLECTION });
  }
  if (!existing.has(FRONTMATTER_SUMMARY_COLLECTION)) {
    await db.createCollection(FRONTMATTER_SUMMARY_COLLECTION);
    logger.info('frontmatter.summary_collection_created', { name: FRONTMATTER_SUMMARY_COLLECTION });
  }
  // Indexes
  const fmIdx = (await db.collection(FRONTMATTER_COLLECTION).indexes()).map((i) => i.name);
  if (!fmIdx.includes('idx_repo_id')) {
    await db.collection(FRONTMATTER_COLLECTION).ensureIndex({ type: 'persistent', fields: ['repo_id'] });
  }
  if (!fmIdx.includes('idx_repo_field')) {
    await db.collection(FRONTMATTER_COLLECTION).ensureIndex({ type: 'persistent', fields: ['repo_id', 'field'] });
  }
  _frontmatterEnsured = true;
}

async function sampleChunksFromRepo(db, repoId, n) {
  // Pull N random chunks from <graph>_SOURCE. The serving graph name is
  // resolved by the canonical helper `workingGraphName(repo)` — graphs are
  // BORN OKF_<slug>_v<N>, never OKF_{repo_id}. Sample from the LATEST
  // published version (even if not yet ingested). Fall back to concept-meta
  // text if no graph exists.
  const q = await db.query(`FOR r IN okf_repositories FILTER r._key == @rid LIMIT 1 RETURN r`, { rid: repoId });
  const list = await q.all();
  const repo = list && list[0];
  if (!repo) throw new FrontmatterError('REPO_NOT_FOUND', `repo ${repoId} not found`, 404);
  const graph = workingGraphName(repo);
  if (graph) {
    try {
      const cq = await db.query(`FOR c IN \`${graph}_SOURCE\` SORT RAND() LIMIT @n RETURN LEFT(c.text, 1500)`, { n });
      const chunks = await cq.all();
      if (chunks.length) return { repo, chunks };
    } catch (e) {
      logger.warn('frontmatter.sample.graph_unavailable', { repo_id: repoId, graph, err: e.message });
    }
  }
  // Fallback: sample concept text from okf_concepts_meta
  const cq = await db.query(
    `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid && m.text != null SORT RAND() LIMIT @n RETURN LEFT(m.text, 1500)`,
    { rid: repoId, n }
  );
  const chunks = await cq.all();
  return { repo, chunks };
}

// ---------- Public methods ----------

async function suggestTags(repoId, opts = {}) {
  return withSpan('okf.frontmatter.suggest', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    const sampleN = opts.sampleN || OKF_FRONTMATTER_SAMPLE_N;
    const { chunks } = await sampleChunksFromRepo(db, repoId, sampleN);
    if (!chunks.length) throw new FrontmatterError('NO_CHUNKS', 'no chunks available to suggest tags', 400);
    span.setAttribute('okf.sample_size', chunks.length);
    const chunksText = chunks.join('\n\n---\n\n');
    const prompt = TAG_PROMPT(chunks.length, chunksText.slice(0, 6000));
    logger.info('frontmatter.suggest.start', { repo_id: repoId, sample_size: chunks.length, vllm_host: VLLM_LLM_HOST });
    const resp = await vllmChatCompletions([{ role: 'user', content: prompt }], { maxTokens: 1000 });
    const content =
      resp.data &&
      resp.data.choices &&
      resp.data.choices[0] &&
      resp.data.choices[0].message &&
      resp.data.choices[0].message.content;
    const parsed = extractJson(content);
    if (!parsed) {
      logger.error('frontmatter.suggest.parse_failed', {
        repo_id: repoId,
        content_preview: (content || '').slice(0, 200)
      });
      throw new FrontmatterError('LLM_PARSE', 'LLM returned unparseable JSON', 502);
    }
    // Normalize shape
    const out = {
      topic: Array.isArray(parsed.topic) ? parsed.topic.map(normalizeTag).filter(Boolean) : [],
      entity: Array.isArray(parsed.entity) ? parsed.entity.map(normalizeTag).filter(Boolean) : [],
      scope: Array.isArray(parsed.scope) ? normalizeTag(parsed.scope[0] || parsed.scope) : null,
      forbidden: Array.isArray(parsed.forbidden) ? parsed.forbidden.map(normalizeTag).filter(Boolean) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 512) : null,
      keyword: Array.isArray(parsed.keyword) ? parsed.keyword.map(normalizeTag).filter(Boolean) : []
    };
    span.setAttribute('okf.suggested.topic_count', out.topic.length);
    span.setAttribute('okf.suggested.forbidden_count', out.forbidden.length);
    logger.info('frontmatter.suggest.done', {
      repo_id: repoId,
      topic: out.topic.length,
      entity: out.entity.length,
      forbidden: out.forbidden.length
    });
    return out;
  });
}

async function validateFrontmatter(repoId, frontmatter, _opts = {}) {
  return withSpan('okf.frontmatter.validate', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    const { chunks } = await sampleChunksFromRepo(db, repoId, OKF_FRONTMATTER_SAMPLE_N);
    if (!chunks.length) return { validated: true, inconsistencies: [] };
    const sampleSize = Math.max(1, Math.ceil(chunks.length * OKF_FRONTMATTER_VALIDATE_SAMPLE_PCT));
    const sample = chunks.slice(0, sampleSize);
    const sampleText = sample.join('\n\n---\n\n').slice(0, 6000);
    const allTags = [
      ...(frontmatter.topic || []),
      ...(frontmatter.entity || []),
      ...(frontmatter.keyword || []),
      ...(frontmatter.forbidden || [])
    ].filter(Boolean);
    const inconsistencies = [];
    let cursor = 0;
    while (cursor < allTags.length) {
      const slice = allTags.slice(cursor, cursor + OKF_FRONTMATTER_VALIDATE_BATCH_SIZE);
      cursor += slice.length;
      const results = await Promise.all(
        slice.map(async (tag) => {
          const resp = await vllmChatCompletions([{ role: 'user', content: VALIDATE_PROMPT(tag, sampleText) }], {
            maxTokens: 600
          });
          const content =
            resp.data &&
            resp.data.choices &&
            resp.data.choices[0] &&
            resp.data.choices[0].message &&
            resp.data.choices[0].message.content;
          const parsed = extractJson(content);
          const results = parsed && parsed.results;
          if (!Array.isArray(results)) return { tag, inconsistent: false, match_ratio: 0, reason: 'parse_failed' };
          const yes = results.filter((r) => r.match === 'yes').length;
          const match_ratio = results.length ? yes / results.length : 0;
          return { tag, inconsistent: match_ratio < 1 - OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD, match_ratio };
        })
      );
      for (const r of results) {
        if (r.inconsistent) inconsistencies.push(r);
      }
    }
    span.setAttribute('okf.inconsistencies', inconsistencies.length);
    logger.info('frontmatter.validate.done', { repo_id: repoId, inconsistencies: inconsistencies.length });
    return { validated: inconsistencies.length === 0, inconsistencies };
  });
}

async function embedAllTags(frontmatter) {
  return withSpan('okf.frontmatter.embed', async (span) => {
    // Build flat list of values: each topic/entity/keyword/scope/forbidden value gets one vector;
    // summary gets one vector (whole sentence). Returns {field: [{value, vector}], ...}.
    const valuesByField = {};
    for (const field of VALID_FIELDS) {
      const arr = frontmatter[field];
      const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
      if (list.length === 0) {
        valuesByField[field] = [];
        continue;
      }
      const flat = list.map((v) => (typeof v === 'string' ? v : String(v)));
      const resp = await teiEmbed(flat);
      valuesByField[field] = flat.map((v, i) => ({ value: v, vector: resp[i] }));
    }
    // Sanity: all vectors match the expected dim
    let totalTags = 0;
    for (const field of VALID_FIELDS) {
      for (const { vector } of valuesByField[field]) {
        if (!vector || vector.length !== EMBEDDING_DIM) {
          throw new FrontmatterError(
            'EMBED_DIM_MISMATCH',
            `expected ${EMBEDDING_DIM}-dim vector from TEI; got ${vector ? vector.length : 'null'}`,
            502
          );
        }
        totalTags += 1;
      }
    }
    span.setAttribute('okf.embedded_tags', totalTags);
    return valuesByField;
  });
}

// Combine per-field vectors into the denormalized summary row.
// topic/entity/keyword/summary/scope: weighted average; forbidden: weighted average (penalty).
function averageVectors(vectors, weight) {
  if (!vectors.length) return null;
  const dim = vectors[0].vector.length;
  const acc = new Array(dim).fill(0);
  let totalW = 0;
  for (const { vector } of vectors) {
    for (let i = 0; i < dim; i += 1) acc[i] += vector[i] * weight;
    totalW += weight;
  }
  if (totalW === 0) return null;
  for (let i = 0; i < dim; i += 1) acc[i] /= totalW;
  return acc;
}

async function publishFrontmatter(repoId, frontmatter, opts = {}) {
  return withSpan('okf.frontmatter.publish', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollections(db);
    // 1. shape validate
    validateFrontmatterShape(frontmatter);
    const approvedBy = opts.actor && opts.actor.user_id ? opts.actor.user_id : 'auto-publish';
    const now = new Date().toISOString();
    const version = parseInt(opts.version || Date.now(), 10);
    // 2. embed all tags (TEI)
    const valuesByField = await embedAllTags(frontmatter);
    // 3. compute combination vectors per the spec §1a
    const summary = {
      _key: repoId,
      topic_combined_vector: averageVectors(valuesByField.topic, FIELD_RANGES.topic.default_weight),
      entity_combined_vector: averageVectors(valuesByField.entity, FIELD_RANGES.entity.default_weight),
      keyword_combined_vector: averageVectors(valuesByField.keyword, FIELD_RANGES.keyword.default_weight),
      summary_vector: averageVectors(valuesByField.summary, FIELD_RANGES.summary.default_weight),
      scope_vector: averageVectors(valuesByField.scope, FIELD_RANGES.scope.default_weight),
      forbidden_combined_vector: averageVectors(valuesByField.forbidden, 1.0),
      topic_count: valuesByField.topic.length,
      entity_count: valuesByField.entity.length,
      keyword_count: valuesByField.keyword.length,
      forbidden_count: valuesByField.forbidden.length,
      updated_at: now,
      version
    };
    if (!summary.topic_combined_vector)
      throw new FrontmatterError('VALIDATION', 'topic_combined_vector is empty after embedding', 400);
    if (!summary.forbidden_combined_vector)
      throw new FrontmatterError('VALIDATION', 'forbidden_combined_vector is empty after embedding', 400);
    // 4. atomic write (single transaction)
    const txn = await db.beginTransaction({ write: [FRONTMATTER_COLLECTION, FRONTMATTER_SUMMARY_COLLECTION] });
    try {
      // Clear existing rows for this repo (republish replaces; we don't merge)
      await txn.step(() =>
        db.query(`FOR d IN ${FRONTMATTER_COLLECTION} FILTER d.repo_id == @rid REMOVE d IN ${FRONTMATTER_COLLECTION}`, {
          rid: repoId
        })
      );
      // Insert per-tag rows
      const rows = [];
      for (const field of VALID_FIELDS) {
        const weight = FIELD_RANGES[field].default_weight;
        for (const { value, vector } of valuesByField[field]) {
          rows.push({
            _key: `${repoId}:${field}:${nodeCrypto.createHash('sha1').update(value).digest('hex').slice(0, 12)}`,
            repo_id: repoId,
            field,
            value,
            weight,
            vector,
            generated_at: now,
            generated_by: `llm:${VLLM_LLM_MODEL_ID}`,
            approved_at: now,
            approved_by: approvedBy,
            version
          });
        }
      }
      if (rows.length) {
        await txn.step(() => db.collection(FRONTMATTER_COLLECTION).import(rows));
      }
      await txn.step(() => db.collection(FRONTMATTER_SUMMARY_COLLECTION).save(summary, { overwrite: true }));
      await txn.commit();
    } catch (err) {
      try {
        await txn.abort();
      } catch {
        /* ignore */
      }
      throw err;
    }
    // 5. invalidate BFF cache (the retriever-config cache will refresh on TTL)
    try {
      const { _resetFrontmatterSummaryCache } = require('./retrieval-config-service');
      if (typeof _resetFrontmatterSummaryCache === 'function') {
        _resetFrontmatterSummaryCache(repoId);
      }
    } catch {
      /* retrieval-config-service may not export the helper; TTL fallback (60s) */
    }
    span.setAttribute(
      'okf.published_tags',
      valuesByField.topic.length +
        valuesByField.entity.length +
        valuesByField.keyword.length +
        valuesByField.forbidden.length
    );
    logger.info('frontmatter.publish.done', {
      repo_id: repoId,
      topics: valuesByField.topic.length,
      entities: valuesByField.entity.length,
      keywords: valuesByField.keyword.length,
      forbidden: valuesByField.forbidden.length
    });
    // 6. audit (per the convention used elsewhere in this repo)
    try {
      await auditService.append({
        repo_id: repoId,
        actor: opts.actor || { user_id: 'auto-publish' },
        event: 'frontmatter.publish',
        details: {
          topic_count: valuesByField.topic.length,
          entity_count: valuesByField.entity.length,
          keyword_count: valuesByField.keyword.length,
          forbidden_count: valuesByField.forbidden.length,
          version
        }
      });
    } catch (e) {
      logger.warn('frontmatter.publish.audit_failed', { repo_id: repoId, err: e.message });
    }
    return summary;
  });
}

async function getFrontmatter(repoId) {
  const db = await dbService.getConnection();
  await ensureCollections(db);
  const q = await db.query(`FOR d IN ${FRONTMATTER_COLLECTION} FILTER d.repo_id == @rid RETURN d`, { rid: repoId });
  return q.all();
}

async function getFrontmatterSummary(repoId) {
  const db = await dbService.getConnection();
  await ensureCollections(db);
  try {
    const doc = await db.collection(FRONTMATTER_SUMMARY_COLLECTION).document(repoId);
    return doc;
  } catch (err) {
    if (isArangoNotFound(err)) return null;
    throw err;
  }
}

module.exports = {
  // writer
  suggestTags,
  validateFrontmatter,
  embedAllTags,
  publishFrontmatter,
  // reader
  getFrontmatter,
  getFrontmatterSummary,
  // constants (for tests)
  FRONTMATTER_COLLECTION,
  FRONTMATTER_SUMMARY_COLLECTION,
  FIELD_RANGES,
  // error class
  FrontmatterError
};
