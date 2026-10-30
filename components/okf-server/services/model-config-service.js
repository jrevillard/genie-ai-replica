// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — named remote-model configurations (David, 2026-10-19):
// "flexible — through a LiteLLM gateway or directly to the specific model
// using any of the APIs; save and activate/deactivate multiple configs;
// when a URL and access token are configured the model must be selectable
// via a dropdown; configs must be nameable, renamable, copyable,
// modifiable, activatable (only one), deactivatable (none active → the
// configured default model) and deletable."
//
// Two provider shapes cover the realistic set:
//   'openai'    — any OpenAI-compatible /v1 surface: OpenAI direct, a LiteLLM
//                 gateway, vLLM, Gemini's compat endpoint, Ollama…
//   'anthropic' — the native Messages API (x-api-key + anthropic-version).
//
// API keys live in Arango, server-side ONLY: every read path returns a
// masked hint (last 4) and never the key. The one active config (at most
// one) overrides the deployment's env-configured judge for the RAGAS legs;
// with none active, RAGAS_JUDGE_* behaves exactly as before.

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { isArangoNotFound } = require('./arango-errors');
const { withSpan } = require('../shared-lib/tracing');
const auditService = require('./audit-service');
const modelCache = require('./vllm-model-cache');

const COLLECTION = 'okf_model_configs';
const PROVIDERS = new Set(['openai', 'anthropic']);
// The features a configuration can serve (David, 2026-10-19: "checkboxes for
// the various services that will be configured to use the selected model";
// 2026-10-20: benchmark answers became a live fourth). Every okf-server
// consumer speaks the OpenAI wire format ONLY — the RAGAS sidecar is the one
// consumer that can also drive an anthropic-provider config
// (langchain-anthropic). The UI disables the incompatible boxes.
const SERVICES = new Set(['ragas_judge', 'okf_curation', 'okf_tagging', 'ragas_answers']);
// Sentinel config_key the panel sends for "System default (environment)" —
// an explicit choice of the env/builtin judge that bypasses the active
// config. Never a real _key (they are mc<timestamp>-<hex>).
const ENV_PICK = '__env__';
const NAME_MAX = 120;
const LIST_TIMEOUT_MS = 15000;
const TEST_TIMEOUT_MS = 20000;

let _collectionEnsured = false;
async function ensureCollection(db) {
  if (_collectionEnsured) return;
  const existing = new Set((await db.listCollections()).map((c) => c.name));
  if (!existing.has(COLLECTION)) {
    try {
      await db.createCollection(COLLECTION);
      logger.info('model_config.collection_created', { name: COLLECTION });
    } catch (e) {
      if (!/conflict|duplicate|exists/i.test(String(e && e.message))) throw e;
    }
  }
  const col = db.collection(COLLECTION);
  const idx = (await col.indexes()).map((i) => i.fields.join(','));
  // Unique name — the rename/copy collision checks are advisory; the index
  // is the enforcement.
  if (!idx.includes('name')) await col.ensureIndex({ type: 'persistent', fields: ['name'], unique: true });
  _collectionEnsured = true;
}

function httpErr(code, status, message, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details) err.details = details;
  return err;
}

/** Strip the key for ANY read path — the UI sees a hint, never the secret.
 *
 * The HINT (the last four characters) is admin-only: the list is readable
 * by every OKF user (the RAGAS judge picker needs it — David 2026-10-25),
 * and a fragment of a deployment-wide provider credential has no business
 * in a curator's session. `includeKeyHint: false` drops it entirely. */
function mask(doc, { includeKeyHint = true } = {}) {
  const key = String(doc.api_key || '');
  return {
    _key: doc._key,
    name: doc.name,
    provider: doc.provider,
    base_url: doc.base_url,
    default_model: doc.default_model || null,
    services: Array.isArray(doc.services) ? doc.services : [],
    active: doc.active === true,
    has_api_key: !!key,
    api_key_hint: key && includeKeyHint ? `••••${key.slice(-4)}` : null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    created_by: doc.created_by || null,
    updated_by: doc.updated_by || null
  };
}

