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
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { isArangoNotFound } = require('./arango-errors');

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

// Story 1.7 (2026-10-08, supersedes the Story 1.6 dedicated collection):
// the per-repo tag set lives in `okf_repositories.frontmatter` (a new
// doc field, additive). The two collection constants below are KEPT for
// the duration of the migration window (so the migration script can
// read from them) but are NOT written to by this service. The service
// surfaces a deprecation note in the audit log on every read. After
// the migration script runs (one-shot, idempotent) and the new doc
// field is verified live, both collections can be DROPPED in a
// follow-up commit. Until then, the constants remain so the migration
// and any remaining readers don't break.
const FRONTMATTER_COLLECTION = 'okf_repo_frontmatter';
const FRONTMATTER_SUMMARY_COLLECTION = 'okf_repositories_frontmatter_summary';
const IS_FRONTMATTER_COLLECTION_RETIRED = true;

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
// (3-8 topic, 3-6 forbidden-proposals — the 2026-10-09 routing-gate
// contract widened the forbidden derivation from near-topics to whole
// adjacent domains; the 1-8c teaching loop ADDS tags on top of that, so
// the soft guidance is 2-12 while the hard validator ceiling is 24).
const FIELD_RANGES = {
  topic: { min: 3, max: 8, default_weight: 1.0 },
  entity: { min: 0, max: 20, default_weight: 0.7 },
  keyword: { min: 0, max: 20, default_weight: 0.5 },
  summary: { min: 0, max: 1, default_weight: 0.5 },
  scope: { min: 0, max: 1, default_weight: 0.3 },
  forbidden: { min: 2, max: 12, default_weight: 0.0 } // penalty; weight unused
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
  4. The FORBIDDEN list is the ADJACENT DOMAINS a user might assume are
     here but aren't — 3-6 sibling domains of the same family that this
     corpus does NOT cover. Think in whole domains, not just the nearest
     topic: a non-communicable-disease (NCD) corpus should list
     communicable-disease and mental-health; a repo of bali-hindu-rituals
     should list bali-beach-tourism and bali-history. A query inside a
     forbidden domain must NEVER route to this repo, so cover every
     plausible confusable neighbor of the topic surface.
  5. Phrase a 1-2 sentence summary from the user's perspective.

The tag strings must be SHORT (1-3 words), lowercase, hyphenated. Be
SPECIFIC — a repo with the same topic set as a sibling is a routing bug.
Do NOT pad the topic list with generic words ("general", "reference",
"information") — those tags break routing.

OUTPUT FORMAT (CRITICAL — the parser is strict, no synonyms):
  { "topic":     [...],   // REP-LEVEL topic set, 3-8 items
    "entity":    [...],   // named entities, 0-10 items
    "scope":     "<one-word scope>",   // single word from the list above
    "forbidden": [...],   // adjacent domains NOT covered, 3-6 items
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

// The remote TEI rejects batches above its --max-client-batch-size with 422
// (observed 2026-10-09: 32 OK, 48 -> 422 on ai.assembly.govstack.global).
// teiEmbed chunks client-side so EVERY caller is bounded — the routing
// advisor aggregates every deduped query of the last N runs in one call and
// blew straight past the cap.
const TEI_EMBED_CHUNK = 32;

async function teiEmbed(inputs) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  if (!list.length) return [];
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
  const decode = (resp) => {
    // TEI returns either {data: [[...], ...]} (batched) or [...] depending on shape
    const out = resp.data && (resp.data.data || resp.data.embeddings || resp.data);
    if (Array.isArray(out) && Array.isArray(out[0])) return out;
    if (Array.isArray(out) && out.length && Array.isArray(out[0])) return out;
    if (Array.isArray(out) && out.length && typeof out[0] === 'number') return [out];
    throw new FrontmatterError('EMBED_BAD_SHAPE', 'TEI embed returned an unexpected shape', 502);
  };
  const vectors = [];
  for (let i = 0; i < list.length; i += TEI_EMBED_CHUNK) {
    const chunk = list.slice(i, i + TEI_EMBED_CHUNK);
    const body = { inputs: chunk, truncate: true };
    const fn = () => axios.post(`${TEI_EMBED_HOST}/embed`, body, { headers, timeout: 30000 });
    const resp = await withTeiRetry(fn, {
      endpoint: '/embed',
      batch_size: list.length,
      chunk_size: chunk.length,
      chunk_index: i / TEI_EMBED_CHUNK
    });
    vectors.push(...decode(resp));
  }
  return vectors;
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
      throw new FrontmatterError('NO_CONCEPTS', 'Add at least one concept before requesting tag suggestions.', 400);
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
        (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].finish_reason) || null,
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
    // LLMs repeat values (observed 2026-10-09: granite emitted
    // "mental-health" 5x inside ONE forbidden array; the duplicates rode
    // straight through to the stored frontmatter). normalizeTag has already
    // lowercased everything, so first-occurrence Set dedup is exact.
    const uniqTags = (list) => [...new Set(list)];
    const out = {
      topic: uniqTags(
        arr('topic', 'topics', 'repo_level_topics', 'topic_set', 'subjects').map(normalizeTag).filter(Boolean)
      ),
      entity: uniqTags(
        arr('entity', 'entities', 'named_entities', 'people_products_places').map(normalizeTag).filter(Boolean)
      ),
      scope: normalizeTag(parsed.scope || parsed.scope_label || parsed.scope_word || parsed.scope_kind),
      forbidden: uniqTags(
        arr('forbidden', 'forbidden_topics', 'exclusions', 'not_about').map(normalizeTag).filter(Boolean)
      ),
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 512)
          : typeof parsed.description === 'string'
            ? parsed.description.slice(0, 512)
            : null,
      keyword: uniqTags(
        arr('keyword', 'keywords', 'specific_terms', 'low_coverage_terms').map(normalizeTag).filter(Boolean)
      )
    };
    // Routing-gate contract (2026-10-09): the proposed forbidden set is
    // ALSO returned flagged as suggestions — [{value, suggested: true}] —
    // so the curator UI renders accept/dismiss chips and the routing
    // boundary is born declared (the 1-8b per-tag veto only has power
    // over domains the curator actually declared). Additive + read-only:
    // `forbidden` stays the plain string array every existing consumer
    // reads (the publish-hook auto-apply loop and writeFrontmatterToRepoDoc
    // both ignore unknown keys), and nothing here writes — the curator
    // confirms via the existing chip flow. Fidelity is untouched: forbidden
    // tags are excluded from the head vector average; they only power the
    // gate.
    out.forbidden_suggestions = out.forbidden.map((value) => ({ value, suggested: true }));
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

