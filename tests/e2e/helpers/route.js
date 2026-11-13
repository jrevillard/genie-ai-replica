/**
 * Wrap a route handler so it tolerates ONLY the browser-target-closed
 * race.
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
 * The wrapper sits at the REGISTRATION boundary — `page.route(url,
 * runRouteHandler(page, async (route) => { ... }))` — because that is
 * where the race crosses: one wrap covers every branch of the handler
 * and any action added to it later, and the page is passed once, at the
 * site that owns it (a route object cannot reach its own page).
 *
 * The discrimination needs BOTH signals, because neither alone is safe:
 *
 * - the TARGET state (`isTargetGone`): a closed target is necessary but
 *   not sufficient — a mock defect can land at the same moment the spec
 *   ends, and the state alone would swallow it;
 * - the ERROR being Playwright's target-closed error: a mock defect is
 *   never one, so an error-only check would still swallow every defect.
 *   A browser crash produces the same error — but real Playwright
 *   usually delivers the close events BEFORE an in-flight route call
 *   rejects, so by then the state half is already true and a crash is
 *   swallowed like the named race; the spec fails on its other awaits
 *   either way. The error-half's crash discrimination therefore holds
 *   only in the narrow window before close-event delivery — a state
 *   real Playwright does not reliably produce, which route.spec.js
 *   models with a double whose flags stay false, not a protection the
 *   guard buys on a dead browser. What the conjunction is verified to
 *   buy is the other arm: a mock defect that lands while the target is
 *   closing is rethrown, not swallowed. The error is recognised by its
 *   CLASS (`isTargetClosedError`).
 *
 * Only their conjunction is the named race. The error check reads the
 * name and the constructor; if a Playwright upgrade changed both, the
 * race would surface as a loud teardown failure — the acceptable
 * direction to fail in.
 *
 * The state half relies on an ordering Playwright's client guarantees:
 * `Page._onClose` sets `_closed` BEFORE emitting the close event whose
 * handler closes the scope that rejects the in-flight fulfilment, so by
 * the time the catch below sees the race error, `isClosed()` reads true.
 * If a Playwright upgrade ever reversed that, the race would escape as a
 * loud teardown failure — loud again, never a silent pass.
 *
 * A rethrown error reaches the test through Playwright's route-handler
 * error path (an unhandled rejection attributed to the running test).
 * That is Playwright's own model — `page.unrouteAll({ behavior:
 * 'ignoreErrors' })` is its alternative, and it swallows EVERY error,
 * which is exactly what this wrapper must not do. What a rethrow means
 * is precisely what the conjunction decides: a defect on a live target
 * (the owning test's window), or a defect that landed while the target
 * happened to be closing — the pair of states the two halves exist to
 * tell apart.
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
 * True when the error is Playwright's target-closed error — the shape
 * both of its client-side close event and of the protocol answer a dead
 * target produces.
 *
 * The CLASS is the signal, and it is the whole signal. Measured on the
 * shipped playwright-core 1.62.1 — an in-flight `route.fetch()` whose
 * context is closed, and a `page.goto` / `page.click` on a closed
 * target:
 *
 * - the error's `name` is `'Error'`;
 * - its `constructor.name` is `'TargetClosedError2'` — the CLIENT bundle
 *   carries its own copy of Playwright's class and the bundler renames
 *   the second one, so the client-side class arrives renamed.
 *
 * So the class FAMILY covers every shape the handler meets, and the
 * message is not consulted at all: a version bump that rewords the
 * message cannot turn the race back into a loud teardown failure, and a
 * mock defect that merely QUOTES the race's wording ("Request context
 * disposed", "has been closed") is not swallowed — the wording was
 * never the signal.
 *
 * The NAME arm is the defensive half: an error that carries only
 * Playwright's name and no class is tolerated too. The shipped client
 * always delivers the class, so that shape does not occur today — the
 * arm costs one comparison and cannot swallow a mock defect, because a
 * defect does not carry Playwright's class name.
 */
const TARGET_CLOSED_CLASS = /^TargetClosedError\d*$/;

function isTargetClosedError(error) {
  if (!error) return false;
  if (typeof error.name === 'string' && TARGET_CLOSED_CLASS.test(error.name)) return true;
  if (error.constructor && TARGET_CLOSED_CLASS.test(error.constructor.name)) return true;
  return false;
}

/**
 * Wrap `handler` for `page.route`: the handler runs unchanged, and an
 * error it throws is swallowed only when the browser target is gone AND
 * the error is the target-closed race. Any other error propagates.
 */
function runRouteHandler(page, handler) {
  return async (route) => {
    try {
      return await handler(route);
    } catch (error) {
      if (isTargetGone(page) && isTargetClosedError(error)) return undefined;
      throw error;
    }
  };
}

/**
 * Wrap a POST-only route handler: everything `runRouteHandler` tolerates,
 * plus the stream mocks' request filter, stated once — only the app's
 * POST reaches the handler; a preflight (cross-origin dev posture) or a
 * stray GET must reach the network, not a CORS-less 200 from a handler
 * that only knows how to answer a stream.
 */
function runPostOnlyRouteHandler(page, handler) {
  return runRouteHandler(page, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    return handler(route);
  });
}

module.exports = {
  runPostOnlyRouteHandler,
  runRouteHandler
};
