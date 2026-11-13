const { test, expect } = require('@playwright/test');
const { runPostOnlyRouteHandler, runRouteHandler } = require('./route');

// The mutation gate for runRouteHandler's discrimination — why the
// conjunction (target state AND error class) is what it is lives once,
// in the helper's own header. What this file adds is the map:
//
//   - swallowing everything (dropping the conjunction) turns the
//     "rethrows" specs red;
//   - rethrowing everything turns the "tolerates" specs red;
//   - classifying by the error alone (no state check) turns the
//     "browser died" spec red;
//   - classifying by the state alone turns the defect-while-closing
//     spec red;
//   - dropping the NAME branch turns the protocol-shape spec red;
//   - dropping the CONSTRUCTOR branch turns the client-shape and the
//     in-process specs red;
//   - reading the MESSAGE instead of the class (the wording branch this
//     guard used to carry) turns the "wording is not the signal" spec
//     red — a branch that matches the race's wording tolerates a plain
//     error that merely quotes it;
//   - snapshotting the target state BEFORE awaiting the handler (an
//     ordering bug) turns the mid-flight-close spec red — the mutable
//     double is what makes that mutation observable.

// Playwright's close error, shaped the way the library constructs it —
// the class is not publicly importable.
class TargetClosedError extends Error {}

// The CLIENT bundle's copy of the same class: the bundler renames the
// second one, so the client-side error arrives as `TargetClosedError2`
// (measured on the shipped playwright-core 1.62.1).
class TargetClosedError2 extends Error {}

function raceError() {
  return new TargetClosedError('Target page, context or browser has been closed');
}

// A page double whose closed-states can FLIP while the handler runs: the
// static doubles model the post-race state only, and would pass a
// rewrite that snapshots the state before awaiting the handler.
function pageState({ pageClosed = false, contextClosed = false } = {}) {
  const state = { pageClosed, contextClosed };
  return {
    state,
    page: {
      isClosed: () => state.pageClosed,
      context: () => ({ isClosed: () => state.contextClosed })
    }
  };
}

// Run a wrapped handler once against a throwaway route object.
async function runOnce(page, handler) {
  return runRouteHandler(page, handler)({});
}