// ---------- Story 1.7 — frontmatter on the repo doc ----------

// Write the per-repo frontmatter to `okf_repositories.frontmatter`
// (the canonical store). The lifecycle publish hook calls this on
// every publish; the wizard/editor's "Save tags" CTA calls this via
// the existing repo PATCH (which writes the same field). The
// index.md YAML is the curator-facing projection; this function
// is the source of truth.
//
// `payload` shape (matches validators/repository-validator.js
// frontmatterSchema):
//   { topic:[], entity:[], scope:'', forbidden:[], summary:'',
//     keyword:[], _approved:[{field,value,approved_at,approved_by}],
//     updated_at?, updated_by? }
async function writeFrontmatterToRepoDoc(repoId, payload, opts = {}) {
  const db = await dbService.getConnection();
  const version = parseInt((opts && opts.version) || Date.now(), 10);
  const actor = (opts && opts.actor) || { user_id: 'auto-publish' };
  const updated_at = new Date().toISOString();
  const updated_by = actor && actor.user_id ? actor.user_id : 'auto-publish';
  const frontmatter = {
    topic: Array.isArray(payload.topic) ? payload.topic : [],
    entity: Array.isArray(payload.entity) ? payload.entity : [],
    scope: typeof payload.scope === 'string' ? payload.scope : '',
    forbidden: Array.isArray(payload.forbidden) ? payload.forbidden : [],
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    keyword: Array.isArray(payload.keyword) ? payload.keyword : [],
    _approved: Array.isArray(payload._approved) ? payload._approved : [],
    version,
    updated_at,
    updated_by
  };
  await db.collection('okf_repositories').update(repoId, { frontmatter });
  logger.info('frontmatter.write_to_repo_doc', {
    repo_id: repoId,
    topic: frontmatter.topic.length,
    entity: frontmatter.entity.length,
    forbidden: frontmatter.forbidden.length,
    approved: frontmatter._approved.length,
    version
  });
  return frontmatter;
}

