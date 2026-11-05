'use strict';

const Redis = require('ioredis');
// Deep import, not the '../shared-lib' barrel. The barrel pulls the whole
// shared surface (security-middleware → geoip-lite, validator,
// express-rate-limit), and those dependencies do not resolve from shared/lib
// in the source tree — so a barrel import would make this module unloadable
// in a unit test that does not mock the barrel, and would make
// parsePositiveInt an implicit requirement of every consumer's barrel mock.
// (In the runtime image the barrel resolves — shared/lib is copied next to
// the backend's node_modules — so this is about testability, not runtime.)
const { parsePositiveInt } = require('../shared-lib/validation-utils');

/** The options a caller may pass. Anything else is a typo and fails loudly. */
const ALLOWED_OPTIONS = ['enableOfflineQueue', 'maxRetriesPerRequest'];

/**
 * Resolves the endpoint of the translation cache Redis instance from the
 * TRANSLATION_CACHE_* env vars. Only the factory resolves it, so every client
 * on that instance dials the same server for the same setting.
 */
function resolveRedisCacheSettings() {
  return {
    host: process.env.TRANSLATION_CACHE_HOST || 'localhost',
    port: parsePositiveInt(process.env.TRANSLATION_CACHE_PORT, 6379, { min: 1 }),
    password: process.env.TRANSLATION_CACHE_PASSWORD || null
  };
}

/**
 * Shared factory for the Redis clients on the translation cache instance
 * (the translation cache and the provisioning invalidation pub/sub).
 *
 * The resilience contract lives here and cannot be overridden: a capped
 * retry backoff, a bounded retry count per command, and no offline queue —
 * a Redis outage surfaces as a failed command, not a silently-growing
 * buffer. Two callers legitimately diverge and must spell it out:
 *
 * - the invalidation subscriber, whose subscribe buffers until Redis answers
 *   so a cold start still delivers broadcasts;
 * - one-off operator scripts (see services/translation/CLAUDE.md), which
 *   buffer so they wait for a Redis that is still coming up.
 *
 * The endpoint is resolved here and nowhere else: a caller cannot point its
 * client at another server. The client exposes the endpoint it dialled
 * (`client.options.host` / `client.options.port`) for logging.
 *
 * @param {object} [options]
 * @param {boolean} [options.enableOfflineQueue] buffer commands while disconnected
 * @param {number|null} [options.maxRetriesPerRequest] per-command retry cap (null = no cap — ioredis applies the cap to numeric values only)
 * @returns {import('ioredis').Redis} the client
 */
function createRedisCacheClient(options = {}) {
  if (options !== null && typeof options !== 'object') {
    throw new Error('createRedisCacheClient: options must be an object');
  }
  const opts = options || {};
  const unknown = Object.keys(opts).filter((key) => !ALLOWED_OPTIONS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`createRedisCacheClient: unknown option(s): ${unknown.join(', ')}`);
  }
  // The names are checked above; the types matter too — ioredis gates the
  // per-command retry cap on `typeof === "number"`, so a string value would
  // silently remove the cap instead of failing loudly.
  if ('enableOfflineQueue' in opts && typeof opts.enableOfflineQueue !== 'boolean') {
    throw new Error('createRedisCacheClient: enableOfflineQueue must be a boolean');
  }
  if (
    'maxRetriesPerRequest' in opts &&
    opts.maxRetriesPerRequest !== null &&
    typeof opts.maxRetriesPerRequest !== 'number'
  ) {
    throw new Error('createRedisCacheClient: maxRetriesPerRequest must be a number or null');
  }
  const { enableOfflineQueue = false, maxRetriesPerRequest = 3 } = opts;
  const { host, port, password } = resolveRedisCacheSettings();

  return new Redis({
    host,
    port,
    password,
    retryStrategy(times) {
      return Math.min(times * 500, 2000);
    },
    maxRetriesPerRequest,
    enableOfflineQueue
  });
}

module.exports = { createRedisCacheClient };
