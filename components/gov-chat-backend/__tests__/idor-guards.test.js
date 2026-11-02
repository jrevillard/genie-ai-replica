// Audit F5 (night of 09-28/29): object-level authorization. authenticate only
// proves WHO the caller is — these tests pin the owner-or-admin guards added
// across user/query/session/chat-history routes. requireAdmin is mocked with
// its REAL semantics (fresh JWT claims) so the route-level gates are exercised.
jest.mock('../services/keycloak-proxy-service', () => ({
  updateOwnProfile: jest.fn().mockResolvedValue({}),
  deleteUser: jest.fn().mockResolvedValue(undefined),
  sendVerifyEmail: jest.fn().mockResolvedValue(undefined),
  assignRealmRole: jest.fn().mockResolvedValue({}),
  removeRealmRole: jest.fn().mockResolvedValue({}),
  revokeUserSessions: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/user-provisioning-service', () => ({
  evictUser: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    requireAdmin: (req, res, next) => {
      const roles = req.claims && req.claims.realm_access && req.claims.realm_access.roles;
      if (Array.isArray(roles) && roles.includes('admin')) return next();
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    }
  }
}));

const express = require('express');
const os = require('os');
const path = require('path');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'idor-guards-test');

const SELF_KEY = 'user-42';
const SELF = { _key: SELF_KEY, iss_sub: 'http://kc#42', email: 'me@example.com' };

function makeApp(buildRouter, service, { roles = ['user'], user = SELF, mountAt = '/api' } = {}) {
  jest.resetModules();
  const build = require(buildRouter);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { ...user };
    req.claims = { realm_access: { roles } };
    next();
  });
  app.use(mountAt, build(service));
  return app;
}

