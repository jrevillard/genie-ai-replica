'use strict';

const Redis = require('ioredis');
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
 * Shared factory for the Redis clients that talk to the translation cache
 * instance: the translation cache itself and the provisioning invalidation
 * pub/sub.
 *
 * Every client on that instance carries the SAME resilience contract: a
 * capped retry backoff, a bounded retry count per command, and no offline
 * queue — a Redis outage surfaces as a failed command, not a
 * silently-growing buffer.
 *
 * A caller whose contract differs overrides it per call: the provisioning
 * invalidation subscriber needs the offline queue (its subscribe must buffer
 * until Redis answers, so a cold start still delivers broadcasts) and no
 * per-command retry cap.
 *
 * @param {object} [clientOptions] ioredis options overriding the shared contract
 * @returns {import('ioredis').Redis} the client
 */
function createRedisCacheClient(clientOptions = {}) {
  return new Redis({
    ...resolveRedisCacheSettings(),
    retryStrategy(times) {
      return Math.min(times * 500, 2000);
    },
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    ...clientOptions
  });
}

module.exports = { createRedisCacheClient, resolveRedisCacheSettings };