// ---------- Story 1.7a — vectorized head on the repo doc ----------
//
// The "vectorized head" is the bundle-level embedding the retriever
// uses to route a user query to the right OKF bundle. It's derived
// from the per-repo frontmatter tags at publish time:
//   1. Embed each tag value via the shared TEI service
//      (TEI_EMBED_HOST — same env the OPEA retriever uses).
//   2. Average the per-field embeddings into per-field combined
//      vectors (weighted by FIELD_RANGES — topic 1.0, entity 0.7,
//      keyword 0.5, summary 0.5, scope 0.3; forbidden is a penalty
//      and is NOT averaged into the head).
//   3. Average the per-field combined vectors into a single
//      bundle-level "head" vector.
//   4. Build a synthetic head text the curator can read in the UI.
//   5. Store the head on okf_repositories.head (additive doc field):
//      { text, vector, per_field, dim, model, computed_at, computed_by }.
//
// The retriever reads okf_repositories.head.vector for routing
// (additive — doesn't break the existing query-affinity routing
// from Story 1.3). The publish path calls this on every publish
// AFTER the frontmatter gate passes, so the head always reflects
// the published tag set.
//
// Storage cost: a single 1024-dim float vector (~4 KB at 32-bit
// floats, or ~8 KB as JSON) per repo. Trivial compared to the
// per-chunk embeddings in the existing concept ingest path.
async function buildVectorizedHead(repoId, frontmatter, opts = {}) {
  return withSpan('okf.frontmatter.build_head', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    if (!frontmatter || typeof frontmatter !== 'object') {
      throw new FrontmatterError('EMPTY', 'frontmatter is empty — cannot build head', 400);
    }
    // 1. embed each tag value
    const valuesByField = await embedAllTags(frontmatter);
    // 2. per-field combined vectors (weighted average)
    const perField = {
      topic: averageVectors(valuesByField.topic, FIELD_RANGES.topic.default_weight),
      entity: averageVectors(valuesByField.entity, FIELD_RANGES.entity.default_weight),
      keyword: averageVectors(valuesByField.keyword, FIELD_RANGES.keyword.default_weight),
      summary: averageVectors(valuesByField.summary, FIELD_RANGES.summary.default_weight),
      scope: averageVectors(valuesByField.scope, FIELD_RANGES.scope.default_weight),
      // forbidden is NOT averaged into the head — it's a penalty for
      // routing, not a positive signal of what the repo is about.
      // Story 1-8 (2026-10-08): the centroid IS persisted now (weight
      // 1.0 for the average itself) — the previous weight-0 call made
      // averageVectors return null (totalW === 0), so per_field.forbidden
      // was ALWAYS null and the head-tester's misroute/penalty scoring
      // had no forbidden vector to work with. Still excluded from the
      // head average below (the `present` list).
      forbidden: averageVectors(valuesByField.forbidden, 1.0)
    };
    // 3. single head vector: average the non-null per-field vectors
    //    with each field's weight. Empty result → no head (the
    //    publish gate already requires topic>=3 + forbidden>=1 so
    //    this case is unreachable in practice, but we guard).
    const present = ['topic', 'entity', 'keyword', 'summary', 'scope']
      .map((f) => ({ f, v: perField[f] }))
      .filter((x) => Array.isArray(x.v));
    if (!present.length) {
      throw new FrontmatterError('VALIDATION', 'no per-field vectors after embedding — cannot build head', 400);
    }
    const dim = present[0].v.length;
    const acc = new Array(dim).fill(0);
    let totalW = 0;
    for (const { f, v } of present) {
      const w = FIELD_RANGES[f].default_weight;
      for (let i = 0; i < dim; i += 1) acc[i] += v[i] * w;
      totalW += w;
    }
    if (totalW === 0) {
      throw new FrontmatterError('VALIDATION', 'all per-field weights are zero — cannot build head', 400);
    }
    for (let i = 0; i < dim; i += 1) acc[i] /= totalW;
    const vector = acc;
    // 4. synthetic head text — the human-readable form of the
    //    frontmatter. The retriever ignores it; the UI shows it
    //    in the editor so the curator can see what the head
    //    summarizes.
    const text = frontmatterToHeadText(frontmatter);
    // 5. atomic write to okf_repositories.head (additive; doesn't
    //    touch the frontmatter or any other doc field)
    const db = await dbService.getConnection();
    const now = new Date().toISOString();
    const actor = (opts && opts.actor && opts.actor.user_id) || 'auto-publish';
    const version = parseInt((opts && opts.version) || Date.now(), 10);
    const head = {
      text,
      vector,
      per_field: {
        topic: perField.topic,
        entity: perField.entity,
        keyword: perField.keyword,
        summary: perField.summary,
        scope: perField.scope,
        forbidden: perField.forbidden,
        // Story 1-8b — per-tag forbidden vectors for the hard veto gate
        // ("forbidden is forbidden"). The averaged centroid stays for the
        // margin rule; the per-tag vectors let the gate veto a query when
        // ANY single forbidden tag matches it at/above the tag bar.
        forbidden_vectors: (valuesByField.forbidden || []).map(({ value, vector }) => ({
          tag: value,
          vector
        }))
      },
      dim,
      model: process.env.EMBEDDING_MODEL_ID || 'tei-embed',
      version,
      computed_at: now,
      computed_by: actor
    };
    await db.collection('okf_repositories').update(repoId, { head });
    span.setAttribute('okf.head.dim', dim);
    span.setAttribute('okf.head.text_chars', text.length);
    logger.info('frontmatter.head.built', {
      repo_id: repoId,
      dim,
      topic: Array.isArray(frontmatter.topic) ? frontmatter.topic.length : 0,
      entity: Array.isArray(frontmatter.entity) ? frontmatter.entity.length : 0,
      keyword: Array.isArray(frontmatter.keyword) ? frontmatter.keyword.length : 0,
      forbidden: Array.isArray(frontmatter.forbidden) ? frontmatter.forbidden.length : 0,
      version
    });
    return head;
  });
}

