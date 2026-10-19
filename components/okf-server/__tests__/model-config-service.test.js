// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — model-config-service unit tests: the full lifecycle David
// specified (name/rename/copy/modify/activate-one/deactivate-to-env-default/
// delete), key masking on EVERY read path, the resolution chain
// (picked > active > env), and the provider-correct model listing.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn(async () => null) }));

const svc = require('../services/model-config-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const store = () => __mockDb._stores.okf_model_configs || {};

// The service's AQL (name-taken check, listing, activate sweep, resolve)
// dispatched faithfully against the mock store.
function wireQueries() {
  __mockDb.query.mockImplementation(async (aql, bind) => {
    if (aql.includes('FILTER c.name == @n RETURN c._key')) {
      return {
        all: async () =>
          Object.values(store())
            .filter((c) => c.name === bind.n)
            .map((c) => c._key)
      };
    }
    if (aql.includes('SORT c.active DESC, c.name ASC')) {
      const rows = Object.values(store()).sort(
        (a, b) => Number(b.active === true) - Number(a.active === true) || a.name.localeCompare(b.name)
      );
      return { all: async () => rows.map((r) => ({ ...r })) };
    }
    if (aql.includes('FILTER c.active == true LIMIT 1')) {
      const hit = Object.values(store()).find((c) => c.active === true);
      return { all: async () => (hit ? [{ ...hit }] : []) };
    }
    if (aql.includes('UPDATE c WITH { active: false }')) {
      for (const c of Object.values(store())) c.active = false;
      return { all: async () => [] };
    }
    return { all: async () => [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  wireQueries();
});

describe('model-config lifecycle', () => {
  test('create stores the key server-side and every read path MASKS it', async () => {
    const c = await svc.createConfig(
      {
        name: 'Litellm gateway',
        provider: 'openai',
        base_url: 'http://gw:4000/v1/',
        api_key: 'sk-secret-1234',
        default_model: 'gpt-4o'
      },
      { actor: { user_id: 'u1' } }
    );
    expect(c.has_api_key).toBe(true);
    expect(c.api_key_hint).toBe('••••1234');
    expect(c.api_key).toBeUndefined();
    expect(c.active).toBe(false); // created inactive — activation is explicit
    expect(c.base_url).toBe('http://gw:4000/v1'); // trailing slash normalized
    // the STORE holds the real key; the API shapes never do
    const [saved] = Object.values(store());
    expect(saved.api_key).toBe('sk-secret-1234');
    const listed = await svc.listConfigs();
    expect(listed[0].api_key).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain('sk-secret-1234');
  });

  test('duplicate names are rejected (409 NAME_TAKEN)', async () => {
    const base = { provider: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'k' };
    await svc.createConfig({ ...base, name: 'OpenAI direct' }, {});
    await expect(svc.createConfig({ ...base, name: 'OpenAI direct' }, {})).rejects.toMatchObject({
      code: 'NAME_TAKEN',
      status: 409
    });
  });

  test('validation: provider vocabulary + http(s) base_url + key required on create', async () => {
    await expect(
      svc.createConfig({ name: 'x', provider: 'google', base_url: 'https://x', api_key: 'k' }, {})
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(
      svc.createConfig({ name: 'x', provider: 'openai', base_url: 'ftp://x', api_key: 'k' }, {})
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(svc.createConfig({ name: 'x', provider: 'openai', base_url: 'https://x' }, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  test('update renames, replaces the key only when given one, and keeps it otherwise', async () => {
    const c = await svc.createConfig(
      { name: 'A', provider: 'anthropic', base_url: 'https://api.anthropic.com', api_key: 'sk-ant-0001' },
      {}
    );
    const renamed = await svc.updateConfig(c._key, { name: 'Anthropic direct' }, { actor: { user_id: 'u2' } });
    expect(renamed.name).toBe('Anthropic direct');
    expect(store()[c._key].api_key).toBe('sk-ant-0001'); // no api_key in patch → kept
    await svc.updateConfig(c._key, { api_key: 'sk-ant-9999' }, {});
    expect(store()[c._key].api_key).toBe('sk-ant-9999');
    expect((await svc.listConfigs())[0].api_key).toBeUndefined();
  });

  test('copy duplicates name-deduped and always INACTIVE with the same key', async () => {
    const c = await svc.createConfig(
      { name: 'Frontier', provider: 'openai', base_url: 'https://gw:4000/v1', api_key: 'kk', default_model: 'm1' },
      {}
    );
    await svc.activateConfig(c._key, {});
    const copy = await svc.copyConfig(c._key, {});
    expect(copy.name).toBe('Copy of Frontier');
    expect(copy.active).toBe(false); // never copies the active flag
    expect(store()[copy._key].api_key).toBe('kk');
    const copy2 = await svc.copyConfig(c._key, {});
    expect(copy2.name).toBe('Copy of Frontier 2');
  });

  test('activate is exactly-one-active; deactivate-to-zero falls back to env', async () => {
    const a = await svc.createConfig({ name: 'A', provider: 'openai', base_url: 'https://a/v1', api_key: 'k' }, {});
    const b = await svc.createConfig({ name: 'B', provider: 'openai', base_url: 'https://b/v1', api_key: 'k' }, {});
    await svc.activateConfig(a._key, {});
    expect(store()[a._key].active).toBe(true);
    await svc.activateConfig(b._key, {});
    expect(store()[b._key].active).toBe(true);
    expect(store()[a._key].active).toBe(false); // swept by activate
    const viaResolve = await svc.resolveModelOverride({});
    expect(viaResolve.config_key).toBe(b._key);
    await svc.deactivateConfig(b._key, {});
    expect(await svc.resolveModelOverride({})).toBeNull(); // none active → env default
  });

  test('delete removes the config', async () => {
    const c = await svc.createConfig({ name: 'gone', provider: 'openai', base_url: 'https://x/v1', api_key: 'k' }, {});
    await svc.deleteConfig(c._key, {});
    await expect(svc.resolveModelOverride({ config_key: c._key })).rejects.toMatchObject({
      code: 'MODEL_CONFIG_NOT_FOUND'
    });
  });
});

describe('model listing (the config-form dropdown)', () => {
  test('openai-compatible: Bearer auth against {base}/models, sorted ids', async () => {
    const c = await svc.createConfig(
      { name: 'gw', provider: 'openai', base_url: 'https://gw:4000/v1', api_key: 'sk-list' },
      {}
    );
    global.fetch = jest.fn(async (url, opts) => {
      expect(url).toBe('https://gw:4000/v1/models');
      expect(opts.headers.Authorization).toBe('Bearer sk-list');
      return { ok: true, json: async () => ({ data: [{ id: 'z-model' }, { id: 'a-model' }] }) };
    });
    const { models } = await svc.listModels(c._key);
    expect(models).toEqual(['a-model', 'z-model']);
  });

  test('anthropic: x-api-key + version header, /v1 normalized onto the path', async () => {
    const c = await svc.createConfig(
      { name: 'ant', provider: 'anthropic', base_url: 'https://api.anthropic.com/v1', api_key: 'sk-ant-1' },
      {}
    );
    global.fetch = jest.fn(async (url, opts) => {
      expect(url).toBe('https://api.anthropic.com/v1/models');
      expect(opts.headers['x-api-key']).toBe('sk-ant-1');
      expect(opts.headers['anthropic-version']).toBe('2023-06-01');
      return { ok: true, json: async () => ({ data: [{ id: 'claude-x' }] }) };
    });
    const { models } = await svc.listModels(c._key);
    expect(models).toEqual(['claude-x']);
  });

  test('listing failures are honest 502s (the UI offers free-text fallback)', async () => {
    const c = await svc.createConfig({ name: 'bad', provider: 'openai', base_url: 'https://x/v1', api_key: 'k' }, {});
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }));
    await expect(svc.listModels(c._key)).rejects.toMatchObject({ code: 'MODEL_LIST_FAILED', status: 502 });
  });
});

describe('preview listing (unsaved credentials — the create-form dropdown)', () => {
  test('lists with TYPED creds before any save: Bearer against {base}/models, key never persisted', async () => {
    global.fetch = jest.fn(async (url, opts) => {
      expect(url).toBe('https://typed-gw:4000/v1/models');
      expect(opts.headers.Authorization).toBe('Bearer sk-typed');
      return { ok: true, json: async () => ({ data: [{ id: 'm1' }, { id: 'm0' }] }) };
    });
    const { models } = await svc.listModelsPreview({
      provider: 'openai',
      base_url: 'https://typed-gw:4000/v1',
      api_key: 'sk-typed'
    });
    expect(models).toEqual(['m0', 'm1']);
    expect(store()).toEqual({}); // nothing saved — preview is side-effect free
  });

  test('shape errors throw 400 before any network call', async () => {
    global.fetch = jest.fn();
    await expect(
      svc.listModelsPreview({ provider: 'nope', base_url: 'https://x', api_key: 'k' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(
      svc.listModelsPreview({ provider: 'openai', base_url: 'not-a-url', api_key: 'k' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(svc.listModelsPreview({ provider: 'openai', base_url: 'https://x' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('connection test (before enabling)', () => {
  test('happy path: endpoint proven, model listed, one-token generation ping OK', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'gpt-x' }] }) };
      }
      expect(url).toBe('https://gw:4000/v1/chat/completions');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer kt');
      expect(JSON.parse(opts.body)).toMatchObject({ model: 'gpt-x', max_tokens: 1 });
      return { ok: true, json: async () => ({ choices: [] }) };
    });
    const r = await svc.testConnection({
      provider: 'openai',
      base_url: 'https://gw:4000/v1',
      api_key: 'kt',
      model: 'gpt-x'
    });
    expect(r).toMatchObject({ ok: true, endpoint_ok: true, model_listed: true, generation_ok: true, models_n: 1 });
    expect(typeof r.latency_ms).toBe('number');
    expect(calls).toHaveLength(2);
  });

  test('anthropic ping goes to /v1/messages with x-api-key; typed creds can override a saved key', async () => {
    const c = await svc.createConfig(
      {
        name: 'ant',
        provider: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-old',
        default_model: 'claude-x'
      },
      {}
    );
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push(url);
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'claude-x' }] }) };
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(opts.headers['x-api-key']).toBe('sk-ant-new'); // typed key wins over stored
      return { ok: true, json: async () => ({ content: [] }) };
    });
    const r = await svc.testConnection({ key: c._key, api_key: 'sk-ant-new' });
    expect(r).toMatchObject({ ok: true, generation_ok: true, model: 'claude-x' }); // model fell back to default_model
    expect(calls).toEqual(['https://api.anthropic.com/v1/models', 'https://api.anthropic.com/v1/messages']);
  });

  test('endpoint unreachable: diagnostic payload, NOT a throw — ok false, error set, downstream layers null', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
    const r = await svc.testConnection({ provider: 'openai', base_url: 'https://x/v1', api_key: 'k', model: 'm' });
    expect(r).toMatchObject({ ok: false, endpoint_ok: false, generation_ok: null, model_listed: null });
    expect(r.error).toContain('401');
  });

  test('model missing from the list still attempts the generation (gateways alias names) and reports both', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'other' }] }) };
      return { ok: false, status: 404, text: async () => 'model not found' };
    });
    const r = await svc.testConnection({ provider: 'openai', base_url: 'https://x/v1', api_key: 'k', model: 'ghost' });
    expect(r).toMatchObject({ ok: false, endpoint_ok: true, model_listed: false, generation_ok: false });
    expect(r.error).toContain('404');
  });

  test('no model selected: endpoint + credentials proven, generation skipped (null)', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'm' }] }) }));
    const r = await svc.testConnection({ provider: 'openai', base_url: 'https://x/v1', api_key: 'k' });
    expect(r).toMatchObject({ ok: true, endpoint_ok: true, generation_ok: null, model: null });
  });

  test('shape errors still throw 400', async () => {
    global.fetch = jest.fn();
    await expect(svc.testConnection({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(svc.testConnection({ key: 'nope' })).rejects.toMatchObject({ code: 'MODEL_CONFIG_NOT_FOUND' });
  });

  test('the MiniMax mismatch names itself: openai provider + /anthropic base → hint to switch provider', async () => {
    // The live incident (2026-10-19): base https://api.minimax.io/anthropic
    // saved under provider 'openai' lists at /anthropic/models → 404.
    global.fetch = jest.fn(async (url) => {
      expect(url).toBe('https://api.minimax.io/anthropic/models');
      return { ok: false, status: 404, text: async () => '404 page not found' };
    });
    await expect(
      svc.listModelsPreview({ provider: 'openai', base_url: 'https://api.minimax.io/anthropic', api_key: 'k' })
    ).rejects.toThrow(/switch the provider to Anthropic/);
    // A plain 404 on an ordinary base carries NO hint.
    await expect(
      svc.listModelsPreview({ provider: 'openai', base_url: 'https://x.io/v1', api_key: 'k' })
    ).rejects.not.toThrow(/switch the provider/);
  });
});

describe('resolution chain (picked > active > env) + fidelity', () => {
  test('picked config with explicit model beats the active one; model falls back to default_model', async () => {
    const active = await svc.createConfig(
      { name: 'active one', provider: 'openai', base_url: 'https://a/v1', api_key: 'ka', default_model: 'am' },
      {}
    );
    await svc.activateConfig(active._key, {});
    const picked = await svc.createConfig(
      { name: 'picked one', provider: 'anthropic', base_url: 'https://p', api_key: 'kp', default_model: 'pd' },
      {}
    );
    const viaPick = await svc.resolveModelOverride({ config_key: picked._key, model: 'explicit' });
    expect(viaPick.source).toBe('picked');
    expect(viaPick.model).toBe('explicit');
    expect(viaPick.provider).toBe('anthropic');
    const viaActive = await svc.resolveModelOverride({ config_key: picked._key });
    expect(viaActive.model).toBe('pd'); // falls back to the config's default
    expect(svc.judgeFidelity(viaActive)).toEqual({ source: 'picked', config: 'picked one', model: 'pd' });
    expect(svc.judgeFidelity(null).source).toMatch(/env|builtin-default/);
  });
});
