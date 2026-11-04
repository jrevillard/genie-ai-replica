'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() },
    erasureTombstoneKey: require('../../../shared/lib/erasure-tombstone').erasureTombstoneKey
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

let userProvisioningService;
let mockDb;

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockDb = {
    query: jest.fn(),
    collection: jest.fn().mockReturnValue({ ensureIndex: jest.fn().mockResolvedValue({}) })
  };
  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    userProvisioningService = require('../../services/user-provisioning-service');
  });
  userProvisioningService._reset();
});

afterEach(() => {
  userProvisioningService._reset();
});

describe('UserProvisioningService', () => {
  describe('initialize', () => {
    it('should not crash when the index cannot be ensured (fresh, unmigrated database)', async () => {
      mockDb.collection = jest.fn().mockReturnValue({
        ensureIndex: jest.fn().mockRejectedValue(new Error('collection users not found'))
      });
      await expect(userProvisioningService.initialize()).resolves.not.toThrow();
      const { logger } = require('../../shared-lib');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to ensure erased_key index'),
        expect.any(Object)
      );
    });

    it('should set initialized flag and log completion', async () => {
      await userProvisioningService.initialize();
      const { logger } = require('../../shared-lib');
      expect(logger.info).toHaveBeenCalledWith('[UserProvisioning] Schema initialization complete');
      // Second call returns early (skip re-init)
      await userProvisioningService.initialize();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('provisionUser - cache', () => {
    it('should return cached user when cache is valid', async () => {
      const cachedUser = { _key: 'user-1', email: 'test@test.com' };

      // Call 1: full provision chain (tombstone → legacy → deleted check → UPSERT).
      // Default: empty cursors — a second call that misses the cache fails
      // loudly instead of reading a garbage truthy lookup.
      mockDb.query
        .mockResolvedValue(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: cachedUser, old: null }])); // upsert

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result1 = await userProvisioningService.provisionUser(token);
      expect(result1._key).toBe('user-1');

      // Second call should hit cache — no additional DB queries
      const callsBefore = mockDb.query.mock.calls.length;
      const result2 = await userProvisioningService.provisionUser(token);
      expect(result2._key).toBe('user-1');
      expect(mockDb.query.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('provisionUser - cache epoch', () => {
    it('must not cache a provision that spanned a cache eviction', async () => {
      const staleUser = { _key: 'user-stale', email: 'test@test.com' };
      const freshUser = { _key: 'user-fresh', email: 'test@test.com' };

      // The tombstone lookup's cursor triggers an eviction (as the GDPR erasure
      // would) WHILE the provision is between its queries.
      const tombstoneCursor = {
        next: jest.fn(async () => {
          userProvisioningService.invalidateCache('iss/sub-1');
          return undefined;
        })
      };
      mockDb.query
        .mockResolvedValueOnce(tombstoneCursor) // tombstone lookup — miss, evicts mid-flight
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: staleUser, old: null }])); // upsert

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result1 = await userProvisioningService.provisionUser(token);
      expect(result1._key).toBe('user-stale');

      // The stale result must NOT have been cached: the next provision must
      // round-trip the database again.
      const freshDbQuery = jest
        .fn()
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: freshUser, old: null }]));
      const { dbService } = require('../../shared-lib');
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve({ query: freshDbQuery }));
      const result2 = await userProvisioningService.provisionUser(token);
      expect(result2._key).toBe('user-fresh');
    });
  });

  describe('provisionUser - in-flight lock', () => {
    it('should deduplicate concurrent provisioning calls', async () => {
      const cachedUser = { _key: 'user-1', email: 'test@test.com' };
      const queryCount = { count: 0 };
      let firstCallResolve;

      mockDb.query.mockImplementation(async (aqlObj) => {
        queryCount.count++;
        // Only block the first call (tombstone lookup) to keep the provision in-flight
        if (queryCount.count === 1) {
          await new Promise((r) => {
            firstCallResolve = r;
          });
        }
        // Route by query contract: tombstone miss, lookup misses, UPSERT returns the user
        const q = aqlObj.strings.join('');
        if (q.includes('erased_key')) return createMockCursor([]); // tombstone — miss
        if (q.includes('UPSERT')) return createMockCursor([{ new: cachedUser, old: null }]);
        return createMockCursor([]); // legacy lookup / deleted check — miss
      });

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub', email: 'test@test.com' };

      // Start first provision (blocks on first DB call)
      const p1 = userProvisioningService.provisionUser(token);

      // Yield to event loop so p1 starts and sets the lock
      await new Promise((r) => setImmediate(r));

      // Start second provision — should find the in-flight lock
      const p2 = userProvisioningService.provisionUser(token);

      // Release the first DB call
      firstCallResolve();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1._key).toBe('user-1');
      expect(r2._key).toBe('user-1');
      // First call queries are shared — second call uses in-flight lock
      expect(queryCount.count).toBeLessThanOrEqual(4); // at most one full provision cycle
    }, 10000);
  });

  describe('provisionUser - error paths', () => {
    it('should throw when iss_sub is missing', async () => {
      await expect(userProvisioningService.provisionUser({ email: 'test@test.com' })).rejects.toThrow(
        'Missing iss_sub'
      );
    });

    it('should throw when UPSERT returns no result', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const token = { iss_sub: 'iss/sub-1', iss: 'iss', sub: 'sub', email: 'test@test.com' };
      await expect(userProvisioningService.provisionUser(token)).rejects.toThrow(
        'User provisioning returned no result'
      );
    });
  });

  describe('_doProvision - legacy user migration', () => {
    it('should migrate legacy user when email matches without iss_sub', async () => {
      const legacyUser = { _key: 'user-legacy', email: 'old@test.com', iss_sub: null, name: 'Legacy Name' };
      const newUser = { _key: 'user-new', email: 'old@test.com', iss_sub: 'iss/sub-1' };

      // Queries: tombstone lookup → legacy lookup → migration update → deleted check → upsert
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([legacyUser])) // legacy email lookup
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(null) }) // migration UPDATE (no cursor needed)
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: legacyUser }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'old@test.com',
        name: 'New Name'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-new');
      expect(mockDb.query).toHaveBeenCalledTimes(5);
    });

    it('should skip legacy migration when no email', async () => {
      const newUser = { _key: 'user-1', email: null };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-1');
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it('should handle no legacy user found', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup (no match)
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'test@test.com'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-1');
    });
  });

  describe('_doProvision - erasure tombstone', () => {
    // The GDPR erasure (keycloak-proxy-service.deleteUser) nulls iss_sub, email,
    // name, sub and iss on the user document and writes erased_key = SHA256(iss_sub)
    // as a tombstone. Provisioning must recognize the erased subject through the
    // tombstone and never INSERT a fresh document from the still-valid token claims.
    const erasedDoc = {
      _key: 'user-erased',
      deleted: true,
      erasedAt: '2026-11-04T00:00:00.000Z',
      email: null,
      iss_sub: null,
      erased_key: 'hash-of-iss-sub'
    };

    const token = {
      iss_sub: 'iss/sub-1',
      iss: 'https://keycloak',
      sub: 'sub-1',
      email: 'test@test.com'
    };

    it('should not resurrect an erased user — return the erased document and skip the UPSERT', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([erasedDoc])); // tombstone lookup — match

      const result = await userProvisioningService.provisionUser(token);

      expect(result._key).toBe('user-erased');
      expect(result.deleted).toBe(true);
      // Tombstone lookup contract: match on erased_key bound to the SHA-256
      // digest of the token's iss_sub, on a document whose iss_sub was nulled.
      const tombstoneQuery = mockDb.query.mock.calls[0][0];
      expect(tombstoneQuery.strings.join('')).toContain('u.erased_key ==');
      expect(tombstoneQuery.strings.join('')).toContain('u.iss_sub == null');
      const expectedDigest = require('crypto').createHash('sha256').update('iss/sub-1').digest('hex');
      expect(tombstoneQuery.values[0]).toBe(expectedDigest);
      // Only the tombstone lookup ran — no legacy migration, no soft-delete check, no UPSERT
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const { logger } = require('../../shared-lib');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('erased user'));
    });

    it('should serve the erased document from cache on the next request', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([erasedDoc])); // tombstone lookup — match

      await userProvisioningService.provisionUser(token);
      const callsBefore = mockDb.query.mock.calls.length;
      const result = await userProvisioningService.provisionUser(token);

      expect(result._key).toBe('user-erased');
      expect(result.deleted).toBe(true);
      expect(mockDb.query.mock.calls.length).toBe(callsBefore);
    });

    it('should provision normally when the tombstone lookup does not match', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com', deleted: false };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])); // upsert

      const result = await userProvisioningService.provisionUser(token);

      expect(result._key).toBe('user-1');
      expect(result.deleted).toBe(false);
    });
  });

  describe('_doProvision - soft-deleted user reactivation', () => {
    it('should reactivate soft-deleted user', async () => {
      const deletedUser = { _key: 'user-del', deleted: true, deletedAt: '2026-01-01' };
      const reactivatedUser = { _key: 'user-del', deleted: false, deletedAt: null };

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([deletedUser])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: reactivatedUser, old: deletedUser }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'test@test.com'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result.deleted).toBe(false);
    });
  });

  describe('_doProvision - logging branches', () => {
    it('should log "User provisioned" for new user (no old doc)', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'test@test.com'
      };
      await userProvisioningService.provisionUser(token);
      const { logger } = require('../../shared-lib');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('User provisioned'));
    });

    it('should log "User profile updated" for existing user', async () => {
      const oldUser = { _key: 'user-1', email: 'test@test.com' };
      const updatedUser = { _key: 'user-1', email: 'test@test.com' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: updatedUser, old: oldUser }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'test@test.com'
      };
      await userProvisioningService.provisionUser(token);
      const { logger } = require('../../shared-lib');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('User profile updated'));
    });
  });

  describe('markUserAsDeleted', () => {
    it('should mark user as deleted and log', async () => {
      const deletedUser = { _key: 'user-1', deleted: true };
      mockDb.query.mockResolvedValue(createMockCursor([deletedUser]));
      await userProvisioningService.markUserAsDeleted('iss/sub-1');
      const { logger } = require('../../shared-lib');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('marked as deleted'));
    });

    it('should warn when user not found for deletion', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      await userProvisioningService.markUserAsDeleted('iss/sub-unknown');
      const { logger } = require('../../shared-lib');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not found for deletion'));
    });
  });
});