test.describe('runRouteHandler', () => {
  test('tolerates the target-closed error when the page closed — the named race', async () => {
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw raceError();
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the target-closed error when the context closed — the named race', async () => {
    const { page } = pageState({ contextClosed: true });
    await expect(
      runOnce(page, async () => {
        throw raceError();
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the race when the target closes while the handler is in flight', async () => {
    // The ordering gate: the state flips DURING the handler, so a rewrite
    // that reads it before awaiting would see an open target and
    // rethrow — this spec goes red on exactly that mutation.
    const { page, state } = pageState();
    await expect(
      runOnce(page, async () => {
        state.pageClosed = true;
        throw raceError();
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates an in-process instance of the class, whatever its message', async () => {
    // The constructor form is what an in-process throw carries, and its
    // message can be a custom close reason — not the standard wording,
    // not the name a subclass omits. This fixture matches the constructor
    // branch alone: dropping that branch leaves it tolerated by nothing.
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new TargetClosedError('closing: drain-and-close');
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates an error that carries the NAME only — the defensive arm', async () => {
    // The shipped client always delivers the CLASS (measured: the
    // constructor is 'TargetClosedError2'), so an error with the name and
    // no class does not occur today. The NAME arm is the defensive half
    // — and it is the ONLY fixture that pins it, so dropping that arm
    // turns this red.
    const { page } = pageState({ contextClosed: true });
    await expect(
      runOnce(page, async () => {
        const protocolError = new Error('Target page, context or browser has been closed');
        protocolError.name = 'TargetClosedError';
        throw protocolError;
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the client shape of the race — the class survives, renamed', async () => {
    // Measured on the shipped playwright-core 1.62.1: an in-flight
    // `route.fetch()` whose context is closed rejects with an error whose
    // `name` is 'Error' and whose CLASS is the bundle's renamed copy,
    // 'TargetClosedError2'. The guard used to match the WORDING instead
    // and rethrew this shape — the teardown error landed in the NEXT
    // test.
    const { page } = pageState({ contextClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new TargetClosedError2('route.fetch: Request context disposed.');
      })
    ).resolves.toBeUndefined();
  });

  test('rethrows a plain error that merely QUOTES the race wording — the wording is not the signal', async () => {
    // The same message as the client shape, without the class. The
    // wording was never the signal: a mock defect that says "Request
    // context disposed" must surface even while the target is closing.
    // A guard that reads the message instead of the class swallows this
    // one — and this spec is what makes that visible.
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new Error('route.fetch: Request context disposed.');
      })
    ).rejects.toThrow('route.fetch: Request context disposed.');
  });

  test('rethrows a plain error that QUOTES the PROTOCOL wording — the wording is not the signal', async () => {
    // The OTHER wording the guard's own doc names ("has been closed"),
    // without the class. A guard that reads the message instead of the
    // class swallows this one — and this spec is what makes that
    // visible.
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('rethrows a mock defect with its own message — the target is alive', async () => {
    const { page } = pageState();
    await expect(
      runOnce(page, async () => {
        throw new Error('route.fulfill: invalid status 200.5');
      })
    ).rejects.toThrow('route.fulfill: invalid status 200.5');
  });

  test('rethrows a mock defect that lands while the target is closing', async () => {
    // The conjunction's reason to exist: the defect and the teardown are
    // independent events that coincide. The state is gone; the error is
    // not the race — the defect must surface, not vanish.
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new Error('route.fulfill: invalid status 200.5');
      })
    ).rejects.toThrow('route.fulfill: invalid status 200.5');
  });

  test('rethrows a mock defect even when its text names the race', async () => {
    // The message alone is not the verdict either: a mock that fails
    // while the browser is alive is a defect even when its message
    // happens to read like the race.
    const { page } = pageState();
    await expect(
      runOnce(page, async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('rethrows when the browser process died — not the named race', async () => {
    // A browser crash produces the target-closed error; real Playwright
    // usually delivers the close events first, so the conjunction swallows
    // the crash like the named race and the spec fails on its other
    // awaits. This spec models the narrow window BEFORE close-event
    // delivery with a double whose flags stay false — a state real
    // Playwright does not reliably produce (#1627), not a protection the
    // guard buys on a dead browser.
    const { page } = pageState();
    await expect(
      runOnce(page, async () => {
        throw raceError();
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('returns the handler result when nothing throws', async () => {
    const { page } = pageState();
    await expect(runOnce(page, async () => 'fulfilled')).resolves.toBe('fulfilled');
  });
});

// The POST filter is the helper's most behavior-bearing branch: a
// preflight (cross-origin dev posture) or a stray GET must reach the
// network, never a CORS-less 200 from a handler that only knows how to
// answer a stream. The route double records which action the filter took,
// so a dropped or inverted method check turns one of these red.
function routeOf(method) {
  const calls = { continued: 0, fulfilled: 0 };
  return {
    calls,
    route: {
      request: () => ({ method: () => method }),
      continue: async () => {
        calls.continued += 1;
      },
      fulfill: async () => {
        calls.fulfilled += 1;
      }
    }
  };
}

test.describe('runPostOnlyRouteHandler', () => {
  test('a non-POST request continues to the network and never reaches the handler', async () => {
    const { page } = pageState();
    let handled = 0;
    const { calls, route } = routeOf('OPTIONS');
    await runPostOnlyRouteHandler(page, async () => {
      handled += 1;
    })(route);
    expect(handled, 'the handler must not answer a preflight').toBe(0);
    expect(calls.continued, 'the preflight continues to the network').toBe(1);
    expect(calls.fulfilled).toBe(0);
  });

  test('a POST request reaches the handler and is not continued', async () => {
    const { page } = pageState();
    const { calls, route } = routeOf('POST');
    const result = await runPostOnlyRouteHandler(page, async () => 'answered')(route);
    expect(result).toBe('answered');
    expect(calls.continued).toBe(0);
    expect(calls.fulfilled).toBe(0);
  });
});
