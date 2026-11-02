// Admin approval routes (A6): real admin-routes router mounted on a real
// express app (me-context pattern) with the proxy + provisioning services and
// email mocked, dbService faked via the shared-lib manual mock. Pins the
// approve/reject contract: realm-role sync BEFORE the doc write (Admin role
// only), cache eviction on both decisions, proxy-failure safety (doc stays
// Pending), the pending-queue stub fallbacks, and unchanged response shapes.
const mockAssignRealmRole = jest.fn().mockResolvedValue(undefined);
const mockRevokeUserSessions = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/keycloak-proxy-service', () => ({
  assignRealmRole: (...args) => mockAssignRealmRole(...args),
  revokeUserSessions: (...args) => mockRevokeUserSessions(...args)
}));

const mockEvictUser = jest.fn();
jest.mock('../services/user-provisioning-service', () => ({
  evictUser: (...args) => mockEvictUser(...args)
}));

const mockSendGenericEmail = jest.fn().mockResolvedValue({ success: true });
jest.mock('../services/email-service', () => ({
  sendGenericEmail: (...args) => mockSendGenericEmail(...args)
}));

// The real middleware pulls the jose verifier (ESM-only); requireAdmin's
// claims check is pinned by keycloak-auth-middleware.test.js — pass through.
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { requireAdmin: (req, res, next) => next() }
}));

const express = require('express');
const buildAdminRoutes = require('../routes/admin-routes');
const sharedLib = require('../mocks/shared-lib.js');

const ADMIN = { _key: 'admin-1', iss_sub: 'http://kc#admin-1' };
const PENDING_USER = {
  _key: 'user-42',
  iss_sub: 'http://kc#42',
  email: 'newbie@example.com',
  loginName: 'newbie',
  status: 'Pending',
  personalIdentification: { fullName: 'New Bee' }
};

// Fake users collection + db.query for the pending-queue route
function makeFakeDb(docs) {
  const store = new Map(docs.map((d) => [d._key, { ...d }]));
  const updates = [];
  const events = []; // cross-actor ordering: 'assign' (proxy mock) vs 'update'
  const specs = []; // recorded aql query specs
  const queryResults = []; // values for db.query(...).all()
  const users = {
    document: async (key) => {
      const d = store.get(key);
      if (!d) throw Object.assign(new Error('document not found'), { code: 404 });
      return d;
    },
    update: async (key, data) => {
      events.push('update');
      updates.push({ key, data });
      Object.assign(store.get(key) || {}, data);
    }
  };
  const db = {
    collection: () => users,
    query: async (spec) => {
      specs.push(spec);
      return { all: async () => queryResults.shift() || [], next: async () => null };
    }
  };
  return { db, store, updates, events, specs, queryResults };
}

