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
//   - vLLM (the deployment base — VLLM_ENDPOINT, else the compose service
//     name) for /v1/chat/completions:
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
// Single source of truth for the tag ceilings — the SAME constants the write
// path validates against. See the block at the `cap()` definition for why the
// suggester cannot be allowed to exceed them.
const { TAG_LIMITS } = require('../validators/repository-validator');

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
// The base rule (env endpoint, else the compose service) lives in ONE place
// with the provenance labels: vllm-model-cache.deploymentVllmBase().
const modelCache = require('./vllm-model-cache');
// The chat model id is NOT defaulted here — it is resolved per call under
// the !631 discovery policy (services/vllm-model-cache.js): explicit pick >
// env pin (VLLM_LLM_MODEL_ID / VLLM_MODEL_ID) > /v1/models discovery >
// loud ModelDiscoveryError. The old hardcoded 'ibm-granite/granite-4.1-8b'
// fallback named a model the endpoint may not serve — vLLM validates the
// name and 404s every call (#1181).

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
// 1-8g-n (David 2026-10-11: "why is the budget 20 rows... the resultant
// labels would hardly describe a 900 topic repository adequately" / "can we
// make it dynamic"): the flat 20 was sized when repos held 5-20 concepts.
// Concept COUNT does not discriminate real repos (Indonesia 999 concepts /
// 7 labels vs www-gov-uk 997 / 24 — nearly identical size, very different
// subject surface). The dimension that matters is the LABEL SURFACE, so the
// sample is spent ROUND-ROBIN across labels until the prompt budget is full:
//
//   rows = fill(labels, per-label cap) subject to (a) a per-label ceiling, so
//   no single label dominates, and (b) the prompt character budget, so a
//   wide repo simply gets a wider prompt — still ONE call.
//
// The two knobs are safety rails, not the policy. Their VALUES are set from
// a MEASURED latency budget, not guessed: the endpoint is SYNCHRONOUS and the
// gateway caps at 60s, so we keep the prompt in the range where one call
// returns comfortably. Measured 2026-10-11 against the live vLLM: 30KB of
// prompt took 25.7s (finish_reason 'length'), so the ceiling here is ~20KB
// (~15-17s) — a 5x improvement on the old 20-row/6KB prompt while staying
// well inside the timeout. Going wider needs the async (202+poll) treatment
// the suite generator already uses; that is the queued follow-up.
const SUGGEST_PER_LABEL_ROWS = parseInt(process.env.OKF_FRONTMATTER_PER_LABEL_ROWS || '4', 10);
const OKF_FRONTMATTER_SAMPLE_N = parseInt(process.env.OKF_FRONTMATTER_SAMPLE_N || '400', 10);
const OKF_FRONTMATTER_PROMPT_CHARS = parseInt(process.env.OKF_FRONTMATTER_PROMPT_CHARS || '20000', 10);
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

// Which upstream failures are worth another attempt? TEI_EMBED_HOST and
// VLLM_ENDPOINT both point at the SHARED remote GPU node
// (ai.assembly.govstack.global), so a dropped connection is routine
// rather than exceptional — it is the exact failure this wrapper is for.
//
// A prematurely-closed response stream was MISSING from this list until
// 2026-10-12. axios surfaces a mid-response upstream disconnect as
// ERR_STREAM_PREMATURE_CLOSE ("stream has been aborted"), which matches
// neither the status codes nor the socket codes below, so the wrapper
// fell through to `throw err` on the FIRST abort. Live proof: "Explain
// failures" on the Alphabet repo died twice in a row with
// `AxiosError: stream has been aborted` at frontmatter-service.js
// withTeiRetry — zero retries — while the head-embed endpoint kept
// resetting under the shared node's load.
const RETRIABLE_UPSTREAM_CODES = new Set([
  'ECONNABORTED', // our own axios timeout
  'ECONNREFUSED',
  'ECONNRESET', // peer reset the socket
  'EPIPE',
  'ETIMEDOUT',
  'ERR_STREAM_PREMATURE_CLOSE' // axios: upstream closed mid-response
]);
// 429 joined 2026-10-23: the shared endpoint's burst limiter answers 429
// long before the plan's 5-hour/weekly quotas are anywhere near spent (live:
// 4 of 100 benchmark rows died on a 429 that sailed straight through this
// set). A rate limit is the definition of "wait and try again" — pausing is
// the fix, failing is not.
const RETRIABLE_UPSTREAM_STATUS = new Set([429, 502, 503, 504]);

function isRetriableUpstreamError(err) {
  if (!err) return false;
  const status = err.response && err.response.status;
  if (status && RETRIABLE_UPSTREAM_STATUS.has(status)) return true;
  if (err.code && RETRIABLE_UPSTREAM_CODES.has(err.code)) return true;
  // Some aborts reach us as a bare Error carrying neither a code nor a
  // response — match the message so a known-transient blip is never
  // mistaken for a permanent failure.
  const msg = typeof err.message === 'string' ? err.message : '';
  return /stream has been aborted|socket hang up|premature close|ECONNRESET/i.test(msg);
}

