// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for the OKF Node model-id discovery helper — the mirror of
// genie-ai-overlay/core/model_cache.py (!631 policy): env pin wins →
// GET {base}/v1/models discovery (TTL cache, stale-serve on probe failure)
// → loud ModelDiscoveryError. axios is mocked; every probe contract
// (URL rule, auth header, timeout, cache windows) is asserted directly.

jest.mock('axios');
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const axios = require('axios');
const { logger } = require('../shared-lib/logger');
const cache = require('../services/vllm-model-cache');

const ENV_KEYS = [
  'VLLM_LLM_MODEL_ID',
  'VLLM_MODEL_ID',
  'VLLM_API_KEY',
  'VLLM_ENDPOINT',
  'MODEL_DETECT_TTL',
  'MODEL_PROBE_TIMEOUT_SECONDS'
];

function modelsPayload(id, extra = {}) {
  return { data: { data: [{ id, ...extra }] } };
}

function mockProbeSuccess(id) {
  axios.get = jest.fn().mockResolvedValue(modelsPayload(id));
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  cache.clearModelCache();
  axios.get = jest.fn();
  jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('env pin precedence (deployer override)', () => {
  test('resolveVllmModelId returns VLLM_MODEL_ID without probing', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/model';
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('pinned/model');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('resolveVllmModelId prefers VLLM_LLM_MODEL_ID over VLLM_MODEL_ID', async () => {
    process.env.VLLM_LLM_MODEL_ID = 'llm-spelling';
    process.env.VLLM_MODEL_ID = 'plain-spelling';
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('llm-spelling');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('whitespace-only pin is treated as unset', async () => {
    process.env.VLLM_MODEL_ID = '   ';
    mockProbeSuccess('served/model');
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('served/model');
  });
});

describe('discovery probe', () => {
  test('bare host gets /v1/models appended', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get).toHaveBeenCalledWith('http://vllm:8000/v1/models', expect.anything());
  });

  test('versioned base keeps its segment and takes /models (no /v1/v1)', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('https://gpu.example.com/llm/v1');
    expect(axios.get).toHaveBeenCalledWith('https://gpu.example.com/llm/v1/models', expect.anything());
  });

  test('sends Authorization Bearer when VLLM_API_KEY is set', async () => {
    process.env.VLLM_API_KEY = 'sk-secret';
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-secret' } })
    );
  });

  test('sends no Authorization header without VLLM_API_KEY', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    const opts = axios.get.mock.calls[0][1];
    expect(opts.headers).toEqual({});
  });

  test('default probe timeout is 10s, overridable via MODEL_PROBE_TIMEOUT_SECONDS', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get.mock.calls[0][1].timeout).toBe(10000);

    cache.clearModelCache();
    process.env.MODEL_PROBE_TIMEOUT_SECONDS = '2.5';
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get.mock.calls[1][1].timeout).toBe(2500);
  });

  test('accepts a string-only model list entry', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: { data: ['served/as-string'] } });
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('served/as-string');
  });
});

