'use strict';

// Mock shared-lib
const mockQuery = jest.fn();
const mockDb = {
  query: (...args) => mockQuery(...args)
};
const mockGetConnection = jest.fn().mockResolvedValue(mockDb);

jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: {
    getConnection: (...args) => mockGetConnection(...args)
  }
}), { virtual: true });

// Mock arangojs aql template tag
jest.mock('arangojs', () => ({
  aql: jest.fn((strings, ...values) => ({ _aql: true, strings, values }))
}));

const { mockJwtPayload } = require('./mocks/mockJwtPayload');
const userProvisioningService = require('../services/user-provisioning-service');

describe('userProvisioningService', () => {
  let mockCursor;

  beforeEach(() => {
    mockCursor = {
      next: jest.fn()
    };
    mockQuery.mockReset();
    mockCursor.next.mockReset();
    mockGetConnection.mockResolvedValue(mockDb);
    // Default: first query (soft-delete check) returns empty, second (upsert) returns user
    mockQuery
      .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // soft-delete check: not deleted
      .mockResolvedValue(mockCursor); // upsert: returns user
  });

  describe('provisionUser', () => {
    it('should create a new user with all required fields', async () => {
      const newUser = {
        _key: 'users/123',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'testuser@example.com',
        name: 'Test User',
        roles: ['user', 'admin'],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(newUser);

      const decoded = {
        ...mockJwtPayload,
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(mockQuery).toHaveBeenCalledTimes(2); // soft-delete check + upsert
      expect(mockCursor.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual(newUser);
    });

    it('should update mutable fields and preserve createdAt for existing user', async () => {
      const existingUser = {
        _key: 'users/456',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'updated@example.com',
        name: 'Updated Name',
        roles: ['user'],
        active: true,
        deleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(existingUser);

      const decoded = {
        ...mockJwtPayload,
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).toEqual(existingUser);
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
      // Verify the UPSERT query (2nd call) was called with updateDoc (no createdAt)
      const upsertCallArgs = mockQuery.mock.calls[1];
      expect(upsertCallArgs[1].updateDoc).toBeDefined();
      expect(upsertCallArgs[1].updateDoc.createdAt).toBeUndefined();
    });

    it('should update email when it changes in JWT on re-login', async () => {
      const updatedUser = {
        _key: 'users/456',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'newemail@example.com',
        name: 'Test User',
        roles: ['user', 'admin'],
        active: true,
        deleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(updatedUser);

      const decoded = {
        ...mockJwtPayload,
        email: 'newemail@example.com',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result.email).toBe('newemail@example.com');
      const upsertCallArgs = mockQuery.mock.calls[1];
      expect(upsertCallArgs[1].updateDoc.email).toBe('newemail@example.com');
    });

    it('should return null for soft-deleted user without running UPSERT', async () => {
      const deletedUser = {
        _key: 'users/789',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'testuser@example.com',
        name: 'Test User',
        roles: ['user'],
        active: false,
        deleted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z'
      };
      // First query (soft-delete check) returns the deleted user
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(deletedUser) }); // check finds deleted user

      const decoded = {
        ...mockJwtPayload,
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).toBeNull();
      // UPSERT should NOT have been called — only the soft-delete check query
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should throw error when ArangoDB is unreachable', async () => {
      mockQuery.mockRejectedValue(new Error('Connection refused'));

      const decoded = {
        ...mockJwtPayload,
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('Connection refused');
    });

    it('should update roles from JWT realm_access.roles', async () => {
      const userWithNewRoles = {
        _key: 'users/456',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'testuser@example.com',
        name: 'Test User',
        roles: ['super-admin'],
        active: true,
        deleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(userWithNewRoles);

      const decoded = {
        ...mockJwtPayload,
        realm_access: { roles: ['super-admin'] },
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      const result = await userProvisioningService.provisionUser(decoded);

      const upsertCallArgs = mockQuery.mock.calls[1];
      expect(upsertCallArgs[1].updateDoc.roles).toEqual(['super-admin']);
      expect(upsertCallArgs[1].newDoc.roles).toEqual(['super-admin']);
    });

    it('should use preferred_username when name is not in JWT', async () => {
      const user = {
        _key: 'users/123',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'testuser@example.com',
        name: 'testuser',
        roles: ['user'],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(user);

      const decoded = {
        ...mockJwtPayload,
        name: undefined,
        preferred_username: 'testuser',
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCallArgs = mockQuery.mock.calls[1];
      expect(upsertCallArgs[1].newDoc.name).toBe('testuser');
    });

    it('should set email and name to null when not in JWT', async () => {
      const user = {
        _key: 'users/123',
        iss_sub: 'http://localhost:8080/realms/genie#no-email-user',
        iss: 'http://localhost:8080/realms/genie',
        sub: 'no-email-user',
        email: null,
        name: null,
        roles: [],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue(user);

      const decoded = {
        sub: 'no-email-user',
        iss: 'http://localhost:8080/realms/genie',
        iss_sub: 'http://localhost:8080/realms/genie#no-email-user',
        realm_access: { roles: [] }
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCallArgs = mockQuery.mock.calls[1];
      expect(upsertCallArgs[1].newDoc.email).toBeNull();
      expect(upsertCallArgs[1].newDoc.name).toBeNull();
      expect(upsertCallArgs[1].newDoc.roles).toEqual([]);
    });

    it('should throw when UPSERT returns no result', async () => {
      mockCursor.next.mockResolvedValue(undefined);

      const decoded = {
        ...mockJwtPayload,
        iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('User provisioning returned no result');
    });

    it('should throw when decoded token has no iss_sub', async () => {
      const decoded = {
        ...mockJwtPayload,
        iss_sub: undefined
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('Missing iss_sub in decoded token');
    });
  });
});
