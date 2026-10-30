/**
 * services/topic-link-authoring-service.js
 *
 * WHOLE-CORPUS TOPIC LINK AUTHORING (Story 1-8g-p).
 *
 * David's directive (2026-10-11): "you must recognize that this is a generic
 * feature and not just for el-salvador farming. If I give you a bunch of files
 * with similar characteristics but for example, related to the planets in the
 * solar system and astrophysics... I still expect the code to cross-link the
 * topics etc. This processing must be the same and available across the both
 * the wizard and the editor."
 *
 * WHY THIS EXISTS: `producer-service.resolveCrossFileLinks` only RESOLVES
 * markdown links that already exist in the source text. A corpus of bulletins
 * that never cites itself imports with ZERO cross-links (live: 586/587 El
 * Salvador concepts), so the editor graph is an empty star-field and the
 * ingest graph has no author edges to traverse. This service authors the
 * missing edges.
 *
 * DOMAIN AGNOSTICISM — the whole design carries no lexicon, no seed words, no
 * language assumption and no per-domain branching:
 *   MAP     candidate pairs come from INVERTED-INDEX TOKEN OVERLAP over
 *           (title + summary + labels + tags) — pure statistics, so it behaves
 *           identically for bean varieties, asteroids or tax statutes. The LLM
 *           only VERIFIES and TYPES the candidates the index produced.
 *   REDUCE  self-loops, dangling targets, duplicates and already-present links
 *           are dropped; fan-out is capped. A fixed, domain-neutral relation
 *           vocabulary keeps the result structured.
 *   WRITE   `frontmatter.links[]` via `patchConceptFields` — the born-right
 *           channel that survives body edits and feeds BOTH the editor graph
 *           projection and the ingest graph.
 *
 * IDEMPOTENT BY CONSTRUCTION: reduce drops any pair already present in the
 * source concept's links[], so a re-run adds only genuinely new edges and the
 * second run writes nothing.
 *
 * FAIL-SOFT: every stage degrades rather than throws into the caller. The
 * wizard import must never block on the LLM (same contract as
 * llm-curation-service), and the editor run records the error on its progress
 * channel instead of 500-ing.
 *
 * Env knobs (see `env` §15 / deploy parity):
 *   OKF_TOPIC_LINK_ENABLED           1 (default) | 0 — import-time pass
 *   OKF_TOPIC_LINK_BATCH             concepts per LLM call (default 8)
 *   OKF_TOPIC_LINK_LANES             concurrent LLM calls (default 4)
 *   OKF_TOPIC_LINK_MAX_PER_CONCEPT   fan-out cap per source (default 6)
 *   OKF_TOPIC_LINK_NEIGHBORS         candidate neighbours per concept (default 12)
 *   OKF_TOPIC_LINK_SNIPPET_CHARS     body chars fed to the LLM (default 700)
 *   OKF_TOPIC_LINK_CATALOG_CAP       max candidate rows in one prompt (default 60)
 *   OKF_TOPIC_LINK_MAX_TOKENS        completion budget per call (default 1500)
 *   OKF_TOPIC_LINK_TIMEOUT_MS        per-call timeout (default 60000)
 */

const axios = require('axios');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const modelCache = require('./vllm-model-cache');

const { withSpan } = require('../shared-lib/tracing');

/**
 * The relation vocabulary. Every entry is a domain-neutral predicate: it says
 * something true about ANY subject matter (an asteroid and a legal procedure
 * can both be `is_a`, `part_of` or `compared_in`). Chosen so a curator can
 * read the graph and understand the edge without opening either document.
 */
const LINK_TYPES = ['related_to', 'is_a', 'part_of', 'variant_of', 'affects', 'caused_by', 'compared_in', 'same_as'];

