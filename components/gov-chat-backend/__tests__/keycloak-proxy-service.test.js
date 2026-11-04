'use strict';

// Set env vars BEFORE any module that reads them is loaded
process.env.KEYCLOAK_URL = 'https://localhost/auth';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_PROXY_CLIENT_ID = 'genie-proxy-client';
process.env.KEYCLOAK_PROXY_CLIENT_SECRET = 'test-secret';

// Mock arangojs with aql helper that returns proper object structure
const mockAql = jest.fn((strings, ...values) => {
  // Simplified mock that returns an object with query property
  let query = strings.raw[0];
  for (let i = 0; i < values.length; i++) {
    // Replace placeholders with actual values for test inspection
    query += JSON.stringify(values[i]) + strings.raw[i + 1];
  }
  return { query, bindVars: {} };
});

jest.mock(
  'arangojs',
  () => ({
    aql: mockAql
  }),
  { virtual: true }
);

// Mock shared-lib
jest.mock(
  '../shared-lib',
  () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    dbService: {
      getConnection: jest.fn()
    },
    erasureTombstoneKey: require('../../shared/lib/erasure-tombstone').erasureTombstoneKey
  }),
  { virtual: true }
);

// The provisioner now requires keycloak-auth-service (the #1438 reactivation
// gate), which loads the ESM-only `jose` package — mock it so this suite
// (which transitively loads the provisioner) never parses it as CommonJS
jest.mock('jose', () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn()
}));

const keycloakProxyService = require('../services/keycloak-proxy-service');
const { dbService } = require('../shared-lib');

function mockCursor(result) {
  return { next: jest.fn().mockResolvedValue(result) };
}

function setupDbForResolve(result = { sub: 'uuid-12345', issSub: 'https://kc.example#sub-1' }) {
  // deleteUser makes TWO queries (UUID resolve + erasure) on TWO getConnection
  // calls — queue both explicitly so no queued value leaks in from another test.
  const db = { query: jest.fn().mockResolvedValueOnce(mockCursor(result)).mockResolvedValue({}) };
  dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db)).mockResolvedValueOnce(Promise.resolve(db));
  return db;
}

function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({ access_token: 'test-token-123' })
  };
}

function mockOkResponse(status = 204) {
  const resp = { ok: true, status };
  if (status !== 204) resp.json = async () => ({});
  return resp;
}