function makeApp(fakeDb) {
  sharedLib.dbService.getConnection.mockReset().mockResolvedValue(fakeDb.db);
  const app = express();
  app.use(express.json());
  // Global auth middleware stand-in: requireAdmin reads req.claims, handlers read req.user
  app.use((req, res, next) => {
    req.user = ADMIN;
    req.claims = { realm_access: { roles: ['admin'] } };
    next();
  });
  app.use('/api/admin', buildAdminRoutes({ getSystemHealth: async () => ({}) }, { getLogsSummary: async () => ({}) }));
  return app;
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

describe('admin approval routes (A6)', () => {
  beforeEach(() => {
    mockAssignRealmRole.mockClear().mockResolvedValue(undefined);
    mockRevokeUserSessions.mockClear().mockResolvedValue(undefined);
    mockEvictUser.mockClear();
    mockSendGenericEmail.mockClear().mockResolvedValue({ success: true });
  });

  describe('GET /api/admin/users/pending', () => {
    it('queues Pending users; AQL carries loginName/fullName fallbacks for stub-less docs', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      fakeDb.queryResults.push([
        { _key: 'u1', loginName: 'a@example.com', email: 'a@example.com', fullName: 'A', createdAt: '2026-01-01T00:00:00Z', status: 'Pending' }
      ]);
      const app = makeApp(fakeDb);

      const res = await request(app, 'GET', '/api/admin/users/pending');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, count: 1, data: body.data });
      // The fallbacks live in the query text (JIT stubs vs legacy docs):
      expect(fakeDb.specs[0].query).toContain('u.loginName || u.email');
      expect(fakeDb.specs[0].query).toContain('u.personalIdentification.fullName || u.name');
    });
  });

  describe('POST /api/admin/users/:userId/approve', () => {
    it('role Admin: assignRealmRole runs BEFORE the doc write; doc flips Active, cache evicted, response shape unchanged', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      mockAssignRealmRole.mockImplementation(async () => {
        fakeDb.events.push('assign');
      });
      const app = makeApp(fakeDb);

      const res = await request(app, 'POST', '/api/admin/users/user-42/approve', { role: 'Admin' });
      const body = await res.json();

      expect(res.status).toBe(200);
      // emailNotification (audit F-wave): 'sent' | 'failed' | 'skipped' — the
      // admin must see whether the approval email actually went out.
      expect(body).toEqual({
        success: true,
        message: 'User approved successfully',
        emailNotification: 'sent',
        user: { _key: 'user-42', status: 'Active', role: 'Admin' }
      });
      expect(mockAssignRealmRole).toHaveBeenCalledWith('user-42', 'admin');
      // Realm sync completed BEFORE the doc write — proxy failure leaves a retryable Approve
      expect(fakeDb.events).toEqual(['assign', 'update']);
      expect(fakeDb.updates).toHaveLength(1);
      expect(fakeDb.updates[0].data).toMatchObject({ status: 'Active', role: 'Admin', approvedBy: 'admin-1' });
      expect(mockEvictUser).toHaveBeenCalledWith(PENDING_USER.iss_sub);
    });

    it('non-Admin role: doc label only — no realm call', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      const app = makeApp(fakeDb);

      const res = await request(app, 'POST', '/api/admin/users/user-42/approve', { role: 'Manager' });

      expect(res.status).toBe(200);
      expect(mockAssignRealmRole).not.toHaveBeenCalled();
      expect(fakeDb.updates[0].data).toMatchObject({ status: 'Active', role: 'Manager' });
      expect(mockEvictUser).toHaveBeenCalledWith(PENDING_USER.iss_sub);
    });

    it('proxy failure: 502 surfaced with a fixed message, doc stays Pending (update never runs)', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      mockAssignRealmRole.mockRejectedValue(Object.assign(new Error('Keycloak API error: 503'), { status: undefined }));
      const app = makeApp(fakeDb);

      const res = await request(app, 'POST', '/api/admin/users/user-42/approve', { role: 'Admin' });
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to sync the Keycloak admin role. Please try again.');
      expect(body.message).not.toContain('Keycloak API error'); // no internal leak
      expect(fakeDb.updates).toHaveLength(0);
      expect(fakeDb.store.get('user-42').status).toBe('Pending');
    });

    it('KC 401/403 on role sync maps to 502 — never passed through (frontend would treat its own token as stale)', async () => {
      for (const kcStatus of [401, 403]) {
        const fakeDb = makeFakeDb([PENDING_USER]);
        mockAssignRealmRole.mockRejectedValue(Object.assign(new Error('KC says no'), { status: kcStatus }));
        const app = makeApp(fakeDb);

        const res = await request(app, 'POST', '/api/admin/users/user-42/approve', { role: 'Admin' });

        expect(res.status).toBe(502);
        expect(fakeDb.updates).toHaveLength(0);
      }
    });

    it('non-pending user → 400', async () => {
      const active = { ...PENDING_USER, _key: 'user-7', status: 'Active' };
      const app = makeApp(makeFakeDb([active]));

      const res = await request(app, 'POST', '/api/admin/users/user-7/approve', { role: 'User' });

      expect(res.status).toBe(400);
    });

    it('unknown user → 404', async () => {
      const app = makeApp(makeFakeDb([PENDING_USER]));
      const res = await request(app, 'POST', '/api/admin/users/ghost/approve', { role: 'User' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/admin/users/:userId/reject', () => {
    it('marks Rejected + disabled, evicts the cache, revokes KC sessions', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      const app = makeApp(fakeDb);

      const res = await request(app, 'POST', '/api/admin/users/user-42/reject', { reason: 'not needed' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, message: 'User rejected', user: { _key: 'user-42', status: 'Rejected' } });
      expect(fakeDb.updates[0].data).toMatchObject({ status: 'Rejected', disabled: true, rejectionReason: 'not needed' });
      expect(mockEvictUser).toHaveBeenCalledWith(PENDING_USER.iss_sub);
      expect(mockRevokeUserSessions).toHaveBeenCalledWith('user-42');
    });

    it('reject still succeeds (200) when the KC session revoke fails — best-effort', async () => {
      const fakeDb = makeFakeDb([PENDING_USER]);
      mockRevokeUserSessions.mockRejectedValue(new Error('Keycloak unreachable'));
      const app = makeApp(fakeDb);

      const res = await request(app, 'POST', '/api/admin/users/user-42/reject', { reason: 'x' });

      expect(res.status).toBe(200);
      expect(fakeDb.store.get('user-42').status).toBe('Rejected');
    });

    it('unknown user → 404', async () => {
      const app = makeApp(makeFakeDb([PENDING_USER]));
      const res = await request(app, 'POST', '/api/admin/users/ghost/reject', {});
      expect(res.status).toBe(404);
    });
  });
});
