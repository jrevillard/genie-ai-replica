// Mounted-route coverage for keycloakAuthMiddleware.authenticate: real express
// app (stream-route real-server pattern) + the REAL middleware, with only the
// verifier and provisioning services mocked. Pins: 401 on missing/garbage token
// with handler-not-run, query-string-proof public paths, 200 on a valid token,
// and the 503 AUTH_SERVICE_UNAVAILABLE outage mapping (A5 fix).
const mockVerifyToken = jest.fn();
const mockProvisionUser = jest.fn();

jest.mock('../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args),
  isTrustedIssuer: () => true
}));

jest.mock('../services/user-provisioning-service', () => ({
  provisionUser: (...args) => mockProvisionUser(...args)
}));

const express = require('express');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const meContextRoutes = require('../routes/me-context-routes');

const PAYLOAD = {
  iss: 'http://localhost:8080/realms/genie',
  sub: '12345678',
  iss_sub: 'http://localhost:8080/realms/genie#12345678',
  email: 'test@example.com',
  realm_access: { roles: ['user'] },
  exp: Math.floor(Date.now() / 1000) + 3600
};

const ARANGO_USER = {
  _key: 'users/123',
  iss_sub: PAYLOAD.iss_sub,
  sub: PAYLOAD.sub,
  email: PAYLOAD.email,
  roles: ['user'],
  active: true,
  deleted: false
};

function makeApp() {
  const app = express();
  const state = { handlerRuns: 0 };
  // Global mount, as index.js does (upstream :923 pattern)
  app.use(keycloakAuthMiddleware.authenticate);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/api/protected', (req, res) => {
    state.handlerRuns += 1;
    res.json({ ok: true, issSub: req.user?.iss_sub });
  });
  return { app, state };
}

async function get(app, path, headers = {}) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

describe('keycloakAuthMiddleware.authenticate mounted on a real app', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockProvisionUser.mockReset();
  });

  it('no token → 401 TOKEN_INVALID and protected handler never runs', async () => {
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'TOKEN_INVALID', message: 'Missing or malformed Authorization header', details: {} });
    expect(state.handlerRuns).toBe(0);
  });

  it('garbage token → 401 TOKEN_INVALID and protected handler never runs', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('bad'), { code: 'TOKEN_INVALID' }));
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer garbage' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'TOKEN_INVALID', message: 'Token verification failed', details: {} });
    expect(state.handlerRuns).toBe(0);
  });

  it('public path with a query string stays public (/health?probe=1 → 200, no token)', async () => {
    const { app } = makeApp();
    const res = await get(app, '/health?probe=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('valid token → 200, handler runs once with the provisioned user', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue(ARANGO_USER);
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, issSub: ARANGO_USER.iss_sub });
    expect(mockProvisionUser).toHaveBeenCalledWith(PAYLOAD);
    expect(state.handlerRuns).toBe(1);
  });

  it('A6: Pending user → 403 ACCOUNT_PENDING with the email in details, handler never runs', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue({ ...ARANGO_USER, status: 'Pending' });
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: 'ACCOUNT_PENDING',
      message: 'Your account is pending approval by an administrator.',
      details: { email: 'test@example.com' }
    });
    expect(state.handlerRuns).toBe(0);
  });

  it('A6: Rejected user → 403 FORBIDDEN, handler never runs', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue({ ...ARANGO_USER, status: 'Rejected', disabled: true });
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('rejected');
    expect(state.handlerRuns).toBe(0);
  });

  it('A6: disabled user (any status) → 403 FORBIDDEN', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue({ ...ARANGO_USER, disabled: true });
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('disabled');
    expect(state.handlerRuns).toBe(0);
  });

  it('A6: Active status (approval satisfied or knob off) → 200', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue({ ...ARANGO_USER, status: 'Active' });
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(200);
    expect(state.handlerRuns).toBe(1);
  });

  it('verifier init failure → 503 AUTH_SERVICE_UNAVAILABLE (no re-auth loop)', async () => {
    mockVerifyToken.mockRejectedValue(
      Object.assign(new Error('Authentication service is temporarily unavailable'), {
        code: 'AUTH_SERVICE_UNAVAILABLE'
      })
    );
    const { app, state } = makeApp();
    const res = await get(app, '/api/protected', { authorization: 'Bearer some-token' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service unavailable', details: {} });
    expect(state.handlerRuns).toBe(0);
  });
});

describe('GET /api/me behind the real middleware (A7 route contract)', () => {
  // Same mount as index.js: global authenticate, router at /api/me
  function makeMeApp() {
    const app = express();
    app.use(keycloakAuthMiddleware.authenticate);
    app.use('/api/me', meContextRoutes);
    return app;
  }

  it('no token → 401, route never answers', async () => {
    const res = await get(makeMeApp(), '/api/me');
    expect(res.status).toBe(401);
  });

  it('valid token → 200 with the provisioned user sanitized through req.user/req.claims', async () => {
    mockVerifyToken.mockResolvedValue(PAYLOAD);
    mockProvisionUser.mockResolvedValue({ ...ARANGO_USER, status: 'Active' });
    const res = await get(makeMeApp(), '/api/me', { authorization: 'Bearer valid-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._key).toBe(ARANGO_USER._key);
    expect(body.iss_sub).toBe(ARANGO_USER.iss_sub);
    expect(body.sub).toBe(PAYLOAD.sub); // req.claims populated by the real middleware
    expect(body.role).toBe('User');
  });
});