function cleanServices(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw httpErr('VALIDATION_ERROR', 400, 'services must be an array of service keys');
  const out = [];
  for (const s of raw) {
    if (!SERVICES.has(s)) {
      throw httpErr('VALIDATION_ERROR', 400, `unknown service "${s}" — must be one of: ${[...SERVICES].join(', ')}`);
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function validate({ name, provider, base_url, api_key, services }, { partial = false } = {}) {
  const out = {};
  if (!partial || name !== undefined) {
    const n = String(name || '').trim();
    if (!n) throw httpErr('VALIDATION_ERROR', 400, 'name is required');
    if (n.length > NAME_MAX) throw httpErr('VALIDATION_ERROR', 400, `name must be at most ${NAME_MAX} characters`);
    out.name = n;
  }
  if (!partial || provider !== undefined) {
    if (!PROVIDERS.has(provider)) {
      throw httpErr('VALIDATION_ERROR', 400, `provider must be one of: ${[...PROVIDERS].join(', ')}`);
    }
    out.provider = provider;
  }
  if (!partial || base_url !== undefined) {
    const u = String(base_url || '').trim();
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      /* caught below */
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      throw httpErr('VALIDATION_ERROR', 400, 'base_url must be an http(s) URL (e.g. https://api.openai.com/v1)');
    }
    out.base_url = u.replace(/\/+$/, '');
  }
  // Key: required whole on create; on update, absent/empty means KEEP the old
  // one (the UI never echoes it back) — only a non-empty string replaces it.
  if (api_key !== undefined && String(api_key).length > 0) out.api_key = String(api_key);
  else if (!partial) throw httpErr('VALIDATION_ERROR', 400, 'api_key is required');
  out.services = cleanServices(services);
  return out;
}

async function nameTaken(db, name, exceptKey) {
  const rows = await (await db.query(`FOR c IN ${COLLECTION} FILTER c.name == @n RETURN c._key`, { n: name })).all();
  return rows.some((k) => k !== exceptKey);
}

function audit(action, doc, opts, description) {
  return auditService.writeAudit({
    actor: (opts.actor && opts.actor.user_id) || 'system',
    actor_name: (opts.actor && opts.actor.name) || null,
    action: `model_config.${action}`,
    repo_id: 'model-configs',
    description,
    details: { config_key: doc && doc._key, name: doc && doc.name },
    source_ip: opts.source_ip || null
  });
}

async function listConfigs(opts = {}) {
  return withSpan('okf.model_config.list', async () => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const rows = await (await db.query(`FOR c IN ${COLLECTION} SORT c.active DESC, c.name ASC RETURN c`)).all();
    // The env judge rides along so the panel's "System default (environment)"
    // option can NAME the model it resolves to (David 2026-10-24: the default
    // LLM config — the .env RAGAS_JUDGE_* pair — must be selectable, and a
    // default control must never be the only statement of what is in use).
    // base_url + model only — the env key never crosses the wire.
    const envJudge = process.env.RAGAS_JUDGE_BASE_URL
      ? { base_url: process.env.RAGAS_JUDGE_BASE_URL, model: envJudgeModel() }
      : null;
    // The list is readable by every OKF user (the RAGAS judge picker needs
    // it); `opts.includeKeyHint` is false for a caller without tools-admin,
    // so a fragment of a provider credential never reaches a curator.
    return { configs: rows.map((d) => mask(d, opts)), env_judge: envJudge, env_pick: ENV_PICK };
  });
}

async function createConfig(payload = {}, opts = {}) {
  return withSpan('okf.model_config.create', async (span) => {
    const clean = validate(payload);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    if (await nameTaken(db, clean.name))
      throw httpErr('NAME_TAKEN', 409, `a model configuration named "${clean.name}" already exists`);
    const now = new Date().toISOString();
    const doc = {
      _key: `mc${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      name: clean.name,
      provider: clean.provider,
      base_url: clean.base_url,
      api_key: clean.api_key,
      default_model:
        typeof payload.default_model === 'string' && payload.default_model.trim() ? payload.default_model.trim() : null,
      // Unchecked boxes = a dormant config nothing routes to ([] serves no
      // service — what an empty checkbox row shows). New configs default to
      // the flagship consumer so create-activate-judge "just works"; an
      // explicit empty array on create means "I will pick later".
      services: clean.services.length ? clean.services : ['ragas_judge'],
      active: false, // created INACTIVE — activation is an explicit act
      created_at: now,
      updated_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      updated_by: (opts.actor && opts.actor.user_id) || 'system'
    };
    await db.collection(COLLECTION).save(doc);
    span.setAttribute('okf.model_config.name', doc.name);
    await audit('create', doc, opts, `model configuration "${doc.name}" created`);
    return mask(doc);
  });
}

async function loadDoc(db, key) {
  const doc = await db
    .collection(COLLECTION)
    .document(key)
    .catch((e) => {
      if (isArangoNotFound(e)) return null;
      throw e;
    });
  if (!doc) throw httpErr('MODEL_CONFIG_NOT_FOUND', 404, `model configuration ${key} not found`);
  return doc;
}

async function updateConfig(key, payload = {}, opts = {}) {
  return withSpan('okf.model_config.update', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db, key);
    // Validate against the MERGED shape so partial patches type-check; the
    // key is only in the merge when the caller actually sent one (absent →
    // keep the stored key; empty string → also keep, the UI never echoes it).
    const merged = {
      name: payload.name !== undefined ? payload.name : doc.name,
      provider: payload.provider !== undefined ? payload.provider : doc.provider,
      base_url: payload.base_url !== undefined ? payload.base_url : doc.base_url,
      services: payload.services !== undefined ? payload.services : doc.services
    };
    if (payload.api_key !== undefined && String(payload.api_key).length > 0) merged.api_key = payload.api_key;
    const clean = validate(merged, { partial: true });
    if (await nameTaken(db, clean.name, key))
      throw httpErr('NAME_TAKEN', 409, `a model configuration named "${clean.name}" already exists`);
    const patch = {
      ...clean,
      updated_at: new Date().toISOString(),
      updated_by: (opts.actor && opts.actor.user_id) || 'system'
    };
    if (payload.default_model !== undefined) {
      patch.default_model =
        typeof payload.default_model === 'string' && payload.default_model.trim() ? payload.default_model.trim() : null;
    }
    await db.collection(COLLECTION).update(key, patch);
    span.setAttribute('okf.model_config.name', clean.name);
    await audit('update', { _key: key, name: clean.name }, opts, `model configuration "${clean.name}" modified`);
    return mask(await loadDoc(db, key));
  });
}

/** Copy: "Name" → "Copy of Name" (deduped -2, -3…), always INACTIVE, key copied. */
async function copyConfig(key, opts = {}) {
  return withSpan('okf.model_config.copy', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const src = await loadDoc(db, key);
    let name = `Copy of ${src.name}`.slice(0, NAME_MAX);
    let n = 2;
    while (await nameTaken(db, name)) {
      name = `Copy of ${src.name} ${n}`.slice(0, NAME_MAX);
      n += 1;
      if (n > 99) throw httpErr('NAME_TAKEN', 409, 'too many copies of this configuration — rename first');
    }
    const now = new Date().toISOString();
    const doc = {
      _key: `mc${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      name,
      provider: src.provider,
      base_url: src.base_url,
      api_key: src.api_key,
      default_model: src.default_model,
      services: Array.isArray(src.services) ? src.services : [],
      active: false,
      created_at: now,
      updated_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      updated_by: (opts.actor && opts.actor.user_id) || 'system'
    };
    await db.collection(COLLECTION).save(doc);
    span.setAttribute('okf.model_config.name', name);
    await audit('copy', doc, opts, `model configuration "${src.name}" copied as "${name}"`);
    return mask(doc);
  });
}

/** Activate: exactly-one-active — every other config is deactivated first. */
async function activateConfig(key, opts = {}) {
  return withSpan('okf.model_config.activate', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db, key);
    await db.query(`FOR c IN ${COLLECTION} FILTER c.active == true UPDATE c WITH { active: false } IN ${COLLECTION}`);
    await db.collection(COLLECTION).update(key, { active: true, updated_at: new Date().toISOString() });
    span.setAttribute('okf.model_config.name', doc.name);
    await audit('activate', doc, opts, `model configuration "${doc.name}" activated (all others deactivated)`);
    return mask(await loadDoc(db, key));
  });
}

