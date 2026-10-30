// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Controller-surface coverage for model-config-controller (Story 8-7): every
// handler's status code, service passthrough (actor + source_ip) and the
// next(err) contract. Policy lives in the service — these tests pin the THIN
// layer only, including the admin-only key hint on list.

jest.mock('../services/model-config-service', () => ({
  listConfigs: jest.fn(),
  createConfig: jest.fn(),
  updateConfig: jest.fn(),
  copyConfig: jest.fn(),
  activateConfig: jest.fn(),
  deactivateConfig: jest.fn(),
  deleteConfig: jest.fn(),
  listModels: jest.fn(),
  listModelsPreview: jest.fn(),
  testConnection: jest.fn()
}));

const svc = require('../services/model-config-service');
const ctrl = require('../controllers/model-config-controller');

const fakeReq = (patch = {}) => ({
  body: undefined,
  params: {},
  query: {},
  ip: '9.9.9.9',
  user: { sub: 'user-1', preferred_username: 'alice', realm_access: { roles: ['tools-admin'] } },
  ...patch
});

const fakeRes = () => {
  const res = { statusCode: 0, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('model-config-controller surface', () => {
  it('list: any OKF user may read; the key hint rides only tools-admin', async () => {
    svc.listConfigs.mockResolvedValueOnce({ configs: [], env_judge: null, env_pick: null });
    const res = fakeRes();
    await ctrl.list(fakeReq(), res, jest.fn());
    expect(res.statusCode).toBe(200);
    expect(svc.listConfigs).toHaveBeenCalledWith({ includeKeyHint: true });

    svc.listConfigs.mockResolvedValueOnce({ configs: [] });
    const plain = fakeReq({ user: { sub: 'u2', realm_access: { roles: ['okf-user'] } } });
    await ctrl.list(plain, fakeRes(), jest.fn());
    expect(svc.listConfigs).toHaveBeenLastCalledWith({ includeKeyHint: false });

    // no user at all (internal call) → still readable, no hint
    svc.listConfigs.mockResolvedValueOnce({ configs: [] });
    await ctrl.list(fakeReq({ user: undefined }), fakeRes(), jest.fn());
    expect(svc.listConfigs).toHaveBeenLastCalledWith({ includeKeyHint: false });
  });

  it('create → 201 with actor + source_ip; update → 200 on the key param', async () => {
    svc.createConfig.mockResolvedValueOnce({ key: 'k' });
    const res = fakeRes();
    await ctrl.create(fakeReq({ body: { provider: 'z' } }), res, jest.fn());
    expect(res.statusCode).toBe(201);
    expect(svc.createConfig).toHaveBeenCalledWith(
      { provider: 'z' },
      { actor: { user_id: 'user-1', name: 'alice' }, source_ip: '9.9.9.9' }
    );

    svc.updateConfig.mockResolvedValueOnce({ key: 'k' });
    const res2 = fakeRes();
    await ctrl.update(fakeReq({ params: { key: 'k' }, body: { label: 'L' } }), res2, jest.fn());
    expect(res2.statusCode).toBe(200);
    expect(svc.updateConfig).toHaveBeenCalledWith(
      'k',
      { label: 'L' },
      { actor: { user_id: 'user-1', name: 'alice' }, source_ip: '9.9.9.9' }
    );
  });

  it('copy → 201; activate/deactivate/remove → 200, all keyed on req.params.key', async () => {
    const actor = { actor: { user_id: 'user-1', name: 'alice' }, source_ip: '9.9.9.9' };
    svc.copyConfig.mockResolvedValueOnce({ key: 'k2' });
    const r1 = fakeRes();
    await ctrl.copy(fakeReq({ params: { key: 'k' } }), r1, jest.fn());
    expect(r1.statusCode).toBe(201);
    expect(svc.copyConfig).toHaveBeenCalledWith('k', actor);

    svc.activateConfig.mockResolvedValueOnce({});
    const r2 = fakeRes();
    await ctrl.activate(fakeReq({ params: { key: 'k' } }), r2, jest.fn());
    expect(r2.statusCode).toBe(200);
    expect(svc.activateConfig).toHaveBeenCalledWith('k', actor);

    svc.deactivateConfig.mockResolvedValueOnce({});
    const r3 = fakeRes();
    await ctrl.deactivate(fakeReq({ params: { key: 'k' } }), r3, jest.fn());
    expect(r3.statusCode).toBe(200);

    svc.deleteConfig.mockResolvedValueOnce({ ok: true });
    const r4 = fakeRes();
    await ctrl.remove(fakeReq({ params: { key: 'k' } }), r4, jest.fn());
    expect(r4.statusCode).toBe(200);
    expect(svc.deleteConfig).toHaveBeenCalledWith('k', actor);
  });

  it('models / modelsPreview / test pass the payload through with 200', async () => {
    svc.listModels.mockResolvedValueOnce(['m1']);
    const r1 = fakeRes();
    await ctrl.models(fakeReq({ params: { key: 'k' } }), r1, jest.fn());
    expect(r1.statusCode).toBe(200);
    expect(svc.listModels).toHaveBeenCalledWith('k');

    svc.listModelsPreview.mockResolvedValueOnce(['m2']);
    const r2 = fakeRes();
    await ctrl.modelsPreview(fakeReq({ body: { provider: 'z', api_key: 'once' } }), r2, jest.fn());
    expect(r2.statusCode).toBe(200);
    expect(svc.listModelsPreview).toHaveBeenCalledWith({ provider: 'z', api_key: 'once' });

    svc.testConnection.mockResolvedValueOnce({ ok: true, latency_ms: 40 });
    const r3 = fakeRes();
    await ctrl.test(fakeReq({ body: { provider: 'z' } }), r3, jest.fn());
    expect(r3.statusCode).toBe(200);
    expect(svc.testConnection).toHaveBeenCalledWith({ provider: 'z' });
  });

  it('every handler routes a service throw to next(err) without a body', async () => {
    const boom = new Error('dup key');
    const handlers = [
      [ctrl.list, svc.listConfigs],
      [ctrl.create, svc.createConfig],
      [ctrl.update, svc.updateConfig],
      [ctrl.copy, svc.copyConfig],
      [ctrl.activate, svc.activateConfig],
      [ctrl.deactivate, svc.deactivateConfig],
      [ctrl.remove, svc.deleteConfig],
      [ctrl.models, svc.listModels],
      [ctrl.modelsPreview, svc.listModelsPreview],
      [ctrl.test, svc.testConnection]
    ];
    for (const [handler, fn] of handlers) {
      fn.mockRejectedValueOnce(boom);
      const next = jest.fn();
      const res = fakeRes();

      await handler(fakeReq({ params: { key: 'k' }, body: {} }), res, next);
      expect(next).toHaveBeenCalledWith(boom);
      expect(res.body).toBeUndefined();
    }
  });
});
