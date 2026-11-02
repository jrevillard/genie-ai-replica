// /api/me/context: real router mounted on a real express app (stream-route
// pattern); req.user is a provisioned-shaped stub (roles array — no scalar role).
// Pins the response whitelist and the A5 role derivation (admin membership).
const express = require('express');
const meContextRoutes = require('../routes/me-context-routes');

// Provisioned doc shape (user-provisioning-service): personalIdentification and
// addressResidency survive from legacy profile data; role must be DERIVED.
const ADMIN_USER = {
  iss_sub: 'http://localhost:8080/realms/genie#user-123',
  roles: ['user', 'admin'],
  emailVerified: true,
  personalIdentification: {
    fullName: 'Test User',
    dob: '1990-01-01',
    gender: 'n/a',
    nationality: 'Lesotho'
  },
  addressResidency: { currentAddress: 'Maseru' }
};

const PLAIN_USER = {
  iss_sub: 'http://localhost:8080/realms/genie#user-456',
  roles: ['user'],
  emailVerified: false
};

function makeApp(user, claims) {
  const app = express();
  app.use('/api/me', (req, res, next) => {
    req.user = user;
    if (claims) req.claims = claims;
    next();
  }, meContextRoutes);
  return app;
}

async function getRoute(user, path, claims) {
  const server = makeApp(user, claims).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

const getContext = (user) => getRoute(user, '/api/me/context');
const getMe = (user, claims) => getRoute(user, '/api/me', claims);

describe('GET /api/me (A7 sanitized identity)', () => {
  it('returns the whitelisted req.user doc with a real Arango _key', async () => {
    const user = {
      _key: 'user-123',
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      email: 'user@example.com',
      loginName: 'testuser',
      roles: ['user', 'admin'],
      emailVerified: true,
      status: 'Active',
      personalIdentification: { fullName: 'Test User' },
      // unlisted fields must NOT leak
      encPassword: 'x', farmerProfile: { shareWithAI: true }, addressResidency: { currentAddress: 'Maseru' }
    };
    const { status, body } = await getMe(user, { sub: 'user-123' });
    expect(status).toBe(200);
    expect(body).toEqual({
      _key: 'user-123',
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      sub: 'user-123',
      email: 'user@example.com',
      name: null,
      fullName: 'Test User',
      loginName: 'testuser',
      role: 'Admin',
      roles: ['user', 'admin'],
      emailVerified: true,
      status: 'Active'
    });
  });

  it('plain user derives role User; missing optional fields degrade to null', async () => {
    const { status, body } = await getMe({
      _key: 'user-456',
      iss_sub: 'http://localhost:8080/realms/genie#user-456',
      roles: ['user'],
      emailVerified: false,
      status: 'Pending'
    });
    expect(status).toBe(200);
    expect(body.role).toBe('User');
    expect(body.fullName).toBeNull();
    expect(body.loginName).toBeNull();
    expect(body.sub).toBeNull(); // no claims → null, not a crash
  });
});

describe('GET /api/me/context', () => {
  it('derives role Admin from the roles array and whitelists profile fields', async () => {
    const { status, body } = await getContext(ADMIN_USER);
    expect(status).toBe(200);
    expect(body).toEqual({
      personalIdentification: {
        fullName: 'Test User',
        dob: '1990-01-01',
        gender: 'n/a',
        nationality: 'Lesotho'
      },
      addressResidency: { currentAddress: 'Maseru' },
      role: 'Admin',
      emailVerified: true
    });
  });

  it('user without the admin role derives role User; stubs fill missing profile fields', async () => {
    const { status, body } = await getContext(PLAIN_USER);
    expect(status).toBe(200);
    expect(body.role).toBe('User');
    expect(body.personalIdentification.fullName).toBe('User'); // fallback stub
    expect(body.personalIdentification.dob).toBe('Not provided');
    expect(body.addressResidency.currentAddress).toBe('Not provided');
    expect(body.emailVerified).toBe(false);
  });

  it('farmerProfile is omitted unless the user opted in (shareWithAI)', async () => {
    const optedOut = { ...PLAIN_USER, farmerProfile: { shareWithAI: false, farmLocation: { district: 'Berea' } } };
    const { body } = await getContext(optedOut);
    expect(body).not.toHaveProperty('farmerProfile');

    const optedIn = {
      ...PLAIN_USER,
      farmerProfile: {
        shareWithAI: true,
        farmLocation: { district: 'Berea', village: 'Teyateyaneng', center: { lat: -29.1, lng: 27.8 }, plots: [{}, {}] }
      }
    };
    const { body: inBody } = await getContext(optedIn);
    expect(inBody.farmerProfile).toEqual({
      district: 'Berea',
      village: 'Teyateyaneng',
      farmLatitude: -29.1,
      farmLongitude: 27.8,
      numberOfPlots: 2
    });
  });
});