async function deactivateConfig(key, opts = {}) {
  return withSpan('okf.model_config.deactivate', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db, key);
    await db.collection(COLLECTION).update(key, { active: false, updated_at: new Date().toISOString() });
    span.setAttribute('okf.model_config.name', doc.name);
    await audit('deactivate', doc, opts, `model configuration "${doc.name}" deactivated`);
    return mask(await loadDoc(db, key));
  });
}

async function deleteConfig(key, opts = {}) {
  return withSpan('okf.model_config.delete', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db, key);
    await db.collection(COLLECTION).remove(key);
    span.setAttribute('okf.model_config.name', doc.name);
    await audit(
      'delete',
      doc,
      opts,
      `model configuration "${doc.name}" deleted${doc.active ? ' (was active — env default now applies)' : ''}`
    );
    return { deleted: key };
  });
}

/**
 * Shared provider probe: list models at an endpoint with the given creds.
 * OpenAI-compatible bases follow the ONE base-completion rule (llm-url.js):
 * a base that already carries a version segment lists at {base}/models, a
 * bare host at {base}/v1/models — the same rule the chat call uses, so the
 * listing and the chat can never disagree about where /v1 goes. Anthropic's
 * surface is always /v1/models; accept the base with or without the /v1 the
 * user may have typed. One-shot with a hard timeout; throws MODEL_LIST_FAILED
 * with the honest reason.
 */
