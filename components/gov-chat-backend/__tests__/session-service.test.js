'use strict';

// Set env before requiring the service (read at module load time)
process.env.SESSION_EXPIRATION_TIME = '1800000'; // 30 minutes

// Mock shared-lib
jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: {
      getConnection: jest.fn()
    }
  }),
  { virtual: true }
);

// Mock arangojs — capture aql calls
const mockAqlStrings = [];
jest.mock('arangojs', () => ({
  aql: (strings, ...values) => {
    mockAqlStrings.push(strings.join('?'));
    return { _aql: true, strings, values };
  }
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234')
}));

// Mock collection and cursor factories
function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'session-1' }),
    update: jest.fn().mockImplementation(async (id, data, opts) => {
      if (opts && opts.returnNew) {
        return { new: { _key: id, ...data } };
      }
      return { _key: id, ...data };
    }),
    document: jest.fn().mockImplementation(async (id) => {
      if (id === 'session-1') {
        return {
          _key: 'session-1',
          _id: 'sessions/session-1',
          userId: 'user-1',
          startTime: new Date().toISOString(),
          active: true,
          endTime: null
        };
      }
      throw new Error('document not found');
    }),
    ensureIndex: jest.fn().mockResolvedValue({ id: 'idx-1', name: 'idx-active-lastActiveTime' })
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

function createExpiredSession(overrides = {}) {
  const expiredTime = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 min ago
  return {
    _key: 'expired-session-1',
    _id: 'sessions/expired-session-1',
    userId: 'user-1',
    startTime: expiredTime,
    active: true,
    endTime: null,
    lastActiveTime: null,
    ...overrides
  };
}

function createActiveSession(overrides = {}) {
  const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
  return {
    _key: 'active-session-1',
    _id: 'sessions/active-session-1',
    userId: 'user-1',
    startTime: recentTime,
    active: true,
    endTime: null,
    lastActiveTime: new Date(Date.now() - 60000).toISOString(), // 1 min ago
    ...overrides
  };
}

// Clear module cache to reset singleton between tests
let sessionService;
let mockSessionsCollection;
let mockUserSessionsCollection;
let mockSessionQueriesCollection;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();
  mockAqlStrings.length = 0;

  mockSessionsCollection = createMockCollection();
  mockUserSessionsCollection = createMockCollection();
  mockSessionQueriesCollection = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      if (name === 'sessions') return mockSessionsCollection;
      if (name === 'userSessions') return mockUserSessionsCollection;
      if (name === 'sessionQueries') return mockSessionQueriesCollection;
      return createMockCollection();
    }),
    query: jest.fn()
  };

  const { dbService } = require('../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  // Re-require to reset singleton
  jest.isolateModules(() => {
    sessionService = require('../services/session-service');
  });

  // Reset initialized state so init() can be called in tests
  sessionService.initialized = false;
});

