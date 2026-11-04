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
    erasureTombstoneKey: require('../../../shared/lib/erasure-tombstone').erasureTombstoneKey,
    parsePositiveInt: require('../../../shared/lib/validation-utils').parsePositiveInt
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

// #1438: the reactivation gate consults Keycloak through this helper
const mockCheckUserStatusInKeycloak = jest.fn();
jest.mock('../../services/keycloak-auth-service', () => ({
  checkUserStatusInKeycloak: (...args) => mockCheckUserStatusInKeycloak(...args)
}));

// #1443: cross-replica invalidation rides the existing Redis instance
jest.mock('ioredis', () => require('../mocks/ioredis'));

const AUTH = { token: 'test-token', issuer: 'https://keycloak' };

let userProvisioningService;
let mockDb;

function createMockCursor(results) {
  return {
    // Driver-faithful: arangojs resolves an exhausted cursor's next() with
    // undefined, not null
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : undefined),
    all: jest.fn().mockResolvedValue(results)
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  const MockRedis = require('ioredis');
  MockRedis.instances.length = 0;

  mockDb = {
    query: jest.fn(),
    collection: jest.fn().mockReturnValue({ ensureIndex: jest.fn().mockResolvedValue({}) })
  };
  const { dbService } = require('../../shared-lib');
  // clearAllMocks leaves queued mockResolvedValueOnce entries in place — drop
  // them so a test that does not consume its queue cannot poison the next one.
  dbService.getConnection.mockReset();
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
      const cachedUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };

      // Call 1: full provision chain (tombstone → legacy → deleted check → UPSERT).
      // Default: empty cursors — a second call that misses the cache fails
      // loudly instead of reading a garbage truthy lookup.
      mockDb.query
        .mockResolvedValue(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: cachedUser, old: null }])) // upsert
        .mockResolvedValueOnce(createMockCursor([])); // revalidation deleted-check → not deleted

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result1 = await userProvisioningService.provisionUser(token);
      expect(result1._key).toBe('user-1');

      // Second call revalidates the cached copy (one soft-delete read) and
      // serves it from cache — no UPSERT re-runs
      const callsBefore = mockDb.query.mock.calls.length;
      const result2 = await userProvisioningService.provisionUser(token);
      expect(result2).toBe(result1);
      expect(mockDb.query.mock.calls.length).toBe(callsBefore + 1); // one revalidation read, nothing more
    });
  });

  describe('provisionUser - cache revalidation', () => {
    const baseToken = {
      iss_sub: 'iss/sub-1',
      iss: 'https://keycloak',
      sub: 'sub-1',
      email: 'test@test.com',
      name: 'Old Name'
    };

    // Mock one full provision cycle: tombstone → legacy lookup → deleted check → upsert → re-check
    function mockProvisionCycle(name, roles = []) {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(
          createMockCursor([
            { new: { _key: 'user-1', email: 'test@test.com', name, emailVerified: false, roles }, old: null }
          ])
        ) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss
    }

    it('should re-provision on a cache hit when Keycloak claims changed', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);
      expect(result1.name).toBe('Old Name');

      mockProvisionCycle('JIT Test');
      const result2 = await userProvisioningService.provisionUser({ ...baseToken, name: 'JIT Test' });
      expect(result2.name).toBe('JIT Test'); // only a full re-provision can produce the new name
    });

    it('should re-provision on a cache hit when the underlying document is soft-deleted', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);
      expect(result1.name).toBe('Old Name');

      const reactivated = {
        _key: 'user-1',
        email: 'test@test.com',
        name: 'Old Name',
        emailVerified: false,
        roles: [],
        deleted: false,
        active: true
      };
      let call = 0;
      mockDb.query.mockImplementation(async (query) => {
        call++;
        if (call === 1) {
          // The revalidation read must ignore GDPR-erased documents: they
          // carry deleted:true AND a nulled iss_sub, and re-provisioning one
          // would re-materialize the erasure
          expect(query.strings.join(' ')).toContain('iss_sub != null');
        }
        if (call === 1) {
          // Cache-hit revalidation: answers "deleted" only for a _key-based
          // lookup — an iss_sub-based lookup must miss (GDPR erasure nulls
          // iss_sub, so detection must not depend on it)
          return query.values[0] === 'user-1'
            ? createMockCursor([{ _key: 'user-1', deleted: true }])
            : createMockCursor([]);
        }
        if (call === 2) {
          return createMockCursor([]); // tombstone — miss
        }
        if (call === 4) {
          return createMockCursor([{ _key: 'user-1', iss_sub: 'iss/sub-1', deleted: true }]); // deleted check → reactivation
        }
        if (call === 5) {
          return createMockCursor([{ new: reactivated, old: { _key: 'user-1', deleted: true } }]); // upsert
        }
        return createMockCursor([]); // legacy lookups (call 3)
      });
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });

      const result2 = await userProvisioningService.provisionUser(baseToken, AUTH);
      expect(result2.deleted).toBe(false);
      expect(result2.active).toBe(true);
    });

    it('should not re-provision when only the roles order differs', async () => {
      const tokenRoles = { ...baseToken, realm_access: { roles: ['user', 'offline_access'] } };
      mockProvisionCycle('Old Name', ['user', 'offline_access']);
      const result1 = await userProvisioningService.provisionUser(tokenRoles);
      expect(result1.roles).toEqual(['user', 'offline_access']);

      // Keycloak does not guarantee a stable role order between token mints
      const reordered = { ...baseToken, realm_access: { roles: ['offline_access', 'user'] } };
      mockDb.query.mockResolvedValue(createMockCursor([])); // revalidation deleted-check → not deleted
      mockDb.query.mockImplementation((q) => {
        console.error('Q:', (q.strings || ['?']).join(' ').replace(/\s+/g, ' ').slice(0, 70));
        return createMockCursor([]);
      });
      const callsBefore = mockDb.query.mock.calls.length;
      const result2 = await userProvisioningService.provisionUser(reordered);
      expect(result2).toBe(result1);
      expect(mockDb.query.mock.calls.length).toBe(callsBefore + 1);
    });

    it('should re-provision when the roles differ only by duplicated entries', async () => {
      const tokenRoles = { ...baseToken, realm_access: { roles: ['user', 'offline_access'] } };
      mockProvisionCycle('Old Name', ['user', 'offline_access']);
      const result1 = await userProvisioningService.provisionUser(tokenRoles);

      // ['user', 'user'] is not the same role set — a multiset compare would
      // serve the cached copy
      const duplicated = { ...baseToken, realm_access: { roles: ['user', 'user'] } };
      // A real UPSERT writes the token's own profile — the mocked result must
      // carry it, or the wrapper's profile gate would (correctly) re-provision
      mockProvisionCycle('Old Name', ['user', 'user']);
      const result2 = await userProvisioningService.provisionUser(duplicated);
      expect(result2).not.toBe(result1); // full re-provision ran
      expect(result2.roles).toEqual(['user', 'user']);
    });

    it('should serve the cached copy when the revalidation read outlives its deadline', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      // Never-resolving read: the revalidation deadline must fail open
      // instead of hanging the request
      mockDb.query.mockImplementation(() => new Promise(() => {}));
      jest.useFakeTimers();
      try {
        const pending = userProvisioningService.provisionUser(baseToken);
        await jest.advanceTimersByTimeAsync(3000); // REVALIDATION_TIMEOUT_MS
        const result2 = await pending;
        expect(result2).toBe(result1); // fail-open after the deadline, not a hang
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not crash on a read that rejects after the deadline has already failed open', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      // Read stalls past the deadline, then errors: the abandoned chain must
      // be handled, or the process-level rejection handler takes the backend down
      mockDb.query.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('socket reset')), 3500);
          })
      );
      jest.useFakeTimers();
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const pending = userProvisioningService.provisionUser(baseToken);
        await jest.advanceTimersByTimeAsync(3000); // deadline wins the race
        const result2 = await pending;
        expect(result2).toBe(result1);
        await jest.advanceTimersByTimeAsync(1000); // the abandoned read rejects here
        await jest.advanceTimersByTimeAsync(0); // drain the queue so the rejection propagates
        expect(unhandled).not.toHaveBeenCalled(); // the chain was handled, not leaked
      } finally {
        process.off('unhandledRejection', unhandled);
        jest.useRealTimers();
      }
    });

    it('should serve the cached copy when the connection acquisition itself hangs', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      const { dbService } = require('../../shared-lib');
      dbService.getConnection.mockImplementation(() => new Promise(() => {}));
      jest.useFakeTimers();
      try {
        const pending = userProvisioningService.provisionUser(baseToken);
        await jest.advanceTimersByTimeAsync(3000);
        const result2 = await pending;
        expect(result2).toBe(result1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should warn about revalidation failures at most once per TTL window', async () => {
      mockProvisionCycle('Old Name');
      await userProvisioningService.provisionUser(baseToken);

      mockDb.query.mockRejectedValue(new Error('arangosh down'));
      await userProvisioningService.provisionUser(baseToken);
      await userProvisioningService.provisionUser(baseToken);
      const { logger } = require('../../shared-lib');
      const revalWarns = logger.warn.mock.calls.filter((c) => String(c[0]).includes('revalidation failed'));
      expect(revalWarns).toHaveLength(1);
      // The once-per-TTL line must identify the affected account
      expect(revalWarns[0][0]).toContain('user document user-1');
    });

    it('should serve a valid cache hit with exactly one revalidation read (no UPSERT)', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      mockDb.query.mockResolvedValue(createMockCursor([])); // revalidation deleted-check → not deleted
      const callsBefore = mockDb.query.mock.calls.length;
      const result2 = await userProvisioningService.provisionUser(baseToken);
      expect(result2).toBe(result1); // same cached object — no re-provision
      expect(mockDb.query.mock.calls.length).toBe(callsBefore + 1); // one revalidation read, nothing more
    });

    it('should not re-provision on a cache hit when only non-profile claims differ', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      mockDb.query.mockResolvedValue(createMockCursor([])); // revalidation deleted-check → not deleted
      const callsBefore = mockDb.query.mock.calls.length;
      // jti changes on every token mint but is not a profile field the UPSERT updates
      const result2 = await userProvisioningService.provisionUser({ ...baseToken, jti: 'mint-2' });
      expect(result2).toBe(result1);
      expect(mockDb.query.mock.calls.length).toBe(callsBefore + 1);
    });

    it('should serve the cached copy when the soft-delete revalidation read fails', async () => {
      mockProvisionCycle('Old Name');
      const result1 = await userProvisioningService.provisionUser(baseToken);

      mockDb.query.mockRejectedValue(new Error('arangosh down'));
      const result2 = await userProvisioningService.provisionUser(baseToken);
      expect(result2).toBe(result1); // fail-open: TTL-bounded stale copy, no 500
    });

    it('should not serve a stale in-flight result to a request whose claims differ', async () => {
      const staleUser = { _key: 'user-1', email: 'test@test.com', name: 'Old Name', emailVerified: false, roles: [] };
      const freshUser = { _key: 'user-1', email: 'test@test.com', name: 'JIT Test', emailVerified: false, roles: [] };
      let resolveFirstLegacy;
      let calls = 0;

      mockDb.query.mockImplementation(async () => {
        calls++;
        if (calls === 2) {
          await new Promise((r) => {
            resolveFirstLegacy = r;
          }); // block A on its legacy lookup
          return createMockCursor([]);
        }
        if (calls === 4) return createMockCursor([{ new: staleUser, old: null }]); // A upsert
        if (calls === 5) return createMockCursor([]); // A post-INSERT re-check
        if (calls === 9) return createMockCursor([{ new: freshUser, old: null }]); // B upsert
        if (calls === 10) return createMockCursor([]); // B post-INSERT re-check
        return createMockCursor([]); // tombstone + legacy lookups + deleted checks
      });

      // Request A provisions with the OLD claims (holds the lock)
      const p1 = userProvisioningService.provisionUser(baseToken);
      await new Promise((r) => setImmediate(r));

      // Request B arrives with NEW claims while A is still in flight
      const p2 = userProvisioningService.provisionUser({ ...baseToken, name: 'JIT Test' });
      await new Promise((r) => setImmediate(r));

      resolveFirstLegacy();
      const r1 = await p1;
      const r2 = await p2;

      expect(r1.name).toBe('Old Name'); // A served its own result
      expect(r2.name).toBe('JIT Test'); // B re-provisioned, not served A's stale result
      expect(calls).toBe(10); // A: 5 queries, B: full re-provision (5 queries)
    });
  });

  describe('provisionUser - cache epoch', () => {
    it('must not cache a provision that spanned a cache eviction', async () => {
      const staleUser = { _key: 'user-stale', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      const freshUser = { _key: 'user-fresh', email: 'test@test.com', name: null, emailVerified: false, roles: [] };

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
        .mockResolvedValueOnce(createMockCursor([{ new: staleUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])) // post-INSERT re-check — miss
        // The caller's re-provision (epoch moved while this provision ran):
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: freshUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result1 = await userProvisioningService.provisionUser(token);
      // The caller never receives the stale profile: the wrapper re-provisioned
      expect(result1._key).toBe('user-fresh');
      // Full provision ran twice (original + caller re-provision): 10 queries
      expect(mockDb.query).toHaveBeenCalledTimes(10);
    });
  });

  describe('provisionUser - erasure racing an in-flight provision', () => {
    it('must not serve the pre-erasure profile to the provision caller or a lock waiter', async () => {
      const preUser = {
        _key: 'user-pre',
        deleted: false,
        email: 'test@test.com',
        name: null,
        emailVerified: false,
        roles: []
      };
      const preOld = { _key: 'user-pre', deleted: false };
      const erasedDoc = { _key: 'user-erased', deleted: true, iss_sub: null, erased_key: 'digest' };
      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };

      // Provision A blocks on its tombstone lookup while the erasure commits
      // (invalidateCache) right before its UPSERT resolves.
      let releaseA;
      const gate = new Promise((r) => {
        releaseA = r;
      });
      mockDb.query
        .mockResolvedValueOnce({ next: () => gate.then(() => undefined) }) // A: tombstone — blocked, then miss
        .mockResolvedValueOnce(createMockCursor([])) // A: legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // A: deleted check — miss
        .mockResolvedValueOnce({
          next: async () => {
            // The erasure commits mid-provision: cache evicted (epoch bumped)
            userProvisioningService.invalidateCache('iss/sub-1');
            return { new: preUser, old: preOld };
          }
        }) // A: upsert — returns the pre-erasure profile
        .mockResolvedValueOnce(createMockCursor([erasedDoc])) // A: own-path post-UPSERT re-check — erased
        .mockResolvedValueOnce(createMockCursor([erasedDoc])) // A: wrapper re-provision tombstone — erased
        .mockResolvedValueOnce(createMockCursor([erasedDoc])); // B: wrapper re-provision tombstone — erased

      const p1 = userProvisioningService.provisionUser(token);
      await new Promise((r) => setImmediate(r)); // let A hold the lock
      const p2 = userProvisioningService.provisionUser(token); // B: waits on the lock
      releaseA();

      const [r1, r2] = await Promise.all([p1, p2]);
      // Neither caller may receive the pre-erasure profile: both re-provision
      // against the post-erasure state and get the erased document.
      expect(r1._key).toBe('user-erased');
      expect(r1.deleted).toBe(true);
      expect(r2._key).toBe('user-erased');
      expect(r2.deleted).toBe(true);
    });
  });

  describe('provisionUser - post-UPSERT re-check on the UPDATE path', () => {
    it('must not return a racer-duplicate refreshed after the erasure committed', async () => {
      // Provision B's UPSERT matched a duplicate a racer inserted before the
      // erasure committed (result.old truthy — the UPDATE path). The re-check
      // must still catch the erasure, remove the refreshed duplicate and serve
      // the erased document.
      const dupDoc = { _key: 'user-dup', deleted: false, iss_sub: 'iss/sub-1', email: 'test@test.com' };
      const existingDoc = { _key: 'user-dup', deleted: false };
      const erasedDoc = { _key: 'user-erased', deleted: true, iss_sub: null, erased_key: 'digest' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss (pre-commit)
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: dupDoc, old: existingDoc }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([erasedDoc])) // post-UPSERT re-check — erased
        .mockResolvedValueOnce({}); // REMOVE of the refreshed duplicate

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result = await userProvisioningService.provisionUser(token);

      expect(result._key).toBe('user-erased');
      expect(result.deleted).toBe(true);
      // The duplicate (not the tombstone document) was removed
      const removeCall = mockDb.query.mock.calls.find((c) => JSON.stringify(c[0].values || []).includes('user-dup'));
      expect(removeCall).toBeDefined();
    });

    it('must still serve the erased document when the duplicate removal loses a race', async () => {
      const dupDoc = { _key: 'user-dup', deleted: false, iss_sub: 'iss/sub-1', email: 'test@test.com' };
      const existingDoc = { _key: 'user-dup', deleted: false };
      const erasedDoc = { _key: 'user-erased', deleted: true, iss_sub: null, erased_key: 'digest' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: dupDoc, old: existingDoc }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([erasedDoc])) // post-UPSERT re-check — erased
        .mockRejectedValue({ arangoError: true, message: 'document not found (1202)' }); // REMOVE lost the race

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result = await userProvisioningService.provisionUser(token);

      // The erasure wins either way — the caller is never 500-ed for it
      expect(result._key).toBe('user-erased');
      expect(result.deleted).toBe(true);
    });
  });

  describe('provisionUser - insert racing the erasure (#1440 mitigation)', () => {
    it('must remove a fresh INSERT whose subject was erased mid-provision', async () => {
      const freshDoc = { _key: 'user-resurrected', deleted: false, email: 'test@test.com' };
      const erasedDoc = { _key: 'user-erased', deleted: true, iss_sub: null, erased_key: 'digest' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss (erasure not yet committed)
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: freshDoc, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([erasedDoc])) // post-INSERT tombstone re-check — erased
        .mockResolvedValueOnce({}); // REMOVE of the just-inserted document

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result = await userProvisioningService.provisionUser(token);

      // The resurrected document is gone and the erased document is served
      expect(result._key).toBe('user-erased');
      expect(result.deleted).toBe(true);
      const removeCall = mockDb.query.mock.calls.find((c) =>
        JSON.stringify(c[0].values || []).includes('user-resurrected')
      );
      expect(removeCall).toBeDefined();
    });
  });

  describe('provisionUser - in-flight lock', () => {
    it('should deduplicate concurrent provisioning calls', async () => {
      // Provision results always carry the full profile shape (newDoc sets
      // every field) — the in-flight result must satisfy profileMatches to
      // be served to the second caller
      const cachedUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
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
      expect(queryCount.count).toBeLessThanOrEqual(5); // one full provision cycle + INSERT re-check
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
      const newUser = {
        _key: 'user-new',
        email: 'old@test.com',
        iss_sub: 'iss/sub-1',
        name: 'New Name',
        emailVerified: false,
        roles: []
      };

      // Queries: tombstone lookup → legacy lookup → migration update → deleted check → upsert
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([legacyUser])) // legacy email lookup
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(null) }) // migration UPDATE (no cursor needed)
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: legacyUser }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check — miss

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'old@test.com',
        name: 'New Name'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-new');
      expect(mockDb.query).toHaveBeenCalledTimes(6); // tombstone + legacy + migration + deleted check + upsert + re-check
      // No bind in the migration UPDATE may be undefined — an undefined bind
      // is dropped by arangojs's aql tag and produces malformed AQL
      const migrationBinds = mockDb.query.mock.calls[2][0].values.flat();
      expect(migrationBinds.length).toBeGreaterThan(0);
      for (const bind of migrationBinds) {
        expect(bind).not.toBeUndefined();
      }
    });

    it('should not bind undefined in the migration UPDATE when neither the token nor the legacy document carries a name', async () => {
      // profile.name is null (no name, no preferred_username) and the legacy
      // document has no name field — the UPDATE must still bind null, because
      // an undefined bind is dropped by arangojs's aql tag and corrupts the AQL
      const legacyUser = { _key: 'user-legacy', email: 'old@test.com', iss_sub: null };
      const newUser = {
        _key: 'user-new',
        email: 'old@test.com',
        iss_sub: 'iss/sub-1',
        name: null,
        emailVerified: false,
        roles: []
      };

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([legacyUser])) // legacy email lookup
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(null) }) // migration UPDATE
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: legacyUser }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check — miss

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'old@test.com' };
      await userProvisioningService.provisionUser(token);
      const migrationBinds = mockDb.query.mock.calls[2][0].values.flat();
      for (const bind of migrationBinds) {
        expect(bind).not.toBeUndefined();
      }
    });

    it('should skip legacy migration when no email', async () => {
      const newUser = { _key: 'user-1', email: null, name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-1');
      expect(mockDb.query).toHaveBeenCalledTimes(4); // tombstone + deleted check + upsert + INSERT re-check
    });

    it('should handle no legacy user found', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup (no match)
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

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
      const newUser = {
        _key: 'user-1',
        email: 'test@test.com',
        deleted: false,
        name: null,
        emailVerified: false,
        roles: []
      };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

      const result = await userProvisioningService.provisionUser(token);

      expect(result._key).toBe('user-1');
      expect(result.deleted).toBe(false);
    });
  });

  describe('_doProvision - soft-deleted user reactivation', () => {
    it('should reactivate soft-deleted user', async () => {
      const deletedUser = { _key: 'user-del', deleted: true, deletedAt: '2026-01-01' };
      const reactivatedUser = {
        _key: 'user-del',
        deleted: false,
        deletedAt: null,
        name: null,
        emailVerified: false,
        roles: [],
        email: 'test@test.com'
      };

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([deletedUser])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: reactivatedUser, old: deletedUser }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check — miss
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1',
        email: 'test@test.com'
      };
      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(false);
    });
  });

  describe('_doProvision - logging branches', () => {
    it('should log "User provisioned" for new user (no old doc)', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

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
      const oldUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      const updatedUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: updatedUser, old: oldUser }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check — miss

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

  describe('provisionUser - Keycloak-gated reactivation (#1438)', () => {
    const deletedUser = { _key: 'user-del', deleted: true, deletedAt: '2026-01-01' };
    const reactivatedUser = {
      _key: 'user-del',
      deleted: false,
      deletedAt: null,
      name: null,
      emailVerified: false,
      roles: [],
      email: 'test@test.com'
    };
    const token = {
      iss_sub: 'iss/sub-1',
      iss: 'https://keycloak',
      sub: 'sub-1',
      email: 'test@test.com'
    };

    // Deleted-check answers "reactivation"; the remaining queries are misses
    function mockReactivationQueries() {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([deletedUser])) // deleted check → reactivation
        .mockResolvedValueOnce(createMockCursor([{ new: reactivatedUser, old: deletedUser }])) // upsert — UPDATE
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check — miss
    }

    it('should reactivate when Keycloak reports the account enabled', async () => {
      mockReactivationQueries();
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });

      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(false);
      expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledWith(AUTH.token, AUTH.issuer);
    });

    it('should refuse reactivation when Keycloak reports the account disabled', async () => {
      mockReactivationQueries();
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: false, disabled: true });

      const queriesBefore = mockDb.query.mock.calls.length;
      const result = await userProvisioningService.provisionUser(token, AUTH);

      // The UPSERT must NOT run — the disable is not silently undone
      expect(mockDb.query.mock.calls.length).toBe(queriesBefore + 3); // tombstone + legacy + deleted check only
      expect(result.deleted).toBe(true);

      // The refusal is cached like the tombstone's: within the TTL the next
      // request is refused without re-consulting Keycloak or the database
      const cached = await userProvisioningService.provisionUser(token, AUTH);
      expect(cached.deleted).toBe(true);
      expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledTimes(1);
    });

    it('should refuse reactivation when the Keycloak status check fails (fail-closed)', async () => {
      mockReactivationQueries();
      mockCheckUserStatusInKeycloak.mockResolvedValue(null);

      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(true);
    });

    it('must not cache the refusal of an inconclusive Keycloak check (re-ask next request)', async () => {
      // A transient Keycloak failure must not poison the cache for the TTL:
      // once Keycloak recovers the account IS reactivated on the next
      // request, without waiting out the 60 s
      mockReactivationQueries();
      mockCheckUserStatusInKeycloak.mockResolvedValueOnce(null);

      await userProvisioningService.provisionUser(token, AUTH);

      // Next request: Keycloak answers — the reactivation must run the full
      // chain (the refusal was NOT cached) and the UPSERT proceeds.
      // mockReset between the phases: a Once queue survives clearAllMocks,
      // so a leftover answer would leak into the next test's gate.
      mockDb.query.mockReset();
      mockReactivationQueries();
      mockCheckUserStatusInKeycloak.mockReset();
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });
      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(false);
      expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledTimes(1);
    });

    it('should refuse reactivation when no auth context is supplied (fail-closed)', async () => {
      mockReactivationQueries();

      const result = await userProvisioningService.provisionUser(token);
      expect(result.deleted).toBe(true);
      expect(mockCheckUserStatusInKeycloak).not.toHaveBeenCalled();
    });

    it('must gate the legacy-migration path too (a soft-deleted legacy doc is a reactivation)', async () => {
      // A pre-iss_sub document that was soft-deleted out-of-band must not be
      // migrated (reactivated) without Keycloak's confirmation either
      const legacyDeleted = { _key: 'legacy-del', iss_sub: null, deleted: true, email: 'test@test.com' };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([legacyDeleted])); // legacy lookup — matches
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: false, disabled: true });

      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(true);
      // No migration UPDATE, no deleted-check, no UPSERT
      expect(mockDb.query.mock.calls.length).toBe(2);
    });

    it('should migrate a soft-deleted legacy user when Keycloak confirms enabled', async () => {
      const legacyDeleted = { _key: 'legacy-del', iss_sub: null, deleted: true, email: 'test@test.com' };
      const migrated = {
        _key: 'legacy-del',
        iss_sub: 'iss/sub-1',
        deleted: false,
        deletedAt: null,
        name: null,
        emailVerified: false,
        roles: [],
        email: 'test@test.com'
      };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([legacyDeleted])) // legacy lookup — matches
        .mockResolvedValueOnce(createMockCursor([])) // migration UPDATE
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — iss_sub path now misses (already migrated)
        .mockResolvedValueOnce(createMockCursor([{ new: migrated, old: legacyDeleted }])) // upsert
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check
      mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });

      const result = await userProvisioningService.provisionUser(token, AUTH);
      expect(result.deleted).toBe(false);
      expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledWith(AUTH.token, AUTH.issuer);
    });

    it('should not consult Keycloak on the non-reactivation path', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone lookup
        .mockResolvedValueOnce(createMockCursor([])) // legacy lookup
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss (no reactivation)
        .mockResolvedValueOnce(
          createMockCursor([
            {
              new: { _key: 'u', deleted: false, name: null, emailVerified: false, roles: [], email: 'test@test.com' },
              old: null
            }
          ])
        ) // upsert
        .mockResolvedValueOnce(createMockCursor([])); // post-UPSERT re-check

      await userProvisioningService.provisionUser(token, AUTH);
      expect(mockCheckUserStatusInKeycloak).not.toHaveBeenCalled();
    });
  });

  describe('cross-replica cache invalidation (#1443)', () => {
    const MockRedis = require('ioredis');
    const token = {
      iss_sub: 'iss/sub-1',
      iss: 'https://keycloak',
      sub: 'sub-1',
      email: 'test@test.com'
    };

    it('should broadcast an invalidation to the Redis channel', async () => {
      userProvisioningService.invalidateCache('iss/sub-1');
      const publisher = MockRedis.instances.find((i) => i.publish.mock.calls.length > 0);
      expect(publisher).toBeDefined();
      const [channel, payload] = publisher.publish.mock.calls[0];
      expect(channel).toBe('user-provisioning:invalidate');
      // The envelope carries the origin so the publisher's own subscriber
      // can drop the loopback delivery (its local eviction already ran)
      const envelope = JSON.parse(payload);
      expect(envelope.issSub).toBe('iss/sub-1');
      expect(typeof envelope.origin).toBe('string');
    });

    it('should not throw when the publish fails', async () => {
      userProvisioningService.invalidateCache('iss/sub-1'); // creates the publisher
      const publisher = MockRedis.instances.find((i) => i.publish.mock.calls.length > 0);
      publisher.publish.mockRejectedValue(new Error('redis down'));

      expect(() => userProvisioningService.invalidateCache('iss/sub-2')).not.toThrow();
      // Drain the microtask queue so the fire-and-forget rejection lands
      await new Promise((r) => setImmediate(r));
      const { logger } = require('../../shared-lib');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalidation publish failed'),
        expect.any(Object)
      );
    });

    it('should subscribe to the invalidation channel at initialization', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      expect(subscriber).toBeDefined();
      expect(subscriber.subscribe).toHaveBeenCalledWith('user-provisioning:invalidate');
    });

    it('should evict the local cache when a remote invalidation arrives', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      const handler = subscriber.on.mock.calls.find((c) => c[0] === 'message')[1];

      // Warm the cache with one full provision
      const cachedUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone
        .mockResolvedValueOnce(createMockCursor([])) // legacy
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: cachedUser, old: null }])) // upsert
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check
      await userProvisioningService.provisionUser(token);

      // Remote replica erased/marked the user: it broadcasts, we receive
      handler('user-provisioning:invalidate', JSON.stringify({ origin: 'other-replica', issSub: 'iss/sub-1' }));

      // The next provision must NOT be served from the cache — it re-runs
      // the full chain (5 queries again)
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([{ new: { ...cachedUser, deleted: true }, old: null }]))
        .mockResolvedValueOnce(createMockCursor([]));
      const result = await userProvisioningService.provisionUser(token);
      expect(result.deleted).toBe(true); // fresh provision, not the warm cached copy
    });

    it('must not re-broadcast a received invalidation', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      const handler = subscriber.on.mock.calls.find((c) => c[0] === 'message')[1];

      handler('user-provisioning:invalidate', JSON.stringify({ origin: 'other-replica', issSub: 'iss/sub-1' }));
      const publisher = MockRedis.instances.find((i) => i.publish.mock.calls.length > 0);
      expect(publisher).toBeUndefined();
    });

    it('must ignore its own loopback delivery (no double eviction)', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      const handler = subscriber.on.mock.calls.find((c) => c[0] === 'message')[1];
      userProvisioningService.invalidateCache('iss/warm-1'); // creates the publisher
      const publisher = MockRedis.instances.find((i) => i.publish.mock.calls.length > 0);
      const ownOrigin = JSON.parse(publisher.publish.mock.calls[0][1]).origin;

      // Warm the cache with one full provision
      const cachedUser = { _key: 'user-1', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // tombstone
        .mockResolvedValueOnce(createMockCursor([])) // legacy
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: cachedUser, old: null }])) // upsert
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check
      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      await userProvisioningService.provisionUser(token);

      // The publisher's own subscriber receives the same message — it must
      // be dropped, or the local eviction runs twice (extra epoch bump)
      handler('user-provisioning:invalidate', JSON.stringify({ origin: ownOrigin, issSub: 'iss/sub-1' }));

      // The cache is still warm: the next provision costs one revalidation read only
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const before = mockDb.query.mock.calls.length;
      await userProvisioningService.provisionUser(token);
      expect(mockDb.query.mock.calls.length).toBe(before + 1);
    });

    it('must ignore a malformed payload without crashing', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      const handler = subscriber.on.mock.calls.find((c) => c[0] === 'message')[1];

      expect(() => handler('user-provisioning:invalidate', 'not-json')).not.toThrow();
    });

    it('must not cache a provision that spanned a remote invalidation', async () => {
      await userProvisioningService.initialize();
      const subscriber = MockRedis.instances.find((i) => i.subscribe.mock.calls.length > 0);
      const handler = subscriber.on.mock.calls.find((c) => c[0] === 'message')[1];

      const staleUser = { _key: 'user-stale', email: 'test@test.com', name: null, emailVerified: false, roles: [] };
      const freshUser = { _key: 'user-fresh', email: 'test@test.com', name: null, emailVerified: false, roles: [] };

      // The tombstone lookup's cursor triggers a REMOTE invalidation (as an
      // erasure committing on another replica would) while the provision is
      // between its queries — the epoch bump must discard this provision's
      // own result, or the pre-erasure profile gets cached for the TTL.
      const tombstoneCursor = {
        next: jest.fn(async () => {
          handler('user-provisioning:invalidate', JSON.stringify({ origin: 'other-replica', issSub: 'iss/sub-1' }));
          return undefined;
        })
      };
      mockDb.query
        .mockResolvedValueOnce(tombstoneCursor) // tombstone lookup — miss, remote eviction mid-flight
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: staleUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])) // post-INSERT re-check — miss
        // The caller's re-provision (epoch moved while this provision ran):
        .mockResolvedValueOnce(createMockCursor([])) // tombstone — miss
        .mockResolvedValueOnce(createMockCursor([])) // legacy — miss
        .mockResolvedValueOnce(createMockCursor([])) // deleted check — miss
        .mockResolvedValueOnce(createMockCursor([{ new: freshUser, old: null }])) // upsert — fresh INSERT
        .mockResolvedValueOnce(createMockCursor([])); // post-INSERT re-check — miss

      const token = { iss_sub: 'iss/sub-1', iss: 'https://keycloak', sub: 'sub-1', email: 'test@test.com' };
      const result = await userProvisioningService.provisionUser(token);
      // The post-remote-eviction re-provision's result is served — the
      // discarded provision must not win
      expect(result._key).toBe('user-fresh');
    });

    it('should not crash initialization when the subscriber cannot be created', async () => {
      jest.isolateModules(() => {
        userProvisioningService = require('../../services/user-provisioning-service');
      });
      userProvisioningService._reset();
      const MockRedisBroken = require('ioredis');
      MockRedisBroken.mockImplementationOnce(() => {
        throw new Error('redis connection refused');
      });
      await expect(userProvisioningService.initialize()).resolves.not.toThrow();
    });
  });
});