async function fetchModelList({ provider, base_url, api_key }) {
  const base = String(base_url || '').replace(/\/+$/, '');
  const url =
    provider === 'anthropic' ? `${base.replace(/\/v1$/, '')}/v1/models` : require('./llm-url').openAiModelsUrl(base);
  const headers =
    provider === 'anthropic'
      ? { 'x-api-key': api_key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${api_key}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { headers, signal: ctrl.signal });
  } catch (e) {
    throw httpErr('MODEL_LIST_FAILED', 502, `could not reach ${url}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    let hint = '';
    // The one mismatch users actually hit (live, 2026-10-19: MiniMax's
    // /anthropic base saved under the openai provider): the OpenAI wire
    // does not match that base — it publishes no OpenAI model list (404),
    // or it wants x-api-key instead of a bearer (401; a wrong key must not
    // read like a missing listing, hence the extra hint clause). Either
    // way the base speaks Anthropic and the provider is wrong.
    if ((resp.status === 404 || resp.status === 401) && provider === 'openai' && /\/anthropic\/?$/.test(base)) {
      hint =
        resp.status === 401
          ? ' — this base URL looks like an Anthropic-compatible endpoint: switch the provider to Anthropic (or check the API key)'
          : ' — this base URL looks like an Anthropic-compatible endpoint: switch the provider to Anthropic';
    }
    throw httpErr('MODEL_LIST_FAILED', 502, `model listing returned ${resp.status}: ${body.slice(0, 200)}${hint}`);
  }
  const j = await resp.json().catch(() => null);
  const data = j && (Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : null);
  if (!data) throw httpErr('MODEL_LIST_FAILED', 502, 'endpoint did not return a model list');
  return data
    .map((m) => (typeof m === 'string' ? m : m && (m.id || m.model || m.name)))
    .filter((s) => typeof s === 'string' && s.trim())
    .sort((a, b) => a.localeCompare(b));
}

/** Minimal generation ping — the truest "can I actually use this model". */
async function pingModel({ provider, base_url, api_key, model }) {
  const base = String(base_url || '').replace(/\/+$/, '');
  // The shared URL rule (services/llm-url.js) — the ping and the real calls
  // must never disagree on the path (2026-10-21: a versioned base pinged OK
  // while the benchmark answer leg force-appended /v1 and 404'd every row).
  const url =
    provider === 'anthropic' ? `${base.replace(/\/v1$/, '')}/v1/messages` : require('./llm-url').openAiChatUrl(base);
  const headers =
    provider === 'anthropic'
      ? { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${api_key}`, 'content-type': 'application/json' };
  if (provider !== 'anthropic') {
    // The REAL wire, not a minimal ping (David 2026-10-21: "the connection
    // test works... no 404" while every real call failed): send the same
    // optional params the answer/curation legs send, through the same
    // adaptive negotiation — a passing test now proves the exact shape
    // production uses, and a param the endpoint rejects gets dropped here
    // exactly as it would mid-run.
    try {
      const resp = await require('./adaptive-llm-call').adaptiveChatCompletion({
        url,
        headers,
        body: {
          model,
          max_tokens: 16,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
          response_format: { type: 'json_object' }
        },
        timeoutMs: TEST_TIMEOUT_MS,
        disableThinking: true,
        // A ping must stay a ping: no budget ladder (a thinking model would
        // climb ~7 rungs for tens of minutes with the UI hung). A starved
        // 16-token answer is reported honestly instead.
        disableBudgetLadder: true
      });
      const starved =
        resp &&
        resp.data &&
        resp.data.choices &&
        resp.data.choices[0] &&
        (!resp.data.choices[0].message || !resp.data.choices[0].message.content) &&
        resp.data.usage &&
        resp.data.usage.completion_tokens_details &&
        Number(resp.data.usage.completion_tokens_details.reasoning_tokens) > 0;
      if (starved) {
        return {
          ok: false,
          error:
            'the model spent all 16 ping tokens thinking and wrote nothing — it will starve strict-JSON calls; raise call budgets or pick a model that can answer'
        };
      }
      return { ok: true };
    } catch (e) {
      // Preserve the transport-vs-HTTP distinction testConnection keys on:
      // "could not reach" means the endpoint was never reached (endpoint_ok
      // false); any HTTP status proves it WAS reached.
      if (!e.response) return { ok: false, error: `could not reach ${url}: ${e.message}` };
      const data = e.response.data;
      const text = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : e.message;
      return { ok: false, error: `generation returned ${e.response.status}: ${String(text).slice(0, 200)}` };
    }
  }
  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
  } catch (e) {
    return { ok: false, error: `could not reach ${url}: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `generation returned ${resp.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * LIVE model listing for the config form's dropdown (David: "when a URL and
 * access token are configured, the model must be selectable via a dropdown
 * list"). Runs SERVER-SIDE with the stored key — the key never crosses to
 * the UI. One-shot with a hard timeout; failures surface as an honest error
 * the UI pairs with a free-text fallback.
 */
async function listModels(key) {
  return withSpan('okf.model_config.list_models', async (span) => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db, key);
    const models = await fetchModelList(doc);
    span.setAttribute('okf.model_config.models_n', models.length);
    return { models };
  });
}

/**
 * Preview listing for credentials that are NOT saved yet (David, 2026-10-19:
 * "once the endpoint and the URL are configured, the list of models provided
 * by that service should be available in a dropdown combo"). The create form
 * has no stored key to list against, so the typed credentials make ONE
 * server-side round trip — over HTTPS, used for the listing, never stored or
 * logged. Same honesty as listModels: failures throw, the UI falls back to
 * free text.
 */
async function listModelsPreview(payload = {}) {
  return withSpan('okf.model_config.list_models_preview', async (span) => {
    const provider = payload.provider;
    if (!PROVIDERS.has(provider)) {
      throw httpErr('VALIDATION_ERROR', 400, `provider must be one of: ${[...PROVIDERS].join(', ')}`);
    }
    const u = String(payload.base_url || '').trim();
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      /* caught below */
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      throw httpErr('VALIDATION_ERROR', 400, 'base_url must be an http(s) URL');
    }
    const api_key = String(payload.api_key || '');
    if (!api_key) throw httpErr('VALIDATION_ERROR', 400, 'api_key is required for a preview listing');
    const models = await fetchModelList({ provider, base_url: u, api_key });
    span.setAttribute('okf.model_config.models_n', models.length);
    return { models };
  });
}