const DEFAULT_BATCH = parseInt(process.env.OKF_TOPIC_LINK_BATCH, 10) || 8;
const DEFAULT_LANES = parseInt(process.env.OKF_TOPIC_LINK_LANES, 10) || 4;
const DEFAULT_MAX_PER_CONCEPT = parseInt(process.env.OKF_TOPIC_LINK_MAX_PER_CONCEPT, 10) || 6;
const DEFAULT_NEIGHBORS = parseInt(process.env.OKF_TOPIC_LINK_NEIGHBORS, 10) || 12;
const DEFAULT_SNIPPET_CHARS = parseInt(process.env.OKF_TOPIC_LINK_SNIPPET_CHARS, 10) || 700;
const DEFAULT_CATALOG_CAP = parseInt(process.env.OKF_TOPIC_LINK_CATALOG_CAP, 10) || 60;
const MAX_TOKENS = parseInt(process.env.OKF_TOPIC_LINK_MAX_TOKENS, 10) || 2000;
const TIMEOUT_MS = parseInt(process.env.OKF_TOPIC_LINK_TIMEOUT_MS, 10) || 60000;

/** Progress writes are throttled — a repo-wide pass patches the same doc hundreds
 * of times; one write per interval keeps the UI live without the write storm. */
const PROGRESS_WRITE_MIN_MS = 2000;

/** Generic English stopwords. Not a domain lexicon — these carry no subject
 * meaning in ANY corpus, so removing them sharpens overlap for every domain. */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'been',
  'being',
  'its',
  'their',
  'there',
  'here',
  'they',
  'them',
  'then',
  'than',
  'into',
  'onto',
  'over',
  'under',
  'about',
  'also',
  'such',
  'other',
  'when',
  'where',
  'which',
  'while',
  'will',
  'can',
  'may',
  'not',
  'but',
  'you',
  'your',
  'use',
  'using',
  'used',
  'per',
  'via',
  'all',
  'any',
  'how',
  'what',
  'does',
  'must',
  'should',
  'each',
  'more',
  'most',
  'some',
  'only',
  'same',
  'very',
  'well',
  'one',
  'two'
]);

const norm = (v) =>
  String(v || '')
    .replace(/^concepts\//, '')
    .replace(/\.md$/i, '')
    .trim();

function enabled() {
  return process.env.OKF_TOPIC_LINK_ENABLED !== '0';
}

/** Concept → the token set used for overlap scoring. Tokens come from the
 * authored/curated surface only (title, summary, labels, tags) — never the
 * body, which is long and domain-noisy. */
function tokensFor(c) {
  const text = [c.title, c.summary, (c.labels || []).join(' '), (c.tags || []).join(' ')]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  const raw = String(text).match(/[a-z0-9]{3,}/g) || [];
  const out = new Set();
  for (const t of raw) if (!STOPWORDS.has(t)) out.add(t);
  return out;
}

/**
 * Candidate generation — INVERTED INDEX + IDF-weighted overlap. Pure; no DB.
 *
 * A pairwise all-vs-all scan is O(N²) and would crawl on a 1000-concept repo;
 * the inverted index only scores pairs that actually SHARE a token, which is
 * the set we care about anyway. Tokens that occur in most documents (a corpus
 * with 900 maize bulletins all says "maize") get a low IDF weight so they do
 * not make every pair look related — the per-term weighting is what makes this
 * work for templated corpora AND for prose corpora alike.
 *
 * @returns {Map<string, string[]>} concept_id → top-k neighbour ids (score desc)
 */
function buildNeighborIndex(concepts, k = DEFAULT_NEIGHBORS) {
  const postings = new Map(); // token -> concept ids
  const perDoc = new Map(); // concept id -> Set<token>
  const N = concepts.length;
  for (const c of concepts) {
    const id = norm(c.concept_id);
    const toks = tokensFor(c);
    perDoc.set(id, toks);
    for (const t of toks) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(id);
    }
  }
  const idf = (t) => Math.log(1 + N / (1 + (postings.get(t) || []).length));
  const out = new Map();
  for (const [id, toks] of perDoc) {
    const scores = new Map();
    for (const t of toks) {
      const w = idf(t);
      for (const other of postings.get(t)) {
        if (other === id) continue;
        scores.set(other, (scores.get(other) || 0) + w);
      }
    }
    out.set(
      id,
      [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, Math.max(1, k))
        .map((e) => e[0])
    );
  }
  return out;
}

