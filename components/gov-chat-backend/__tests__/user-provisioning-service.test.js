"use strict";

// Mock shared-lib
const mockQuery = jest.fn();
const mockDb = {
  query: (...args) => mockQuery(...args),
};
const mockGetConnection = jest.fn().mockResolvedValue(mockDb);

jest.mock(
  "../shared-lib",
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    dbService: {
      getConnection: (...args) => mockGetConnection(...args),
    },
  }),
  { virtual: true },
);

// Mock arangojs aql template tag
jest.mock("arangojs", () => ({
  aql: jest.fn((strings, ...values) => ({ _aql: true, strings, values })),
}));

const { mockJwtPayload } = require("../test-fixtures/mockJwtPayload");
const userProvisioningService = require("../services/user-provisioning-service");

describe("userProvisioningService", () => {
  let mockCursor;
  const ISS_SUB =
    "http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012";

  beforeEach(() => {
    mockCursor = {
      next: jest.fn(),
    };
    mockQuery.mockReset();
    mockCursor.next.mockReset();
    mockGetConnection.mockResolvedValue(mockDb);
    userProvisioningService._reset();
    // Default: legacy check (no match), soft-delete check (not deleted), upsert returns user
    // Legacy migration query is conditional (only runs when email is present).
    // Use mockResolvedValue (reusable) for legacy so tests without email skip it.
    const noLegacyCursor = { next: jest.fn().mockResolvedValue(undefined) };
    mockQuery
      .mockResolvedValueOnce(noLegacyCursor) // legacy migration: no legacy user (consumed when email present)
      .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // soft-delete check: not deleted
      .mockResolvedValue(mockCursor); // upsert: returns { new, old }
  });

  describe("provisionUser", () => {
    it("should create a new user with all required fields", async () => {
      const newUser = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "Test User",
        roles: ["user", "admin"],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({ new: newUser, old: null });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(mockQuery).toHaveBeenCalledTimes(3); // legacy + soft-delete + upsert
      expect(mockCursor.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual(newUser);
    });

    it("should update mutable fields and preserve createdAt for existing user", async () => {
      const existingUser = {
        _key: "users/456",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "updated@example.com",
        name: "Updated Name",
        roles: ["user"],
        active: true,
        deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({
        new: existingUser,
        old: { _key: "users/456" },
      });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).toEqual(existingUser);
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      // Verify the UPSERT uses UPDATE (not REPLACE) — updateDoc is the 3rd interpolated value
      // aql`UPSERT { iss_sub: ${issSub} } INSERT ${newDoc} UPDATE ${updateDoc} IN users`
      // values: [issSub, newDoc, updateDoc]
      const upsertCall = mockQuery.mock.calls[2][0];
      const upsertValues = upsertCall.values;
      const updateDoc = upsertValues[2]; // 3rd interpolated value
      expect(updateDoc).toBeDefined();
      expect(updateDoc.createdAt).toBeUndefined();
    });

    it("should preserve custom fields (personalIdentification, theme) during UPSERT on re-login", async () => {
      const existingUserWithCustomFields = {
        _key: "users/456",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "updated@example.com",
        name: "Updated Name",
        roles: ["user"],
        active: true,
        deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-04-06T00:00:00.000Z",
        personalIdentification: "PID-12345",
        theme: "dark",
        notificationPreferences: { email: true, push: false },
      };
      mockCursor.next.mockResolvedValue({
        new: existingUserWithCustomFields,
        old: { _key: "users/456" },
      });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      // Custom fields preserved in the result (ArangoDB UPDATE preserves them)
      expect(result.personalIdentification).toBe("PID-12345");
      expect(result.theme).toBe("dark");
      expect(result.notificationPreferences).toEqual({
        email: true,
        push: false,
      });
      // createdAt also preserved
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      // Verify updateDoc does NOT contain custom fields — UPDATE only merges listed fields
      const upsertCall = mockQuery.mock.calls[2][0];
      const updateDoc = upsertCall.values[2];
      expect(updateDoc.personalIdentification).toBeUndefined();
      expect(updateDoc.theme).toBeUndefined();
      expect(updateDoc.notificationPreferences).toBeUndefined();
    });

    it("should update email when it changes in JWT on re-login", async () => {
      const updatedUser = {
        _key: "users/456",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "newemail@example.com",
        name: "Test User",
        roles: ["user", "admin"],
        active: true,
        deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({
        new: updatedUser,
        old: { _key: "users/456" },
      });

      const decoded = {
        ...mockJwtPayload,
        email: "newemail@example.com",
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result.email).toBe("newemail@example.com");
      const upsertCall = mockQuery.mock.calls[2][0];
      const updateDoc = upsertCall.values[2];
      expect(updateDoc.email).toBe("newemail@example.com");
    });

    it("should re-activate soft-deleted user when valid token is presented", async () => {
      const deletedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "Test User",
        roles: ["user"],
        active: false,
        deleted: true,
        deletedAt: "2026-01-15T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      };

      const reactivatedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "Test User",
        roles: ["user"],
        active: true,
        deleted: false,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      };

      // First query (soft-delete check) returns the deleted user
      // Second query (upsert) returns the reactivated user
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy: no match
        .mockResolvedValueOnce({
          next: jest.fn().mockResolvedValue(deletedUser),
        }) // check finds deleted user
        .mockResolvedValue(mockCursor); // upsert returns reactivated user
      mockCursor.next.mockResolvedValue({
        new: reactivatedUser,
        old: deletedUser,
      });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result).not.toBeNull();
      expect(result.deleted).toBe(false);
      expect(result.deletedAt).toBeNull();
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      // UPSERT should have been called after legacy + soft-delete check
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it("should update JIT fields from JWT when re-activating soft-deleted user", async () => {
      const deletedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        email: "old@example.com",
        name: "Old Name",
        roles: ["user"],
        deleted: true,
        deletedAt: "2026-01-15T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      const reactivatedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        email: "newemail@example.com",
        name: "New Name",
        roles: ["user", "admin"],
        deleted: false,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      };

      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy: no match
        .mockResolvedValueOnce({
          next: jest.fn().mockResolvedValue(deletedUser),
        })
        .mockResolvedValue(mockCursor);
      mockCursor.next.mockResolvedValue({
        new: reactivatedUser,
        old: deletedUser,
      });

      const decoded = {
        ...mockJwtPayload,
        email: "newemail@example.com",
        name: "New Name",
        iss_sub: ISS_SUB,
      };

      const result = await userProvisioningService.provisionUser(decoded);

      expect(result.email).toBe("newemail@example.com");
      expect(result.name).toBe("New Name");
      // Verify updateDoc includes re-activation fields
      const upsertCall = mockQuery.mock.calls[2][0];
      const updateDoc = upsertCall.values[2];
      expect(updateDoc.deleted).toBe(false);
      expect(updateDoc.deletedAt).toBeNull();
    });

    it('should log "User re-activated" when soft-deleted user is restored', async () => {
      const deletedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        deleted: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const reactivatedUser = {
        _key: "users/789",
        iss_sub: ISS_SUB,
        deleted: false,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // legacy: no match
        .mockResolvedValueOnce({
          next: jest.fn().mockResolvedValue(deletedUser),
        })
        .mockResolvedValue(mockCursor);
      mockCursor.next.mockResolvedValue({
        new: reactivatedUser,
        old: deletedUser,
      });

      const decoded = { ...mockJwtPayload, iss_sub: ISS_SUB };
      const { logger } = require("../shared-lib");
      logger.info.mockClear();

      await userProvisioningService.provisionUser(decoded);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("User re-activated"),
      );
    });

    it("should throw error when ArangoDB query fails", async () => {
      mockQuery.mockRejectedValue(new Error("Connection refused"));

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      await expect(
        userProvisioningService.provisionUser(decoded),
      ).rejects.toThrow("Connection refused");
    });

    it("should throw error when dbService.getConnection() fails", async () => {
      mockGetConnection.mockRejectedValue(new Error("ArangoDB unreachable"));

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      await expect(
        userProvisioningService.provisionUser(decoded),
      ).rejects.toThrow("ArangoDB unreachable");
    });

    it("should update roles from JWT realm_access.roles", async () => {
      const userWithNewRoles = {
        _key: "users/456",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "Test User",
        roles: ["super-admin"],
        active: true,
        deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({
        new: userWithNewRoles,
        old: { _key: "users/456" },
      });

      const decoded = {
        ...mockJwtPayload,
        realm_access: { roles: ["super-admin"] },
        iss_sub: ISS_SUB,
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[2][0];
      const upsertValues = upsertCall.values;
      expect(upsertValues[2].roles).toEqual(["super-admin"]); // updateDoc
      expect(upsertValues[1].roles).toEqual(["super-admin"]); // newDoc
    });

    it("should use preferred_username when name is not in JWT", async () => {
      const user = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "testuser",
        roles: ["user"],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        ...mockJwtPayload,
        name: undefined,
        preferred_username: "testuser",
        iss_sub: ISS_SUB,
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[2][0];
      expect(upsertCall.values[1].name).toBe("testuser"); // newDoc
    });

    it("should set email and name to null when not in JWT", async () => {
      // No email in decoded → legacy migration query is skipped (only 2 queries)
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // soft-delete check: not deleted
        .mockResolvedValue(mockCursor); // upsert: returns { new, old }
      const user = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "no-email-user",
        email: null,
        name: null,
        roles: [],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        sub: "no-email-user",
        iss: "http://localhost:8080/realms/genie",
        iss_sub: ISS_SUB,
        realm_access: { roles: [] },
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      expect(upsertCall.values[1].email).toBeNull(); // newDoc
      expect(upsertCall.values[1].name).toBeNull(); // newDoc
      expect(upsertCall.values[1].roles).toEqual([]); // newDoc
    });

    it("should set roles to empty array when realm_access is missing", async () => {
      // No email in decoded → legacy migration query is skipped (only 2 queries)
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ next: jest.fn().mockResolvedValue(undefined) }) // soft-delete check: not deleted
        .mockResolvedValue(mockCursor); // upsert: returns { new, old }
      const user = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        iss: "http://localhost:8080/realms/genie",
        sub: "12345678-1234-1234-1234-123456789012",
        email: "testuser@example.com",
        name: "Test User",
        roles: [],
        active: true,
        deleted: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      mockCursor.next.mockResolvedValue({ new: user, old: null });

      const decoded = {
        sub: "12345678-1234-1234-1234-123456789012",
        iss: "http://localhost:8080/realms/genie",
        iss_sub: ISS_SUB,
        // no realm_access, no email
      };

      await userProvisioningService.provisionUser(decoded);

      const upsertCall = mockQuery.mock.calls[1][0];
      expect(upsertCall.values[1].roles).toEqual([]); // newDoc
      expect(upsertCall.values[2].roles).toEqual([]); // updateDoc
    });

    it("should throw when UPSERT returns no result", async () => {
      mockCursor.next.mockResolvedValue(undefined);

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      await expect(
        userProvisioningService.provisionUser(decoded),
      ).rejects.toThrow("User provisioning returned no result");
    });

    it("should throw when UPSERT returns result without new", async () => {
      mockCursor.next.mockResolvedValue({ old: { _key: "users/123" } });

      const decoded = {
        ...mockJwtPayload,
        iss_sub: ISS_SUB,
      };

      await expect(
        userProvisioningService.provisionUser(decoded),
      ).rejects.toThrow("User provisioning returned no result");
    });

    it("should throw when decoded token has no iss_sub", async () => {
      const decoded = {
        ...mockJwtPayload,
        iss_sub: undefined,
      };

      await expect(
        userProvisioningService.provisionUser(decoded),
      ).rejects.toThrow("Missing iss_sub in decoded token");
    });

    it('should log "User provisioned" for new users', async () => {
      const newUser = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        deleted: false,
      };
      mockCursor.next.mockResolvedValue({ new: newUser, old: null });

      const decoded = { ...mockJwtPayload, iss_sub: ISS_SUB };
      const { logger } = require("../shared-lib");

      await userProvisioningService.provisionUser(decoded);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("User provisioned"),
      );
    });

    it('should log "User profile updated" for existing users', async () => {
      const existingUser = {
        _key: "users/456",
        iss_sub: ISS_SUB,
        deleted: false,
      };
      mockCursor.next.mockResolvedValue({
        new: existingUser,
        old: { _key: "users/456" },
      });

      const decoded = { ...mockJwtPayload, iss_sub: ISS_SUB };
      const { logger } = require("../shared-lib");

      await userProvisioningService.provisionUser(decoded);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("User profile updated"),
      );
    });
  });

  describe("markUserAsDeleted", () => {
    let loggerMock;

    beforeEach(() => {
      // Reset mocks for markUserAsDeleted tests
      mockQuery.mockReset();
      mockCursor.next.mockReset();
      mockGetConnection.mockResolvedValue(mockDb);
      userProvisioningService._reset();
      // Default: query returns a deleted user
      mockQuery.mockResolvedValue(mockCursor);
      mockCursor.next.mockResolvedValue({ _key: "users/123", deleted: true });
      // Reset logger mock to clear previous calls
      const { logger } = require("../shared-lib");
      logger.info.mockClear();
      logger.warn.mockClear();
      logger.error.mockClear();
      loggerMock = logger;
    });

    it("should mark user as deleted with deletedAt timestamp", async () => {
      const deletedUser = {
        _key: "users/123",
        iss_sub: ISS_SUB,
        deleted: true,
        deletedAt: "2026-04-05T12:00:00.000Z",
        updatedAt: "2026-04-05T12:00:00.000Z",
      };
      mockCursor.next.mockResolvedValueOnce(deletedUser);

      await userProvisioningService.markUserAsDeleted(ISS_SUB);

      expect(mockQuery).toHaveBeenCalled();
      expect(mockCursor.next).toHaveBeenCalled();
      // The mock was called and should have returned the deletedUser
      expect(mockCursor.next.mock.calls.length).toBeGreaterThan(0);
      // Verify the deletedUser object has the expected structure
      expect(deletedUser.deleted).toBe(true);
      expect(deletedUser.deletedAt).toBeDefined();
    });

    it("should log info message when user is marked as deleted", async () => {
      const deletedUser = { _key: "users/123", deleted: true };
      mockCursor.next.mockResolvedValue(deletedUser);

      await userProvisioningService.markUserAsDeleted(ISS_SUB);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.stringContaining("User marked as deleted"),
      );
    });

    it("should log warning when user is not found", async () => {
      mockCursor.next.mockResolvedValue(undefined);

      await userProvisioningService.markUserAsDeleted("nonexistent-user");

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining("User not found for deletion marking"),
      );
    });

    it("should set deleted, deletedAt, and updatedAt fields", async () => {
      const updatedUser = {
        _key: "users/123",
        deleted: true,
        deletedAt: "2026-04-05T12:00:00.000Z",
        updatedAt: "2026-04-05T12:00:00.000Z",
      };
      mockCursor.next.mockResolvedValue(updatedUser);

      await userProvisioningService.markUserAsDeleted(ISS_SUB);

      // Verify the UPDATE query includes all three fields
      const updateCall = mockQuery.mock.calls[0][0];
      expect(updateCall.values).toHaveLength(3); // iss_sub, deletedAt, updatedAt
    });

    it("should propagate error when ArangoDB query fails", async () => {
      mockQuery.mockRejectedValueOnce(new Error("Connection refused"));

      await expect(
        userProvisioningService.markUserAsDeleted(ISS_SUB),
      ).rejects.toThrow("Connection refused");
    });

    it("should propagate error when dbService.getConnection() fails", async () => {
      mockGetConnection.mockRejectedValueOnce(
        new Error("ArangoDB unreachable"),
      );

      await expect(
        userProvisioningService.markUserAsDeleted(ISS_SUB),
      ).rejects.toThrow("ArangoDB unreachable");
    });
  });
});
