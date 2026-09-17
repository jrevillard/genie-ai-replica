// components/shared/lib/__tests__/db-connection-service.test.js
'use strict';

describe('db-connection-service periodic intervals — unhandled rejection guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('catches and logs when the interval callback promise rejects', async () => {
    const errSpy = jest.fn();

    jest.isolateModules(() => {
      jest.doMock('../tracing-background', () => ({
        withBackgroundSpan: () => Promise.reject(new Error('boom'))
      }));
      jest.doMock('../logger', () => ({
        logger: {
          error: errSpy,
          info: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn()
        },
        reconfigureLogger: jest.fn(),
        cleanupCombinedLog: jest.fn(),
        flushLogs: jest.fn(),
        victoriaLogsEnabled: jest.fn(() => false),
        LOG_DROPPED_REASON: {}
      }));

      // Requiring the module triggers the singleton's constructor, which calls
      // _startConnectionCleanup() and schedules a setInterval at
      // HEALTH_CHECK_INTERVAL (10 minutes by default). No extra setup needed
      // — the cleanup interval is already armed and one tick is enough to
      // exercise the rejection path.
      require('../db-connection-service');
    });

    // Advance fake timers past one interval tick to fire the cleanup callback.
    jest.advanceTimersByTime(600001);
    // Flush microtasks so the .catch() handler (post-fix) runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cleanup/i),
      expect.objectContaining({ error: expect.any(String) })
    );
  });
});