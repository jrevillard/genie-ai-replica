'use strict';

const Redis = require('ioredis');
// Deep import, not the '../shared-lib' barrel: the barrel pulls the whole
// shared surface (security-middleware → geoip-lite, validator), and those
// dependencies do not resolve from shared/lib — a barrel import would make
// this module unloadable in a unit test that does not mock the barrel, and
// would make parsePositiveInt an implicit requirement of every consumer's
// barrel mock.
const { parsePositiveInt } = require('../shared-lib/validation-utils');

/**
 * Resolves the endpoint of the translation cache Redis instance from the
 * TRANSLATION_CACHE_* env vars. Shared by every client on that instance so
 * they cannot dial different servers for the same setting.
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
 * buffer. Only the invalidation subscriber may diverge, and it must spell
 * that out: its subscribe buffers until Redis answers, so a cold start
 * still delivers broadcasts.
 *
 * @param {object} [options]
 * @param {boolean} [options.enableOfflineQueue] buffer commands while disconnected
 * @param {number|null} [options.maxRetriesPerRequest] per-command retry cap (null = unlimited)
 * @returns {import('ioredis').Redis} the client
 */
function createRedisCacheClient({ enableOfflineQueue = false, maxRetriesPerRequest = 3 } = {}) {
  return new Redis({
    ...resolveRedisCacheSettings(),
    retryStrategy(times) {
      return Math.min(times * 500, 2000);
    },
    maxRetriesPerRequest,
    enableOfflineQueue
  });
}

module.exports = { createRedisCacheClient, resolveRedisCacheSettings };
