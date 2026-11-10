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
 *   It also fires when the browser process dies — though Playwright
 *   usually delivers the close events before an in-flight route call
 *   rejects, so by then the state half is often already true too; a
 *   crashed browser fails the spec on its other awaits either way. The
 *   error arrives in three shapes (class, name, or the client's
 *   re-wrapped wording) — `isTargetClosedError` reads all three.
 *
 * Only their conjunction is the named race. The error check reads the
 * constructor name and the message (the message form is the same
 * discrimination `chatbot/error-handling.spec.js` has always used); if a
 * Playwright upgrade changed both, the race would surface as a loud
 * teardown failure — the acceptable direction to fail in.
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
 * Three spellings, because the error reaches the handler in three
 * shapes:
 *
 * - an in-process throw carries the CLASS (constructor name);
 * - an error that crossed the pipeline keeps its NAME — Playwright's own
 *   discrimination accepts the instance or the name;
 * - `route.fetch()` re-wraps the failure CLIENT-side into a plain Error
 *   with a "route.fetch: " prefix, so neither the class nor the name
 *   survives — only the WORDING ("Request context disposed."). That
 *   spelling was measured on the venue: the guard recognised the name
 *   and the constructor, and still rethrew it, and the teardown error
 *   landed in the next test.
 *
 * The wording branch is narrow (it names a closed target or a disposed
 * context) and the state half still gates it: a defect whose text says
 * "context disposed" while the target is ALIVE is rethrown.
 */
function isTargetClosedError(error) {
  if (!error) return false;
  if (error.name === 'TargetClosedError') return true;
  if (error.constructor && error.constructor.name === 'TargetClosedError') return true;
  if (typeof error.message !== 'string') return false;
  return /has been closed/i.test(error.message) || /context disposed/i.test(error.message);
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
