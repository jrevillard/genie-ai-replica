'use strict';

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-middleware — requireRole factory mirrors the real guard so
// role-based access can be exercised end-to-end at the route level
jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => {
      // Faithful to the real middleware: sets req.claims from the verified JWT.
      // Tests select the bearer's roles via the x-test-roles header. Defaults to
      // NO roles (not admin) so a forgotten header fails loudly with 403.
      const roles = (req.headers['x-test-roles'] || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
      req.claims = { realm_access: { roles } };
      next();
    }),
    requireAdmin: jest.fn((req, res, next) => next()),
    requireRole: jest.fn((...allowedRoles) => {
      return (req, res, next) => {
        const roles = req.claims && req.claims.realm_access && req.claims.realm_access.roles;
        if (!Array.isArray(roles) || !allowedRoles.some((role) => roles.includes(role))) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: `${allowedRoles.join(' or ')} access required`,
            details: {}
          });
        }
        next();
      };
    })
  }
}));

const express = require('express');
const request = require('supertest');
const createToolsRouter = require('../../routes/tools-routes');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const toolsService = {
  getFeeds: jest.fn().mockResolvedValue([{ id: 'feed-1', name: 'News' }]),
  createFeed: jest.fn().mockResolvedValue({ id: 'feed-2', name: 'New feed' }),
  updateFeed: jest.fn().mockResolvedValue({ id: 'feed-1', name: 'Updated' }),
  deleteFeed: jest.fn().mockResolvedValue({ success: true }),
  getConfig: jest.fn().mockResolvedValue({ whitelist: [], web_search_enabled: true }),
  updateConfig: jest.fn().mockResolvedValue({ whitelist: [], web_search_enabled: true })
};

const app = express();
app.use(express.json());
app.use('/api/admin/tools', createToolsRouter(toolsService));

beforeEach(() => {
  // jest clearMocks is not enabled globally — reset call history so
  // not.toHaveBeenCalled() assertions are order-independent (implementations survive)
  jest.clearAllMocks();
});

function get(path, roles) {
  return request(app).get(path).set('x-test-roles', roles);
}
function post(path, roles, body) {
  return request(app)
    .post(path)
    .set('x-test-roles', roles)
    .send(body || {});
}
function put(path, roles, body) {
  return request(app)
    .put(path)
    .set('x-test-roles', roles)
    .send(body || {});
}
function del(path, roles) {
  return request(app).delete(path).set('x-test-roles', roles);
}

// ============================================================
// Guard wiring
// ============================================================
describe('guard wiring', () => {
  it('should apply per-route requireRole guards, not blanket requireAdmin', () => {
    // Re-instantiate: clearAllMocks in beforeEach wipes the module-load wiring calls
    createToolsRouter(toolsService);
    expect(keycloakAuthMiddleware.requireRole).toHaveBeenCalledWith('tools-admin', 'tools-reader', 'admin');
    expect(keycloakAuthMiddleware.requireRole).toHaveBeenCalledWith('tools-admin', 'admin');
    expect(keycloakAuthMiddleware.requireAdmin).not.toHaveBeenCalled();
  });

  it('should authenticate every request', async () => {
    await get('/api/admin/tools/feeds', 'tools-admin');
    expect(keycloakAuthMiddleware.authenticate).toHaveBeenCalled();
  });
});