async function request(app, method, pathName, body) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${pathName}`, {
      method,
      headers: { 'authorization': 'Bearer test', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

describe('audit F5 — user-routes guards', () => {
  const otherProfile = {
    _key: 'user-99',
    email: 'other@example.com',
    loginName: 'other',
    roles: ['user'],
    personalIdentification: { fullName: 'Other Person', dob: '1990-01-01' },
    addressResidency: { currentAddress: 'secret street' }
  };
  const userService = {
    getUserProfile: async (key) => (key === 'user-99' ? { ...otherProfile } : { _key: key, email: 'me@example.com' }),
    deleteUserProfile: jest.fn().mockResolvedValue(undefined),
    updateUserProfile: async () => ({}),
    createUserProfile: async () => ({}),
    searchUsers: async () => ({}),
    isEmailAvailable: async () => true,
    resetUserData: async () => ({}),
    forceUserLogout: async () => ({ success: true }),
    deleteUserFiles: jest.fn().mockResolvedValue(undefined),
    users: { update: async () => {} }
  };

  it('non-owner GET /users/:id gets 404 (no existence oracle)', async () => {
    const res = await request(makeApp('../routes/user-routes', userService, { mountAt: '/api/users' }), 'GET', '/api/users/user-99');
    expect(res.status).toBe(404);
  });

  it('owner GET /users/:id gets the full own profile', async () => {
    const res = await request(makeApp('../routes/user-routes', userService, { mountAt: '/api/users' }), 'GET', `/api/users/${SELF_KEY}`);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.email).toBe('me@example.com');
  });

  it('admin GET /users/:id gets a whitelisted projection (no address/PII blobs)', async () => {
    const app = makeApp('../routes/user-routes', userService, { roles: ['admin'], mountAt: '/api/users' });
    const res = await request(app, 'GET', '/api/users/user-99');
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc._key).toBe('user-99');
    expect(doc.addressResidency).toBeUndefined();
    expect(doc.personalIdentification).toBeUndefined();
  });

  it('non-admin GET /users (directory) gets 403', async () => {
    const res = await request(makeApp('../routes/user-routes', userService, { mountAt: '/api/users' }), 'GET', '/api/users');
    expect(res.status).toBe(403);
  });

  it('non-owner DELETE /users/:id gets 403', async () => {
    const res = await request(makeApp('../routes/user-routes', userService, { mountAt: '/api/users' }), 'DELETE', '/api/users/user-99');
    expect(res.status).toBe(403);
    expect(userService.deleteUserProfile).not.toHaveBeenCalled();
  });
});

describe('audit F5 — query-routes guards', () => {
  it('non-owner GET /queries/:id gets 404', async () => {
    const svc = { getQuery: async () => ({ _key: 'q1', userId: 'user-99', text: 'hi' }) };
    const res = await request(makeApp('../routes/query-routes', svc, { mountAt: '/api/queries' }), 'GET', '/api/queries/q1');
    expect(res.status).toBe(404);
  });

  it('owner GET /queries/:id gets 200', async () => {
    const svc = { getQuery: async () => ({ _key: 'q1', userId: SELF_KEY, text: 'hi' }) };
    const res = await request(makeApp('../routes/query-routes', svc, { mountAt: '/api/queries' }), 'GET', '/api/queries/q1');
    expect(res.status).toBe(200);
  });

  it('POST /queries binds attribution to req.user._key, ignoring the body', async () => {
    const seen = [];
    const svc = { createQuery: async (data) => { seen.push(data); return data; } };
    const res = await request(
      makeApp('../routes/query-routes', svc, { mountAt: '/api/queries' }),
      'POST',
      '/api/queries',
      { userId: 'user-99', text: 'forged' }
    );
    expect(res.status).toBe(201);
    expect(seen[0].userId).toBe(SELF_KEY);
  });

  it('non-admin search is force-scoped to the caller', async () => {
    const seen = [];
    const svc = { searchQueries: async (criteria) => { seen.push(criteria); return []; } };
    await request(makeApp('../routes/query-routes', svc, { mountAt: '/api/queries' }), 'GET', '/api/queries?text=x');
    expect(seen[0].userId).toBe(SELF_KEY);
  });
});

describe('audit F5 — session-routes guards', () => {
  const sessionService = {
    getSession: async (id) => (id === 's1' ? { _key: 's1', userId: 'http://kc#42' } : null),
    endSession: jest.fn().mockResolvedValue({ ended: true }),
    keepSessionAlive: jest.fn().mockResolvedValue({ alive: true }),
    getUserSessions: async () => []
  };

  it('non-owner GET /sessions/:id gets 404', async () => {
    const svc = { ...sessionService, getSession: async (id) => ({ _key: id, userId: 'http://kc#other' }) };
    const res = await request(makeApp('../routes/session-routes', svc, { mountAt: '/api/sessions' }), 'GET', '/api/sessions/s1');
    expect(res.status).toBe(404);
  });

  it('owner (iss_sub match) GET /sessions/:id gets 200', async () => {
    const res = await request(makeApp('../routes/session-routes', sessionService, { mountAt: '/api/sessions' }), 'GET', '/api/sessions/s1');
    expect(res.status).toBe(200);
  });

  it('non-owner PATCH /sessions/:id/end gets 403 without ending it', async () => {
    const svc = { ...sessionService, getSession: async (id) => ({ _key: id, userId: 'http://kc#other' }) };
    const res = await request(makeApp('../routes/session-routes', svc, { mountAt: '/api/sessions' }), 'PATCH', '/api/sessions/s1/end');
    expect(res.status).toBe(403);
    expect(svc.endSession).not.toHaveBeenCalled();
  });

  it('non-admin GET /sessions/user/:other is repointed at the caller', async () => {
    const seen = [];
    const svc = { ...sessionService, getUserSessions: async (userId) => { seen.push(userId); return []; } };
    await request(makeApp('../routes/session-routes', svc, { mountAt: '/api/sessions' }), 'GET', '/api/sessions/user/user-99');
    expect(seen[0]).toBe('http://kc#42');
  });
});

describe('audit F5 — chat-history conversation guards', () => {
  const chatService = {
    getConversationOwnerId: async (id) => (id === 'c1' ? SELF_KEY : null),
    getConversation: async () => ({ _key: 'c1', title: 't' }),
    getConversationMessages: async () => ({ messages: [] }),
    getQueryOwnerId: async () => SELF_KEY,
    findMessagesForQuery: async () => [],
    findOriginatingQuery: async () => ({ userId: 'user-99', text: 'secret' })
  };

  it('non-owner GET /chat/conversations/:id gets 404', async () => {
    const res = await request(makeApp('../routes/chat-history-routes', chatService, { mountAt: '/api/chat' }), 'GET', '/api/chat/conversations/c2');
    expect(res.status).toBe(404);
  });

  it('owner GET /chat/conversations/:id gets 200', async () => {
    const res = await request(makeApp('../routes/chat-history-routes', chatService, { mountAt: '/api/chat' }), 'GET', '/api/chat/conversations/c1');
    expect(res.status).toBe(200);
  });

  it('admin bypasses the conversation owner gate', async () => {
    const app = makeApp('../routes/chat-history-routes', chatService, { roles: ['admin'], mountAt: '/api/chat' });
    const res = await request(app, 'GET', '/api/chat/conversations/c2');
    expect(res.status).toBe(200);
  });

  it('non-owner GET /chat/messages/:id/query gets 404 (no query-text leak)', async () => {
    const res = await request(makeApp('../routes/chat-history-routes', chatService, { mountAt: '/api/chat' }), 'GET', '/api/chat/messages/m1/query');
    expect(res.status).toBe(404);
  });
});
