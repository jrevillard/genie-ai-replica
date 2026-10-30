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

describe('!1072 — a document miss is an expected outcome, not an error', () => {
  // Measured shapes (arangojs 10.1.2 + ArangoDB, verified against the live
  // driver rather than assumed):
  //   collection.document('MISSING') -> errorNum 1202, code 404
  //   collection('nope').document()   -> errorNum 1203, code 404
  // Both carry code 404; only errorNum separates them.
  const docMiss = Object.assign(new Error('document not found'), {
    errorNum: 1202,
    code: 404,
    name: 'ArangoError'
  });
  const collectionMiss = Object.assign(new Error('collection or view not found: nope'), {
    errorNum: 1203,
    code: 404,
    name: 'ArangoError'
  });
  // firstExample throws ArangoError 'no match' with errorNum 1204. That method
  // was REMOVED in arangojs 10, so this shape cannot be reproduced from the
  // local driver — it is pinned by okf-server/__tests__/concept-meta-service.test.js
  // instead, and is asserted here so both layers agree.
  const noMatch = Object.assign(new Error('no match'), { errorNum: 1204, name: 'ArangoError' });
  // ...and the same message with NO errorNum, which some driver paths produce.
  const bareNoMatch = new Error('no match');

  // Loaded ONCE. Each isolateModules() re-require rewrites the same
  // transform-cache entry, and on Windows those renames collide (EBUSY) — with
  // one require per test this file was flaky for reasons that have nothing to
  // do with what it asserts. One instance is also all these tests need:
  // _executeWithRetry is stateless apart from the connection map.
  let svc = null;
  let errorSpy = null;
  let warnSpy = null;

  beforeAll(() => {
    errorSpy = jest.fn();
    warnSpy = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('../logger', () => ({
        logger: { error: errorSpy, warn: warnSpy, debug: jest.fn(), info: jest.fn() },
        reconfigureLogger: jest.fn()
      }));
      svc = require('../db-connection-service');
    });
    // The singleton is frozen, but the Map it holds is not — this is what a
    // registered connection looks like to _executeWithRetry.
    svc._connections.set('default', { db: {}, lastActivity: 0 });
  });

  beforeEach(() => {
    errorSpy.mockClear();
    warnSpy.mockClear();
  });

  const thrower = (err) => async () => {
    throw err;
  };

  it('1202 document miss emits NO error and NO warn', async () => {
    // The re-throw is asserted separately below; here we only care that the
    // LOG SEVERITY dropped, so swallow the expected rejection.
    await svc._executeWithRetry('default', thrower(docMiss), 'collection.document').catch(() => {});
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('1202 document miss is STILL RE-THROWN — callers depend on it', async () => {
    // The critical half. 18 call sites do
    //   if (!isArangoNotFound(err)) throw err
    //   if (isArangoNotFound(err)) return null
    // to tell "absent" from "failed". Swallowing the throw here would turn
    // every one of those into a silent "no row" — an outage rendered as an
    // empty result. The issue as filed proposed NOT re-throwing; that would
    // have been a regression, and this test is what pins the difference.
    await expect(svc._executeWithRetry('default', thrower(docMiss), 'collection.document')).rejects.toBe(docMiss);
  });

  it("firstExample's 'no match' emits NO error and is still re-thrown", async () => {
    await expect(svc._executeWithRetry('default', thrower(noMatch), 'collection.firstExample')).rejects.toBe(noMatch);
    expect(errorSpy).not.toHaveBeenCalled();
    // The same message without an errorNum is treated the same way.
    await expect(svc._executeWithRetry('default', thrower(bareNoMatch), 'collection.firstExample')).rejects.toBe(
      bareNoMatch
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('1203 collection-not-found STILL logs at error — it is a real fault', async () => {
    // The one that looks like the others (both carry code 404) and is not. A
    // missing collection is a configuration/infrastructure fault and must stay
    // visible; classifying it as "absent" is what masks outages.
    await expect(svc._executeWithRetry('default', thrower(collectionMiss), 'collection.document')).rejects.toBe(
      collectionMiss
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/Non-connection error/);
  });

  it('a genuine fault still logs at error', async () => {
    const boom = Object.assign(new Error('lock timeout'), { errorNum: 1200 });
    await expect(svc._executeWithRetry('default', thrower(boom), 'collection.save')).rejects.toBe(boom);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('_isExpectedAbsence separates absent from fault, and ignores loose message matches', () => {
    expect(svc._isExpectedAbsence(docMiss)).toBe(true); // 1202
    expect(svc._isExpectedAbsence(noMatch)).toBe(true); // 1204
    expect(svc._isExpectedAbsence(bareNoMatch)).toBe(true); // no errorNum, exact message
    expect(svc._isExpectedAbsence(collectionMiss)).toBe(false); // 1203 — a real fault
    // A loose /not found/i would swallow these — the reason the predicate is narrow.
    expect(svc._isExpectedAbsence(new Error('route not found'))).toBe(false);
    expect(svc._isExpectedAbsence(new Error('gateway returned not found'))).toBe(false);
    expect(svc._isExpectedAbsence(null)).toBe(false);
  });
});