async function withUpstreamRetry(label, fn, ctx) {
  // Binary exponential backoff (David, 2026-10-23): 1s, 2s, 4s, 8s — four
  // attempts. The server's own Retry-After wins when it sends one (a rate
  // limiter that says "come back in 3s" knows better than our ladder), but
  // capped at 60s — "come back in an hour" must not park the caller an hour.
  const base = 1000;
  const max = 8000;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriableUpstreamError(err) || attempt === 3) break;
      const retryAfter = Number(err.response && err.response.headers && err.response.headers['retry-after']);
      const delay =
        (Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(60000, retryAfter * 1000)
          : Math.min(max, base * Math.pow(2, attempt))) + Math.floor(Math.random() * 250);
      logger.warn(`frontmatter.${label}.retry`, {
        ...ctx,
        attempt: attempt + 1,
        status: (err.response && err.response.status) || null,
        code: err.code || null,
        delay_ms: delay,
        err: err.message
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

const withVllmRetry = (fn, ctx) => withUpstreamRetry('vllm', fn, ctx);
const withTeiRetry = (fn, ctx) => withUpstreamRetry('tei', fn, ctx);

// ---------- LLM call (vLLM OpenAI surface, via axios — Node has no openai SDK) ----------

const TAG_PROMPT = (
  sampleSize,
  conceptsText,
  distributionText
) => `You are a curator for an enterprise knowledge-base system. A repository
contains ${sampleSize} concepts (curator-authored knowledge entries). Each
concept below has a title, a type (topic | entity | process | event | source),
the curator's own per-concept TOPICS (the "tags" field — these are the
single source of truth for what this repo is about), the
Knowledge-Hierarchy labels the curator assigned, and a one-line summary.

${
  distributionText
    ? `COMPLETE SUBJECT DISTRIBUTION (every concept in this repo, counted):
${distributionText}

This histogram is the repo's REAL subject surface — it counts every concept,
not just the sample below. Use it to drive coverage.

`
    : ''
}YOUR JOB IS AGGREGATION, NOT INVENTION. The curator has already decided
what the repo is about by setting per-concept topics. You must:

  1. Roll the per-concept topics up into a REPO-LEVEL topic set (3-8
     high-level topics) that UNIQUELY characterizes this repo vs. its
     siblings. The topic set must FULLY cover the per-concept topic
     surface — a sibling repo should have an unambiguously different
     topic set.
${
  distributionText
    ? `     COVERAGE IS A HARD REQUIREMENT: every label with a real count in
     the distribution above MUST be represented in "topic" or "entity".
     A subject area with hundreds of concepts that appears nowhere in your
     tag set is a routing failure — queries about it will never reach this
     repo. Prefer specific, named subjects over generic ones.`
    : ''
}
  2. Identify the named entities across the concepts (people, products,
     places, organizations) — pull from the per-concept tags and labels.
  3. Infer the repo's scope from the concept types and topics.
  4. The FORBIDDEN list is the ADJACENT DOMAINS a user might assume are
     here but aren't — 3-6 sibling domains of the same family that this
     corpus does NOT cover. Think in whole domains, not just the nearest
     topic: a non-communicable-disease (NCD) corpus should list
     communicable-disease and mental-health; a repo of bali-hindu-rituals
     should list bali-beach-tourism. A query inside a
     forbidden domain must NEVER route to this repo, so cover every
     plausible confusable neighbor of the topic surface.
${
  distributionText
    ? `
     ABSOLUTE RULE (1-8g-m, learned from a live routing failure): you must
     NEVER forbid a subject the corpus demonstrably CONTAINS. The
     distribution above IS that evidence — if a label appears there with a
     real count, that subject is part of this repo and must NOT be
     forbidden, nor any tag containing that word (forbidding "modern-politics"
     when the corpus holds hundreds of politics concepts will hard-veto
     legitimate queries). Only forbid subjects that are ABSENT from the
     distribution.`
    : ''
}
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

EACH VALUE EXACTLY ONCE (CRITICAL): no string may appear twice anywhere in
this object. Before you emit an item, check it is not already there. Repeating
one value over and over until your output runs out is THE most common way this
call fails, and it voids the whole response — the run is scored on unique,
complete fields, not on volume. Respect every per-array count above as a HARD
STOP: once you have that many distinct values, move to the next field. Do not
pad an array by repeating what you already have.

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

/** 8-7 model configs: an ACTIVE configuration checked for opts.service
 * (default 'okf_tagging' — this one client fronts every
 * frontmatter/topic/head-test-explain LLM call; the RAGAS benchmark answer
 * leg passes 'ragas_answers') takes precedence over the env consts.
 * Openai-wire provider only. Resolution failure falls back to env silently.
 *
 * Model-agnostic adaptivity (David 2026-10-20: "work within reason for any
 * selected model", "not a tactical fix for one model"): override-routed
 * calls ask for thinking-disabled (the emerging wire convention) and every
 * call retries with a raised budget when the answer was starved — see
 * services/adaptive-llm-call.js. Env-path calls behave exactly as before
 * unless they starve, in which case they too get the budget retry. */
async function vllmChatCompletions(systemAndUserMessages, opts = {}) {
  let host = modelCache.deploymentVllmBase();
  let model = null; // resolved below — explicit pick > pin > discovery (!631)
  // Per-call read (both spellings) so the probe and the chat call can never
  // disagree on credentials.
  let apiKey = modelCache.deploymentKey();
  let viaOverride = false;
  let viaForeignBase = false; // host switched away from the deployment base
  let judgeIsDeployment; // the judge base IS the deployment endpoint
  let configIsDeployment = false; // the named config points at the deployment endpoint
  const callBudgetMs = opts.timeoutMs || 60000;
  // The ENV JUDGE is the .env RAGAS_JUDGE_* pair — the same variables the
  // sidecar's default judge and the OKF panel's "system default" label name.
  // An explicit `config: null` asks for exactly that judge, so it must read
  // exactly those variables. It used to fall through to the VLLM_* pair,
  // which held the same values in this deployment but was tied to nothing:
  // changing RAGAS_JUDGE_* would have left the advisor calling a DIFFERENT
  // model than the one it names.
  if (opts.config === null) {
    // A judge base is FOREIGN to the deployment pin: with RAGAS_JUDGE_MODEL
    // unset the served model is discovered from the judge base itself —
    // the deployment pin never names a model on another endpoint.
    if (process.env.RAGAS_JUDGE_BASE_URL) {
      host = process.env.RAGAS_JUDGE_BASE_URL;
    }
    const judgeModel = (process.env.RAGAS_JUDGE_MODEL || '').trim();
    if (judgeModel) model = judgeModel;
    // The judge base is foreign to the deployment PIN and to the deployment
    // credential only when it is a DIFFERENT endpoint: the same server
    // under another path (the shipped http://vllm:8000/v1 vs
    // http://vllm:8000) serves the very model the pin names — and the pin
    // exists precisely for endpoints whose /v1/models is unreachable. An
    // unset judge base means the deployment endpoint itself.
    judgeIsDeployment = modelCache.sameOrigin(host, modelCache.deploymentVllmBase());
    viaForeignBase = !judgeIsDeployment;
    // The judge key: RAGAS_JUDGE_API_KEY when the operator named one, else
    // the deployment credential — but ONLY when the judge base IS the
    // deployment endpoint. The judge base is OPERATOR-configured (the .env
    // RAGAS_JUDGE_* pair): a third-party judge must never receive the
    // deployment bearer, and the shipped default (http://vllm:8000/v1) is
    // the same server, so it keeps the deployment credential. A NAMED model
    // config follows the same rule.
    apiKey = modelCache.credentialForBase(host, process.env.RAGAS_JUDGE_API_KEY);
  }
  try {
    // opts.config === null → the caller explicitly wants the ENV judge (the
    // .env RAGAS_JUDGE_* / VLLM_* pair), bypassing the active model config.
    // opts.config = {base_url, model, api_key, provider} → an explicit
    // override the caller already resolved (the advisor rides the RUN's
    // judge, so its advice comes from the model that produced the scores).
    const ovr =
      opts.config === null
        ? null
        : opts.config ||
          (await require('./model-config-service').resolveModelOverride({
            service: opts.service || 'okf_tagging'
          }));
    if (ovr && ovr.provider === 'openai') {
      // Version segment (…/v1, …/paas/v4) stays — openAiChatUrl appends only
      // /chat/completions to it (2026-10-21: force-appending /v1/chat/… to a
      // …/paas/v4 base 404'd every benchmark answer row).
      host = ovr.base_url.replace(/\/+$/, '');
      if (ovr.model) model = ovr.model;
      // The named-config base carries ITS key — or, when the config points
      // at the deployment endpoint itself, the deployment credential. A
      // third-party base gets neither: the GPU bearer must never leave the
      // deployment endpoint (probe AND chat call).
      apiKey = modelCache.credentialForBase(host, ovr.api_key);
      // A config pointing at the DEPLOYMENT endpoint resolves like the
      // deployment path (the pin applies — it exists for endpoints whose
      // /v1/models is unreachable); any other base resolves its own served
      // model.
      viaOverride = true;
      configIsDeployment = modelCache.sameOrigin(host, modelCache.deploymentVllmBase());
    }
  } catch {
    /* env fallback — see docblock */
  }
  // Model-id resolution, !631 policy (services/vllm-model-cache.js): the
  // explicit picks above (env judge / named config) win; a named-config
  // base resolves its OWN served model (the deployment pin never names a
  // foreign endpoint); everything else is pin -> /v1/models discovery ->
  // loud ModelDiscoveryError. Never a hardcoded fallback name (#1181).
  // Resolution inside the call budget (the helper keeps what is left for
  // the chat call — never less than a usable minimum).
  let chatTimeoutMs = callBudgetMs;
  if (!model) {
    const resolved =
      viaForeignBase || (viaOverride && !configIsDeployment)
        ? await modelCache.resolveForeignModel({ baseUrl: host, apiKey, budgetMs: callBudgetMs })
        : await modelCache.resolveDeploymentModel({ baseUrl: host, apiKey, budgetMs: callBudgetMs });
    model = resolved.model;
    chatTimeoutMs = resolved.remainingMs;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const body = {
    model,
    messages: systemAndUserMessages,
    max_tokens: opts.maxTokens || 800,
    temperature: opts.temperature || 0.0,
    response_format: { type: 'json_object' }
  };
  const url = require('./llm-url').openAiChatUrl(host);
  const fn = () =>
    require('./adaptive-llm-call').adaptiveChatCompletion({
      url,
      headers,
      body,
      timeoutMs: chatTimeoutMs,
      disableThinking: viaOverride
    });
  const resp = await withVllmRetry(fn, { endpoint: url });
  // The resolved model rides the response so callers can log provenance
  // without a second probe (a minutes-long thinking-model call can outlive
  // the discovery TTL — re-probing could then name a DIFFERENT model).
  resp.model = model;
  return resp;
}

// When the model runs out of tokens mid-object the content is a valid JSON
// PREFIX — the last value is half-written and every bracket is still open.
// JSON.parse rejects it, the /\{[\s\S]*\}/ regex finds no closing brace, and
// the whole response is lost INCLUDING the fields that were already complete.
// Live evidence 2026-10-11 (repo da894635, 586 El Salvador concepts): granite
// looped on "centa-cpc" inside the entity array, burned all 1000 max_tokens
// (finish_reason "length"), and the 8 good topics it HAD written were thrown
// away with the whole call. Repair cuts the prefix back to the last complete
// string literal and closes the brackets, salvaging the finished values.
// Only reached when the caller passes repair:true — i.e. the model reported
// finish_reason "length" and really was cut off. Nothing is invented: the
// partial value is dropped, never guessed at.
function repairTruncatedJson(content) {
  if (typeof content !== 'string') return null;
  const start = content.indexOf('{');
  if (start === -1) return null;
  const src = content.slice(start);

  // Every position at which a JSON string literal closed, ascending. Each is a
  // candidate cut; we try from the LAST backwards and take the first that
  // parses. Backing up matters because a closed string is not always a safe
  // cut: if it was a KEY the model was cut before writing the value, and
  // `{"topic":["a"],"summary"}` is not JSON. The previous cut drops that
  // whole unfinished pair instead.
  const cuts = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        cuts.push(i + 1);
      }
    } else if (ch === '"') {
      inString = true;
    }
  }
  for (let k = cuts.length - 1; k >= 0; k -= 1) {
    const parsed = closeAndParse(src, cuts[k]);
    if (parsed) return parsed;
  }
  return null;
}

// Close every bracket src[0..cut) left open, innermost first, and parse.
function closeAndParse(src, cut) {
  const open = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < cut; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      open.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      open.pop();
    }
  }
  try {
    return JSON.parse(src.slice(0, cut) + open.reverse().join(''));
  } catch {
    return null;
  }
}

function extractJson(content, opts = {}) {
  const m = content && content.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      if (!opts.repair) return null;
    }
  }
  return opts.repair ? repairTruncatedJson(content) : null;
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
  const hfKey =
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACEHUB_API_TOKEN ||
    process.env.VLLM_API_KEY ||
    process.env.VLLM_LLM_API_KEY ||
    '';
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

async function sampleConceptsFromRepo(db, repoId) {
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
  // AQL reads just those fields — no body text, no chunk embeddings.
  //
  // 1-8g-m (David 2026-10-11: "the tags on the repo head suggested are a
  // very good base for routing queries, whether the repo is large or
  // small"): the legacy `SORT m._key LIMIT n` took the FIRST n concepts by
  // auto-generated key — an alphabetical slice, not a representative one.
  // Live on Indonesia History (999 concepts): the 20 sampled rows carried
  // only History(14)+Prehistory(5) while the real label surface was
  // History 513 / Politics 133 / Culture 99 / Economics 68 / Religion 29.
  // Four subject areas were invisible to the LLM, and it then FORBIDDENED
  // modern-politics + contemporary-culture — domains the corpus has in
  // abundance (a live veto trap). Two things now happen in ONE query:
  //   - the COMPLETE per-label distribution (a COLLECT over every concept,
  //     so it is accurate at ANY repo size), and
  //   - a LABEL-STRATIFIED sample (a few rows per label, round-robin by
  //     label size) so every subject area is represented in the prompt.
  const q = await db.query(`FOR r IN okf_repositories FILTER r._key == @rid LIMIT 1 RETURN r`, { rid: repoId });
  const list = await q.all();
  const repo = list && list[0];
  if (!repo) throw new FrontmatterError('REPO_NOT_FOUND', `repo ${repoId} not found`, 404);
  // Group every concept by its PRIMARY (first) label; return both the group
  // size (the histogram) and a bounded deterministic sample per group. One
  // pass, no full-corpus fetch.
  //
  // 1-8g-m2 (live 500, David 2026-10-11 11:40Z): this query shipped broken
  // and the jest suite could not see it — the arango mock returns canned rows
  // regardless of AQL text. Two AQL rules were violated:
  //   (1) `LET lab = ...` followed by `COLLECT lab = lab` assigns the SAME
  //       variable twice — ArangoDB rejects the whole query
  //       ("variable 'lab' is assigned multiple times"). Fixed by naming the
  //       LET result `primary` and collecting into `label`.
  //   (2) a nested `FOR x IN (subquery) RETURN …` did not parse. Fixed by a
  //       single subquery carrying the LIMIT itself.
  // Verified against the live database before this fix (Indonesia History:
  // 8 groups, 999 concepts — History 513 / (unlabeled) 147 / Politics 133 /
  // Culture 99 / Economics 68 / Religion 29 / Prehistory 9 / Kingdoms 1).
  const cq = await db.query(
    `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid
       LET primary = (LENGTH(m.labels) > 0 && m.labels[0] != null) ? m.labels[0] : "(unlabeled)"
       COLLECT label = primary INTO rows = m
       LET s = (
         FOR r2 IN rows SORT r2._key LIMIT @perLabel
         RETURN { concept_id: r2.concept_id, title: r2.title, type: r2.type,
                  tags: r2.tags, labels: r2.labels, summary: r2.summary }
       )
       RETURN { label: label, total: LENGTH(rows), sample: s }`,
    { rid: repoId, perLabel: Math.max(1, Math.min(SUGGEST_PER_LABEL_ROWS, OKF_FRONTMATTER_SAMPLE_N)) }
  );
  const groups = await cq.all();
  return { repo, groups };
}

// Turn the grouped AQL result into (a) the label distribution the prompt
// needs, (b) a label-stratified concept sample, and (c) honest coverage
// counters the UI renders ("derived from N of M").
//
// 1-8g-n (David 2026-10-11: "why is the budget 20 rows... the resultant
// labels would hardly describe a 900 topic repository adequately"):
// the sample budget must scale with the LABEL SURFACE, not sit at a flat
// 20. At 20 rows a 24-label repo (www-gov-uk-full-crawl: Departments 358,
// Guidance and regulation 231, Money and tax 52, Visas 33 … 997 concepts)
// got LESS THAN ONE concrete row per label — the LLM could see the label
// NAMES but no subject material, so it could only invent. The quota is now
// a flat per-label allowance (never proportional: a proportional quota hands
// the dominant label most of the budget, which is the exact failure we are
// fixing), and the total budget is perLabel × labelCount under a hard cap.
function buildSuggestContext(groups, n) {
  const usable = (groups || []).filter((g) => g && (g.total || 0) > 0);
  // Histogram: biggest subject first, alphabetical tie-break (deterministic).
  const histogram = usable
    .map((g) => ({ label: g.label, count: g.total }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  // Per-label quota is FLAT (equal material per subject), bounded by what the
  // group actually has and by SUGGEST_PER_LABEL_ROWS so one huge label can't
  // flood the prompt. `n` and the char budget are the overall rails.
  const ordered = usable.slice().sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)));
  const perLabel = Math.max(1, SUGGEST_PER_LABEL_ROWS);
  const charBudget = Math.max(2000, n);
  const quotas = new Map();
  for (const g of ordered) {
    quotas.set(g.label, Math.min(perLabel, Math.max(1, g.sample.length)));
  }
  const concepts = [];
  let chars = 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (const g of ordered) {
      const quota = quotas.get(g.label) || 0;
      if (concepts.length >= n) break;
      const already = concepts.filter((c) => c._sample_label === g.label).length;
      if (already < quota && already < (g.sample || []).length) {
        const row = { ...g.sample[already], _sample_label: g.label };
        // Estimate the formatted cost; stop before the prompt budget is blown
        // (the caller slices the final text to the same limit anyway).
        const cost = 40 + String(row.title || row.concept_id || '').length + String(row.summary || '').length;
        if (chars + cost > charBudget && concepts.length >= ordered.length) break;
        chars += cost;
        concepts.push(row);
        progress = true;
      }
    }
  }
  const conceptsTotal = histogram.reduce((s, h) => s + h.count, 0);
  const conceptsSampled = concepts.length;
  const labelsInPrompt = [...new Set(concepts.map((c) => c._sample_label))];
  const unrepresented = histogram.filter((h) => !labelsInPrompt.includes(h.label));
  return {
    concepts,
    histogram,
    coverage: {
      concepts_total: conceptsTotal,
      concepts_sampled: conceptsSampled,
      label_count: histogram.length,
      labels_represented: labelsInPrompt.length,
      // Labels absent from the SAMPLE (the distribution still carries them
      // to the LLM, so this is a transparency signal, not a blind spot).
      labels_unrepresented: unrepresented.map((h) => h.label),
      histogram: histogram.slice(0, 24)
    }
  };
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

// 1-8g-m: the mechanical forbidden guard — a suggested forbidden tag whose
// text collides with a subject the corpus DEMONSTRABLY contains is dropped
// before it can be stored. Live failure (Indonesia History): the LLM
// suggested "modern-politics" and "contemporary-culture" while the corpus
// held 133 Politics and 99 Culture concepts — forbidden tags hard-veto
// queries (ROUTE_FORBIDDEN_TAG_MAX), so those two were a live trap for
// legitimate questions about subjects the repo actually answers.
//
// Matching is deliberately CONSERVATIVE: a token of the forbidden tag must
// equal (or contain) a label's normalized token, AND that label must carry
// at least MIN_FORBIDDEN_LABEL_COUNT concepts. "modern-politics" contains
// the label "politics" → dropped. "tourism" (no such label) → kept. This
// is a floor on tag quality, not a curator decision: everything it drops is
// returned to the UI with its reason so the curator can re-add deliberately.
const MIN_FORBIDDEN_LABEL_COUNT = 5;

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function screenForbiddenAgainstCorpus(forbidden, histogram) {
  const present = (histogram || [])
    .filter((h) => h && h.label && h.count >= MIN_FORBIDDEN_LABEL_COUNT)
    .map((h) => ({ label: h.label, count: h.count, tokens: normalizeForMatch(h.label) }));
  const collides = (tagTokens, labelTokens) =>
    tagTokens.some((t) => labelTokens.some((l) => l === t || l.includes(t) || t.includes(l)));
  const kept = [];
  const rejected = [];
  for (const tag of forbidden || []) {
    const tokens = normalizeForMatch(tag);
    if (!tokens.length) continue;
    const hit = present.find((p) => collides(tokens, p.tokens));
    if (hit) {
      rejected.push({ value: tag, label: hit.label, label_count: hit.count });
    } else {
      kept.push(tag);
    }
  }
  return { kept, rejected };
}

// ---------- Public methods ----------

// ---------- suggest jobs (async; David 2026-10-20: "let the fucking thing ---
// think, if it is a thinking model and do the processing async if needed")
//
// A reasoning-required model (live: MiniMax M3.1-Flash burned 5,999 of
// 6,000 tokens thinking over 104 seconds and wrote zero answer chars —
// and the gateway cut the browser off before our own clock expired) can
// never fit inside a synchronous browser request, whatever the axios
// timeout: gateway, proxy and browser each impose their own shorter
// clock. Suggest therefore runs as the Lab's standard 202+poll job: the
// route starts the job, the UI polls, and the model gets minutes, not
// seconds. Jobs are in-memory (single-replica service, same class of
// registry as genInFlight/runInFlight).
const suggestJobs = new Map();
const SUGGEST_JOB_CAP = 100;
const SUGGEST_LLM_TIMEOUT_MS = 300000; // 5 min — thinking models get room

function startSuggestTags(repoId, opts = {}) {
  const id = `sg${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const job = { job_id: id, repo_id: repoId, status: 'running', started_at: new Date().toISOString() };
  suggestJobs.set(id, job);
  // prune oldest finished jobs when the registry grows past the cap
  if (suggestJobs.size > SUGGEST_JOB_CAP) {
    for (const [k, v] of suggestJobs) {
      if (suggestJobs.size <= SUGGEST_JOB_CAP) break;
      if (v.status !== 'running') suggestJobs.delete(k);
    }
  }
  // fire-and-forget worker; every outcome lands ON the job
  (async () => {
    try {
      const suggested = await suggestTags(repoId, { ...opts, llmTimeoutMs: SUGGEST_LLM_TIMEOUT_MS });
      let validation = { validated: true, inconsistencies: [] };
      try {
        validation = await validateFrontmatter(repoId, suggested);
      } catch (e) {
        validation = { validated: false, inconsistencies: [{ reason: 'validation_error', message: e.message }] };
      }
      job.suggested = suggested;
      job.validation = validation;
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.error = e.message || String(e);
    } finally {
      job.finished_at = new Date().toISOString();
    }
  })();
  return job;
}

function getSuggestJob(id) {
  const job = suggestJobs.get(id);
  return job ? { ...job } : null;
}

async function suggestTags(repoId, _opts = {}) {
  return withSpan('okf.frontmatter.suggest', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    const { groups } = await sampleConceptsFromRepo(db, repoId);
    // 1-8g-n: the builder's second arg is the PROMPT BUDGET (chars), not a
    // row count — the row count is now derived from the label surface and
    // this budget, per David's "can we make it dynamic".
    const { concepts, histogram, coverage } = buildSuggestContext(groups, OKF_FRONTMATTER_PROMPT_CHARS);
    if (!concepts.length) {
      // 400 with a clear directive: per-repo tags require at least one
      // concept (curator's authoring). Chunks are NOT a fallback — the
      // spec (2026-10-08) is explicit that tags originate from concept-meta.
      throw new FrontmatterError('NO_CONCEPTS', 'Add at least one concept before requesting tag suggestions.', 400);
    }
    span.setAttribute('okf.sample_size', concepts.length);
    span.setAttribute('okf.concepts_total', coverage.concepts_total);
    span.setAttribute('okf.label_count', coverage.label_count);
    // 1-8g-m: the histogram IS the corpus's real subject surface — hand it
    // to the LLM (bounded to the top 24 labels) so the tag set covers what
    // the corpus actually contains, not what an alphabetical slice showed.
    const distributionText = histogram.length
      ? histogram
          .slice(0, 24)
          .map((h) => `  - ${h.label}: ${h.count} concept${h.count === 1 ? '' : 's'}`)
          .join('\n') + (histogram.length > 24 ? `\n  - (+${histogram.length - 24} further labels)` : '')
      : '';
    const conceptsText = formatConceptsForPrompt(concepts).slice(0, OKF_FRONTMATTER_PROMPT_CHARS);
    const prompt = TAG_PROMPT(concepts.length, conceptsText, distributionText);
    logger.info('frontmatter.suggest.start', {
      repo_id: repoId,
      sample_size: concepts.length,
      concepts_total: coverage.concepts_total,
      label_count: coverage.label_count,
      labels_represented: coverage.labels_represented,
      vllm_host: modelCache.deploymentVllmBase(),
      // The PIN (null when the model is discovered) — the model that
      // actually answered is logged by frontmatter.suggest.done. Its own
      // key: under `model` the start line read "model:null" on the common
      // (discovered) path, which reads like "no model was configured".
      model_pin: modelCache.envPin(),
      prompt_chars: prompt.length
    });
    // maxTokens 1000 was NOT headroom, it was a live failure: on a 586-concept
    // corpus the model looped, spent all 1000 tokens and still returned no
    // closing brace (finish_reason "length"). The prompt now caps each array
    // and forbids repeats; this is the second line of defence for corpora
    // legitimately wider than the ranges above.
    const resp = await vllmChatCompletions([{ role: 'user', content: prompt }], {
      maxTokens: 1500,
      // The async suggest job gives thinking models minutes; every other
      // caller of this shared primitive keeps the default 60s.
      timeoutMs: _opts.llmTimeoutMs
    });
    const content =
      resp.data &&
      resp.data.choices &&
      resp.data.choices[0] &&
      resp.data.choices[0].message &&
      resp.data.choices[0].message.content;
    const finishReason =
      (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].finish_reason) || null;
    // DEBUG (David 2026-10-08: "read the fucking logs and figure out what
    // happened" — suggest returned 0 tags, the log only shows counts, we
    // need the raw LLM content + finish_reason to know whether the model
    // returned empty by design, hit a token cap, or failed silently).
    logger.info('frontmatter.suggest.llm_response', {
      repo_id: repoId,
      content_preview: (content || '').slice(0, 600),
      content_length: (content || '').length,
      finish_reason: finishReason,
      usage: (resp.data && resp.data.usage) || null
    });
    // finish_reason "length" = the model was cut off mid-object. Salvage the
    // values it did finish instead of 502-ing the whole call away.
    const parsed = extractJson(content, { repair: finishReason === 'length' });
    if (!parsed) {
      logger.error('frontmatter.suggest.parse_failed', {
        repo_id: repoId,
        finish_reason: finishReason,
        content_preview: (content || '').slice(0, 200)
      });
      throw new FrontmatterError('LLM_PARSE', 'LLM returned unparseable JSON', 502);
    }
    if (finishReason === 'length') {
      // Honest about the degradation: the surviving fields are valid but the
      // last one written was cut mid-value and dropped.
      logger.warn('frontmatter.suggest.truncated', {
        repo_id: repoId,
        content_length: (content || '').length,
        recovered_fields: Object.keys(parsed),
        note: 'model hit max_tokens mid-object; salvaged the complete values, dropped the partial one'
      });
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
    const forbiddenRaw = uniqTags(
      arr('forbidden', 'forbidden_topics', 'exclusions', 'not_about').map(normalizeTag).filter(Boolean)
    );
    // 1-8g-m: drop forbidden tags the corpus demonstrably CONTAINS. This is
    // mechanical (zero LLM, no embedding) and runs BEFORE anything is
    // stored, so a poisoned veto can never reach the routing gate.
    const screened = screenForbiddenAgainstCorpus(forbiddenRaw, histogram);
    if (screened.rejected.length) {
      logger.warn('frontmatter.suggest.forbidden_rejected', {
        repo_id: repoId,
        rejected: screened.rejected.map((r) => ({ value: r.value, corpus_label: r.label, label_count: r.label_count })),
        kept: screened.kept
      });
    }
    span.setAttribute('okf.forbidden_rejected', screened.rejected.length);
    // Ceilings are the WRITE path's (validators/repository-validator.js
    // TAG_LIMITS). The suggester must respect the same bounds, or it returns
    // payloads the API rejects — and because Joi rejects the whole body, a
    // curator accepting a 22-entity suggestion against a 20 ceiling loses the
    // topics and every accepted entity too. Measured on Bali 2026-10-15.
    //
    // Truncation is NEVER silent: anything dropped is reported in
    // `over_ceiling` with the field, the limit and the values, so the curator
    // can re-add a dropped tag deliberately rather than discover it missing.
    const dropped = [];
    const cap = (list, field) => {
      const limit = TAG_LIMITS[field];
      if (list.length <= limit) return list;
      const kept = list.slice(0, limit);
      dropped.push({ field, limit, kept: kept.length, dropped: list.length - limit, values: list.slice(limit) });
      return kept;
    };
    const clean = (list) => list.filter((t) => t.length <= TAG_LIMITS.tagLength);

    const out = {
      topic: cap(
        clean(
          uniqTags(
            arr('topic', 'topics', 'repo_level_topics', 'topic_set', 'subjects').map(normalizeTag).filter(Boolean)
          )
        ),
        'topic'
      ),
      entity: cap(
        clean(
          uniqTags(
            arr('entity', 'entities', 'named_entities', 'people_products_places').map(normalizeTag).filter(Boolean)
          )
        ),
        'entity'
      ),
      scope: normalizeTag(parsed.scope || parsed.scope_label || parsed.scope_word || parsed.scope_kind),
      forbidden: cap(clean(screened.kept), 'forbidden'),
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 512)
          : typeof parsed.description === 'string'
            ? parsed.description.slice(0, 512)
            : null,
      keyword: cap(
        clean(
          uniqTags(arr('keyword', 'keywords', 'specific_terms', 'low_coverage_terms').map(normalizeTag).filter(Boolean))
        ),
        'keyword'
      )
    };
    if (dropped.length) {
      logger.warn('frontmatter.suggest.over_ceiling', {
        repo_id: repoId,
        dropped: dropped.map((d) => ({ field: d.field, limit: d.limit, kept: d.kept, dropped: d.dropped }))
      });
    }
    out.over_ceiling = dropped;
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
    // 1-8g-m: honesty + transparency the curator needs. Coverage says what
    // the sample was drawn from (so "derived from 21 of 999 concepts" is
    // visible, not implied); forbidden_rejected says which suggestions were
    // dropped and WHY, so a silently-removed tag can be re-added on purpose.
    out.coverage = coverage;
    out.forbidden_rejected = screened.rejected.map((r) => ({
      value: r.value,
      reason: `the corpus contains ${r.label_count} "${r.label}" concepts — forbidding this would veto valid queries`,
      corpus_label: r.label,
      corpus_label_count: r.label_count
    }));
    span.setAttribute('okf.suggested.topic_count', out.topic.length);
    span.setAttribute('okf.suggested.forbidden_count', out.forbidden.length);
    // The model this run actually tagged under — stamped on the response by
    // vllmChatCompletions (no second probe; see the stamp there).
    const taggedWith = resp.model || null;
    logger.info('frontmatter.suggest.done', {
      repo_id: repoId,
      model: taggedWith,
      topic: out.topic.length,
      entity: out.entity.length,
      forbidden: out.forbidden.length,
      forbidden_rejected: screened.rejected.length,
      concepts_sampled: coverage.concepts_sampled,
      concepts_total: coverage.concepts_total
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
          const parsed = extractJson(content, {
            repair:
              (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].finish_reason) ===
              'length'
          });
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
  startSuggestTags,
  getSuggestJob,
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
  readFrontmatterFromRepoDoc,
  // constants (for tests)
  FRONTMATTER_COLLECTION,
  FRONTMATTER_SUMMARY_COLLECTION,
  FIELD_RANGES,
  // 1-8g-m test surface: the label-stratified sampler + the mechanical
  // forbidden guard (both are pure and carry the whole live failure).
  _internals: {
    buildSuggestContext,
    screenForbiddenAgainstCorpus,
    MIN_FORBIDDEN_LABEL_COUNT
  },
  // error class
  FrontmatterError
};
