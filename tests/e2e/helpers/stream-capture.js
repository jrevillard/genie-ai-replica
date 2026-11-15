// tests/e2e/helpers/stream-capture.js
//
// The stream CAPTURE idiom, written once. A spec that asserts what went
// out over the stream route intercepts it, records each request's POST
// body and answers with a scripted SSE envelope — this module owns that
// wiring so the capture sites cannot drift apart (a stray GET must reach
// the network, not a CORS-less 200 from the mock: the POST-only filter
// is stated once in helpers/route.js).
//
// It is deliberately NOT part of helpers/stream-route.js: that module is
// the endpoint CONTRACT — a plain declaration the config-validator gate
// pins dependency-free (e2e-stream-route.test.js) — and this module
// composes it with the route wrapper instead.

const { runPostOnlyRouteHandler } = require('./route');
const { STREAM_ROUTE, sseFulfill } = require('./stream-route');

/**
 * Intercept the stream route and CAPTURE what goes out over it: each
 * request's parsed POST body lands in `bodies` (in send order), and
 * `queried()` says whether any request was captured. The response is
 * [body] — '' leaves the turn open (the watcher contract), an sseBody()
 * completes it. The capture lands in the route handler (the Node side),
 * which trails the click that triggers it — read `bodies` only after
 * `queried()` has settled (expect.poll), never on the instant.
 */
async function captureStreamPosts(page, body) {
  const bodies = [];
  let captured = false;
  await page.route(
    STREAM_ROUTE,
    runPostOnlyRouteHandler(page, async (route) => {
      captured = true;
      bodies.push(route.request().postDataJSON());
      await sseFulfill(route, body);
    })
  );
  return { queried: () => captured, bodies };
}

module.exports = { captureStreamPosts };