// Synthetic head text — the human-readable form of the
// frontmatter. Used for the UI's "head summary" tile AND as a
// fallback in case the embed endpoint is unreachable (the text
// alone is still useful for retrieval by substring match).
function frontmatterToHeadText(fm) {
  const parts = [];
  const arr = (k) => (Array.isArray(fm[k]) ? fm[k].filter((v) => v) : []);
  const sca = (k) => (typeof fm[k] === 'string' ? fm[k].trim() : '');
  if (arr('topic').length) parts.push(`Topics: ${arr('topic').join(', ')}.`);
  if (arr('entity').length) parts.push(`Entities: ${arr('entity').join(', ')}.`);
  const scope = sca('scope');
  if (scope) parts.push(`Scope: ${scope}.`);
  if (arr('forbidden').length) parts.push(`Not about: ${arr('forbidden').join(', ')}.`);
  const summary = sca('summary');
  if (summary) parts.push(`Summary: ${summary}.`);
  if (arr('keyword').length) parts.push(`Keywords: ${arr('keyword').join(', ')}.`);
  return parts.join(' ').trim();
}

// Read the per-repo frontmatter from the canonical store. Returns
// null if the field is absent (the repo has never had frontmatter
// set). The retriever, the publish gate, and the UI all call this.
async function readFrontmatterFromRepoDoc(repoId) {
  const db = await dbService.getConnection();
  // AWAIT-BUGFIX (2026-10-08, caught by the Story 1-8 live smoke): the
  // outer await was missing — `rows` was the PROMISE from cursor.all(),
  // `rows[0]` was always undefined, and this reader returned null for
  // EVERY repo (publish read the same field through this shape and
  // silently skipped the frontmatter gate; head/rebuild 409'd with
  // NO_FRONTMATTER while the doc demonstrably had frontmatter).
  const rows = await (
    await db.query('FOR r IN okf_repositories FILTER r._key == @rid RETURN r.frontmatter', { rid: repoId })
  ).all();
  return (rows && rows[0]) || null;
}

// Story 1.7 migration window: the curator-facing GET reads the new
// doc field by default; falls through to the old collection only
// for the one-shot migration (which lifts the rows into the new
// field). After the migration, the fall-through path is dead.
async function getFrontmatter(repoId) {
  const db = await dbService.getConnection();
  // Read from the new doc field. Return the rows in the same shape
  // the old collection used (one row per (field, value)) so the
  // editor's existing per-row UI works during the migration window.
  const fm = await readFrontmatterFromRepoDoc(repoId);
  if (fm) {
    return expandFrontmatterToRows(fm);
  }
  // Migration-window fall-through: read from the old collection if
  // the new field is empty. The migration script lifts these rows
  // into the new field; once the migration is complete, this branch
  // is unreachable.
  if (IS_FRONTMATTER_COLLECTION_RETIRED) {
    await ensureCollections(db);
    const q = await db.query(`FOR d IN ${FRONTMATTER_COLLECTION} FILTER d.repo_id == @rid RETURN d`, { rid: repoId });
    const rows = await q.all();
    if (rows.length) {
      logger.warn('frontmatter.read.legacy_collection', {
        repo_id: repoId,
        row_count: rows.length
      });
    }
    return rows;
  }
  return [];
}