/** vLLM chat call — mirrors llm-curation-service.callVllm (endpoint/bearer
 * normalization + strict JSON) so both curation passes behave identically. */
async function callVllm(messages, { timeoutMs = TIMEOUT_MS } = {}) {
  const rawBase = process.env.VLLM_ENDPOINT;
  // No endpoint at all = the deliberate opt-out (compose ships it empty).
  if (!rawBase) throw new Error('llm-not-configured');
  // Model id under the !631 policy (services/vllm-model-cache.js): pin ->
  // /v1/models discovery -> loud ModelDiscoveryError (#1181). The probe
  // shares the call budget; the chat call gets what is left of it.
  const resolved = await modelCache.resolveDeploymentModel({
    baseUrl: rawBase,
    apiKey: modelCache.deploymentKey(),
    budgetMs: timeoutMs
  });
  const model = resolved.model;
  const chatTimeoutMs = resolved.remainingMs;
  const headers = {};
  const apiKey = modelCache.deploymentKey(); // both spellings — same as the probe
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await axios.post(
    // Shared URL rule (services/llm-url.js) — versioned base or bare host.
    require('./llm-url').openAiChatUrl(rawBase),
    {
      model,
      messages,
      temperature: 0.0,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' }
    },
    { timeout: chatTimeoutMs, headers }
  );
  return (r.data?.choices?.[0]?.message?.content || '').trim();
}

/**
 * The MAP prompt. The subject domain is stated as ARBITRARY and the relation
 * vocabulary is fixed, so the same prompt authors cross-links for beans,
 * asteroids or statutes with no code change.
 */
/**
 * Build the MAP prompt.
 *
 * SHORT HANDLES, not concept ids (live probe 2026-10-11). Concept ids are long
 * slugs — `122-manejo-agroecologico-del-gusano-cogollero-del-maiz-en-me-sec1`
 * is ~20 tokens — and every link repeats BOTH ids. At 8 concepts x 6 links
 * that is ~2000 tokens of pure identifier, which blew the completion budget:
 * the first live run came back `finish_reason: length` with the JSON truncated
 * mid-string (Unterminated string at position 4119). The model then spends the
 * whole pass unparseable.
 *
 * So the prompt hands out D1..Dn / P1..Pm handles and the REDUCE stage maps
 * them back. A handle is 3 tokens; the ids never leave the process. The
 * response is still tolerant of a raw id (models sometimes echo one), so a
 * stray echo degrades to a dangling drop rather than an exception.
 */
function buildLinkMapPrompt(batch, catalog) {
  const handles = new Map(); // handle -> concept_id
  const docHandle = new Map(); // concept_id -> handle
  const docs = batch
    .map((c, i) => {
      const h = `D${i + 1}`;
      handles.set(h, c.concept_id);
      docHandle.set(c.concept_id, h);
      const snippet = String(c.body || c.summary || '')
        .replace(/\s+/g, ' ')
        .slice(0, DEFAULT_SNIPPET_CHARS);
      return `- ${h}: ${c.title || c.concept_id}\n  excerpt: ${snippet}`;
    })
    .join('\n');
  const cands = catalog.length
    ? catalog
        .map((c, i) => {
          const h = `P${i + 1}`;
          handles.set(h, c.concept_id);
          return `- ${h}: ${c.title || c.concept_id}`;
        })
        .join('\n')
    : '(none)';
  const system =
    'You link documents in a knowledge base whose subject domain is arbitrary — ' +
    'agriculture, astronomy, law, engineering, or anything else. You never assume a domain. ' +
    'Answer with STRICT JSON only, in exactly this shape: ' +
    '{"links": [{"from": "<handle>", "to": "<handle>", "type": "<relation>", "label": "<phrase>"}]}. ' +
    `"from" MUST be a D handle (a document being linked) and "to" MUST be a D or P handle — ` +
    'never invent a handle, never use any other identifier. ' +
    `The "type" MUST be one of ${JSON.stringify(LINK_TYPES)}. ` +
    'Rules: (1) never link a document to itself; (2) link a pair ONLY when a reader of one ' +
    'would genuinely want to follow the link to the other to understand it — they share a subject, ' +
    'one qualifies or constrains the other, one is a case or instance of the other, or they are ' +
    'worth setting side by side; (3) prefer the most SPECIFIC relation type that is true over the ' +
    'generic "related_to"; (4) at most 4 links per document, and never more than 2 to the same ' +
    'target; (5) "label" is at most 4 words naming the relation. ' +
    'Return {"links": []} when nothing genuinely relates.';
  const user = `Documents:\n${docs}\n\nCandidate link targets:\n${cands}`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    handles
  };
}

