const { test, expect } = require('@playwright/test');
const { runRouteAction } = require('./route');

// A route handler outlives its own test: the browser context is closed
// while a fulfilment is still in flight. That race must stay tolerated,
// or every spec that closes its context while a stream is pending fails
// on a teardown nobody can act on.
//
// Everything else must NOT be tolerated. A mock that throws (a bad
// option, a typo) has to fail the test with its own message — otherwise
// the app waits forever for a stream that never arrives and the spec
// dies on its own timeout, pointing at nothing.
//
// The discrimination is a CONJUNCTION: the target state AND the error
// being Playwright's target-closed error. The specs below are the
// mutation gate for every half of it:
//   - swallowing everything (dropping the conjunction) turns the
//     "rethrows" specs red;
//   - rethrowing everything turns the "tolerates" specs red;
//   - snapshotting the target state BEFORE awaiting the action (an
//     ordering bug) turns the mid-flight-close spec red — the mutable
//     double is what makes that mutation observable;
//   - classifying by the error alone (no state check) turns the
//     "browser died" spec red.

// Playwright's client-side close error, shaped the way the library
// constructs it — the class is not publicly importable.
class TargetClosedError extends Error {}

function raceError() {
  return new TargetClosedError('Target page, context or browser has been closed');
}

// A page double whose closed-states can FLIP while the action runs: the
// static doubles model the post-race state only, and would pass a
// rewrite that snapshots the state before awaiting the action.
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

test.describe('runRouteAction', () => {
  test('tolerates the target-closed error when the page closed — the named race', async () => {
    const { page } = pageState({ pageClosed: true });
    await expect(
      runRouteAction(page, async () => {
        throw raceError();
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the target-closed error when the context closed — the named race', async () => {
    const { page } = pageState({ contextClosed: true });
    await expect(
      runRouteAction(page, async () => {
        throw raceError();
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the race when the target closes while the action is in flight', async () => {
    // The ordering gate: the state flips DURING the action, so a rewrite
    // that reads it before awaiting would see an open target and
    // rethrow — this spec goes red on exactly that mutation.
    const { page, state } = pageState();
    await expect(
      runRouteAction(page, async () => {
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
      runRouteAction(page, async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).resolves.toBeUndefined();
  });

  test('rethrows a mock defect with its own message — the target is alive', async () => {
    const { page } = pageState();
    await expect(
      runRouteAction(page, async () => {
        throw new Error('route.fulfill: invalid status 200.5');
      })
    ).rejects.toThrow('route.fulfill: invalid status 200.5');
  });

  test('rethrows a mock defect that lands while the target is closing', async () => {
    // The conjunction's reason to exist: the defect and the teardown are
    // independent events that coincide. The state is gone; the error is
    // not the race — the defect must surface, not vanish.
    const { page, state } = pageState({ pageClosed: true });
    await expect(
      runRouteAction(page, async () => {
        state.pageClosed = true;
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
      runRouteAction(page, async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('rethrows when the browser process died — not the named race', async () => {
    // A browser crash produces the target-closed error while the page
    // object still reports itself open. The state half of the
    // discrimination must reject it: the app is unreachable and the
    // spec should fail on that, not on a timeout.
    const { page } = pageState();
    await expect(
      runRouteAction(page, async () => {
        throw raceError();
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('returns the action result when nothing throws', async () => {
    const { page } = pageState();
    await expect(runRouteAction(page, async () => 'fulfilled')).resolves.toBe('fulfilled');
  });
});
