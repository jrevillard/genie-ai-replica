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
  deleteFeed: jest.fn().mockResolvedValue({ success: true })
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
