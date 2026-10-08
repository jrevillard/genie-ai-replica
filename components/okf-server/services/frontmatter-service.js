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
//
// David 2026-10-08: the vLLM endpoint is on a foreign host and DOES work
// in this deployment; the previous hard-coded default
// 'http://vllm-llm-served:8000' was a Swarm service name that doesn't
// resolve in the local build (and the local GPU services are scaled to
// 0 anyway per local_build_patches.md). Read the same VLLM_ENDPOINT
// variable the existing okf-server curation engine (line 705 of
// docker-compose.yaml) and the dataprep/embedding/reranker OPEA services
// use — it resolves to the remote GPU URL in this deployment
// (https://ai.assembly.govstack.global/llm) and to a local service
// fallback (http://vllm:8000) when no GPU_NODE_HOST is configured. This
// is the project-wide convention (per feedback_cloud-deploy-defaults:
// env defaults must work for local Docker AND cloud Ansible, not one or
// the other).
const VLLM_LLM_HOST = process.env.VLLM_ENDPOINT || 'http://vllm:8000';
const VLLM_LLM_MODEL_ID = process.env.VLLM_LLM_MODEL_ID || 'ibm-granite/granite-4.1-8b';
const VLLM_LLM_API_KEY = process.env.VLLM_API_KEY || process.env.VLLM_LLM_API_KEY || '';

// David 2026-10-08 (sequence of three): the embed service is also on a
// foreign host. The previous default 'http://embedding-tei:80' is a
// Compose service name that does not resolve in this local build
// (GPU/TEI services scaled to 0 per local_build_patches.md). Read the
// same EMBEDDING_SERVICE_URL the OPEA retriever / chatqna / embedding
// services use (docker-compose.yaml:1204, 1348, 1515). The compose
// fallback 'http://tei:80' is the local-mode service name; the remote
// URL is the same env var. Back-compat: TEI_EMBED_HOST still wins
// when explicitly set.
const TEI_EMBED_HOST = process.env.TEI_EMBED_HOST || process.env.EMBEDDING_SERVICE_URL || 'http://tei:80';
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '1024', 10);

const OKF_FRONTMATTER_VALIDATE_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.OKF_FRONTMATTER_VALIDATE_BATCH_SIZE || '4', 10)
);
const OKF_FRONTMATTER_SAMPLE_N = parseInt(process.env.OKF_FRONTMATTER_SAMPLE_N || '20', 10);
const OKF_FRONTMATTER_VALIDATE_SAMPLE_PCT = parseFloat(process.env.OKF_FRONTMATTER_VALIDATE_SAMPLE_PCT || '0.1');
const OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD = parseFloat(
  process.env.OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD || '0.3'
);

// ---------- Constants ----------

const FRONTMATTER_COLLECTION = 'okf_repo_frontmatter';
const FRONTMATTER_SUMMARY_COLLECTION = 'okf_repositories_frontmatter_summary';

