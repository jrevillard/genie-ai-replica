'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });
jest.mock('xlsx', () => ({ readFile: jest.fn() }), { virtual: true });

/**
 * Verifies that:
 * 1. rebuildAllEndpoints serialises concurrent rebuilds per key — cache.set
 *    is called at most once per key even when two rebuilds race.
 * 2. Empty envelopes with no LKG fallback do NOT trigger cache.set.
 */

describe('rebuildAllEndpoints single-flight + empty-no-LKG skip', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  // ── helper: build a fully-wired service instance ───────────────────────────
  function makeSvc(overrides = {}) {
    let AgriService;
    jest.isolateModules(() => {
      AgriService = require('../../../services/agri/agri-service');
    });
    const svc = new AgriService();
    svc.cache = {
      get: jest.fn(async () => ({ envelope: null, origin: null })),
      set: jest.fn(async () => {}),
      ...overrides.cache
    };
    svc.buildCropHealth =
      overrides.buildCropHealth ||
      jest.fn(async () => ({
        meta: { source: 'stub' },
        data: { departments: [{ id: 'd1' }] }
      }));
    svc.buildPestAlerts =
      overrides.buildPestAlerts ||
      jest.fn(async () => ({
        meta: { source: 'stub' },
        data: { items: [] }
      }));
    svc.buildNews =
      overrides.buildNews ||
      jest.fn(async () => ({
        meta: { source: 'stub' },
        data: { items: [] }
      }));
    svc.buildMarketPrices =
      overrides.buildMarketPrices ||
      jest.fn(async () => ({
        meta: { source: 'stub' },
        data: { series: [] }
      }));
    svc.endpointTtlMs = jest.fn(() => 300_000);
    svc._rebuildInFlight = null;
    return svc;
  }

  test('cache.set called exactly once per key when two rebuilds race', async () => {
    const svc = makeSvc();
    const setSpy = jest.spyOn(svc.cache, 'set');

    await Promise.all([svc.rebuildAllEndpoints(), svc.rebuildAllEndpoints()]);

    const callsByKey = {};
    for (const [key] of setSpy.mock.calls) {
      if (!callsByKey[key]) callsByKey[key] = 0;
      callsByKey[key]++;
    }
    for (const [key, count] of Object.entries(callsByKey)) {
      (expect(count).toBe(1), `key ${key} had ${count} cache.set calls, expected 1`);
    }
  });

  test('empty envelope with no LKG does NOT call cache.set', async () => {
    // isEmptyEnvelope treats departments:[] as empty.
    const svc = makeSvc({
      cache: {
        get: jest.fn(async () => ({ envelope: null, origin: null }))
      },
      buildCropHealth: jest.fn(async () => ({
        meta: { source: 'empty-stub' },
        data: { departments: [] } // recognised as empty by isEmptyEnvelope
      }))
    });
    const setSpy = jest.spyOn(svc.cache, 'set');

    await svc.rebuildAllEndpoints();

    const cropHealthSetCalls = setSpy.mock.calls.filter(([key]) => key === 'crop-health');
    expect(cropHealthSetCalls).toHaveLength(0);
  });

  test('empty envelope WITH existing LKG keeps cached value and skips set', async () => {
    const goodEnvelope = { meta: { source: 'lkg' }, data: { departments: [{ id: 'd1' }] } };
    const svc = makeSvc({
      cache: {
        get: jest.fn(async (key) => {
          if (key === 'crop-health') return { envelope: goodEnvelope, origin: 'arango' };
          return { envelope: null, origin: null };
        })
      },
      buildCropHealth: jest.fn(async () => ({
        meta: { source: 'empty-stub' },
        data: { departments: [] } // recognised as empty by isEmptyEnvelope
      }))
    });
    const setSpy = jest.spyOn(svc.cache, 'set');

    await svc.rebuildAllEndpoints();

    const cropHealthSetCalls = setSpy.mock.calls.filter(([key]) => key === 'crop-health');
    expect(cropHealthSetCalls).toHaveLength(0);
  });
});
