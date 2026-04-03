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

const { mockJwtPayload } = require('../test-fixtures/mockJwtPayload');
const userProvisioningService = require('../services/user-provisioning-service');

describe('userProvisioningService', () => {
  let mockCursor;
  const ISS_SUB = 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012';

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
      .mockResolvedValue(mockCursor); // upsert: returns { new, old }
  });

  describe('provisionUser', () => {
    it('should create a new user with all required fields', async () => {
      const newUser = {
        _key: 'users/123',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: newUser, old: null });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(mockQuery).toHaveBeenCalledTimes(2); // soft-delete check + upsert
      expect(mockCursor.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual(newUser);
    });

    it('should update mutable fields and preserve createdAt for existing user', async () => {
      const existingUser = {
        _key: 'users/456',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: existingUser, old: { _key: 'users/456' } });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).toEqual(existingUser);
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
      // Verify the UPSERT uses UPDATE (not REPLACE) — updateDoc is the 3rd interpolated value
      // aql`UPSERT { iss_sub: ${issSub} } INSERT ${newDoc} UPDATE ${updateDoc} IN users`
      // values: [issSub, newDoc, updateDoc]
      const upsertCall = mockQuery.mock.calls[1][0];
      const upsertValues = upsertCall.values;
      const updateDoc = upsertValues[2]; // 3rd interpolated value
      expect(updateDoc).toBeDefined();
      expect(updateDoc.createdAt).toBeUndefined();
    });

    it('should update email when it changes in JWT on re-login', async () => {
      const updatedUser = {
        _key: 'users/456',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: updatedUser, old: { _key: 'users/456' } });

      const decoded = {
        ...mockJwtPayload,
        email: 'newemail@example.com',
        iss_sub: ISS_SUB
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result.email).toBe('newemail@example.com');
      const upsertCall = mockQuery.mock.calls[1][0];
      const updateDoc = upsertCall.values[2];
      expect(updateDoc.email).toBe('newemail@example.com');
    });

    it('should return null for soft-deleted user without running UPSERT', async () => {
      const deletedUser = {
        _key: 'users/789',
        iss_sub: ISS_SUB,
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
        iss_sub: ISS_SUB
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).toBeNull();
      // UPSERT should NOT have been called — only the soft-delete check query
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should throw error when ArangoDB query fails', async () => {
      mockQuery.mockRejectedValue(new Error('Connection refused'));

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('Connection refused');
    });

    it('should throw error when dbService.getConnection() fails', async () => {
      mockGetConnection.mockRejectedValue(new Error('ArangoDB unreachable'));

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('ArangoDB unreachable');
    });

    it('should update roles from JWT realm_access.roles', async () => {
      const userWithNewRoles = {
        _key: 'users/456',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: userWithNewRoles, old: { _key: 'users/456' } });

      const decoded = {
        ...mockJwtPayload,
        realm_access: { roles: ['super-admin'] },
        iss_sub: ISS_SUB
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      const upsertValues = upsertCall.values;
      expect(upsertValues[2].roles).toEqual(['super-admin']); // updateDoc
      expect(upsertValues[1].roles).toEqual(['super-admin']); // newDoc
    });

    it('should use preferred_username when name is not in JWT', async () => {
      const user = {
        _key: 'users/123',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        ...mockJwtPayload,
        name: undefined,
        preferred_username: 'testuser',
        iss_sub: ISS_SUB
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      expect(upsertCall.values[1].name).toBe('testuser'); // newDoc
    });

    it('should set email and name to null when not in JWT', async () => {
      const user = {
        _key: 'users/123',
        iss_sub: ISS_SUB,
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
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        sub: 'no-email-user',
        iss: 'http://localhost:8080/realms/genie',
        iss_sub: ISS_SUB,
        realm_access: { roles: [] }
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      expect(upsertCall.values[1].email).toBeNull(); // newDoc
      expect(upsertCall.values[1].name).toBeNull(); // newDoc
      expect(upsertCall.values[1].roles).toEqual([]); // newDoc
    });

    it('should set roles to empty array when realm_access is missing', async () => {
      const user = {
        _key: 'users/123',
        iss_sub: ISS_SUB,
        iss: 'http://localhost:8080/realms/genie',
        sub: '12345678-1234-1234-1234-123456789012',
        email: 'testuser@example.com',
        name: 'Test User',
        roles: [],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      };
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        sub: '12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        iss_sub: ISS_SUB
        // no realm_access
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      expect(upsertCall.values[1].roles).toEqual([]); // newDoc
      expect(upsertCall.values[2].roles).toEqual([]); // updateDoc
    });

    it('should throw when UPSERT returns no result', async () => {
      mockCursor.next.mockResolvedValue(undefined);

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
      };

      await expect(userProvisioningService.provisionUser(decoded))
        .rejects.toThrow('User provisioning returned no result');
    });

    it('should throw when UPSERT returns result without new', async () => {
      mockCursor.next.mockResolvedValue({ old: { _key: 'users/123' } });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB
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

    it('should log "User provisioned" for new users', async () => {
      const newUser = {
        _key: 'users/123',
        iss_sub: ISS_SUB,
        deleted: false
      };
      mockCursor.next.mockResolvedValue({ new: newUser, old: null });

      const decoded = { ...mockJwtPayload, iss_sub: ISS_SUB };
      const { logger } = require('../shared-lib');

      await userProvisioningService.provisionUser(decoded);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('User provisioned')
      );
    });

    it('should log "User profile updated" for existing users', async () => {
      const existingUser = {
        _key: 'users/456',
        iss_sub: ISS_SUB,
        deleted: false
      };
      mockCursor.next.mockResolvedValue({ new: existingUser, old: { _key: 'users/456' } });

      const decoded = { ...mockJwtPayload, iss_sub: ISS_SUB };
      const { logger } = require('../shared-lib');

      await userProvisioningService.provisionUser(decoded);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('User profile updated')
      );
    });
  });
});