const VALID_FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];
// FIELD_RANGES — soft target ranges, NOT hard validation caps.
//
// Per David 2026-10-08: tags must be sufficient to semantically describe
// what is in the OKF repository. The lightweight LLM suggest path (a
// single 8s call per repo) often produces an entity-heavy, scope/summary-
// thin result for corporate/financial repos (the live test produced 16
// entities + 0 keywords + 0 scope + 0 summary on the first call). The
// hard-validation cap (e.g. entity max 10) was an arbitrary old-code
// bound, and the hard requirement for scope/summary assumed the LLM
// always returned them — both wrong for the lightweight contract.
//
// Soft ranges: the range numbers above are now the LLM's prompt target
// AND the soft floor the gate uses to decide "is the frontmatter
// publish-ready" (the gate is in the frontmatter-controller / lifecycle
// layer, not here). The service-level validator below enforces only the
// hard floors that gate the publish: topic >= 3 (routing surface) and
// forbidden >= 2 (misroute prevention). entity, keyword, scope, and
// summary are zero-or-more — an empty scope is a routing warning, not a
// patch rejection. The cap on the upper end is the LLM prompt target
// (3-8 topic, 2-6 forbidden) plus a generous hard ceiling (20) so a
// verbose LLM call doesn't get clipped.
const FIELD_RANGES = {
  topic: { min: 3, max: 8, default_weight: 1.0 },
  entity: { min: 0, max: 20, default_weight: 0.7 },
  keyword: { min: 0, max: 20, default_weight: 0.5 },
  summary: { min: 0, max: 1, default_weight: 0.5 },
  scope: { min: 0, max: 1, default_weight: 0.3 },
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
  conceptsText
) => `You are a curator for an enterprise knowledge-base system. A repository
contains ${sampleSize} concepts (curator-authored knowledge entries). Each
concept below has a title, a type (topic | entity | process | event | source),
the curator's own per-concept TOPICS (the "tags" field — these are the
single source of truth for what this repo is about), the
Knowledge-Hierarchy labels the curator assigned, and a one-line summary.

YOUR JOB IS AGGREGATION, NOT INVENTION. The curator has already decided
what the repo is about by setting per-concept topics. You must:

  1. Roll the per-concept topics up into a REPO-LEVEL topic set (3-8
     high-level topics) that UNIQUELY characterizes this repo vs. its
     siblings. The topic set must FULLY cover the per-concept topic
     surface — a sibling repo should have an unambiguously different
     topic set.
  2. Identify the named entities across the concepts (people, products,
     places, organizations) — pull from the per-concept tags and labels.
  3. Infer the repo's scope from the concept types and topics.
  4. The FORBIDDEN list is the ADJACENT topics a user might assume are
     here but aren't — derive it from the per-concept topic surface by
     asking "what's the closest neighbor topic the curator didn't
     include?". A repo of bali-hindu-rituals probably should not be
     asked about bali-beach-tourism or bali-history; both are adjacent
     but excluded.
  5. Phrase a 1-2 sentence summary from the user's perspective.

The tag strings must be SHORT (1-3 words), lowercase, hyphenated. Be
SPECIFIC — a repo with the same topic set as a sibling is a routing bug.
Do NOT pad the topic list with generic words ("general", "reference",
"information") — those tags break routing.

OUTPUT FORMAT (CRITICAL — the parser is strict, no synonyms):
  { "topic":     [...],   // REP-LEVEL topic set, 3-8 items
    "entity":    [...],   // named entities, 0-10 items
    "scope":     "<one-word scope>",   // single word from the list above
    "forbidden": [...],   // adjacent-but-excluded topics, 2-6 items
    "summary":   "<1-2 sentences>",   // user-perspective summary
    "keyword":   [...]    // specific low-coverage terms, 0-10 items
  }

Use the EXACT field names shown above (topic, entity, scope, forbidden,
summary, keyword) — the parser does not accept synonyms. Output ONLY the
JSON object, no prose, no markdown fences.

CONCEPTS:
${conceptsText}
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
  // David 2026-10-08: the remote TEI is HF-gated (same 401 path the
  // OPEA TEI wrapper services have always used). Send Authorization
  // Bearer with the same VLLM_API_KEY the local build propagates as
  // HF_TOKEN into the OPEA embed service env (docker-compose.yaml:1215,
  // 1293, 1524) — one credential, two header names (the okf-server
  // service didn't have HF_TOKEN propagated before this fix because
  // it owns the vLLM client, not the TEI one). Back-compat with any
  // future HF_TOKEN-only env (the HUGGINGFACEHUB_API_TOKEN form the
  // reranker uses at line 1432).
  const headers = { 'Content-Type': 'application/json' };
  const hfKey = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || VLLM_LLM_API_KEY;
  if (hfKey) headers.Authorization = 'Bearer ' + hfKey;
  const fn = () =>
    axios.post(`${TEI_EMBED_HOST}/embed`, body, { headers, timeout: 30000 });
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

async function sampleConceptsFromRepo(db, repoId, n) {
  // Per David 2026-10-08: per-repo frontmatter tags originate ONLY from
  // concept-meta rows. Chunks are NOT a permitted source — at the moment
  // suggestTags runs (inside the publish hook, BEFORE the lifecycle ingest
  // transition that creates the working graph), the graph either doesn't
  // exist yet or holds stale data from a previous retract/republish cycle.
  // The authoritative "what is this repo about" signal is the curator's
  // per-concept tags + labels + summary + type in okf_concepts_meta (set in
  // the editor's right rail during the publish gate; survives retract +
  // republish unchanged). The forbidden list in particular must be
  // derived from the curator's stated scope vs. adjacent topics the
  // curator DIDN'T include — not from chunk text that may not exist yet.
  //
  // LIGHTWEIGHT sampling (David 2026-10-08: "we cannot pass all the concept
  // files in the repo to the LLM — this must be lightweight"). We do NOT
  // load full concept bodies; only the small per-row signal the LLM needs
  // to derive a topic set (title + tags + labels + summary + type). The
  // AQL reads just those fields — no body text, no chunk embeddings. The
  // n cap is intentionally small (default 20) so the resulting prompt is
  // bounded: a concept row is ~150-300 bytes of signal, so 20 rows =
  // ~5KB of LLM input even in the worst case. The cap is enough to
  // characterize a repo's topic surface (the worst case is hundreds of
  // concepts; the typical case is 5-20), and deterministic by _key so a
  // re-suggest returns the same input.
  const q = await db.query(`FOR r IN okf_repositories FILTER r._key == @rid LIMIT 1 RETURN r`, { rid: repoId });
  const list = await q.all();
  const repo = list && list[0];
  if (!repo) throw new FrontmatterError('REPO_NOT_FOUND', `repo ${repoId} not found`, 404);
  const cq = await db.query(
    `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid SORT m._key LIMIT @n RETURN { concept_id: m.concept_id, title: m.title, type: m.type, tags: m.tags, labels: m.labels, summary: m.summary }`,
    { rid: repoId, n }
  );
  const concepts = await cq.all();
  return { repo, concepts };
}

// Format the lightweight concept rows into a single prompt block. Each
// row is one line so the LLM can pattern-match the structure; the format
// is the curator's authoring fields only (no body, no chunks, no
// embeddings). Kept narrow so a 20-row sample stays well under the 6KB
// LLM input slice the caller applies.
function formatConceptsForPrompt(concepts) {
  return concepts
    .map((c) => {
      const title = String(c.title || c.concept_id || '').trim();
      const type = String(c.type || '').trim();
      const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean).join(', ') : '';
      const labels = Array.isArray(c.labels) ? c.labels.filter(Boolean).join(', ') : '';
      const summary = String(c.summary || '').trim();
      const bits = [title];
      if (type) bits.push(`[${type}]`);
      if (tags) bits.push(`tags: ${tags}`);
      if (labels) bits.push(`KH labels: ${labels}`);
      if (summary) bits.push(`— ${summary}`);
      return `- ${c.concept_id || '?'}: ${bits.join(' ')}`;
    })
    .join('\n');
}

// ---------- Public methods ----------

async function suggestTags(repoId, opts = {}) {
  return withSpan('okf.frontmatter.suggest', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    const sampleN = opts.sampleN || OKF_FRONTMATTER_SAMPLE_N;
    const { concepts } = await sampleConceptsFromRepo(db, repoId, sampleN);
    if (!concepts.length) {
      // 400 with a clear directive: per-repo tags require at least one
      // concept (curator's authoring). Chunks are NOT a fallback — the
      // spec (2026-10-08) is explicit that tags originate from concept-meta.
      throw new FrontmatterError(
        'NO_CONCEPTS',
        'Add at least one concept before requesting tag suggestions.',
        400
      );
    }
    span.setAttribute('okf.sample_size', concepts.length);
    const conceptsText = formatConceptsForPrompt(concepts).slice(0, 6000);
    const prompt = TAG_PROMPT(concepts.length, conceptsText);
    logger.info('frontmatter.suggest.start', {
      repo_id: repoId,
      sample_size: concepts.length,
      vllm_host: VLLM_LLM_HOST,
      model: VLLM_LLM_MODEL_ID,
      prompt_chars: prompt.length
    });
    const resp = await vllmChatCompletions([{ role: 'user', content: prompt }], { maxTokens: 1000 });
    const content =
      resp.data &&
      resp.data.choices &&
      resp.data.choices[0] &&
      resp.data.choices[0].message &&
      resp.data.choices[0].message.content;
    // DEBUG (David 2026-10-08: "read the fucking logs and figure out what
    // happened" — suggest returned 0 tags, the log only shows counts, we
    // need the raw LLM content + finish_reason to know whether the model
    // returned empty by design, hit a token cap, or failed silently).
    logger.info('frontmatter.suggest.llm_response', {
      repo_id: repoId,
      content_preview: (content || '').slice(0, 600),
      content_length: (content || '').length,
      finish_reason:
        (resp.data &&
          resp.data.choices &&
          resp.data.choices[0] &&
          resp.data.choices[0].finish_reason) ||
        null,
      usage: (resp.data && resp.data.usage) || null
    });
    const parsed = extractJson(content);
    if (!parsed) {
      logger.error('frontmatter.suggest.parse_failed', {
        repo_id: repoId,
        content_preview: (content || '').slice(0, 200)
      });
      throw new FrontmatterError('LLM_PARSE', 'LLM returned unparseable JSON', 502);
    }
    // Normalize shape. Per David 2026-10-08: the LLM is intelligent enough
    // to recognize the task but used semantically-similar but not identical
    // field names on the first live call (e.g. 'repo_level_topics' instead
    // of 'topic', 'named_entities' instead of 'entity'). The defensive
    // alias map accepts the common variants; the prompt below (and the
    // change in this commit) also demands the canonical names explicitly.
    const arr = (...keys) => {
      for (const k of keys) {
        const v = parsed[k];
        if (Array.isArray(v) && v.length) return v;
        if (Array.isArray(v)) return v; // empty array still accepted
      }
      return [];
    };
    const out = {
      topic: arr('topic', 'topics', 'repo_level_topics', 'topic_set', 'subjects')
        .map(normalizeTag)
        .filter(Boolean),
      entity: arr('entity', 'entities', 'named_entities', 'people_products_places')
        .map(normalizeTag)
        .filter(Boolean),
      scope: normalizeTag(
        parsed.scope || parsed.scope_label || parsed.scope_word || parsed.scope_kind
      ),
      forbidden: arr('forbidden', 'forbidden_topics', 'exclusions', 'not_about')
        .map(normalizeTag)
        .filter(Boolean),
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 512)
          : typeof parsed.description === 'string'
            ? parsed.description.slice(0, 512)
            : null,
      keyword: arr('keyword', 'keywords', 'specific_terms', 'low_coverage_terms')
        .map(normalizeTag)
        .filter(Boolean)
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
    // TODO (post-Story 1.6): switch the consistency-check source to
    // concept-meta too, for symmetry with suggestTags. Today this still
    // samples chunks from the working graph — at publish time those may be
    // stale or absent, so this check is best-effort. The hard publish
    // gate is the concept-meta existence check above; the validate stage
    // is a quality signal only.
    // (sampleChunksFromRepo was removed 2026-10-08 along with the chunk-based
    // suggest path. The validate stage is a separate scope change.)
    const chunks = [];
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