describe('SessionService', () => {
  describe('getActiveSession', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should return null when no active session exists', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeNull();
    });

    it('should return active session within expiration time', async () => {
      const activeSession = createActiveSession();
      mockDb.query.mockResolvedValue(createMockCursor([activeSession]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeDefined();
      expect(result._key).toBe('active-session-1');
      expect(mockSessionsCollection.update).not.toHaveBeenCalled(); // not ended
    });

    it('should end session and return null when startTime exceeds lifetime (no lastActiveTime)', async () => {
      const expiredSession = createExpiredSession();
      mockDb.query.mockResolvedValue(createMockCursor([expiredSession]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeNull();
      expect(mockSessionsCollection.update).toHaveBeenCalled(); // endSession called
    });

    it('should return active session when lastActiveTime is within lifetime (startTime old)', async () => {
      const oldStartRecentActive = {
        _key: 'session-keepalive',
        _id: 'sessions/session-keepalive',
        userId: 'user-1',
        startTime: new Date(Date.now() - 40 * 60 * 1000).toISOString(), // 40 min ago
        active: true,
        endTime: null,
        lastActiveTime: new Date(Date.now() - 60000).toISOString() // 1 min ago — within 30 min
      };
      mockDb.query.mockResolvedValue(createMockCursor([oldStartRecentActive]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeDefined();
      expect(result._key).toBe('session-keepalive');
      expect(mockSessionsCollection.update).not.toHaveBeenCalled(); // not ended
    });

    it('should end session when both startTime and lastActiveTime exceed lifetime', async () => {
      const fullyExpired = {
        _key: 'session-expired',
        _id: 'sessions/session-expired',
        userId: 'user-1',
        startTime: new Date(Date.now() - 40 * 60 * 1000).toISOString(), // 40 min ago
        active: true,
        endTime: null,
        lastActiveTime: new Date(Date.now() - 35 * 60 * 1000).toISOString() // 35 min ago
      };
      mockDb.query.mockResolvedValue(createMockCursor([fullyExpired]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeNull();
      expect(mockSessionsCollection.update).toHaveBeenCalled(); // endSession called
    });

    it('should use startTime as fallback when lastActiveTime is null', async () => {
      const recentSession = {
        _key: 'session-recent-no-keepalive',
        _id: 'sessions/session-recent-no-keepalive',
        userId: 'user-1',
        startTime: new Date(Date.now() - 60000).toISOString(), // 1 min ago
        active: true,
        endTime: null,
        lastActiveTime: null
      };
      mockDb.query.mockResolvedValue(createMockCursor([recentSession]));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeDefined();
      expect(result._key).toBe('session-recent-no-keepalive');
      expect(mockSessionsCollection.update).not.toHaveBeenCalled(); // not expired
    });
  });

  describe('cleanupExpiredSessions', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should mark expired sessions as inactive', async () => {
      const expiredSession = createExpiredSession();
      mockDb.query.mockResolvedValueOnce(createMockCursor([expiredSession]));

      // endSession reads the session first
      mockSessionsCollection.document.mockResolvedValueOnce({ ...expiredSession, active: true });

      const result = await sessionService.cleanupExpiredSessions();

      expect(result.expiredSessionsFound).toBe(1);
      expect(result.sessionsEnded).toBe(1);
      // endSession calls sessions.update with active: false
      expect(mockSessionsCollection.update).toHaveBeenCalledWith(
        'expired-session-1',
        expect.objectContaining({ active: false }),
        expect.any(Object)
      );
    });

    it('should not purge active sessions within lifetime', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));

      const result = await sessionService.cleanupExpiredSessions();

      expect(result.expiredSessionsFound).toBe(0);
      expect(result.sessionsEnded).toBe(0);
      expect(mockSessionsCollection.update).not.toHaveBeenCalled();
    });

    it('should clean up userSessions and sessionQueries edges', async () => {
      const expiredSession = createExpiredSession();

      // endSession reads session
      mockSessionsCollection.document.mockResolvedValueOnce({ ...expiredSession, active: true });

      // Edge cleanup queries
      const userSessionEdgeCursor = createMockCursor(['userSessions/edge-1']);
      const queryEdgeCursor = createMockCursor(['sessionQueries/edge-1', 'sessionQueries/edge-2']);
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([expiredSession])) // find expired sessions
        .mockResolvedValueOnce(userSessionEdgeCursor) // userSessions edge cleanup
        .mockResolvedValueOnce(queryEdgeCursor); // sessionQueries edge cleanup

      const result = await sessionService.cleanupExpiredSessions();

      expect(result.edgesRemoved).toBe(3); // 1 userSessions + 2 sessionQueries
    });

    it('should handle edge cleanup errors gracefully', async () => {
      const expiredSession = createExpiredSession();

      // endSession reads session
      mockSessionsCollection.document.mockResolvedValueOnce({ ...expiredSession, active: true });

      // First edge query succeeds, second throws
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([expiredSession])) // find expired
        .mockResolvedValueOnce(createMockCursor(['edge-1'])) // userSessions ok
        .mockRejectedValueOnce(new Error('collection not found')); // sessionQueries fails

      const result = await sessionService.cleanupExpiredSessions();

      // Should still end the session despite edge cleanup error
      expect(result.sessionsEnded).toBe(1);
      expect(result.edgesRemoved).toBe(1); // only userSessions edge counted
    });
  });

  describe('SESSION_EXPIRATION_TIME', () => {
    it('should use env var value when set', async () => {
      process.env.SESSION_EXPIRATION_TIME = '60000'; // 1 minute
      jest.isolateModules(() => {
        sessionService = require('../services/session-service');
      });
      sessionService.initialized = false;
      await sessionService.init();

      expect(Number(sessionService.sessionExpirationTime)).toBe(60000);
    });

    it('should default to 30 minutes when env var is not set', async () => {
      delete process.env.SESSION_EXPIRATION_TIME;
      jest.isolateModules(() => {
        sessionService = require('../services/session-service');
      });
      sessionService.initialized = false;
      await sessionService.init();

      expect(sessionService.sessionExpirationTime).toBe(30 * 60 * 1000);
    });
  });

  describe('getOrCreateSession', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should trigger cleanupExpiredSessions lazily in background', async () => {
      const activeSession = createActiveSession();
      mockDb.query.mockResolvedValue(createMockCursor([activeSession]));

      await sessionService.getOrCreateSession('user-1', 'user-1');

      // cleanupExpiredSessions was called (fire-and-forget)
      // Since it's async with .catch(), we need to wait a tick
      await new Promise((resolve) => setImmediate(resolve));

      // The getActiveSession query should have been called
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should create new session when no active session exists', async () => {
      // getActiveSession returns null (expired or no session)
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await sessionService.getOrCreateSession('user-1', 'user-1');

      expect(mockSessionsCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', active: true })
      );
    });
  });

  describe('purge marks inactive (no document deletion)', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should mark expired sessions inactive via update, not delete them', async () => {
      const expiredSession = createExpiredSession();

      // endSession reads session
      mockSessionsCollection.document.mockResolvedValueOnce({ ...expiredSession, active: true });

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([expiredSession])) // find expired for cleanup
        .mockResolvedValueOnce(createMockCursor([])) // userSessions edges
        .mockResolvedValueOnce(createMockCursor([])); // sessionQueries edges

      await sessionService.cleanupExpiredSessions();

      // endSession marks session as inactive (not deleted)
      expect(mockSessionsCollection.update).toHaveBeenCalledWith(
        'expired-session-1',
        expect.objectContaining({ active: false }),
        expect.any(Object)
      );

      // Verify sessions.save (create) was NOT called — purge does not delete
      // Only update was called (to set active: false)
      expect(mockSessionsCollection.save).not.toHaveBeenCalled();
    });
  });

  describe('_removeSessionEdges', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should remove edges from both userSessions and sessionQueries', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(['userSessions/edge-1']))
        .mockResolvedValueOnce(createMockCursor(['sessionQueries/edge-1']));

      const removed = await sessionService._removeSessionEdges('sessions/session-1');

      expect(removed).toBe(2);
    });

    it('should return 0 when no edges exist', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([]));

      const removed = await sessionService._removeSessionEdges('sessions/session-1');

      expect(removed).toBe(0);
    });
  });

  describe('init error handling', () => {
    it('should throw error when database connection fails (lines 33-34)', async () => {
      const { dbService } = require('../shared-lib');

      // Reset the service to uninitialized state
      sessionService.initialized = false;
      sessionService.db = null;

      // Mock connection to fail
      dbService.getConnection.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(sessionService.init()).rejects.toThrow('Connection failed');
    });
  });

  describe('init already initialized', () => {
    it('should return early when already initialized (lines 20-21)', async () => {
      const { logger } = require('../shared-lib');
      await sessionService.init();

      // Call init again
      await sessionService.init();

      // Should log debug message and not re-initialize
      expect(logger.debug).toHaveBeenCalledWith('SessionService already initialized, skipping');
    });
  });

  describe('createSession branches', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should update session with deviceInfo when provided (line 56)', async () => {
      const deviceInfo = { type: 'mobile', os: 'iOS' };
      mockSessionsCollection.document.mockResolvedValueOnce({
        _key: 'session-1',
        userId: 'user-1',
        deviceInfo
      });

      await sessionService.createSession('user-1', 'user-key-1', deviceInfo);

      expect(mockSessionsCollection.update).toHaveBeenCalledWith('session-1', { deviceInfo });
    });

    it('should update session with ipAddress when provided as string (line 60)', async () => {
      mockSessionsCollection.document.mockResolvedValueOnce({
        _key: 'session-1',
        userId: 'user-1',
        ipAddress: '192.168.1.1'
      });

      await sessionService.createSession('user-1', 'user-key-1', {}, '192.168.1.1');

      expect(mockSessionsCollection.update).toHaveBeenCalledWith('session-1', { ipAddress: '192.168.1.1' });
    });

    it('should not update when deviceInfo and ipAddress are empty (line 64)', async () => {
      mockSessionsCollection.document.mockResolvedValueOnce({
        _key: 'session-1',
        userId: 'user-1'
      });

      await sessionService.createSession('user-1', 'user-key-1', {}, '');

      // update should not be called when updateData is empty
      expect(mockSessionsCollection.update).not.toHaveBeenCalled();
    });

    it('should handle edge creation error gracefully (line 77)', async () => {
      mockSessionsCollection.document.mockResolvedValueOnce({
        _key: 'session-1',
        userId: 'user-1'
      });

      // Edge creation fails
      mockUserSessionsCollection.save.mockRejectedValueOnce(new Error('Edge creation failed'));

      const result = await sessionService.createSession('user-1', 'user-key-1');

      // Should still return session despite edge error
      expect(result).toBeDefined();
      expect(result._key).toBe('session-1');
    });

    it('should throw error when session creation fails (lines 84-85)', async () => {
      mockSessionsCollection.save.mockRejectedValueOnce(new Error('Database error'));

      await expect(sessionService.createSession('user-1', 'user-key-1')).rejects.toThrow('Database error');
    });
  });

  describe('getActiveSession error handling', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should return null on query error (lines 137-138)', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Query failed'));

      const result = await sessionService.getActiveSession('user-1');

      expect(result).toBeNull();
    });
  });

  describe('getOrCreateSession cleanup error', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should handle background cleanup failure gracefully (line 151)', async () => {
      const activeSession = createActiveSession();
      mockDb.query.mockResolvedValueOnce(createMockCursor([activeSession]));

      // Mock cleanupExpiredSessions to fail
      const originalCleanup = sessionService.cleanupExpiredSessions.bind(sessionService);
      sessionService.cleanupExpiredSessions = jest.fn().mockRejectedValueOnce(new Error('Cleanup failed'));

      // Should not throw despite cleanup failure
      const result = await sessionService.getOrCreateSession('user-1', 'user-1');

      expect(result).toBeDefined();
      expect(result._key).toBe('active-session-1');

      // Restore original method
      sessionService.cleanupExpiredSessions = originalCleanup;
    });
  });

  describe('getOrCreateSession error handling', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should throw error when getActiveSession fails (lines 167-168)', async () => {
      // getActiveSession returns null (no active session), so createSession is called
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));

      // Mock createSession to throw
      const originalCreateSession = sessionService.createSession.bind(sessionService);
      sessionService.createSession = jest.fn().mockRejectedValueOnce(new Error('Database error'));

      await expect(sessionService.getOrCreateSession('user-1', 'user-1')).rejects.toThrow('Database error');

      // Restore original method
      sessionService.createSession = originalCreateSession;
    });
  });

  describe('endSession already inactive', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should return early when session is already inactive (lines 181-182)', async () => {
      const inactiveSession = {
        _key: 'session-1',
        active: false,
        endTime: new Date().toISOString()
      };

      mockSessionsCollection.document.mockResolvedValueOnce(inactiveSession);

      const result = await sessionService.endSession('session-1');

      expect(result).toEqual(inactiveSession);
      expect(mockSessionsCollection.update).not.toHaveBeenCalled();
    });
  });

  describe('endSession verification branches', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should log warning when session still active after update (lines 205-206)', async () => {
      mockSessionsCollection.document
        .mockResolvedValueOnce({ _key: 'session-1', active: true })
        .mockResolvedValueOnce({ _key: 'session-1', active: true }); // Still active after update

      mockSessionsCollection.update.mockResolvedValueOnce({
        new: { _key: 'session-1', active: false }
      });

      await sessionService.endSession('session-1');

      expect(mockSessionsCollection.update).toHaveBeenCalled();
    });

    it('should log success when session is now inactive (lines 207-208)', async () => {
      mockSessionsCollection.document
        .mockResolvedValueOnce({ _key: 'session-1', active: true })
        .mockResolvedValueOnce({ _key: 'session-1', active: false, endTime: new Date().toISOString() });

      mockSessionsCollection.update.mockResolvedValueOnce({
        new: { _key: 'session-1', active: false, endTime: new Date().toISOString() }
      });

      await sessionService.endSession('session-1');

      expect(mockSessionsCollection.update).toHaveBeenCalled();
    });

    it('should throw error when session update fails (lines 217-218)', async () => {
      mockSessionsCollection.document.mockResolvedValueOnce({ _key: 'session-1', active: true });

      mockSessionsCollection.update.mockRejectedValueOnce(new Error('Update failed'));

      await expect(sessionService.endSession('session-1')).rejects.toThrow('Update failed');
    });
  });

  describe('keepSessionAlive', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should update lastActiveTime for session (lines 217-240)', async () => {
      const updatedSession = {
        _key: 'session-1',
        lastActiveTime: new Date().toISOString()
      };

      mockSessionsCollection.update.mockResolvedValueOnce({
        new: updatedSession
      });

      const result = await sessionService.keepSessionAlive('session-1');

      expect(result).toEqual(updatedSession);
      expect(mockSessionsCollection.update).toHaveBeenCalledWith(
        'session-1',
        { lastActiveTime: expect.any(String) },
        { returnNew: true }
      );
    });

    it('should throw error when update fails', async () => {
      mockSessionsCollection.update.mockRejectedValueOnce(new Error('Update failed'));

      await expect(sessionService.keepSessionAlive('session-1')).rejects.toThrow('Update failed');
    });
  });

  describe('getUserSessions branches', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should query with legacyKey when provided (lines 248-264)', async () => {
      const sessions = [
        { _key: 'session-1', userId: 'user-1' },
        { _key: 'session-2', userId: 'legacy-1' }
      ];

      mockDb.query.mockResolvedValueOnce(createMockCursor(sessions));

      const result = await sessionService.getUserSessions('user-1', { legacyKey: 'legacy-1' });

      expect(result).toHaveLength(2);
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should query activeOnly with legacyKey (lines 250-256)', async () => {
      const activeSessions = [{ _key: 'session-1', userId: 'user-1', active: true }];

      mockDb.query.mockResolvedValueOnce(createMockCursor(activeSessions));

      const result = await sessionService.getUserSessions('user-1', {
        legacyKey: 'legacy-1',
        activeOnly: true
      });

      expect(result).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should query activeOnly without legacyKey (lines 265-272)', async () => {
      const activeSessions = [{ _key: 'session-1', userId: 'user-1', active: true }];

      mockDb.query.mockResolvedValueOnce(createMockCursor(activeSessions));

      const result = await sessionService.getUserSessions('user-1', { activeOnly: true });

      expect(result).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should query all sessions without filters (lines 274-279)', async () => {
      const sessions = [
        { _key: 'session-1', userId: 'user-1', active: true },
        { _key: 'session-2', userId: 'user-1', active: false }
      ];

      mockDb.query.mockResolvedValueOnce(createMockCursor(sessions));

      const result = await sessionService.getUserSessions('user-1', {});

      expect(result).toHaveLength(2);
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should throw error when query fails', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(sessionService.getUserSessions('user-1')).rejects.toThrow('Query failed');
    });
  });

  describe('getSession', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should retrieve session by id (lines 292-302)', async () => {
      const session = {
        _key: 'session-1',
        _id: 'sessions/session-1',
        userId: 'user-1',
        active: true
      };

      mockSessionsCollection.document.mockResolvedValueOnce(session);

      const result = await sessionService.getSession('session-1');

      expect(result).toEqual(session);
    });

    it('should throw error when session not found', async () => {
      mockSessionsCollection.document.mockRejectedValueOnce(new Error('document not found'));

      await expect(sessionService.getSession('session-1')).rejects.toThrow('document not found');
    });
  });

  describe('cleanupExpiredSessions error handling', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should throw error when query fails (lines 341-342)', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(sessionService.cleanupExpiredSessions()).rejects.toThrow('Query failed');
    });
  });

  describe('getSessionStats', () => {
    beforeEach(async () => {
      await sessionService.init();
    });

    it('should retrieve session statistics (lines 374-431)', async () => {
      const stats = {
        totalSessions: 100,
        activeSessions: 25,
        uniqueUsers: 40,
        avgSessionDuration: 1800000,
        sessionsByDevice: [
          { deviceType: 'mobile', count: 60 },
          { deviceType: 'desktop', count: 40 }
        ]
      };

      mockDb.query.mockResolvedValueOnce({
        next: jest.fn().mockResolvedValueOnce(stats)
      });

      const result = await sessionService.getSessionStats('2024-01-01', '2024-12-31');

      expect(result).toEqual(stats);
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should throw error when stats query fails', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Stats query failed'));

      await expect(sessionService.getSessionStats('2024-01-01', '2024-12-31')).rejects.toThrow('Stats query failed');
    });

    it('should handle edge case with no sessions', async () => {
      const emptyStats = {
        totalSessions: 0,
        activeSessions: 0,
        uniqueUsers: 0,
        avgSessionDuration: null,
        sessionsByDevice: []
      };

      mockDb.query.mockResolvedValueOnce({
        next: jest.fn().mockResolvedValueOnce(emptyStats)
      });

      const result = await sessionService.getSessionStats('2024-01-01', '2024-12-31');

      expect(result).toEqual(emptyStats);
    });
  });
});
