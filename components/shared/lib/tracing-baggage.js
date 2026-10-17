const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } = require('@opentelemetry/core');
const { context, propagation } = require('@opentelemetry/api');

/**
 * The propagator GENIE.AI installs on the Node side.
 *
 * Exported as a factory rather than built inline in tracing.js so a test can
 * assert on the exact propagator production uses. The Python services already
 * use the OTel default composite (they never call set_global_textmap); a
 * trace-context-only propagator here is what makes the two sides asymmetric,
 * and `genie.query_id` would never reach chatqna.
 *
 * Injection goes through the global propagator installed on the SDK, whose
 * `inject` supplies the default setter. Calling this propagator's `inject`
 * directly is a different story: @opentelemetry/core v2 gives the setter no
 * default, and CompositePropagator swallows the resulting TypeError as a
 * diag warning, so a missing setter is indistinguishable from "no baggage".
 * Pass `defaultTextMapSetter` explicitly if you ever call it by hand.
 *
 * @returns {CompositePropagator}
 */
function createGeniePropagator() {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
  });
}

/**
 * Run `fn` with a baggage entry set on the active context.
 *
 * @param {string} key   baggage key, e.g. spanAttrs.QUERY_ID_KEY
 * @param {string} value opaque correlation id — MUST be a non-empty string.
 *   `propagation.createBaggage` coerces undefined to the literal "undefined",
 *   which satisfies every downstream shape check and joins to nothing.
 * @param {Function} fn
 * @returns {*} whatever fn returns
 */
function withBaggage(key, value, fn) {
  const ctx = propagation.setBaggage(context.active(), propagation.createBaggage({ [key]: { value: String(value) } }));
  return context.with(ctx, fn);
}

module.exports = { createGeniePropagator, withBaggage };
