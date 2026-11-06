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
// The specs below are the mutation gate for that split: flipping either
// side of the discrimination (swallowing everything, or rethrowing the
// race) turns one of them red.

// A page double: the handler's page, with the two closed-states the
// discrimination reads.
function pageState({ pageClosed = false, contextClosed = false } = {}) {
  return {
    isClosed: () => pageClosed,
    context: () => ({ isClosed: () => contextClosed })
  };
}

test.describe('runRouteAction', () => {
  test('tolerates the error when the page closed — the named race', async () => {
    await expect(
      runRouteAction(pageState({ pageClosed: true }), async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).resolves.toBeUndefined();
  });

  test('tolerates the error when the context closed — the named race', async () => {
    await expect(
      runRouteAction(pageState({ contextClosed: true }), async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).resolves.toBeUndefined();
  });

  test('rethrows a mock defect with its own message — the target is alive', async () => {
    await expect(
      runRouteAction(pageState(), async () => {
        throw new Error('route.fulfill: invalid status 200.5');
      })
    ).rejects.toThrow('route.fulfill: invalid status 200.5');
  });

  test('rethrows a mock defect even when the error text names the race', async () => {
    // The discrimination is on the TARGET state, never on the wording:
    // a mock that fails while the browser is alive is a defect even when
    // its message happens to read like the race.
    await expect(
      runRouteAction(pageState(), async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    ).rejects.toThrow('Target page, context or browser has been closed');
  });

  test('returns the action result when nothing throws', async () => {
    await expect(runRouteAction(pageState(), async () => 'fulfilled')).resolves.toBe('fulfilled');
  });
});
