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
//   - snapshotting the target state BEFORE awaiting the handler (an
//     ordering bug) turns the mid-flight-close spec red — the mutable
//     double is what makes that mutation observable.

// Playwright's client-side close error, shaped the way the library
// constructs it — the class is not publicly importable.
class TargetClosedError extends Error {}

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

  test('tolerates the protocol form of the race when the target is gone', async () => {
    // A dead target can also answer through the protocol path: the same
    // wording on a plain Error. The message half of the discrimination
    // must catch it.
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates an in-process instance of the class, whatever its message', async () => {
    // The constructor form is what an in-process throw carries, and its
    // message can be a custom close reason — not the standard wording,
    // not the name a subclass omits. This spec is the ONLY one whose
    // fixture matches the constructor branch alone: dropping that branch
    // leaves it tolerated by nothing.
    class TargetClosedError extends Error {}
    const { page } = pageState({ pageClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new TargetClosedError('closing: drain-and-close');
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the pipeline form of the race — the name survives, the class does not', async () => {
    // An error that crossed the pipeline keeps its NAME — Playwright's own
    // discrimination accepts the instance or the name. The wording here
    // matches NEITHER message branch, so this fixture is the only one the
    // name branch tolerates: dropping that branch turns this red.
    const { page } = pageState({ contextClosed: true });
    await expect(
      runOnce(page, async () => {
        const pipelineError = new Error('TargetClosedError: the target is gone');
        pipelineError.name = 'TargetClosedError';
        throw pipelineError;
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the client-side re-wrap of the race — the wording is all that survives', async () => {
    // `route.fetch()` re-wraps its failure CLIENT-side into a plain
    // Error with a "route.fetch: " prefix. Measured on the venue: the
    // name is 'Error', the class survives only RENAMED
    // ('TargetClosedError2'), and only the wording is intact — so the
    // guard recognised the name and the constructor, rethrew this
    // shape, and the teardown error landed in the NEXT test.
    const { page } = pageState({ contextClosed: true });
    await expect(
      runOnce(page, async () => {
        throw new Error('route.fetch: Request context disposed.');
      })
    ).resolves.toBeUndefined();
  });

  test('rethrows a mock defect that carries the disposed wording — the target is alive', async () => {
    // The same two halves, on the pipeline wording: the wording alone is
    // not the verdict. A defect on a live target must surface, whatever
    // its text says.
    const { page } = pageState();
    await expect(
      runOnce(page, async () => {
        throw new Error('route.fulfill: Request context disposed.');
      })
    ).rejects.toThrow('route.fulfill: Request context disposed.');
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
    // delivery — the state half rejects the error there, which is the
    // protection the header documents.
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
