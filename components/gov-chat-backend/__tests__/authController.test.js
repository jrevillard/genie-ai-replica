'use strict';

// Mock shared-lib
jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}), { virtual: true });

// Mock session-service
const mockGetUserSessions = jest.fn();
const mockEndSession = jest.fn();
jest.mock('../services/session-service', () => ({
  getUserSessions: (...args) => mockGetUserSessions(...args),
  endSession: (...args) => mockEndSession(...args)
}));

const { logger } = require('../shared-lib');
const authController = require('../controllers/authController');

function createMockReq(overrides = {}) {
  return {
    user: {
      _key: 'user-123',
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      iss: 'http://localhost:8080/realms/genie',
      name: 'Test User',
      email: 'test@example.com',
      ...overrides
    },
    ...overrides
  };
}

function createMockRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  };
  return res;
}

describe('authController', () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = createMockReq();
    res = createMockRes();
  });

  describe('logout', () => {
    it('should return success and end active sessions', async () => {
      const activeSessions = [
        { _key: 'session-1', userId: 'user-123', active: true },
        { _key: 'session-2', userId: 'user-123', active: true }
      ];
      mockGetUserSessions.mockResolvedValue(activeSessions);
      mockEndSession.mockResolvedValue({ _key: 'session-1', active: false });

      await authController.logout(req, res);

      expect(mockGetUserSessions).toHaveBeenCalledWith('http://localhost:8080/realms/genie#user-123', { legacyKey: 'user-123', activeOnly: true });
      expect(mockEndSession).toHaveBeenCalledTimes(2);
      expect(mockEndSession).toHaveBeenCalledWith('session-1');
      expect(mockEndSession).toHaveBeenCalledWith('session-2');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
    });

    it('should emit structured audit log with event, timestamp, userId, issuer', async () => {
      mockGetUserSessions.mockResolvedValue([]);

      await authController.logout(req, res);

      // Find the audit log call (the one with JSON.stringify containing 'logout')
      const logCalls = logger.info.mock.calls;
      const auditLogCall = logCalls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.event === 'logout';
        } catch {
          return false;
        }
      });
      expect(auditLogCall).toBeDefined();

      const auditEntry = JSON.parse(auditLogCall[0]);
      expect(auditEntry.event).toBe('logout');
      expect(auditEntry.timestamp).toBeDefined();
      expect(new Date(auditEntry.timestamp).toISOString()).toBe(auditEntry.timestamp);
      expect(auditEntry.userId).toBe('http://localhost:8080/realms/genie#user-123');
      expect(auditEntry.issuer).toBe('http://localhost:8080/realms/genie');
    });

    it('should succeed even when session ending fails', async () => {
      mockGetUserSessions.mockRejectedValue(new Error('DB unavailable'));

      await authController.logout(req, res);

      // Should still return success (session ending is non-critical)
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
      // Should log a warning about the failure
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to end sessions on logout')
      );
    });

    it('should succeed when user has no active sessions', async () => {
      mockGetUserSessions.mockResolvedValue([]);

      await authController.logout(req, res);

      expect(mockEndSession).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
    });

    it('should handle missing user gracefully', async () => {
      req.user = null;

      await authController.logout(req, res);

      // Should not attempt to end sessions (userId is null)
      expect(mockGetUserSessions).not.toHaveBeenCalled();
      // Audit log should use 'unknown' for userId
      const logCalls = logger.info.mock.calls;
      const auditLogCall = logCalls.find((call) => {
        try {
          return JSON.parse(call[0]).event === 'logout';
        } catch {
          return false;
        }
      });
      expect(auditLogCall).toBeDefined();
      const auditEntry = JSON.parse(auditLogCall[0]);
      expect(auditEntry.userId).toBe('unknown');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
    });
  });
});