async function getFrontmatterSummary(repoId) {
  const db = await dbService.getConnection();
  const fm = await readFrontmatterFromRepoDoc(repoId);
  if (fm) {
    return {
      _key: repoId,
      topic_count: Array.isArray(fm.topic) ? fm.topic.length : 0,
      entity_count: Array.isArray(fm.entity) ? fm.entity.length : 0,
      keyword_count: Array.isArray(fm.keyword) ? fm.keyword.length : 0,
      forbidden_count: Array.isArray(fm.forbidden) ? fm.forbidden.length : 0,
      summary: fm.summary || '',
      scope: fm.scope || '',
      version: fm.version,
      updated_at: fm.updated_at,
      updated_by: fm.updated_by
    };
  }
  // Migration-window fall-through: the old summary row still has
  // the combination vectors. The new retriever doesn't need the
  // combination vectors (it embeds lazily on first read), so this
  // fall-through returns a minimal summary derived from the count
  // columns. The retriever ignores the missing combination vectors
  // and computes them lazily.
  if (IS_FRONTMATTER_COLLECTION_RETIRED) {
    await ensureCollections(db);
    try {
      const doc = await db.collection(FRONTMATTER_SUMMARY_COLLECTION).document(repoId);
      return {
        _key: repoId,
        topic_count: doc.topic_count || 0,
        entity_count: doc.entity_count || 0,
        keyword_count: doc.keyword_count || 0,
        forbidden_count: doc.forbidden_count || 0,
        // Combination vectors intentionally omitted — the new
        // retriever computes them lazily. A consumer that needs
        // the OLD combination vectors reads from the old
        // collection directly via the migration script.
        version: doc.version,
        updated_at: doc.updated_at
      };
    } catch (err) {
      if (isArangoNotFound(err)) return null;
      throw err;
    }
  }
  return null;
}

// Pure helper: frontmatter object → row list (the same shape the
// old collection stored: one row per (field, value) with approved_at
// pulled from the per-row _approved list). Used by getFrontmatter
// to keep the existing UI working during the migration window.
function expandFrontmatterToRows(fm) {
  const approvedByValue = new Map();
  for (const a of Array.isArray(fm._approved) ? fm._approved : []) {
    if (a && a.field && a.value) {
      approvedByValue.set(`${a.field}::${a.value}`, a);
    }
  }
  const rows = [];
  for (const field of ['topic', 'entity', 'forbidden', 'keyword']) {
    const list = Array.isArray(fm[field]) ? fm[field] : [];
    for (const value of list) {
      const a = approvedByValue.get(`${field}::${value}`);
      rows.push({
        _key: `${field}:${value}`,
        repo_id: fm._key || '',
        field,
        value,
        weight: 1.0,
        vector: null, // Lazy: the retriever embeds on first read.
        generated_at: fm.updated_at,
        generated_by: fm.updated_by,
        approved_at: a ? a.approved_at : null,
        approved_by: a ? a.approved_by : null,
        version: fm.version
      });
    }
  }
  for (const field of ['scope', 'summary']) {
    const v = fm[field];
    if (v) {
      const a = approvedByValue.get(`${field}::${v}`);
      rows.push({
        _key: `${field}:${v}`,
        repo_id: fm._key || '',
        field,
        value: v,
        weight: 1.0,
        vector: null,
        generated_at: fm.updated_at,
        generated_by: fm.updated_by,
        approved_at: a ? a.approved_at : null,
        approved_by: a ? a.approved_by : null,
        version: fm.version
      });
    }
  }
  return rows;
}

module.exports = {
  // writer
  suggestTags,
  validateFrontmatter,
  embedAllTags,
  writeFrontmatterToRepoDoc,
  // Story 1.7a: vectorized head for retriever routing
  buildVectorizedHead,
  frontmatterToHeadText,
  // Story 1-8: shared TEI embed primitive (head-test-service embeds
  // queries with the same endpoint/auth/retry as tag embedding).
  teiEmbed,
  // Story 1-8 MR-B: shared guided-JSON chat primitive (head-suite-service
  // generates test suites through the same model/retry as tag suggestion).
  vllmChatCompletions,
  // reader
  getFrontmatter,
  getFrontmatterSummary,
  readFrontmatterFromRepoDoc,
  // constants (for tests)
  FRONTMATTER_COLLECTION,
  FRONTMATTER_SUMMARY_COLLECTION,
  FIELD_RANGES,
  // error class
  FrontmatterError
};