describe('TTL cache', () => {
  test('two calls within the TTL trigger a single probe', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    Date.now.mockReturnValue(1_000_000 + 59_000);
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('expired entry is re-probed', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    Date.now.mockReturnValue(1_000_000 + 61_000);
    axios.get = jest.fn().mockResolvedValue(modelsPayload('served/model-v2'));
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('served/model-v2');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('MODEL_DETECT_TTL overrides the window', async () => {
    process.env.MODEL_DETECT_TTL = '1';
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    Date.now.mockReturnValue(1_000_000 + 2_000);
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('failed probe serves the stale cached id instead of throwing', async () => {
    mockProbeSuccess('served/model');
    await cache.resolveVllmModelId('http://vllm:8000');
    Date.now.mockReturnValue(1_000_000 + 61_000);
    axios.get = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    // Mirror of model_cache.py: stale is better than broken — model_id
    // consumers keep retrying (no negative cache, #1127 stays deferred).
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('served/model');
  });
});

describe('failure semantics', () => {
  test('resolveVllmModelId throws ModelDiscoveryError when nothing answers and no pin', async () => {
    axios.get = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(cache.resolveVllmModelId('http://vllm:8000')).rejects.toMatchObject({
      name: 'ModelDiscoveryError',
      message: expect.stringContaining('http://vllm:8000/v1/models')
    });
  });

  test('resolveVllmModelId throws on empty endpoint and no pin', async () => {
    await expect(cache.resolveVllmModelId('')).rejects.toMatchObject({ name: 'ModelDiscoveryError' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('an empty model list counts as a failed probe', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    await expect(cache.resolveVllmModelId('http://vllm:8000')).rejects.toMatchObject({ name: 'ModelDiscoveryError' });
  });

  test('discoverVllmModelId is soft: pin, else discovered, else null — never throws', async () => {
    axios.get = jest.fn().mockRejectedValue(new Error('down'));
    process.env.VLLM_MODEL_ID = 'pinned/model';
    await expect(cache.discoverVllmModelId('http://vllm:8000')).resolves.toBe('pinned/model');

    delete process.env.VLLM_MODEL_ID;
    cache.clearModelCache();
    await expect(cache.discoverVllmModelId('http://vllm:8000')).resolves.toBeNull();
  });

  test('requireServedModelId ignores the pin and demands a served id', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/model';
    mockProbeSuccess('actually-served/model');
    await expect(cache.requireServedModelId('http://vllm:8000')).resolves.toBe('actually-served/model');
    expect(axios.get).toHaveBeenCalled();
  });
});

describe('review round 1 fixes (#1181)', () => {
  test('whitespace-only VLLM_LLM_MODEL_ID does not shadow a valid VLLM_MODEL_ID', async () => {
    process.env.VLLM_LLM_MODEL_ID = '   ';
    process.env.VLLM_MODEL_ID = 'real/model';
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('real/model');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a per-call apiKey overrides the env key on the probe', async () => {
    process.env.VLLM_API_KEY = 'env-key';
    axios.get.mockResolvedValue(modelsPayload('served/model'));
    await cache.requireServedModelId('https://frontier.example/v1', { apiKey: 'fk-3' });
    expect(axios.get).toHaveBeenCalledWith(
      'https://frontier.example/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer fk-3' } })
    );
  });

  test('requireServedModelId error does not suggest the pin (the pin is ignored by design)', async () => {
    axios.get.mockRejectedValue(new Error('401'));
    await expect(cache.requireServedModelId('http://vllm:8000')).rejects.toThrow(/must answer the model-id probe/);
  });

  test('deploymentVllmBase mirrors the chat-path host rule: env endpoint, else the compose service', () => {
    expect(cache.deploymentVllmBase()).toBe('http://vllm:8000');
    process.env.VLLM_ENDPOINT = 'https://gpu.example.com/llm';
    expect(cache.deploymentVllmBase()).toBe('https://gpu.example.com/llm');
  });
});

describe('review round 2 fixes (#1181)', () => {
  beforeEach(() => {
    logger.warn.mockClear();
  });

  test('requireServedModelId NEVER falls back to the env key (foreign base — no deployment-key leak)', async () => {
    process.env.VLLM_API_KEY = 'deployment-secret';
    axios.get.mockResolvedValue(modelsPayload('served/model'));
    await cache.requireServedModelId('https://foreign.example/v1');
    expect(axios.get.mock.calls[0][1].headers).toEqual({}); // no Authorization, ever
  });

  test('requireServedModelId authenticates when an explicit key is given', async () => {
    process.env.VLLM_API_KEY = 'deployment-secret';
    axios.get.mockResolvedValue(modelsPayload('served/model'));
    await cache.requireServedModelId('https://foreign.example/v1', { apiKey: 'fk-own' });
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer fk-own' });
  });

  test('resolveVllmModelId (deployment base) still falls back to the env key', async () => {
    process.env.VLLM_API_KEY = 'deployment-secret';
    axios.get.mockResolvedValue(modelsPayload('served/model'));
    await cache.resolveVllmModelId('http://vllm:8000');
    expect(axios.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer deployment-secret' });
  });

  test('a multi-model endpoint keeps the first entry but WARNS (gateway ambiguity is operator-visible)', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'gateway/first' }, { id: 'gateway/embed' }] } });
    await expect(cache.resolveVllmModelId('http://vllm:8000')).resolves.toBe('gateway/first');
    expect(logger.warn).toHaveBeenCalledWith(
      'vllm_model_cache.multi_model_endpoint',
      expect.objectContaining({ n: 2, chosen: 'gateway/first' })
    );
  });
});

describe('review round 3 fixes (#1181)', () => {
  test('cache entries are keyed by base AND key — different credentials never share a resolution', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { data: [{ id: 'gateway/gpt-x' }] } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'gateway/claude-y' }] } });
    await expect(cache.requireServedModelId('https://gw.example/v1', { apiKey: 'fk-A' })).resolves.toBe(
      'gateway/gpt-x'
    );
    // Same base, different key: the fk-A entry must NOT be served.
    await expect(cache.requireServedModelId('https://gw.example/v1', { apiKey: 'fk-B' })).resolves.toBe(
      'gateway/claude-y'
    );
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('deploymentServedModelId probes the deployment base WITH the deployment key', async () => {
    process.env.VLLM_API_KEY = 'deployment-secret';
    axios.get.mockResolvedValue(modelsPayload('served/deployed-8b'));
    await expect(cache.deploymentServedModelId()).resolves.toBe('served/deployed-8b');
    expect(axios.get).toHaveBeenCalledWith(
      'http://vllm:8000/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer deployment-secret' } })
    );
  });

  test('deploymentServedModelId is soft: null when nothing answers, never throws', async () => {
    axios.get.mockRejectedValue(new Error('401'));
    await expect(cache.deploymentServedModelId()).resolves.toBeNull();
  });
});