/**
 * Connection test (David, 2026-10-19: "the user must have the ability to
 * test the connection to the model before enabling it"; 2026-10-20: "just
 * ping the model not list"). ONE layer: a one-token generation to the
 * selected model over the provider's native wire — the truest end-to-end
 * proof (creds + base + model in a single call). The previous layer-1
 * model LISTING hard-failed providers that generate perfectly but serve
 * no list (live: DeepSeek's Anthropic surface — /anthropic/v1/messages
 * answers 200, /anthropic/v1/models is 404; they split the features).
 * The dropdown combo keeps its listing (with free-text fallback) — the
 * TEST no longer depends on it. No model selected = nothing to test.
 * Credentials resolve as: typed fields win, a saved config key fills the
 * gaps (so the form can test unsaved edits against the stored key, and a
 * table row can test with just {key}). NEVER throws for a probe failure —
 * the diagnostic IS the payload; only programmer errors (bad shape) throw.
 */
async function testConnection(payload = {}) {
  return withSpan('okf.model_config.test', async (span) => {
    let provider = payload.provider;
    let base_url = payload.base_url;
    let api_key = payload.api_key;
    let model = typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : null;
    if (payload.key) {
      const db = await dbService.getConnection();
      await ensureCollection(db);
      const doc = await loadDoc(db, payload.key);
      if (provider === undefined) provider = doc.provider;
      if (base_url === undefined) base_url = doc.base_url;
      if (!api_key) api_key = doc.api_key;
      if (!model) model = doc.default_model || null;
    }
    if (!PROVIDERS.has(provider) || !base_url || !api_key) {
      throw httpErr('VALIDATION_ERROR', 400, 'provider, base_url and api_key (typed or via key) are required');
    }
    if (!model) {
      span.setAttribute('okf.model_config.test_ok', false);
      return {
        ok: false,
        endpoint_ok: null,
        model: null,
        generation_ok: null,
        latency_ms: 0,
        error: 'no model to test — type or pick a model first'
      };
    }
    const t0 = Date.now();
    const ping = await pingModel({ provider, base_url, api_key, model });
    const out = {
      ok: ping.ok,
      // A real HTTP answer (even 401/404) proves the endpoint was REACHED —
      // only transport failures mean "could not reach".
      endpoint_ok: ping.ok || !/could not reach/.test(ping.error || ''),
      model,
      generation_ok: ping.ok,
      latency_ms: Date.now() - t0
    };
    if (!ping.ok) out.error = ping.error;
    span.setAttribute('okf.model_config.test_ok', out.ok);
    span.setAttribute('okf.model_config.test_generation_ok', out.generation_ok === true);
    return out;
  });
}

