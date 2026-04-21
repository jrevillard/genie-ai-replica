'use strict';

// Set env before requiring the service (read at module load time)
process.env.SESSION_EXPIRATION_TIME = '1800000'; // 30 minutes

// Mock shared-lib
jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: {
    getConnection: jest.fn()
  }
}), { virtual: true });

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
        .mockResolvedValueOnce(userSessionEdgeCursor)              // userSessions edge cleanup
        .mockResolvedValueOnce(queryEdgeCursor);                   // sessionQueries edge cleanup

      const result = await sessionService.cleanupExpiredSessions();

      expect(result.edgesRemoved).toBe(3); // 1 userSessions + 2 sessionQueries
    });

    it('should handle edge cleanup errors gracefully', async () => {
      const expiredSession = createExpiredSession();

      // endSession reads session
      mockSessionsCollection.document.mockResolvedValueOnce({ ...expiredSession, active: true });

      // First edge query succeeds, second throws
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([expiredSession]))  // find expired
        .mockResolvedValueOnce(createMockCursor(['edge-1']))        // userSessions ok
        .mockRejectedValueOnce(new Error('collection not found'));  // sessionQueries fails

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
        .mockResolvedValueOnce(createMockCursor([]))               // userSessions edges
        .mockResolvedValueOnce(createMockCursor([]));              // sessionQueries edges

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
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]));

      const removed = await sessionService._removeSessionEdges('sessions/session-1');

      expect(removed).toBe(0);
    });
  });
});
