// User-route account operations (A6): email change via the KC Account API,
// GDPR delete via the proxy, resend-verification via VERIFY_EMAIL, realm
// admin-role sync on role changes — real user-routes router on a real express
// app with the proxy mocked. Plus the forceUserLogout service rework: KC session
// revoke + Arango session sweep BY iss_sub (the old sweep queried _key and
// matched nothing — sessions store iss_sub as userId).
const mockProxy = {
  updateOwnProfile: jest.fn().mockResolvedValue({}),
  deleteUser: jest.fn().mockResolvedValue(undefined),
  sendVerifyEmail: jest.fn().mockResolvedValue(undefined),
  assignRealmRole: jest.fn().mockResolvedValue(undefined),
  removeRealmRole: jest.fn().mockResolvedValue(undefined),
  revokeUserSessions: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../services/keycloak-proxy-service', () => mockProxy);

const mockEvictUser = jest.fn();
jest.mock('../services/user-provisioning-service', () => ({
  evictUser: (...args) => mockEvictUser(...args)
}));

// The real middleware pulls the jose verifier (ESM-only); requireAdmin's claims
// check is pinned by keycloak-auth-middleware.test.js — pass through.
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { requireAdmin: (req, res, next) => next() }
}));

const express = require('express');
const os = require('os');
const path = require('path');

// UserProfileService's constructor mkdirs its upload dir — point it at tmp
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'a6-uploads-test');

const userProfileService = require('../services/user-profile-service');

const USER = { _key: 'user-42', iss_sub: 'http://kc#42', email: 'me@example.com', role: 'User' };

function makeUserService(docs) {
  const store = new Map(docs.map((d) => [d._key, { ...d }]));
  const updates = [];
  return {
    store,
    updates,
    getUserProfile: async (key) => store.get(key) || null,
    deleteUserFiles: jest.fn().mockResolvedValue(undefined),
    users: {
      update: async (key, data) => {
        updates.push({ key, data });
        Object.assign(store.get(key) || {}, data);
      }
    },
    // module-contract guard fields (checked at route-init)
    updateUserProfile: async () => ({}),
    createUserProfile: async () => ({}),
    deleteUserProfile: async () => ({}),
    searchUsers: async () => ({}),
    isEmailAvailable: async () => true,
    resetUserData: async () => ({}),
    forceUserLogout: async () => ({ success: true })
  };
}

function makeApp(userService) {
  // user-routes registers onto a MODULE-LEVEL router — a fresh module per app
  // keeps each test's userService closure from being shadowed by earlier
  // registrations (jest.mock factories persist across resetModules).
  jest.resetModules();
  const buildUserRoutes = require('../routes/user-routes');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { ...USER };
    req.claims = { realm_access: { roles: ['admin'] } };
    next();
  });
  app.use('/api/users', buildUserRoutes(userService));
  return app;
}

async function request(app, method, pathName, body, headers = {}) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${pathName}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

