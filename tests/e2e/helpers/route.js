/**
 * Run a route action, tolerating ONLY the browser-target-closed race.
 *
 * A route handler outlives its own test: the browser context is closed
 * while a fulfilment is still in flight, and that fulfilment can no
 * longer land. That race is expected, and the handler must not fail the
 * test over it.
 *
 * Every other failure is a defect in the mock — an invalid option, a
 * typo, a wrong shape. It is rethrown, so it surfaces as a test failure
 * carrying its own message instead of the app waiting forever for a
 * stream that never arrives and the spec dying on its own timeout with
 * nothing pointing at the mock.
 *
 * The discrimination is on the TARGET state, not on the error text: a
 * message match would classify by wording, and the wording is
 * Playwright's, not ours.
 */

/**
 * True when the browser target the route belongs to is gone — the page
 * closed or the context closed. The route's own page is not reachable
 * from the route object, so the caller passes the page it registered the
 * handler on.
 */
function isTargetGone(page) {
  return page.isClosed() || page.context().isClosed();
}

/**
 * Await `action`, swallowing the error only when the browser target is
 * gone. Any other error propagates to the caller.
 */
async function runRouteAction(page, action) {
  try {
    return await action();
  } catch (error) {
    if (isTargetGone(page)) return undefined;
    throw error;
  }
}

module.exports = {
  isTargetGone,
  runRouteAction
};
