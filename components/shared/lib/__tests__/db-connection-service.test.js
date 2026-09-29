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
        reconfigureLogger: jest.fn()
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

describe('connection cleanup timer', () => {
  it('does not keep the Node event loop alive', () => {
    // Background housekeeping must never be what holds the process open.
    // The SIGTERM handler that calls process.exit lives in tracing.js
    // behind ENABLE_OBSERVABILITY !== '1', and the DEFAULT is off — so
    // without unref() this interval was the only thing keeping the loop
    // alive, and every container was SIGKILLed at stop_grace_period
    // instead of exiting, losing the shutdown logs that would explain
    // why.
    //
    // Asserted through the setInterval handle rather than a stored
    // reference: the singleton is Object.freeze'd, so holding the handle
    // on the instance would need a mutable wrapper that exists only for
    // the test.
    const realSetInterval = global.setInterval;
    const created = [];
    global.setInterval = (fn, ms) => {
      const handle = realSetInterval(fn, ms);
      created.push(handle);
      return handle;
    };
    try {
      jest.isolateModules(() => {
        require('../db-connection-service');
      });
    } finally {
      global.setInterval = realSetInterval;
    }

    const cleanupTimer = created[created.length - 1];
    expect(cleanupTimer).toBeTruthy();
    expect(cleanupTimer.hasRef()).toBe(false);
    clearInterval(cleanupTimer);
  });
});