// ============================================================
// Read access — tools-reader may read (NFR8 FOI path)
// ============================================================
describe('read access', () => {
  it('GET /feeds returns 200 for tools-reader', async () => {
    const response = await get('/api/admin/tools/feeds', 'tools-reader');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('GET /feeds returns 200 for tools-admin', async () => {
    const response = await get('/api/admin/tools/feeds', 'tools-admin');
    expect(response.status).toBe(200);
  });

  it('GET /feeds returns 403 for a plain user with no tools role', async () => {
    const response = await get('/api/admin/tools/feeds', 'user');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });
});

// ============================================================
// Write access — tools-reader forbidden, tools-admin allowed
// ============================================================
describe('write access', () => {
  it('POST /feeds returns 403 for tools-reader', async () => {
    const response = await post('/api/admin/tools/feeds', 'tools-reader', { name: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
    expect(toolsService.createFeed).not.toHaveBeenCalled();
  });

  it('POST /feeds returns 201 for tools-admin', async () => {
    const response = await post('/api/admin/tools/feeds', 'tools-admin', { name: 'x' });
    expect(response.status).toBe(201);
    expect(toolsService.createFeed).toHaveBeenCalled();
  });

  it('PUT /feeds/:id returns 403 for tools-reader', async () => {
    const response = await put('/api/admin/tools/feeds/feed-1', 'tools-reader', { name: 'x' });
    expect(response.status).toBe(403);
    expect(toolsService.updateFeed).not.toHaveBeenCalled();
  });

  it('PUT /feeds/:id returns 200 for tools-admin', async () => {
    const response = await put('/api/admin/tools/feeds/feed-1', 'tools-admin', { name: 'x' });
    expect(response.status).toBe(200);
    expect(toolsService.updateFeed).toHaveBeenCalled();
  });

  it('DELETE /feeds/:id returns 403 for tools-reader', async () => {
    const response = await del('/api/admin/tools/feeds/feed-1', 'tools-reader');
    expect(response.status).toBe(403);
    expect(toolsService.deleteFeed).not.toHaveBeenCalled();
  });

  it('DELETE /feeds/:id returns 200 for tools-admin', async () => {
    const response = await del('/api/admin/tools/feeds/feed-1', 'tools-admin');
    expect(response.status).toBe(200);
    expect(toolsService.deleteFeed).toHaveBeenCalled();
  });

  it('POST /test-search returns 403 for tools-reader', async () => {
    const response = await post('/api/admin/tools/test-search', 'tools-reader', { query: 'test' });
    expect(response.status).toBe(403);
  });

  it('legacy admin role retains write access', async () => {
    const response = await post('/api/admin/tools/feeds', 'admin', { name: 'x' });
    expect(response.status).toBe(201);
  });
});

// ============================================================
// Story 4-4 — tools config (domain whitelist + tool toggles)
// ============================================================
describe('tools config routes (story 4-4)', () => {
  it('GET /config returns the service config', async () => {
    toolsService.getConfig = jest.fn().mockResolvedValue({ whitelist: ['who.int'], web_search_enabled: true });
    const response = await request(app).get('/api/admin/tools/config').set('x-test-roles', 'tools-reader');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ whitelist: ['who.int'], web_search_enabled: true });
  });

  it('PUT /config rejects an invalid whitelist entry with 400', async () => {
    const response = await request(app)
      .put('/api/admin/tools/config')
      .set('x-test-roles', 'tools-admin')
      .send({ whitelist: ['not a domain!'], web_search_enabled: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('not a domain!');
    expect(toolsService.updateConfig).not.toHaveBeenCalled();
  });

  it('PUT /config rejects a partial payload (missing whitelist) with 400', async () => {
    const response = await request(app)
      .put('/api/admin/tools/config')
      .set('x-test-roles', 'tools-admin')
      .send({ web_search_enabled: false });
    expect(response.status).toBe(400);
    expect(toolsService.updateConfig).not.toHaveBeenCalled();
  });

  it('PUT /config rejects a non-boolean toggle with 400', async () => {
    const response = await request(app)
      .put('/api/admin/tools/config')
      .set('x-test-roles', 'tools-admin')
      .send({ whitelist: [], web_search_enabled: 'false' });
    expect(response.status).toBe(400);
    expect(toolsService.updateConfig).not.toHaveBeenCalled();
  });

  it('PUT /config returns 403 for tools-reader (negative authz)', async () => {
    const response = await request(app)
      .put('/api/admin/tools/config')
      .set('x-test-roles', 'tools-reader')
      .send({ whitelist: [], web_search_enabled: true });
    expect(response.status).toBe(403);
    expect(toolsService.updateConfig).not.toHaveBeenCalled();
  });

  it('PUT /config normalizes and saves valid domains', async () => {
    toolsService.updateConfig = jest.fn().mockResolvedValue({ whitelist: ['who.int'], web_search_enabled: true });
    const response = await request(app)
      .put('/api/admin/tools/config')
      .set('x-test-roles', 'tools-admin')
      .send({ whitelist: [' WHO.INT ', 'un.org'], web_search_enabled: true });
    expect(response.status).toBe(200);
    expect(toolsService.updateConfig).toHaveBeenCalledWith({
      whitelist: ['who.int', 'un.org'],
      web_search_enabled: true
    });
  });
});

// ============================================================
// Story 4-6 — audit log viewer (FOI: tools-reader reads; read-only)
// ============================================================
describe('audit routes (story 4-6)', () => {
  const rawEntry = (id, tool = 'web_search', action = 'invoke', user = 'u1') => [
    id,
    [
      'tool_id',
      tool,
      'user_id',
      user,
      'timestamp',
      '1690000000.5',
      'action',
      action,
      'governance_decision',
      'allow',
      'duration_ms',
      '12.5',
      'pii_entities_found',
      '1',
      'parameters_redacted',
      '{"query": "<EMAIL>"}',
      'metadata',
      '{"k": "v"}'
    ]
  ];

  beforeEach(() => {
    toolsService.getAuditEntries = jest.fn().mockResolvedValue({
      entries: [
        {
          id: '1690000000000-0',
          tool_id: 'web_search',
          user_id: 'u1',
          timestamp: 1690000000.5,
          action: 'invoke',
          governance_decision: 'allow',
          duration_ms: 12.5,
          pii_entities_found: 1,
          result_summary: 'ok'
        }
      ],
      next_cursor: null
    });
    toolsService.exportAudit = jest.fn().mockResolvedValue({
      body: 'id,timestamp\n1690000000000-0,2023-07-22T...',
      contentType: 'text/csv',
      filename: 'tool-audit-1.csv'
    });
  });

  it('GET /audit is readable by tools-reader (FOI path)', async () => {
    const response = await get('/api/admin/tools/audit', 'tools-reader');
    expect(response.status).toBe(200);
    expect(response.body.data.entries.length).toBe(1);
  });

  it('GET /audit forwards filters to the service', async () => {
    await request(app)
      .get(
        '/api/admin/tools/audit?tool_id=web_search&action=block&from=1690000000&to=1690000100&limit=10&cursor=1690000000000-0'
      )
      .set('x-test-roles', 'tools-reader');
    expect(toolsService.getAuditEntries).toHaveBeenCalledWith({
      tool_id: 'web_search',
      action: 'block',
      user_id: undefined,
      from: 1690000000,
      to: 1690000100,
      limit: 10,
      cursor: '1690000000000-0'
    });
  });

  it('GET /audit returns 403 for a plain user', async () => {
    const response = await get('/api/admin/tools/audit', 'user');
    expect(response.status).toBe(403);
  });

  it('GET /audit/export streams CSV with download headers', async () => {
    const response = await get('/api/admin/tools/audit/export?format=csv', 'tools-reader');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('id,timestamp');
  });

  it('GET /audit/export rejects an invalid format', async () => {
    const response = await get('/api/admin/tools/audit/export?format=xml', 'tools-reader');
    expect(response.status).toBe(400);
  });
});

// Story 4-6 service-level: the decode EXCLUDES payload fields — the security
// boundary of the listing endpoint (parameters_redacted / metadata).
// Uses the REAL service (mocks shared-lib only) so the decode logic is the code under test.
describe('_decodeAuditEntry field exclusion (story 4-6)', () => {
  it('returns public fields only', () => {
    jest.mock('../../services/tools-service', () => require('../../services/tools-service'));
    const realService = jest.requireActual('../../services/tools-service');
    const flat = [
      'tool_id',
      'web_search',
      'parameters_redacted',
      '{"q": "<EMAIL>"}',
      'metadata',
      '{"x": 1}',
      'timestamp',
      '1.5',
      'action',
      'invoke',
      'user_id',
      'u1'
    ];
    const entry = realService._decodeAuditEntry('1-1', flat);
    expect(entry.tool_id).toBe('web_search');
    expect(entry.timestamp).toBe(1.5);
    expect(Object.keys(entry)).not.toContain('parameters_redacted');
    expect(Object.keys(entry)).not.toContain('metadata');
    expect(JSON.stringify(entry)).not.toContain('EMAIL');
    expect(JSON.stringify(entry)).not.toContain('"x"');
  });
});

// ============================================================
// Story 4-7 — health overview
// ============================================================
describe('health route (story 4-7)', () => {
  it('GET /health returns tools + feeds snapshot for tools-reader (FOI)', async () => {
    toolsService.getToolsHealth = jest.fn().mockResolvedValue({
      tools: [{ tool_id: 'web_search', circuit_state: 'closed', reachable: true, error: null }],
      feeds: [{ id: 'f1', title: 'News', enabled: true, failures: 0, last_polled: 1690000000, status: 'green' }]
    });
    const response = await get('/api/admin/tools/health', 'tools-reader');
    expect(response.status).toBe(200);
    expect(response.body.data.tools[0].reachable).toBe(true);
    expect(response.body.data.feeds[0].status).toBe('green');
  });

  it('GET /health returns 403 for a plain user', async () => {
    const response = await get('/api/admin/tools/health', 'user');
    expect(response.status).toBe(403);
  });

  it('deriveFeedStatus thresholds', () => {
    const realService = jest.requireActual('../../services/tools-service');
    const D = realService.constructor.deriveFeedStatus;
    expect(D({ enabled: false, failures: 0 })).toBe('disabled');
    expect(D({ enabled: true, failures: 0 })).toBe('green');
    expect(D({ enabled: true, failures: 1 })).toBe('yellow');
    expect(D({ enabled: true, failures: 2 })).toBe('yellow');
    expect(D({ enabled: true, failures: 3 })).toBe('red');
    expect(D({ enabled: true })).toBe('green');
  });

  it('_probeSearxng reports failure as data, never throws', async () => {
    const realService = jest.requireActual('../../services/tools-service');
    const S = realService.constructor;
    const original = S._probeCache;
    S._probeCache = { at: 0, reachable: null, error: null };
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const probe = await realService._probeSearxng();
    expect(probe.reachable).toBe(false);
    expect(probe.error).toContain('connection refused');
    S._probeCache = original;
  });

  it('_probeSearxng caches within the window', async () => {
    const realService = jest.requireActual('../../services/tools-service');
    const S = realService.constructor;
    const original = S._probeCache;
    S._probeCache = { at: Date.now(), reachable: true, error: null };
    global.fetch = jest.fn();
    const probe = await realService._probeSearxng();
    expect(probe.reachable).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    S._probeCache = original;
  });
});
