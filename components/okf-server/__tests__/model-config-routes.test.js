// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// HTTP-layer tests for the model-configuration routes.
//
// David 2026-10-25: the model selection was GONE from the RAGAS surfaces
// for anyone without the tools-admin role. The list endpoint was behind
// `router.use(requireRole('tools-admin'))`, the frontend renders the judge
// dropdown only when the list is non-empty, and the list 403'd — so a
// curator had no judge picker at all, and the .env default judge was not
// even an option. The READ is now open to every OKF user; every WRITE and
// every credential-bearing probe stays tools-admin.
//
// Pattern: __tests__/retrieval-config-routes.test.js

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../services/model-config-service');

const request = require('supertest');
const { createApp } = require('../index');
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const modelConfigService = require('../services/model-config-service');

const TOKEN = 'Bearer test-token';
const ENV_JUDGE = {
  base_url: 'https://ai.assembly.govstack.global:444/llm/v1',
  model: 'ibm-granite/granite-4.1-8b'
};

/** A caller with the tools-admin bootstrap super-role. */
function authAdmin() {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    realm_access: { roles: ['tools-admin'] }
  });
}

/** A scoped curator — NO tools-admin. This is the caller the fix is for.
 * Scope grammar: okf:{tenant}:{repo}:{read|admin}. */
function authCurator() {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'chat-user-1',
    preferred_username: 'chatter',
    okf_scopes: ['okf:itu:*:read'],
    realm_access: { roles: ['user'] }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  modelConfigService.listConfigs.mockResolvedValue({
    configs: [{ _key: 'mc1', name: 'GLM-5.3 Flash ITU - OpenAI', active: true, api_key_hint: '••••abcd' }],
    env_judge: ENV_JUDGE,
    env_pick: '__env__'
  });
});

describe('GET /api/okf/model-configs — the read is open to every OKF user', () => {
  it('answers a scoped curator who is NOT tools-admin', async () => {
    authCurator();
    const res = await request(createApp()).get('/api/okf/model-configs').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    // The envelope the judge picker needs: the env judge and its pick key.
    expect(res.body.env_judge).toEqual(ENV_JUDGE);
    expect(res.body.env_pick).toBe('__env__');
  });

  it('answers an admin too', async () => {
    authAdmin();
    const res = await request(createApp()).get('/api/okf/model-configs').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.env_judge).toEqual(ENV_JUDGE);
  });

  it('asks the service for the key HINT only for an admin', async () => {
    authCurator();
    await request(createApp()).get('/api/okf/model-configs').set('Authorization', TOKEN);
    expect(modelConfigService.listConfigs).toHaveBeenCalledWith({ includeKeyHint: false });

    jest.clearAllMocks();
    modelConfigService.listConfigs.mockResolvedValue({ configs: [], env_judge: ENV_JUDGE, env_pick: '__env__' });
    authAdmin();
    await request(createApp()).get('/api/okf/model-configs').set('Authorization', TOKEN);
    expect(modelConfigService.listConfigs).toHaveBeenCalledWith({ includeKeyHint: true });
  });
});

describe('every write and credential-bearing probe stays tools-admin', () => {
  const CASES = [
    ['post', '/api/okf/model-configs'],
    ['post', '/api/okf/model-configs/models-preview'],
    ['post', '/api/okf/model-configs/test'],
    ['post', '/api/okf/model-configs/mc1/copy'],
    ['post', '/api/okf/model-configs/mc1/activate'],
    ['post', '/api/okf/model-configs/mc1/deactivate'],
    ['patch', '/api/okf/model-configs/mc1'],
    ['delete', '/api/okf/model-configs/mc1'],
    ['get', '/api/okf/model-configs/mc1/models']
  ];

  it.each(CASES)('%s %s is refused for a caller without tools-admin', async (method, path) => {
    authCurator();
    const res = await request(createApp())[method](path).set('Authorization', TOKEN).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_ROLE');
  });
});