/**
 * Resolve a handle (or a raw concept id the model echoed back) to a real
 * concept id. Tolerant by design: an unresolvable value returns null and the
 * reduce stage drops it as a dangling target — the same fate as a hallucinated
 * id, which is the correct outcome either way.
 */
function resolveHandle(value, handles) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (handles.has(raw)) return handles.get(raw);
  const direct = norm(raw);
  for (const id of handles.values()) if (norm(id) === direct) return id;
  return null;
}

/**
 * Deal concepts into batches that SPAN documents.
 *
 * A segmented import produces many concepts per source file (`…-sec1`, `…-sec2`,
 * …), and sorting by id put seven siblings of one bulletin in the first batch
 * (live probe). That spends the pass on intra-document edges and starves the
 * cross-document linking the feature exists for. Round-robin dealing across
 * source documents keeps every batch representative — and it stays
 * deterministic, so a re-run batches identically.
 */
function buildBatches(concepts, size) {
  const bySource = new Map();
  for (const c of concepts) {
    // The source document is the id without its segment suffix — the producer
    // mints `<slug>-secN` per section. Fall back to the whole id.
    const key = String(c.concept_id).replace(/-sec\d+$/i, '');
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(c);
  }
  const groups = [...bySource.values()];
  const batches = [];
  for (let i = 0; i < groups.length; i += size) {
    // Deal one from each source group per batch before starting a second round.
    const batch = [];
    for (const g of groups) {
      const idx = i + (batch.length % Math.max(1, Math.ceil(groups.length / size)));
      if (g[idx]) batch.push(g[idx]);
      if (batch.length >= size) break;
    }
    if (batch.length) batches.push(batch);
  }
  // Any group longer than what the deal above consumed (a single document with
  // more sections than the batch size) is appended in order — never dropped.
  const seen = new Set(batches.flat().map((c) => c.concept_id));
  const overflow = concepts.filter((c) => !seen.has(c.concept_id));
  for (let i = 0; i < overflow.length; i += size) {
    const chunk = overflow.slice(i, i + size);
    if (chunk.length) batches.push(chunk);
  }
  return batches;
}

/**
 * REDUCE — the safety net. Everything an LLM can get wrong is dropped HERE,
 * deterministically, before a single write: self-loops, targets that are not
 * in this repo (dangling), duplicates within the batch, pairs that already
 * exist (idempotency), and over-cap fan-out.
 *
 * Pure — no DB, no LLM. Exported for unit tests.
 *
 * @param {object} args
 * @param {Array<{concept_id:string,title:string,links?:Array}>} args.concepts
 *   every live concept of the repo (the id set is the dangling authority)
 * @param {Array<{from:string,to:string,type?:string,label?:string}>} args.proposals
 * @param {number} [args.maxPerConcept]
 * @returns {{plan: Map<string, Array<{to_concept_id:string,label:string,type:string}>>, stats: object}}
 */