/**
 * The resolution chain every model-consuming OKF leg shares:
 *   explicit pick (config key + optional model) > THE active config > env.
 * `pick.service` scopes the ACTIVE branch to configs whose services list
 * includes that feature ([] = dormant — serves nothing); an explicit pick
 * is a deliberate operator override and applies regardless of the list.
 * OpenAI-wire-only consumers (curation, tagging) must additionally check
 * `provider === 'openai'` on the result — the RAGAS sidecar speaks both.
 * @returns {{provider:'openai'|'anthropic'|null, base_url, model, api_key,
 *            source:'picked'|'active'|'env', config_key, config_name}|null}
 *          null means "no override — use the env-configured default".
 */
async function resolveModelOverride(pick = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  let doc;
  // ENV_PICK (David 2026-10-24: "RAGAS generation/benchmark must allow the
  // user to choose the default LLM configuration for the system"): the UI's
  // explicit "System default (environment)" choice. Without it, an empty pick
  // means the ACTIVE config — on this deployment GLM-5.3-flash (rate-limited)
  // — and the env-configured judge is unreachable whenever an active config
  // exists. Returning null here sends the sidecar to the env/builtin judge.
  if (pick.config_key === ENV_PICK) return null;
  if (pick.config_key) {
    doc = await loadDoc(db, pick.config_key).catch(() => null);
    if (!doc) throw httpErr('MODEL_CONFIG_NOT_FOUND', 404, `model configuration ${pick.config_key} not found`);
  } else {
    const rows = await (await db.query(`FOR c IN ${COLLECTION} FILTER c.active == true LIMIT 1 RETURN c`)).all();
    doc = rows[0] || null;
    // Service scoping (the checkboxes): an active config only serves the
    // features on its list; [] is dormant. Explicit picks skip this — the
    // operator named the config on purpose.
    if (doc && pick.service && Array.isArray(doc.services) && !doc.services.includes(pick.service)) return null;
  }
  if (!doc) return null;
  return {
    provider: doc.provider,
    base_url: doc.base_url,
    model: (typeof pick.model === 'string' && pick.model.trim()) || doc.default_model || null,
    api_key: doc.api_key,
    source: pick.config_key ? 'picked' : 'active',
    config_key: doc._key,
    config_name: doc.name
  };
}

