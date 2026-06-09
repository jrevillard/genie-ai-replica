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
    dbService: { getConnection: jest.fn() }
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

  mockDb = { query: jest.fn() };
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

      mockDb.query.mockResolvedValue(createMockCursor([{ new: cachedUser, old: null }]));

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

  describe('provisionUser - in-flight lock', () => {
    it('should deduplicate concurrent provisioning calls', async () => {
      const cachedUser = { _key: 'user-1', email: 'test@test.com' };
      const queryCount = { count: 0 };
      let firstCallResolve;

      mockDb.query.mockImplementation(async () => {
        queryCount.count++;
        // Only block the first call (legacy lookup)
        if (queryCount.count === 1) {
          await new Promise((r) => {
            firstCallResolve = r;
          });
        }
        return createMockCursor([{ new: cachedUser, old: null }]);
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

      // Queries: legacy lookup → migration update → deleted check → upsert
      mockDb.query
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
      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });

    it('should skip legacy migration when no email', async () => {
      const newUser = { _key: 'user-1', email: null };
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // deleted check
        .mockResolvedValueOnce(createMockCursor([{ new: newUser, old: null }])); // upsert

      const token = {
        iss_sub: 'iss/sub-1',
        iss: 'https://keycloak',
        sub: 'sub-1'
      };
      const result = await userProvisioningService.provisionUser(token);
      expect(result._key).toBe('user-1');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle no legacy user found', async () => {
      const newUser = { _key: 'user-1', email: 'test@test.com' };
      mockDb.query
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

  describe('_doProvision - soft-deleted user reactivation', () => {
    it('should reactivate soft-deleted user', async () => {
      const deletedUser = { _key: 'user-del', deleted: true, deletedAt: '2026-01-01' };
      const reactivatedUser = { _key: 'user-del', deleted: false, deletedAt: null };

      mockDb.query
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
