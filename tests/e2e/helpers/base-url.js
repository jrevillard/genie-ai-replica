/**
 * The venue's edge — the origin every spec navigates to.
 *
 * ONE definition, so a venue is named once and every spec resolves it the
 * same way. The Compose stack serves the edge on localhost:443; a
 * Kubernetes venue serves it on its own host and port (`BASE_URL` names
 * it). A spec that hardcodes the origin states a fact about the Compose
 * venue alone: it cannot run anywhere else, and it fails with a
 * connection error before its first assertion — the failure mode #1737
 * was filed for.
 *
 * The trailing slashes are stripped ONCE, here: `page.url()` never
 * produces a trailing double slash, so every `${BASE_URL}/...`
 * interpolation stays well-formed even when the environment configures
 * BASE_URL with a trailing '/'.
 *
 * This module carries no credential — a spec that needs venue
 * credentials takes them from `helpers/e2e-fixtures.js` (or from the
 * same `helpers/chatbot.js` require as `loginViaUI`), and the two import
 * paths must never be mixed in one file (tests/e2e/CLAUDE.md § Fixtures).
 * That is why the edge lives in its own module: every spec may require it,
 * whichever credential path it takes.
 */
const BASE_URL = (process.env.BASE_URL || 'https://localhost').replace(/\/+$/, '');

module.exports = { BASE_URL };