function reduceProposals({ concepts, proposals, maxPerConcept = DEFAULT_MAX_PER_CONCEPT }) {
  const cap = Math.max(1, maxPerConcept);
  const byId = new Map();
  const existing = new Map(); // id -> Set of already-linked target ids
  for (const c of concepts || []) {
    const id = norm(c.concept_id);
    byId.set(id, c);
    const have = new Set();
    for (const l of Array.isArray(c.links) ? c.links : []) {
      const t = norm(l && (l.to_concept_id || l.target));
      if (t) have.add(t);
    }
    existing.set(id, have);
  }
  const stats = {
    proposed: 0,
    kept: 0,
    self_loops: 0,
    dangling: 0,
    duplicates: 0,
    already_linked: 0,
    over_cap: 0,
    unknown_from: 0
  };
  // Bucket by source first so the cap is applied per source, deterministically.
  const buckets = new Map(); // from -> Map<to, {label,type,order}>
  for (const p of proposals || []) {
    stats.proposed += 1;
    const from = norm(p && p.from);
    const to = norm(p && p.to);
    if (!byId.has(from)) {
      stats.unknown_from += 1;
      continue;
    }
    if (!to || to === from) {
      stats.self_loops += 1;
      continue;
    }
    if (!byId.has(to)) {
      stats.dangling += 1;
      continue;
    }
    if (existing.get(from).has(to)) {
      stats.already_linked += 1;
      continue;
    }
    if (!buckets.has(from)) buckets.set(from, new Map());
    const b = buckets.get(from);
    if (b.has(to)) {
      stats.duplicates += 1;
      continue;
    }
    const type = LINK_TYPES.includes(p.type) ? p.type : 'related_to';
    const label =
      String(p.label || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || (byId.get(to).title || to).slice(0, 60);
    b.set(to, { to_concept_id: to, label, type });
  }
  // Cap with a deterministic order: specific relations first (the generic
  // "related_to" is the weakest signal), then by target id for stability across
  // runs — an unstable cap would make a re-run write different edges.
  const typeRank = (t) => (t === 'related_to' ? 1 : 0);
  const plan = new Map();
  for (const [from, b] of buckets) {
    const entries = [...b.values()].sort(
      (x, y) => typeRank(x.type) - typeRank(y.type) || x.to_concept_id.localeCompare(y.to_concept_id)
    );
    if (entries.length > cap) stats.over_cap += entries.length - cap;
    plan.set(from, entries.slice(0, cap));
    stats.kept += Math.min(entries.length, cap);
  }
  return { plan, stats };
}

/** Lane-bounded pool (same contract as llm-curation-service.runPool). */
async function runPool(items, lanes, worker) {
  let next = 0;
  const n = Math.max(1, Math.min(lanes, items.length || 1));
  const runners = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Load the authoring surface for a repo: ids, titles, summaries, bodies and
 * the CURRENT links[] (the idempotency + dangling authority). */
async function loadConcepts(repoId) {
  const db = await dbService.getConnection('default');
  return (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" SORT m.concept_id ' +
        'RETURN { concept_id: m.concept_id, title: m.title, summary: m.summary, labels: m.labels, ' +
        'tags: m.tags, links: m.links, is_index: m.is_index, body: m.body }',
      { r: repoId }
    )
  ).all();
}

/**
 * The MAP stage: batch the concepts (spanning source documents), give each
 * batch the neighbour catalog the inverted index produced for its members,
 * ask the LLM which candidates are real, and map the short handles it answers
 * with back to real concept ids. One failing batch never fails the pass.
 */
async function mapProposals(concepts, neighbors, byId, { onProgress, progressState } = {}) {
  const batchSize = Math.max(1, DEFAULT_BATCH);
  const lanes = Math.max(1, DEFAULT_LANES);
  const batches = buildBatches(concepts, batchSize);
  const proposals = [];
  let done = 0;
  let failures = 0;

  await runPool(batches, lanes, async (batch) => {
    const catalogIds = new Set();
    for (const c of batch) {
      for (const nid of neighbors.get(norm(c.concept_id)) || []) {
        if (catalogIds.size >= DEFAULT_CATALOG_CAP) break;
        catalogIds.add(nid);
      }
    }
    const catalog = [...catalogIds].map((id) => ({ concept_id: id, title: byId.get(id) && byId.get(id).title }));
    try {
      const { messages, handles } = buildLinkMapPrompt(batch, catalog);
      const raw = await withSpan('okf.llm.topic-link-map', async (span) => {
        span.setAttribute('okf.concepts_in_batch', batch.length);
        span.setAttribute('okf.catalog_rows', catalog.length);
        return callVllm(messages);
      });
      let j;
      try {
        j = JSON.parse(raw);
      } catch {
        failures += 1;
        // A truncated response means the budget ran out mid-JSON — say so, the
        // number is a prompt-size signal, not a flake.
        const truncated = /\{"links":\s*\[?\s*$|Unterminated/.test(raw) || raw.length > 0;
        logger.warn('OKF topic links: unparseable batch response — skipped', {
          batch_size: batch.length,
          response_chars: raw.length,
          likely_truncated: truncated,
          ids: batch.map((c) => c.concept_id).slice(0, 5)
        });
        return;
      }
      for (const l of Array.isArray(j.links) ? j.links : []) {
        if (!l) continue;
        const from = resolveHandle(l.from, handles);
        const to = resolveHandle(l.to, handles);
        // An unresolved handle is dropped HERE rather than pushed as null, so
        // the reduce stats stay honest about what the model actually proposed.
        if (!from || !to) continue;
        proposals.push({ from, to, type: l.type, label: l.label });
      }
    } catch (e) {
      failures += 1;
      logger.warn('OKF topic links: batch failed — skipped (fail-soft): ' + e.message, {
        batch_size: batch.length
      });
    } finally {
      done += 1;
      if (onProgress) onProgress({ ...progressState, batches_done: done, batches_total: batches.length, failures });
    }
  });
  return { proposals, batches_total: batches.length, failures };
}

/**
 * WRITE — append the planned edges to `frontmatter.links[]` through the
 * field-scoped patch (born right; survives body edits; feeds the editor graph
 * AND the ingest graph). Existing links are preserved; each concept is
 * re-read first so a concurrent steward edit is never clobbered.
 */
async function applyLinkPlan(repoId, plan, { actor } = {}) {
  const conceptMeta = require('./concept-meta-service');
  let written = 0;
  let failed = 0;
  const touched = [];
  for (const [from, links] of plan) {
    try {
      const current = await conceptMeta.getConceptMeta(repoId, from);
      if (!current) {
        failed += 1;
        continue;
      }
      const fmLinks = Array.isArray(current.frontmatter && current.frontmatter.links) ? current.frontmatter.links : [];
      const have = new Set(fmLinks.map((l) => norm(l && (l.to_concept_id || l.target))));
      const add = links.filter((l) => !have.has(norm(l.to_concept_id)));
      if (!add.length) continue;
      await conceptMeta.patchConceptFields(repoId, from, {
        frontmatterPatch: {
          links: [...fmLinks, ...add.map((l) => ({ to_concept_id: l.to_concept_id, label: l.label }))]
        }
      });
      written += add.length;
      touched.push(from);
    } catch (e) {
      failed += 1;
      logger.warn('OKF topic links: write failed for ' + from + ': ' + e.message, {
        repo_id: repoId,
        concept_id: from,
        actor: actor || null
      });
    }
  }
  return { written, failed, concepts_linked: touched.length };
}

// ── the repo-doc progress channel (editor run state) ────────────────────────

const REPOS_COLLECTION = 'okf_repositories';

/** DOCUMENT(collection, key) — BOTH arguments are bound, and they are NOT the
 * same value: ArangoDB reads the FIRST slot as the collection name. A live
 * probe (2026-10-11) caught the first draft binding the repo id to both, so
 * the lookup silently matched nothing and returned 0 documents — no error, the
 * run state just never landed. `_key === repo_id` for this collection
 * (repository-service.document(repo_id)). Exported so the test suite can pin
 * the two-slot invariant that unit mocks can never see. */
const RUN_STATE_AQL =
  'LET doc = DOCUMENT(@collection, @repo_id) FILTER doc != null UPDATE doc WITH { topic_links: @patch } IN ' +
  REPOS_COLLECTION +
  ' RETURN doc';

async function patchRunState(repoId, patch) {
  const db = await dbService.getConnection('default');
  await db.query(RUN_STATE_AQL, { collection: REPOS_COLLECTION, repo_id: repoId, patch });
}

/**
 * Run the whole pass: load → map → reduce → write.
 *
 * @param {object} repo  the repo doc (repo_id required)
 * @param {object} [opts]
 * @param {(s:object)=>void} [opts.onProgress]
 * @param {object} [opts.progressState]  merged into every progress payload
 * @param {boolean} [opts.dryRun]  map+reduce only, no writes (the editor's dry run)
 * @returns {Promise<object>} {total, proposed, kept, written, concepts_linked, failures, ...}
 */
async function authorRepoTopicLinks(repo, opts = {}) {
  const { onProgress, dryRun = false, actor } = opts;
  const repoId = repo.repo_id;
  const t0 = Date.now();
  return withSpan('okf.topic_links.author', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const concepts = await loadConcepts(repoId);
    const byId = new Map(concepts.map((c) => [norm(c.concept_id), c]));
    // The index root is the discovery entry, not a topic — the same rule the
    // curation pass applies. Linking it to everything adds a star that tells
    // the graph nothing.
    const subjects = concepts.filter((c) => !c.is_index && norm(c.concept_id) !== 'index');
    span.setAttribute('okf.topic_links.concepts', subjects.length);
    if (subjects.length < 2) {
      logger.info('OKF topic links: too few subjects to cross-link', {
        repo_id: repoId,
        concepts: subjects.length
      });
      const empty = {
        total: subjects.length,
        proposed: 0,
        kept: 0,
        written: 0,
        concepts_linked: 0,
        failures: 0,
        skipped: 'TOO_FEW_SUBJECTS',
        elapsed_ms: Date.now() - t0
      };
      if (onProgress) onProgress({ ...opts.progressState, ...empty, final: true });
      return empty;
    }
    const neighbors = buildNeighborIndex(subjects);
    const progressState = opts.progressState || {};
    const {
      proposals,
      batches_total: batchesTotal,
      failures
    } = await mapProposals(subjects, neighbors, byId, {
      onProgress,
      progressState
    });
    const { plan, stats } = reduceProposals({ concepts: subjects, proposals });
    const summary = {
      total: subjects.length,
      proposed: stats.proposed,
      kept: stats.kept,
      self_loops: stats.self_loops,
      dangling: stats.dangling,
      duplicates: stats.duplicates,
      already_linked: stats.already_linked,
      over_cap: stats.over_cap,
      batches_total: batchesTotal,
      // The pass is finished by the time this object is built, so every batch
      // is done. The terminal onProgress emit spreads THIS object, and the
      // consumer defaults a missing batches_done to 0 — without this the last
      // write (which is never throttled, and therefore the one that always
      // lands) reported 0 of N batches while the links were all written
      // (live 2026-10-11: "0 of 75 batches - 448 links written").
      batches_done: batchesTotal,
      failures,
      // Named stage so a progress bar can SAY what is happening rather than
      // showing an anonymous counter (David, 2026-10-11: the Step-4 bars must
      // depict each stage, not just tick).
      phase: 'authoring'
    };
    if (dryRun) {
      summary.written = 0;
      summary.concepts_linked = 0;
      summary.dry_run = true;
      summary.plan = Object.fromEntries([...plan].map(([k, v]) => [k, v]));
      summary.elapsed_ms = Date.now() - t0;
      if (onProgress) onProgress({ ...progressState, ...summary, final: true });
      return summary;
    }
    const applied = await applyLinkPlan(repoId, plan, { actor });
    const result = { ...summary, ...applied, elapsed_ms: Date.now() - t0 };
    span.setAttribute('okf.topic_links.written', result.written);
    logger.info('OKF topic links complete', {
      repo_id: repoId,
      concepts: result.total,
      proposed: result.proposed,
      kept: result.kept,
      written: result.written,
      concepts_linked: result.concepts_linked,
      dropped: {
        self_loops: result.self_loops,
        dangling: result.dangling,
        duplicates: result.duplicates,
        already_linked: result.already_linked,
        over_cap: result.over_cap
      },
      batches: batchesTotal,
      failures,
      elapsed_ms: result.elapsed_ms
    });
    if (onProgress) onProgress({ ...progressState, ...result, final: true });
    return result;
  });
}

// ── editor entry point: detached run + polling state ────────────────────────

const inflight = new Set();

/**
 * POST /repos/:repo_id/topic-links — start the pass DETACHED (a 1000-concept
 * repo takes minutes; the gateway caps a request at 60s) and return 202 with
 * the run state. Mirrors the conversion job contract: a second start while one
 * is in flight is refused rather than racing.
 */
async function startTopicLinkRun(repoDoc, { dryRun = false, actor } = {}) {
  const repoId = repoDoc.repo_id;
  if (inflight.has(repoId)) {
    const err = new Error('a topic-link run is already executing for this repository');
    err.code = 'RUN_IN_FLIGHT';
    err.status = 409;
    throw err;
  }
  const startedAt = new Date().toISOString();
  const initial = {
    status: 'running',
    stage: 'authoring',
    started_at: startedAt,
    finished_at: null,
    dry_run: !!dryRun,
    concepts_total: 0,
    batches_total: 0,
    batches_done: 0,
    written: 0,
    concepts_linked: 0,
    failures: 0,
    error: null
  };
  await patchRunState(repoId, initial);
  inflight.add(repoId);
  const state = { ...initial };
  let lastWrite = 0;
  // Progress writes are SERIALISED through one chain and the terminal state is
  // set by the write itself. The first draft fired each write detached and
  // cleared `inflight` in a finally — so a poll landing between "pass
  // finished" and "terminal state written" read status:'running' with no live
  // worker and reported a SUCCESSFUL run as 'the run was interrupted' (live,
  // 2026-10-11: 472 links written, status failed). Serialising the writes and
  // awaiting the chain before clearing `inflight` closes that window.
  let pending = Promise.resolve();
  const writeState = (patch) => {
    pending = pending
      .then(() => patchRunState(repoId, patch))
      .catch((e) => logger.warn('OKF topic links: progress write failed: ' + e.message, { repo_id: repoId }));
    return pending;
  };
  const onProgress = (p) => {
    Object.assign(state, p);
    const terminal = !!p.final;
    const now = Date.now();
    if (!terminal && now - lastWrite < PROGRESS_WRITE_MIN_MS) return;
    lastWrite = now;
    writeState({
      ...state,
      status: terminal ? 'done' : 'running',
      stage: terminal ? 'done' : state.stage,
      error: null,
      finished_at: terminal ? new Date().toISOString() : null
    });
  };
  const runner = (async () => {
    try {
      const result = await authorRepoTopicLinks(repoDoc, { onProgress, dryRun, actor });
      await pending; // the terminal state is durable before the run stops
      return result;
    } catch (err) {
      logger.error('OKF topic links run failed: ' + err.message, { repo_id: repoId });
      await writeState({
        ...state,
        status: 'failed',
        stage: 'failed',
        error: err.message,
        code: err.code || 'TOPIC_LINK_RUN_FAILED',
        finished_at: new Date().toISOString()
      });
      return null;
    } finally {
      inflight.delete(repoId);
    }
  })();
  runner.catch(() => {}); // the runner never rejects; belt-and-braces
  return { ...initial, run_id: startedAt };
}

/** GET /repos/:repo_id/topic-links — the last run's state (poll target). */
async function getTopicLinkRunState(repoDoc) {
  const s = repoDoc.topic_links || null;
  // A run left 'running' with no in-flight worker died with the process (the
  // same interruption the suite runner sweeps) — report it honestly rather
  // than showing a spinner that never resolves.
  if (s && s.status === 'running' && !inflight.has(repoDoc.repo_id)) {
    return { ...s, status: 'failed', error: 'the run was interrupted before it finished' };
  }
  return s;
}

module.exports = {
  LINK_TYPES,
  RUN_STATE_AQL,
  REPOS_COLLECTION,
  authorRepoTopicLinks,
  startTopicLinkRun,
  getTopicLinkRunState,
  // pure, exported for unit tests
  buildNeighborIndex,
  buildLinkMapPrompt,
  buildBatches,
  resolveHandle,
  reduceProposals,
  tokensFor,
  norm,
  enabled
};