/** The model the ENV judge runs on — the same name the ragas sidecar
 * judges with: its compose block defaults RAGAS_JUDGE_MODEL to
 * VLLM_LLM_MODEL_ID (the sidecar's judge base IS the deployment). The
 * OKF server receives no judge-model default (the deployment's model name
 * must not be sent to another endpoint), so the record falls back to the
 * deployment pin — the same name. */
function envJudgeModel() {
  const named = (process.env.RAGAS_JUDGE_MODEL || '').trim();
  if (named) return named;
  // The deployment's model name names the judge ONLY when the judge base IS
  // the deployment endpoint — an unset judge base IS that endpoint (the
  // env-judge leg calls the deployment's own one). On another endpoint the
  // served model is DISCOVERED there — the record must not advertise a
  // model that does not answer.
  const base = (process.env.RAGAS_JUDGE_BASE_URL || '').trim();
  if (base && !modelCache.sameOrigin(base, modelCache.deploymentVllmBase())) return null;
  // The same pin the resolution path uses (the LLM spelling first).
  return modelCache.envPin() || null;
}

/** What the run's fidelity block records — name + model, never the key. */
function judgeFidelity(override) {
  if (!override) {
    return {
      source: process.env.RAGAS_JUDGE_BASE_URL ? 'env' : 'builtin-default',
      config: null,
      model: envJudgeModel()
    };
  }
  return { source: override.source, config: override.config_name, model: override.model };
}

module.exports = {
  PROVIDERS,
  SERVICES,
  listConfigs,
  createConfig,
  updateConfig,
  copyConfig,
  activateConfig,
  deactivateConfig,
  deleteConfig,
  listModels,
  listModelsPreview,
  testConnection,
  resolveModelOverride,
  judgeFidelity,
  ensureCollection
};