describe('user-routes account operations (A6)', () => {
  beforeEach(() => {
    Object.values(mockProxy).forEach((m) => m.mockClear().mockResolvedValue(undefined));
    mockProxy.updateOwnProfile.mockResolvedValue({});
    mockEvictUser.mockClear();
  });

  describe('PUT /api/users/email — KC Account API', () => {
    it('forwards {email} to updateOwnProfile with the user bearer token', async () => {
      const userService = makeUserService([USER]);
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/email', { email: 'new@example.com' }, { authorization: 'Bearer user-token' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockProxy.updateOwnProfile).toHaveBeenCalledWith('user-token', { email: 'new@example.com' });
      // No token/pending-write machinery: the Arango doc is untouched by this route
      expect(userService.updates).toHaveLength(0);
    });

    it('KC 409 (duplicate email) surfaces as 409 to the client', async () => {
      mockProxy.updateOwnProfile.mockRejectedValue(Object.assign(new Error('Conflict in Keycloak operation'), { status: 409 }));
      const app = makeApp(makeUserService([USER]));

      const res = await request(app, 'PUT', '/api/users/email', { email: 'taken@example.com' }, { authorization: 'Bearer t' });

      expect(res.status).toBe(409);
    });

    it('missing email → 400; missing bearer → 401', async () => {
      const app = makeApp(makeUserService([USER]));
      expect((await request(app, 'PUT', '/api/users/email', {}, { authorization: 'Bearer t' })).status).toBe(400);
      expect((await request(app, 'PUT', '/api/users/email', { email: 'x@y.z' })).status).toBe(401);
    });
  });

  describe('POST /api/users/delete — upstream GDPR delete', () => {
    it('erases uploaded files BEFORE the proxy delete, then deletes via the proxy', async () => {
      const userService = makeUserService([USER]);
      const app = makeApp(userService);

      const res = await request(app, 'POST', '/api/users/delete', { reason: 'GDPR' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, message: 'Account deleted' });
      expect(mockProxy.deleteUser).toHaveBeenCalledWith('user-42');
      expect(userService.deleteUserFiles).toHaveBeenCalledWith(expect.objectContaining({ _key: 'user-42' }));
      expect(userService.deleteUserFiles.mock.invocationCallOrder[0]).toBeLessThan(
        mockProxy.deleteUser.mock.invocationCallOrder[0]
      );
    });

    it('unknown user → 404; partial-erasure error (no KC status) → 500', async () => {
      mockProxy.deleteUser.mockResolvedValue(undefined);
      const app404 = makeApp(makeUserService([])); // empty store → getUserProfile null
      const res404 = await request(app404, 'POST', '/api/users/delete', {});
      expect(res404.status).toBe(404);

      mockProxy.deleteUser.mockRejectedValue(new Error('Partial erasure: user deleted from Keycloak but ArangoDB erasure failed'));
      const app = makeApp(makeUserService([USER]));
      const res = await request(app, 'POST', '/api/users/delete', {});
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/users/admin/users/:userId/resend-verification', () => {
    it('triggers the KC VERIFY_EMAIL action via the proxy', async () => {
      const app = makeApp(makeUserService([USER]));

      const res = await request(app, 'POST', '/api/users/admin/users/user-42/resend-verification');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, message: 'Verification email sent successfully' });
      expect(mockProxy.sendVerifyEmail).toHaveBeenCalledWith('user-42');
    });

    it('unknown user → 404', async () => {
      const app = makeApp(makeUserService([USER]));
      expect((await request(app, 'POST', '/api/users/admin/users/ghost/resend-verification')).status).toBe(404);
    });
  });

  describe('PUT /api/users/:userId/role — realm admin sync on Admin↔other', () => {
    it('User → Admin assigns the realm role, then writes the label, then evicts the cache', async () => {
      const userService = makeUserService([USER]);
      const events = [];
      mockProxy.assignRealmRole.mockImplementation(async () => events.push('assign'));
      userService.users.update = async (key, data) => {
        events.push('label');
        userService.updates.push({ key, data });
      };
      mockEvictUser.mockImplementation(() => events.push('evict'));
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42/role', { role: 'Admin' });

      expect(res.status).toBe(200);
      expect(mockProxy.assignRealmRole).toHaveBeenCalledWith('user-42', 'admin');
      expect(events).toEqual(['assign', 'label', 'evict']); // sync BEFORE label; evict after
      expect(mockEvictUser).toHaveBeenCalledWith(USER.iss_sub);
    });

    it('Admin → User removes the realm role and evicts the cache', async () => {
      const userService = makeUserService([{ ...USER, role: 'Admin' }]);
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42/role', { role: 'User' });

      expect(res.status).toBe(200);
      expect(mockProxy.removeRealmRole).toHaveBeenCalledWith('user-42', 'admin');
      expect(mockEvictUser).toHaveBeenCalledWith(USER.iss_sub);
    });

    it('same-side transition (User → Manager): no realm call, label written, cache still evicted', async () => {
      const userService = makeUserService([USER]);
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42/role', { role: 'Manager' });

      expect(res.status).toBe(200);
      expect(mockProxy.assignRealmRole).not.toHaveBeenCalled();
      expect(mockProxy.removeRealmRole).not.toHaveBeenCalled();
      // the label doc changed — the cached provisioning doc must not go stale
      expect(mockEvictUser).toHaveBeenCalledWith(USER.iss_sub);
      expect(userService.updates[0].data).toMatchObject({ role: 'Manager' });
    });

    it('proxy failure → 502, fixed message, label unchanged, no evict', async () => {
      const userService = makeUserService([USER]);
      mockProxy.assignRealmRole.mockRejectedValue(new Error('Keycloak unreachable'));
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42/role', { role: 'Admin' });
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.message).toBe('Failed to sync the Keycloak admin role. Please try again.');
      expect(body.message).not.toContain('Keycloak unreachable'); // no internal leak
      expect(userService.updates).toHaveLength(0);
      expect(userService.store.get('user-42').role).toBe('User');
      expect(mockEvictUser).not.toHaveBeenCalled();
    });

    it('KC 401/403 on role sync maps to 502 — never passed through', async () => {
      for (const kcStatus of [401, 403]) {
        const userService = makeUserService([USER]);
        mockProxy.assignRealmRole.mockRejectedValue(Object.assign(new Error('KC says no'), { status: kcStatus }));
        const app = makeApp(userService);

        const res = await request(app, 'PUT', '/api/users/user-42/role', { role: 'Admin' });

        expect(res.status).toBe(502);
        expect(userService.updates).toHaveLength(0);
      }
    });
  });

  describe('PUT /api/users/:userId role-branch (req.body.role — the path the admin UI calls)', () => {
    it('User → Admin: assign BEFORE label write, then evict; response shape unchanged', async () => {
      const userService = makeUserService([USER]);
      const events = [];
      mockProxy.assignRealmRole.mockImplementation(async () => events.push('assign'));
      userService.users.update = async (key, data) => {
        events.push('label');
        userService.updates.push({ key, data });
      };
      mockEvictUser.mockImplementation(() => events.push('evict'));
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42', { role: 'Admin' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, message: 'User role updated successfully', role: 'Admin' });
      expect(mockProxy.assignRealmRole).toHaveBeenCalledWith('user-42', 'admin');
      expect(events).toEqual(['assign', 'label', 'evict']);
      expect(mockEvictUser).toHaveBeenCalledWith(USER.iss_sub);
    });

    it('proxy failure → 502 and the label stays unchanged', async () => {
      const userService = makeUserService([USER]);
      mockProxy.assignRealmRole.mockRejectedValue(Object.assign(new Error('KC says no'), { status: 403 }));
      const app = makeApp(userService);

      const res = await request(app, 'PUT', '/api/users/user-42', { role: 'Admin' });

      expect(res.status).toBe(502); // 403 mapped, not passed through
      expect(userService.updates).toHaveLength(0);
      expect(userService.store.get('user-42').role).toBe('User');
    });
  });

  describe('userProfileService.forceUserLogout (A6 rework)', () => {
    it('sweeps Arango sessions BY iss_sub FIRST, then revokes KC — never writes token fields', async () => {
      const events = [];
      const specs = [];
      userProfileService.users = {
        document: async () => ({ _key: 'user-42', iss_sub: USER.iss_sub })
      };
      userProfileService.db = {
        query: async (spec) => {
          events.push('sweep');
          specs.push(spec);
          return { all: async () => [] };
        }
      };
      mockProxy.revokeUserSessions.mockImplementation(async () => events.push('revoke'));

      const result = await userProfileService.forceUserLogout('user-42', 'admin-1');

      expect(result).toEqual({ success: true, message: 'User logged out successfully' });
      expect(mockProxy.revokeUserSessions).toHaveBeenCalledWith('user-42');
      // Local sweep runs before the KC call — it must not depend on KC being up
      expect(events).toEqual(['sweep', 'revoke']);
      expect(specs).toHaveLength(1);
      expect(specs[0].query).toContain('FILTER s.userId ==');
      expect(Object.values(specs[0].bindVars)).toContain(USER.iss_sub); // iss_sub, not _key
      expect(specs[0].query).not.toContain('accessToken');
      expect(specs[0].query).not.toContain('tokenVersion');
    });

    it('genuine not-found (Arango 404/1202) → throws User not found (route maps to 404)', async () => {
      userProfileService.users = {
        document: async () => {
          throw Object.assign(new Error('document not found'), { code: 404 });
        }
      };
      await expect(userProfileService.forceUserLogout('ghost', 'admin-1')).rejects.toThrow('User not found');
    });

    it('non-not-found document() failures surface as themselves, not "User not found"', async () => {
      userProfileService.users = {
        document: async () => {
          throw new Error('ECONNREFUSED: arango unreachable');
        }
      };
      await expect(userProfileService.forceUserLogout('user-42', 'admin-1')).rejects.toThrow('arango unreachable');
    });
  });

  describe('UserProfileService.process — JIT_PROTECTED_FIELDS stripping (A6: status/role)', () => {
    it('status and role never reach the update payload; benign sections pass through', async () => {
      const processed = await userProfileService.process('user-42', {
        status: 'Active', // self-approve attempt
        role: 'Admin', // self-promote attempt
        personalIdentification: { fullName: 'Legit Edit' }
      }, {});

      expect(processed).not.toHaveProperty('status');
      expect(processed).not.toHaveProperty('role');
      expect(processed.personalIdentification).toEqual({ fullName: 'Legit Edit' });
    });
  });
});