describe('keycloak-proxy-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce entries — drop them so
    // a failed test cannot leak its queued connections into the next one.
    dbService.getConnection.mockReset();
  });

  afterEach(() => {
    // The eviction/race tests seed the real provisioning cache — clear it
    // even when an assertion fails mid-test, so nothing leaks to the next test.
    require('../services/user-provisioning-service')._reset();
  });

  afterAll(() => {
    delete process.env.KEYCLOAK_PROXY_CLIENT_ID;
    delete process.env.KEYCLOAK_PROXY_CLIENT_SECRET;
  });

  describe('_resolveKeycloakUserId', () => {
    it('should throw if user not found', async () => {
      const db = { query: jest.fn().mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db));

      await expect(keycloakProxyService._resolveKeycloakUserId('missing-key')).rejects.toThrow('not found');
    });

    it('should resolve Keycloak UUID and provisioning identifier', async () => {
      const db = {
        query: jest.fn().mockResolvedValueOnce({
          next: jest.fn().mockResolvedValue({ sub: 'uuid-12345', issSub: 'https://kc.example#sub-1' })
        })
      };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db));

      const resolved = await keycloakProxyService._resolveKeycloakUserId('user-key-1');
      expect(resolved.sub).toBe('uuid-12345');
      expect(resolved.issSub).toBe('https://kc.example#sub-1');
    });

    it('should return null fields when the record has no sub/iss_sub (already erased)', async () => {
      const db = {
        query: jest.fn().mockResolvedValueOnce({
          next: jest.fn().mockResolvedValue({ sub: null, issSub: null })
        })
      };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db));

      const resolved = await keycloakProxyService._resolveKeycloakUserId('user-key-1');
      expect(resolved.sub).toBeNull();
      expect(resolved.issSub).toBeNull();
    });
  });

  describe('getServiceAccountToken', () => {
    it('should obtain a token via client credentials grant', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse());

      const result = await keycloakProxyService.getServiceAccountToken();
      expect(result).toBe('test-token-123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/protocol/openid-connect/token'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw on token acquisition failure', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid client'
      });

      await expect(keycloakProxyService.getServiceAccountToken()).rejects.toThrow(
        'Failed to obtain service account token'
      );
    });

    it('should return cached token without fetching', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse());

      const first = await keycloakProxyService.getServiceAccountToken();
      expect(first).toBe('test-token-123');

      // Second call should use cache — no new fetch
      await keycloakProxyService.getServiceAccountToken();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteUser', () => {
    it('should delete from Keycloak and set deleted=true in ArangoDB', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' })); // UUID resolution
      db.query.mockResolvedValueOnce({}); // ArangoDB update
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');
      expect(db.query).toHaveBeenCalledTimes(3); // resolve + erasure + duplicate cleanup
    });

    it('should remove racing duplicates by iss_sub at erasure commit time', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      // Third query: with iss_sub still known, remove documents a racing
      // provision inserted under it (new _key the erasure UPDATE never matches)
      const cleanupAql = capturedAql[2];
      expect(cleanupAql.query).toContain('u.iss_sub ==');
      expect(cleanupAql.query).toContain('u._key !=');
      expect(cleanupAql.query).toContain('REMOVE');
    });

    it('should nullify all PII fields (email, name, sub, iss, iss_sub)', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      expect(capturedAql).toHaveLength(3); // resolve + erasure + duplicate cleanup
      const updateAql = capturedAql[1];
      expect(updateAql).toHaveProperty('query');
      expect(updateAql.query).toContain('email: null');
      expect(updateAql.query).toContain('name: null');
      expect(updateAql.query).toContain('sub: null');
      expect(updateAql.query).toContain('iss: null');
      expect(updateAql.query).toContain('iss_sub: null');
    });

    it('should set roles, active, deleted, and erasedAt', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      const updateAql = capturedAql[1];
      expect(updateAql.query).toContain('roles: []');
      expect(updateAql.query).toContain('active: false');
      expect(updateAql.query).toContain('deleted: true');
      expect(updateAql.query).toContain('erasedAt: DATE_ISO8601(DATE_NOW())');
    });

    it('should write the erasure tombstone (erased_key = SHA256 of iss_sub) before nulling it', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      const updateAql = capturedAql[1];
      // Exact assignment with the bound digest — the comment text alone must
      // not satisfy this assertion (mutation gate).
      const expectedDigest = require('crypto').createHash('sha256').update('https://kc.example#sub-1').digest('hex');
      expect(updateAql.query).toContain(`erased_key: "${expectedDigest}"`);
    });

    it('should UNSET personalIdentification custom PII field', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      const updateAql = capturedAql[1];
      expect(updateAql.query).toContain('personalIdentification: null');
    });

    it('should log "User erased" message (distinct from soft-delete)', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));

      const { logger } = require('../shared-lib');
      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
      db.query.mockResolvedValueOnce({});
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('User erased'), expect.any(Object));
    });

    it('should handle double-erase gracefully (idempotent on 404)', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204)); // First delete

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
      db.query.mockResolvedValueOnce({});
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      // First delete
      await keycloakProxyService.deleteUser('user-key');
      expect(db.query).toHaveBeenCalledTimes(3); // resolve + erasure + duplicate cleanup

      // Second delete - Keycloak will return 404 (user already gone) and the
      // ArangoDB document is already erased (iss_sub nulled, tombstone set).
      // deleteUser() is idempotent: 404 skips the Keycloak delete but still
      // completes the ArangoDB erasure, and the existing tombstone is KEPT —
      // overwriting it with null would let the still-valid token resurrect
      // the identity.
      keycloakProxyService._clearTokenCache();
      db.query = jest.fn();
      db.query.mockResolvedValueOnce(mockCursor({ sub: null, issSub: null })); // already-erased doc
      db.query.mockResolvedValueOnce({}); // ArangoDB erasure must still run
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' });

      // Keycloak 404 should NOT throw — erasure is idempotent
      await expect(keycloakProxyService.deleteUser('user-key')).resolves.not.toThrow();
      expect(db.query).toHaveBeenCalledTimes(3); // resolve + erasure + duplicate cleanup (404 did not abort)

      // The existing tombstone must survive the re-erasure (kept, not nulled)
      const reAql = db.query.mock.calls[1][0];
      expect(reAql.query).toContain('u.erased_key');
      expect(reAql.query).toContain('? u.erased_key');
    });

    it('should still erase ArangoDB when the Keycloak record is already gone (404)', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' });

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1) {
            return Promise.resolve(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
          }
          return Promise.resolve({});
        })
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser('user-key');

      expect(capturedAql).toHaveLength(3); // resolve + erasure + duplicate cleanup
      expect(capturedAql[1].query).toContain('erased_key');
      expect(capturedAql[1].query).toContain('deleted: true');
    });

    it('should evict the provisioning cache so the next provision re-reads the database', async () => {
      const userProvisioningService = require('../services/user-provisioning-service');
      userProvisioningService._reset();
      const issSub = 'https://kc.example#sub-1';

      // Seed the real provisioning cache: provision the user through the
      // actual service (its DB is the mocked shared-lib dbService).
      keycloakProxyService._clearTokenCache();
      const seedDb = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // tombstone — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // deleted check — miss
          .mockResolvedValueOnce({
            next: jest.fn().mockResolvedValue({
              new: { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] },
              old: null
            })
          })
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // post-INSERT re-check — miss
      };
      // Erase through the proxy — this must evict the entry
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));
      const eraseDb = { query: jest.fn() };
      eraseDb.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub }));
      eraseDb.query.mockResolvedValueOnce({});
      dbService.getConnection
        .mockResolvedValueOnce(Promise.resolve(seedDb)) // cache seeding provision
        .mockResolvedValueOnce(Promise.resolve(eraseDb)) // deleteUser — resolve query
        .mockResolvedValueOnce(Promise.resolve(eraseDb)); // deleteUser — erasure update
      const cached = await userProvisioningService.provisionUser({
        iss_sub: issSub,
        iss: 'https://kc.example',
        sub: 'sub-1',
        email: 'test@test.com'
      });
      expect(cached._key).toBe('user-1');

      await keycloakProxyService.deleteUser('user-key');

      // Next provision must NOT serve the cached pre-erasure profile
      const freshDb = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // tombstone — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // deleted check — miss
          .mockResolvedValueOnce({
            next: jest.fn().mockResolvedValue({
              new: { _key: 'user-fresh', email: 'test@test.com', name: null, emailVerified: false, roles: [] },
              old: null
            })
          })
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // post-INSERT re-check — miss
      };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(freshDb));
      const after = await userProvisioningService.provisionUser({
        iss_sub: issSub,
        iss: 'https://kc.example',
        sub: 'sub-1',
        email: 'test@test.com'
      });

      // A DB round-trip happened (cache was evicted — without the eviction
      // the cached pre-erasure document would come back with zero queries)
      expect(freshDb.query).toHaveBeenCalled();
      expect(after._key).toBe('user-fresh');
      userProvisioningService._reset();
    });

    it('should re-evict after the erasure, so a provision racing the erase cannot leave a stale cached profile', async () => {
      const userProvisioningService = require('../services/user-provisioning-service');
      userProvisioningService._reset();
      const issSub = 'https://kc.example#sub-1';
      const claims = { iss_sub: issSub, iss: 'https://kc.example', sub: 'sub-1', email: 'test@test.com' };

      const provisionChain = () =>
        jest
          .fn()
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // tombstone — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy — miss
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // deleted check — miss
          .mockResolvedValueOnce({
            next: jest.fn().mockResolvedValue({
              new: { _key: 'user-race', email: 'test@test.com', name: null, emailVerified: false, roles: [] },
              old: null
            })
          })
          .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }); // post-INSERT re-check — miss

      // Cache seeded before the erasure starts
      keycloakProxyService._clearTokenCache();
      const seedDb = { query: provisionChain() };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(seedDb));
      await userProvisioningService.provisionUser(claims);

      // A provision that RACES the erasure: it runs while deleteUser is
      // resolving the Keycloak UUID (i.e. after the pre-delete eviction) and
      // re-populates the cache with the pre-erasure profile.
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204));
      const eraseDb = { query: jest.fn() };
      eraseDb.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub })); // resolve
      eraseDb.query.mockImplementationOnce(async () => {
        // Concurrent provision re-caches the profile while the erasure commits
        dbService.getConnection.mockResolvedValueOnce(Promise.resolve({ query: provisionChain() }));
        const racing = await userProvisioningService.provisionUser(claims);
        expect(racing._key).toBe('user-race');
        return {};
      });
      dbService.getConnection
        .mockResolvedValueOnce(Promise.resolve(eraseDb)) // deleteUser — resolve query
        .mockResolvedValueOnce(Promise.resolve(eraseDb)); // deleteUser — erasure update

      await keycloakProxyService.deleteUser('user-key');

      // The racing provision's re-cached profile must not survive the erasure
      const freshDb = { query: provisionChain() };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(freshDb));
      const after = await userProvisioningService.provisionUser(claims);
      expect(freshDb.query).toHaveBeenCalled(); // cache was empty — re-evicted post-erasure
      expect(after._key).toBe('user-race');
      userProvisioningService._reset();
    });

    it('should throw partial erasure error if ArangoDB update fails after Keycloak delete', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockOkResponse(204)); // Keycloak DELETE succeeds

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' }));
      db.query.mockRejectedValueOnce(new Error('ArangoDB connection lost')); // ArangoDB fails
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      const { logger } = require('../shared-lib');

      // Should throw partial erasure error
      await expect(keycloakProxyService.deleteUser('user-key')).rejects.toThrow(
        'Partial erasure: user deleted from Keycloak but ArangoDB erasure failed'
      );

      // Should log the error state
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('ArangoDB erasure failed after Keycloak delete'),
        expect.objectContaining({
          userKey: 'user-key',
          state: 'PARTIAL_ERASURE'
        })
      );
    });
  });

  // Soft-delete vs Erasure Distinction (documented here for reference)
  //
  // markUserAsDeleted() in user-provisioning-service.js:
  //   - Sets: deleted: true, deletedAt: now, updatedAt: now
  //   - Preserves: sub, iss_sub, email, name, roles (re-activatable via Story 3.6)
  //
  // deleteUser() in keycloak-proxy-service.js (this file):
  //   - Sets: deleted: true, erasedAt: now, AND nullifies all PII including sub, iss_sub
  //   - Permanent, not re-activatable
  //
  // Actual verification of markUserAsDeleted behavior is in user-provisioning-service.test.js

  describe('updateOwnProfile', () => {
    it('should update profile via Account API with user token', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockOkResponse(200));

      await keycloakProxyService.updateOwnProfile('user-access-token', { email: 'new@test.com' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('/realms/genie/account');
      expect(options.method).toBe('PUT');
      expect(options.headers.Authorization).toBe('Bearer user-access-token');
    });

    it('should throw on Account API error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'Duplicate email' });

      await expect(keycloakProxyService.updateOwnProfile('token', { email: 'dup@test.com' })).rejects.toThrow(
        'Conflict in Keycloak operation'
      );
    });
  });

  describe('_mapKeycloakError', () => {
    it('should map 404 to user not found', () => {
      const error = keycloakProxyService._mapKeycloakError(404, 'Not found', '/users/x');
      expect(error.message).toBe('User not found in Keycloak');
      expect(error.status).toBe(404);
    });

    it('should map 403 to insufficient permissions', () => {
      const error = keycloakProxyService._mapKeycloakError(403, 'Forbidden', '/users/x');
      expect(error.message).toBe('Insufficient permissions for Keycloak operation');
    });

    it('should map 409 to conflict', () => {
      const error = keycloakProxyService._mapKeycloakError(409, 'Conflict', '/users/x');
      expect(error.message).toBe('Conflict in Keycloak operation (e.g. duplicate email)');
    });

    it('should map 401 to authentication failed', () => {
      const error = keycloakProxyService._mapKeycloakError(401, 'Unauthorized', '/admin/realms');
      expect(error.message).toBe('Keycloak authentication failed');
      expect(error.status).toBe(401);
    });

    it('should map unknown status to generic Keycloak API error', () => {
      const error = keycloakProxyService._mapKeycloakError(500, 'Server Error', '/admin/realms');
      expect(error.message).toBe('Keycloak API error: 500');
      expect(error.status).toBe(500);
    });
  });

  describe('_adminApiCall', () => {
    it('should lazy-refresh token on 401', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse()) // initial token
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Expired' })
        .mockResolvedValueOnce(mockTokenResponse()) // refreshed token
        .mockResolvedValueOnce(mockOkResponse(204)); // retry

      setupDbForResolve({ sub: 'uuid-abc', issSub: 'https://kc.example#sub-1' });

      await keycloakProxyService.deleteUser('user-key');
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });
});
