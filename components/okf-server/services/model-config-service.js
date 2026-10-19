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
const { withSpan } = require('../shared-lib/tracing');
const auditService = require('./audit-service');

const COLLECTION = 'okf_model_configs';
const PROVIDERS = new Set(['openai', 'anthropic']);
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

/** Strip the key for ANY read path — the UI sees a hint, never the secret. */
function mask(doc) {
  const key = String(doc.api_key || '');
  return {
    _key: doc._key,
    name: doc.name,
    provider: doc.provider,
    base_url: doc.base_url,
    default_model: doc.default_model || null,
    active: doc.active === true,
    has_api_key: !!key,
    api_key_hint: key ? `••••${key.slice(-4)}` : null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    created_by: doc.created_by || null,
    updated_by: doc.updated_by || null
  };
}

function validate({ name, provider, base_url, api_key }, { partial = false } = {}) {
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

async function listConfigs() {
  return withSpan('okf.model_config.list', async () => {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const rows = await (await db.query(`FOR c IN ${COLLECTION} SORT c.active DESC, c.name ASC RETURN c`)).all();
    return rows.map(mask);
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
      if (e && (e.code === 404 || e.statusCode === 404 || /not found/i.test(e.message || ''))) return null;
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
      base_url: payload.base_url !== undefined ? payload.base_url : doc.base_url
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
 * OpenAI-compatible bases carry their own prefix (…/v1) — list at
 * {base}/models. Anthropic's surface is always /v1/models; accept the base
 * with or without the /v1 the user may have typed. One-shot with a hard
 * timeout; throws MODEL_LIST_FAILED with the honest reason.
 */
async function fetchModelList({ provider, base_url, api_key }) {
  const base = String(base_url || '').replace(/\/+$/, '');
  const url = provider === 'anthropic' ? `${base.replace(/\/v1$/, '')}/v1/models` : `${base}/models`;
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
    // /anthropic base saved under the openai provider): an OpenAI-style
    // listing against an Anthropic-compatible base 404s because that base
    // serves /v1/models, not /models.
    if (resp.status === 404 && provider === 'openai' && /\/anthropic\/?$/.test(base)) {
      hint = ' — this base URL looks like an Anthropic-compatible endpoint: switch the provider to Anthropic';
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
  const url = provider === 'anthropic' ? `${base.replace(/\/v1$/, '')}/v1/messages` : `${base}/chat/completions`;
  const headers =
    provider === 'anthropic'
      ? { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${api_key}`, 'content-type': 'application/json' };
  const body =
    provider === 'anthropic'
      ? JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
      : JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
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
 * test the connection to the model before enabling it"). Two layers, both
 * reported honestly so the UI can say WHERE it broke:
 *   1. endpoint + credentials — the model listing (auth-level proof);
 *   2. the chosen model — a one-token generation ping.
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
    const t0 = Date.now();
    let models;
    try {
      models = await fetchModelList({ provider, base_url, api_key });
    } catch (e) {
      span.setAttribute('okf.model_config.test_ok', false);
      return {
        ok: false,
        endpoint_ok: false,
        models_n: null,
        model: model || null,
        model_listed: null,
        generation_ok: null,
        latency_ms: Date.now() - t0,
        error: e.message
      };
    }
    const base = {
      ok: true,
      endpoint_ok: true,
      models_n: models.length,
      model: model || null,
      model_listed: model ? models.includes(model) : null,
      generation_ok: null,
      latency_ms: Date.now() - t0
    };
    if (!model) return base; // endpoint + creds proven; nothing selected to ping
    const ping = await pingModel({ provider, base_url, api_key, model });
    base.generation_ok = ping.ok;
    base.ok = ping.ok;
    base.latency_ms = Date.now() - t0;
    if (!ping.ok) base.error = ping.error;
    span.setAttribute('okf.model_config.test_ok', base.ok);
    span.setAttribute('okf.model_config.test_generation_ok', base.generation_ok === true);
    return base;
  });
}

/**
 * The resolution chain every model-consuming OKF leg shares:
 *   explicit pick (config key + optional model) > THE active config > env.
 * @returns {{provider:'openai'|'anthropic'|null, base_url, model, api_key,
 *            source:'picked'|'active'|'env', config_key, config_name}|null}
 *          null means "no override — use the env-configured default".
 */
async function resolveModelOverride(pick = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  let doc;
  if (pick.config_key) {
    doc = await loadDoc(db, pick.config_key).catch(() => null);
    if (!doc) throw httpErr('MODEL_CONFIG_NOT_FOUND', 404, `model configuration ${pick.config_key} not found`);
  } else {
    const rows = await (await db.query(`FOR c IN ${COLLECTION} FILTER c.active == true LIMIT 1 RETURN c`)).all();
    doc = rows[0] || null;
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

/** What the run's fidelity block records — name + model, never the key. */
function judgeFidelity(override) {
  if (!override) {
    return {
      source: process.env.RAGAS_JUDGE_BASE_URL ? 'env' : 'builtin-default',
      config: null,
      model: process.env.RAGAS_JUDGE_MODEL || null
    };
  }
  return { source: override.source, config: override.config_name, model: override.model };
}

module.exports = {
  PROVIDERS,
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
