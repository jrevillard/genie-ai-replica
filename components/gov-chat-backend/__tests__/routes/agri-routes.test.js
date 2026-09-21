'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak middleware so routes are testable without tokens
jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: (req, res, next) => {
      req.user = { iss_sub: 'test-user' };
      next();
    }
  }
}));

const express = require('express');
const request = require('supertest');
const createAgriRouter = require('../../routes/agri-routes');

/** Stub AgriService — routes only need these methods. */
function stubService(overrides = {}) {
  return {
    getCropHealth: jest.fn().mockResolvedValue({
      data: { departments: [{ name: 'San Salvador', ndvi: 0.72, health: 'good' }] },
      meta: { fetchedAt: new Date().toISOString(), source: 'WFP VAM via HDX', stale: false, caveats: [] }
    }),
    getPestAlerts: jest.fn().mockResolvedValue({
      data: { advisories: [], regional: [], sightings: [] },
      meta: { fetchedAt: new Date().toISOString(), source: 'curated', stale: false, caveats: [] }
    }),
    getMarketPrices: jest.fn().mockImplementation((category) =>
      category === 'maize'
        ? {
            data: {
              title: 'Maize & Basic Grains',
              unit: 'USD/quintal (46 kg)',
              series: [],
              trend: 'stable',
              latest: 26.61
            },
            meta: {
              fetchedAt: new Date().toISOString(),
              source: 'GENIE.AI agri service',
              stale: false,
              caveats: [{ code: 'SINGLE_MARKET', params: { market: 'San Salvador' } }]
            }
          }
        : null
    ),
    getNews: jest.fn().mockResolvedValue({
      data: {
        items: [{ title: 'BCIE entrega al MAG nueva flota', source: 'MAG El Salvador', publishedAt: '2026-09-14' }]
      },
      meta: { fetchedAt: new Date().toISOString(), source: 'GDELT + official RSS feeds', stale: false, caveats: [] }
    }),
    getHealth: jest.fn().mockResolvedValue({ adapters: [{ id: 'wfp-slv', enabled: true, ok: true }] }),
    listCategories: jest
      .fn()
      .mockReturnValue([
        'maize',
        'cropProtection',
        'vegetables',
        'livestock',
        'fertilizer',
        'apiary',
        'aquaculture',
        'harvestStorage'
      ]),
    ...overrides
  };
}

function appWith(service) {
  const app = express();
  app.use('/api/agri', createAgriRouter(service));
  return app;
}

describe('agri-routes', () => {
  test('GET /api/agri/crop-health returns the envelope', async () => {
    const res = await request(appWith(stubService())).get('/api/agri/crop-health');
    expect(res.status).toBe(200);
    expect(res.body.data.departments[0].name).toBe('San Salvador');
    expect(res.body.meta.source).toBe('WFP VAM via HDX');
  });

  test('GET /api/agri/market-prices/maize returns series with caveats', async () => {
    const res = await request(appWith(stubService())).get('/api/agri/market-prices/maize');
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Maize & Basic Grains');
    expect(res.body.meta.caveats).toEqual([{ code: 'SINGLE_MARKET', params: { market: 'San Salvador' } }]);
  });

  test('GET /api/agri/market-prices/unknown returns 400 with valid categories', async () => {
    const res = await request(appWith(stubService())).get('/api/agri/market-prices/nope');
    expect(res.status).toBe(400);
    expect(res.body.validCategories).toContain('maize');
    expect(res.body.validCategories).toHaveLength(8);
  });

  test('GET /api/agri/news defaults scope=global lang=es and passes them through', async () => {
    const service = stubService();
    const res = await request(appWith(service)).get('/api/agri/news');
    expect(res.status).toBe(200);
    expect(service.getNews).toHaveBeenCalledWith('global', 'es');
    expect(res.body.data.items[0].source).toBe('MAG El Salvador');
  });

  test('GET /api/agri/news?scope=local&lang=en routes correctly', async () => {
    const service = stubService();
    await request(appWith(service)).get('/api/agri/news?scope=local&lang=en');
    expect(service.getNews).toHaveBeenCalledWith('local', 'en');
  });

  test('GET /api/agri/health returns adapter statuses', async () => {
    const res = await request(appWith(stubService())).get('/api/agri/health');
    expect(res.status).toBe(200);
    expect(res.body.adapters[0].id).toBe('wfp-slv');
  });

  test('handler errors surface as 500, not crashes', async () => {
    const service = stubService({ getCropHealth: jest.fn().mockRejectedValue(new Error('boom')) });
    const res = await request(appWith(service)).get('/api/agri/crop-health');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('boom');
  });
});
